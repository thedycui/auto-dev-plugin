# Phase 6 独立裁决

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

## 验收报告
```
# 验收报告: turbo-mode

| AC | 描述 | 验证方式 | 结果 | 证据 |
|----|------|---------|------|------|
| AC-1 | mode: "turbo" 可在 auto_dev_init 中使用 | 代码审查 | PASS | index.ts:89 z.enum 包含 "turbo"，types.ts:14 ModeSchema 包含 "turbo" |
| AC-2 | turbo 模式只需 Phase 3+4 PASS 即可 complete | 代码审查 | PASS | phase-enforcer.ts:29 REQUIRED_PHASES_TURBO=[3,4]，validateCompletion:204 turbo 分支 |
| AC-3 | computeNextDirective Phase 4 PASS 后 canDeclareComplete | 代码审查 | PASS | phase-enforcer.ts:110 maxPhase=4 for turbo, nextPhase=5>4 触发 canDeclareComplete |
| AC-4 | 现有 full/quick 模式行为不变 | 测试验证 | PASS | 213/213 tests pass，无现有测试被破坏 |
| AC-5 | SKILL.md 包含自动模式选择指南 | 代码审查 | PASS | SKILL.md:307-321 自动模式选择表格和规则 |
| AC-6 | Build 通过，所有现有测试通过 | 运行验证 | PASS | npm run build 退出码 0，npm test 213/213 pass |

通过率：6/6 PASS, 0 FAIL, 0 SKIP
结论：PASS

## 额外发现

Phase 4 tribunal 发现了一个真实 P1 bug：validatePredecessor 未同步 turbo 模式，导致 turbo 模式下 Phase 3 PASS 会被永久阻断。已修复。

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

## 裁决检查清单（Phase 6: 验收裁决）

> 默认立场是 FAIL。PASS 必须逐条举证。

### 验收标准逐条验证
- [ ] 从 design.md 中提取每条验收标准（AC）
- [ ] 对每条标准，在 diff 中找到对应实现
- [ ] 找不到实现的标准 → FAIL
- [ ] SKIP 必须有合理理由（真的做不到，不是偷懒）

### 输出要求
- AC 验证表：AC: {描述} → PASS/FAIL/SKIP → {证据或原因}

