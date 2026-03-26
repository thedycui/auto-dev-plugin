# 计划审查报告：断路器机制（Circuit Breaker）

**审查日期**: 2026-03-26
**审查阶段**: Phase 2 -- 计划审查
**总体评价**: **PASS**

---

## 审查摘要

实施计划共 10 个任务，覆盖了设计文档的全部 8 条 AC 和设计审查中的 4 个 P1 问题中的 2 个（P1-2、P1-3）。任务粒度合理（每个任务 2-10 分钟可完成），依赖关系正确，文件路径均已验证存在于代码库中。

---

## P0：阻塞性问题

无。

---

## P1：重要问题，应该修复

### P1-1：设计审查 P1-1（清零 prompt 在同一 agent context 中的锚定效应）未在计划中体现

**问题**：设计审查 P1-1 指出 "清零 prompt" 在同一 agent context 中执行时，agent 的 conversation history 仍包含失败信息，建议在设计中补充说明 subagent 执行方式是清零生效的前提。计划中 Task 3（buildCircuitBreakPrompt）和 Task 5（computeNextTask 集成）均未提及此问题的处理方式。

虽然设计审查将此定性为需要 "在设计文档中补充说明"，但如果不在实现中确保 `computeNextTask` 返回的 circuit-break prompt 以某种方式标记需要干净 context 执行（例如返回值中增加 `freshContext: true` 字段），清零效果将依赖主 agent 的行为约定，缺乏强制力。

**建议**：在 Task 5 中增加一条完成标准：CIRCUIT_BREAK 返回值中应包含标记（如 `freshContext: true` 或在 `agent` 字段中指定 subagent），使调用方能识别此 prompt 需要在干净 context 中执行。或者在 Task 5 描述中明确说明此为 non-goal，由调用方自行保证。

### P1-2：设计审查 P1-4（approach-plan.md 格式不规范时的恢复策略）未在计划中体现

**问题**：设计审查 P1-4 建议：当 `parseApproachPlan` 返回 null（Agent 只写了主方案没有备选）时，应在 revision prompt 中追加 "你的 approach-plan.md 缺少备选方案，请补充" 的提示。

计划中 Task 5（computeNextTask 集成）的描述和完成标准均未涉及此场景。如果 Agent 写了不合格的 approach-plan.md，当前计划的行为是静默退化为常规 revision 逻辑，Agent 不会得到任何关于 approach-plan.md 格式问题的反馈，后续重试中仍不会输出合格的方案计划。

**建议**：在 Task 5 中增加：当 `handleApproachFailure` 返回 CONTINUE 且检测到 approach-plan.md 存在但解析失败时，在 revision prompt 中附加方案计划补充提示。或者在 Task 4（handleApproachFailure）中返回一个额外字段 `planFeedback`，由 Task 5 在构建 revision prompt 时拼入。

---

## P2：优化建议，可选

### P2-1：Task 6 中 step "4a" 追加方案计划指令的实际效果需考虑

**问题**：查看 `buildTaskForStep` 代码（`orchestrator.ts:503-511`），step "4a" 在有 feedback 时走 `buildRevisionPrompt` 路径，没有 feedback 时返回一段简短的修复提示。Task 6 要求对 "4a" 追加方案计划指令，但 "4a" 本质是一个修复/验证 step，Agent 在此 step 首次执行时通常不会做创造性的工作（安装依赖、选择工具等），断路器的价值有限。

设计文档 4.7 节和 AC-8 之间本身就存在不一致（P2-4），建议在实现时统一：只对 step "3" 和 "5b" 追加方案计划指令，"4a" 可选择不追加。

### P2-2：Task 9 的测试覆盖可进一步细化

Task 9 描述了 5 个测试场景，但缺少以下边界场景的测试：
- 方案 A 失败 1 次后成功，然后方案 A 再次失败 -- 验证 failCount 是否正确累积（测试 P1-2 修复的持久化逻辑）
- 方案切换后 stepIteration 重置为 0 的场景下，后续 revision 时 stepIteration 是否正确递增

建议在 Task 9 中补充这两个场景。

### P2-3：Task 1 和 Task 4 可考虑合并

Task 1（扩展 StepState 接口和读写函数）和 Task 4（handleApproachFailure 核心逻辑）高度相关，且 Task 1 的改动量很小（接口定义 + readStepState/writeStepState 各加一个字段）。分开可能导致 Task 1 独立测试困难（没有消费方）。不过当前拆分也可接受，不影响实现。

---

## Checklist 逐项评估

| 检查项 | 结果 | 备注 |
|--------|------|------|
| AC 覆盖 | PASS | AC-1~AC-8 均有对应任务覆盖。AC-1/AC-6 -> Task 7, AC-2/AC-7 -> Task 8, AC-3/AC-4/AC-5 -> Task 9, AC-8 -> Task 9 |
| 任务粒度 | PASS | 10 个任务均在 2-10 分钟范围内，无需拆分 |
| 依赖正确性 | PASS | Task 4 依赖 Task 1/2/3, Task 5 依赖 Task 4, Task 7/8/9 依赖对应实现任务，Task 10 依赖 7/8/9。DAG 无环，顺序合理 |
| 文件准确性 | PASS | 所有文件路径已验证存在：`mcp/src/orchestrator.ts`, `mcp/src/orchestrator-prompts.ts`, `mcp/src/__tests__/orchestrator.test.ts`, `mcp/src/__tests__/orchestrator-prompts.test.ts` |
| 完成标准 | PASS (minor) | 每个任务均有具体完成标准，可验证。P1-1/P1-2 指出的遗漏点需补充完成标准 |
| 设计审查 P1 覆盖 | NEEDS_ATTENTION | P1-2（持久化）和 P1-3（stepIteration 交互）已覆盖。P1-1（清零 context 保证）和 P1-4（格式不规范恢复策略）未覆盖 |
| 遗漏检查 | PASS | 设计文档中描述的所有代码改动均在计划中体现 |

---

## 结论

**PASS** -- 实施计划整体质量良好，任务拆分合理、依赖正确、文件路径准确、AC 覆盖完整。两个 P1 问题涉及设计审查中提出但未在计划中落地的改进建议，建议在实现前补充到 Task 4 和 Task 5 的描述和完成标准中，避免实现阶段遗漏。P2 问题为优化建议，可在实现阶段灵活处理。
