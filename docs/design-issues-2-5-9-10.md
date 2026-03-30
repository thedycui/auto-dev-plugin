# Issue #2 #5 #9 #10 解决方案重新设计

> 2026-03-27 | 基于当前代码框架（invisible framework + step orchestrator + circuit breaker）

---

## Issue #2: TRIBUNAL_ESCALATE 后没有恢复路径

### 现状分析

`auto_dev_submit`（index.ts:1462-1473）中，tribunal 提交 3 次 FAIL 后返回 `TRIBUNAL_ESCALATE`，之后：
- checkpoint 被 Guard C 拦截（TRIBUNAL_REQUIRED）
- tribunal_verdict 需要 digest 文件，但 ESCALATE 状态不会生成 digest
- 用户只能手动改 state.json

**但现在有了 step orchestrator + circuit breaker**。Tribunal 的 3 次 FAIL 本质上等同于"同一个方案反复失败"——可以复用断路器逻辑。

### 新方案：ESCALATE 触发 Phase 级断路器

现有的断路器工作在 **step 级别**（Phase 3 的 task 实现），ESCALATE 发生在 **Phase 级别**（Phase 4/5/6 的 tribunal 审查）。需要把断路器的覆盖范围从 step 扩展到 phase。

**核心逻辑变更：** ESCALATE 时不再死等人工，而是：

1. 记录当前 phase 的失败原因（tribunal 的 issues 列表）
2. 回退到 Phase 3（REGRESS），带上 tribunal 反馈作为修复指引
3. 断路器计数器 +1

```
TRIBUNAL_FAIL x3 → ESCALATE
  → 提取最近 3 次 tribunal issues 合并为修复清单
  → REGRESS to Phase 3（带修复 prompt）
  → 断路器计数（phaseEscalateCount++）
  → 如果 phaseEscalateCount >= 2 → 真正 BLOCK，等人工
```

**改动范围：**

| 文件 | 改动 |
|------|------|
| `index.ts` (auto_dev_submit) | ESCALATE 分支：不再直接返回，改为自动 REGRESS + 断路器计数 |
| `types.ts` | StateJson 新增 `phaseEscalateCount?: Record<string, number>` |
| `tribunal.ts` | 新增 `collectTribunalIssues(outputDir, phase): string` — 从最近 3 次 tribunal 日志中提取 issues |

**用户视角的变化：**
- 之前：tribunal 3 次 FAIL → 卡死，需要手动改 state.json
- 之后：tribunal 3 次 FAIL → 自动回退到实现阶段重做 → 第二次 ESCALATE → 才需要人工

**保留人工介入入口：** 仍然需要一个轻量级的 force 参数，但仅限 `phaseEscalateCount >= 2` 时使用：

```typescript
// auto_dev_checkpoint 的 Guard C 中
if (TRIBUNAL_PHASES.includes(phase) && status === "PASS") {
  const escCount = state.phaseEscalateCount?.[String(phase)] ?? 0;
  if (escCount >= 2 && force === true) {
    // 允许人工 override，记录到 progress-log
    await logHumanOverride(sm, phase, reason);
    // 正常通过
  } else {
    return textResult({ error: "TRIBUNAL_REQUIRED" });
  }
}
```

---

## Issue #5: Phase 跳过后状态不一致

### 现状分析

原 issue 描述的场景是"手动改 state.json 跳过 Phase 5"。在当前框架下：
- Phase 推进由 `computeNextTask` / `computeNextDirective` 管理
- 用户不需要也不应该手动改 state.json
- `auto_dev_complete` 通过 progress-log 的 CHECKPOINT 标记校验

**这个 issue 的根本触发条件（手动改 state.json）在正常流程中不再存在。**

### 新方案：不修代码，加防御性检测

不需要加新功能。只需要在 `auto_dev_complete` 中增加一个 **state/progress-log 一致性检查**，当检测到不一致时给出明确提示：

```typescript
// auto_dev_complete 中，validateCompletion 之后
const statePhase = state.phase;
const logPassedPhases = validation.passedPhases;

if (statePhase > Math.max(...logPassedPhases) + 1) {
  return textResult({
    error: "STATE_LOG_INCONSISTENT",
    message: `state.json 显示 phase=${statePhase}，但 progress-log 中缺少中间阶段的 PASS 记录。` +
      `可能是 state.json 被手动修改。请检查并修复。`,
    passedPhases: logPassedPhases,
  });
}
```

**改动量：** ~10 行，加在 `auto_dev_complete` 的 `validateCompletion` 之后。

---

## Issue #9: LESSON_FEEDBACK_REQUIRED 阻塞 checkpoint

### 现状分析

当前流程：
1. `auto_dev_preflight` 注入 lessons → 写入 `state.injectedLessonIds`（index.ts:1025）
2. Agent 完成工作，调用 `checkpoint(PASS)`
3. Guard 检查 `injectedLessonIds` 非空 → 拒绝（index.ts:424-436）
4. Agent 必须先调 `auto_dev_lessons_feedback` 清空 IDs
5. 再次 `checkpoint(PASS)` → 通过

**问题本质：** 经验反馈是辅助功能，不应该阻塞核心流程。按照隐形框架理念，agent 不应感知 lessons 系统的存在。

### 新方案：删除 checkpoint 守卫，lessons 反馈移到 Phase 7

**核心原则：** lessons 系统对 agent 完全透明——注入时静默注入（已实现），收集反馈时也应该静默收集。

**改动 1：删除 checkpoint 中的 LESSON_FEEDBACK_REQUIRED 守卫**

```typescript
// 删除 index.ts:424-436 整段代码
```

**改动 2：Phase 7 复盘时自动收集未反馈的 lessons**

在 `auto_dev_submit` 的 Phase 7 快捷路径中，加入自动处理：

```typescript
if (phase === 7) {
  const outputDir = sm.outputDir;
  await generateRetrospectiveData(outputDir);

  // 自动清理未反馈的 lessons
  const pendingIds = state.injectedLessonIds ?? [];
  if (pendingIds.length > 0) {
    await sm.atomicUpdate({ injectedLessonIds: [] });
  }

  // ... 原有逻辑
}
```

**改动 3：lessons_feedback 工具保留但降级为可选**

`auto_dev_lessons_feedback` 工具不删除（向后兼容），但不再是 checkpoint 的前置条件。Agent 如果调了就正常处理，不调也不会被拦。

**改动范围：**

| 文件 | 改动 |
|------|------|
| `index.ts` (checkpoint) | 删除 LESSON_FEEDBACK_REQUIRED 守卫（~12 行） |
| `index.ts` (auto_dev_submit phase 7) | 加入 pendingIds 自动清理（~4 行） |
| `index.ts` (auto_dev_lessons_feedback) | 保留不动 |

**对 lessons 评分系统的影响：**

会损失 agent 对每条 lesson 的 helpful/not_applicable/incorrect 反馈。但实际中 agent 的反馈质量有限（经常无脑 "helpful"），不如从最终结果（任务是否成功）反推 lesson 的有效性。

**未来改进方向：** Phase 7 复盘中让 reviewer agent 分析 diff，评估哪些注入的 lessons 实际被采纳了，比强制 agent 反馈更可靠。

---

## Issue #10: Tribunal 追加设计外的需求

### 现状分析

当前 tribunal prompt（tribunal.ts:193-196）：
```
你是独立裁决者。你的默认立场是 FAIL。
PASS 必须对每条检查项提供证据（文件名:行号），FAIL 只需说明理由。
```

Phase 4 checklist 中 "B. 代码审查"：
```
- [ ] 独立审查 diff，不要只依赖主 Agent 的 review 报告
```

**问题：** "独立审查 diff" 太宽泛，tribunal 可以从 diff 中发现任何它认为的问题。当这些被标为 P1 时，成了阻塞项，导致 agent 实现设计外的功能。

### 新方案：Schema 层面区分 blocking 和 advisory

**核心原则：** Tribunal 只能基于 **设计文档 AC + 计划文档 task** 判 FAIL，超出范围的发现只能作为建议。

**改动 1：Tribunal Schema 拆分 issues 为两类**

```typescript
// tribunal-schema.ts
properties: {
  issues: {
    items: {
      properties: {
        severity: { type: "string", enum: ["P0", "P1", "P2"] },
        description: { type: "string" },
        file: { type: "string" },
        suggestion: { type: "string" },
        acRef: {
          type: "string",
          description: "对应的 AC 编号或 plan task 编号。填不出来说明不在审查范围内，应放入 advisory。"
        }
      },
      required: ["severity", "description", "acRef"]  // acRef 变为必填
    },
    description: "AC/Plan 范围内的问题 — 可以导致 FAIL"
  },
  advisory: {
    type: "array",
    items: {
      properties: {
        description: { type: "string" },
        suggestion: { type: "string" }
      },
      required: ["description"]
    },
    description: "超出 AC/Plan 范围的建议 — 仅记录，不影响裁决"
  },
}
```

**改动 2：框架层面校验 verdict 与 issues 的一致性**

```typescript
// tribunal.ts 中，解析 verdict 后
if (verdict.verdict === "FAIL") {
  const blockingIssues = (verdict.issues ?? []).filter(
    (i: any) => i.severity === "P0" || i.severity === "P1"
  );
  if (blockingIssues.length === 0) {
    // FAIL 但没有 P0/P1 issues → 只有 advisory → 强制 override 为 PASS
    verdict.verdict = "PASS";
    overrideReason = "FAIL but no blocking issues in AC scope. Auto-overridden to PASS.";
  }
}
```

**改动 3：Checklist 增加范围约束**

每个 phase checklist 头部添加：

```markdown
> **审查范围限制：** 你只能基于 design.md 的 AC 和 plan.md 的 task 来判定 PASS/FAIL。
> 超出 AC/task 范围的发现请放入 advisory 字段，不要标为 P0/P1。
> issues 中的每条必须填写 acRef（AC 或 task 编号），填不出来的说明不在审查范围内。
```

**改动范围：**

| 文件 | 改动 |
|------|------|
| `tribunal-schema.ts` | 新增 `advisory` 字段，`issues` 增加 `acRef` 必填项 |
| `tribunal.ts` | 解析后交叉验证：FAIL + 无 P0/P1 → override 为 PASS |
| `tribunal-checklists.ts` | 每个 phase checklist 头部加范围限制 |

**对审查质量的影响：**

advisory 中的建议会被记录到 tribunal 日志，Phase 7 复盘可以回顾。但不再阻塞流程。

---

## 实施顺序建议

| 顺序 | Issue | 预估改动量 | 依赖 |
|------|-------|-----------|------|
| 1 | #9（删除 lesson 守卫） | ~20 行 | 无 |
| 2 | #5（一致性检测） | ~10 行 | 无 |
| 3 | #10（tribunal schema 拆分） | ~60 行 | 无 |
| 4 | #2（ESCALATE 断路器） | ~80 行 | 无 |

#9 和 #5 可以作为小任务直接改，#10 和 #2 建议走 auto-dev。
