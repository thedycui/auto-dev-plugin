# Implementation Plan: circuit-breaker

## Task 1: 扩展 StepState 接口和读写函数

- **描述**: 在 `orchestrator.ts` 中扩展 `StepState` 接口，新增 `approachState: ApproachState | null` 字段。同时新增 `ApproachState`、`ApproachEntry`、`FailedApproach` 接口定义。修改 `readStepState()` 使其读取 `approachState` 字段（无则返回 null），修改 `writeStepState()` 使其支持写入 `approachState` 字段。
- **文件**:
  - `mcp/src/orchestrator.ts`（StepState 接口 + readStepState/writeStepState 函数）
- **依赖**: 无
- **完成标准**: `readStepState` 能从 state.json 中读出 approachState（存在时）或返回 null（不存在时）；`writeStepState` 能写入 approachState 字段；现有无 approachState 的 state.json 读取行为不变。

## Task 2: 实现 parseApproachPlan 解析函数

- **描述**: 在 `orchestrator-prompts.ts` 中新增 `parseApproachPlan(content: string): ApproachEntry[] | null` 函数。解析 `approach-plan.md` 中的 "## 主方案" 和 "## 备选方案 X" 段落，提取方案列表。至少需要主方案 + 1 个备选方案才返回有效结果，否则返回 null。同时新增 `extractOneLineReason(feedback: string): string` 函数，从冗长的 feedback 中提取第一行有意义的错误描述（P2-2 修复）。
- **文件**:
  - `mcp/src/orchestrator-prompts.ts`
- **依赖**: 无
- **完成标准**: `parseApproachPlan` 对标准格式返回正确的 ApproachEntry 数组；对只有主方案没有备选的内容返回 null；对空字符串返回 null。`extractOneLineReason` 对长文本返回首行摘要。

## Task 3: 实现 buildCircuitBreakPrompt 清零 Prompt 构建函数

- **描述**: 在 `orchestrator-prompts.ts` 中新增 `buildCircuitBreakPrompt()` 函数，按设计文档 4.6 节的模板构建清零 prompt。包含：原始目标、下一个方案、已失败方案禁用列表、约束要求。确保输出不包含任何 FRAMEWORK_TERMS 中定义的框架术语。
- **文件**:
  - `mcp/src/orchestrator-prompts.ts`
- **依赖**: 无
- **完成标准**: 生成的 prompt 包含目标、方案、禁用列表三个段落；`containsFrameworkTerms(prompt)` 返回 false（AC-7）。

## Task 4: 实现 handleApproachFailure 核心断路器逻辑

- **描述**: 在 `orchestrator.ts` 中新增 `handleApproachFailure()` 函数。包含：首次失败时从 approach-plan.md 解析方案列表并初始化 approachState；递增当前方案 failCount；failCount 达到 MAX_APPROACH_FAILURES(2) 时触发 CIRCUIT_BREAK；所有方案耗尽时返回 ALL_EXHAUSTED；未达阈值时返回 CONTINUE。同时新增 `getStepGoal()` 辅助函数，从 plan.md 中提取对应 step 的任务目标（P2-3 修复）。返回类型定义为 `ApproachAction` 联合类型。
- **文件**:
  - `mcp/src/orchestrator.ts`
- **依赖**: Task 1, Task 2, Task 3
- **完成标准**: handleApproachFailure 对三种场景（CONTINUE / CIRCUIT_BREAK / ALL_EXHAUSTED）返回正确的 action；无 approach-plan.md 时返回 CONTINUE。

## Task 5: 修改 computeNextTask 集成断路器

- **描述**: 在 `computeNextTask()` 的 `validation.passed === false` 分支中插入断路器判断。关键修改：(1) 在 `MAX_STEP_ITERATIONS` 检查之前调用 `handleApproachFailure()`；(2) CIRCUIT_BREAK 时重置 stepIteration=0 并返回清零 prompt；(3) ALL_EXHAUSTED 时标记 BLOCKED 并返回 escalation；(4) CONTINUE 时也要持久化更新后的 approachState（P1-2 修复）；(5) 有 approachState 时跳过 MAX_STEP_ITERATIONS 的 escalation 检查（P1-3 修复），由断路器自行管理重试上限。
- **文件**:
  - `mcp/src/orchestrator.ts`（computeNextTask 函数中 validation.passed === false 分支）
- **依赖**: Task 4
- **完成标准**: CIRCUIT_BREAK 时返回的 prompt 是清零 prompt 且 stepIteration 被重置；ALL_EXHAUSTED 时 status 变为 BLOCKED；CONTINUE 时 approachState 被写入 state.json；无 approachState 时行为与改动前完全一致。

## Task 6: 在 buildTaskForStep 中追加方案计划指令

- **描述**: 修改 `buildTaskForStep()`，对 step "3"、"4a"、"5b" 的 prompt 末尾追加方案计划指令段（要求 agent 输出 approach-plan.md）。指令使用自然语言描述，不含框架术语，符合 Invisible Framework 原则。其他 step（如 "1a"、"7"）不追加。
- **文件**:
  - `mcp/src/orchestrator.ts`（buildTaskForStep 函数）
- **依赖**: 无
- **完成标准**: step "3"、"4a"、"5b" 的 prompt 包含 "approach-plan.md" 字样和方案计划要求；step "1a"、"7" 的 prompt 不包含。

## Task 7: 单元测试 -- parseApproachPlan 和 extractOneLineReason

- **描述**: 为 `parseApproachPlan` 编写单元测试，覆盖：标准格式（主方案 + 2 个备选）、只有主方案无备选（返回 null）、空字符串（返回 null）、格式变体（标题前后有空行等）、方法字段缺失时使用 fallback summary。为 `extractOneLineReason` 编写测试，覆盖：长文本提取首行、短文本原样返回。
- **文件**:
  - `mcp/src/__tests__/orchestrator-prompts.test.ts`（追加测试用例）
- **依赖**: Task 2
- **完成标准**: 所有测试通过；覆盖 AC-1（解析正确）和 AC-6（格式不规范返回 null）。

## Task 8: 单元测试 -- buildCircuitBreakPrompt

- **描述**: 为 `buildCircuitBreakPrompt` 编写单元测试，验证：生成的 prompt 包含目标和方案描述；包含禁用列表（"禁止:" 字样）；不包含任何框架术语（AC-7）。
- **文件**:
  - `mcp/src/__tests__/orchestrator-prompts.test.ts`（追加测试用例）
- **依赖**: Task 3
- **完成标准**: 所有测试通过；覆盖 AC-2（prompt 包含禁止字样）和 AC-7（无框架术语）。

## Task 9: 单元测试 -- handleApproachFailure 和 computeNextTask 断路器集成

- **描述**: 在 `orchestrator.test.ts` 中新增断路器相关测试。覆盖场景：(1) 无 approach-plan.md 时返回 CONTINUE（AC-5）；(2) 方案内第 1 次失败时 CONTINUE 且 approachState 被持久化（P1-2）；(3) 同一方案连续失败 2 次后触发 CIRCUIT_BREAK，stepIteration 重置为 0（AC-2, AC-3）；(4) 所有方案耗尽时返回 escalation 且 status 为 BLOCKED（AC-4）；(5) step "3" 的 prompt 包含方案计划指令，step "1a" 不包含（AC-8）。
- **文件**:
  - `mcp/src/__tests__/orchestrator.test.ts`（追加测试用例）
- **依赖**: Task 5, Task 6
- **完成标准**: 所有测试通过；覆盖 AC-2 ~ AC-5, AC-8。

## Task 10: 全量测试回归验证

- **描述**: 运行全量测试套件，确保所有现有测试仍然通过，新增测试也全部通过。修复任何回归问题。
- **文件**:
  - 无新增文件，修复可能涉及任何已改动文件
- **依赖**: Task 7, Task 8, Task 9
- **完成标准**: `npm test` 全部通过，0 个失败用例。
