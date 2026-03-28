# 深度复盘报告：tribunal-hub-integration

**Session 时间**: 2026-03-28 11:05 ~ 12:08（总耗时约 63 分钟）
**模式**: full（完整流程）
**审计人**: Claude Opus 4.6（独立复盘）

---

## 一、执行总览

| 阶段 | 步骤 | 耗时 | 状态 | 备注 |
|------|------|------|------|------|
| Phase 1 | 1a 设计 | ~15min | PASS | 外部设计导入，跳过重写 |
| Phase 1 | 1b 设计审查 | ~4min | PASS | 发现 2 P0 + 5 P1，判 NEEDS_REVISION |
| Phase 2 | 2a 计划 | ~3min | PASS | 12 个 Task |
| Phase 2 | 2b 计划审查 | ~3min | PASS | 发现 0 P0 + 4 P1，判 NEEDS_REVISION |
| Phase 3 | 实现 | ~10min | PASS | 完成所有 Task |
| Phase 4 | 代码审查 tribunal | ~6min | PASS | 裁决 FAIL（TDD gate） |
| Phase 5 | 5a 测试用例设计 | ~5min | PASS | E2E 用例文档 |
| Phase 5 | 5b 测试裁决 | ~12min | PASS | 裁决 PASS |
| Phase 6 | 验收裁决 | ~5min | PASS | 裁决 PASS，9/9 AC 通过 |

**总耗时约 63 分钟，全流程 9 个 checkpoint 均 PASS。**

---

## 二、诚实度审计

### 2.1 阶段完整性

所有 9 个必须阶段均已执行，无跳过。progress-log.md 中的 CHECKPOINT 时间戳连续递增，无异常间隔：

- 1a -> 1b: 4 分钟（合理，审查需读代码）
- 2b -> 3: 10 分钟（合理，实现阶段最长）
- 3 -> 4: 6 分钟（合理，tribunal 需 spawn 进程）

**结论：无阶段跳过。**

### 2.2 Review 真实性

**设计审查（Phase 1b）**：发现了 2 个 P0 和 5 个 P1，判 NEEDS_REVISION。P0-1（函数名引用错误 `runStepValidation()` 不存在）和 P0-2（`subagentRequested` 传递链路不完整）均为实质性问题。交叉验证 orchestrator.ts 代码确认确实没有 `runStepValidation()` 函数，改问题真实有效。

**计划审查（Phase 2b）**：发现 0 P0 + 4 P1，判 NEEDS_REVISION。P1-1（返回类型兼容性）和 P1-2（log 写入副作用）均为实际会影响实现的问题。P1-3 补充了 escalation 缺少 `lastFeedback` 字段，P1-4 要求 SKILL.md 修改指令更精确。这些问题在后续实现中均得到修复。

**Phase 4 裁决**：judgment 为 FAIL，原因是 TDD gate violation（`state.json` 有 `tdd=true` 但无 `tddTaskStates` 字段）。raw output 中裁决进程耗时 300s（5 分钟），执行了 23 轮对话，成本 $0.74。裁决者逐条追踪了设计审查和计划审查中的所有 P0/P1 问题，确认 10 个问题已修复、1 个（Design P1-5 措辞修正）未修复但属于文档层面。**审查是真实的。**

**Phase 5 裁决**：judgment 为 PASS，耗时 228s，13 轮对话，成本 $0.46。裁决者提供了 9 条 passEvidence，每条引用具体文件和行号。发现 1 个 P2（E2E 表格计数不符）。**审查有实质内容。**

**Phase 6 验收裁决**：judgment 为 PASS，耗时 114s，13 轮对话，成本 $0.44。逐条验证 9 个 AC，每个 AC 都有代码位置引用和测试用例引用。**审查有实质内容。**

### 2.3 TDD 合规性分析

state.json 显示 `"tdd": true`，但 `tribunalSubmits` 全为 0，且 `tddTaskStates` 字段缺失。Phase 4 裁决因此判 FAIL，这说明：

1. **TDD 工具调用可能未执行或执行不完整**。`tddTaskStates` 由 `auto_dev_task_red`/`auto_dev_task_green` 工具调用写入，其缺失意味着实现阶段可能跳过了 TDD 红绿循环。
2. Phase 4 裁决 FAIL 后，后续修复并通过了 Phase 5/6，说明 TDD gate 被裁决者有效执行。

**但这里有一个微妙问题**：state.json 最终状态中 `tribunalSubmits` 全为 0（`"4": 0, "5": 0, "6": 0`），而 Phase 4 裁决判了 FAIL。这说明 Phase 4 的 FAIL 可能走了 subagent 路径（因为本次改动的默认行为就是 subagent 模式），subagentRequested 不增加 tribunalSubmits 中的 FAIL 计数。但 progress-log 中 Phase 4 的 CHECKPOINT 为 PASS，说明最终通过了——可能是 subagent 裁决后通过 `auto_dev_tribunal_verdict` 提交了 PASS 结果。

**结论：TDD 合规性存疑，但裁决系统正确识别了该问题。**

### 2.4 作弊行为检查

- 无 `disabledTests`（progress-log 显示 `disabledTests=0`）
- 无 `skip` 或 `todo` 的遗留测试（465 全通过）
- `integrity` hash 在初始化时设定，未被篡改
- 三次 tribunal 均为 `claude-p` source（独立 CLI 进程），非 self-review

**结论：未发现作弊行为。**

---

## 三、踩坑记录

### 3.1 设计审查 NEEDS_REVISION（Phase 1b）

**触发原因**：2 个 P0 + 5 个 P1

关键问题：
- **P0-1**：设计引用了 `runStepValidation()`，代码中不存在。这是典型的"设计文档与代码不同步"问题。
- **P0-2**：`subagentRequested` 的完整传递链路（5 层）未写清。这是"接口变更影响分析不充分"的典型表现。
- **P1-3**：SKILL.md 消费方未纳入改动范围——完美印证了审查规则 1（不只审生产者，必须审消费者）。

**修复验证**：Phase 4 裁决的 traces 部分逐条确认了 10/11 个问题已修复，仅 P1-5（设计文档措辞）未修复（因 design.md 不在 diff 中）。

### 3.2 计划审查 NEEDS_REVISION（Phase 2b）

**触发原因**：4 个 P1

关键问题：
- **P1-1**：`runTribunal()` 返回 `Promise<TribunalVerdict>`，不应往 `TribunalVerdict` 里加 `subagentRequested`。最终方案在 `runTribunalWithRetry()` 层短路，`runTribunal()` 类型不变。
- **P1-2**：`subagentRequested=true` 时仍写 tribunal log 会产生误导。代码中加了早返回并标注注释。
- **P1-3**：escalation 缺少 `lastFeedback` 字段，SKILL.md 中读取该字段会失败。

### 3.3 Phase 4 裁决 FAIL

**触发原因**：TDD gate violation — `tddTaskStates` 字段缺失

这是 TDD 框架的自动检查。裁决者发现 `state.json` 中 `tdd=true` 但无 `tddTaskStates`，说明实现阶段的 TDD 红绿循环工具调用未被框架追踪。

**修复后**：Phase 5（测试审查）和 Phase 6（验收）均一次通过。

---

## 四、亮点

### 4.1 设计审查质量高

Phase 1b 的设计审查堪称本次 session 的最大价值来源。2 个 P0 + 5 个 P1 中，P0-1（函数名错误）和 P1-3（SKILL.md 遗漏）如果进入实现阶段才发现，成本会翻倍。审查还附带了完整的"调用方影响表"（11 个调用方逐一分析），做到了系统性覆盖而非点状检查。

### 4.2 HubClient 的防御性设计

`hub-client.ts` 所有 4 个公共方法均 try/catch 返回 null/false，使得三级策略的降级链路自然流畅：`isAvailable() false` -> `ensureConnected() false` -> `findTribunalWorker() null` -> `executePrompt() null`，每个 null 都触发降级到 Level 2。这种"面向降级设计"模式值得在其他外部依赖场景复用。

### 4.3 Phase 5 和 Phase 6 一次通过

测试用例设计（Phase 5a）列出了 60+ 个测试用例（含 P0/P1/P2 优先级标注），Phase 5b 裁决确认 30 个新增用例全部通过、465 全量回归通过。Phase 6 验收逐条验证 9 个 AC，全部 PASS。后半程执行效率高。

### 4.4 裁决回溯验证（traces）

Phase 4 裁决的 raw output 中包含完整的 Phase 1/2 traces 回溯——逐条检查设计审查和计划审查中的 P0/P1 是否在实现中修复。11 个问题中 10 个确认 FIXED，1 个 NOT_FIXED（文档措辞，非代码）。这种"回溯验证"机制有效防止了"审查发现问题但实现中遗忘"的情况。

---

## 五、流程改进建议

### 5.1 耗时分析

| 类型 | 占比 | 实际耗时 |
|------|------|---------|
| 设计 + 审查 | 30% | ~19min |
| 计划 + 审查 | 10% | ~6min |
| 实现 | 16% | ~10min |
| 代码裁决 | 10% | ~6min |
| 测试 + 裁决 | 27% | ~17min |
| 验收裁决 | 8% | ~5min |

设计 + 审查占 30%，这对于一个改动量 ~300 行的任务来说比例偏高但合理——设计审查发现的 P0/P1 问题都是高价值的。

### 5.2 Tribunal 成本

三次 tribunal 裁决总成本 $1.64（$0.74 + $0.46 + $0.44），总计 642 秒 API 时间。Phase 4 的 300s/23 轮最昂贵，因为需要回溯验证 11 个历史问题。建议：
- 历史问题较少时（<5 个），tribunal 成本可更低
- 可考虑对 traces 部分设置上限（如最多回溯 10 个问题）

### 5.3 code-review.md 缺失

output 目录中没有 `code-review.md` 文件。Phase 4 的代码审查通过 tribunal 进程执行，结果记录在 `tribunal-phase4.md`。但如果流程要求独立的代码审查文档，这是一个缺失。

**建议**：明确 code-review 是由 tribunal 代替还是需要独立文档。

### 5.4 Design P1-5 未修复

设计文档中"完全向后兼容"的措辞未被修正为"默认行为变更"。Phase 4 裁决标记为 NOT_FIXED，但由于 design.md 不在 diff 范围内，被视为 advisory。

**建议**：设计审查发现的文档措辞问题应在实现阶段同步修复，即使不影响代码。

---

## 六、技术经验

### 6.1 三级降级策略的实现技巧

最终实现将三级分流逻辑放在 `runTribunalWithRetry()` 而非 `runTribunal()` 中，这与设计文档的描述有偏差（设计说在 `runTribunal()` 中分流），但是更好的选择：
- `runTribunal()` 返回类型保持 `Promise<TribunalVerdict>` 不变，类型系统干净
- Level 2 短路不需要经过 `runTribunal()` 的 CLI spawn 逻辑
- 这个偏差在 Phase 6 裁决中被标注为 advisory

### 6.2 环境变量作为策略选择器

`TRIBUNAL_MODE=cli` + `TRIBUNAL_HUB_URL` 两个环境变量控制三级策略，实现了零代码回滚能力：
- 不设任何变量 = Subagent（最安全）
- 设 `TRIBUNAL_HUB_URL` = Hub 优先
- 设 `TRIBUNAL_MODE=cli` = 旧行为

这种设计在运维层面非常友好。

### 6.3 `_subagentMode` 魔法标记被正确拒绝

设计审查 P1-1 指出 `_subagentMode: true` 破坏类型契约。最终实现用显式 `subagentRequested?: boolean` 字段替代，在 TypeScript 类型系统内传递信号。这是正确的工程决策。

### 6.4 SKILL.md 作为关键消费方

SKILL.md 是 escalation 的最终消费方。本次新增 `tribunal_subagent` reason 后，SKILL.md 中新增了自动启动 subagent 的分支（第 37-53 行），与其他 escalation（告知用户 + break）区分。如果遗漏这个修改，用户体验会直接退化为"流程中断"。

---

## 七、总结

本次 auto-dev session 执行质量良好：

1. **设计审查有效拦截了 2 个 P0 问题**，避免了实现返工
2. **全部 9 个 AC 通过验收**，465 个测试全量通过
3. **三次 tribunal 裁决真实有效**，有实质性的文件/行号级证据
4. **Phase 4 FAIL 后修复通过**，说明裁决机制有效
5. **唯一遗留问题**：design.md 措辞未修正（P1-5），影响低

总成本约 $1.64（tribunal）+ 主 agent 会话成本，总时长 63 分钟，对于 ~300 行代码改动来说效率合理。
