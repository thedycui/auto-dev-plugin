# Phase 6 独立裁决

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

## 验收报告
```
# 验收报告: blind-mode-selection

本任务无独立 design.md AC（turbo 模式模拟），基于设计讨论中的核心需求验证。

| # | 描述 | 验证方式 | 结果 | 证据 |
|---|------|---------|------|------|
| 1 | init 接受 estimatedLines/estimatedFiles/changeType 参数 | 代码审查 | PASS | index.ts:91-93 三个 optional 参数 |
| 2 | mode 改为 optional，未传时框架自动决定 | 代码审查 | PASS | index.ts:89 mode optional, index.ts:174-185 决策逻辑 |
| 3 | 框架决定的 mode 通过返回值告知 agent | 代码审查 | PASS | index.ts:269 `mode: state.mode` |
| 4 | 显式传 mode 仍可覆盖 | 代码审查 | PASS | index.ts:174 `if (explicitMode)` |
| 5 | Phase 3 turbo 事后校验，超标升级为 quick | 代码审查 | PASS | state-manager.ts:614-638 git diff 检查 + atomicUpdate |
| 6 | SKILL.md 不暴露模式选择阈值 | 代码审查 | PASS | SKILL.md 只指导估算，不含阈值表 |
| 7 | Build + test 通过 | 运行验证 | PASS | 213/213 tests pass |

通过率：7/7 PASS
结论：PASS

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

## 裁决检查清单（Phase 6: 验收裁决）

> 默认立场是 FAIL。PASS 必须逐条举证。

### 验收标准逐条验证
- [ ] 从 design.md 中提取每条验收标准（AC）
- [ ] 对每条标准，在 diff 中找到对应实现
- [ ] 找不到实现的标准 → FAIL
- [ ] SKIP 必须有合理理由（真的做不到，不是偷懒）

### 输出要求
- AC 验证表：AC: {描述} → PASS/FAIL/SKIP → {证据或原因}

