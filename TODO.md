# Auto-Dev Plugin TODO

> 来源：tribunal-hub-integration session 复盘 (2026-03-28)

---

## TODO-1: 明确 code-review.md 的产出规范

**背景**：Phase 4（代码审查）通过 tribunal 独立进程执行，审查结果记录在 `tribunal-phase4.md` 中。但 Phase 5a（测试设计）的 prompt 引用了 `code-review.md` 作为输入（需读取 Dormant Path Analysis），该文件不存在。后续 agent 只能跳过这个输入。

**问题**：
- 流程定义不清晰：code-review 到底是 tribunal 的副产物，还是需要独立产出？
- 下游消费方（Phase 5a）期望读取 `code-review.md`，但 tribunal 模式下不会生成该文件
- 如果 tribunal 裁决替代了 code-review，那 `tribunal-phase4.md` 应被软链接或重命名为 `code-review.md`

**解决方向**：
- 方案 A：Phase 4 tribunal 裁决完成后，框架自动将 tribunal 输出提取为 `code-review.md`（提取 P0/P1/P2 + Dormant Path 部分）
- 方案 B：在 `computeNextTask()` 的 Phase 4 步骤中，tribunal 裁决之外额外派发一个 `auto-dev-reviewer` subagent 生成独立的 code-review.md
- 方案 C：修改 Phase 5a prompt，将 code-review.md 改为可选输入，同时支持读取 `tribunal-phase4.md`
- 推荐方案 A，改动最小，且保持了下游 prompt 的一致性

---

## TODO-2: 设计审查发现的文档问题应在实现阶段闭环

**背景**：Phase 1b 设计审查发现 P1-5（设计文档中"完全向后兼容"的措辞不准确，应改为"默认行为变更"）。Phase 3 实现阶段只修改了代码文件，没有同步修改 `design.md`。Phase 4 tribunal 标记该问题为 NOT_FIXED，但因 design.md 不在 git diff 范围内，视为 advisory 放行。

**问题**：
- 设计审查的 P1 问题被发现但未闭环，形成了"发现 -> 记录 -> 遗忘"的死循环
- design.md 中的错误描述会误导后续读者（认为这是"完全向后兼容"的变更）
- 框架层面没有机制确保审查问题被实现阶段覆盖

**解决方向**：
- 在 Phase 3 的 task prompt 中注入设计审查和计划审查的 P0/P1 清单，要求开发 agent 逐条确认修复状态
- 对于文档类问题（非代码），在 plan.md 中显式创建"修复设计文档"任务
- Phase 4 tribunal 的 traces 回溯如果发现 NOT_FIXED 的 P0/P1，应自动降级为 NEEDS_REVISION（当前只是 advisory）

---

## TODO-3: TDD gate 的 tddTaskStates 追踪需要更可靠的框架支持

**背景**：`state.json` 中 `tdd=true`（默认开启），但 Phase 3 实现完成后 `tddTaskStates` 字段缺失。Phase 4 tribunal 因此判 FAIL（TDD gate violation）。实际原因是开发 agent 在实现过程中没有调用 `auto_dev_task_red` / `auto_dev_task_green` MCP 工具。

**问题**：
- TDD 工具调用完全依赖 agent 自觉——prompt 中虽有说明，但 agent 可能忽略
- `tddTaskStates` 缺失时 tribunal 判 FAIL，但 FAIL 后的修复路径不透明（是重新实现还是补测试？）
- TDD 模式下的 Phase 3 prompt 没有足够强的约束让 agent 必须走红绿循环

**解决方向**：
- 方案 A（框架层面）：Phase 3 每个 task 完成后，框架检查 `tddTaskStates[taskN]` 是否存在，不存在则拒绝推进到下一个 task
- 方案 B（prompt 层面）：在 Phase 3 的 task prompt 中加入硬性前置条件——"在写任何实现代码之前，必须先调用 `auto_dev_task_red` 注册测试，等测试红灯后再写实现"
- 方案 C（配置层面）：当 `changeType=feature` 且 `tdd=true` 时，在 `computeNextTask()` 中对每个 task 自动插入 red/green checkpoint
- 推荐方案 A + B 组合，框架强制 + prompt 引导双保险

---

## TODO-4: Tribunal 回溯验证（traces）的成本优化

**背景**：Phase 4 tribunal 需要回溯验证设计审查和计划审查中发现的所有 P0/P1 问题是否在实现中修复。本次 session 中有 11 个历史问题需要逐条验证，导致 tribunal 执行了 23 轮对话、耗时 300 秒、成本 $0.74（三次 tribunal 总成本 $1.64 的 45%）。

**问题**：
- traces 回溯是 tribunal 最耗时的部分，历史问题越多成本越高
- 部分问题（如 P1-5 文档措辞）不涉及代码变更，tribunal 仍需 grep 验证后标记 NOT_FIXED
- 缺少对 traces 数量的上限控制

**解决方向**：
- 在 tribunal digest 中对历史问题做预分类：代码类问题提供 grep 证据，文档类问题直接标记 DEFERRED
- 设置 traces 上限（如最多回溯 15 个问题），超出部分由主 agent 在 tribunal 裁决后补充验证
- 对 P2 及以下的历史问题不进入 traces，只回溯 P0/P1

---

## TODO-5: Subagent 模式下 tribunal 结果的审计追踪

**背景**：本次实现的三级策略中，Level 2（Subagent 默认模式）下 `evaluateTribunal()` 在 `subagentRequested=true` 时跳过了 tribunal log 写入（修复 Plan P1-2 的审计误导问题）。但这意味着 Subagent 模式下的裁决结果没有进入 `tribunal-phaseN.md` 日志。

**问题**：
- Subagent 裁决结果通过 `auto_dev_tribunal_verdict` MCP 工具提交，但提交内容不像 CLI tribunal 那样有完整的对话记录
- `progress-log.md` 中只记录了 CHECKPOINT 状态，没有裁决的详细 evidence
- 未来如果需要审计裁决质量（如复盘报告中的"裁决是否真实"），Subagent 模式缺乏审计材料

**解决方向**：
- `auto_dev_tribunal_verdict` 工具接收裁决结果时，将 verdict + evidence 写入 `tribunal-phaseN.md`（即使来源是 subagent 而非 CLI）
- 在 progress-log.md 中区分裁决来源（CLI/Hub/Subagent），方便复盘时评估
- Subagent 裁决的 prompt 中要求输出结构化的 evidence 列表，与 CLI tribunal 的 JSON schema 对齐
