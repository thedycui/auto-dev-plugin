# v6-robustness 设计审查报告

**审查阶段**：Phase 1 - 架构评审
**审查时间**：2026-03-23
**审查文档**：design.md
**源码参照**：mcp/src/types.ts, phase-enforcer.ts, state-manager.ts, index.ts, template-renderer.ts

---

## P0：阻塞性问题

### P0-1: checkpoint 中 REGRESS 状态被 `computeNextDirective` 拦截，永远无法到达 REGRESS 处理逻辑

**问题描述**：设计文档第 227 行提出在 `computeNextDirective` 中增加 `if (status === "REGRESS")` 处理分支。但现有 `computeNextDirective` 在第 52 行有一个前置守卫：

```ts
if (status !== "PASS" && status !== "COMPLETED") {
  return { phaseCompleted: false, ... mandate: "需要修复后重新检查" };
}
```

`REGRESS` 既不是 `PASS` 也不是 `COMPLETED`，会被这个守卫直接拦截返回"需要修复"指令，**永远无法到达新增的 REGRESS 分支**。

**修复建议**：在前置守卫中增加 REGRESS 的排除条件，或将 REGRESS 分支提前到守卫之前：

```ts
// 方案 A：REGRESS 分支提前
if (status === "REGRESS") {
  // ... REGRESS 处理逻辑
}

// 然后是原有的非 PASS/COMPLETED 守卫
if (status !== "PASS" && status !== "COMPLETED") { ... }
```

---

### P0-2: checkpoint 工具的 status enum 未包含 REGRESS，Schema 验证会拒绝该值

**问题描述**：`index.ts` 第 222 行 `auto_dev_checkpoint` 工具直接内联定义了 status 枚举：

```ts
status: z.enum(["IN_PROGRESS", "PASS", "NEEDS_REVISION", "BLOCKED", "COMPLETED"]),
```

设计文档只修改了 `types.ts` 中的 `PhaseStatusSchema`，但 `index.ts` 中的 checkpoint 工具注册使用的是**独立的内联枚举，并没有引用 `PhaseStatusSchema`**。即使修改了 `types.ts`，checkpoint 工具仍然不会接受 `REGRESS` 值，MCP 框架会在 Schema 验证阶段直接拒绝。

**修复建议**：设计文档应明确要求 `index.ts` 中 checkpoint 工具的 status 定义改为引用 `PhaseStatusSchema`，或者在内联枚举中也添加 `"REGRESS"`。同时，`regressTo` 参数也需要添加到 checkpoint 工具的 Schema 定义中。

---

### P0-3: checkpoint 中 REGRESS 缺少 `regressTo` 参数的传递路径

**问题描述**：设计文档提出 `CheckpointInputSchema` 新增 `regressTo` 字段，但 `index.ts` 中 `auto_dev_checkpoint` 的参数解构（第 226 行）没有提及如何接收和传递 `regressTo`。`computeNextDirective` 函数签名也没有 `regressTo` 参数——设计文档在伪代码中用注释 `/* 从 checkpoint 参数获取 */` 标注，但没有说明具体传递机制。

`computeNextDirective` 的当前签名是 `(currentPhase, status, state)`，`regressTo` 既不在参数中，也不在 `StateJson` 中（设计文档中 `StateJsonSchema` 只新增了 `regressionCount`）。

**修复建议**：需要明确 `regressTo` 的传递路径。两个方案：
1. 修改 `computeNextDirective` 签名，新增 `regressTo?: number` 参数
2. 在 checkpoint 工具内部处理 REGRESS 逻辑，不经过 `computeNextDirective`

推荐方案 1，因为 REGRESS 的回退计数校验属于 phase enforcement 职责。

---

## P1：重要问题

### P1-1: `rebuildStateFromProgressLog` 无法重建所有必需的 StateJson 字段

**问题描述**：`StateJsonSchema` 有多个必需字段（非 optional）：`topic`, `mode`, `phase`, `status`, `stack`（包含 language/buildCmd/testCmd/langChecklist）, `outputDir`, `projectRoot`, `startedAt`, `updatedAt`。

设计文档的重建逻辑只提到：
- 从 header 解析 mode
- 从 CHECKPOINT 解析 phase/status
- 调用 `detectStack()` 重新检测 stack

但缺少以下字段的重建来源：
- `topic`：progress-log header 中没有 topic 字段（见 `state-manager.ts` 第 277-280 行 header 格式）
- `outputDir` / `projectRoot`：这两个字段可以从 StateManager 实例属性获取，但设计文档未说明
- `startedAt`：header 中有 `Started:` 时间戳，但设计文档未明确映射

**修复建议**：
1. `topic` 可从 `StateManager` 的 `this.topic` 获取
2. `outputDir` / `projectRoot` 同理从实例属性获取
3. `startedAt` 从 header `> Started:` 行解析
4. 设计文档应列出每个必需字段的重建来源映射表

### P1-2: `rebuildStateFromProgressLog` 未处理 `dirty` 标志语义冲突

**问题描述**：设计文档说"重建后清除 dirty flag"（第 108 行注释），但 `rebuildStateFromProgressLog` 创建的是一个全新的 `StateJson` 对象，不存在 dirty flag 需要清除的问题。真正的风险是：state.json 损坏时 `loadAndValidate()` 在 dirty=true 时会抛出特定错误（`state-manager.ts` 第 161-166 行），此时 `rebuildStateFromProgressLog` 正确处理了（catch 后重建）。但如果 state.json 格式正确且 dirty=true，`loadAndValidate` 抛出的是 dirty 错误而非 parse 错误——设计文档的 catch 分支是否应该区分这两种错误？

**修复建议**：在 catch 分支中，如果错误消息包含 "dirty"，可以先尝试直接读取 state.json 手动清除 dirty flag 并 re-validate，而非直接走重建路径。重建是重量级操作，dirty 的修复可能更简单。

### P1-3: preflight 中 `renderer.render()` 调用签名与实际不一致

**问题描述**：设计文档第 162 行的 `renderer.render()` 调用：

```ts
const rendered = await renderer.render(mapping.promptFile, variables, extraContext);
```

这里试图将 `extraContext` 作为第三个参数传给 `render()`。查看 `template-renderer.ts` 第 21-25 行，`render` 方法签名确实接受 `extraContext?: string` 作为第三个参数，这是兼容的。

但问题在于：设计文档中 `extraContext` 是在 preflight 中构造的，而 preflight 当前（`index.ts` 第 440 行）调用 `renderer.render(mapping.promptFile, variables)` 没有传 `extraContext`。设计文档的代码片段需要替换 `index.ts` 第 434-443 行的整个 `if (mapping)` 块，但文档没有明确标注这一点，容易导致实施时遗漏或重复渲染。

**修复建议**：明确标注需要替换的代码行范围（index.ts L434-L443），说明新逻辑完全替代原有逻辑，而非追加。

### P1-4: REGRESS 回退后 iteration 计数器未重置

**问题描述**：当 Phase 4 回退到 Phase 1 时，改动项 1 的迭代限制逻辑会检查 iteration 计数。但 REGRESS 后 state.json 中的 `iteration` 字段没有被重置。如果回退前 Phase 4 已迭代 2 次，回退到 Phase 1 后 iteration 仍为 2，Phase 1 的首轮审查就会被计为第 3 轮（达到 max=3），导致误判。

**修复建议**：REGRESS 处理逻辑中，将 `iteration` 重置为 0 或 1。设计文档应在"checkpoint 集成"部分（第 251-254 行）明确添加 `iteration: 0` 的 state 更新。

### P1-5: Phase 6 的 MAX_ITERATIONS_PER_PHASE 设为 2 但实际无意义

**问题描述**：Phase 6（ACCEPTANCE）设了 max 2 轮迭代。但 Phase 6 的 checkpoint PASS 后直接进入 `auto_dev_complete`，没有审查循环。Phase 6 实际上不存在 NEEDS_REVISION 的迭代场景（验收要么通过，要么 BLOCKED 等人工介入）。设置迭代上限为 2 容易造成困惑。

**修复建议**：移除 Phase 6 的迭代上限或标注说明其语义。

### P1-6: 路径激活风险 -- `rebuildStateFromProgressLog` 是首次激活路径

**问题描述**（规则 2）：state.json 损坏后从 progress-log 重建的完整路径从未在生产中被执行过。progress-log 的 header 解析、CHECKPOINT 正则提取、detectStack() 重新检测、组装 StateJson 这些步骤的组合从未被验证。特别是：
- progress-log header 格式在 `state-manager.ts` 第 277-280 行定义，但从未被任何代码解析过
- detectStack() 被调用时 outputDir 可能已存在 node_modules 等干扰文件

这条路径应在测试阶段被重点覆盖。

**修复建议**：测试用例 `state-rebuild.test.ts` 应增加以下场景：
- progress-log header 中有额外空格/换行的容错
- 多个 CHECKPOINT 记录（包含 PASS + NEEDS_REVISION 混合）的正确解析
- detectStack() 在重建时失败的优雅降级

---

## P2：优化建议

### P2-1: 测试目录路径与实际不一致

设计文档写测试在 `mcp/src/__tests__/` 下（第 267 行），这与现有 `improvements.test.ts` 的位置一致，路径正确。但设计文档"文件影响清单"中只写了文件名没有完整路径前缀 `mcp/src/`（第 312-315 行），建议统一。

### P2-2: `extractDocSummary` 和 `extractTaskList` 放置位置建议

设计文档说这两个辅助函数放在 "index.ts 或 state-manager.ts"。建议放在独立的 `utils.ts` 文件或 `state-manager.ts` 中，因为 `index.ts` 已经很长（618 行），不应继续膨胀。

### P2-3: REGRESS 备份文件名策略可能冲突

设计文档说回退时给产出物加 `.v{N}` 后缀，但没有说明 N 的来源。如果使用 `regressionCount`，第一次回退时 regressionCount 已递增到 1，备份应为 `.v1`。但如果同一 phase 多次产出（如 Phase 1 迭代了 3 轮后被 REGRESS），只备份最终版本可能丢失中间迭代产出。建议直接使用时间戳后缀，与现有 `backupExistingDir` 的策略一致。

### P2-4: `checkIterationLimit` 的 `isInteractive` 参数来源

设计文档说从 state.json 的 `interactive` 字段获取。但 `interactive` 在 `StateJsonSchema` 中默认为 `undefined`（optional），设计文档应明确 `undefined` 时视为 `false`（即非 interactive 模式，超限则 FORCE_PASS）。

---

## 调用方审查（规则 1）

### `computeNextDirective` 的消费方

`computeNextDirective` 返回 `NextDirective`，被 `index.ts` checkpoint 工具消费（第 345 行），直接扩展到返回结果。设计新增的 REGRESS 分支返回了 `nextPhase` 字段，这与现有消费方兼容。

但需注意：REGRESS 返回中 `phaseCompleted: false` 但 `nextPhase` 不等于 `currentPhase`（而是 `regressTo`），这打破了现有语义假设——当前代码中 `phaseCompleted: false` 时 `nextPhase` 总是等于 `currentPhase`。消费方（Claude Agent 解析 mandate 文本）如果依赖 `nextPhase === currentPhase` 判断是否需要重试当前 phase，可能产生混淆。这不是代码 bug 但需要文档说明。

---

## 总结

| 级别 | 数量 | 描述 |
|------|------|------|
| P0 | 3 | REGRESS 逻辑被守卫拦截、checkpoint status enum 不含 REGRESS、regressTo 传递路径缺失 |
| P1 | 6 | state 重建字段不完整、dirty 语义冲突、preflight 替换范围不明、iteration 未重置、Phase 6 迭代无意义、首次激活路径风险 |
| P2 | 4 | 路径不一致、函数放置、备份策略、isInteractive 默认值 |

**评价：NEEDS_REVISION**

P0 问题集中在改动项 4（REGRESS）的设计上，存在 3 个相互关联的阻塞性问题，核心原因是设计未充分追踪 `computeNextDirective` 和 `auto_dev_checkpoint` 的现有实现细节。建议修复所有 P0 和 P1-4（iteration 未重置）后重新提交审查。

---

## 第二轮审查

**审查时间**：2026-03-23
**审查目标**：验证第一轮 P0/P1 问题的修复情况，检查是否引入新问题

---

### 第一轮问题修复验证

| 编号 | 问题 | 修复状态 | 验证说明 |
|------|------|----------|----------|
| P0-1 | REGRESS 被守卫拦截 | FIXED | design.md L286-314: REGRESS 分支已移至守卫之前，L317 才是原有守卫 |
| P0-2 | checkpoint status enum 不含 REGRESS | FIXED | design.md L336: 内联 enum 已添加 `"REGRESS"`，L339: 新增 `regressTo` 参数 |
| P0-3 | regressTo 传递路径缺失 | FIXED | design.md L279-283: `computeNextDirective` 签名新增 `regressTo?: number`；L359: checkpoint 中正确传递 |
| P1-1 | rebuild 字段不完整 | FIXED | design.md L103-114: 新增完整字段映射表，每个必需字段标注了来源（`this.topic`, `this.outputDir`, `this.projectRoot`, header 解析, `detectStack()`） |
| P1-2 | dirty 语义冲突 | FIXED | design.md L132-157: catch 分支区分 dirty 错误和其他错误，dirty 优先清除 flag 后 re-validate，失败才降级到重建 |
| P1-4 | iteration 未重置 | FIXED | design.md L353: `stateUpdates["iteration"] = 0`，L368 安全约束中重申 |
| P1-5 | Phase 6 迭代无意义 | FIXED | design.md L41-42: 移除 Phase 6 条目，注释说明验收不存在 NEEDS_REVISION 迭代 |

**附带修复的 P1/P2 问题**：

| 编号 | 修复状态 | 说明 |
|------|----------|------|
| P1-3 | FIXED | L229: 明确标注替换 `index.ts` L434-L443 |
| P1-6 | FIXED | 测试用例新增 header 容错、多 CHECKPOINT 混合解析、dirty 优先修复场景 |
| P2-2 | FIXED | L215: 辅助函数明确放在 `state-manager.ts` |
| P2-3 | FIXED | L355-356: 改用时间戳后缀备份 |
| P2-4 | FIXED | L56: 注释 `state.interactive ?? false` |

---

### 新问题检查

#### P2-5: `rebuildStateFromProgressLog` 中 `detectStack()` 失败未捕获

design.md L101 调用 `const stack = await this.detectStack()` 无 try-catch。如果 `detectStack()` 在重建场景下抛出异常（例如 projectRoot 目录被删除），整个重建流程会失败且无法降级。

**建议**：在 `detectStack()` 调用外包裹 try-catch，失败时使用默认 stack（如 `{ language: "unknown", buildCmd: "", testCmd: "", langChecklist: [] }`），并在 progress-log 中记录 warning。这不阻塞实施，实施时留意即可。

#### P2-6: dirty 修复路径依赖 `sm.atomicWrite` 和 `sm.stateFilePath` 的可见性

design.md L145 在 `index.ts` 中直接调用 `sm.atomicWrite(sm.stateFilePath, ...)`。已验证源码：`stateFilePath` 是 `readonly` public（state-manager.ts L91），`atomicWrite` 是 public method（L292）。兼容，无问题。

---

### 总结

| 级别 | 数量 | 描述 |
|------|------|------|
| P0 | 0 | 全部已修复 |
| P1 | 0 | 全部已修复 |
| P2 | 2 | detectStack 失败未捕获（新）、dirty 修复可见性已验证（无问题） |

**评价：PASS**

所有第一轮 P0 和 P1 问题均已正确修复，修复方案与源码实现兼容，未引入新的阻塞性问题。设计文档可进入实施阶段。
