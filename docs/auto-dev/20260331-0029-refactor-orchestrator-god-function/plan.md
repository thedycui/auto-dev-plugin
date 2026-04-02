# Implementation Plan: refactor-orchestrator-god-function

基于设计文档方案 B（职责域拆分 + 消除重复），将 `computeNextTask` 从 512 行拆分为职责单一的子函数。

---

## Task 1: 在 types.ts 中新增 ApproachState Zod Schema

- **描述**: 在 `mcp/src/types.ts` 中新增 `ApproachEntrySchema`、`FailedApproachSchema`、`ApproachStateSchema` 三个 Zod schema，暂不修改 `StateJsonSchema.approachState` 字段（留到 Task 7）
- **文件**:
  - `mcp/src/types.ts` — 新增 3 个 schema 定义 + 导出对应 TypeScript 类型
- **依赖**: 无
- **完成标准**:
  - `ApproachStateSchema` 可以成功 parse 符合 `ApproachState` 接口的对象
  - `ApproachStateSchema` 对缺失必要字段的对象 parse 失败
  - 类型导出 `ApproachState`（`z.infer<typeof ApproachStateSchema>`）与 orchestrator.ts 中现有接口字段一致

## Task 2: 在 orchestrator.ts 中定义 OrchestratorContext 接口

- **描述**: 在 `mcp/src/orchestrator.ts` 中新增 `OrchestratorContext` 接口，包含 `sm`、`state`、`outputDir`、`projectRoot`、`effectiveCodeRoot`、`topic`、`buildCmd`、`testCmd`、`phases`、`skipSteps`、`getExtraVars` 字段。在 `computeNextTask` 入口处构建 `ctx` 对象，但暂不使用（仅声明）
- **文件**:
  - `mcp/src/orchestrator.ts` — 新增接口定义 + 在 computeNextTask 中构建 ctx 对象
- **依赖**: 无
- **完成标准**:
  - `OrchestratorContext` 接口已定义且导出
  - `computeNextTask` 中在状态加载后构建了 `ctx` 对象
  - 现有全部测试通过（无回归）

## Task 3: 改造 5 个已有 tribunal 处理函数签名为 OrchestratorContext

- **描述**: 将 `handleTribunalCrash`、`handleTribunalSubagent`、`handleTribunalParseFailure`、`handleTribunalCrashEscalation`、`handleTribunalEscalation` 的散装参数改为接收 `ctx: OrchestratorContext` 作为第一参数，加上各自必需的额外参数（`phaseKey`、`count`、`currentStep`、`tribunalResult` 等）。函数内部从 `ctx` 取 `sm`、`state`、`outputDir` 等
- **文件**:
  - `mcp/src/orchestrator.ts` — 修改 5 个函数签名及函数体内的变量引用（Line 485-650）
- **依赖**: Task 2
- **完成标准**:
  - 5 个函数均接收 `ctx: OrchestratorContext` 作为第一参数
  - 函数内部不再有 `sm`、`state`、`outputDir` 等独立参数，全部从 `ctx` 获取
  - `handleTribunalEscalation` 内部调用 `buildTaskForStep` 时，通过 `ctx.getExtraVars(step)` 传递 `extraVars` 参数，与 `computeNextTask` 内联代码行为一致（当前 escalation 目标 phase 为 3，`getExtraVars("3")` 返回 `undefined`，但签名必须保持一致以防未来 escalation 目标变更）
  - 现有全部测试通过（这些函数当前未被 computeNextTask 调用，因此签名修改不影响现有逻辑）

## Task 4: 替换 computeNextTask 中 tribunal 内联代码为已有函数调用

- **描述**: 将 `computeNextTask` Line 1165-1303 的 4 段内联 tribunal 处理代码替换为对 `handleTribunalSubagent`、`handleTribunalParseFailure`、`handleTribunalCrashEscalation`、`handleTribunalEscalation` 的调用（传入 `ctx`）。逐段替换，确保每段的行为与已有函数完全一致
- **文件**:
  - `mcp/src/orchestrator.ts` — 修改 computeNextTask 中 tribunal failure 分支（约删除 140 行内联代码，替换为 4 个函数调用）
- **依赖**: Task 3
- **完成标准**:
  - `computeNextTask` 中不再有与 5 个已提取函数重复的内联 tribunal 处理代码
  - 搜索 `tribunal_subagent`、`tribunal_parse_failure`、`tribunal_crashed` 字符串，确认仅出现在提取函数和常量定义中
  - 替换后的每个函数调用路径中，`buildTaskForStep` 的 `extraVars` 参数与原内联代码行为一致（通过 `ctx.getExtraVars(step)` 传递）
  - tribunal failure、tribunal crash escalation 路径有 console.error 日志输出，包含 step 和 phase 信息（覆盖 AC-10）
  - 现有全部 tribunal 相关测试通过

## Task 5: 提取 resolveInitialStep 函数

- **描述**: 将 `computeNextTask` Line 1054-1146（`!stepState.step` 分支）提取为独立的 `resolveInitialStep(ctx: OrchestratorContext, stepState: StepState): Promise<NextTaskResult>` 函数。包含 PASS 推进、design doc 合规跳过、正常首次启动三个子路径。`computeNextTask` 中替换为 `return resolveInitialStep(ctx, stepState)`
- **文件**:
  - `mcp/src/orchestrator.ts` — 新增 `resolveInitialStep` 函数 + 修改 computeNextTask 调用点
- **依赖**: Task 4（确保 tribunal 替换完成后再动其他代码段，减少合并冲突）
- **完成标准**:
  - `resolveInitialStep` 函数不超过 100 行
  - `computeNextTask` 中 `!stepState.step` 分支缩减为单行 return 调用
  - 现有首次启动相关测试通过

## Task 6: 提取 handleValidationFailure 和 advanceToNextStep 函数

- **描述**:
  - 提取 `handleValidationFailure(ctx: OrchestratorContext, stepState: StepState, validation: ValidationResult): Promise<NextTaskResult>` — 覆盖 Line 1156-1431 的全部验证失败分支（tribunal 调用 + regressToPhase + circuit breaker + iteration limit + revision）
  - 提取 `advanceToNextStep(ctx: OrchestratorContext, currentStep: string, validation: ValidationResult): Promise<NextTaskResult>` — 覆盖 Line 1433-1514 的验证通过分支（progress log + TDD 门控 + 步骤推进/完成）
  - `computeNextTask` 验证结果分发缩减为 `if (!validation.passed) return handleValidationFailure(ctx, stepState, validation)` + `return advanceToNextStep(ctx, currentStep, validation)`
- **文件**:
  - `mcp/src/orchestrator.ts` — 新增 2 个函数 + 修改 computeNextTask 调用点
- **依赖**: Task 5
- **完成标准**:
  - `handleValidationFailure` 函数不超过 150 行（内部调用已有 tribunal 函数，自身逻辑较多）
  - **拆分预案**: 如果 `handleValidationFailure` 超过 150 行，将 `regressToPhase` 逻辑（约 36 行）和 circuit breaker 逻辑（约 33 行）进一步提取为独立函数 `handlePhaseRegress(ctx, ...)` 和 `handleCircuitBreaker(ctx, ...)`，使 `handleValidationFailure` 回到 100 行以内
  - `advanceToNextStep` 函数不超过 80 行
  - `computeNextTask` 总函数体不超过 100 行（不含空行和注释）
  - circuit breaker 触发、phase regress 路径有 console.error 日志输出，包含 step 和 phase 信息（覆盖 AC-10）
  - 现有全部测试通过

## Task 7: 将 StateJsonSchema.approachState 替换为 ApproachStateSchema

- **描述**: 将 `types.ts` 中 `StateJsonSchema` 的 `approachState` 字段从 `z.any().nullable().optional()` 改为 `ApproachStateSchema.nullable().optional().catch(undefined)`。删除 `orchestrator.ts` 中的 `ApproachState` 接口定义（Line 253-258），改为从 `types.ts` 导入。同时删除 `orchestrator-prompts.ts` 中的 `ApproachEntry`/`FailedApproach` 类型导入（如果 types.ts 已导出同名类型，统一从 types.ts 导入）
- **文件**:
  - `mcp/src/types.ts` — 修改 `approachState` 字段定义
  - `mcp/src/orchestrator.ts` — 删除 `ApproachState` 接口，改为 import；更新 `ApproachEntry`/`FailedApproach` 导入来源
- **依赖**: Task 1, Task 6
- **完成标准**:
  - `types.ts` 中 `approachState` 使用 `ApproachStateSchema.nullable().optional().catch(undefined)`
  - `orchestrator.ts` 中不存在 `ApproachState` 接口的重复定义
  - 构造 `approachState: null` 的 state.json 加载成功（向后兼容）
  - 构造不合法 `approachState`（如 `{ foo: "bar" }`）时 fallback 为 `undefined` 而非抛异常
  - 现有全部测试通过

## Task 8: 新增 resolveInitialStep 单元测试

- **描述**: 在 `orchestrator.test.ts` 中新增 `resolveInitialStep` 的独立测试用例，覆盖：(a) 首次启动正常路由 — 返回第一步的 prompt (b) PASS 状态推进 — phase 完成后推进到下一个 phase (c) design doc 合规跳过 1a — 直接进入 1b (d) 所有 phase 完成 — 返回 done=true
- **文件**:
  - `mcp/src/__tests__/orchestrator.test.ts` — 新增 describe 块
- **依赖**: Task 5
- **完成标准**:
  - 4 个测试用例全部 PASS
  - 覆盖 AC-5 的 (a)(b)(c) 三个场景

## Task 9: 新增 handleValidationFailure 单元测试

- **描述**: 在 `orchestrator.test.ts` 中新增 `handleValidationFailure` 的独立测试用例，覆盖：(a) tribunal subagent 委托 — 返回 escalation.reason === "tribunal_subagent" (b) tribunal crash escalation — 返回 escalation.reason === "tribunal_crashed" (c) circuit breaker 触发 — 返回 freshContext=true (d) iteration limit 超限 — 返回 escalation.reason === "iteration_limit_exceeded"
- **文件**:
  - `mcp/src/__tests__/orchestrator.test.ts` — 新增 describe 块
- **依赖**: Task 6
- **完成标准**:
  - 4 个测试用例全部 PASS
  - 覆盖 AC-6 的 (a)(b)(c)(d) 四个场景

## Task 10: 新增 advanceToNextStep 单元测试

- **描述**: 在 `orchestrator.test.ts` 中新增 `advanceToNextStep` 的独立测试用例，覆盖：(a) 正常推进 — 返回下一步的 step 和 prompt (b) 所有步骤完成 — 返回 done=true (c) TDD 门控阻断 — 返回 TDD_GATE_GLOBAL_INCOMPLETE 消息
- **文件**:
  - `mcp/src/__tests__/orchestrator.test.ts` — 新增 describe 块
- **依赖**: Task 6
- **完成标准**:
  - 3 个测试用例全部 PASS
  - 覆盖 AC-7 的 (a)(b)(c) 三个场景

## Task 11: 新增 ApproachStateSchema 单元测试

- **描述**: 在 `orchestrator.test.ts` 或新建 `types.test.ts` 中新增 `ApproachStateSchema` 验证测试：(a) 合法对象 parse 成功 (b) 不合法对象 parse 失败 (c) `StateJsonSchema` 中 `approachState: null` parse 成功 (d) `StateJsonSchema` 中 `approachState` 为非法值时 fallback 为 undefined
- **文件**:
  - `mcp/src/__tests__/orchestrator.test.ts` — 新增 describe 块
- **依赖**: Task 7
- **完成标准**:
  - 4 个测试用例全部 PASS
  - 覆盖 AC-3 和 AC-9

## Task 12: 最终验证 — computeNextTask 行数检查 + 全量测试

- **描述**: 运行全量测试确认无回归，检查 `computeNextTask` 函数体行数不超过 100 行（不含空行和注释），确认 AC-1 到 AC-10 全部满足
- **文件**:
  - 无新增/修改文件（纯验证任务）
- **依赖**: Task 8, Task 9, Task 10, Task 11
- **完成标准**:
  - `npm test` 全部 PASS
  - `computeNextTask` 函数体 <= 100 行（不含空行和注释）
  - AC-1 至 AC-10 逐条检查通过

---

## 依赖关系图

```
Task 1 (ApproachState Schema) ──────────────────────────┐
                                                         │
Task 2 (OrchestratorContext) ──→ Task 3 (改造 tribunal 签名) ──→ Task 4 (替换 tribunal 内联代码)
                                                                        │
                                                         Task 5 (resolveInitialStep) ←──┘
                                                                        │
                                                         Task 6 (handleValidationFailure + advanceToNextStep)
                                                                   │         │
                                           Task 7 (schema 替换) ←──┘         │
                                                  │                          │
                                           Task 11 (schema 测试)   Task 8 (resolveInitialStep 测试)
                                                  │                Task 9 (handleValidationFailure 测试)
                                                  │                Task 10 (advanceToNextStep 测试)
                                                  │                          │
                                                  └──────→ Task 12 (最终验证) ←──┘
```

## 关键路径

**Task 2 → Task 3 → Task 4 → Task 5 → Task 6 → Task 12**（6 个任务，核心重构链路）

## AC 覆盖映射

| AC | 覆盖任务 |
|----|---------|
| AC-1 (computeNextTask <= 100 行) | Task 6, Task 12 |
| AC-2 (无重复 tribunal 内联代码) | Task 4 |
| AC-3 (approachState 使用具体 schema) | Task 7, Task 11 |
| AC-4 (现有测试无回归) | 每个 Task 完成后验证 |
| AC-5 (resolveInitialStep 测试) | Task 8 |
| AC-6 (handleValidationFailure 测试) | Task 9 |
| AC-7 (advanceToNextStep 测试) | Task 10 |
| AC-8 (ApproachState 无重复定义) | Task 7 |
| AC-9 (approachState 向后兼容) | Task 11 |
| AC-10 (关键路径日志) | Task 4, Task 6 |
