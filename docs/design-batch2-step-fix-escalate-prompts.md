# 批次 2：步骤推进修复 + 断路器扩展 + Prompt 优化

> 2026-03-27 | 涵盖 Issue #8, #2 + 文章改进（task-level contract, 设计约束, Playwright 指引）

---

## 1. 背景与目标

### 做什么
1. **Issue #8（P0）**：修复 stepState 被 Zod schema 丢弃的 bug，这是 auto_dev_next 步骤不推进的根因
2. **Issue #2（P0）**：TRIBUNAL_ESCALATE 后自动 REGRESS 回 Phase 3（复用断路器思想），不再卡死
3. **Prompt 优化**：Phase 1 设计约束 + Phase 3 task-level contract + Phase 5 Playwright 指引

### 不做什么（Non-Goals）
- 不改变 orchestrator 的 step 执行顺序
- 不改变 tribunal 的 3 次提交上限
- 不增加新的 auto-dev 工具

---

## 2. 现状分析

### Issue #8 根因

`writeStepState`（orchestrator.ts:248-260）直接用 `writeFile` 写入 `step`, `stepIteration`, `lastValidation`, `approachState` 到 state.json。但 `sm.atomicUpdate`（state-manager.ts:397-411）做了：
1. `loadAndValidate()` → Zod `StateJsonSchema.safeParse()` → **丢弃 schema 外字段**
2. merge updates → `StateJsonSchema.safeParse(merged)` → **再次过滤**
3. `result.data` 写回 → stepState 字段消失

任何调用 `sm.atomicUpdate()` 的地方（preflight 注入 lessons、checkpoint 写入、tribunal 计数器更新等）都会导致 stepState 丢失。

### Issue #2 现状

`auto_dev_submit`（index.ts:1462-1473）在 `tribunalSubmits[phase] >= 3` 时返回 `TRIBUNAL_ESCALATE`，之后无任何合法的 API 继续流程。

### Prompt 现状

- Phase 1 的设计模板没有约束"避免写伪代码"
- Phase 3 的 task prompt 只列出 task 标题，不包含 task 的完成标准
- Phase 5 没有 Playwright MCP 使用指引

---

## 3. 方案对比

### 3.1 Issue #8：stepState 持久化

**方案 A（推荐）：将 stepState 字段纳入 Zod schema**

在 `StateJsonSchema`（types.ts）中添加 `step`, `stepIteration`, `lastValidation`, `approachState` 为 optional 字段。这样 `atomicUpdate` 的 Zod parse 不会丢弃它们。

| 维度 | 评价 |
|------|------|
| 改动量 | ~15 行（types.ts schema 扩展） |
| 风险 | 低 — 都是 optional 字段，不影响现有状态 |
| 效果 | 根治 — 所有 read/write 路径统一 |
| 副作用 | `writeStepState` 可以改为直接用 `sm.atomicUpdate`，消除两套写入机制 |

**方案 B：writeStepState 绕过 Zod schema**

让 `writeStepState` 读取原始 JSON（不做 Zod parse），merge 后直接写回。`atomicUpdate` 也改为保留未知字段。

| 维度 | 评价 |
|------|------|
| 改动量 | ~30 行（改 atomicUpdate + 保留逻辑） |
| 风险 | 中 — Zod 的 strip 行为是防御性的，绕过它可能引入脏数据 |
| 效果 | 治标 — 不能防止未来有人加新字段忘记加 schema |

**选择方案 A**：将字段纳入 schema 是正路，也消除了两套写入机制的隐患。

### 3.2 Issue #2：ESCALATE 恢复路径

**方案 A（推荐）：ESCALATE 自动 REGRESS**

ESCALATE 时不返回给用户，而是：
1. 提取最近 tribunal 的 issues 作为修复指引
2. 自动 REGRESS 到 Phase 3，带修复 prompt
3. 记录 `phaseEscalateCount`
4. 第二次 ESCALATE 时才真正 BLOCK

**方案 B：新增 human_override API**

添加 `auto_dev_human_override` 工具，允许人工确认后跳过 tribunal。

| 维度 | 方案 A | 方案 B |
|------|--------|--------|
| 自动化程度 | 高 — 自动回退重试 | 低 — 需要人工 |
| 改动量 | ~50 行 | ~40 行 |
| 复用 | 复用现有 REGRESS 机制 | 新增 API |
| 适用场景 | tribunal 误判（最常见） | tribunal 正确但需要人工确认 |

**选择方案 A + 方案 B 的最小子集**：自动 REGRESS 为主，`checkpoint(force=true)` 作为最终逃生口（仅 `phaseEscalateCount >= 2` 时可用）。

### 3.3 Prompt 优化

只有一个方案：修改 prompt 模板文件。无需方案对比。

---

## 4. 详细设计

### 4.1 Issue #8：stepState 纳入 Zod Schema

**改动文件：** `types.ts`

在 `StateJsonSchema` 中追加：
```typescript
// Step orchestrator state (persisted across auto_dev_next calls)
step: z.string().nullable().optional(),
stepIteration: z.number().int().optional(),
lastValidation: z.string().nullable().optional(),
approachState: z.object({
  stepId: z.string(),
  approaches: z.array(z.object({
    name: z.string(),
    description: z.string(),
    status: z.enum(["pending", "active", "failed"]),
  })),
  currentIndex: z.number().int(),
  failedApproaches: z.array(z.object({
    name: z.string(),
    feedback: z.string(),
    iteration: z.number().int(),
  })),
}).nullable().optional(),
```

**改动文件：** `orchestrator.ts`

`writeStepState` 改为使用 `sm.atomicUpdate`，消除独立的 read-write 路径：
```typescript
async function writeStepState(
  sm: StateManager,
  updates: Partial<StepState>,
): Promise<void> {
  await sm.atomicUpdate(updates);
}
```

函数签名从 `(stateFilePath: string, ...)` 改为 `(sm: StateManager, ...)`。所有调用点同步更新。

`readStepState` 改为从 `sm.loadAndValidate()` 读取（字段已在 schema 中）。

### 4.2 Issue #2：ESCALATE 自动 REGRESS

**改动文件：** `index.ts`（auto_dev_submit handler）

```typescript
// Track submit count: max 3 attempts before escalation
const phaseKey = String(phase);
const submits = state.tribunalSubmits ?? {};
const currentCount = submits[phaseKey] ?? 0;
if (currentCount >= 3) {
  // Phase-level circuit breaker: auto-regress to Phase 3
  const escCount = state.phaseEscalateCount?.[phaseKey] ?? 0;
  
  if (escCount >= 2) {
    // Second escalation — truly blocked, need human
    return textResult({
      status: "TRIBUNAL_ESCALATE",
      phase,
      message: `Phase ${phase} 已 ${escCount + 1} 次 ESCALATE。需要人工介入。`,
      mandate: "所有自动恢复路径已用尽。请人工审查后使用 checkpoint(force=true) 继续。",
    });
  }

  // First escalation — auto-regress to Phase 3
  const regressPhase = 3;
  // Collect tribunal issues from recent submissions
  const tribunalIssues = await collectRecentTribunalIssues(sm.outputDir, phase);
  
  // Update escalation counter + reset tribunal submits for this phase
  await sm.atomicUpdate({
    phase: regressPhase,
    status: "IN_PROGRESS",
    phaseEscalateCount: { ...(state.phaseEscalateCount ?? {}), [phaseKey]: escCount + 1 },
    tribunalSubmits: { ...submits, [phaseKey]: 0 },
    // Reset step to re-enter Phase 3
    step: "3",
    stepIteration: 0,
    lastValidation: "ESCALATE_REGRESS",
  });

  return textResult({
    status: "ESCALATE_REGRESS",
    phase,
    regressTo: regressPhase,
    message: `Phase ${phase} tribunal 3 次未通过，自动回退到 Phase ${regressPhase} 修复。`,
    tribunalFeedback: tribunalIssues,
    mandate: `[AUTO-REGRESS] 请根据以下 tribunal 反馈修复代码，然后重新通过 Phase 4-6。`,
  });
}
```

**新增函数：** `collectRecentTribunalIssues`

```typescript
async function collectRecentTribunalIssues(
  outputDir: string, phase: number
): Promise<string> {
  // Read tribunal log files for this phase
  const logPath = join(outputDir, `tribunal-phase${phase}.md`);
  try {
    const content = await readFile(logPath, "utf-8");
    // Extract last FAIL section (issues list)
    const failSections = content.split(/\n---\n/).filter(s => s.includes("FAIL"));
    return failSections.slice(-1)[0] ?? "（无详细反馈）";
  } catch {
    return "（无法读取 tribunal 日志）";
  }
}
```

**改动文件：** `types.ts`

在 `StateJsonSchema` 中追加：
```typescript
phaseEscalateCount: z.record(z.string(), z.number()).optional(),
```

**改动文件：** `index.ts`（checkpoint Guard C — force 参数）

```typescript
// Guard C: Tribunal phases cannot be directly marked PASS via checkpoint
if ((TRIBUNAL_PHASES as readonly number[]).includes(phase) && status === "PASS") {
  // Escape hatch: force=true allowed only after 2+ escalations
  const escCount = state.phaseEscalateCount?.[String(phase)] ?? 0;
  if (force === true && escCount >= 2) {
    // Human override — log it
    const overrideSummary = `[HUMAN_OVERRIDE] Phase ${phase} forced PASS after ${escCount} escalations. Reason: ${reason ?? "not provided"}`;
    // Continue to normal checkpoint logic (don't return error)
  } else {
    return textResult({
      error: "TRIBUNAL_REQUIRED",
      message: `Phase ${phase} 需要通过独立裁决才能 PASS。`,
      ...(escCount >= 2 ? { hint: "可使用 force=true 强制通过（需提供 reason）" } : {}),
    });
  }
}
```

`auto_dev_checkpoint` 的 schema 中增加 `force: z.boolean().optional()` 和 `reason: z.string().optional()`。

### 4.3 Prompt 优化

**4.3.1 Phase 1 设计约束（防止过度细节）**

在 `skills/auto-dev/prompts/phase1-architect.md` 的 Constraints 部分追加：

```markdown
- 设计文档聚焦于接口契约、数据流和验收标准，避免写伪代码或指定具体实现方式
- 实现细节（具体的函数体、算法选择）留给 Phase 3 的 developer agent 决定
- "怎么做"写到方案选型层面即可，不要写到代码行级别
```

**4.3.2 Phase 3 Task-Level Contract**

在 `orchestrator.ts` 的 step "3" prompt 构建中（line 612-628），从 plan.md 提取每个 task 的完成标准，附加到 prompt 中：

```typescript
if (step === "3") {
  const planPath = join(outputDir, "plan.md");
  const planContent = await readFileSafe(planPath);
  if (!planContent) {
    return `请实现以下功能：${topic}...`;
  }

  const taskListStr = extractTaskList(planContent);
  // NEW: 提取每个 task 的完成标准
  const taskDetails = extractTaskDetails(planContent); // 包含标题+完成标准
  
  return `请完成以下任务：\n\n${taskDetails}\n\n` +
    `项目根目录: ${projectRoot}\n输出目录: ${outputDir}\n\n` +
    `**重要：每完成一个 task，先验证其完成标准是否满足，再开始下一个。**` +
    approachPlanInstruction + ISOLATION_FOOTER;
}
```

**新增函数 `extractTaskDetails`**：从 plan.md 提取 task 标题 + 完成标准，格式：
```
## Task 1: 删除 checkpoint 守卫
- **完成标准**: checkpoint PASS 不再因 injectedLessonIds 非空而被拒绝

## Task 2: ...
```

**4.3.3 Phase 5 Playwright 指引**

在 `skills/auto-dev/prompts/phase5-test-architect.md` 的 Requirements 之前追加：

```markdown
## 前端项目测试指引（仅前端项目适用）

如果项目是前端项目（React/Vue/HTML）且 Playwright MCP 可用：
- 优先使用 Playwright MCP 进行真实浏览器交互测试
- 可以用 `browser_navigate` + `browser_snapshot` + `browser_click` 验证 UI 行为
- 比 DOM 单元测试更能发现真实的用户交互问题

判断方法：检查 package.json 是否包含 react/vue/svelte 等前端框架依赖。
```

---

## 5. 影响分析

| 文件 | Issue #8 | Issue #2 | Prompt |
|------|----------|----------|--------|
| `types.ts` | 新增 schema 字段 | 新增 phaseEscalateCount | |
| `orchestrator.ts` | writeStepState 改用 sm.atomicUpdate | | extractTaskDetails |
| `index.ts` (submit) | | ESCALATE 分支改为自动 REGRESS | |
| `index.ts` (checkpoint) | | 新增 force 参数 + Guard C 逃生口 | |
| `phase1-architect.md` | | | 设计约束 |
| `phase5-test-architect.md` | | | Playwright 指引 |

### 兼容性

- Issue #8：新增的 schema 字段全部 optional，现有 state.json 不受影响
- Issue #2：新增 `phaseEscalateCount` 字段 optional，`force` 参数 optional
- Prompt：纯文本追加，不影响模板变量

### 回滚方案

每个改动独立 commit，可单独 revert：
1. types.ts schema 扩展（Issue #8）
2. orchestrator.ts writeStepState 重构（Issue #8）
3. index.ts ESCALATE 逻辑（Issue #2）
4. prompt 文件（3 个独立文件）

---

## 6. 风险与缓解

| 风险 | 严重度 | 概率 | 缓解 |
|------|--------|------|------|
| approachState 的嵌套 Zod schema 太严格 | 中 | 中 | 使用 z.any() 作为 approachState 类型，避免内部结构校验失败 |
| ESCALATE_REGRESS 导致无限循环 | 高 | 低 | phaseEscalateCount >= 2 后硬 BLOCK |
| writeStepState 改为 sm.atomicUpdate 后性能下降 | 低 | 低 | atomicUpdate 已做原子写入，差异可忽略 |
| extractTaskDetails 正则解析 plan.md 失败 | 中 | 中 | fallback 到现有的 extractTaskList |

---

## 7. 验收标准

| AC | 描述 | 验证方式 |
|----|------|---------|
| AC-1 | writeStepState 写入的 step 字段在 sm.atomicUpdate 后仍然存在 | 单元测试 |
| AC-2 | readStepState 读取的字段与 writeStepState 写入的一致 | 单元测试 |
| AC-3 | 现有的 303+ 测试全部通过（schema 扩展无 breaking change） | 回归测试 |
| AC-4 | auto_dev_next 调用后 step 推进到下一步（不再停留在同一步） | 集成测试 |
| AC-5 | tribunal 提交 3 次 FAIL 后，第一次 ESCALATE 自动 REGRESS 到 Phase 3 | 单元测试 |
| AC-6 | ESCALATE_REGRESS 返回中包含 tribunal 反馈（tribunalFeedback 非空） | 单元测试 |
| AC-7 | phaseEscalateCount >= 2 时返回真正的 TRIBUNAL_ESCALATE（BLOCK） | 单元测试 |
| AC-8 | checkpoint force=true 且 phaseEscalateCount >= 2 时允许 PASS | 单元测试 |
| AC-9 | checkpoint force=true 但 phaseEscalateCount < 2 时仍被 Guard C 拦截 | 单元测试 |
| AC-10 | Phase 1 prompt 包含"避免写伪代码"约束文本 | 代码审查 |
| AC-11 | Phase 3 step prompt 包含从 plan.md 提取的完成标准 | 单元测试 |
| AC-12 | Phase 5 prompt 包含 Playwright 指引文本 | 代码审查 |
| AC-13 | extractTaskDetails 解析失败时 fallback 到 extractTaskList | 单元测试 |

---

## 8. 实施建议

预估总改动量：~200 行（含测试）。建议 task 拆分：

1. **Task 1**: types.ts schema 扩展（step, stepIteration, lastValidation, approachState, phaseEscalateCount）
2. **Task 2**: orchestrator.ts writeStepState/readStepState 重构为使用 sm.atomicUpdate
3. **Task 3**: orchestrator.ts writeStepState 调用点全部更新（签名变化）
4. **Task 4**: Issue #8 测试（验证 stepState 在 atomicUpdate 后保留）
5. **Task 5**: index.ts ESCALATE 分支改为自动 REGRESS + collectRecentTribunalIssues
6. **Task 6**: index.ts checkpoint 新增 force/reason 参数 + Guard C 逃生口
7. **Task 7**: types.ts phaseEscalateCount + checkpoint schema 更新
8. **Task 8**: Issue #2 测试（ESCALATE_REGRESS, force override）
9. **Task 9**: phase1-architect.md 设计约束
10. **Task 10**: orchestrator.ts extractTaskDetails + Phase 3 prompt 改造
11. **Task 11**: phase5-test-architect.md Playwright 指引
12. **Task 12**: Prompt 相关测试
13. **Task 13**: 全量回归测试
