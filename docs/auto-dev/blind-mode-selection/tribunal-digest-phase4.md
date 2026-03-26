# Phase 4 独立裁决

你是独立裁决者。你的默认立场是 FAIL。
PASS 必须对每条检查项提供证据（文件名:行号），FAIL 只需说明理由。
PASS 的举证成本远大于 FAIL —— 如果你不确定，判 FAIL。

## 框架统计（可信数据）
```
 mcp/dist/index.js                   |  26 +-
 mcp/dist/index.js.map               |   2 +-
 mcp/dist/state-manager.js           |  29 +-
 mcp/dist/state-manager.js.map       |   2 +-
 mcp/dist/types.d.ts                 |   7 +
 mcp/dist/types.js                   |   1 +
 mcp/dist/types.js.map               |   2 +-
 mcp/node_modules/.package-lock.json | 800 ++++++++++++++++++++++++++++++++++++
 mcp/src/index.ts                    |  24 +-
 mcp/src/state-manager.ts            |  33 +-
 mcp/src/types.ts                    |   1 +
 skills/auto-dev/SKILL.md            |  23 +-
 12 files changed, 924 insertions(+), 26 deletions(-)

```

## 主 Agent 的代码审查
```
# Phase 4 代码审查报告 — blind-mode-selection

**审查范围**：types.ts, index.ts, state-manager.ts, SKILL.md
**审查日期**：2026-03-26

## P0：无

## P1：无

## P2：优化建议

### P2-1：git diff --stat 解析逻辑较脆弱

state-manager.ts 中 turbo mode guard 的 diff stat 解析依赖 summary 行格式（"N insertions(+), M deletions(-)"）。如果 git 版本不同或 locale 设置不同，格式可能变化。当前通过 regex 匹配 `(\d+) insertion` 和 `(\d+) deletion`，对标准 git 输出足够可靠。

## 总结

**PASS**

改动逻辑清晰：
1. init 参数新增 estimatedLines/estimatedFiles/changeType，mode 改为 optional — 正确
2. 框架内部根据估算数据决定模式，阈值逻辑不暴露给 agent — 正确
3. Phase 3 PASS 时 turbo 模式事后校验 git diff，超标自动升级 — 正确
4. SKILL.md 删除阈值表，只指导 agent 做估算 — 正确
5. 向后兼容：显式传 mode 仍然可用 — 正确

```

## 关键代码变更
```diff
diff --git a/mcp/src/index.ts b/mcp/src/index.ts
index 9ced0a1..6a8bdb1 100644
--- a/mcp/src/index.ts
+++ b/mcp/src/index.ts
@@ -86,7 +86,10 @@ server.tool(
   {
     projectRoot: z.string(),
     topic: z.string(),
-    mode: z.enum(["full", "quick", "turbo"]),
+    mode: z.enum(["full", "quick", "turbo"]).optional(),
+    estimatedLines: z.number().optional(),
+    estimatedFiles: z.number().optional(),
+    changeType: z.enum(["refactor", "bugfix", "feature", "config", "docs"]).optional(),
     startPhase: z.number().optional(),
     interactive: z.boolean().optional(),
     dryRun: z.boolean().optional(),
@@ -96,7 +99,7 @@ server.tool(
     costMode: z.enum(["economy", "beast"]).optional(),
     onConflict: z.enum(["resume", "overwrite"]).optional(),
   },
-  async ({ projectRoot, topic, mode, startPhase, interactive, dryRun, skipE2e, tdd, brainstorm, costMode, onConflict }) => {
+  async ({ projectRoot, topic, mode: explicitMode, estimatedLines, estimatedFiles, changeType, startPhase, interactive, dryRun, skipE2e, tdd, brainstorm, costMode, onConflict }) => {
     const sm = new StateManager(projectRoot, topic);
 
     // Handle existing directory
@@ -165,6 +168,23 @@ server.tool(
       }
     }
 
+    // --- Mode decision: explicit override or framework auto-select ---
+    let mode: "full" | "quick" | "turbo";
+    if (explicitMode) {
+      mode = explicitMode;
+    } else {
+      const lines = estimatedLines ?? 999;
+      const files = estimatedFiles ?? 999;
+      const isLowRisk = changeType === "refactor" || changeType === "config" || changeType === "docs";
+      if (isLowRisk && lines <= 20 && files <= 2) {
+        mode = "turbo";
+      } else if (lines <= 50 && files <= 3 && changeType !== "feature") {
+        mode = "quick";
+      } else {
+        mode = "full";
+      }
+    }
+
     const stack = await sm.detectStack();
     const gitManager = new GitManager(projectRoot);
     const git = await gitManager.getStatus();

diff --git a/mcp/src/state-manager.ts b/mcp/src/state-manager.ts
index 3ebff03..d6b5d0f 100644
--- a/mcp/src/state-manager.ts
+++ b/mcp/src/state-manager.ts
@@ -610,11 +610,38 @@ export async function internalCheckpoint(
     await sm.atomicWrite(join(sm.outputDir, "BLOCKED.md"), blockedContent);
   }
 
-  // 5. Compute next phase directive
+  // 5. Turbo mode guard: if Phase 3 PASS in turbo mode, check actual diff size
+  //    If actual changes exceed turbo threshold, auto-upgrade to quick mode
+  let effectiveState = state;
+  if (phase === 3 && status === "PASS" && state.mode === "turbo" && state.startCommit) {
+    const { execFile: ef } = await import("node:child_process");
+    const diffStat = await new Promise<string>((resolve) => {
+      ef("git", ["diff", "--stat", state.startCommit!], {
+        cwd: state.projectRoot,
+        timeout: 10_000,
+      }, (_err, stdout) => resolve(stdout ?? ""));
+    });
+    const statLines = diffStat.trim().split("\n");
+    const summaryLine = statLines[statLines.length - 1] ?? "";
+    const insertMatch = summaryLine.match(/(\d+) insertion/);
+    const deleteMatch = summaryLine.match(/(\d+) deletion/);
+    const actualLines = (parseInt(insertMatch?.[1] ?? "0") || 0) + (parseInt(deleteMatch?.[1] ?? "0") || 0);
+    const actualFiles = Math.max(0, statLines.length - 1);
+
+    if (actualLines > 30 || actualFiles > 3) {
+      await sm.atomicUpdate({ mode: "quick" });
+      effectiveState = { ...state, mode: "quick" };
+      await sm.appendToProgressLog(
+        `\n<!-- MODE_UPGRADE turbo→quick reason="actual diff: ${actualLines} lines, ${actualFiles} files exceeds turbo threshold" -->\n`,
+      );
+    }
+  }
+
+  // 6. Compute next phase directive
   // [P1-3 fix] Pass updated regressionCount so limit check uses current value
   const stateForDirective = status === "REGRESS"
-    ? { ...state, regressionCount: (state.regressionCount ?? 0) + 1 }
-    : state;
+    ? { ...effectiveState, regressionCount: (effectiveState.regressionCount ?? 0) + 1 }
+    : effectiveState;
   const nextDirective = computeNextDirective(phase, status, stateForDirective, regressTo);
 
   return { ok: true, nextDirective, stateUpdates };

diff --git a/mcp/src/types.ts b/mcp/src/types.ts
index 22bc340..5d4f3bb 100644
--- a/mcp/src/types.ts
+++ b/mcp/src/types.ts
@@ -12,6 +12,7 @@ import { z } from "zod/v4";
 // ---------------------------------------------------------------------------
 
 export const ModeSchema = z.enum(["full", "quick", "turbo"]);
+export const ChangeTypeSchema = z.enum(["refactor", "bugfix", "feature", "config", "docs"]);
 
 export const PhaseStatusSchema = z.enum([
   "IN_PROGRESS",

diff --git a/skills/auto-dev/SKILL.md b/skills/auto-dev/SKILL.md
index 1ceb461..e13f855 100644
--- a/skills/auto-dev/SKILL.md
+++ b/skills/auto-dev/SKILL.md
@@ -300,19 +300,16 @@ topic: {topic} | branch: {branch} | output: {output_dir}
 
 ## 自动模式选择
 
-当用户未显式指定模式时（无 --turbo/--quick/--full），主 Agent 应自动判断：
-
-1. 分析任务描述，估算改动范围（文件数、行数）
-2. 按以下规则选择模式：
-
-| 条件 | 模式 | 理由 |
-|------|------|------|
-| ≤20 行、≤2 文件、纯重构/改参数/改文案/fix typo（无类型变更、无新分支逻辑、无跨函数影响） | turbo | build+test 足够，不需要 tribunal |
-| 21-50 行、≤3 文件、不涉及新接口或 schema 变更 | quick（+ --skip-e2e） | 需要代码审查但不需要完整设计 |
-| >50 行、或涉及新接口/schema/跨模块交互 | full | 需要完整设计和审查流程 |
-
-3. 输出选择结果和理由，然后调用 `auto_dev_init(mode=xxx)`
-4. 用户显式指定的 flag（--turbo/--quick/--full）优先于自动判断
+当用户未显式指定模式时（无 --turbo/--quick/--full），**框架自动决定模式**：
+
+1. 主 Agent 分析任务描述，估算改动范围
+2. 调用 `auto_dev_init` 时传入估算参数（不传 mode）：
+   - `estimatedLines`: 预估改动行数
+   - `estimatedFiles`: 预估改动文件数
+   - `changeType`: refactor / bugfix / feature / config / docs
+3. **框架根据估算数据内部决定模式**，通过返回值中的 `mode` 字段告知主 Agent
+4. 主 Agent 根据返回的 mode 执行对应流程
+5. 用户显式指定的 flag（--turbo/--quick/--full）传入 `mode` 参数，覆盖框架自动判断
 
 ## TDD Mode (默认开启, --no-tdd 关闭)
 

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

