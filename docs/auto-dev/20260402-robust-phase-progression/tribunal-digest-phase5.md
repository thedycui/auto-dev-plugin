# Phase 5 独立裁决

你是独立裁决者。你的默认立场是 FAIL。
PASS 必须对每条检查项提供证据（文件名:行号），FAIL 只需说明理由。
PASS 的举证成本远大于 FAIL —— 如果你不确定，判 FAIL。

## 范围限制

- 你只能审查本次 diff 涉及的变更，不得对 diff 之外的代码提出阻塞性问题（P0/P1）。
- P0/P1 问题必须提供 acRef（关联验收标准编号），否则将被降级为 advisory。
- 不在本次任务范围内的改进建议请放入 advisory 字段。

## 框架统计（可信数据）
```
 .claude-plugin/plugin.json                     |   2 +-
 mcp/dist/index.js                              | 148 +++++++-
 mcp/dist/index.js.map                          |   2 +-
 mcp/dist/orchestrator-prompts.js               |  33 +-
 mcp/dist/orchestrator-prompts.js.map           |   2 +-
 mcp/dist/orchestrator.js                       | 322 ++++++++++++++--
 mcp/dist/orchestrator.js.map                   |   2 +-
 mcp/dist/state-manager.d.ts                    |  11 +
 mcp/dist/state-manager.js                      |  29 ++
 mcp/dist/state-manager.js.map                  |   2 +-
 mcp/dist/types.d.ts                            |  23 ++
 mcp/dist/types.js                              |  28 ++
 mcp/dist/types.js.map                          |   2 +-
 mcp/src/__tests__/orchestrator-prompts.test.ts |  49 ++-
 mcp/src/__tests__/orchestrator.test.ts         | 486 ++++++++++++++++++++++++-
 mcp/src/__tests__/worktree-integration.test.ts | 463 +++++++++++++++++++++++
 mcp/src/index.ts                               | 143 +++++++-
 mcp/src/orchestrator-prompts.ts                |  38 +-
 mcp/src/orchestrator.ts                        | 345 ++++++++++++++++--
 mcp/src/state-manager.ts                       |  34 +-
 mcp/src/types.ts                               |  37 ++
 skills/auto-dev/SKILL.md                       |   2 +
 22 files changed, 2087 insertions(+), 116 deletions(-)

Untracked new files:
 .auto-dev-tmp-gaOK5iFSSLmf/design.md (new file)
 docs/auto-dev/20260331-0029-refactor-orchestrator-god-function/approach-plan.md (new file)
 docs/auto-dev/20260331-0029-refactor-orchestrator-god-function/design-review.md (new file)
 docs/auto-dev/20260331-0029-refactor-orchestrator-god-function/design.md (new file)
 docs/auto-dev/20260331-0029-refactor-orchestrator-god-function/plan-review.md (new file)
 docs/auto-dev/20260331-0029-refactor-orchestrator-god-function/plan.md (new file)
 docs/auto-dev/20260331-0029-refactor-orchestrator-god-function/progress-log.md (new file)
 docs/auto-dev/20260331-0029-refactor-orchestrator-god-function/state.json (new file)
 docs/auto-dev/20260402-0902-orchestrator-ux-improvements/acceptance-criteria.json (new file)
 docs/auto-dev/20260402-0902-orchestrator-ux-improvements/acceptance-report.md (new file)
 docs/auto-dev/20260402-0902-orchestrator-ux-improvements/approach-plan.md (new file)
 docs/auto-dev/20260402-0902-orchestrator-ux-improvements/design-review.md (new file)
 docs/auto-dev/20260402-0902-orchestrator-ux-improvements/design.md (new file)
 docs/auto-dev/20260402-0902-orchestrator-ux-improvements/e2e-test-cases.md (new file)
 docs/auto-dev/20260402-0902-orchestrator-ux-improvements/framework-ac-results.json (new file)
 docs/auto-dev/20260402-0902-orchestrator-ux-improvements/lessons-learned.json (new file)
 docs/auto-dev/20260402-0902-orchestrator-ux-improvements/plan-review.md (new file)
 docs/auto-dev/20260402-0902-orchestrator-ux-improvements/plan.md (new file)
 docs/auto-dev/20260402-0902-orchestrator-ux-improvements/progress-log.md (new file)
 docs/auto-dev/20260402-0902-orchestrator-ux-improvements/retrospective.md (new file)
 docs/auto-dev/20260402-0902-orchestrator-ux-improvements/state.json (new file)
 docs/auto-dev/20260402-0902-orchestrator-ux-improvements/summary.md (new file)
 docs/auto-dev/20260402-0902-orchestrator-ux-improvements/tribunal-digest-phase4.md (new file)
 docs/auto-dev/20260402-0902-orchestrator-ux-improvements/tribunal-digest-phase5.md (new file)
 docs/auto-dev/20260402-0902-orchestrator-ux-improvements/tribunal-digest-phase6.md (new file)
 docs/auto-dev/20260402-0902-orchestrator-ux-improvements/tribunal-phase4.md (new file)
 docs/auto-dev/20260402-0902-orchestrator-ux-improvements/tribunal-phase5.md (new file)
 docs/auto-dev/20260402-0902-orchestrator-ux-improvements/tribunal-phase6.md (new file)
 docs/auto-dev/20260402-robust-phase-progression/acceptance-criteria.json (new file)
 docs/auto-dev/20260402-robust-phase-progression/approach-plan.md (new file)
 docs/auto-dev/20260402-robust-phase-progression/design-review.md (new file)
 docs/auto-dev/20260402-robust-phase-progression/design.md (new file)
 docs/auto-dev/20260402-robust-phase-progression/e2e-test-cases.md (new file)
 docs/auto-dev/20260402-robust-phase-progression/e2e-test-results.md (new file)
 docs/auto-dev/20260402-robust-phase-progression/plan-review.md (new file)
 docs/auto-dev/20260402-robust-phase-progression/plan.md (new file)
 docs/auto-dev/20260402-robust-phase-progression/progress-log.md (new file)
 docs/auto-dev/20260402-robust-phase-progression/state.json (new file)
 docs/auto-dev/20260402-robust-phase-progression/tribunal-digest-phase4.md (new file)
 docs/auto-dev/20260402-robust-phase-progression/tribunal-phase4.md (new file)
 docs/auto-dev/tribunal-crash-observability (new file)
 docs/design-review-enhancement.md (new file)
 docs/docs/auto-dev/_global/lessons-global.json (new file)
 mcp/npm (new file)
 mcp/src/__tests__/worktree-handlers.test.ts (new file)

```

## 变更规模

- 规模等级：**LOW**（+0 -0，共 0 行）
- 审查指令：变更规模较小，快速审查即可。

## E2E 测试结果
```
# E2E 测试结果：robust-phase-progression

日期：2026-04-02
测试命令：`npm test`

## 测试结果汇总

| 指标 | 值 |
|------|-----|
| 测试文件总数 | 30 |
| 通过测试数 | 733 |
| 失败测试数 | 0 |
| 新增测试文件 | 1 |
| 新增测试数 | 4 |

## 新增测试文件

### `mcp/src/__tests__/worktree-handlers.test.ts`

新增 4 个测试，覆盖 AC-2 和 AC-12：

| 测试标题 | AC | 结果 |
|---------|-----|------|
| `[AC-2] auto_dev_complete calls git merge then git worktree remove` | AC-2 | PASS |
| `[AC-2] auto_dev_complete skips commit when worktree is clean` | AC-2 | PASS |
| `[AC-12] resume reuses existing worktree when worktreeRoot dir still exists` | AC-12 | PASS |
| `[AC-12] resume rebuilds worktree from branch when worktreeRoot dir deleted` | AC-12 | PASS |

## AC 覆盖状态

| AC | 描述 | 测试文件 | 状态 |
|----|------|---------|------|
| AC-1 | worktree 隔离：git diff 在 worktreeRoot 执行 | worktree-integration.test.ts | PASS（已有） |
| AC-2 | auto_dev_complete 合并分支并清理 worktree | worktree-handlers.test.ts | PASS（新增） |
| AC-3 | tribunal 使用 effectiveRoot | worktree-integration.test.ts | PASS（已有） |
| AC-4 | checkBuildWithBaseline 用临时 worktree，不用 git stash | worktree-integration.test.ts | PASS（已有） |
| AC-5 | Revision 循环最多 2 轮后 BLOCKED | orchestrator.test.ts | PASS（已有） |
| AC-6 | 1c/2c hash delta 检查；5c 用 test-files hash | orchestrator.test.ts | PASS（已有） |
| AC-7 | Phase 3 无代码变更时 passed=false | orchestrator.test.ts | PASS（已有） |
| AC-8 | totalAttempts >= 6 返回 effort_exhausted | orchestrator.test.ts | PASS（已有） |
| AC-9 | design.md 缺失时 step 2a 返回 prerequisite_missing | orchestrator.test.ts | PASS（已有） |
| AC-10 | --no-worktree 模式功能正常 | worktree-integration.test.ts | PASS（已有） |
| AC-11 | 旧 state.json 不 crash | worktree-integration.test.ts | PASS（已有） |
| AC-12 | resume 时 worktree 复用或重建 | worktree-handlers.test.ts | PASS（新增） |
| AC-13 | Phase 4a 首次无 feedback 时 agent=null | orchestrator.test.ts | PASS（已有） |
| AC-14 | Revision prompt 含 markdown 标题 | orchestrator.test.ts | PASS（已有） |
| AC-15 | Phase 3 scoped_prompt 内嵌 task 上下文 | orchestrator.test.ts | PASS（已有） |
| AC-16 | Phase 8 validateStep 检查 worktreeRoot | worktree-integration.test.ts | PASS（已有） |
| AC-17 | 5c delta check 用 test-files hash | orchestrator.test.ts | PASS（已有） |

## 运行输出摘要

```
Test Files  30 passed (30)
     Tests  733 passed (733)
  Start at  14:31:28
  Duration  31.98s
```

所有测试全部通过，无失败。

```

## 框架执行的测试日志（可信）
```

> auto-dev-plugin@1.1.0 test
> cd mcp && npm test


> auto-dev-mcp-server@9.1.1 test
> vitest run


 RUN  v2.1.9 /Users/admin/dycui/auto-dev-plugin/mcp

 ✓ src/__tests__/ship-integration-e2e.test.ts (26 tests) 35ms
 ✓ src/__tests__/orchestrator.test.ts (113 tests) 97ms
 ✓ src/__tests__/e2e-integration.test.ts (19 tests) 483ms
 ✓ src/__tests__/lessons-manager.test.ts (58 tests) 879ms
 ✓ src/__tests__/ac-integration.test.ts (26 tests) 121ms
 ✓ src/__tests__/batch1-guard-optimization.test.ts (21 tests) 140ms
 ✓ src/__tests__/worktree-handlers.test.ts (4 tests) 153ms
 ✓ src/__tests__/tdd-gate-integration.test.ts (29 tests) 434ms
 ✓ src/__tests__/orchestrator-prompts.test.ts (48 tests) 52ms
 ✓ src/__tests__/worktree-integration.test.ts (8 tests) 35ms
 ✓ src/__tests__/ac-runner.test.ts (26 tests) 304ms
 ✓ src/__tests__/tdd-gate.test.ts (56 tests) 84ms
 ✓ src/__tests__/orchestrator-ux-improvements.test.ts (25 tests) 33ms
 ✓ src/__tests__/ac-test-binding.test.ts (18 tests) 82ms
 ✓ src/__tests__/retrospective-data.test.ts (20 tests) 102ms
 ✓ src/__tests__/self-evolution-e2e.test.ts (5 tests) 165ms
 ✓ src/__tests__/ac-schema.test.ts (15 tests) 22ms
 ✓ src/__tests__/ship-integration.test.ts (15 tests) 15ms
 ✓ src/__tests__/state-manager-checkpoint.test.ts (8 tests) 93ms
 ✓ src/__tests__/improvements.test.ts (11 tests) 150ms
 ✓ src/__tests__/tribunal.test.ts (104 tests) 9156ms
   ✓ runTribunalWithRetry — Crash Detection and Retry (CLI mode) > TC-11: Crash on first attempt, legitimate FAIL on retry 3003ms
   ✓ runTribunalWithRetry — Crash Detection and Retry (CLI mode) > TC-12: Two consecutive crashes returns exhausted-retry FAIL 3001ms
   ✓ IMP-002: runTribunalWithRetryCli skips non-retryable crashes > retries when crashInfo.isRetryable is true (timeout) 3004ms
 ✓ src/__tests__/state-rebuild.test.ts (5 tests) 231ms
 ✓ src/__tests__/hub-client.test.ts (17 tests) 6132ms
   ✓ HubClient.executePrompt > sends command and polls until completed (AC-2) 2001ms
   ✓ HubClient.executePrompt > returns null on timeout (AC-6) 2062ms
   ✓ HubClient.executePrompt > returns null when command is rejected 2013ms
 ✓ src/__tests__/agent-spawner.test.ts (16 tests) 9032ms
   ✓ spawnAgentWithRetry — retry on crash > retries on crash, returns on success 3002ms
   ✓ spawnAgentWithRetry — retry on crash > returns crash result after exhausting retries 3005ms
   ✓ spawnAgentWithRetry — retry on crash > uses custom crashDetector when provided 3004ms
 ✓ src/__tests__/preflight-context.test.ts (7 tests) 8ms
 ✓ src/__tests__/regress.test.ts (8 tests) 17ms
 ✓ src/__tests__/iteration-limit.test.ts (7 tests) 35ms
 ✓ src/__tests__/template-renderer.test.ts (2 tests) 52ms
 ✓ src/__tests__/prompt-lint.test.ts (2 tests) 250ms
 ✓ src/__tests__/hub-client-extended.test.ts (14 tests) 28042ms
   ✓ HubClient.isAvailable — timeout > TC-H07: returns false when fetch exceeds 1s timeout 1009ms
   ✓ HubClient.executePrompt — expired command > TC-H24: returns null when command status is expired 2002ms
   ✓ HubClient.executePrompt — polling intervals > TC-H25: polling intervals follow 2s, 3s, 5s, 5s pattern 20013ms
   ✓ HubClient.executePrompt — resilient polling > TC-H26: continues polling after GET returns non-OK, then completes 5004ms

 Test Files  30 passed (30)
      Tests  733 passed (733)
   Start at  14:33:17
   Duration  32.21s (transform 2.33s, setup 0ms, collect 10.33s, tests 56.43s, environment 16ms, prepare 7.76s)


stderr | src/__tests__/ship-integration-e2e.test.ts > T-INT-03: Phase 8d CODE_BUG -> regress to Phase 3 > CODE_BUG triggers regress to Phase 3, step='3', shipRound=1
[orchestrator] phase regress: step=8d regressTo=3 round=1

stderr | src/__tests__/ship-integration-e2e.test.ts > T-INT-04: shipRound boundary values (ESCALATE) > T-INT-04c: shipRound=3, shipMaxRounds=5, CODE_BUG -> no ESCALATE, regress to Phase 3
[orchestrator] phase regress: step=8d regressTo=3 round=4

stderr | src/__tests__/orchestrator.test.ts > computeNextTask > circuit breaker > computeNextTask resets stepIteration to 0 on CIRCUIT_BREAK
[orchestrator] circuit breaker: step=3 phase=3

stderr | src/__tests__/orchestrator.test.ts > computeNextTask > circuit breaker E2E (entry-level) > TC-04/05: second failure triggers CIRCUIT_BREAK with clean prompt and stepIteration reset (AC-2, AC-3)
[orchestrator] circuit breaker: step=3 phase=3

stderr | src/__tests__/orchestrator.test.ts > computeNextTask > circuit breaker E2E (entry-level) > TC-21: full 3-approach lifecycle (AC-2, AC-3, AC-4)
[orchestrator] circuit breaker: step=3 phase=3
[orchestrator] circuit breaker: step=3 phase=3

stderr | src/__tests__/orchestrator.test.ts > Phase 8 ship integration > AC-9: Step 8d CODE_BUG triggers regress to Phase 3
[orchestrator] phase regress: step=8d regressTo=3 round=1

... (truncated, 25 lines omitted)
```

## 框架测试退出码（可信）
```
0
```

## 关键代码变更
```diff
diff --git a/.claude-plugin/plugin.json b/.claude-plugin/plugin.json
index 18d2628..2824ece 100644
--- a/.claude-plugin/plugin.json
+++ b/.claude-plugin/plugin.json
@@ -1,6 +1,6 @@
 {
   "name": "auto-dev",
-  "version": "9.4.4",
+  "version": "9.5.1",
   "description": "Intelligent development automation plugin that provides guided workflows, context-aware code generation, and best-practice enforcement for full-stack projects",
   "author": {
     "name": "Auto Dev Team"

diff --git a/mcp/src/index.ts b/mcp/src/index.ts
index aa9bae0..9387cfd 100644
--- a/mcp/src/index.ts
+++ b/mcp/src/index.ts
@@ -159,6 +159,26 @@ function inferChangeTypeFromContent(content: string): ChangeType | undefined {
   return bestScore >= 3 ? best : undefined;
 }
 
+// ---------------------------------------------------------------------------
+// Worktree helpers
+// ---------------------------------------------------------------------------
+
+function getWorktreeDir(projectRoot: string, topic: string): string {
+  const sanitized = topic
+    .replace(/[^a-zA-Z0-9\u4e00-\u9fff-]/g, "-")
+    .replace(/-+/g, "-")
+    .slice(0, 50);
+  return join(resolve(projectRoot, ".."), `.auto-dev-wt-${sanitized}`);
+}
+
+function getWorktreeBranch(topic: string): string {
+  const sanitized = topic
+    .replace(/[^a-zA-Z0-9\u4e00-\u9fff-]/g, "-")
+    .replace(/-+/g, "-")
+    .slice(0, 50);
+  return `auto-dev/${sanitized}`;
+}
+
 // ---------------------------------------------------------------------------
 // Server
 // ---------------------------------------------------------------------------
@@ -205,8 +225,9 @@ server.tool(
     }).optional(),
     shipMaxRounds: z.number().int().optional(),
     codeRoot: z.string().optional(),
+    useWorktree: z.boolean().optional().default(true),
   },
-  async ({ projectRoot, topic, mode: explicitMode, estimatedLines, estimatedFiles, changeType, startPhase, interactive, dryRun, skipE2e, tdd, brainstorm, costMode, onConflict, designDoc, ship, deployTarget, deployBranch, deployEnv, verifyMethod, verifyConfig, shipMaxRounds, codeRoot }) => {
+  async ({ projectRoot, topic, mode: explicitMode, estimatedLines, estimatedFiles, changeType, startPhase, interactive, dryRun, skipE2e, tdd, brainstorm, costMode, onConflict, designDoc, ship, deployTarget, deployBranch, deployEnv, verifyMethod, verifyConfig, shipMaxRounds, codeRoot, useWorktree }) => {
     const sm = await StateManager.create(projectRoot, topic);
 
     // Handle existing directory
... (truncated, 156 lines omitted)
diff --git a/mcp/src/orchestrator-prompts.ts b/mcp/src/orchestrator-prompts.ts
index 9dc816c..7a5508f 100644
--- a/mcp/src/orchestrator-prompts.ts
+++ b/mcp/src/orchestrator-prompts.ts
@@ -44,20 +44,44 @@ export interface RevisionInput {
 /** Builds a revision prompt from structured input. */
 export function buildRevisionPrompt(input: RevisionInput): string {
   const lines: string[] = [];
-  lines.push("你之前的工作有以下需要修订的地方：");
+  lines.push("## 修订任务");
+  lines.push("");
+  lines.push(input.originalTask);
+  lines.push("");
+  if (input.previousAttemptSummary) {
+    lines.push("## 历史尝试");
+    lines.push("");
+    lines.push(input.previousAttemptSummary);
+    lines.push("");
+  }
+  lines.push("## 审查反馈（必须逐条回应）");
+  lines.push("");
   lines.push(input.feedback);
+  lines.push("");
   if (input.artifacts.length > 0) {
-    lines.push("请修订以下文件：");
+    lines.push("## 待修改文件");
+    lines.push("");
     for (const a of input.artifacts) {
       lines.push(`- ${a}`);
     }
+    lines.push("");
   }
-  if (input.previousAttemptSummary) {
-    lines.push("上次尝试摘要：");
-    lines.push(input.previousAttemptSummary);
+  return lines.join("\n");
+}
+
+/** Builds a previous attempt summary from step effort and current feedback. */
+export function buildPreviousAttemptSummary(
+  stepId: string,
+  effort: { totalAttempts: number; revisionCycles: number; tribunalAttempts: number },
... (truncated, 15 lines omitted)
diff --git a/mcp/src/orchestrator.ts b/mcp/src/orchestrator.ts
index df2dee7..53ad1c7 100644
--- a/mcp/src/orchestrator.ts
+++ b/mcp/src/orchestrator.ts
@@ -10,11 +10,12 @@
 
 import { execFile } from "node:child_process";
 import { readFile, stat, writeFile } from "node:fs/promises";
-import { join, resolve, dirname } from "node:path";
+import { join, resolve, dirname, relative } from "node:path";
 import { fileURLToPath } from "node:url";
 
 import {
   buildRevisionPrompt,
+  buildPreviousAttemptSummary,
   translateFailureToFeedback,
   containsFrameworkTerms,
   parseApproachPlan,
@@ -22,7 +23,7 @@ import {
   buildCircuitBreakPrompt,
 } from "./orchestrator-prompts.js";
 import type { ApproachEntry, FailedApproach } from "./orchestrator-prompts.js";
-import { StateManager, extractTaskList } from "./state-manager.js";
+import { StateManager, extractTaskList, effortKeyForStep, hashContent } from "./state-manager.js";
 import {
   validatePhase1ReviewArtifact,
   validatePhase2ReviewArtifact,
@@ -36,6 +37,7 @@ import { evaluateTribunal } from "./tribunal.js";
 import type { EvalTribunalResult } from "./tribunal.js";
 import { TemplateRenderer } from "./template-renderer.js";
 import type { StateJson } from "./types.js";
+import { EFFORT_LIMITS, StepEffortSchema } from "./types.js";
 
 // ---------------------------------------------------------------------------
 // Design Doc Compliance Check
@@ -157,6 +159,41 @@ const SKILLS_DIR = resolve(
   "..", "..", "skills", "auto-dev",
 );
 
+// ---------------------------------------------------------------------------
+// Step Prerequisites (P1-3)
+// ---------------------------------------------------------------------------
... (truncated, 567 lines omitted)
diff --git a/mcp/src/state-manager.ts b/mcp/src/state-manager.ts
index 0a520db..58b18dc 100644
--- a/mcp/src/state-manager.ts
+++ b/mcp/src/state-manager.ts
@@ -13,7 +13,9 @@ import { join, dirname, resolve } from "node:path";
 import { lstatSync } from "node:fs";
 import { fileURLToPath } from "node:url";
 import { homedir } from "node:os";
+import { createHash } from "node:crypto";
 import { StateJsonSchema } from "./types.js";
+import { REVISION_TO_REVIEW } from "./types.js";
 import type { StateJson, StackInfo } from "./types.js";
 import { computeNextDirective } from "./phase-enforcer.js";
 import type { NextDirective } from "./phase-enforcer.js";
@@ -120,6 +122,28 @@ function parseStackVariables(content: string): Record<string, string> {
   return vars;
 }
 
+// ---------------------------------------------------------------------------
+// Effort tracking utilities
+// ---------------------------------------------------------------------------
+
+/**
+ * Returns the effort key for a given step.
+ * Revision steps (1c, 2c, 5c) map to their parent review step.
+ * All other steps map to themselves.
+ */
+export function effortKeyForStep(step: string): string {
+  return REVISION_TO_REVIEW[step] ?? step;
+}
+
+/**
+ * Returns a 16-character hex SHA-256 hash of the given content.
+ * Returns "" for null input.
+ */
+export function hashContent(content: string | null): string {
+  if (content === null) return "";
+  return createHash("sha256").update(content).digest("hex").slice(0, 16);
+}
+
 // ---------------------------------------------------------------------------
 // StateManager
... (truncated, 19 lines omitted)
diff --git a/mcp/src/types.ts b/mcp/src/types.ts
index 6cba3b7..73e8391 100644
--- a/mcp/src/types.ts
+++ b/mcp/src/types.ts
@@ -95,6 +95,32 @@ export const LessonEntrySchema = z.object({
 
 export type LessonEntry = z.infer<typeof LessonEntrySchema>;
 
+// ---------------------------------------------------------------------------
+// StepEffort — per-step effort tracking
+// ---------------------------------------------------------------------------
+
+export const StepEffortSchema = z.object({
+  totalAttempts: z.number().int().default(0),
+  revisionCycles: z.number().int().default(0),
+  tribunalAttempts: z.number().int().default(0),
+});
+
+export type StepEffort = z.infer<typeof StepEffortSchema>;
+
+/** Maximum attempt budgets per step */
+export const EFFORT_LIMITS = {
+  maxTotalAttempts: 6,
+  maxRevisionCycles: 2,
+  maxTribunalAttempts: 3,
+} as const;
+
+/** Maps revision steps to their parent review step */
+export const REVISION_TO_REVIEW: Record<string, string> = {
+  "1c": "1b",
+  "2c": "2b",
+  "5c": "5b",
+};
+
 // ---------------------------------------------------------------------------
 // ApproachState — circuit breaker approach tracking
 // ---------------------------------------------------------------------------
@@ -223,6 +249,17 @@ export const StateJsonSchema = z.object({
   shipRound: z.number().int().optional(),
   shipMaxRounds: z.number().int().optional(),
 
+  // Per-step effort tracking
... (truncated, 14 lines omitted)
diff --git a/skills/auto-dev/SKILL.md b/skills/auto-dev/SKILL.md
index 2bb85f6..27cfc18 100644
--- a/skills/auto-dev/SKILL.md
+++ b/skills/auto-dev/SKILL.md
@@ -130,6 +130,8 @@ auto_dev_init(
 
 未传 `ship=true` 时 Phase 8 不激活，不影响 Phase 1-7 的行为。
 
+> **注意（Worktree 模式）**：当 `useWorktree=true`（默认）时，**必须先调用 `auto_dev_complete` 完成 worktree 合并，再推进 Phase 8**。在 worktree 合并之前调用 Phase 8 会被阻止（`validateStep("8a")` 返回失败）。
+
 ### 5. 设计文档模板（推荐）
 
 使用以下模板编写设计文档，可让 auto-dev **跳过 Phase 1a（设计重写）**，直接进入 Phase 1b（审查），节省约 10-15 分钟。

```

## 检查清单

## 裁决检查清单（Phase 5: 测试裁决）

> 默认立场是 FAIL。PASS 必须逐条举证。

> **审查范围约束**: 只审查本次 diff 涉及的测试文件和测试结果。不得对 diff 之外的测试覆盖率、历史测试问题提出 P0/P1。P0/P1 必须关联具体的验收标准（acRef）。

### 1. 测试真实性
- [ ] 对比框架的 testLog 和 Agent 的 agentResults，是否一致？
- [ ] agentResults 中标 PASS 的测试，在 testLog 中是否真的通过？
- [ ] 是否有 testLog 中不存在但 agentResults 中标 PASS 的测试？

### 2. SKIP 审查（举证倒置）
- [ ] 每个 SKIP/DEFERRED 是否有执行失败的错误日志？
- [ ] "需要部署环境"不是有效理由——检查是否有已部署的环境可以用 curl 测试
- [ ] 接口级测试（curl/HTTP）不允许标 SKIP

### 3. 覆盖率
- [ ] 设计文档中的每个功能点是否有对应测试？
- [ ] 是否有功能点完全没有测试覆盖？

### 4. 测试质量
- [ ] 测试是否在验证真实功能？（assertTrue(true) 是假测试）
- [ ] 断言是否有意义？

