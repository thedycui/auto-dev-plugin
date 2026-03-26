# 深度复盘报告：断路器机制（Circuit Breaker）

**Topic**: circuit-breaker
**执行时间**: 2026-03-26 14:06 ~ 15:04（约 58 分钟）
**模式**: full（全流程 6 阶段）
**最终结果**: PASS，8/8 AC 全部通过，303 测试全通过

---

## 1. 诚实度审计

### 1.1 阶段跳过检查

无跳过。全部 6 个阶段按顺序执行：
- Phase 1：设计 + 设计审查（PASS）
- Phase 2：计划 + 计划审查（PASS）
- Phase 3：实现（10 个任务完成，282/282 测试通过）
- Phase 4：代码审查 + Tribunal（PASS）
- Phase 5：E2E 测试 + Tribunal（PASS）
- Phase 6：验收 + Tribunal（PASS）

### 1.2 Review 真实性

**设计审查**：提出 4 个 P1 + 5 个 P2，质量较高。P1-2（approachState 持久化遗漏）是一个如果不修复将导致断路器永远无法触发的真实缺陷。P1-1（清零 prompt 在同一 context 中的锚定效应）是一个深度的架构分析，而非敷衍通过。

**计划审查**：追加了 2 个 P1，指出设计审查中的 P1-1 和 P1-4 未在计划中落地。这说明计划审查确实在独立审查而非简单重复设计审查结论。

**代码审查**：发现 1 个真实 P1（跨步骤状态泄漏）+ 3 个 P2。P1 需要修复才能 PASS，说明审查标准执行到位，没有因为"快完成了"而放水。

**Tribunal 裁决**：Phase 4 tribunal 逐条追踪了所有 P1 的修复证据（精确到源码行号），Phase 5 tribunal 逐个验证了 21 个测试用例的真实性和行号。裁决过程严谨，不是橡皮图章。

### 1.3 TDD 合规性

Phase 3 实现阶段严格按计划的 10 个任务执行，先实现功能（Task 1-6），后编写测试（Task 7-9），最后全量回归（Task 10）。测试从 262 个增长到 282 个（新增 20 个），Phase 5 又新增 18 个 E2E 测试，最终 303 个。

测试编号与 E2E 测试用例文档的 TC 编号对应，tribunal 验证了每个 TC 的代码行号，无虚假测试。

### 1.4 作弊行为

未发现。具体证据：
- 没有禁用测试（disabledTests=0）
- 没有跳过任何阶段
- 代码审查 NEEDS_FIX 后确实修复了代码再提交 tribunal
- 所有 Tribunal 均一次通过

---

## 2. 踩坑记录

### 2.1 代码审查 P1-1：跨步骤 approachState 泄漏

**问题**：步骤推进时 `writeStepState` 调用未包含 `approachState: null`，由于 `writeStepState` 使用 `Object.assign` 合并，旧步骤的 `approachState` 会残留在 state.json 中，导致新步骤首次失败时读到旧方案列表。

**根因**：`Object.assign` 的合并语义是"覆盖已有、保留未提及"，开发者容易忽略需要显式清除的字段。这与设计文档中未提及此场景有关。

**修复**：在步骤推进的 `writeStepState` 调用中加入 `approachState: null`。改动量极小（1 行），但影响严重。

**教训**：使用 partial state merge 模式时，状态转换点必须列出所有需要重置的字段，不能依赖"不提就不变"的隐式行为。

### 2.2 设计审查发现的持久化遗漏（P1-2）

设计文档 4.5 节中 `CONTINUE` 分支返回了 `approachState`，但 4.4 节 `computeNextTask` 的伪代码中只有 `CIRCUIT_BREAK` 分支调用了 `writeStepState`。如果不修复，`failCount` 永远不会累积，断路器永远不会触发。

这是设计阶段的逻辑遗漏，被设计审查准确捕获（P1-2），在计划阶段纳入 Task 5 的完成标准，在实现阶段修复。多阶段审查的拦截链在此处完美工作。

---

## 3. 亮点

### 3.1 Phase 1 + Phase 2 一次通过

设计审查和计划审查均为 PASS（非 NEEDS_REVISION），说明设计文档和计划质量本身较高。审查提出的 P1 问题是改进建议，不是阻塞性缺陷。

### 3.2 Phase 3 一次通过

10 个任务全部完成，282/282 测试通过，没有回归。实现阶段没有出现编译错误或测试失败需要返工的情况。

### 3.3 Tribunal 回溯验证机制

Phase 4 tribunal 的 "Phase 1/2 Traces" 部分逐条追踪了所有历史 P1 的修复状态，精确到源码行号。这个机制确保了早期审查发现的问题不会在后续阶段被遗忘。7 个 P1 全部标记为 FIXED 并附带代码证据。

### 3.4 TC-21 全生命周期测试

TC-21 通过 6 次 `computeNextTask` 调用模拟了 3 个方案从首次失败到 ALL_EXHAUSTED 的完整状态转换序列。这是本次 session 中最有价值的测试用例，它验证了断路器在连续调用中的状态一致性，比单点测试更能发现状态管理 bug。

### 3.5 设计文档的方案对比质量

设计文档提供了方案 A（Orchestrator 内置）和方案 B（纯 Prompt 驱动）的详细对比，包含 5 维度对比表。方案 B 的淘汰理由清晰（不解决锚定效应这个核心问题），设计审查也认可了选型结论。

---

## 4. 流程改进建议

### 4.1 耗时分析

| 阶段 | 耗时 | 占比 | 说明 |
|------|------|------|------|
| Phase 1（设计+审查） | ~7 min | 12% | 含设计文档编写 + 审查，效率高 |
| Phase 2（计划+审查） | ~5 min | 9% | 10 个任务计划 + 审查 |
| Phase 3（实现） | ~10 min | 17% | 10 个任务，2 文件修改 + 20 个测试 |
| Phase 4（代码审查+Tribunal） | ~14 min | 24% | 含 P1 修复 + tribunal |
| Phase 5（E2E 测试+Tribunal） | ~18 min | 31% | 18 个新测试 + tribunal |
| Phase 6（验收+Tribunal） | ~4 min | 7% | 验收报告 + 1 次 tribunal |
| **合计** | **~58 min** | **100%** | |

Phase 5 占比最大（31%），主要耗时在测试用例设计和编写。建议考虑：
1. E2E 测试用例设计完成后先由 tribunal 审批用例覆盖度，再编写代码，减少"代码写完了但用例有问题"的返工
2. 对于纯 orchestrator 逻辑的功能，E2E 测试与单元测试的边界可以更模糊，避免重复覆盖

### 4.2 Phase 3 与 Phase 5 测试重叠

Phase 3 实现阶段写了 20 个测试，Phase 5 E2E 阶段又写了 18 个。从 E2E 测试结果来看，Phase 5 的测试与 Phase 3 有明显重叠（如 parseApproachPlan 的基础用例在两个阶段都写了）。总计 38 个断路器测试中，约 30% 是重叠覆盖。

建议：Phase 3 只写核心单元测试（验证接口契约），Phase 5 专注集成路径和边界值，减少重复。

### 4.3 Tribunal 成本

从 tribunal 的 raw output 可以看到：
- Phase 4 tribunal 成本 $0.29（8 轮对话）
- Phase 5 tribunal 成本 $0.51（8 轮对话）

总 tribunal 成本约 $0.80+，占 session 总成本的可观比例。tribunal 的价值在于独立验证，但对于小型改动（本次实际只修改 2 个文件 ~200 行代码），3 个 tribunal 阶段可能偏重。

---

## 5. 技术经验

### 5.1 Object.assign 的状态合并陷阱

`writeStepState` 使用 `Object.assign(raw, updates)` 合并 partial state。这意味着：
- 写入 `{step: "next", stepIteration: 0}` 不会清除已有的 `approachState` 字段
- 必须显式写入 `{approachState: null}` 才能清除

这种模式在状态字段较少时尚可管理，但随着扩展字段增多（stepState 已有 step/stepIteration/lastValidation/approachState 四个字段），遗漏风险线性增长。

**建议**：考虑改为"全量覆盖"模式（每次写入完整的 StepState 对象），或增加一个 `clearStepState()` 函数在步骤切换时调用。

### 5.2 Invisible Framework 原则的持续验证

断路器的清零 prompt（`buildCircuitBreakPrompt`）严格遵守了 Invisible Framework 原则：不包含 checkpoint、tribunal、phase 等框架术语。AC-7 和 TC-11 专门验证了这一点。方案计划指令段（`approachPlanInstruction`）同样使用纯自然语言。

这说明 Invisible Framework 原则可以通过自动化测试（`containsFrameworkTerms`）持续保证，是一个可复用的质量门禁。

### 5.3 approach-plan.md 的容错设计

设计中对 approach-plan.md 的三种异常场景做了完整处理：
1. 文件不存在 -> 退化为现有 revision 逻辑（CONTINUE）
2. 文件存在但格式不规范（只有主方案） -> 返回 planFeedback 提示补充
3. 文件存在且格式正确 -> 正常初始化 approachState

这种"graceful degradation"的设计模式值得在其他解析 agent 产物的场景中复用。

---

## 6. 总结

本次 circuit-breaker session 是一次高质量的全流程执行：

1. **诚实度高**：无跳过、无作弊、代码审查发现真实 P1 并修复
2. **审查链条有效**：设计审查 P1-2（持久化遗漏）如果不被捕获，断路器将永远无法触发；代码审查 P1-1（状态泄漏）如果不被捕获，会导致跨步骤的错误行为
3. **测试覆盖扎实**：38 个新增测试，TC-21 全生命周期测试是亮点
4. **改进空间**：Phase 5 耗时占比过高（31%），Phase 3 和 Phase 5 的测试有重叠，可优化
5. **核心技术教训**：Object.assign 的 partial merge 模式需要在每个状态转换点显式清除不再适用的字段
