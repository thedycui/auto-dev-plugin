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
