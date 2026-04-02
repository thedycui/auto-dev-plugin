# Plan Review

**审查对象**: `plan.md` (refactor-orchestrator-god-function)
**对照文档**: `design.md` (方案 B: 职责域拆分 + 消除重复)
**审查日期**: 2026-03-31

---

## P0 (阻塞性问题)

无。

## P1 (重要问题)

### P1-1: Task 4 替换内联代码时 `buildTaskForStep` 的 `getExtraVars` 参数丢失风险

**问题**: `computeNextTask` 中的内联 tribunal escalation 代码（Line 1282）和非 tribunal revision 代码（Line 1421）都调用了 `buildTaskForStep(..., getExtraVars(step))`。`getExtraVars` 是 `computeNextTask` 内部的闭包函数。当 Task 4 将 tribunal escalation 内联代码替换为 `handleTribunalEscalation(ctx, ...)` 时，该已有函数（Line 610-650）内部的 `buildTaskForStep` 调用（Line 642）**没有传递 `getExtraVars` / `extraVars` 参数**。

这意味着通过 `handleTribunalEscalation` 路径回退到 Phase 3 时，Ship Phase（Phase 8）的额外变量不会传递给 prompt 构建。虽然当前场景下 escalation regress 总是回退到 Phase 3（非 Phase 8），`getExtraVars("3")` 返回 `undefined`，所以实际行为一致。但这是一个**隐性假设**，未来如果 escalation 目标 phase 改变，会导致 prompt 缺少关键变量。

**修复建议**: 在 Task 3 改造 `handleTribunalEscalation` 签名时，确保 `buildTaskForStep` 调用能访问 `ctx.getExtraVars`。在 Task 4 的完成标准中增加一条："验证替换后的函数调用路径中，`buildTaskForStep` 的 `extraVars` 参数与内联代码行为一致"。

### P1-2: Task 6 的 `handleValidationFailure` 行数上限 150 行可能不够，缺少拆分预案

**问题**: 设计文档 AC-1 要求 `computeNextTask` 不超过 100 行，但对提取函数本身没有明确上限。Task 6 设定 `handleValidationFailure` 不超过 150 行。实测 Line 1156-1431 共约 275 行逻辑。虽然 tribunal 部分会委托给已有函数（Task 4 已完成），但剩余的 `regressToPhase`（约 36 行）、circuit breaker（约 33 行）、iteration limit + revision（约 50 行）、加上 tribunal 分发逻辑（约 30 行条件判断 + 函数调用），合计仍约 150 行，非常紧凑。

如果 Task 4 替换后的 tribunal 分发代码比预期多几行（例如需要增加日志、错误处理），150 行上限会被突破。

**修复建议**: 在 Task 6 描述中增加备选预案："如果 `handleValidationFailure` 超过 150 行，将 `regressToPhase` 和 `circuit breaker` 逻辑进一步提取为独立函数"。这不要求现在就做，只要求提前识别拆分点。

### P1-3: AC-10（关键路径日志）的任务覆盖不够具体

**问题**: AC-10 要求"关键决策路径（tribunal failure、circuit breaker、phase regress）有 console.error 级别日志"。AC 覆盖映射标注 Task 4 和 Task 6 覆盖此 AC，但 Task 4 和 Task 6 的描述和完成标准中都没有提到需要添加日志。如果实现者按照 Task 描述执行，日志可能被遗漏。

**修复建议**: 在 Task 4 或 Task 6 的完成标准中显式增加一条："tribunal failure、circuit breaker、phase regress 路径有 console.error 日志输出，包含 step 和 phase 信息"。

## P2 (优化建议)

### P2-1: Task 1 和 Task 7 可以合并或更明确地说明拆分理由

Task 1 创建 `ApproachStateSchema` 但不替换 `z.any()`，Task 7 才做替换。设计文档的迁移路径（Step 1 和 Step 5）确实建议分步，但 Task 1 完成后到 Task 7 执行之间可能间隔较久（Task 7 依赖 Task 6），中间状态是 schema 已定义但未使用。可以在 Task 1 描述中补充说明为什么不一步到位（"因为 Task 7 需要在 orchestrator.ts 中删除旧接口定义并更新 import，依赖 Task 6 完成后 orchestrator.ts 结构稳定"）。

### P2-2: 测试任务（Task 8-11）可以与实现任务并行

Task 8 依赖 Task 5，Task 9/10 依赖 Task 6，Task 11 依赖 Task 7。但测试的 mock 和断言逻辑设计可以在实现任务开始前就准备。建议在计划中标注"测试用例设计可提前，测试代码编写在对应实现完成后执行"，方便 TDD 风格的开发者提前规划。

### P2-3: 依赖关系图中 Task 1 到 Task 7 的箭头含义不够清晰

依赖关系图中 Task 1 通过长线连到 Task 7，但中间没有经过任何节点。建议在依赖图或文字中明确标注："Task 1 是 Task 7 的前置（schema 定义先于 schema 替换），但与 Task 2-6 的重构链路无依赖关系，可并行开发"。

---

## Coverage Matrix

| 设计章节/功能点 | 对应任务 | 覆盖状态 |
|---|---|---|
| 4.1 computeNextTask 最终骨架（thin orchestrator） | Task 5, Task 6 | 已覆盖 |
| 4.1 resolveInitialStep 提取 | Task 5 | 已覆盖 |
| 4.1 handleValidationFailure 提取 | Task 6 | 已覆盖 |
| 4.1 advanceToNextStep 提取 | Task 6 | 已覆盖 |
| 4.1 消除重复：替换 Tribunal 内联代码（4 段） | Task 4 | 已覆盖 |
| 4.2 ApproachState Zod Schema（3 个 schema） | Task 1 | 已覆盖 |
| 4.2 StateJsonSchema.approachState 替换 z.any() | Task 7 | 已覆盖 |
| 4.2 删除 orchestrator.ts 中旧 ApproachState 接口 | Task 7 | 已覆盖 |
| 4.3 OrchestratorContext 接口定义 | Task 2 | 已覆盖 |
| 4.3 effectiveCodeRoot 字段 | Task 2 | 已覆盖 |
| 4.3 已有 tribunal 函数签名统一改造（5 个） | Task 3 | 已覆盖 |
| 迁移路径 Step 5: .catch(undefined) + console.error 日志 | Task 7 | 已覆盖（但日志需见 P1-3） |
| 回滚方案：每个 Step 对应独立 commit | Task 12（隐含） | 部分覆盖 -- 计划未显式要求每个 Task 独立 commit |
| AC-1: computeNextTask <= 100 行 | Task 6, Task 12 | 已覆盖 |
| AC-2: 无重复 tribunal 内联代码 | Task 4 | 已覆盖 |
| AC-3: approachState 使用具体 schema | Task 7, Task 11 | 已覆盖 |
| AC-4: 现有测试无回归 | 每个 Task | 已覆盖 |
| AC-5: resolveInitialStep 测试 | Task 8 | 已覆盖 |
| AC-6: handleValidationFailure 测试 | Task 9 | 已覆盖 |
| AC-7: advanceToNextStep 测试 | Task 10 | 已覆盖 |
| AC-8: ApproachState 无重复定义 | Task 7 | 已覆盖 |
| AC-9: approachState 向后兼容 | Task 11 | 已覆盖 |
| AC-10: 关键路径日志 | Task 4, Task 6 | 部分覆盖（见 P1-3） |

---

## 结论

**NEEDS_REVISION**

计划整体质量高，任务拆分合理，依赖关系清晰，与设计文档的覆盖度完整。3 个 P1 问题需要修订：

1. **P1-1**: Task 3/4 需要确保 `handleTribunalEscalation` 中 `buildTaskForStep` 调用与内联代码的 `extraVars` 行为一致。
2. **P1-2**: Task 6 需要增加 `handleValidationFailure` 超限时的拆分预案。
3. **P1-3**: Task 4 或 Task 6 的完成标准需要显式包含 AC-10 的日志要求。

修订这 3 点后即可 PASS。
