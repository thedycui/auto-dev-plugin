# Plan Review

## P0 (阻塞性问题)

- **P0-1: 缺少 SKILL.md 更新任务** -- 设计文档 5.1 明确列出 `skills/auto-dev/SKILL.md` 需要修改（新增 ship 参数说明），但计划中没有任何 Task 覆盖此文件。SKILL.md 是主 Agent 调用 auto-dev 时的入口文档，缺少 ship 参数说明会导致用户不知道如何使用此功能。
  - 修复建议: 新增 Task（建议在 Task 12 之后），修改 `skills/auto-dev/SKILL.md`，新增 `ship`、`deployTarget`、`deployBranch`、`deployEnv`、`verifyMethod`、`verifyConfig`、`shipMaxRounds` 参数说明。完成标准：SKILL.md 包含 Phase 8 的功能描述和所有 ship 参数的用法说明。

## P1 (重要问题)

- **P1-1: Task 9 computeNextDirective 修改方式不完整** -- Task 9 只提到修改 `maxPhase` 的三元表达式，但 `computeNextDirective` 的函数签名是 `(currentPhase, status, state, regressTo?)`，它通过 `state` 参数已经能拿到 `state.ship`。然而计划没有说明如何传入 ship 信息。当前签名中 state 已经包含所有字段，所以实际上能直接读取 `state.ship`，但计划应该明确说明这一点，避免实现时误以为需要修改签名。
  - 修复建议: Task 9 描述中补充说明"直接从 state 参数读取 `state.ship`，无需修改函数签名"。

- **P1-2: Task 11 buildTaskForStep 需要传递 state 中的 ship 配置字段，但未说明具体传递机制** -- `buildTaskForStep` 当前签名为 `(step, outputDir, projectRoot, topic, buildCmd, ...)`，不接受 state 参数。Task 11 描述中写了"需传入或从 state 获取"，但没有明确方案。这是一个实现关键决策点，不能留到实现时再决定。
  - 修复建议: Task 11 明确说明传递方式。查看现有代码，`buildTaskForStep` 的 `variables` 对象（约第 596 行构造）可以在调用方（`computeNextTask`）中扩展，将 `state.deployTarget` 等字段加入 variables。Task 11 应指明：(1) 在 `computeNextTask` 调用 `buildTaskForStep` 处构造 variables 时，当 step 以 "8" 开头时从 state 中提取 ship 字段加入 variables；(2) `buildTaskForStep` 本身签名不变。

- **P1-3: 路径激活风险 -- `regressToPhase` 处理路径从未被现有代码使用过** -- `validateStep` 返回的 `regressToPhase` 字段虽然在类型定义中存在（第 401 行），但当前没有任何 step 会返回此值，`computeNextTask` 中也没有消费 `regressToPhase` 的逻辑。Task 7 是首次激活这条路径，属于"代码存在但从未执行"的高风险场景。Task 14 的测试覆盖了基本场景，但应额外覆盖：回退后 Phase 3 -> Phase 4 的验证是否仍然正常、回退后 stepIteration 是否正确重置、回退后 approachState 清空后不影响 Phase 3 的 approach plan 机制。
  - 修复建议: Task 14 的完成标准中增加以下测试场景：(1) 回退后 stepIteration 确认为 0；(2) 回退后 approachState 确认为 null；(3) 回退后从 Phase 3 成功推进到 Phase 4、再到 Phase 8 的完整路径测试（计划中的 P2-3 已部分覆盖，但需确认包含 approachState 的验证）。

- **P1-4: Task 6 Step 8a 的 git 命令执行方式未说明** -- `validateStep` 当前所有 case 都是文件读取 + 内容检查，不涉及 shell 命令执行。Step 8a 需要执行 `git log --oneline --branches --not --remotes`，这是 validateStep 中首次引入 shell 命令调用。计划没有说明使用什么机制执行（`execFile`? `child_process.exec`?）以及错误处理（git 命令失败怎么办）。
  - 修复建议: Task 6 描述中补充：(1) 使用 orchestrator.ts 已有的 `execFile` import 执行 git 命令；(2) git 命令执行失败时（如不在 git repo 中）应返回 `passed: false` 并在 feedback 中说明错误原因；(3) 设置合理的超时（如 10 秒）。

## P2 (优化建议)

- **P2-1: Task 12 prompt 模板的 verifyConfig 嵌套变量渲染** -- phase8-ship.md 需要渲染 `verifyConfig` 中的嵌套字段（`endpoint`、`logPath`、`sshHost` 等），但现有的 `TemplateRenderer` 是否支持嵌套变量（如 `{{verifyConfig.endpoint}}`）没有在计划中确认。建议 Task 12 先确认 TemplateRenderer 的能力，如不支持嵌套则需要在 Task 11 中将嵌套字段打平后传入 variables。

- **P2-2: Task 13 和 Task 15 合并建议** -- 两个 Task 都写入同一个文件 `ship-integration.test.ts`，且都依赖 phase-enforcer 的变更。可以合并为一个 Task 以减少上下文切换。

- **P2-3: Task 16 可前置部分检查** -- "检查 STEP_ORDER 长度相关的断言"这个步骤可以在 Task 4 完成后就立即执行，不必等到最后。建议 Task 4 的完成标准中就包含"检查并更新现有测试中 STEP_ORDER 长度硬编码断言"。

- **P2-4: 缺少 1c/2c 步骤在 STEP_ORDER 中的说明** -- 当前代码 `STEP_AGENTS` 中有 "1c" 和 "2c" 的映射，但 `STEP_ORDER` 中没有这两个步骤（它们是审查修订循环中动态产生的）。计划正确地只在 STEP_ORDER 末尾追加 8a-8d，但 Task 4 完成标准中写"STEP_ORDER 长度从 10 变为 14"，这是正确的。仅作为提醒：5c 也在 STEP_AGENTS 中但不在 STEP_ORDER 中，确认 8a-8d 不存在类似的动态步骤需求。

## Coverage Matrix

| 设计章节/功能点 | 对应任务 | 覆盖状态 |
|----------------|---------|---------|
| 4.1 StateJsonSchema 新增 8 个字段 | Task 1 | OK |
| 4.1 InitInputSchema 新增 7 个参数 | Task 2 | OK |
| 4.1 auto_dev_init ship=true 时 deployTarget 必填校验 | Task 3 | OK |
| 4.1 auto_dev_init behaviorUpdates 写入 ship 字段 | Task 3 | OK |
| 4.2 STEP_ORDER 追加 8a-8d | Task 4 | OK |
| 4.2 STEP_AGENTS 新增 8a-8d -> auto-dev-developer | Task 4 | OK |
| 4.2 firstStepForPhase 新增 8: "8a" | Task 4 | OK |
| 4.2 PHASE_SEQUENCE 不改，运行时动态追加 | Task 5 | OK |
| 4.2 validateStep 新增 8a case (git unpushed) | Task 6 | OK |
| 4.2 validateStep 新增 8b case (build result) | Task 6 | OK |
| 4.2 validateStep 新增 8c case (deploy result) | Task 6 | OK |
| 4.2 validateStep 新增 8d case (verify + CODE_BUG/ENV_ISSUE) | Task 6 | OK |
| 4.2 regressToPhase 回退逻辑 + shipRound 递增 + ESCALATE | Task 7 | OK |
| 4.3 PHASE_META 新增 8 | Task 8 | OK |
| 4.3 computeNextDirective maxPhase 感知 ship | Task 9 | OK |
| 4.3 validateCompletion 新增 ship 参数 | Task 10 | OK |
| 4.4 auto_dev_init tool schema 新增参数 | Task 3 | OK |
| 4.4 auto_dev_complete 传 ship 参数 | Task 10 | OK |
| 4.5 phase8-ship.md prompt 模板 | Task 12 | OK |
| 4.5 buildTaskForStep 新增 8a-8d 处理 | Task 11 | OK |
| 5.1 SKILL.md 修改（ship 参数说明） | -- | **MISSING** |
| 验收标准 AC-1 ~ AC-3 (init 参数) | Task 13 | OK |
| 验收标准 AC-4 ~ AC-5 (phases 列表) | Task 14 | OK |
| 验收标准 AC-6 ~ AC-10 (step 验证 + 回退) | Task 14 | OK |
| 验收标准 AC-11 (validateCompletion) | Task 13 | OK |
| 验收标准 AC-12 (不触发 tribunal) | Task 6, Task 14 | OK |
| 验收标准 AC-13 (prompt 模板渲染) | Task 11, Task 12 | OK |
| 编译回归验证 | Task 16 | OK |

## 结论

**NEEDS_REVISION**

存在 1 个 P0 问题（SKILL.md 更新任务缺失）和 4 个 P1 问题（computeNextDirective 读取方式不明确、buildTaskForStep 传参机制不明确、regressToPhase 路径首次激活需增强测试、Step 8a git 命令执行机制未说明）。修复后可 PASS。
