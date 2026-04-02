# Implementation Plan: orchestrator-ux-improvements

> 日期：2026-04-02
> 基于设计文档：`design.md`
> 总估算：170-200 行改动，5 个独立子改动

---

## Task 1: `StateJsonSchema` 新增 `lastFailureDetail` 字段

- **描述**: 在 `types.ts` 的 `StateJsonSchema` 中添加 `lastFailureDetail: z.string().nullable().optional()` 字段，使失败详情可持久化到 state.json。
- **文件**:
  - 修改: `mcp/src/types.ts`（第 203 行 `lastValidation` 字段后追加）
- **依赖**: 无
- **完成标准**: `StateJsonSchema` 包含 `lastFailureDetail` 字段，Zod 类型为 `string | null | undefined`，`StateJson` 推导类型同步更新，TypeScript 编译通过。

---

## Task 2: `NextTaskResult` 接口新增 `lastFailureDetail` 和 `tasks` 字段

- **描述**: 在 `orchestrator.ts` 的 `NextTaskResult` 接口（第 73 行）中添加两个可选字段：`lastFailureDetail?: string` 和 `tasks?: TaskInfo[]`。同时定义 `TaskInfo` 接口（包含 `taskNumber`、`title`、`description`、`files`、`dependencies` 字段）。
- **文件**:
  - 修改: `mcp/src/orchestrator.ts`（第 73-96 行 `NextTaskResult` 接口区域；在接口上方新增 `TaskInfo` 接口定义）
- **依赖**: Task 1（`StateJson` 类型需先更新，编译才不报错）
- **完成标准**: `NextTaskResult` 包含两个新可选字段，`TaskInfo` 接口定义完整，TypeScript 编译通过，现有调用方不受影响。

---

## Task 3: `handleValidationFailure` 填充 `lastFailureDetail`（含 `advanceToNextStep` 清除）

- **描述**: 在 `orchestrator.ts` 的 `handleValidationFailure` 中，覆盖设计文档定义的 4 条需填充路径：
  1. Tribunal FAIL under limit（第 1378-1392 行）：在 `atomicUpdate` 中追加 `lastFailureDetail: validation.feedback`，并在 return 对象中追加 `lastFailureDetail` 字段。
  2. 普通 revision 路径（第 1432-1451 行）：在 `atomicUpdate` 中追加 `lastFailureDetail: validation.feedback`，并在 return 对象中追加 `lastFailureDetail` 字段。
  3. `handlePhaseRegress`（第 1258-1277 行）：在 `atomicUpdate` 中追加 `lastFailureDetail: validation.feedback`。
  4. `handleCircuitBreaker` 内的 `CIRCUIT_BREAK` 和 `ALL_APPROACHES_EXHAUSTED` 路径：在各自 `atomicUpdate` 调用中追加 `lastFailureDetail`，并在 return 对象中追加该字段。
  同时在 `advanceToNextStep` 的 `atomicUpdate`（第 1474 行）中追加 `lastFailureDetail: null` 以在步骤推进时清除。
  **`handleTribunalEscalation` 路径（第 669-684 行）**：该路径走 tribunal 三次未通过后强制回退 Phase 3，属于 escalation 路径，state.json 已通过 `lastFeedback` 字段记录本次失败详情，**不需要额外填充 `lastFailureDetail`**。这是有意为之的设计决策：escalation 路径的失败上下文通过 `lastFeedback` 传递，`lastFailureDetail` 专用于非 escalation 的普通失败路径。
- **文件**:
  - 修改: `mcp/src/orchestrator.ts`（多处，见上述行号）
- **依赖**: Task 2（`NextTaskResult` 接口需先有 `lastFailureDetail` 字段）
- **完成标准**: 4 条 return 路径按设计文档全部覆盖（Tribunal iteration limit 路径通过 `escalation.lastFeedback` 传递，不单独填充；`handleTribunalEscalation` 回退路径属于 escalation 路径同理不填充，此决策已在描述中明确声明）；`advanceToNextStep` 清除逻辑就位；TypeScript 编译通过。

---

## Task 4: 新增 `parseTaskList` 函数并在 Step 3 **所有调用点**组装 `tasks`

- **描述**: 在 `orchestrator.ts` 中新增 `parseTaskList(planContent: string): TaskInfo[]` 函数，按 `## Task N` 分割 plan.md 内容，逐块提取 `taskNumber`、`title`、`description`、`files`（从"新建:"/"修改:"行提取路径）、`dependencies`（从"依赖: Task N"提取编号数组）。解析失败时返回空数组。`planContent` 为 null 时同样返回空数组（不抛出异常）。
  step "3" 的 `buildTaskForStep` 调用散布在以下 **3 处**，每处都需要在上层 return 对象中注入 `tasks`：
  1. **`resolveInitialStep`（约 line 1220）**：首次启动/首次进入 step "3" 的路径。当 `firstStep === "3"` 时，在调用 `buildTaskForStep(firstStep, ...)` 后，使用 `readFileSafe(join(outputDir, "plan.md"))` 读取 plan.md（返回 null 而非抛异常），调用 `parseTaskList(planContent)` 得到 `tasks`，注入到 return 对象。
  2. **`advanceToNextStep`（约 line 1554）**：上一个 step 验证通过后推进到 step "3" 的路径。当 `nextStep === "3"` 时，同样读取 plan.md 并注入 `tasks`。
  3. **`handleTribunalEscalation`（约 line 679）**：tribunal 三次失败强制回退 Phase 3 的路径。同样读取 plan.md 并注入 `tasks`（此路径 plan.md 已由 Phase 2 生成，`parseTaskList` 应成功）。
  三处均使用 `readFileSafe`（而非 `readFile`）以与 `buildTaskForStep` 内部实现保持一致，避免 plan.md 不存在时抛出异常。不修改 `buildTaskForStep` 函数签名。
  注意：`buildTaskForStep` 内部已有 `readFileSafe` + `extractTaskDetails` 调用（line ~1082-1115），本 Task 的上层独立读取是已知权衡（设计文档 4.3 节已承认"不修改 buildTaskForStep 签名"），两次 IO 读取均使用 `readFileSafe`，plan.md 不存在时均能降级。
- **文件**:
  - 修改: `mcp/src/orchestrator.ts`（新增 `parseTaskList` 函数；修改上述 3 处 return 组装点）
- **依赖**: Task 2（`TaskInfo` 和 `NextTaskResult` 接口需先就绪）
- **完成标准**:
  - `buildTaskForStep` 签名保持 `Promise<string>` 不变；
  - `tasks` 字段在 step "3" 的 **全部 3 个 return 路径**中均出现（`resolveInitialStep`、`advanceToNextStep`、`handleTribunalEscalation`），非 step "3" 的路径不携带 `tasks`；
  - `prompt` 字段仍返回完整任务描述（向后兼容）；
  - `parseTaskList` 在 planContent 为 null、空字符串、无 `## Task N` 块时返回空数组，不抛出异常；
  - 上层读取 plan.md 使用 `readFileSafe`（返回 null 而非抛异常）；
  - TypeScript 编译通过。

---

## Task 5: Tribunal Digest 注入变更规模信号

- **描述**: 在 `tribunal.ts` 中新增 `parseDiffSummary(summaryLine: string): { files: number; insertions: number; deletions: number }` 函数，解析 `"N files changed, M insertions(+), K deletions(-)"` 格式（处理只有增/只有删的边界情况）。
  在 `prepareTribunalInput` 函数（第 148 行）的 `## 框架统计` 章节写入后、`## 关键代码变更` 写入前（约第 215-225 行之间），注入 `## 变更规模` 章节：提取 `diffStat` 最后一个非空行作为 summaryLine，调用 `parseDiffSummary` 得到数值，计算 `totalLines = insertions + deletions`，按 LOW（≤100）/MEDIUM（101-500）/HIGH（>500）三档输出规模信号和对应审查指令。同时，HIGH 时将第 225 行 `getKeyDiff(projectRoot, startCommit, 300)` 的 budget 改为 500。整个注入逻辑用 try-catch 包裹，失败时静默跳过。
- **文件**:
  - 修改: `mcp/src/tribunal.ts`（新增 `parseDiffSummary` 函数；修改 `prepareTribunalInput` 约第 215-226 行区域）
- **依赖**: 无
- **完成标准**: `parseDiffSummary` 正确解析标准 git summary 行；700+ 行变更时 digest 包含 `HIGH` 字样和"必须逐文件审查"指令，getKeyDiff budget 为 500；50 行以内变更时 digest 包含 `LOW` 字样且不含"必须逐文件审查"；解析失败时不抛出异常；TypeScript 编译通过。

---

## Task 6: 新增 `auto_dev_reset` MCP 工具

- **描述**: 在 `index.ts` 中注册新工具 `auto_dev_reset`，工具接收 `{ projectRoot, topic, targetPhase, reason }` 参数。实现逻辑：加载 state.json，按顺序做以下校验（任一失败立即返回错误，不修改 state）：
  1. `status === "COMPLETED"` 时返回错误
  2. `targetPhase > state.phase` 时返回错误（禁止前跳）
  3. `reason` 为空字符串时返回错误
  4. `targetPhase` 不在 `PHASE_SEQUENCE[state.mode]` 时返回错误
  校验通过后重置字段（`phase`、`status`、`step`、`stepIteration`、`lastValidation`、`lastFailureDetail`、`approachState`）；用 `parseInt(k) >= targetPhase` 过滤 `tribunalSubmits` 和 `phaseEscalateCount`；追加 progress-log 审计行 `<!-- RESET phase=N reason="..." timestamp=... -->`；调用 `sm.atomicUpdate()` 写入。工具注册位置：紧随现有最后一个 `server.tool(...)` 之后，或在 `auto_dev_next`（第 2075 行）之前的合适位置。
- **文件**:
  - 修改: `mcp/src/index.ts`（新增约 50 行 handler）
- **依赖**: Task 1（`StateJson` 需包含 `lastFailureDetail` 字段），Task 3（`firstStepForPhase` 已在 orchestrator.ts 中导出，确认可用）
- **完成标准**:
  - 工具在 MCP 服务器中可被调用；
  - `step` 字段必须使用 `firstStepForPhase(targetPhase)` 设置（**而非** `String(targetPhase)`），两者在 phase=3 时结果相同但在其他 phase 不同；
  - `targetPhase=3` 时 state.json 中 `phase=3`、`step="3"`（`firstStepForPhase(3)` 结果）、`stepIteration=0`、`lastValidation=null`、`lastFailureDetail=null`；
  - `targetPhase=1` 时 `step="1a"`（而非 `"1"`），验证 `firstStepForPhase` 被正确使用；
  - `targetPhase=2` 时 `step="2a"`（而非 `"2"`），同上；
  - `tribunalSubmits` 和 `phaseEscalateCount` 中 key >= targetPhase 的条目被清除，key < targetPhase 的条目保留；
  - progress-log 包含 `RESET phase=N` 标记；
  - 三个负向校验（COMPLETED、前跳、空 reason）均返回错误且不修改 state；
  - 确认 `firstStepForPhase` 已从 `./orchestrator.js` 导入（`index.ts` 当前仅导入 `computeNextTask`，需补充 import）；
  - TypeScript 编译通过。

---

## Task 7: 单元测试 — `parseTaskList` 和 `parseDiffSummary`

- **描述**: 在现有测试文件中为两个新纯函数编写单元测试。
  - `parseTaskList` 测试（在 `orchestrator.test.ts` 或新建 `improvements.test.ts` 中）：验证 AC-5（tasks 长度与 `## Task N` 块数量相等）、AC-6（`files` 提取正确）、AC-7（`dependencies` 提取正确）；边界情况：plan.md 为空、无 Task 块、Task 块无"依赖"行。
  - `parseDiffSummary` + digest 注入测试（在 `tribunal.test.ts` 中）：验证 AC-8（700+ 行时含 HIGH 字样和"必须逐文件审查"）、AC-9（50 行时含 LOW 字样，不含"必须逐文件审查"）；边界情况：只有 insertions 无 deletions、summary 行格式不标准时不抛出。
  注意：`parseTaskList` 和 `parseDiffSummary` 如果未导出，需在此任务中同步调整导出方式（或通过 `prepareTribunalInput` 的集成路径测试）。
- **文件**:
  - 修改: `mcp/src/__tests__/orchestrator.test.ts` 或 `mcp/src/__tests__/improvements.test.ts`
  - 修改: `mcp/src/__tests__/tribunal.test.ts`
- **依赖**: Task 4（`parseTaskList` 函数需已存在），Task 5（`parseDiffSummary` 函数需已存在）
- **完成标准**: AC-5、AC-6、AC-7、AC-8、AC-9 对应的测试用例全部通过；边界情况测试通过；`npm test` 无新增失败。

---

## Task 8: 单元测试 — `auto_dev_reset` 行为验证

- **描述**: 在 `orchestrator.test.ts` 或新建测试文件中，为 `auto_dev_reset` 的核心行为编写测试（通过直接测试 handler 逻辑或通过 state 断言）：
  - AC-1：`targetPhase=3` 后 state 字段正确（phase/step/stepIteration/lastValidation/lastFailureDetail），progress-log 包含 RESET 标记。
  - AC-2：`targetPhase > currentPhase` 时返回错误，state 不变。
  - AC-3：`status=COMPLETED` 时返回错误。
  - AC-13：`tribunalSubmits` 和 `phaseEscalateCount` 中 key >= targetPhase 的条目被清除，key < targetPhase 的条目保留。
- **文件**:
  - 修改或新建: `mcp/src/__tests__/orchestrator.test.ts`（或适当位置）
- **依赖**: Task 6（`auto_dev_reset` 工具需已实现）
- **完成标准**: AC-1、AC-2、AC-3、AC-13 对应测试全部通过；补充 AC-13+ 测试：`targetPhase=1` 时断言 `step="1a"`（而非 `"1"`），`targetPhase=2` 时断言 `step="2a"`，确认 `firstStepForPhase` 而非 `String(targetPhase)` 被使用；`npm test` 无新增失败。

---

## Task 9: 单元测试 — `handleValidationFailure` 的 `lastFailureDetail` 填充

- **描述**: 在 `orchestrator.test.ts` 中补充测试，验证 `handleValidationFailure` 各路径正确填充 `lastFailureDetail`：
  - AC-4：Step 5b Tribunal FAIL 后 `auto_dev_next` 返回 `lastFailureDetail` 非空，与 `validation.feedback` 一致。
  - AC-14：`regressToPhase` 路径触发后，state.json 中 `lastFailureDetail` 为非空字符串。
  - AC-15：`ALL_APPROACHES_EXHAUSTED` 路径触发后，state.json 中 `lastFailureDetail` 非空，status 为 "BLOCKED"。
  - AC-11：Step 3 `auto_dev_next` 的 `prompt` 字段内容与无 `tasks` 字段时保持一致（向后兼容）。
  - AC-12：`buildTaskForStep` 签名仍为 `Promise<string>`（代码审查形式，可通过 TypeScript 类型检查验证）。
- **文件**:
  - 修改: `mcp/src/__tests__/orchestrator.test.ts`
- **依赖**: Task 3（`lastFailureDetail` 填充逻辑），Task 4（Step 3 `tasks` 组装）
- **完成标准**: AC-4、AC-11、AC-12、AC-14、AC-15 对应测试全部通过；`npm test` 无新增失败。

---

## 执行顺序总结

```
Task 1 (types.ts schema)
  └─> Task 2 (NextTaskResult + TaskInfo 接口)
        ├─> Task 3 (handleValidationFailure 填充)  ──> Task 9 (测试)
        ├─> Task 4 (parseTaskList + Step 3 组装)   ──> Task 7 (测试)
        └─> Task 6 (auto_dev_reset 工具)            ──> Task 8 (测试)
Task 5 (tribunal 规模信号，独立)                   ──> Task 7 (测试)
```

Task 1 → Task 2 必须串行。Task 3、4、5、6 可并行。Task 7、8、9 在各自依赖完成后执行。

---

## 文件变更清单（汇总）

| 文件 | 任务 | 变更类型 |
|------|------|---------|
| `mcp/src/types.ts` | Task 1 | 新增 3 行 |
| `mcp/src/orchestrator.ts` | Task 2、3、4 | 新增接口、填充字段、新增函数 |
| `mcp/src/tribunal.ts` | Task 5 | 新增函数、修改注入逻辑 |
| `mcp/src/index.ts` | Task 6 | 新增约 50 行 handler |
| `mcp/src/__tests__/tribunal.test.ts` | Task 7 | 新增测试用例 |
| `mcp/src/__tests__/orchestrator.test.ts` | Task 8、9 | 新增测试用例 |
