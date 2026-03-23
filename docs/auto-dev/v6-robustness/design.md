# auto-dev v6.0 健壮性增强设计文档

## 概述

基于 auto-dev 文章评审反馈和实际运行中发现的 5 个架构级缺陷，对 auto-dev 插件进行健壮性增强。

**改动范围**：MCP Server 核心（phase-enforcer.ts、index.ts、state-manager.ts、types.ts）
**不改动**：Agent 定义文件、SKILL.md、prompt 模板（本次聚焦机制层）

---

## AC（验收标准）

- AC-1: checkpoint 支持 iteration 上限检测，超限后根据 interactive 模式决定行为（BLOCKED 或 FORCED_PASS）
- AC-2: resume 流程能从 progress-log 重建 state.json，即使 state.json 损坏或缺失
- AC-3: preflight 在 Phase 3+ 自动注入 design.md 摘要和 plan.md 任务列表到 suggestedPrompt 的 extraContext
- AC-4: checkpoint 支持 REGRESS status，允许回退到更早的 Phase，最多 2 次全流程回退
- AC-5: 所有新增功能有对应的单元测试
- AC-6: 现有测试不被破坏（npm test 全部通过）

---

## 改动项 1：审查迭代死循环防护（AC-1）

### 问题

当前审查最多 3 轮仅在 SKILL.md 中文字约束，checkpoint 不做迭代次数校验。AI 可能无限 NEEDS_REVISION。

### 设计

在 `phase-enforcer.ts` 中新增 `MAX_ITERATIONS_PER_PHASE` 常量和校验逻辑。

```ts
// phase-enforcer.ts 新增
const MAX_ITERATIONS_PER_PHASE: Record<number, number> = {
  1: 3,  // 设计审查
  2: 3,  // 计划审查
  3: 2,  // 每个 task（已有逻辑，此处为文档化）
  4: 3,  // 代码审查
  5: 3,  // 测试
  // Phase 6 不设迭代上限：验收要么 PASS 要么 BLOCKED 等人工介入，不存在 NEEDS_REVISION 迭代
};

export interface IterationCheckResult {
  allowed: boolean;
  exceeded: boolean;
  currentIteration: number;
  maxIteration: number;
  action: "CONTINUE" | "FORCE_PASS" | "BLOCK";
  message: string;
}

export function checkIterationLimit(
  phase: number,
  currentIteration: number,
  isInteractive: boolean,  // state.interactive ?? false（undefined 视为非 interactive）
): IterationCheckResult;
```

**行为**：
- `iteration < max`：正常继续
- `iteration >= max && interactive=true`：返回 `action: "BLOCK"`，等用户确认
- `iteration >= max && interactive=false`：返回 `action: "FORCE_PASS"`，强制通过 + 记录 warning 到 lessons

**checkpoint 集成**（`index.ts`）：
- 在 checkpoint 收到 `status=NEEDS_REVISION` 时，调用 `checkIterationLimit`
- 如果 `action=FORCE_PASS`，覆写 status 为 PASS，在 progress-log 中记录 `[FORCED_PASS: iteration limit exceeded]`
- 如果 `action=BLOCK`，返回 BLOCKED 并生成 mandate 让用户决定

**state.json 变更**：无。已有 `iteration` 字段。但 checkpoint 需要在 NEEDS_REVISION 时自动递增 iteration。

---

## 改动项 2：progress-log 重建 state.json（AC-2）

### 问题

当前 resume 依赖 state.json 完好。如果 state.json 损坏（dirty=true 或文件缺失），恢复流程无法继续。

### 设计

在 `state-manager.ts` 中新增 `rebuildStateFromProgressLog` 方法。

```ts
// state-manager.ts 新增
async rebuildStateFromProgressLog(): Promise<StateJson> {
  const content = await readFile(this.progressLogPath, "utf-8");

  // 1. 解析 header
  const startedAt = parseHeaderField(content, "Started") ?? new Date().toISOString();
  const modeStr = parseHeaderField(content, "Mode") ?? "full";
  const mode = (modeStr === "quick" ? "quick" : "full") as "full" | "quick";

  // 2. 解析所有 CHECKPOINT 获取最后的 phase、status、task
  const checkpoints = parseAllCheckpoints(content);
  const last = checkpoints[checkpoints.length - 1];
  const phase = last?.phase ?? 1;
  const status = last?.status ?? "IN_PROGRESS";

  // 3. 从文件系统重新检测 stack（调用 detectStack()）
  const stack = await this.detectStack();

  // 4. 组装 StateJson — 必需字段完整映射表：
  const rebuilt: StateJson = {
    topic: this.topic,               // ← 从 StateManager 实例属性获取
    mode,                            // ← 从 header "Mode:" 解析
    phase,                           // ← 从最后一条 CHECKPOINT 解析
    status: status as any,           // ← 从最后一条 CHECKPOINT 解析
    stack,                           // ← 从 detectStack() 重新检测
    outputDir: this.outputDir,       // ← 从 StateManager 实例属性获取
    projectRoot: this.projectRoot,   // ← 从 StateManager 实例属性获取
    startedAt,                       // ← 从 header "Started:" 解析
    updatedAt: new Date().toISOString(),
  };

  // 5. 写入 state.json（无 dirty flag，这是全新重建）
  await this.atomicWrite(this.stateFilePath, JSON.stringify(rebuilt, null, 2));
  return rebuilt;
}

// 辅助：解析 progress-log header 中的字段
function parseHeaderField(content: string, field: string): string | null {
  const regex = new RegExp(`>\\s*${field}:\\s*(.+?)\\s*$`, "m");
  const match = content.match(regex);
  return match ? match[1].trim() : null;
}
```

**集成点**（`index.ts` auto_dev_init resume 分支）：

```ts
if (onConflict === "resume") {
  let state: StateJson;
  try {
    state = await sm.loadAndValidate();
  } catch (err) {
    const errMsg = (err as Error).message;
    if (errMsg.includes("dirty")) {
      // [P1-2 修复] dirty 的修复比重建更轻量
      // 尝试直接读取 state.json 清除 dirty 后 re-validate
      try {
        const raw = JSON.parse(await readFile(sm.stateFilePath, "utf-8"));
        raw.dirty = false;
        raw.updatedAt = new Date().toISOString();
        await sm.atomicWrite(sm.stateFilePath, JSON.stringify(raw, null, 2));
        state = await sm.loadAndValidate();
      } catch {
        // dirty 修复也失败 → 降级到重建
        state = await sm.rebuildStateFromProgressLog();
      }
    } else {
      // state.json 损坏/缺失 → 从 progress-log 重建
      state = await sm.rebuildStateFromProgressLog();
    }
  }
  // ... 继续 resume 流程
}
```

**progress-log header 解析规则**（容错处理：允许额外空格/换行）：
```
> Started: 2026-03-19T06:57:00.000Z  → startedAt（parseHeaderField 已 trim）
> Mode: full                         → mode（非 "quick" 一律视为 "full"）
> Stack: Java 8 (Maven)              → 忽略，由 detectStack() 重新检测
```

**CHECKPOINT 解析规则**：
```
<!-- CHECKPOINT phase=4 status=PASS summary="..." timestamp=... -->
→ 最后一条的 phase + status 作为恢复点
→ 多条 CHECKPOINT（PASS + NEEDS_REVISION 混合）取最后一条
```

---

## 改动项 3：preflight 自动注入前序产出物摘要（AC-3）

### 问题

Phase 3+ 的 Agent 需要自行读取 design.md 和 plan.md，增加 token 消耗且关键设计决策可能被忽略。

### 设计

修改 `index.ts` 中 `auto_dev_preflight` 工具，在 Phase 3+ 自动提取前序产出物摘要并注入 `extraContext`。

```ts
// index.ts preflight 工具增强
if (ready && phase >= 3) {
  let extraContext = "";

  // 注入 design.md 摘要（取前 80 行或 ## 概述 / ## Summary 段落）
  try {
    const designContent = await readFile(join(outputDir, "design.md"), "utf-8");
    const summary = extractDocSummary(designContent, 80);
    extraContext += `## 设计摘要（自动注入）\n\n${summary}\n\n`;
  } catch { /* design.md 不存在，跳过 */ }

  // 注入 plan.md 任务列表（只提取 task 编号和标题行）
  if (phase === 3) {
    try {
      const planContent = await readFile(join(outputDir, "plan.md"), "utf-8");
      const taskList = extractTaskList(planContent);
      extraContext += `## 任务列表（自动注入）\n\n${taskList}\n\n`;
    } catch { /* plan.md 不存在，跳过 */ }
  }

  if (extraContext) {
    // 重新渲染 prompt，带上 extraContext
    const rendered = await renderer.render(mapping.promptFile, variables, extraContext);
    result.suggestedPrompt = rendered.renderedPrompt;
  }
}
```

**辅助函数**（放在 `state-manager.ts` 中，避免 index.ts 继续膨胀）：

```ts
function extractDocSummary(content: string, maxLines: number): string {
  // 优先找 ## 概述 或 ## Summary 段落
  // 如果没有，取前 maxLines 行
}

function extractTaskList(content: string): string {
  // 提取 "### Task N:" 或 "- [ ] Task N:" 行
  // 返回编号+标题的简洁列表
}
```

**集成点说明**：新逻辑完全替换 `index.ts` L434-L443 的 `if (mapping) { ... }` 块，而非追加。

---

## 改动项 4：Phase 间回滚——REGRESS status（AC-4）

### 问题

当前 Phase 只能前进，不能后退。Phase 4 发现设计级问题时，应该能回退到 Phase 1 重新设计。

### 设计

**Schema 变更**（`types.ts`）：

```ts
// PhaseStatusSchema 新增
export const PhaseStatusSchema = z.enum([
  "IN_PROGRESS",
  "PASS",
  "NEEDS_REVISION",
  "BLOCKED",
  "COMPLETED",
  "REGRESS",  // 新增：回退到更早的 Phase
]);

// CheckpointInputSchema 新增可选字段
export const CheckpointInputSchema = z.object({
  phase: z.number().int(),
  task: z.number().int().optional(),
  status: PhaseStatusSchema,
  summary: z.string().optional(),
  tokenEstimate: z.number().optional(),
  regressTo: z.number().int().min(1).max(5).optional(), // 仅 REGRESS 时使用
});
```

**StateJson 新增字段**：

```ts
// StateJsonSchema 新增
regressionCount: z.number().int().optional(),  // 全流程回退计数
```

**phase-enforcer.ts 变更**：

> **[P0-1 修复]** REGRESS 分支必须放在现有的 `status !== "PASS" && status !== "COMPLETED"` 守卫**之前**，否则会被拦截。
> **[P0-3 修复]** `computeNextDirective` 签名新增 `regressTo?: number` 参数。

```ts
// computeNextDirective 签名变更
export function computeNextDirective(
  currentPhase: number,
  status: string,
  state: StateJson,
  regressTo?: number,  // 新增：仅 REGRESS 时传入
): NextDirective {

  // ★ REGRESS 分支必须在守卫之前（修复 P0-1）
  if (status === "REGRESS") {
    if (!regressTo || regressTo >= currentPhase) {
      return {
        phaseCompleted: false,
        nextPhase: currentPhase,
        nextPhaseName: PHASE_META[currentPhase]?.name ?? `Phase ${currentPhase}`,
        mandate: `[ERROR] regressTo(${regressTo}) 必须小于当前 phase(${currentPhase})。`,
        canDeclareComplete: false,
      };
    }
    if ((state.regressionCount ?? 0) >= 2) {
      return {
        phaseCompleted: false,
        nextPhase: currentPhase,
        nextPhaseName: PHASE_META[currentPhase]?.name ?? `Phase ${currentPhase}`,
        mandate: "[BLOCKED] 已达最大回退次数(2)。需要人工介入决定后续步骤。",
        canDeclareComplete: false,
      };
    }
    return {
      phaseCompleted: false,
      nextPhase: regressTo,
      nextPhaseName: PHASE_META[regressTo]?.name ?? `Phase ${regressTo}`,
      mandate: `[REGRESS] Phase ${currentPhase} 要求回退到 Phase ${regressTo} (${PHASE_META[regressTo]?.description ?? ""})。` +
        ` 调用 auto_dev_preflight(phase=${regressTo}) 重新开始。`,
      canDeclareComplete: false,
    };
  }

  // 原有守卫（非 PASS/COMPLETED 状态不推进）
  if (status !== "PASS" && status !== "COMPLETED") { ... }
```

> **注意**：REGRESS 返回的 `phaseCompleted: false` 但 `nextPhase !== currentPhase`，这打破了原有语义。消费方（Claude Agent）通过 mandate 文本判断行为，不依赖 `phaseCompleted` + `nextPhase` 的组合语义，因此兼容。

**checkpoint 集成**（`index.ts`）：

> **[P0-2 修复]** checkpoint 工具的内联 status enum 必须同步添加 `"REGRESS"`，并新增 `regressTo` 参数。

```ts
// index.ts checkpoint 工具注册 — 修改 status 和新增 regressTo
server.tool(
  "auto_dev_checkpoint",
  "...",
  {
    projectRoot: z.string(),
    topic: z.string(),
    phase: z.number(),
    task: z.number().optional(),
    status: z.enum(["IN_PROGRESS", "PASS", "NEEDS_REVISION", "BLOCKED", "COMPLETED", "REGRESS"]),  // ★ 新增 REGRESS
    summary: z.string().optional(),
    tokenEstimate: z.number().optional(),
    regressTo: z.number().int().min(1).max(5).optional(),  // ★ 新增
  },
  async ({ projectRoot, topic, phase, task, status, summary, tokenEstimate, regressTo }) => {
    // ...

    // REGRESS 特殊处理
    if (status === "REGRESS") {
      if (!regressTo) {
        return textResult({ error: "REGRESS requires regressTo parameter" });
      }
      // 递增 regressionCount
      const newCount = (state.regressionCount ?? 0) + 1;
      // ★ [P1-4 修复] 回退后重置 iteration 为 0
      stateUpdates["regressionCount"] = newCount;
      stateUpdates["iteration"] = 0;
      // 备份当前产出物（使用时间戳后缀，与 backupExistingDir 策略一致）
      // 如 design.md → design.bak.2026-03-23T04-09-04.md
    }

    // 传递 regressTo 到 computeNextDirective
    const nextDirective = computeNextDirective(phase, status, state, regressTo);
    // ...
  }
);
```

**安全约束**：
- `regressTo` 必须 < 当前 phase（`computeNextDirective` 内运行时检查）
- `regressionCount >= 2` 时拒绝回退，返回 BLOCKED（`computeNextDirective` 内检查）
- **[P1-4 修复]** 回退时 `iteration` 重置为 0，防止回退后立即触发迭代上限
- 回退不删除已有产出物，使用时间戳后缀备份（与 `backupExistingDir` 策略一致，避免 `.v{N}` 的计数冲突问题）

---

## 改动项 5：单元测试（AC-5、AC-6）

### 测试文件

在 `mcp/src/__tests__/` 下新增测试文件：

```
mcp/src/__tests__/
  ├── improvements.test.ts        # 已有
  ├── iteration-limit.test.ts     # 新增：改动项 1
  ├── state-rebuild.test.ts       # 新增：改动项 2
  ├── preflight-context.test.ts   # 新增：改动项 3
  └── regress.test.ts             # 新增：改动项 4
```

### 测试用例概要

**iteration-limit.test.ts**：
- 正常迭代（iteration < max）→ 允许继续
- 超限 + interactive → 返回 BLOCK
- 超限 + 非 interactive → 返回 FORCE_PASS
- 不同 phase 有不同上限

**state-rebuild.test.ts**：
- 正常 progress-log → 正确解析 phase/status/mode
- 无 CHECKPOINT 的 progress-log → 返回 phase=1, IN_PROGRESS
- progress-log 不存在 → 抛出明确错误
- progress-log header 有额外空格/换行 → 正确容错解析
- 多条 CHECKPOINT（PASS + NEEDS_REVISION 混合）→ 取最后一条
- dirty state.json + 正常 progress-log → 优先 dirty 修复，不走重建

**preflight-context.test.ts**：
- Phase 3 preflight → suggestedPrompt 包含 design 摘要和 task 列表
- Phase 4 preflight → suggestedPrompt 包含 design 摘要（不含 task 列表）
- design.md 不存在 → 跳过注入，不报错

**regress.test.ts**：
- REGRESS + 有效 regressTo → 返回正确的 nextPhase 和 mandate
- REGRESS + regressTo >= currentPhase → 拒绝
- REGRESS + regressionCount=2 → 返回 BLOCKED
- REGRESS 后 state.phase 更新为 regressTo

---

## 文件影响清单

| 文件 | 改动类型 | 改动项 |
|---|---|---|
| `mcp/src/types.ts` | 修改 | #4: PhaseStatusSchema + CheckpointInputSchema + StateJsonSchema |
| `mcp/src/phase-enforcer.ts` | 修改 | #1: iteration limit, #4: REGRESS 处理 |
| `mcp/src/state-manager.ts` | 修改 | #2: rebuildStateFromProgressLog |
| `mcp/src/index.ts` | 修改 | #1: checkpoint 集成, #2: resume 集成, #3: preflight 增强, #4: REGRESS 集成 |
| `mcp/src/__tests__/iteration-limit.test.ts` | 新增 | #5 |
| `mcp/src/__tests__/state-rebuild.test.ts` | 新增 | #5 |
| `mcp/src/__tests__/preflight-context.test.ts` | 新增 | #5 |
| `mcp/src/__tests__/regress.test.ts` | 新增 | #5 |

---

## 向后兼容性

- 所有新增字段（`regressTo`、`regressionCount`）都是 `.optional()`
- `PhaseStatusSchema` 新增 `REGRESS` 不影响已有 status 的处理
- `FORCE_PASS` 不是新 status，而是在 checkpoint 内部将 NEEDS_REVISION 覆写为 PASS
- 已有 state.json 不含新字段时，通过 `.optional()` 兼容
- 现有测试不受影响

## 实施顺序

1. types.ts（Schema 变更，基础依赖）
2. phase-enforcer.ts（迭代限制 + REGRESS 逻辑）
3. state-manager.ts（rebuild 方法）
4. index.ts（三个工具的集成变更）
5. 测试文件（4 个新增）
