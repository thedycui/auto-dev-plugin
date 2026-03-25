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
  6: 2,  // 验收
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
  isInteractive: boolean,
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

  // 1. 解析 header 获取 mode、stack（从 "Mode: full", "Stack: TypeScript" 提取）
  // 2. 解析所有 CHECKPOINT 获取最后的 phase、status、task
  // 3. 从文件系统重新检测 stack（调用 detectStack()）
  // 4. 组装 StateJson 并写入 state.json

  return rebuiltState;
}
```

**集成点**（`index.ts` auto_dev_init resume 分支）：

```ts
if (onConflict === "resume") {
  let state: StateJson;
  try {
    state = await sm.loadAndValidate();
  } catch (err) {
    // state.json 损坏 → 尝试从 progress-log 重建
    state = await sm.rebuildStateFromProgressLog();
    // 重建后清除 dirty flag
  }
  // ... 继续 resume 流程
}
```

**progress-log header 解析规则**：
```
> Started: 2026-03-19T06:57:00.000Z  → startedAt
> Mode: full                         → mode
> Stack: Java 8 (Maven)              → 触发 detectStack() 重新检测
```

**CHECKPOINT 解析规则**：
```
<!-- CHECKPOINT phase=4 status=PASS summary="..." timestamp=... -->
→ 最后一条的 phase + status 作为恢复点
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

**辅助函数**（`index.ts` 或 `state-manager.ts`）：

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

```ts
// computeNextDirective 增加 REGRESS 处理
if (status === "REGRESS") {
  const regressTo = /* 从 checkpoint 参数获取 */;
  if (!regressTo || regressTo >= currentPhase) {
    return { error: "regressTo must be < current phase" };
  }
  if ((state.regressionCount ?? 0) >= 2) {
    return {
      phaseCompleted: false,
      mandate: "[BLOCKED] 已达最大回退次数(2)。需要人工介入决定后续步骤。",
      canDeclareComplete: false,
    };
  }
  return {
    phaseCompleted: false,
    nextPhase: regressTo,
    nextPhaseName: PHASE_META[regressTo].name,
    mandate: `[REGRESS] Phase ${currentPhase} 要求回退到 Phase ${regressTo}。原因: ${summary}。` +
      ` 调用 auto_dev_preflight(phase=${regressTo}) 重新开始。`,
    canDeclareComplete: false,
  };
}
```

**checkpoint 集成**（`index.ts`）：
- 收到 `status=REGRESS` 时，校验 `regressTo` 参数
- 递增 `regressionCount`
- progress-log 记录回退事件：`<!-- CHECKPOINT phase=4 status=REGRESS regressTo=1 summary="接口签名需重设计" -->`
- state.json 更新 phase 为 regressTo

**安全约束**：
- `regressTo` 必须 < 当前 phase（Schema 不能直接约束，需运行时检查）
- `regressionCount >= 2` 时拒绝回退，返回 BLOCKED
- 回退不删除已有产出物，但在文件名加 `.v{N}` 后缀备份（如 `design.md` → `design.v1.md`）

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
