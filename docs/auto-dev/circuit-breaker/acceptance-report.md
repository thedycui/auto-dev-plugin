# 验收报告：断路器机制（Circuit Breaker）

## AC 来源

设计文档 `design.md` 第 7 节"验收标准"，共 8 条 AC。

## 验收结果

| AC | 描述 | 验证方式 | 结果 | 证据 |
|----|------|---------|------|------|
| AC-1 | 当 step 验证失败且 approach-plan.md 存在时，orchestrator 能正确解析方案列表（主方案 + 至少 1 个备选），并创建 approachState | 代码审查 + 单元测试 | PASS | `parseApproachPlan()` 在 `orchestrator-prompts.ts:134` 实现，正确解析"主方案"和"备选方案 X"段落，不足 2 个方案时返回 null。`handleApproachFailure()` 在 `orchestrator.ts:324` 调用解析结果创建 approachState。测试覆盖：TC-01, TC-02, TC-03 及 5 个 parseApproachPlan 基础测试（全部 PASS） |
| AC-2 | 当前方案连续失败 2 次后，computeNextTask 返回清零 prompt（包含目标 + 下一个方案 + 禁用列表），而非 revision prompt | 代码审查 + 单元测试 | PASS | `handleApproachFailure()` 在 `orchestrator.ts:362` 检查 `failCount < MAX_APPROACH_FAILURES(=2)`，达到阈值后调用 `buildCircuitBreakPrompt()` 构建清零 prompt。`buildCircuitBreakPrompt()` 在 `orchestrator-prompts.ts:180` 输出包含"禁止:"字样和方案指示的 prompt。测试覆盖：TC-04/05、基础 CIRCUIT_BREAK 测试（验证 prompt 包含"禁止"且不含失败堆栈） |
| AC-3 | 断路器切换方案后，stepIteration 重置为 0 | 代码审查 + 单元测试 | PASS | `computeNextTask()` 在 `orchestrator.ts:718` 的 CIRCUIT_BREAK 分支中调用 `writeStepState` 设置 `stepIteration: 0`。测试覆盖：TC-04/05 验证 writeStepState 调用参数包含 `stepIteration: 0`，基础 CIRCUIT_BREAK 测试同样验证 |
| AC-4 | 所有方案耗尽时（currentIndex >= approaches.length），computeNextTask 返回 escalation 且 status 变为 BLOCKED | 代码审查 + 单元测试 | PASS | `handleApproachFailure()` 在 `orchestrator.ts:375` 检查 `currentIndex >= approaches.length` 返回 ALL_EXHAUSTED。`computeNextTask()` 在 `orchestrator.ts:734` 处理 ALL_EXHAUSTED：调用 `sm.atomicUpdate({ status: "BLOCKED" })`，返回 `escalation.reason === "all_approaches_exhausted"`。测试覆盖：TC-06、基础 ALL_EXHAUSTED 测试（验证 BLOCKED 状态和 escalation 返回） |
| AC-5 | 无 approach-plan.md 时，行为与改动前完全一致（向后兼容） | 代码审查 + 单元测试 | PASS | `handleApproachFailure()` 在 `orchestrator.ts:336-337` 检查文件不存在时返回 `{ action: "CONTINUE" }`。`computeNextTask()` 在 `orchestrator.ts:762` 无 approachState 时仍使用 `MAX_STEP_ITERATIONS` 限制。测试覆盖：TC-07b（无 approach-plan.md 走正常 revision）、TC-08（无 approach-plan.md 超限走 escalation） |
| AC-6 | approach-plan.md 格式不规范（缺少"备选方案"段落、只有主方案等）时，parseApproachPlan 返回 null，不触发断路器 | 代码审查 + 单元测试 | PASS | `parseApproachPlan()` 在 `orchestrator-prompts.ts:164` 检查 `approaches.length >= 2`，不足则返回 null。`handleApproachFailure()` 在 `orchestrator.ts:340-344` 对 null 返回 CONTINUE 并附带 planFeedback 提示补充备选方案。测试覆盖：TC-09（只有主方案返回 planFeedback）、TC-10（随机文本返回 null）、TC-26（格式不规范返回 planFeedback） |
| AC-7 | 清零 prompt 不包含任何 FRAMEWORK_TERMS 中定义的框架术语 | 代码审查 + 单元测试 | PASS | `buildCircuitBreakPrompt()` 在 `orchestrator-prompts.ts:180-215` 使用纯自然语言构建 prompt，不含 checkpoint/tribunal/phase 等术语。测试覆盖：TC-11 调用 `containsFrameworkTerms()` 验证返回 false；`orchestrator.test.ts:704` 在集成测试中同样验证 |
| AC-8 | step "3"、"5b" 的初始 prompt 包含方案计划指令段，step "1a"、"7" 等不包含 | 代码审查 + 单元测试 | PASS | `orchestrator.ts:594` 定义 `APPROACH_PLAN_STEPS = ["3", "4a", "5b"]`，仅对这些 step 追加方案计划指令。指令内容为自然语言，要求输出 approach-plan.md。测试覆盖：TC-15（step 5b 包含"方案计划"和"approach-plan.md"）、TC-16（step 1a 不包含）、TC-17（step 7 不包含） |

## 额外发现（代码审查报告 P1-1 修复确认）

代码审查报告中的 P1-1 问题（步骤推进时未清除 approachState 导致跨步骤状态泄漏）已修复。`orchestrator.ts:857` 在步骤推进时显式设置 `approachState: null`。TC-18 测试用例验证了此修复。

## 汇总

- 通过率：**8/8 PASS, 0 FAIL, 0 SKIP**
- 全量测试：303 个用例全部通过（含 38 个新增断路器测试）
- 结论：**PASS**
