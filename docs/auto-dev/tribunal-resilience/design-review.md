# 设计审查报告

**审查时间**: 2026-03-26
**审查对象**: Tribunal 韧性改进设计文档
**审查者**: Design Reviewer (Phase 1)

## 总体评价

**NEEDS_REVISION**

设计方向正确，三层防线（预消化 + 权限修复 + fallback）思路合理，问题分析到位。但存在 2 个 P1 问题需要修订后才能进入计划阶段。

---

## 问题列表

### [P1] Fallback subagent 独立性严重不足 — 消费方路径未验证

设计中 fallback 路径为：主 Agent 收到 `TRIBUNAL_PENDING` -> 主 Agent 调用 Agent tool(subagent) -> 主 Agent 从 subagent 输出中"提取" verdict -> 主 Agent 调用 `auto_dev_tribunal_verdict` 提交。

问题在于：**主 Agent 完全控制了 verdict 的提取和提交过程**。主 Agent 可以：
1. 无视 subagent 的 FAIL 判定，向 `auto_dev_tribunal_verdict` 提交 PASS
2. 编造 passEvidence（从 digest 中摘抄文件名:行号即可）
3. 甚至不调用 subagent，直接构造 verdict 提交

虽然设计提到 `auto_dev_tribunal_verdict` 内置 crossValidate + passEvidence 校验，但 crossValidate 目前只在 Phase 5 有实质检查（测试退出码 + 文件数），Phase 4/6/7 的 crossValidate 返回 null（无检查）。这意味着 Phase 4/6/7 的 fallback 路径几乎没有防篡改能力。

**这正是"调用方审查"规则要求检查的：`auto_dev_tribunal_verdict` 是新的"生产者"，但它的消费方（crossValidate）在 Phase 4/6/7 路径上是空的。**

建议：
- 为 Phase 4/6/7 的 crossValidate 补充最低限度的硬数据校验（如 Phase 4 检查 diff 非空、Phase 7 检查 retrospective.md 行数）
- 或者在设计中明确承认 fallback 路径的独立性弱于 claude -p，并在 tribunal log 中标记 `source: "fallback-subagent"` 以便审计
- 考虑在 `auto_dev_tribunal_verdict` 中比对 digest 内容的 hash，防止主 Agent 不调用 subagent 就直接提交

### [P1] `executeTribunal` 改造细节缺失 — 崩溃判定与 TRIBUNAL_PENDING 返回的边界不清

设计 4.3 节描述了 fallback 流程，但没有说明 `executeTribunal` 函数本身如何改造。当前 `executeTribunal`（tribunal.ts:433-507）的逻辑是：
1. runTribunalWithRetry -> 拿到 verdict
2. 如果 verdict 是 PASS -> crossValidate -> checkpoint
3. 如果 verdict 是 FAIL -> 返回 TRIBUNAL_FAIL

**关键问题**：`runTribunalWithRetry` 在崩溃耗尽重试后，返回的是 `verdict: "FAIL"`（tribunal.ts:335-342），不是一个特殊的"崩溃"标记。`executeTribunal` 无法区分"裁决结果是 FAIL"和"进程崩溃导致的 FAIL"，因此无法决定何时返回 TRIBUNAL_PENDING。

建议：
- 明确 `runTribunalWithRetry` 的返回值需要新增 `crashed: boolean` 字段，或新增 `verdict: "CRASH"` 枚举值
- 在 `executeTribunal` 中根据 crashed 标志决定返回 TRIBUNAL_PENDING 还是 TRIBUNAL_FAIL
- 补充 `executeTribunal` 的改造伪代码，说明 TRIBUNAL_PENDING 返回值的具体结构（包含哪些字段）

### [P2] 预消化 diff 300 行截断可能丢失关键信息

设计选择截断到 300 行，但没有说明截断策略（前 300 行？按文件均匀分配？优先新增文件？）。如果一个大 PR 有 10 个文件变更，前 300 行可能只覆盖前 2-3 个文件，后续文件的变更完全看不到。

建议：
- 说明截断策略：建议按文件均匀分配行数（每文件 max N 行），而非全局截断
- 或者只截断单个文件的 hunk，保留每个文件至少前几行变更

### [P2] digest 大小目标不一致

背景部分说目标是 `<50KB`，但详细设计 4.1 节说 `<30KB`。AC-1 说 `<50KB`。应统一为同一个数字。

建议：统一为 `<50KB`（更保守，留余量）。

### [P2] `auto_dev_tribunal_verdict` 缺少 `topic` 来源说明

新工具参数中有 `topic`，但在 fallback 流程伪代码（4.4 节）中调用时没有传 `topic`。主 Agent 需要从哪里获取 topic？应明确说明从 `submit_result` 或 state.json 中获取。

### [P2] 回滚方案过于简略

"恢复 tribunal.ts 和 index.ts 到改动前版本"——实际改动涉及 4 个文件（tribunal.ts, tribunal-schema.ts, index.ts, SKILL.md），回滚方案应完整列出。

---

## 检查清单结果

### A. 方案完整性
- [x] 是否有至少 2 个方案对比？ — 方案一（预消化+权限修复+fallback）vs 方案二（Anthropic API），对比充分
- [x] 选型理由是否充分（量化对比）？ — 有 6 维度对比表，理由合理
- [x] 是否有回滚方案？ — 有，但过于简略（P2）

### B. 技术可行性
- [x] 预消化 digest 的大小控制是否合理？ — 合理，分阶段内联 + 行数截断，但截断策略需补充（P2）
- [x] `--dangerously-skip-permissions` 是否真的解决权限问题？ — 是，该 flag 跳过所有工具权限确认，设计已说明已验证
- [ ] fallback 到 subagent 的流程是否与现有 SKILL.md 编排兼容？ — **不完全兼容**，SKILL.md 驱动循环中没有处理 TRIBUNAL_PENDING 的分支（这正是要改的），但设计未充分说明主 Agent 篡改风险（P1）
- [ ] `auto_dev_tribunal_verdict` 新工具的参数是否完整？ — 缺少 `summary` 字段（现有 auto_dev_submit 有 summary），fallback 流程伪代码中 topic 来源不明（P2）

### C. 影响分析
- [x] 改动范围是否准确？有没有遗漏的文件？ — 基本准确。tribunal-checklists.ts 确认不需要改动（checklist 通过 getTribunalChecklist 函数获取，预消化只是改变了调用位置）
- [x] 向后兼容性是否充分考虑？ — TRIBUNAL_PENDING 安全降级为 FAIL 处理，合理
- [x] tribunal-checklists.ts 是否需要改动？ — 不需要，checklist 内容不变，只是内联方式变了

### D. 验收标准
- [x] AC 是否覆盖所有核心功能点？ — 8 条 AC 覆盖预消化、权限修复、fallback、新工具、SKILL.md
- [x] AC 描述是否具体可验证？ — 每条有明确的验证方式（单元测试/代码审查）
- [x] 是否有至少 3 条 AC？ — 8 条
- [ ] 正向和负向场景是否都覆盖？ — 缺少负向 AC：fallback subagent 返回 PASS 但 crossValidate 不通过时应返回 TRIBUNAL_OVERRIDDEN

### E. 风险
- [ ] 是否遗漏了重要风险？ — **遗漏**：fallback 路径下主 Agent 篡改 verdict 的风险（P1）；`executeTribunal` 无法区分崩溃 FAIL 和裁决 FAIL 的问题（P1）
- [x] 缓解措施是否可行？ — 已列出的 5 项风险缓解措施可行

---

## 总结

需要修订 2 个 P1 问题：
1. 补充 fallback 路径的防篡改机制（至少为 Phase 4/6/7 的 crossValidate 添加最低限度检查）
2. 明确 `executeTribunal` 如何区分崩溃和裁决 FAIL，补充改造伪代码

修订后可进入 Phase 2 计划阶段。
