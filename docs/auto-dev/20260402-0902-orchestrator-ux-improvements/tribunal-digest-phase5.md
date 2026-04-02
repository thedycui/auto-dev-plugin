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
 .claude-plugin/plugin.json                         |   2 +-
 .../e2e-test-results.md                            | 123 ++++++++
 .../approach-plan.md                               |  65 ++++
 mcp/dist/index.js                                  |  84 ++++-
 mcp/dist/index.js.map                              |   2 +-
 mcp/dist/orchestrator.js                           | 135 ++++++--
 mcp/dist/orchestrator.js.map                       |   2 +-
 mcp/dist/tribunal.js                               |  54 +++-
 mcp/dist/tribunal.js.map                           |   2 +-
 mcp/dist/types.d.ts                                |   1 +
 mcp/dist/types.js                                  |   1 +
 mcp/dist/types.js.map                              |   2 +-
 .../__tests__/orchestrator-ux-improvements.test.ts | 292 +++++++++++++++++
 mcp/src/__tests__/orchestrator.test.ts             | 345 ++++++++++++++++++++-
 mcp/src/__tests__/prompt-lint.test.ts              |   4 +-
 mcp/src/__tests__/ship-integration-e2e.test.ts     |   4 +-
 mcp/src/__tests__/tribunal.test.ts                 | 131 ++++++++
 mcp/src/index.ts                                   |  88 +++++-
 mcp/src/orchestrator.ts                            | 180 +++++++++--
 mcp/src/tribunal.ts                                |  54 +++-
 mcp/src/types.ts                                   |   1 +
 skills/auto-dev/SKILL.md                           |   2 +-
 22 files changed, 1491 insertions(+), 83 deletions(-)

```

## E2E 测试结果
```
# E2E 测试结果：orchestrator-ux-improvements

> 执行时间：2026-04-02（最新：10:54）
> 测试命令：`cd /Users/admin/dycui/auto-dev-plugin/mcp && npm test`

---

## 执行结果

```
 Test Files  28 passed (28)
      Tests  697 passed (697)
   Start at  10:54:29
   Duration  35.52s (transform 4.91s, setup 0ms, collect 14.10s, tests 58.31s, environment 11ms, prepare 8.26s)
```

**总体状态：PASS**

---

## e2e-integration.test.ts 全量测试结果（19 个）

所有原来报告超时（5000ms）的测试现已全部通过：

| 测试用例 | 描述 | 状态 |
|---------|------|------|
| TC-1.1 | NEEDS_REVISION at iteration limit (non-interactive) triggers BLOCK | PASS |
| TC-1.2 | NEEDS_REVISION at iteration limit (interactive) BLOCKs and persists iteration | PASS |
| TC-1.3 | NEEDS_REVISION below limit increments iteration normally | PASS |
| TC-2.1 | Valid REGRESS increments regressionCount, resets iteration, returns correct directive | PASS |
| TC-2.2 | Invalid REGRESS (regressTo >= currentPhase) returns error WITHOUT mutating state | PASS |
| TC-2.3 | REGRESS at max count returns BLOCKED without mutation | PASS |
| TC-2.4 | Two successive regressions -- first allowed, second's directive is BLOCKED | PASS |
| TC-3.1 | Corrupted state.json triggers rebuild from progress-log | PASS |
| TC-3.2 | Dirty state.json -- clear dirty flag to recover | PASS |
| TC-3.3 | Missing state.json + valid progress-log rebuilds correctly | PASS |
| TC-4.1 | Phase 3 extracts both design summary and task list | PASS |
| TC-4.2 | Phase 4 extracts design summary only, no task list | PASS |
| TC-4.3 | Missing design.md does not cause error | PASS |
| TC-5.1 | PASS at phase 4 advances to phase 5 via full pipeline | PASS |
| TC-5.2 | Idempotent checkpoint -- duplicate detected and skipped | PASS |
| TC-5.3 | validateCompletion with all phases PASS allows completion | PASS |
| TC-N1 | REGRESS without regressTo returns error, no mutation | PASS |
| TC-N2 | NEEDS_REVISION when iteration already at max -- BLOCK is sticky | PASS |
| TC-N3 | State rebuild with empty progress-log defaults correctly | PASS |

---

## 新增测试文件结果

```
 ✓ src/__tests__/orchestrator-ux-improvements.test.ts (25 tests) 39ms
```

**25 个测试全部 PASS**

---

## 测试文件覆盖范围

| 测试用例 | 描述 | 状态 |
|---------|------|------|
| U-PARSE-1 | parseTaskList 解析单个任务行 | PASS |
| U-PARSE-2 | parseTaskList 解析多个任务行 | PASS |
| U-PARSE-3 | parseTaskList 忽略非任务行 | PASS |
| U-PARSE-4 | parseTaskList 空字符串返回空数组 | PASS |
| U-PARSE-5 | parseTaskList 解析 pending/done/skip 状态 | PASS |
| U-PARSE-6 | parseTaskList 解析带括号的文件路径 | PASS |
| U-DIFF-1  | parseDiffSummary 解析修改文件数 | PASS |
| U-DIFF-2  | parseDiffSummary 解析插入/删除行数 | PASS |
| U-DIFF-3  | parseDiffSummary 空输入返回零值 | PASS |
| U-DIFF-4  | parseDiffSummary 解析新增文件 | PASS |
| U-DIFF-5  | parseDiffSummary 解析删除文件 | PASS |
| U-RESET-A | firstStepForPhase phase=1 返回正确步骤 | PASS |
| U-RESET-B | firstStepForPhase phase=2 返回正确步骤 | PASS |
| U-RESET-2 | firstStepForPhase phase=3 返回正确步骤 | PASS |
| U-RESET-3 | firstStepForPhase phase=4 返回正确步骤 | PASS |
| U-RESET-5 | firstStepForPhase phase=5 返回正确步骤 | PASS |
| U-RESET-6 | firstStepForPhase phase=6 返回正确步骤 | PASS |
| StateJsonSchema 字段验证 1 | topic 字段存在 | PASS |
... (truncated, 44 lines omitted)
```

## 框架执行的测试日志（可信）
```

> auto-dev-mcp-server@9.1.1 test
> vitest run


 RUN  v2.1.9 /Users/admin/dycui/auto-dev-plugin/mcp

 ✓ src/__tests__/ship-integration-e2e.test.ts (26 tests) 237ms
 ✓ src/__tests__/orchestrator.test.ts (93 tests) 446ms
 ✓ src/__tests__/e2e-integration.test.ts (19 tests) 1414ms
 ✓ src/__tests__/lessons-manager.test.ts (58 tests) 2122ms
 ✓ src/__tests__/ac-integration.test.ts (26 tests) 265ms
 ✓ src/__tests__/orchestrator-prompts.test.ts (44 tests) 68ms
 ✓ src/__tests__/batch1-guard-optimization.test.ts (21 tests) 337ms
 ✓ src/__tests__/tdd-gate-integration.test.ts (29 tests) 494ms
 ✓ src/__tests__/tdd-gate.test.ts (56 tests) 208ms
 ✓ src/__tests__/ac-runner.test.ts (26 tests) 618ms
 ✓ src/__tests__/orchestrator-ux-improvements.test.ts (25 tests) 62ms
 ✓ src/__tests__/ac-test-binding.test.ts (18 tests) 741ms
 ✓ src/__tests__/retrospective-data.test.ts (20 tests) 596ms
 ✓ src/__tests__/tribunal.test.ts (104 tests) 9656ms
   ✓ runTribunalWithRetry — Crash Detection and Retry (CLI mode) > TC-11: Crash on first attempt, legitimate FAIL on retry 3002ms
   ✓ runTribunalWithRetry — Crash Detection and Retry (CLI mode) > TC-12: Two consecutive crashes returns exhausted-retry FAIL 3002ms
   ✓ IMP-002: runTribunalWithRetryCli skips non-retryable crashes > retries when crashInfo.isRetryable is true (timeout) 3001ms
 ✓ src/__tests__/self-evolution-e2e.test.ts (5 tests) 317ms
 ✓ src/__tests__/ac-schema.test.ts (15 tests) 648ms
   ✓ AcceptanceCriteriaSchema > should parse valid AC JSON with all layers 406ms
 ✓ src/__tests__/ship-integration.test.ts (15 tests) 26ms
 ✓ src/__tests__/hub-client.test.ts (17 tests) 6085ms
   ✓ HubClient.executePrompt > sends command and polls until completed (AC-2) 2005ms
   ✓ HubClient.executePrompt > returns null on timeout (AC-6) 2002ms
   ✓ HubClient.executePrompt > returns null when command is rejected 2001ms
 ✓ src/__tests__/agent-spawner.test.ts (16 tests) 9302ms
   ✓ spawnAgentWithRetry — retry on crash > retries on crash, returns on success 3001ms
   ✓ spawnAgentWithRetry — retry on crash > returns crash result after exhausting retries 3001ms
   ✓ spawnAgentWithRetry — retry on crash > uses custom crashDetector when provided 3001ms
 ✓ src/__tests__/improvements.test.ts (11 tests) 116ms
 ✓ src/__tests__/state-manager-checkpoint.test.ts (8 tests) 1469ms
   ✓ isCheckpointDuplicate — small file (< 4KB) > returns true when last checkpoint matches (AC-7) 595ms
   ✓ isCheckpointDuplicate — small file (< 4KB) > returns false when phase differs 310ms
 ✓ src/__tests__/regress.test.ts (8 tests) 16ms
 ✓ src/__tests__/state-rebuild.test.ts (5 tests) 13ms
 ✓ src/__tests__/preflight-context.test.ts (7 tests) 27ms
 ✓ src/__tests__/iteration-limit.test.ts (7 tests) 16ms
 ✓ src/__tests__/template-renderer.test.ts (2 tests) 12ms
 ✓ src/__tests__/prompt-lint.test.ts (2 tests) 586ms
   ✓ phase prompt lint — no framework terms > no prompt file contains framework-specific terms 555ms
 ✓ src/__tests__/hub-client-extended.test.ts (14 tests) 28046ms
   ✓ HubClient.isAvailable — timeout > TC-H07: returns false when fetch exceeds 1s timeout 1009ms
   ✓ HubClient.executePrompt — expired command > TC-H24: returns null when command status is expired 2001ms
   ✓ HubClient.executePrompt — polling intervals > TC-H25: polling intervals follow 2s, 3s, 5s, 5s pattern 20006ms
   ✓ HubClient.executePrompt — resilient polling > TC-H26: continues polling after GET returns non-OK, then completes 5004ms

 Test Files  28 passed (28)
      Tests  697 passed (697)
   Start at  10:57:35
   Duration  37.65s (transform 6.15s, setup 0ms, collect 22.65s, tests 63.94s, environment 13ms, prepare 17.15s)


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

stderr | src/__tests__/orchestrator.test.ts > IMP-002: orchestrator writes TRIBUNAL_CRASH on tribunal crash > writes TRIBUNAL_CRASH event with crashInfo when tribunal crashes
[orchestrator] tribunal crashed: step=4a phase=4
... (truncated, 23 lines omitted)
```

## 框架测试退出码（可信）
```
0
```

## 关键代码变更
```diff
diff --git a/mcp/src/__tests__/orchestrator-ux-improvements.test.ts b/mcp/src/__tests__/orchestrator-ux-improvements.test.ts
new file mode 100644
index 0000000..8fb54d3
--- /dev/null
+++ b/mcp/src/__tests__/orchestrator-ux-improvements.test.ts
@@ -0,0 +1,292 @@
+/**
+ * E2E test suite for topic: 20260402-0902-orchestrator-ux-improvements
+ *
+ * Covers all UNIT test cases defined in:
+ *   docs/auto-dev/20260402-0902-orchestrator-ux-improvements/e2e-test-cases.md
+ *
+ * Test IDs follow the document exactly so they can be traced back to AC items.
+ *
+ * INTEGRATION tests that require the full computeNextTask() mock stack
+ * (I-FAIL-*, I-STEP3-*) are already covered in orchestrator.test.ts under
+ * the "lastFailureDetail filling" and "parseTaskList" describe blocks.
+ * Those are not duplicated here to avoid maintaining two mock stacks.
+ */
+
+import { describe, it, expect } from "vitest";
+import { parseTaskList, firstStepForPhase, PHASE_SEQUENCE, validateResetRequest } from "../orchestrator.js";
+import { parseDiffSummary } from "../tribunal.js";
+import { StateJsonSchema } from "../types.js";
+
+// ---------------------------------------------------------------------------
+// Section 3.1 — parseTaskList() UNIT tests
+// ---------------------------------------------------------------------------
+
+describe("parseTaskList — AC-5, AC-6, AC-7, AC-11", () => {
+  // [AC-5] U-PARSE-1
+  it("[AC-5] U-PARSE-1: parseTaskList 返回 tasks 数组长度等于 ## Task N 块数量", () => {
+    const planContent = `
... (truncated, 266 lines omitted)
diff --git a/mcp/src/__tests__/orchestrator.test.ts b/mcp/src/__tests__/orchestrator.test.ts
index 94a0c87..048e30a 100644
--- a/mcp/src/__tests__/orchestrator.test.ts
+++ b/mcp/src/__tests__/orchestrator.test.ts
@@ -85,7 +85,7 @@ vi.mock("node:fs/promises", async (importOriginal) => {
 });
 
 // Now import modules under test (after mocks)
-import { computeNextTask, computeNextStep, handleApproachFailure, buildTaskForStep } from "../orchestrator.js";
+import { computeNextTask, computeNextStep, handleApproachFailure, buildTaskForStep, parseTaskList, firstStepForPhase } from "../orchestrator.js";
 import type { NextTaskResult, ApproachState } from "../orchestrator.js";
 
 // ---------------------------------------------------------------------------
@@ -149,7 +149,7 @@ describe("computeNextTask", () => {
 
       expect(result.done).toBe(false);
       expect(result.step).toBe("1a");
-      expect(result.agent).toBe("auto-dev-architect");
+      expect(result.agent).toBe("auto-dev:auto-dev-architect");
       expect(result.prompt).toBeDefined();
       expect(result.prompt).not.toBeNull();
     });
@@ -222,7 +222,7 @@ describe("computeNextTask", () => {
 
       expect(result.done).toBe(false);
       expect(result.step).toBe("3");
-      expect(result.agent).toBe("auto-dev-developer");
+      expect(result.agent).toBe("auto-dev:auto-dev-developer");
       expect(result.prompt).toContain("请实现以下功能");
       expect(result.prompt).toContain("test-topic");
     });
@@ -251,7 +251,7 @@ describe("computeNextTask", () => {
 
... (truncated, 370 lines omitted)
diff --git a/mcp/src/__tests__/prompt-lint.test.ts b/mcp/src/__tests__/prompt-lint.test.ts
index 6496bb5..7478f36 100644
--- a/mcp/src/__tests__/prompt-lint.test.ts
+++ b/mcp/src/__tests__/prompt-lint.test.ts
@@ -33,7 +33,7 @@ describe("phase prompt lint — no framework terms", () => {
         .join("\n");
       expect.fail(`Framework terms found in prompts:\n${report}`);
     }
-  });
+  }, 15000);
 
   it("all prompt files have isolation footer", async () => {
     const files = await readdir(PROMPTS_DIR);
@@ -50,5 +50,5 @@ describe("phase prompt lint — no framework terms", () => {
     if (missing.length > 0) {
       expect.fail(`Missing isolation footer in: ${missing.join(", ")}`);
     }
-  });
+  }, 15000);
 });

diff --git a/mcp/src/__tests__/ship-integration-e2e.test.ts b/mcp/src/__tests__/ship-integration-e2e.test.ts
index 20537ac..bcf423e 100644
--- a/mcp/src/__tests__/ship-integration-e2e.test.ts
+++ b/mcp/src/__tests__/ship-integration-e2e.test.ts
@@ -158,7 +158,7 @@ describe("T-INT-02: Complete Phase 8 progression path", () => {
 
     expect(result.done).toBe(false);
     expect(result.step).toBe("8a");
-    expect(result.agent).toBe("auto-dev-developer");
+    expect(result.agent).toBe("auto-dev:auto-dev-developer");
   });
 
   it("Step 2: 8a passes (no unpushed) -> advances to 8b", async () => {
@@ -309,7 +309,7 @@ describe("T-INT-03: Phase 8d CODE_BUG -> regress to Phase 3", () => {
 
     expect(result.done).toBe(false);
     expect(result.step).toBe("3");
-    expect(result.agent).toBe("auto-dev-developer");
+    expect(result.agent).toBe("auto-dev:auto-dev-developer");
     expect(result.message).toContain("CODE_BUG");
     expect(result.message).toContain("round 1");
 

diff --git a/mcp/src/__tests__/tribunal.test.ts b/mcp/src/__tests__/tribunal.test.ts
index 96d2c65..63a0044 100644
--- a/mcp/src/__tests__/tribunal.test.ts
+++ b/mcp/src/__tests__/tribunal.test.ts
@@ -44,6 +44,8 @@ import {
   runTribunalWithRetry,
   crossValidate,
   classifyTribunalError,
+  parseDiffSummary,
+  prepareTribunalInput,
 } from "../tribunal.js";
 import type { TribunalCrashInfo } from "../tribunal.js";
 import { TRIBUNAL_PHASES } from "../tribunal-schema.js";
@@ -1594,3 +1596,132 @@ describe("IMP-002: tryRunViaHub catch logs warning", () => {
     warnSpy.mockRestore();
   });
 });
+
+// ===========================================================================
+// Task 7 — parseDiffSummary unit tests (AC-8, AC-9)
+// ===========================================================================
+
+describe("parseDiffSummary", () => {
+  it("AC-8: 700 insertions + 100 deletions = HIGH (totalLines=800)", () => {
+    const result = parseDiffSummary("10 files changed, 700 insertions(+), 100 deletions(-)");
+    expect(result.files).toBe(10);
+    expect(result.insertions).toBe(700);
+    expect(result.deletions).toBe(100);
+    // Verify that the total (800) exceeds the HIGH threshold (500)
+    expect(result.insertions + result.deletions).toBeGreaterThan(500);
+  });
+
+  it("AC-9: 30 insertions + 20 deletions = LOW (totalLines=50)", () => {
... (truncated, 114 lines omitted)
diff --git a/mcp/src/index.ts b/mcp/src/index.ts
index 9a87448..aa9bae0 100644
--- a/mcp/src/index.ts
+++ b/mcp/src/index.ts
@@ -25,7 +25,7 @@ import { executeTribunal, crossValidate, buildTribunalLog } from "./tribunal.js"
 import type { ToolResult } from "./tribunal.js";
 import { generateRetrospectiveData } from "./retrospective-data.js";
 import { getClaudePath } from "./tribunal.js";
-import { computeNextTask } from "./orchestrator.js";
+import { computeNextTask, firstStepForPhase, validateResetRequest } from "./orchestrator.js";
 import { runStructuralAssertions } from "./ac-runner.js";
 import { discoverAcBindings, validateAcBindingCoverage, runAcBoundTests } from "./ac-test-binding.js";
 import { AcceptanceCriteriaSchema } from "./ac-schema.js";
@@ -1271,21 +1271,21 @@ server.tool(
       const isBeast = state.costMode === "beast";
 
       const phasePromptMap: Record<number, { promptFile: string; agent: string; model: string }> = {
-        0: { promptFile: "phase0-brainstorm", agent: "auto-dev-architect", model: isBeast ? "opus" : "sonnet" },
-        1: { promptFile: "phase1-architect", agent: "auto-dev-architect", model: "opus" },       // 设计始终用最强
-        2: { promptFile: "phase2-planner", agent: "auto-dev-architect", model: isBeast ? "opus" : "sonnet" },
-        3: { promptFile: "phase3-developer", agent: "auto-dev-developer", model: "opus" },       // 实现始终用最强
-        4: { promptFile: "phase4-full-reviewer", agent: "auto-dev-reviewer", model: "opus" },    // 代码审查始终用最强
-        5: { promptFile: "phase5-test-architect", agent: "auto-dev-test-architect", model: isBeast ? "opus" : "sonnet" },
-        6: { promptFile: "phase6-acceptance", agent: "auto-dev-acceptance-validator", model: isBeast ? "opus" : "sonnet" },
-        7: { promptFile: "phase7-retrospective", agent: "auto-dev-reviewer", model: isBeast ? "opus" : "sonnet" },
+        0: { promptFile: "phase0-brainstorm", agent: "auto-dev:auto-dev-architect", model: isBeast ? "opus" : "sonnet" },
+        1: { promptFile: "phase1-architect", agent: "auto-dev:auto-dev-architect", model: "opus" },       // 设计始终用最强
+        2: { promptFile: "phase2-planner", agent: "auto-dev:auto-dev-architect", model: isBeast ? "opus" : "sonnet" },
+        3: { promptFile: "phase3-developer", agent: "auto-dev:auto-dev-developer", model: "opus" },       // 实现始终用最强
+        4: { promptFile: "phase4-full-reviewer", agent: "auto-dev:auto-dev-reviewer", model: "opus" },    // 代码审查始终用最强
+        5: { promptFile: "phase5-test-architect", agent: "auto-dev:auto-dev-test-architect", model: isBeast ? "opus" : "sonnet" },
+        6: { promptFile: "phase6-acceptance", agent: "auto-dev:auto-dev-acceptance-validator", model: isBeast ? "opus" : "sonnet" },
+        7: { promptFile: "phase7-retrospective", agent: "auto-dev:auto-dev-reviewer", model: isBeast ? "opus" : "sonnet" },
... (truncated, 87 lines omitted)
diff --git a/mcp/src/orchestrator.ts b/mcp/src/orchestrator.ts
index ebbd89e..baf8268 100644
--- a/mcp/src/orchestrator.ts
+++ b/mcp/src/orchestrator.ts
@@ -70,6 +70,14 @@ export function checkDesignDocCompliance(content: string): { compliant: boolean;
 // Types
 // ---------------------------------------------------------------------------
 
+export interface TaskInfo {
+  taskNumber: number;
+  title: string;
+  description: string;
+  files: string[];
+  dependencies: number[];
+}
+
 export interface NextTaskResult {
   /** Whether all phases are done */
   done: boolean;
@@ -93,6 +101,10 @@ export interface NextTaskResult {
   mandate?: string;
   /** Informational message */
   message: string;
+  /** Last failure detail (feedback from validation) — populated on failure paths */
+  lastFailureDetail?: string;
+  /** Parsed task list from plan.md — only populated for step "3" */
+  tasks?: TaskInfo[];
 }
 
 // ---------------------------------------------------------------------------
@@ -102,30 +114,30 @@ export interface NextTaskResult {
 const MAX_STEP_ITERATIONS = 3;
 const MAX_APPROACH_FAILURES = 2;
... (truncated, 314 lines omitted)
diff --git a/mcp/src/tribunal.ts b/mcp/src/tribunal.ts
index 1642d6d..4bfe80d 100644
--- a/mcp/src/tribunal.ts
+++ b/mcp/src/tribunal.ts
@@ -135,6 +135,33 @@ export async function getKeyDiff(
   return truncated.join("\n");
 }
 
+// ---------------------------------------------------------------------------
+// parseDiffSummary — parse git diff --stat summary line
+// ---------------------------------------------------------------------------
+
+/**
+ * Parse a git diff --stat summary line like:
+ *   "5 files changed, 120 insertions(+), 30 deletions(-)"
+ * Handles edge cases: only insertions, only deletions, unrecognized format.
+ * Returns { files: 0, insertions: 0, deletions: 0 } on any parse failure.
+ */
+export function parseDiffSummary(summaryLine: string): { files: number; insertions: number; deletions: number } {
+  try {
+    const filesMatch = summaryLine.match(/(\d+)\s+files?\s+changed/);
+    const insertMatch = summaryLine.match(/(\d+)\s+insertions?\(\+\)/);
+    const deleteMatch = summaryLine.match(/(\d+)\s+deletions?\(-\)/);
+
+    const files = filesMatch ? parseInt(filesMatch[1], 10) : 0;
+    const insertions = insertMatch ? parseInt(insertMatch[1], 10) : 0;
+    const deletions = deleteMatch ? parseInt(deleteMatch[1], 10) : 0;
+
+    if (!filesMatch) return { files: 0, insertions: 0, deletions: 0 };
+    return { files, insertions, deletions };
+  } catch {
+    return { files: 0, insertions: 0, deletions: 0 };
+  }
... (truncated, 47 lines omitted)
diff --git a/mcp/src/types.ts b/mcp/src/types.ts
index 4b4c1ce..6cba3b7 100644
--- a/mcp/src/types.ts
+++ b/mcp/src/types.ts
@@ -201,6 +201,7 @@ export const StateJsonSchema = z.object({
   step: z.string().nullable().optional(),
   stepIteration: z.number().int().optional(),
   lastValidation: z.string().nullable().optional(),
+  lastFailureDetail: z.string().nullable().optional(),
   approachState: z.any().nullable().optional(), // Complex nested object, validated at orchestrator level
 
   // Phase-level escalation counter (Issue #2: ESCALATE auto-regress)

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

