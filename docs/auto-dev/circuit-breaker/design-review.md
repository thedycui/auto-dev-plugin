# 设计审查报告：断路器机制（Circuit Breaker）

**审查日期**: 2026-03-26
**审查阶段**: Phase 1 — 架构评审
**总体评价**: **PASS**

---

## 审查摘要

设计文档质量较高：问题分析到位（锚定效应 + 缺乏方案级退出），方案对比充分（A/B 两方案 + 对比表），AC 有 8 条且覆盖正向/负向/兼容性场景。选型方案 A（Orchestrator 内置断路器）在技术上与现有 `computeNextTask()` 架构兼容，改动范围合理。

以下按优先级列出需关注的问题。

---

## P0：阻塞性问题

无。

---

## P1：重要问题，应该修复

### P1-1：原始需求中的 "spawn 新 agent" 与设计文档的 "不 spawn" 存在认知偏差，需明确对齐

**问题**：原始需求文档（`design-circuit-breaker.md`）4.3 节明确写 `freshContext: true // 标记使用新 agent`，并且生命周期中反复提到 "spawn 新 agent"。但设计文档 1.3 Non-Goals 第 5 条明确写 "不做 spawn 新 agent"，清零通过构建不含失败细节的 prompt 实现。

这是一个正确的架构决策（`computeNextTask()` 是纯计算函数，不控制 agent 生命周期），但需要在设计文档中明确说明：**为什么不采纳原始需求的 spawn 方案，以及当前方案如何等效解决锚定效应问题。**

当前的 "清零 prompt" 方案在同一 agent context 中执行时，agent 的 conversation history 中仍然存在之前的失败交互。清零 prompt 只是新一轮的 task prompt，但 agent 的上下文窗口中可能仍包含旧失败信息。这一点需要在设计中讨论其影响和缓解措施。

**建议**：在 Non-Goals 第 5 条或 4.6 节中补充说明：
1. 为什么选择 "清零 prompt" 而非 "spawn 新 agent"
2. 主 agent 在收到 `computeNextTask` 返回的 circuit-break prompt 后，应以 `Agent()` subagent 方式执行（subagent 天然拥有干净 context），明确这一点是清零生效的前提

### P1-2：`handleApproachFailure` 返回 `CONTINUE` 时 `approachState` 未持久化

**问题**：设计文档 4.5 节中，当 `current.failCount < MAX_APPROACH_FAILURES` 时返回 `{ action: "CONTINUE", approachState }`。但在 4.4 节的 `computeNextTask()` 改动中，只有 `CIRCUIT_BREAK` 分支调用了 `writeStepState` 写入 `approachState`。`CONTINUE` 分支走的是现有 revision 逻辑，**没有持久化更新后的 `approachState`（failCount 已 +1）**。

这意味着如果方案内第 1 次失败后 agent 修正成功再次失败，`failCount` 会从 0 重新计算，而非从 1 开始。断路器永远不会触发。

**建议**：在 `CONTINUE` 分支也写入 `approachState`。修改 4.4 节，在现有 revision 逻辑的 `writeStepState` 调用中，增加 `approachState: approachResult.approachState` 字段。

### P1-3：stepIteration 与断路器的交互存在竞态

**问题**：设计文档 4.9 节提到 "在有 approachState 时不使用 MAX_STEP_ITERATIONS（由断路器自行管理上限）"，但 4.4 节的伪代码中，`handleApproachFailure()` 被插入在 `escalation 检查之前`。实际代码（`orchestrator.ts:580-598`）的执行顺序是：

```
validation failed -> 检查 currentIteration >= MAX_STEP_ITERATIONS -> escalation
```

如果 `handleApproachFailure` 插入在 escalation 检查之前，但没有修改 escalation 检查逻辑，可能出现：
- 方案 A 失败 2 次 -> 断路器切换到方案 B，`stepIteration` 重置为 0
- 方案 B 失败 1 次 -> `stepIteration` = 1，正常 revision
- 问题在于 escalation 检查仍在 `handleApproachFailure` 之后，两者不会冲突

实际分析后发现，只要在 `CIRCUIT_BREAK` 分支中 `return`（设计中已做到），`stepIteration >= MAX_STEP_ITERATIONS` 的检查就不会被执行到。但设计文档应明确说明：**当有 approachState 时，跳过 escalation 检查**，否则实现者可能把 `handleApproachFailure` 放错位置。

**建议**：在 4.4 节的伪代码中明确注释：`handleApproachFailure` 必须在 `MAX_STEP_ITERATIONS` 检查之前执行且各分支独立 return，或者显式添加 `if (approachState) { skip escalation check }` 的守卫逻辑。

### P1-4：approach-plan.md 首次解析时机的边界情况（路径激活风险）

**问题**：设计中 `handleApproachFailure` 在首次失败时才去读 `approach-plan.md`。但实际执行流程是：
1. Agent 收到 step 3 的 prompt（包含方案计划要求）
2. Agent 执行任务，输出 approach-plan.md + 代码
3. `validateStep("3")` 运行 build + test
4. 如果 build/test 失败，`handleApproachFailure` 尝试读 approach-plan.md

**边界情况**：Agent 可能在安装依赖阶段就失败了，根本没来得及写 approach-plan.md，也没来得及写代码。此时 `handleApproachFailure` 返回 `CONTINUE`，走常规 revision。这个行为是合理的 graceful degradation。

但另一个边界：Agent 写了 approach-plan.md 但格式不规范（只有主方案没有备选），`parseApproachPlan` 返回 null。此时断路器永远不会激活，Agent 将在 `MAX_STEP_ITERATIONS = 3` 次后被 escalate。**设计应讨论：是否在此场景下通过 revision prompt 要求 Agent 补充备选方案**。

**建议**：在 4.5 节或风险表中补充：当 `parseApproachPlan` 返回 null（格式不规范）时，考虑在 revision prompt 中追加 "你的 approach-plan.md 缺少备选方案，请补充" 的提示。

---

## P2：优化建议，可选

### P2-1：改动范围表遗漏测试文件

设计文档 5.1 节的改动范围表未列出测试文件。根据 AC-1 到 AC-8 的验证方式，至少需要新增 `orchestrator.test.ts` 中的测试用例，或新增 `circuit-breaker.test.ts`。建议在改动范围表中补充测试文件及预估行数。

### P2-2：`extractOneLineReason()` 未定义

设计文档 4.5 节引用了 `extractOneLineReason(feedback)` 函数，但未给出定义或说明其行为。feedback 可能是很长的编译错误输出（参见 `translateFailureToFeedback` 返回的内容），需要说明截取逻辑（首行？关键错误行？字数限制？）。

### P2-3：`getStepGoal()` 未定义

设计文档 4.5 节引用了 `getStepGoal(step, outputDir)` 来获取原始目标，但未定义其实现。需要说明是从 plan.md 解析、从 state.json 读取、还是从 prompt 模板中提取。

### P2-4：AC-8 的 step 覆盖范围与正文不一致

4.7 节说对 step "3"、"4a"、"5b" 追加方案计划指令。但 AC-8 说 step "3"、"5b" 包含指令，遗漏了 "4a"。而原始需求文档还提到了 phase8-integration-test。建议统一。

### P2-5：方案切换后 approach-plan.md 的处理

断路器切换方案后，旧的 approach-plan.md 仍在 outputDir 中。如果新方案的 agent 再次执行，是否会覆盖这个文件？如果覆盖了，`approachState` 中已有的方案列表是否会被新内容冲突？建议说明：切换后 orchestrator 应以持久化的 `approachState` 为准，不再重新解析 approach-plan.md。

---

## Checklist 逐项评估

| 检查项 | 结果 | 备注 |
|--------|------|------|
| 方案完整性：至少 2 个方案对比 | PASS | 方案 A（Orchestrator 内置）+ 方案 B（纯 Prompt 驱动），含对比表 |
| 技术可行性：与现有架构兼容 | PASS | 完全基于 `computeNextTask()` 的纯计算模型，通过 `StepState` 扩展字段持久化，不引入新的 agent 生命周期管理 |
| AC 质量：可验证、覆盖正负向 | PASS | 8 条 AC，覆盖正向（AC-1/2/3）、负向（AC-4/5/6）、兼容性（AC-5/7/8） |
| 改动范围：影响分析准确性 | PASS (minor) | 遗漏测试文件（P2-1），其余准确 |
| 向后兼容：无破坏性影响 | PASS | 无 approach-plan.md 时完全走现有逻辑 |
| 风险评估：已识别关键风险 | PASS (minor) | 缺少 P1-2（持久化遗漏）和 P1-4（格式不规范时的恢复策略） |

---

## 结论

**PASS** — 设计方案整体可行，架构决策正确。P1 问题建议在计划阶段前修正，主要是 P1-2（approachState 持久化遗漏）和 P1-3（stepIteration 交互逻辑需要更明确的说明）。P2 问题可在实现阶段顺带处理。
