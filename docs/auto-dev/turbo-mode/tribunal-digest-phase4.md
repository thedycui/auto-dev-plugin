# Phase 4 独立裁决

你是独立裁决者。你的默认立场是 FAIL。
PASS 必须对每条检查项提供证据（文件名:行号），FAIL 只需说明理由。
PASS 的举证成本远大于 FAIL —— 如果你不确定，判 FAIL。

## 框架统计（可信数据）
```
 mcp/dist/index.js                   |   2 +-
 mcp/dist/index.js.map               |   2 +-
 mcp/dist/phase-enforcer.js          |  14 +-
 mcp/dist/phase-enforcer.js.map      |   2 +-
 mcp/dist/state-manager.d.ts         |   2 +-
 mcp/dist/state-manager.js.map       |   2 +-
 mcp/dist/types.d.ts                 |   3 +
 mcp/dist/types.js                   |   2 +-
 mcp/dist/types.js.map               |   2 +-
 mcp/node_modules/.package-lock.json | 800 ++++++++++++++++++++++++++++++++++++
 mcp/src/index.ts                    |   2 +-
 mcp/src/phase-enforcer.ts           |  19 +-
 mcp/src/state-manager.ts            |   2 +-
 mcp/src/types.ts                    |   2 +-
 skills/auto-dev/SKILL.md            |  23 +-
 15 files changed, 856 insertions(+), 23 deletions(-)

```

## Phase 1 设计评审
```
# Design Review: turbo-mode

## 总体评价：PASS

## 检查结果

- [x] 三级模式设计清晰，各模式的必需 Phase 列表明确
- [x] turbo 模式保留 Phase 4（代码审查 tribunal）作为最低质量门禁，合理
- [x] 自动模式选择放在 SKILL.md 编排层，不增加 MCP 工具复杂度
- [x] 用户可通过 --turbo/--quick/--full 显式覆盖，灵活性足够
- [x] 向后兼容：现有 full/quick 模式行为不变
- [x] 改动范围完整：types.ts、phase-enforcer.ts、index.ts、SKILL.md、测试

## P1: computeNextDirective 中 turbo 模式的 Phase 跳转逻辑需明确

turbo 模式必需 Phase 为 [3, 4]。当 startPhase=3 时，Phase 3 PASS 后 computeNextDirective 返回 nextPhase=4。Phase 4 PASS 后需要返回 canDeclareComplete=true。

当前逻辑是 `let nextPhase = currentPhase + 1`，然后检查 `nextPhase > maxPhase`。turbo 模式需要修改 maxPhase 或在 nextPhase=5 时检查 turbo 模式直接返回 canDeclareComplete。

建议：在 computeNextDirective 中，turbo 模式时 maxPhase=4（而非 7），这样 Phase 4 PASS 后 nextPhase=5 > maxPhase=4，自然返回 canDeclareComplete=true。

## 无 P0 问题

```

## Phase 2 计划评审
```
# Plan Review: turbo-mode

## 总体评价：PASS

### A. 设计覆盖
- [x] AC-1（turbo 可用）→ Task 1 + Task 3
- [x] AC-2（turbo 完成门禁）→ Task 2（validateCompletion）
- [x] AC-3（computeNextDirective）→ Task 2
- [x] AC-4（现有模式不变）→ Task 2 中保留现有逻辑
- [x] AC-5（SKILL.md 自动选择）→ Task 4
- [x] AC-6（build + test）→ Task 5

### B. 任务分解
- [x] 5 个任务粒度合理
- [x] 依赖关系正确：Task 2/3 依赖 Task 1（类型定义先行）
- [x] Task 4（SKILL.md）独立于代码改动

### C. 文件路径
- [x] mcp/src/types.ts — 存在
- [x] mcp/src/phase-enforcer.ts — 存在
- [x] mcp/src/index.ts — 存在
- [x] skills/auto-dev/SKILL.md — 存在

### D. 风险
- [x] 无跨模块影响（phase-enforcer 的接口不变，只是内部逻辑扩展）

## 无 P0/P1 问题

```

## 主 Agent 的代码审查
```
# Phase 4 代码审查报告 — turbo-mode

**审查范围**：types.ts, phase-enforcer.ts, index.ts, state-manager.ts, SKILL.md
**审查日期**：2026-03-26

## P0：无

## P1：无

## P2：优化建议

### P2-1：phase-enforcer.ts 中硬编码类型字符串

`validateCompletion` 和 `computeNextDirective` 的 mode 参数使用硬编码字符串联合类型 `"full" | "quick" | "turbo"` 而非引用 ModeSchema 的推断类型。如果未来新增模式，需要在 3 处同步修改。

建议：使用 `z.infer<typeof ModeSchema>` 替代硬编码类型。但当前 3 处不多，可接受。

### P2-2：state-manager.ts init() 类型也需要同步

init() 的 mode 参数也使用了硬编码类型。同 P2-1。

## Caller-Side Review

| 生产者 | 消费者 | 状态 |
|--------|--------|------|
| ModeSchema("turbo") | state-manager.init() | OK — 类型已同步 |
| state.mode="turbo" | computeNextDirective() | OK — maxPhase=4 |
| state.mode="turbo" | validateCompletion() | OK — REQUIRED_PHASES_TURBO |
| SKILL.md 自动选择 | auto_dev_init(mode) | OK — 参数已支持 |

## 总结

**PASS**

改动量小（~15 行实际变更），逻辑简单：
1. ModeSchema 新增 "turbo" 枚举值 — 正确
2. REQUIRED_PHASES_TURBO = [3, 4] — 正确
3. computeNextDirective maxPhase = turbo ? 4 : 7 — 正确
4. validateCompletion 支持 turbo — 正确
5. SKILL.md 自动模式选择指南 — 清晰完整

现有 full/quick 模式逻辑未被改动，向后兼容。

```

## 关键代码变更
```diff
diff --git a/mcp/src/index.ts b/mcp/src/index.ts
index c6091de..9ced0a1 100644
--- a/mcp/src/index.ts
+++ b/mcp/src/index.ts
@@ -86,7 +86,7 @@ server.tool(
   {
     projectRoot: z.string(),
     topic: z.string(),
-    mode: z.enum(["full", "quick"]),
+    mode: z.enum(["full", "quick", "turbo"]),
     startPhase: z.number().optional(),
     interactive: z.boolean().optional(),
     dryRun: z.boolean().optional(),

diff --git a/mcp/src/phase-enforcer.ts b/mcp/src/phase-enforcer.ts
index 96422d0..ebef60a 100644
--- a/mcp/src/phase-enforcer.ts
+++ b/mcp/src/phase-enforcer.ts
@@ -26,6 +26,9 @@ const REQUIRED_PHASES_FULL = [1, 2, 3, 4, 5, 6, 7];
 /** quick 模式的必需 Phase */
 const REQUIRED_PHASES_QUICK = [3, 4, 5, 7];
 
+/** turbo 模式的必需 Phase */
+const REQUIRED_PHASES_TURBO = [3, 4];
+
 const MAX_ITERATIONS_PER_PHASE: Record<number, number> = {
   1: 3, 2: 3, 3: 2, 4: 3, 5: 3,
 };
@@ -104,7 +107,7 @@ export function computeNextDirective(
 ): NextDirective {
   const mode = state.mode;
   const isDryRun = state.dryRun === true;
-  const maxPhase = isDryRun ? 2 : 7;
+  const maxPhase = isDryRun ? 2 : mode === "turbo" ? 4 : 7;
 
   // REGRESS 分支必须在守卫之前
   if (status === "REGRESS") {
@@ -192,15 +195,17 @@ export interface CompletionValidation {
  */
 export function validateCompletion(
   progressLogContent: string,
-  mode: "full" | "quick",
+  mode: "full" | "quick" | "turbo",
   isDryRun: boolean,
   skipE2e: boolean = false,
 ): CompletionValidation {
   const basePhases = isDryRun
     ? [1, 2]
-    : mode === "quick"
-      ? REQUIRED_PHASES_QUICK
-      : REQUIRED_PHASES_FULL;
+    : mode === "turbo"
+      ? REQUIRED_PHASES_TURBO
+      : mode === "quick"
+        ? REQUIRED_PHASES_QUICK
+        : REQUIRED_PHASES_FULL;
   const requiredPhases = skipE2e
     ? basePhases.filter((p) => p !== 5)
     : basePhases;
@@ -399,10 +404,10 @@ export interface PredecessorValidation {
 export function validatePredecessor(
   targetPhase: number,
   progressLogContent: string,
-  mode: "full" | "quick",
+  mode: "full" | "quick" | "turbo",
   skipE2e: boolean,
 ): PredecessorValidation {
-  const basePhases = mode === "quick" ? REQUIRED_PHASES_QUICK : REQUIRED_PHASES_FULL;
+  const basePhases = mode === "turbo" ? REQUIRED_PHASES_TURBO : mode === "quick" ? REQUIRED_PHASES_QUICK : REQUIRED_PHASES_FULL;
   const requiredPhases = skipE2e ? basePhases.filter((p) => p !== 5) : basePhases;
 
   const targetIndex = requiredPhases.indexOf(targetPhase);

diff --git a/mcp/src/state-manager.ts b/mcp/src/state-manager.ts
index 647a481..3ebff03 100644
--- a/mcp/src/state-manager.ts
+++ b/mcp/src/state-manager.ts
@@ -334,7 +334,7 @@ export class StateManager {
   // -----------------------------------------------------------------------
 
   /** Create the output directory, write initial state.json (atomic) and progress-log header. */
-  async init(mode: "full" | "quick", stack: StackInfo, startPhase?: number): Promise<void> {
+  async init(mode: "full" | "quick" | "turbo", stack: StackInfo, startPhase?: number): Promise<void> {
     await mkdir(this.outputDir, { recursive: true });
 
     const now = new Date().toISOString();

diff --git a/mcp/src/types.ts b/mcp/src/types.ts
index a81ae1f..22bc340 100644
--- a/mcp/src/types.ts
+++ b/mcp/src/types.ts
@@ -11,7 +11,7 @@ import { z } from "zod/v4";
 // Enums / Shared Literals
 // ---------------------------------------------------------------------------
 
-export const ModeSchema = z.enum(["full", "quick"]);
+export const ModeSchema = z.enum(["full", "quick", "turbo"]);
 
 export const PhaseStatusSchema = z.enum([
   "IN_PROGRESS",

diff --git a/skills/auto-dev/SKILL.md b/skills/auto-dev/SKILL.md
index b4eeb17..bd3b177 100644
--- a/skills/auto-dev/SKILL.md
+++ b/skills/auto-dev/SKILL.md
@@ -21,7 +21,7 @@ description: "自治开发循环 — 从设计到测试通过的全自动闭环
 4. **编译通过 ≠ 验证通过**。Phase 4 要求执行 build_cmd + test_cmd + 全量代码审查。
 5. **禁止通过 checkpoint 设置 COMPLETED 状态**。checkpoint 只接受 IN_PROGRESS/PASS/NEEDS_REVISION/BLOCKED/REGRESS。完成只有一条路：`auto_dev_complete()`。框架会硬拒绝 checkpoint(status=COMPLETED)。
 6. **checkpoint 会验证前置阶段**。checkpoint(phase=N, status=PASS) 会被拒绝，除非 phase N-1 已有 PASS 记录。框架层面硬拒绝，禁止跳阶段。
-7. **Phase 7 (RETROSPECTIVE) 不可跳过**。必须作为独立阶段由 subagent 执行深度分析。
+7. **Phase 7 (RETROSPECTIVE) 不可跳过**（turbo 模式除外）。必须作为独立阶段由 subagent 执行深度分析。turbo 模式仅需 Phase 3 + Phase 4。
 8. **禁止 agent 自行设置 `skipE2e=true`**。只有用户在命令中显式传入 `--skip-e2e` 时才可设置。init 参数会被写入 progress-log INIT 标记，`auto_dev_complete` 会校验一致性，篡改会被检测。
 9. **禁止篡改 testCmd/buildCmd**。框架在 init 时将原始命令写入 progress-log（不可修改），checkpoint 和 complete 从日志读取原始命令执行。篡改 state.json 中的命令会被检测并拒绝。
 10. **禁止伪造测试报告**。Phase 5 checkpoint 会由框架自己执行 testCmd 验证，不依赖 agent 声称的结果。
@@ -288,10 +288,31 @@ topic: {topic} | branch: {branch} | output: {output_dir}
    d. 创建 PR
    e. 切回原分支继续其他工作
 
+## Turbo Mode (--turbo)
+
+最精简模式：Phase 3（实现）→ Phase 4（代码审查 tribunal）→ 完成。
+仅 1 次 tribunal 裁决，适用于 ≤20 行、≤2 文件、无新接口/schema 的小改动。
+
 ## Quick Mode (--quick)
 
 跳过 Phase 1-2：直接实现 → 快速审查 → build + test → 完成
 
+## 自动模式选择
+
+当用户未显式指定模式时（无 --turbo/--quick/--full），主 Agent 应自动判断：
+
+1. 分析任务描述，估算改动范围（文件数、行数）
+2. 按以下规则选择模式：
+
+| 条件 | 模式 | 理由 |
+|------|------|------|
+| ≤20 行、≤2 文件、无新接口/schema/跨模块 | turbo | 1 次 tribunal 足够 |
+| 21-50 行、≤3 文件、不涉及新接口或 schema 变更 | quick（+ --skip-e2e） | 需要代码审查但不需要完整设计 |
+| >50 行、或涉及新接口/schema/跨模块交互 | full | 需要完整设计和审查流程 |
+
+3. 输出选择结果和理由，然后调用 `auto_dev_init(mode=xxx)`
+4. 用户显式指定的 flag（--turbo/--quick/--full）优先于自动判断
+
 ## TDD Mode (默认开启, --no-tdd 关闭)
 
 Phase 3 每个 task 默认执行 RED-GREEN 门禁循环（通过 `auto_dev_task_red` 和 `auto_dev_task_green` 工具）。使用 `tdd=false` 关闭。Phase 5 从"写全部测试"变为"补充集成/E2E 测试"。

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

