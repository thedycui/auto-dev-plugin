# Plan Review（第二轮）

> 审查日期：2026-04-02
> 计划文件：`plan.md`（修订版）
> 设计文件：`design.md`
> 审查人：Phase 2 计划审查专家
> 上轮结论：NEEDS_REVISION（P0×2, P1×3）

---

## P0 (阻塞性问题)

无。

**P0-1 已修复**：Task 4 第 48-51 行明确列出全部 3 个 `buildTaskForStep("3", ...)` 调用点（`resolveInitialStep` 约 line 1220、`advanceToNextStep` 约 line 1554、`handleTribunalEscalation` 约 line 679），每处均有独立的 plan.md 读取和 `tasks` 注入说明。

**P0-2 已修复**：Task 4 完成标准第 2 条明确写出"tasks 字段在 step '3' 的全部 3 个 return 路径中均出现（`resolveInitialStep`、`advanceToNextStep`、`handleTribunalEscalation`），非 step '3' 的路径不携带 `tasks`"。

---

## P1 (重要问题)

无。

**P1-1 已修复**：Task 6 完成标准明确要求 `step` 字段使用 `firstStepForPhase(targetPhase)` 而非 `String(targetPhase)`，并补充了 `targetPhase=1` 时 `step="1a"`、`targetPhase=2` 时 `step="2a"` 的具体断言，以验证该函数被正确使用而非简单字符串转换。

**P1-2 已修复**：Task 3 描述部分第 37 行明确声明 `handleTribunalEscalation` 路径属于 escalation 路径，其失败上下文通过 `lastFeedback` 传递，不填充 `lastFailureDetail`，并注明"这是有意为之的设计决策"。完成标准亦与该决策保持一致（括号内明确说明该路径不单独填充及原因）。

**P1-3 已修复**：Task 4 描述第 52 行明确写出"三处均使用 `readFileSafe`（而非 `readFile`）以与 `buildTaskForStep` 内部实现保持一致，避免 plan.md 不存在时抛出异常"，完成标准第 5 条同样明确要求"上层读取 plan.md 使用 `readFileSafe`"。

---

## P2 (优化建议)

### P2-1：双次 IO 读取已知权衡在完成标准中仅披露于描述，测试未覆盖

Task 4 第 53 行描述中承认 `parseTaskList` 上层读取与 `buildTaskForStep` 内部 `extractTaskDetails` 存在双次 IO 读取，并指出"已在设计文档 4.3 节承认"。此为 P2 级优化建议，若后续性能敏感可将 plan.md 内容作为参数传入 `buildTaskForStep`，但当前实现层面已充分披露，无需修改。

### P2-2：Task 6 完成标准第 8 条提醒 import 补充（保留自上轮，已在计划中标注）

Task 6 完成标准第 8 条已明确注明"确认 `firstStepForPhase` 已从 `./orchestrator.js` 导入（`index.ts` 当前仅导入 `computeNextTask`，需补充 import）"。实现时需确保该条目被执行，否则 TypeScript 编译会失败（编译检查已在完成标准兜底）。

---

## AC 覆盖度（与上轮一致，P0/P1 修复后无变化）

| AC | 测试任务 | 覆盖状态 |
|----|---------|---------|
| AC-1 | Task 8 | 覆盖（含 phase=1 step="1a"、phase=2 step="2a" 断言，已在 Task 8 完成标准中明确）|
| AC-2 | Task 8 | 覆盖 |
| AC-3 | Task 8 | 覆盖 |
| AC-4 | Task 9 | 覆盖 |
| AC-5 | Task 7 | 覆盖（3 个调用点均注入 tasks，P0-1 已修复）|
| AC-6 | Task 7 | 覆盖 |
| AC-7 | Task 7 | 覆盖 |
| AC-8 | Task 7 | 覆盖 |
| AC-9 | Task 7 | 覆盖 |
| AC-10 | 无任务 | 手动集成验证，不在自动测试范围（同上轮 P2-3）|
| AC-11 | Task 9 | 覆盖 |
| AC-12 | Task 9 | 覆盖（TypeScript 类型检查）|
| AC-13 | Task 8 | 覆盖 |
| AC-14 | Task 9 | 覆盖 |
| AC-15 | Task 9 | 覆盖 |

---

## 结论

**PASS**

上轮 P0×2、P1×3 问题已在本次修订中逐条明确修复，无新增 P0/P1 问题。计划可进入实现阶段。

**问题**：Task 4 描述写道 "step '3' 分支（约第 679 行的 `buildTaskForStep("3", ...)` 调用所在函数）的上层调用点"，但实际代码中 line 679 位于 `handleTribunalEscalation` 函数内（tribunal 3 次未通过回退到 Phase 3 的路径），**不是** step "3" 的正常分发路径。

step "3" 的 `buildTaskForStep` 调用实际分散在以下 3 处：

| 调用位置 | 函数 | 触发场景 |
|---------|------|---------|
| line 679 | `handleTribunalEscalation` | tribunal 3 次失败 → 强制回退 Phase 3 |
| line ~1220 | `resolveInitialStep` | 首次启动 / 首次进入 step "3" |
| line ~1554 | `advanceToNextStep` | 上一个 step 验证通过后推进到 step "3" |

如果实现者只修改 line 679 附近，`tasks` 字段将只出现在 tribunal 强制回退场景，而正常 step "3" 派发（`resolveInitialStep` 和 `advanceToNextStep`）完全没有 `tasks`，AC-5/6/7 的正常路径无法通过。

**修复建议**：
Task 4 描述必须明确列出 **所有 3 个** `buildTaskForStep` 调用点，并说明在每个调用点的上层 return 处都需要注入 `tasks`。建议改写为：
> "在 `resolveInitialStep`（line ~1220）、`advanceToNextStep` 的 step "3" 分支（line ~1554）、`handleTribunalEscalation` 的回退路径（line ~679）三处的 return 对象中分别注入 `tasks`。"

---

### P0-2：Task 4 未覆盖 `handleTribunalEscalation` 注入 `tasks` 后的消费者风险（路径激活风险）

**问题**：`handleTribunalEscalation` 在 line 679 返回 step "3" 时，此路径历史上可能从未携带 `tasks` 字段。若只在 `resolveInitialStep` 和 `advanceToNextStep` 加了 `tasks`，而遗漏 `handleTribunalEscalation`，则 orchestrator 在 tribunal 强制回退后会以"无 `tasks`"进入 step "3"，退化为单 agent 模式（设计上说"parseTaskList 失败返回空数组"是退化兜底）。

但问题在于 `handleTribunalEscalation` 读 plan.md 时，该文件**已存在**（已通过 Task 2 生成），所以 `parseTaskList` **应当**成功。若此路径漏注入 `tasks`，AC-5 的测试可能因覆盖路径不完整而误报通过，但实际生产中 tribunal 回退后并行化失效，与设计目标不符。

**修复建议**：在 Task 4 的完成标准中明确加入："`handleTribunalEscalation` 回退到 step "3" 的 return 对象中也必须注入 `tasks`。"

---

## P1 (重要问题)

### P1-1：Task 6 design 与 plan 对 `step` 字段值的表述不一致

**问题**：设计文档 4.1 节写 `step = String(targetPhase)`（即 targetPhase=3 时 `step="3"`）；Task 6 描述写 `step="3"（由 firstStepForPhase(3) 得到）`。二者在 phase=3 时结果相同（"3"），但对于 phase=1（应为 "1a"）、phase=2（应为 "2a"）、phase=5（应为 "5a"）则不同。

AC-1 只测试了 `targetPhase=3`，掩盖了这个分歧。若实现者按设计文档用 `String(targetPhase)`，回退到 phase=1 后 `step="1"` 是无效 step，将导致 orchestrator 状态错乱。

`firstStepForPhase` 已在 orchestrator.ts 中导出且逻辑正确，Task 6 描述的用法是正确的。

**修复建议**：Task 6 完成标准中补充一条："对 `targetPhase=1` 验证 `step="1a"`，对 `targetPhase=2` 验证 `step="2a"`，以确认使用的是 `firstStepForPhase` 而非 `String(targetPhase)`"；同时在 Task 8 测试中补充对 phase=1 的 reset 断言。

### P1-2：Task 3 遗漏了 `handleTribunalEscalation` 内 `atomicUpdate` 的 `lastFailureDetail` 填充

**问题**：Task 3 描述的 4 条需填充路径为：Tribunal FAIL under limit（line 1378-1392）、普通 revision 路径（line 1432-1451）、`handlePhaseRegress`（line 1258-1277）、`handleCircuitBreaker` 内两个路径。

但设计文档 4.2 节的表格中包含 "Iteration limit exceeded" 之外的**全部 5 条 return 路径**。`handleTribunalEscalation` 回退到 Phase 3 时（line 669-684）没有填充 `lastFailureDetail`，设计文档将此路径纳入 `regressToPhase` 或归类为特殊路径并未明确说明是否需要填充。

检查代码：`handleTribunalEscalation` 执行 `atomicUpdate` 时已有足够的 `feedback`（参数名），但 Task 3 的描述未涉及此处。AC-14/15 测试对应 regress 和 ALL_EXHAUSTED 路径，均在 Task 9 覆盖，但 `handleTribunalEscalation` 的路径没有对应 AC 测试。

**修复建议**：在 Task 3 完成标准中明确注明 `handleTribunalEscalation`（line ~669）是否需要填充 `lastFailureDetail`；若需要，加入该调用点；若不需要，说明原因（如该路径已通过 step "3" 后续返回覆盖）。

### P1-3：Task 4 的 `parseTaskList` 读 plan.md 逻辑与 `buildTaskForStep` 内部已有读取逻辑重复

**问题**：`buildTaskForStep` 在 case "3" 内部（line ~1082-1115）已经 `readFileSafe(planPath)` 并调用 `extractTaskDetails(planContent)` 解析 plan.md。Task 4 要求在上层调用点**再次** `readFile(join(outputDir, "plan.md"), "utf-8")` 并调用 `parseTaskList`。

这导致对同一文件的两次 IO 读取，且两个解析函数（`extractTaskDetails` vs `parseTaskList`）语义重叠但实现不同，若 plan.md 在两次读取之间被修改（概率极低但存在），结果可能不一致。

**修复建议**：在 Task 4 的描述中明确此重复读取是已知权衡（设计文档 4.3 节已承认"不修改 buildTaskForStep 签名"），并在完成标准中加入"使用 `readFileSafe`（而非 `readFile`）以与内部实现保持一致，避免 plan.md 不存在时抛出异常"。

---

## P2 (优化建议)

### P2-1：Task 7 应明确 `improvements.test.ts` 已存在，需追加而非新建

`mcp/src/__tests__/improvements.test.ts` 已存在（覆盖之前 batch 的改进项），计划描述写"新建 `improvements.test.ts`"，实现者若直接新建会覆盖现有内容。建议改为"追加到 `improvements.test.ts`"。

### P2-2：`index.ts` 未 import `firstStepForPhase`，Task 6 需补充 import 语句

`index.ts` 当前 import 语句仅从 orchestrator 导入了 `computeNextTask`。`auto_dev_reset` 实现需要 `firstStepForPhase`，Task 6 描述中未明确提示需同步修改 import 行。建议在 Task 6 完成标准加一条："确认 `firstStepForPhase` 已从 `./orchestrator.js` 导入"。

### P2-3：AC-10（集成测试）缺少对应任务

AC-10 在 acceptance-criteria.json 中 layer 为 `manual`，设计文档将其标注为"集成测试"，但计划的 9 个 Task 中没有任何任务负责手动验证 AC-10。这在 Phase 5 测试阶段可能引起混淆，建议在计划末尾注明"AC-10 为手动集成验证，不在自动测试任务范围内"。

### P2-4：执行顺序图遗漏 Task 5 → Task 7 箭头

执行顺序图中 `Task 5 (tribunal 规模信号，独立)` 后用 `──> Task 7 (测试)` 表示依赖，但 Task 3 → Task 9 的依赖也应出现在图中（现在图中只有 `Task 3 ──> Task 9`，正确）。整体图形正确，仅 P2 级注释。

---

## AC 覆盖度总结

| AC | 测试任务 | 覆盖状态 |
|----|---------|---------|
| AC-1 | Task 8 | 覆盖（但应补充 phase=1 场景，见 P1-1）|
| AC-2 | Task 8 | 覆盖 |
| AC-3 | Task 8 | 覆盖 |
| AC-4 | Task 9 | 覆盖 |
| AC-5 | Task 7 | 覆盖（但前提是 Task 4 修正 P0-1）|
| AC-6 | Task 7 | 覆盖 |
| AC-7 | Task 7 | 覆盖 |
| AC-8 | Task 7 | 覆盖 |
| AC-9 | Task 7 | 覆盖 |
| AC-10 | 无任务 | 手动，未分配（P2-3）|
| AC-11 | Task 9 | 覆盖 |
| AC-12 | Task 9 | 覆盖（TypeScript 类型检查）|
| AC-13 | Task 8 | 覆盖 |
| AC-14 | Task 9 | 覆盖 |
| AC-15 | Task 9 | 覆盖 |

---

## 结论

**NEEDS_REVISION**

P0-1 和 P0-2 是阻塞性问题：Task 4 的调用点描述错误，若不修正将导致 AC-5/6/7 的正常 step "3" 路径缺少 `tasks` 注入，实现者极有可能只修改 `handleTribunalEscalation` 一处而遗漏 `resolveInitialStep` 和 `advanceToNextStep`。P1-1 涉及 `step` 字段值在非 phase=3 场景的正确性，需要在测试标准中补充覆盖。
