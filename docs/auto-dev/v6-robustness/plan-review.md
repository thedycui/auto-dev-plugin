# plan-review: auto-dev v6.0 plan.md

**审查人**: Phase 2 计划审查专家
**审查时间**: 2026-03-23
**审查对象**: plan.md (10 Tasks)
**对照文档**: design.md (4 改动项 + 5 AC)

---

## 1. AC 覆盖度检查

| AC | 对应 Task | 覆盖状态 |
|-----|----------|----------|
| AC-1: 迭代上限检测 | T2 (函数), T5 (集成) | 完整覆盖 |
| AC-2: progress-log 重建 state.json | T4 (方法), T6 (集成) | 完整覆盖 |
| AC-3: preflight 注入前序产出物 | T4 (辅助函数), T7 (集成) | 完整覆盖 |
| AC-4: REGRESS status | T1 (Schema), T3 (逻辑), T5 (集成) | 完整覆盖 |
| AC-5: 单元测试 | T8, T9, T10 | 完整覆盖 |
| AC-6: 现有测试不破坏 | 每个 Task 后 npm test | 完整覆盖 |

---

## 2. 发现的问题

### P1-1: Task 5 迭代限制集成 -- checkpoint 中 `status` 变量覆写后下游副作用未分析

**位置**: Task 5 第 4 点

**问题**: 当 `FORCE_PASS` 触发时，计划说"覆写 `status` 变量为 `PASS`"。但 `status` 在 checkpoint handler 中被多处消费：

1. **L236**: `sm.getCheckpointLine(phase, task, status, summary)` -- progress-log 写入的 CHECKPOINT 行会记录覆写后的 `PASS`，但 summary 中追加了 `[FORCED_PASS]` 标记。这是期望行为还是应该记录原始的 `NEEDS_REVISION`？
2. **L240**: `stateUpdates = { phase, status }` -- state.json 中 status 会被更新为 `PASS`。这是正确的（FORCE_PASS 语义就是强制通过）。
3. **L248**: phase timing 逻辑中 `status === "PASS"` 会触发 `completedAt` 记录。FORCE_PASS 也需要这个行为。正确。
4. **L345**: `computeNextDirective(phase, status, state)` -- 覆写后传入 `PASS`，会推进到下一 Phase。这是期望行为。

**结论**: progress-log 中的 CHECKPOINT 行会记录 `status=PASS` 而非 `NEEDS_REVISION`，如果后续 `rebuildStateFromProgressLog` 解析这行，会认为该 Phase 已 PASS。这与 FORCE_PASS 语义一致，但**计划中未明确说明这一设计决策**。

**建议**: 在 Task 5 中明确 -- FORCE_PASS 后写入 progress-log 的 CHECKPOINT status 应为 `PASS`（而非保留 `NEEDS_REVISION`），summary 中追加 `[FORCED_PASS: iteration limit exceeded]` 作为审计追踪。这已经是计划隐含的行为，但应显式说明避免实施时误解。

**严重度**: P1（应该修复 -- 缺乏明确说明可能导致实施者犹豫或写出不一致的实现）

---

### P1-2: Task 5 迭代限制 -- `iteration` 递增时机问题

**位置**: Task 5 第 4 点

**问题**: 计划说"当 `status === "NEEDS_REVISION"` 时，自动递增 iteration: `const newIteration = (state.iteration ?? 0) + 1`"。但这里有一个微妙问题：

- 递增后的 `newIteration` 用于 `checkIterationLimit` 判断
- 如果判断结果是 `CONTINUE`（允许继续），`newIteration` 需要写入 state.json
- 如果判断结果是 `FORCE_PASS`，status 被覆写为 `PASS`，此时 `iteration` 应该如何处理？重置为 0？还是保持递增后的值？
- 如果判断结果是 `BLOCK`，直接返回，`iteration` 不应写入

计划中只说了"自动递增 iteration"和"FORCE_PASS 时覆写 status"，但**没有说明 `newIteration` 何时写入 `stateUpdates`**。

**建议**: 在 Task 5 中补充：
- `CONTINUE`: `stateUpdates["iteration"] = newIteration`
- `FORCE_PASS`: `stateUpdates["iteration"] = 0`（Phase 完成，重置）
- `BLOCK`: 不写入 stateUpdates（直接返回，不更新 state）

**严重度**: P1（遗漏会导致 iteration 永远不递增，或者 FORCE_PASS 后遗留脏数据）

---

### P1-3: Task 7 preflight 增强 -- `renderer.render` 第三参数传递方式与现有代码不匹配

**位置**: Task 7 第 2 点

**问题**: 计划说"将 `extraContext` 传入 `renderer.render(mapping.promptFile, variables, extraContext)` 的第三个参数"。查看 index.ts L440，当前调用是：

```ts
const rendered = await renderer.render(mapping.promptFile, variables);
```

而 `TemplateRenderer.render()` 已经接受可选的第三参数 `extraContext?: string`。所以技术上可行。

但计划说"新逻辑完全替换 `index.ts` L434-L443 的 `if (mapping) { ... }` 块，而非追加"（来自 design.md 集成点说明）。而 Task 7 的描述却说"在现有 prompt 渲染逻辑之后、`result.suggestedPrompt = ...` 赋值之前，插入 extraContext 构建逻辑"。

这两个说法矛盾：design.md 说"替换"整个块，plan.md 说"插入"到块内。

**建议**: 统一为"修改"现有块：保留 L434-443 的整体结构，仅修改 L440 的 `renderer.render` 调用以传入 `extraContext`，并在调用前构建 `extraContext` 变量。不需要替换整个块。

**严重度**: P1（design.md 与 plan.md 描述不一致，实施者可能按 design.md 重写整个块导致丢失 `suggestedAgent` 赋值等逻辑）

---

### P1-4: Task 6 resume 集成 -- `sm.atomicWrite` 和 `sm.stateFilePath` 的可访问性

**位置**: Task 6 第 1 点

**问题**: 计划中 dirty 修复逻辑调用了 `sm.atomicWrite(sm.stateFilePath, ...)` 和读取 `sm.stateFilePath`。查看 state-manager.ts：

- `stateFilePath` 是 `readonly` 公开属性（L91） -- 可访问
- `atomicWrite` 是 `async atomicWrite(filePath, content)` 公开方法（L292） -- 可访问

确认可行，但 index.ts 当前只在 checkpoint handler 内部使用了 `sm.stateFilePath`（L274），resume 分支此前没有直接访问过这些属性。需要确认 `readFile` 的 import 已存在（index.ts L12 有 `import { readFile, writeFile, stat } from "node:fs/promises"`）。

**结论**: 确认可行，无实际问题。此条降为信息说明。

**严重度**: 无（确认通过）

---

### P2-1: Task 4 辅助函数放置位置可优化

**位置**: Task 4

**问题**: `extractDocSummary` 和 `extractTaskList` 是纯文本处理函数，与 StateManager 的状态管理职责不相关。design.md 说"放在 `state-manager.ts` 中，避免 index.ts 继续膨胀"，这个理由合理但可考虑单独文件（如 `text-utils.ts`）。

**建议**: 可以接受当前方案。如果后续文本处理函数增多，再考虑抽离。

**严重度**: P2（代码组织优化建议，可选）

---

### P2-2: Task 10 将两个测试文件合并为一个 Task

**位置**: Task 10

**问题**: `state-rebuild.test.ts` 和 `preflight-context.test.ts` 合并为一个 Task。它们测试不同功能（AC-2 vs AC-3），合并可能导致 Task 粒度过粗，但由于都依赖 Task 4 的辅助函数，合并也合理。

**严重度**: P2（无实际风险，只是粒度偏好）

---

### P2-3: 缺少 `parseHeaderField` / `parseAllCheckpoints` 的导出说明

**位置**: Task 4 第 1-2 点, Task 10

**问题**: `parseHeaderField` 和 `parseAllCheckpoints` 在 Task 4 中描述为"模块级辅助函数"（未说明是否 export）。Task 10 中 `state-rebuild.test.ts` 需要测试 `rebuildStateFromProgressLog`（StateManager 实例方法），不直接测试这两个解析函数。但如果想做细粒度单元测试，需要 export。

**建议**: 这两个函数作为内部实现细节不 export 是合理的，通过 `rebuildStateFromProgressLog` 间接测试即可。保持不变。

**严重度**: P2（信息说明）

---

## 3. 依赖关系和拓扑排序验证

拓扑图声明：
```
T1 -> T2, T3, T4 -> T5 (依赖 T2, T3), T6 (依赖 T4), T7 (依赖 T4) -> T8 (依赖 T2), T9 (依赖 T3), T10 (依赖 T4)
```

实际依赖分析：
- T2 依赖 T1 的 StateJson 类型更新？不依赖。`checkIterationLimit` 函数签名只接受 `phase, currentIteration, isInteractive`，不直接使用 StateJson。但 T2 中的 `MAX_ITERATIONS_PER_PHASE` 不依赖任何 type 变更。**T2 对 T1 的依赖是弱依赖**，实际可并行。不影响执行。
- T3 依赖 T1：是的，`computeNextDirective` 需要 `state.regressionCount` 字段（T1 新增）。
- T4 依赖 T1：弱依赖。`rebuildStateFromProgressLog` 需要组装 `StateJson`，但 `regressionCount` 是 optional，不影响重建逻辑。
- T5 依赖 T2 和 T3：正确。
- T6 依赖 T4：正确。
- T7 依赖 T4：正确（需要 `extractDocSummary`, `extractTaskList`）。
- T8-T10 依赖对应的源码 Task：正确。

拓扑排序正确，执行顺序合理。

---

## 4. 调用方审查（规则 1）

### `computeNextDirective` 签名变更的调用方追踪

`computeNextDirective` 在 index.ts 中被调用 1 处（L345）。Task 5 已明确修改此调用以传入 `regressTo`。

但需要检查是否还有其他消费方。

搜索结果：`computeNextDirective` 仅在 `index.ts` L345 和 `improvements.test.ts` 中被调用。

**Task 9 (regress.test.ts) 测试新签名 -- 正确。**
**improvements.test.ts 中的现有测试调用 `computeNextDirective(phase, status, state)` 三参数形式 -- 因为 `regressTo` 是 optional，不会被破坏。AC-6 通过。**

确认无遗漏。

### `checkIterationLimit` 的消费方

新增函数，只在 Task 5 中集成到 checkpoint handler。无其他消费方。正确。

### `rebuildStateFromProgressLog` 的消费方

新增方法，只在 Task 6 中集成到 resume 分支。无其他消费方。正确。

---

## 5. 路径激活风险评估（规则 2）

### index.ts L100 resume 分支

当前代码中 `onConflict === "resume"` 分支（L100-131）是**生产在用**路径。Task 6 修改此路径，风险可控，但新增的 `rebuildStateFromProgressLog` 调用是**首次激活路径**。

Task 10 中的 `state-rebuild.test.ts` 覆盖了此路径。标记为**已覆盖**。

### checkpoint handler 中的 REGRESS 分支

全新路径。Task 5 实现，Task 9 测试。标记为**已覆盖**。

### checkpoint handler 中的迭代限制逻辑

全新路径。Task 5 实现，Task 8 测试。

但 **Task 8 只测试 `checkIterationLimit` 纯函数，不测试 checkpoint handler 中的集成逻辑**（status 覆写、stateUpdates 写入等）。这属于集成测试范畴，计划中缺失。

**标记为 P1-5**（见下）。

---

### P1-5: 迭代限制和 REGRESS 的集成测试缺失

**问题**: Task 8 和 Task 9 分别测试 `checkIterationLimit` 和 `computeNextDirective` 的纯函数逻辑，但不测试它们在 checkpoint handler 中的集成行为：
- FORCE_PASS 后 status 覆写是否正确传播到 progress-log 和 state.json
- BLOCK 时是否正确返回而不写入 state
- REGRESS 时 `regressionCount` 递增和 `iteration` 重置是否正确写入

这些都是 checkpoint handler 内的集成逻辑，需要 mock `StateManager` 或使用临时目录做集成测试。

**建议**: 在 Task 10 中增加一组 checkpoint 集成测试（或新增 Task 10.5: checkpoint-integration.test.ts），覆盖：
1. checkpoint(NEEDS_REVISION) + iteration 超限 + 非 interactive -> 返回 PASS + FORCED_PASS 标记
2. checkpoint(REGRESS, regressTo=1) -> state.regressionCount 递增
3. checkpoint(REGRESS) 无 regressTo -> 返回错误

如果集成测试成本过高（需要完整 MCP server mock），可接受当前方案，但应在计划中明确标注"集成测试通过手动验证覆盖"。

**严重度**: P1（首次激活路径缺乏集成测试是高风险）

---

## 6. 复杂度评估验证

| Task | 计划评估 | 审查评估 | 说明 |
|------|---------|---------|------|
| T1 | S | S | 3 处 Schema 新增，正确 |
| T2 | S | S | 1 个常量 + 1 个接口 + 1 个函数，正确 |
| T3 | M | M | 需要在守卫之前精确插入，逻辑分支较多，正确 |
| T4 | M | M | 1 个实例方法 + 4 个辅助函数，正确 |
| T5 | M | M-L | 涉及 status 覆写的副作用分析，比计划评估稍复杂 |
| T6 | M | M | try-catch 嵌套，正确 |
| T7 | S | S | 条件注入，正确 |
| T8 | S | S | 纯函数测试，正确 |
| T9 | S | S | 纯函数测试，正确 |
| T10 | M | M | 两个测试文件，需要 mock，正确 |

---

## 7. 文件影响完整性

计划中的文件影响与 design.md 一致：
- types.ts, phase-enforcer.ts, state-manager.ts, index.ts + 4 个新测试文件

行号引用全部与当前源码匹配，验证通过。

---

## 总结

| 严重度 | 数量 | 详情 |
|--------|------|------|
| P0 | 0 | -- |
| P1 | 4 | P1-1 FORCE_PASS 写入行为未显式说明; P1-2 iteration 写入时机遗漏; P1-3 design/plan 描述矛盾; P1-5 集成测试缺失 |
| P2 | 3 | P2-1 辅助函数位置; P2-2 Task 粒度; P2-3 内部函数导出 |

**判定: NEEDS_REVISION**

需要修复 P1-1, P1-2, P1-3 后重新提交。P1-5 可以在计划中标注"集成测试通过手动验证"来解决，也可以新增集成测试 Task。

---

## 第二轮审查

**审查人**: Phase 2 计划审查专家
**审查时间**: 2026-03-23
**审查对象**: plan.md (修订版，针对第一轮 P1-1/P1-2/P1-3/P1-5 的修复)

---

### 1. P1 修复逐条验证

#### P1-1: FORCE_PASS 写入行为未显式说明 -> 已修复

**位置**: Task 5 第 4 点，`[P1-1 修复]` 标记处（L209-211）

修订版明确说明了三种 action 的完整行为：
- `CONTINUE`: 递增并写入 iteration
- `FORCE_PASS`: 覆写 status 为 `PASS`，progress-log CHECKPOINT status 记录为 `PASS`（非 NEEDS_REVISION），summary 中 `[FORCED_PASS]` 标记作为审计追踪，iteration 重置为 0，调用 `lessons_add` 记录遗留问题
- `BLOCK`: 直接返回，不写入 stateUpdates

设计决策已显式化，实施者不会产生歧义。**验证通过。**

#### P1-2: iteration 写入时机遗漏 -> 已修复

**位置**: Task 5 第 4 点（L209-212）

三种情况下 `iteration` 的写入行为均已明确：
- `CONTINUE`: `stateUpdates["iteration"] = newIteration`
- `FORCE_PASS`: `stateUpdates["iteration"] = 0`（Phase 完成，重置）
- `BLOCK`: 不写入 stateUpdates（不更新 state.json）

与第一轮 P1-2 建议完全一致。**验证通过。**

#### P1-3: design/plan 描述矛盾（preflight 替换 vs 插入） -> 已修复

**位置**: Task 7 第 2 点，`[P1-3 修复]` 标记处（L281-286）

修订版明确说明：
- "保留现有块的整体结构（包括 `suggestedAgent` 赋值），仅修改 L440 的 `renderer.render` 调用"
- "不替换整个 `if (mapping)` 块"

消除了 design.md "替换" 与 plan.md "插入" 之间的矛盾。**验证通过。**

#### P1-5: 集成测试缺失 -> 已修复（手动验证方案）

**位置**: 执行检查清单末尾，`[P1-5 修复]` 标记处（L388-391）

修订版选择了手动验证方案，给出了两个具体验证场景：
1. NEEDS_REVISION 超限 + 非 interactive -> 验证 progress-log CHECKPOINT status 为 PASS + summary 含 `[FORCED_PASS]`
2. REGRESS 场景 -> 验证 state.json 中 regressionCount 递增且 iteration 重置

并给出了推迟自动化集成测试的理由（需要 mock 完整 MCP server，成本较高）。方案合理，风险可接受。**验证通过。**

---

### 2. 修复是否引入新问题

#### P2-4: REGRESS BLOCKED 时 regressionCount 仍被递增（语义偏差）

**位置**: Task 5 第 5 点（L214-218）与 Task 3 第 2 点（L132）的交互

**分析**: Task 5 中 REGRESS 处理流程为：先构建 `stateUpdates["regressionCount"] = (state.regressionCount ?? 0) + 1`，然后调用 `computeNextDirective`。如果 `computeNextDirective` 因 `regressionCount >= 2` 返回 BLOCKED，stateUpdates 中已经包含了递增后的 regressionCount。若后续代码仍将 stateUpdates 写入 state.json，则 regressionCount 会从 2 变为 3（或更高），即使回退实际未执行。

**影响评估**: 由于 Task 3 的阻断条件是 `>= 2`，一旦达到 2 就永远 BLOCKED，所以递增到 3 不改变行为结果。功能上无 bug，只是语义不够精确。

**建议**: 如果追求精确，可在 BLOCKED 返回时跳过 stateUpdates 写入（与 BLOCK 在迭代限制中的处理保持一致）。但这不阻塞实施。

**严重度**: P2（语义偏差，无功能影响）

---

### 3. 总结

| 严重度 | 数量 | 详情 |
|--------|------|------|
| P0 | 0 | -- |
| P1 | 0 | 第一轮 4 个 P1 全部修复验证通过 |
| P2 | 1 | P2-4 REGRESS BLOCKED 时 regressionCount 递增的语义偏差 |

**判定: PASS**

所有 P1 问题已正确修复，未引入新的阻塞性或重要问题。P2-4 可在实施阶段酌情处理。计划可以进入实施阶段。
