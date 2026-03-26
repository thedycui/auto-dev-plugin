# Phase 4 独立裁决

你是独立裁决者。你的默认立场是 FAIL。
PASS 必须对每条检查项提供证据（文件名:行号），FAIL 只需说明理由。
PASS 的举证成本远大于 FAIL —— 如果你不确定，判 FAIL。

## 框架统计（可信数据）
```
 docs/auto-dev/_global/lessons-global.json | 1003 +++++++++++++++++++++++++++--
 mcp/dist/index.js                         |  118 +++-
 mcp/dist/index.js.map                     |    2 +-
 mcp/dist/tribunal.js                      |  244 +++++--
 mcp/dist/tribunal.js.map                  |    2 +-
 mcp/node_modules/.package-lock.json       |  800 +++++++++++++++++++++++
 mcp/src/__tests__/tribunal.test.ts        |   39 +-
 mcp/src/index.ts                          |  136 +++-
 mcp/src/tribunal-schema.ts                |    8 -
 mcp/src/tribunal.ts                       |  278 ++++++--
 skills/auto-dev/SKILL.md                  |    9 +
 11 files changed, 2453 insertions(+), 186 deletions(-)

```

## Phase 1 设计评审
```
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

... (truncated, 10 lines omitted)
```

## Phase 2 计划评审
```
# 计划审查报告

## 总体评价
NEEDS_REVISION

## 问题列表

### P0 (阻塞性)

- [P0] **Task 6 遗漏 types.ts 修改 — 消费方路径未覆盖**

  `auto_dev_tribunal_verdict` 工具需要校验 digest 文件并写 checkpoint，但计划中未提及修改 `mcp/src/types.ts`。当前 `StateJson` schema 中没有记录 tribunal 来源（`source: "claude-p" | "fallback-subagent"`）的字段。如果 Task 6 要在 tribunal log 中标记 source 并持久化到 state，需要先扩展 types。

  此外，`executeTribunal` 当前返回 `ToolResult` 类型，Task 4 新增的 `TRIBUNAL_PENDING` 返回需要确认 `auto_dev_submit` 在 index.ts 中的消费方（第 1441-1443 行）能正确透传这个新状态给 MCP 调用方。当前代码 `return { content: tribunalResult.content }` 会直接透传 JSON 文本，这一点是兼容的，但**计划中没有显式提及验证这条消费路径**。

  建议：在 Task 4 或 Task 6 中增加显式步骤 "验证 auto_dev_submit -> executeTribunal -> TRIBUNAL_PENDING 返回链路的完整性"。

- [P0] **Task 6 缺少 digestHash 重算逻辑的完整描述 — digest 文件路径如何确定？**

  `auto_dev_tribunal_verdict` 工具收到 `digestHash` 后需要"重新读取 digest 文件计算 hash 比对"，但工具参数中没有 `digestFile` 路径。工具需要从 `projectRoot + topic + phase` 推算出 `outputDir`，再拼出 `tribunal-digest-phase${phase}.md` 路径。这依赖 `StateManager` 的 `outputDir` 属性。

  计划未说明这个路径推算逻辑，Task 6 完成标准也未验证"能正确定位 digest 文件"。如果路径拼错，digestHash 校验永远失败。

  建议：Task 6 描述中明确标注 "通过 `new StateManager(projectRoot, topic).outputDir` 获取 outputDir，拼接 digest 文件路径"，完成标准增加 "digest 文件路径能被正确定位"。

### P1 (重要)

- [P1] **Task 1 的辅助函数 `safeRead`、`getKeyDiff`、`getPhaseFiles` 未拆分为独立子任务**

  Task 1 描述为"重写 prepareTribunalInput"，同时新增 3 个辅助函数 + diff 截断策略（按文件均匀分配行数），改动量远超单个 2-10 分钟任务的范围。设计文档中仅 `getKeyDiff` 的截断策略就需要：解析 git diff 输出、按文件分组、均匀分配行数预算、排除模式匹配。

  建议：将 Task 1 拆为：
  - Task 1a: 新增 `safeRead` + `getPhaseFiles` 辅助函数
  - Task 1b: 新增 `getKeyDiff`（含截断策略）
  - Task 1c: 重写 `prepareTribunalInput` 主函数（组装 digest）

- [P1] **Task 5 crossValidate 增强 — Phase 4 的"diff 非空"检查需要 startCommit 参数，但当前 crossValidate 签名已有此参数（仅 Phase 5 使用）**

  当前 `crossValidate` 的 `startCommit` 参数仅在 `phase === 5` 分支使用。Task 5 要为 Phase 4 增加"diff 非空"检查，同样需要 `startCommit` 来执行 `git diff`。这不是问题（参数已存在），但 **executeTribunal 中崩溃路径（Task 4 的 crashed=true）跳过了 crossValidate**。

  设计文档 4.3 节显示：crashed=true 时直接返回 TRIBUNAL_PENDING，不走 crossValidate。这意味着 fallback 路径的 crossValidate 完全依赖 Task 6 的 `auto_dev_tribunal_verdict` 工具来执行。计划中 Task 6 描述了"调用 crossValidate"，但完成标准没有明确覆盖 "Phase 4/6/7 的 crossValidate 增强逻辑在 fallback 路径中被执行"。

  建议：Task 5 的完成标准增加 "crossValidate 的 Phase 4/6/7 增强在 auto_dev_tribunal_verdict 中也能被正确调用"。

- [P1] **Task 3 改变 runTribunalWithRetry 返回类型 — 路径激活风险**

  `runTribunalWithRetry` 当前返回 `TribunalVerdict`，Task 3 要改为 `{ verdict: TribunalVerdict; crashed: boolean }`。`executeTribunal` 是唯一消费方（tribunal.ts 第 460 行），Task 4 会同步修改消费方。但**没有任何测试覆盖这个返回类型变更**。现有测试文件 `mcp/src/__tests__/tribunal.test.ts` 需要同步更新。

  计划中全部 Task 的 TDD 都标记为 skip，且没有单独的测试更新任务。设计文档 AC-3 明确要求"单元测试：mock execFile 返回错误，验证返回值"，但计划中没有对应任务。

  建议：增加 Task 3.5 "更新 tribunal.test.ts 中 runTribunalWithRetry 相关测试用例，覆盖 crashed=true/false 两种返回"。

- [P1] **Task 7 依赖关系不完整 — 应依赖 Task 1**

  Task 7 描述为"从 tribunal-schema.ts 移除 TRIBUNAL_MAX_TURNS，更新 tribunal.ts 中所有引用"。但 Task 1 重写 `prepareTribunalInput` 时如果仍然引用了 `TRIBUNAL_MAX_TURNS`（当前第 17 行 import），会在 Task 7 执行时产生编译错误。Task 7 依赖写为 "Task 2"，但实际上 Task 1 也可能引入对 `TRIBUNAL_MAX_TURNS` 的新引用（虽然设计上不应该）。

  更重要的是：Task 1 重写 prepareTribunalInput 时不应再 import TRIBUNAL_MAX_TURNS，但 import 语句（第 17 行）同时导入了 `TRIBUNAL_SCHEMA`，需要保留。Task 1 应当修改 import 语句移除 `TRIBUNAL_MAX_TURNS`，这与 Task 7 的职责重叠。

  建议：将 TRIBUNAL_MAX_TURNS 的清理统一放在 Task 7，但 Task 7 依赖应改为 "Task 1, Task 2"（确保 prepareTribunalInput 已重写完毕不再使用 maxTurns 后再删除常量）。

### P2 (优化建议)

- [P2] **Task 6 是最大最复杂的任务（~60 行新代码 + 完整校验链），建议拆分**

  Task 6 包含：工具注册 + schema 定义 + digestHash 校验 + passEvidence 校验 + crossValidate 调用 + tribunal log 写入 + checkpoint 写入 + 三种返回状态。建议拆为 "注册工具骨架 + 参数校验" 和 "核心裁决逻辑 + checkpoint" 两个子任务。

- [P2] **Task 8 SKILL.md 更新缺少具体行数/位置描述**

  当前 SKILL.md 第 43-47 行是 tribunal 处理逻辑，Task 8 需要在此处插入 TRIBUNAL_PENDING 分支。建议在任务描述中标注具体插入位置。

- [P2] **缺少 Phase 5 特殊处理的说明**

  Task 1 的 `getPhaseFiles` 需要为 Phase 5 内联 `framework-test-log.txt` 和 `framework-test-exitcode.txt`，但这两个文件是 `prepareTribunalInput` 自身在 Phase 5 时执行 testCmd 后才产生的。需要确保文件生成逻辑（当前第 146-179 行）在内联读取之前执行。计划未明确这个执行顺序约束。

## 审查清单结果

### A. 设计覆盖
- [x] 设计文档核心功能均有对应任务覆盖（预消化、CLI 修复、崩溃检测、PENDING 返回、crossValidate 增强、新工具、SKILL.md）
- [x] AC-1 到 AC-11 均有对应任务
- [ ] **AC-3/AC-5/AC-10/AC-11 要求单元测试，但计划中没有测试任务**（见 P1 问题）

### B. 任务分解质量
- [ ] Task 1 和 Task 6 过大，建议拆分（见 P1/P2）
- [x] 任务间依赖关系基本正确
- [x] 基础设施（Task 1/2）优先于上层逻辑（Task 4/6），顺序合理

### C. 文件路径准确性
- [x] `mcp/src/tribunal.ts` — 存在
- [x] `mcp/src/tribunal-schema.ts` — 存在
- [x] `mcp/src/index.ts` — 存在
- [x] `skills/auto-dev/SKILL.md` — 存在
- [ ] **遗漏 `mcp/src/types.ts`**（可能需要修改，见 P0）
- [ ] **遗漏 `mcp/src/__tests__/tribunal.test.ts`**（需要更新测试，见 P1）

### D. 完成标准
- [x] Task 2/7/9 的完成标准客观可验证
- [ ] Task 1 "digest 内容包含内联的审查材料和 diff stat" 略模糊 — 未指定各 phase 的具体文件清单
- [ ] Task 6 "接受 verdict/issues/passEvidence/digestHash 参数，执行完整校验链" — "完整校验链" 定义模糊

```

## 主 Agent 的代码审查
```
# Phase 4 深度代码审查报告 — tribunal-resilience

**审查范围**：tribunal.ts, tribunal-schema.ts, index.ts, SKILL.md, tribunal.test.ts
**审查日期**：2026-03-26

---

## P0：阻塞性问题

### P0-1：`tribunalTextResult` 导入但从未使用（Dead Import）

**文件**：`/Users/admin/.claude/plugins/auto-dev-plugin/mcp/src/index.ts:24`

```typescript
import { executeTribunal, crossValidate, buildTribunalLog, textResult as tribunalTextResult } from "./tribunal.js";
```

`tribunalTextResult` 在 index.ts 全文中仅出现在 import 语句中，从未被调用。index.ts 使用的是自己定义的 `textResult`（第 42 行）。这是一个 dead import，可能会导致 TypeScript 严格模式或 lint 规则报错。

**修复建议**：从 import 语句中移除 `textResult as tribunalTextResult`。

**严重程度修正**：此项实际影响取决于项目的 lint/tsconfig 配置。如果 `noUnusedLocals` 未开启，则降级为 P1。但鉴于它是 dead code，建议清理。

---

### P0-2：`getKeyDiff` 和 `crossValidate` Phase 4 的 `startCommit` 为 undefined 时 fallback 到 `"HEAD"` 可能导致误判

**文件**：`/Users/admin/.claude/plugins/auto-dev-plugin/mcp/src/tribunal.ts:152, 454`

当 `state.startCommit` 为 undefined 时：

- `getKeyDiff` 第 152 行：`const diffBase = startCommit ?? "HEAD"` → `git diff HEAD` 只显示**未提交的变更**
- `crossValidate` Phase 4 第 454 行：同样 fallback 到 `"HEAD"` → `git diff --stat HEAD` 只显示未提交变更

如果 Phase 3 的所有代码已经 commit（正常流程中 Phase 3 每个 task 结束都会 `git commit`），则 `git diff HEAD` 返回空 → `crossValidate` 会错误地将 PASS 覆写为 FAIL（"git diff 为空，没有任何代码变更"）。

**影响路径**：`executeTribunal` → `crossValidate(phase=4)` → 错误返回 TRIBUNAL_OVERRIDDEN

**修复建议**：
1. 确认 `state.startCommit` 在 `auto_dev_init` 时必定被设置（检查 init 逻辑）
2. 如果确实可能为 undefined，Phase 4 的 diff fallback 应改为 `"HEAD~20"` 或使用 `git log --oneline` 检查是否有提交记录，而非假设 `HEAD` 有未提交变更

**验证状态**：经查 index.ts 第 171 行，`auto_dev_init` 中通过 `gitManager.getHeadCommit()` 获取并在第 185 行持久化到 state。正常初始化的会话 `startCommit` 必定有值。但 types.ts 第 122 行定义为 `z.string().optional()`，意味着旧版/迁移的 state 可能为 undefined。风险可控但存在。**降级为 P1**——建议在 `crossValidate` Phase 4 中对 `startCommit` 为 undefined 的情况给出更明确的 warning 而非静默 fallback 到 `HEAD`。

---

## P1：重要问题

### P1-1：TRIBUNAL_PENDING 返回路径 — 全新路径，从未在生产环境验证

**路径**：`executeTribunal()` crashed=true → 返回 TRIBUNAL_PENDING → 主 Agent 收到后调用 subagent → `auto_dev_tribunal_verdict()`

**未验证环节**：
1. `executeTribunal` 第 592-602 行：TRIBUNAL_PENDING 返回的 `digest` 字段包含完整 digest 内容（可能很大，达 50KB），通过 JSON 序列化后作为 MCP tool response 返回。需确认 MCP 协议对 response 大小无限制
2. SKILL.md 第 49-56 行：主 Agent 需要从 `submit_result.digest` 中取出内容作为 prompt 传给 subagent，然后从 subagent 输出中"提取 verdict JSON"——这个提取过程完全依赖主 Agent 的解析能力，没有框架保障
3. `auto_dev_tribunal_verdict` 工具（index.ts 1452-1577）：整条路径从未被执行过

**缓解**：crossValidate 在 fallback 路径中同样会执行（index.ts 1514），提供了硬数据兜底。但 digestHash 校验路径（index.ts 1492-1499）也从未验证过。

**修复建议**：在测试中增加 `auto_dev_tribunal_verdict` 的完整路径测试，至少覆盖：
- digestHash 匹配成功 + PASS + crossValidate 通过 → TRIBUNAL_PASS
- digestHash 不匹配 → DIGEST_HASH_MISMATCH
- PASS 无 passEvidence → PASS_EVIDENCE_REQUIRED
- PASS + crossValidate 失败 → TRIBUNAL_OVERRIDDEN

---

### P1-2：`auto_dev_tribunal_verdict` 使用动态 import 而非静态 import

**文件**：`/Users/admin/.claude/plugins/auto-dev-plugin/mcp/src/index.ts:1549-1550`

```typescript
const { internalCheckpoint: ckpt } = await import("./state-manager.js");
const { computeNextDirective: computeND } = await import("./phase-enforcer.js");
```

这两个模块在文件顶部已有静态 import（第 7 行 `import { internalCheckpoint, StateManager }` 和第 15 行 `import { computeNextDirective }`）。在 `auto_dev_tribunal_verdict` 中使用动态 import 是冗余的，且可能导致混淆：如果静态 import 的版本和动态 import 的版本在 module resolution 上有差异（例如 ESM 缓存问题），可能产生微妙的 bug。

**修复建议**：直接使用已有的静态 import `internalCheckpoint` 和 `computeNextDirective`，移除动态 import。

---

### P1-3：`auto_dev_tribunal_verdict` 的 FAIL 路径不写 checkpoint

**文件**：`/Users/admin/.claude/plugins/auto-dev-plugin/mcp/src/index.ts:1568-1575`

当 fallback verdict 为 FAIL 时，只返回 TRIBUNAL_FAIL 状态和 issues，但**不写 checkpoint**。对比 `executeTribunal` 中的 FAIL 路径（tribunal.ts 639-645），同样不写 checkpoint。这意味着 FAIL 后 state.json 中的 phase/status 不更新。

这本身不是 bug（FAIL 后主 Agent 修复再重新 submit），但值得确认：tribunal submit counter 已在 `auto_dev_submit` 中递增（index.ts 1437），所以即使 FAIL 不写 checkpoint，counter 仍然正确追踪。

但注意：`auto_dev_tribunal_verdict` **不递增 submit counter**。这意味着如果 claude -p 崩溃 → TRIBUNAL_PENDING → fallback subagent 判 FAIL → 主 Agent 修复后重新 `auto_dev_submit` → submit counter 只计了第一次（auto_dev_submit 中递增），fallback 的这一轮不算在 counter 里。这可能导致 escalation 机制被绕过（理论上 3 次 submit 限制变成了"3 次 auto_dev_submit 调用"而非"3 次裁决尝试"）。

**修复建议**：评估是否需要在 `auto_dev_tribunal_verdict` FAIL 时也递增 submit counter，或者接受当前行为（因为 fallback 本身已经是一次额外的尝试机会）。

---

### P1-4：`crossValidate` Phase 5 的 `diffBase` 在 startCommit 为 undefined 时使用 `"HEAD~20"`

**文件**：`/Users/admin/.claude/plugins/auto-dev-plugin/mcp/src/tribunal.ts:478`

... (truncated, 110 lines omitted)
```

## 关键代码变更
```diff
diff --git a/docs/auto-dev/_global/lessons-global.json b/docs/auto-dev/_global/lessons-global.json
index a76a2d8..6c6402c 100644
--- a/docs/auto-dev/_global/lessons-global.json
+++ b/docs/auto-dev/_global/lessons-global.json
@@ -7,8 +7,97 @@
     "lesson": "Phase 1 required revision",
     "topic": "lessons-evolution",
     "reusable": true,
-    "appliedCount": 0,
-    "timestamp": "2026-03-25T09:48:52.283Z"
+    "appliedCount": 18,
+    "timestamp": "2026-03-25T09:48:52.283Z",
+    "lastAppliedAt": "2026-03-26T06:39:11.143Z",
+    "score": 32,
+    "feedbackHistory": [
+      {
+        "verdict": "helpful",
+        "phase": 1,
+        "topic": "tribunal",
+        "timestamp": "2026-03-26T01:44:15.528Z"
+      },
+      {
+        "verdict": "helpful",
+        "phase": 2,
+        "topic": "tribunal",
+        "timestamp": "2026-03-26T01:50:55.591Z"
+      },
+      {
+        "verdict": "helpful",
+        "phase": 3,
+        "topic": "tribunal",
+        "timestamp": "2026-03-26T02:09:39.569Z"
+      },
+      {
+        "verdict": "helpful",
+        "phase": 4,
+        "topic": "tribunal",
+        "timestamp": "2026-03-26T02:28:18.745Z"
+      },
+      {
+        "verdict": "not_applicable",
+        "phase": 5,
+        "topic": "tribunal",
+        "timestamp": "2026-03-26T02:35:10.224Z"
+      },
+      {
+        "verdict": "not_applicable",
+        "phase": 6,
+        "topic": "tribunal",
+        "timestamp": "2026-03-26T02:39:12.344Z"
+      },
+      {
+        "verdict": "helpful",
+        "phase": 6,
+        "topic": "tribunal",
+        "timestamp": "2026-03-26T02:43:09.229Z"
+      },
+      {
+        "verdict": "helpful",
+        "phase": 1,
... (truncated, 1080 lines omitted)
diff --git a/mcp/src/index.ts b/mcp/src/index.ts
index 8a5c2a1..c6091de 100644
--- a/mcp/src/index.ts
+++ b/mcp/src/index.ts
@@ -16,12 +16,13 @@ import { TemplateRenderer } from "./template-renderer.js";
 import { GitManager } from "./git-manager.js";
 import type { StateJson } from "./types.js";
 import { LessonsManager } from "./lessons-manager.js";
-import { validateCompletion, validatePhase5Artifacts, validatePhase6Artifacts, validatePhase7Artifacts, countTestFiles, checkIterationLimit, validatePredecessor, parseInitMarker, validatePhase1ReviewArtifact, validatePhase2ReviewArtifact, isTddExemptTask } from "./phase-enforcer.js";
+import { validateCompletion, validatePhase5Artifacts, validatePhase6Artifacts, validatePhase7Artifacts, countTestFiles, checkIterationLimit, validatePredecessor, parseInitMarker, validatePhase1ReviewArtifact, validatePhase2ReviewArtifact, isTddExemptTask, computeNextDirective } from "./phase-enforcer.js";
 import { validateRedPhase, buildTestCommand, TDD_TIMEOUTS } from "./tdd-gate.js";
 import { extractDocSummary, extractTaskList } from "./state-manager.js";
 import { runRetrospective } from "./retrospective.js";
 import { TRIBUNAL_PHASES } from "./tribunal-schema.js";
-import { executeTribunal } from "./tribunal.js";
+import { executeTribunal, crossValidate, buildTribunalLog } from "./tribunal.js";
+import type { ToolResult } from "./tribunal.js";
 import { getClaudePath } from "./tribunal.js";
 
 // ---------------------------------------------------------------------------
@@ -1444,6 +1445,137 @@ server.tool(
   },
 );
 
+// ===========================================================================
+// 15. auto_dev_tribunal_verdict (Fallback Tribunal Verdict)
+// ===========================================================================
+
+server.tool(
+  "auto_dev_tribunal_verdict",
+  "Submit tribunal verdict from fallback subagent review. Only valid after TRIBUNAL_PENDING.",
+  {
+    projectRoot: z.string(),
+    topic: z.string(),
+    phase: z.number(),
+    verdict: z.enum(["PASS", "FAIL"]),
+    issues: z.array(z.object({
+      severity: z.enum(["P0", "P1", "P2"]),
+      description: z.string(),
+      file: z.string().optional(),
+    })),
+    passEvidence: z.array(z.string()).optional(),
+    summary: z.string().optional(),
+    digestHash: z.string(),
+  },
+  async ({ projectRoot, topic, phase, verdict, issues, passEvidence, summary, digestHash }) => {
+    // 1. Validate phase is a tribunal phase
+    if (!(TRIBUNAL_PHASES as readonly number[]).includes(phase)) {
+      return textResult({
+        error: "INVALID_PHASE",
+        message: `Phase ${phase} 不是裁决 Phase。只有 Phase ${TRIBUNAL_PHASES.join("/")} 需要裁决。`,
+      });
+    }
+
+    // 2. Verify digestHash matches digest file
+    const sm = new StateManager(projectRoot, topic);
+    const outputDir = sm.outputDir;
+    const digestPath = join(outputDir, `tribunal-digest-phase${phase}.md`);
+    let digestContent: string;
+    try {
... (truncated, 99 lines omitted)
diff --git a/mcp/src/tribunal-schema.ts b/mcp/src/tribunal-schema.ts
index a6adf42..1f68c6a 100644
--- a/mcp/src/tribunal-schema.ts
+++ b/mcp/src/tribunal-schema.ts
@@ -43,13 +43,5 @@ export const TRIBUNAL_SCHEMA = {
   required: ["verdict", "issues"]
 };
 
-/** Per-phase max turns for tribunal agent */
-export const TRIBUNAL_MAX_TURNS: Record<number, number> = {
-  4: 10,
-  5: 8,
-  6: 6,
-  7: 6,
-};
-
 /** Phases that require tribunal judgment */
 export const TRIBUNAL_PHASES = [4, 5, 6, 7] as const;

diff --git a/mcp/src/tribunal.ts b/mcp/src/tribunal.ts
index 37dd224..0c461df 100644
--- a/mcp/src/tribunal.ts
+++ b/mcp/src/tribunal.ts
@@ -11,10 +11,11 @@
  */
 
 import { execFile, exec } from "node:child_process";
+import { createHash } from "node:crypto";
 import { readFile, writeFile, stat } from "node:fs/promises";
 import { join } from "node:path";
 import type { TribunalVerdict, StateJson } from "./types.js";
-import { TRIBUNAL_SCHEMA, TRIBUNAL_MAX_TURNS } from "./tribunal-schema.js";
+import { TRIBUNAL_SCHEMA } from "./tribunal-schema.js";
 import { getTribunalChecklist } from "./tribunal-checklists.js";
 import { generateRetrospectiveData } from "./retrospective-data.js";
 import { internalCheckpoint, StateManager } from "./state-manager.js";
@@ -86,63 +87,122 @@ export async function getClaudePath(): Promise<string> {
 }
 
 // ---------------------------------------------------------------------------
-// Tribunal Input Preparation
+// Digest Helpers (Task 1 + Task 2)
 // ---------------------------------------------------------------------------
 
 /**
- * Write tribunal-input-phase{N}.md and tribunal-diff-phase{N}.patch.
- * For Phase 5, also execute testCmd and write framework-test-log.txt / framework-test-exitcode.txt.
- * Returns the path to the input file.
+ * Read a file and truncate to maxLines. Returns null if file does not exist.
  */
-export async function prepareTribunalInput(
+export async function safeRead(path: string, maxLines: number): Promise<string | null> {
+  try {
+    const content = await readFile(path, "utf-8");
+    const lines = content.split("\n");
+    if (lines.length <= maxLines) return content;
+    return lines.slice(0, maxLines).join("\n") + `\n... (truncated, ${lines.length - maxLines} lines omitted)`;
+  } catch {
+    return null;
+  }
+}
+
+/**
+ * Return the list of files to inline for each tribunal phase.
+ */
+export function getPhaseFiles(
   phase: number,
   outputDir: string,
-  projectRoot: string,
-  startCommit?: string,
-): Promise<string> {
-  const inputFile = join(outputDir, `tribunal-input-phase${phase}.md`);
-
-  let content = `# Phase ${phase} 独立裁决\n\n`;
-  content += `你是独立裁决者。你的默认立场是 FAIL。\n`;
-  content += `PASS 必须对每条检查项提供证据（文件名:行号），FAIL 只需说明理由。\n`;
-  content += `PASS 的举证成本远大于 FAIL —— 如果你不确定，判 FAIL。\n\n`;
-
-  // File references — tribunal agent reads them via Read tool
... (truncated, 371 lines omitted)
diff --git a/skills/auto-dev/SKILL.md b/skills/auto-dev/SKILL.md
index a35c885..b4eeb17 100644
--- a/skills/auto-dev/SKILL.md
+++ b/skills/auto-dev/SKILL.md
@@ -44,7 +44,16 @@ while phase <= maxPhase:
         # submit 内部触发独立裁决 → 自动写 checkpoint
         # TRIBUNAL_PASS → 进入下一 Phase
         # TRIBUNAL_FAIL → 修复问题后重新 submit
+        # TRIBUNAL_PENDING → claude -p 崩溃，需 fallback subagent 裁决（见下方）
         # TRIBUNAL_ESCALATE → 3次失败，需人工介入
+        if submit_result.status == "TRIBUNAL_PENDING":
+            # Fallback: claude -p 崩溃，用 subagent 执行裁决
+            digest = submit_result.digest
+            digestHash = submit_result.digestHash
+            agent_result = Agent(subagent_type="auto-dev:auto-dev-reviewer",
+                                prompt=f"作为独立裁决者审查以下材料，按检查清单逐条判定:\n{digest}")
+            # 从 agent 输出中提取 verdict JSON（verdict, issues, passEvidence）
+            auto_dev_tribunal_verdict(projectRoot, topic, phase, verdict, issues, passEvidence, summary, digestHash)
     phase = submit_result.nextPhase or checkpoint_result.nextPhase
 auto_dev_complete()                       # 唯一的完成入口 → 验证所有 phase → build → test → COMPLETED
 # ⚠️ 任何其他方式宣称完成都是违规。checkpoint(status=COMPLETED) 会被框架硬拒绝。

```

## 检查清单

## 裁决检查清单（Phase 4: Code Review + Phase 1/2 回溯验证）

> 默认立场是 FAIL。PASS 必须逐条举证。

### A. 回溯验证（最高优先级）
- [ ] 逐条检查 designReview 中的每个 P0/P1 问题
- [ ] 在 design.md 或 diff 中找到对应修复证据
- [ ] 如果 designReview 中有 P0 未修复 → 直接 FAIL
- [ ] 逐条检查 planReview 中的问题，在 diff 中验证

### B. 代码审查
- [ ] 独立审查 diff，不要只依赖主 Agent 的 review 报告
- [ ] 检查设计文档中的每个需求是否在 diff 中有对应实现
- [ ] 检查安全问题（权限绕过、注入、数据泄露）
- [ ] 检查 API 一致性（前后端接口匹配）

### C. TDD Gate Verification (if tdd=true)
- [ ] Check state.json tddTaskStates: every non-exempt task should have status=GREEN_CONFIRMED
- [ ] If any task has status=RED_CONFIRMED or PENDING, TDD flow was not completed -> FAIL
- [ ] Cross-check: test files in diff should align with redTestFiles recorded in tddTaskStates

### D. 输出要求
- 回溯验证结果：TRACE: [Phase 1/2 问题描述] → FIXED / NOT_FIXED → [证据]
- 如果 FAIL，列出问题：ISSUE: [P0/P1] 问题描述 → 修复建议 → 涉及文件

