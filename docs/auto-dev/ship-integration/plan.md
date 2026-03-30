# Implementation Plan: ship-integration

## Task 1: StateJsonSchema 新增 ship 相关字段

- **描述**: 在 `StateJsonSchema`（Zod v4 schema）中新增 8 个 optional 字段：`ship`、`deployTarget`、`deployBranch`、`deployEnv`、`verifyMethod`、`verifyConfig`、`shipRound`、`shipMaxRounds`。`verifyConfig` 为嵌套 object（`endpoint?`、`expectedPattern?`、`logPath?`、`logKeyword?`、`sshHost?`，均为 optional string）。
- **文件**:
  - `mcp/src/types.ts`（StateJsonSchema 定义，约第 90-162 行）
- **依赖**: 无
- **完成标准**:
  - StateJsonSchema 包含所有 8 个新字段，均为 `.optional()`
  - `z.infer<typeof StateJsonSchema>` 导出的 `StateJson` 类型包含对应的 TypeScript 属性
  - 编译通过（`npm run build` 无报错）

## Task 2: InitInputSchema 新增 ship 参数

- **描述**: 在 `InitInputSchema` 中新增与 Task 1 相同的 ship 相关参数（`ship`、`deployTarget`、`deployBranch`、`deployEnv`、`verifyMethod`、`verifyConfig`、`shipMaxRounds`），均为 optional。注意不需要 `shipRound`（init 时固定写 0）。
- **文件**:
  - `mcp/src/types.ts`（InitInputSchema 定义，约第 178-189 行）
- **依赖**: Task 1
- **完成标准**:
  - InitInputSchema 包含 7 个新参数
  - 编译通过

## Task 3: auto_dev_init 处理 ship 参数

- **描述**: 在 `index.ts` 的 `auto_dev_init` tool handler 中：(1) 解构新增的 ship 参数；(2) 当 `ship=true` 但未传 `deployTarget` 时返回 `MISSING_DEPLOY_TARGET` 错误；(3) 在 `behaviorUpdates` 中写入所有 ship 字段（`ship=true` 时写入 `shipRound: 0`、`shipMaxRounds: shipMaxRounds ?? 5`）；(4) tool schema（第 88-103 行的 Zod 定义）新增对应参数。
- **文件**:
  - `mcp/src/index.ts`（auto_dev_init tool，约第 85-300 行）
- **依赖**: Task 2
- **完成标准**:
  - `auto_dev_init(ship=true, deployTarget="app")` 成功初始化，state.json 包含 `ship: true`、`deployTarget: "app"`、`shipRound: 0`、`shipMaxRounds: 5`
  - `auto_dev_init(ship=true)` 无 deployTarget 时返回 `MISSING_DEPLOY_TARGET` 错误
  - `auto_dev_init()` 无 ship 时 state.json 无 ship 相关字段

## Task 4: STEP_ORDER / STEP_AGENTS / firstStepForPhase 扩展

- **描述**: 在 `orchestrator.ts` 中：(1) `STEP_ORDER` 末尾追加 `"8a", "8b", "8c", "8d"`；(2) `STEP_AGENTS` 新增 `"8a"-"8d"` 映射到 `"auto-dev-developer"`；(3) `firstStepForPhase` 的 map 新增 `8: "8a"`。
- **文件**:
  - `mcp/src/orchestrator.ts`（常量定义，约第 68-91 行；firstStepForPhase 函数，约第 261-266 行）
- **依赖**: 无
- **完成标准**:
  - `STEP_ORDER` 长度从 10 变为 14
  - `STEP_AGENTS["8a"]` 返回 `"auto-dev-developer"`
  - `firstStepForPhase(8)` 返回 `"8a"`
  - 编译通过

## Task 5: computeNextTask 动态追加 Phase 8

- **描述**: 在 `computeNextTask` 中（约第 688-691 行），在 `skipE2e` 过滤之后新增一行：`if (state.ship === true) phases = [...phases, 8];`。确保 Phase 8 在所有模式下都追加到末尾（full/quick/turbo）。
- **文件**:
  - `mcp/src/orchestrator.ts`（computeNextTask 函数，约第 688 行附近）
- **依赖**: Task 4
- **完成标准**:
  - `ship=true` + full 模式：phases 为 `[1,2,3,4,5,6,7,8]`
  - `ship=true` + `skipE2e=true`：phases 为 `[1,2,3,4,6,7,8]`
  - `ship=false` 或无 ship：phases 不含 8
  - Phase 7 PASS 后 `computeNextStep` 返回 `"8a"`（而非 null）

## Task 6: validateStep 新增 8a-8d case 分支

- **描述**: 在 `validateStep` 的 switch-case 中新增 4 个 case：
  - **8a**: 执行 `git log --oneline --branches --not --remotes`，输出为空则 passed=true（无 unpushed commit），否则 passed=false
  - **8b**: 检查 `ship-build-result.md` 存在且含 "SUCCEED"
  - **8c**: 检查 `ship-deploy-result.md` 存在且含 "SUCCEED"
  - **8d**: 检查 `ship-verify-result.md`：含 "PASS" 则 passed=true；含 "CODE_BUG" 则 `passed=false, regressToPhase=3`；含 "ENV_ISSUE" 则 `passed=false`（无 regressToPhase）
- **文件**:
  - `mcp/src/orchestrator.ts`（validateStep 函数，约第 392-549 行）
- **依赖**: Task 4
- **完成标准**:
  - 8a: unpushed commit 时返回 `{ passed: false, feedback: "..." }`；无 unpushed 时返回 `{ passed: true }`
  - 8b: 文件不存在或无 "SUCCEED" 返回 false；存在且含 "SUCCEED" 返回 true
  - 8c: 同 8b 逻辑
  - 8d: "PASS" -> true；"CODE_BUG" -> `{ passed: false, regressToPhase: 3 }`；"ENV_ISSUE" -> `{ passed: false }`
  - 8a-8d 均不调用 `evaluateTribunal`（AC-12）

## Task 7: computeNextTask 新增 regressToPhase 处理分支（P0-1 修复）

- **描述**: 这是审查报告 P0-1 问题的修复。在 `computeNextTask` 的 `validation.passed === false` 分支中（约第 730-893 行），在 tribunal 处理之后、non-tribunal failure 处理之前，新增 `regressToPhase` 处理逻辑：
  1. 在进入 circuit breaker 之前，检查 `validation.regressToPhase` 是否有值
  2. 如果有值，检查 `(state.shipRound ?? 0) + 1 >= (state.shipMaxRounds ?? 5)`
  3. 若已达上限：设置 status=BLOCKED，返回 escalation（reason="ship_max_rounds"）
  4. 若未达上限：`atomicUpdate({ phase: 3, step: "3", stepIteration: 0, shipRound: (state.shipRound ?? 0) + 1, lastValidation: "SHIP_REGRESS", approachState: null })`，返回 Phase 3 修复 prompt（包含 ship-verify-result.md 的失败分析作为 feedback）
- **文件**:
  - `mcp/src/orchestrator.ts`（computeNextTask 函数，约第 806 行之后）
- **依赖**: Task 5, Task 6
- **完成标准**:
  - Step 8d CODE_BUG 时 `regressToPhase=3` 被正确消费，state 回退到 Phase 3 且 `shipRound` 递增
  - `shipRound >= shipMaxRounds` 时返回 ESCALATE（reason="ship_max_rounds"），status 设为 BLOCKED
  - 非 ship 步骤的 `regressToPhase` 为 undefined 时不触发此分支（兼容性）

## Task 8: PHASE_META 新增 Phase 8 条目

- **描述**: 在 `phase-enforcer.ts` 的 `PHASE_META` 常量中新增 `8: { name: "SHIP", description: "交付验证" }`。
- **文件**:
  - `mcp/src/phase-enforcer.ts`（PHASE_META 定义，约第 14-22 行）
- **依赖**: 无
- **完成标准**:
  - `PHASE_META[8]` 返回 `{ name: "SHIP", description: "交付验证" }`
  - 编译通过

## Task 9: computeNextDirective maxPhase 感知 ship（P0-2 修复）

- **描述**: 这是审查报告 P0-2 问题的修复。在 `phase-enforcer.ts` 的 `computeNextDirective` 函数中（约第 111 行），将 maxPhase 计算从 `const maxPhase = isDryRun ? 2 : mode === "turbo" ? 3 : 7;` 改为 `const maxPhase = isDryRun ? 2 : mode === "turbo" ? 3 : state.ship === true ? 8 : 7;`。
- **文件**:
  - `mcp/src/phase-enforcer.ts`（computeNextDirective 函数，约第 103-180 行）
- **依赖**: Task 8
- **完成标准**:
  - `ship=true` 时 maxPhase 为 8，Phase 7 PASS 后返回 "必须执行 Phase 8"
  - `ship=false` 时 maxPhase 仍为 7，行为不变
  - `isDryRun=true` 和 `turbo` 模式不受影响

## Task 10: validateCompletion 新增 ship 参数

- **描述**: 修改 `validateCompletion` 函数签名，新增第 5 个参数 `ship: boolean = false`。当 `ship=true` 时将 8 追加到 `requiredPhases`。同步修改 `index.ts` 中调用方（约第 1304 行），传入 `state.ship === true`。
- **文件**:
  - `mcp/src/phase-enforcer.ts`（validateCompletion 函数，约第 197-243 行）
  - `mcp/src/index.ts`（auto_dev_complete 调用处，约第 1304 行）
- **依赖**: Task 8
- **完成标准**:
  - `validateCompletion(..., ship=true)` 要求 Phase 8 在 progress-log 中有 PASS 记录
  - `validateCompletion(..., ship=false)` 不要求 Phase 8（默认行为不变）
  - `auto_dev_complete` 正确传入 `state.ship === true`

## Task 11: buildTaskForStep 新增 8a-8d prompt 渲染

- **描述**: 在 `orchestrator.ts` 的 `buildTaskForStep` 函数中新增对 step "8a"-"8d" 的处理。从 state 中读取 ship 相关字段（需传入或从 state 获取），渲染 `phase8-ship` 模板。`stepToTemplate` 新增 `"8a": "phase8-ship"` 等映射。由于 8a-8d 使用同一模板但不同子步骤，在 variables 中传入 `substep` 变量（如 `"8a"`、`"8b"` 等）。同时需在 `buildTaskForStep` 签名或内部获取 state 中的 ship 配置字段。
- **文件**:
  - `mcp/src/orchestrator.ts`（buildTaskForStep 函数，约第 574-672 行；stepToTemplate 映射，约第 623-632 行）
- **依赖**: Task 4, Task 12
- **完成标准**:
  - `buildTaskForStep("8a", ...)` 返回包含 deployTarget 等变量的渲染后 prompt
  - 8a-8d 步骤均能正确渲染模板
  - 不影响现有 step 的 prompt 渲染

## Task 12: 创建 phase8-ship.md prompt 模板

- **描述**: 新建 `skills/auto-dev/prompts/phase8-ship.md`，包含 Step 8a-8d 的分步指令。使用模板变量 `{{deployTarget}}`、`{{deployBranch}}`、`{{deployEnv}}`、`{{verifyMethod}}`。包含：(1) 各子步骤的具体操作指令；(2) 产出物文件写入规范（文件名、必须包含的关键词 SUCCEED/PASS/CODE_BUG/ENV_ISSUE）；(3) CODE_BUG vs ENV_ISSUE 的判定指引。
- **文件**:
  - `skills/auto-dev/prompts/phase8-ship.md`（新建）
- **依赖**: 无
- **完成标准**:
  - 文件存在且包含 8a/8b/8c/8d 四个子步骤的指令
  - 包含 `{{deployTarget}}`、`{{deployBranch}}`、`{{deployEnv}}`、`{{verifyMethod}}` 模板变量
  - 包含 CODE_BUG vs ENV_ISSUE 判定标准
  - 产出物文件名和关键词定义清晰

## Task 13: 单元测试 -- 数据模型和 init 参数

- **描述**: 在 `mcp/src/__tests__/improvements.test.ts`（或新建 `ship-integration.test.ts`）中新增测试用例，覆盖：
  - AC-1: init(ship=true, deployTarget="app") 成功初始化
  - AC-2: init(ship=true) 无 deployTarget 时返回错误
  - AC-3: init() 无 ship 时 state 无 ship 字段
  - AC-11: validateCompletion(ship=true) 要求 Phase 8 PASS
  - AC-11 反向: validateCompletion(ship=false) 不要求 Phase 8
- **文件**:
  - `mcp/src/__tests__/ship-integration.test.ts`（新建）
- **依赖**: Task 3, Task 10
- **完成标准**:
  - 所有测试用例通过
  - 覆盖 AC-1、AC-2、AC-3、AC-11

## Task 14: 单元测试 -- orchestrator 步骤推进

- **描述**: 在 `mcp/src/__tests__/orchestrator.test.ts` 中新增测试 describe block，覆盖：
  - AC-4: full + ship=true 时 phases 为 [1,2,3,4,5,6,7,8]，Phase 7 PASS 后下一步为 "8a"
  - AC-5: skipE2e=true + ship=true 时 phases 为 [1,2,3,4,6,7,8]
  - AC-6: Step 8a 验证（unpushed/无 unpushed 两种场景）
  - AC-7: Step 8b 验证
  - AC-8: Step 8c 验证
  - AC-9: Step 8d 验证（PASS/CODE_BUG/ENV_ISSUE 三种场景）
  - AC-10: Step 8d CODE_BUG 回退后 shipRound 递增；shipRound >= shipMaxRounds 时 ESCALATE
  - 审查建议 P2-3: 回退后从 Phase 3 重新推进到 Phase 8d
- **文件**:
  - `mcp/src/__tests__/orchestrator.test.ts`（在现有文件中新增）
- **依赖**: Task 5, Task 6, Task 7
- **完成标准**:
  - 所有测试用例通过
  - 覆盖 AC-4 到 AC-10 以及 P2-3

## Task 15: 单元测试 -- computeNextDirective 和 PHASE_META

- **描述**: 新增测试覆盖 P0-2 修复：
  - computeNextDirective 在 ship=true 时 Phase 7 PASS 后返回 nextPhase=8
  - computeNextDirective 在 ship=false 时 Phase 7 PASS 后返回 canDeclareComplete=true
  - PHASE_META[8] 存在且正确
- **文件**:
  - `mcp/src/__tests__/ship-integration.test.ts`（同 Task 13 文件）
- **依赖**: Task 8, Task 9
- **完成标准**:
  - 所有测试用例通过
  - P0-2 修复被测试覆盖

## Task 16: 编译验证和现有测试回归

- **描述**: 运行完整的编译和测试套件，确保所有变更不破坏现有功能：(1) `npm run build` 编译通过；(2) `npm test` 所有现有测试通过；(3) 检查 STEP_ORDER 长度相关的断言是否需要更新（如有硬编码 `10` 的断言需改为 `14`）。
- **文件**:
  - 可能需要更新的文件：`mcp/src/__tests__/orchestrator.test.ts`（如有 STEP_ORDER 长度断言）
- **依赖**: Task 1-15
- **完成标准**:
  - `npm run build` 零报错
  - `npm test` 所有用例通过（含新增和现有）
  - 无回归问题
