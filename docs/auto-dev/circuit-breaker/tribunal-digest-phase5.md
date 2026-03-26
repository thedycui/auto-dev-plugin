# Phase 5 独立裁决

你是独立裁决者。你的默认立场是 FAIL。
PASS 必须对每条检查项提供证据（文件名:行号），FAIL 只需说明理由。
PASS 的举证成本远大于 FAIL —— 如果你不确定，判 FAIL。

## 框架统计（可信数据）
```
 docs/auto-dev/_global/lessons-global.json      | 202 ++++--
 mcp/dist/orchestrator-prompts.js               |  72 ++
 mcp/dist/orchestrator-prompts.js.map           |   2 +-
 mcp/dist/orchestrator.js                       | 159 +++-
 mcp/dist/orchestrator.js.map                   |   2 +-
 mcp/node_modules/.package-lock.json            | 800 ++++++++++++++++++++
 mcp/src/__tests__/orchestrator-prompts.test.ts | 277 +++++++
 mcp/src/__tests__/orchestrator.test.ts         | 969 ++++++++++++++++++++++++-
 mcp/src/orchestrator-prompts.ts                | 102 +++
 mcp/src/orchestrator.ts                        | 205 +++++-
 10 files changed, 2726 insertions(+), 64 deletions(-)

```

## E2E 测试结果
```
# E2E Test Results: circuit-breaker

## 执行环境

- 日期: 2026-03-26
- 分支: master
- 构建: `npm run build` PASS
- 测试框架: vitest 1.6.0

## 测试结果汇总

- 总测试文件: 14 passed (14)
- 总测试用例: 303 passed (303)
- 耗时: 11.57s
- 新增测试: 38 个（Task 7-9 写 20 个 + Phase 5 写 18 个）

## 新增断路器测试详情

### orchestrator-prompts.test.ts (新增 18 个)

| 用例 | 描述 | 结果 |
|------|------|------|
| TC-01 | parseApproachPlan 标准格式解析含目标段 | PASS |
| TC-02 | parseApproachPlan 缺少方法字段时 fallback summary | PASS |
| TC-10 | parseApproachPlan 无标题随机文本返回 null | PASS |
| TC-11 | buildCircuitBreakPrompt 多个 prohibited 无框架术语 | PASS |
| TC-23 | extractOneLineReason 超长截断到 123 字符 | PASS |
| TC-24 | extractOneLineReason 全空白返回"未知原因" | PASS |
| parseApproachPlan | 标准格式（主+2备选）返回正确数组 | PASS |
| parseApproachPlan | 仅主方案无备选返回 null | PASS |
| parseApproachPlan | 空字符串返回 null | PASS |
| parseApproachPlan | 格式变体（额外空行）正常解析 | PASS |
| extractOneLineReason | 多行提取首行 | PASS |
| extractOneLineReason | 短文本原样返回 | PASS |
| extractOneLineReason | 超长截断 | PASS |
| extractOneLineReason | 空字符串 | PASS |
| extractOneLineReason | 跳过前导空行 | PASS |
| buildCircuitBreakPrompt | 包含目标和方案 | PASS |
| buildCircuitBreakPrompt | 包含禁止列表 | PASS |
| buildCircuitBreakPrompt | 不含框架术语 | PASS |

### orchestrator.test.ts (新增 20 个)

| 用例 | AC | 描述 | 结果 |
|------|-----|------|------|
| TC-03 | AC-1 | 首次失败+approach-plan存在→创建approachState | PASS |
| TC-04/05 | AC-2,3 | 第二次失败触发CIRCUIT_BREAK，stepIteration重置，freshContext=true | PASS |
| TC-06 | AC-4 | 所有方案耗尽→escalation+BLOCKED | PASS |
| TC-07b | AC-5 | 无approach-plan.md→正常revision | PASS |
| TC-08 | AC-5 | 无approach-plan.md+超限→escalation | PASS |
| TC-09 | AC-6 | 只有主方案→planFeedback含"备选方案" | PASS |
| TC-15 | AC-8 | step 5b含方案计划指令 | PASS |
| TC-16 | AC-8 | step 1a不含方案计划指令 | PASS |
| TC-17 | AC-8 | step 7不含方案计划指令 | PASS |
| TC-18 | P1-1 | 步骤推进时approachState清零 | PASS |
| TC-19 | - | 有approachState时跳过MAX_STEP_ITERATIONS | PASS |
| TC-20 | - | 新方案首次失败走revision而非CIRCUIT_BREAK | PASS |
| TC-21 | - | 3个方案完整生命周期（6次调用） | PASS |
| TC-25 | - | plan.md缺失时使用fallback goal | PASS |
| TC-26 | AC-6 | 格式不规范返回planFeedback | PASS |
| 基础 | AC-5 | 无approach-plan返回CONTINUE | PASS |
| 基础 | - | 首次失败CONTINUE且持久化 | PASS |
| 基础 | AC-2,3 | 连续2次失败CIRCUIT_BREAK | PASS |
| 基础 | AC-4 | computeNextTask CIRCUIT_BREAK重置stepIteration | PASS |
| 基础 | AC-4 | 所有方案耗尽BLOCKED | PASS |

## AC 覆盖矩阵

| AC | 描述 | 测试用例 | 状态 |
|----|------|---------|------|
| AC-1 | approach-plan.md 解析正确 | TC-01, TC-02, TC-03, 基础x3 | PASS |
| AC-2 | 同一方案失败2次触发CIRCUIT_BREAK | TC-04/05, 基础 | PASS |
| AC-3 | CIRCUIT_BREAK时stepIteration重置为0 | TC-04/05, 基础 | PASS |
| AC-4 | 所有方案耗尽后BLOCKED | TC-06, 基础 | PASS |
| AC-5 | 无approach-plan.md时向后兼容 | TC-07b, TC-08, 基础 | PASS |
| AC-6 | 格式不规范时graceful fallback | TC-09, TC-10, TC-26 | PASS |
| AC-7 | 清零prompt不含框架术语 | TC-11, 基础 | PASS |
| AC-8 | 方案计划指令只注入step 3/4a/5b | TC-15, TC-16, TC-17 | PASS |

```

## 框架执行的测试日志（可信）
```

> auto-dev-plugin@1.0.0 test
> cd mcp && npm test


> auto-dev-mcp-server@8.0.0 test
> vitest run


 RUN  v3.2.4 /Users/admin/.claude/plugins/auto-dev-plugin/mcp

 ✓ src/__tests__/lessons-manager.test.ts (35 tests) 531ms
 ✓ src/__tests__/tdd-gate-integration.test.ts (29 tests) 382ms
 ✓ src/__tests__/e2e-integration.test.ts (19 tests) 693ms
 ✓ src/__tests__/orchestrator-prompts.test.ts (44 tests) 26ms
 ✓ src/__tests__/orchestrator.test.ts (28 tests) 75ms
 ✓ src/__tests__/tdd-gate.test.ts (45 tests) 75ms
 ✓ src/__tests__/improvements.test.ts (11 tests) 22ms
 ✓ src/__tests__/prompt-lint.test.ts (2 tests) 76ms
 ✓ src/__tests__/preflight-context.test.ts (7 tests) 8ms
 ✓ src/__tests__/state-rebuild.test.ts (5 tests) 31ms
 ✓ src/__tests__/iteration-limit.test.ts (7 tests) 15ms
 ✓ src/__tests__/regress.test.ts (8 tests) 9ms
 ✓ src/__tests__/tribunal.test.ts (47 tests) 6084ms
   ✓ runTribunalWithRetry — Crash Detection and Retry > TC-11: Crash on first attempt, legitimate FAIL on retry  3003ms
   ✓ runTribunalWithRetry — Crash Detection and Retry > TC-12: Two consecutive crashes returns exhausted-retry FAIL  3002ms
 ✓ src/__tests__/agent-spawner.test.ts (16 tests) 9028ms
   ✓ spawnAgentWithRetry — retry on crash > retries on crash, returns on success  3003ms
   ✓ spawnAgentWithRetry — retry on crash > returns crash result after exhausting retries  3002ms
   ✓ spawnAgentWithRetry — retry on crash > uses custom crashDetector when provided  3003ms

 Test Files  14 passed (14)
      Tests  303 passed (303)
   Start at  22:57:37
   Duration  10.46s (transform 1.58s, setup 0ms, collect 5.01s, tests 17.06s, environment 8ms, prepare 3.02s)



```

## 框架测试退出码（可信）
```
0
```

## 关键代码变更
```diff
diff --git a/docs/auto-dev/_global/lessons-global.json b/docs/auto-dev/_global/lessons-global.json
index 58b35e6..a9b5de5 100644
--- a/docs/auto-dev/_global/lessons-global.json
+++ b/docs/auto-dev/_global/lessons-global.json
@@ -7,10 +7,10 @@
     "lesson": "Phase 1 required revision",
     "topic": "lessons-evolution",
     "reusable": true,
-    "appliedCount": 20,
+    "appliedCount": 24,
     "timestamp": "2026-03-25T09:48:52.283Z",
-    "lastAppliedAt": "2026-03-26T07:19:01.900Z",
-    "score": 35,
+    "lastAppliedAt": "2026-03-26T14:42:42.104Z",
+    "score": 33,
     "feedbackHistory": [
       {
         "verdict": "helpful",
@@ -101,6 +101,18 @@
         "phase": 6,
         "topic": "tribunal-resilience",
         "timestamp": "2026-03-26T07:20:28.508Z"
+      },
+      {
+        "verdict": "not_applicable",
+        "phase": 1,
+        "topic": "circuit-breaker",
+        "timestamp": "2026-03-26T14:18:14.967Z"
+      },
+      {
+        "verdict": "not_applicable",
+        "phase": 2,
+        "topic": "circuit-breaker",
+        "timestamp": "2026-03-26T14:28:41.054Z"
       }
     ],
     "lastPositiveAt": "2026-03-26T07:20:28.508Z"
@@ -222,10 +234,10 @@
     "context": "Design review v1 found getGlobalLessons() missing writeAtomic() after retirement pass. Fixed in v2 by adding explicit persist step. This is a classic \"read-modify but forget to write\" pattern in lazy evaluation designs.",
     "topic": "lessons-evolution",
     "reusable": true,
-    "appliedCount": 20,
+    "appliedCount": 24,
     "timestamp": "2026-03-25T09:34:30.919Z",
-    "lastAppliedAt": "2026-03-26T07:19:01.900Z",
-    "score": 7,
+    "lastAppliedAt": "2026-03-26T14:42:42.104Z",
+    "score": 5,
     "feedbackHistory": [
       {
         "verdict": "helpful",
@@ -316,6 +328,18 @@
         "phase": 6,
         "topic": "tribunal-resilience",
         "timestamp": "2026-03-26T07:20:28.508Z"
+      },
+      {
+        "verdict": "not_applicable",
+        "phase": 1,
+        "topic": "circuit-breaker",
+        "timestamp": "2026-03-26T14:18:14.967Z"
+      },
+      {
+        "verdict": "not_applicable",
+        "phase": 2,
+        "topic": "circuit-breaker",
+        "timestamp": "2026-03-26T14:28:41.054Z"
       }
     ],
     "lastPositiveAt": "2026-03-26T07:20:28.508Z"
@@ -329,10 +353,10 @@
     "context": "Design review v1 caught this by tracing preflight injection path (local + global) against feedback search path (local only). Fixed by dual-file search in feedback(). Textbook violation of Rule 1: \"not only review the producer, must review the consumer.\"",
     "topic": "lessons-evolution",
     "reusable": true,
-    "appliedCount": 20,
+    "appliedCount": 24,
     "timestamp": "2026-03-25T09:34:36.026Z",
-    "lastAppliedAt": "2026-03-26T07:19:01.900Z",
-    "score": 23,
+    "lastAppliedAt": "2026-03-26T14:42:42.104Z",
+    "score": 21,
     "feedbackHistory": [
       {
         "verdict": "helpful",
@@ -423,6 +447,18 @@
         "phase": 6,
         "topic": "tribunal-resilience",
         "timestamp": "2026-03-26T07:20:28.508Z"
+      },
+      {
+        "verdict": "not_applicable",
+        "phase": 1,
+        "topic": "circuit-breaker",
+        "timestamp": "2026-03-26T14:18:14.967Z"
+      },
+      {
+        "verdict": "not_applicable",
+        "phase": 2,
+        "topic": "circuit-breaker",
+        "timestamp": "2026-03-26T14:28:41.054Z"
... (truncated, 291 lines omitted)
diff --git a/mcp/src/orchestrator-prompts.ts b/mcp/src/orchestrator-prompts.ts
index 4a30b22..9dc816c 100644
--- a/mcp/src/orchestrator-prompts.ts
+++ b/mcp/src/orchestrator-prompts.ts
@@ -3,6 +3,19 @@
  * for task agents. Output prompts must NEVER contain framework terminology.
  */
 
+// Re-export types used by orchestrator.ts
+export interface ApproachEntry {
+  id: string;
+  summary: string;
+  failCount: number;
+}
+
+export interface FailedApproach {
+  id: string;
+  summary: string;
+  failReason: string;
+}
+
 /** Terms that must NEVER appear in prompts sent to task agents. */
 export const FRAMEWORK_TERMS: RegExp[] = [
   /\bcheckpoint\b/i,
@@ -111,3 +124,92 @@ function formatTribunalIssues(detail: string): string {
   lines.push("请根据以上问题逐一修复。");
   return lines.join("\n");
 }
+
+// ---------------------------------------------------------------------------
+// Circuit Breaker — approach-plan.md parsing
+// ---------------------------------------------------------------------------
+
+/** Parse approach-plan.md content into a list of ApproachEntry objects.
+ *  Returns null if fewer than 2 approaches (need primary + at least 1 alt). */
+export function parseApproachPlan(content: string): ApproachEntry[] | null {
+  const approaches: ApproachEntry[] = [];
+
+  // Parse "## 主方案" section
+  const primaryMatch = content.match(
+    /## 主方案\s*\n([\s\S]*?)(?=\n## |$)/,
+  );
+  if (primaryMatch) {
+    const methodMatch = primaryMatch[1].match(/-\s*\*\*方法\*\*:\s*(.+)/);
+    approaches.push({
+      id: "primary",
+      summary: methodMatch?.[1]?.trim() ?? "主方案",
+      failCount: 0,
+    });
+  }
+
+  // Parse "## 备选方案 X" sections
+  const altRegex = /## 备选方案\s+(\w)\s*\n([\s\S]*?)(?=\n## |$)/g;
+  let match;
+  while ((match = altRegex.exec(content)) !== null) {
+    const label = match[1].toLowerCase();
+    const section = match[2];
+    const methodMatch = section.match(/-\s*\*\*方法\*\*:\s*(.+)/);
+    approaches.push({
+      id: `alt-${label}`,
+      summary: methodMatch?.[1]?.trim() ?? `备选方案 ${match[1]}`,
+      failCount: 0,
+    });
+  }
+
+  return approaches.length >= 2 ? approaches : null;
+}
+
+/** Extract the first meaningful line from a long feedback string. */
+export function extractOneLineReason(feedback: string): string {
+  const lines = feedback.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
+  if (lines.length === 0) return "未知原因";
+  // Return the first non-empty line, truncated to 120 chars
+  const first = lines[0];
+  return first.length > 120 ? first.slice(0, 120) + "..." : first;
+}
+
+// ---------------------------------------------------------------------------
+// Circuit Breaker — clean prompt builder
+// ---------------------------------------------------------------------------
+
+export function buildCircuitBreakPrompt(params: {
+  goal: string;
+  approach: string;
+  prohibited: FailedApproach[];
+  outputDir: string;
+}): string {
+  const lines: string[] = [];
+  lines.push("# 任务");
+  lines.push("");
+  lines.push(params.goal);
+  lines.push("");
+  lines.push("## 方案");
+  lines.push("");
+  lines.push("请按以下方案执行：");
+  lines.push(params.approach);
+  lines.push("");
+
+  if (params.prohibited.length > 0) {
+    lines.push("## 约束（以下方案已失败，禁止使用）");
... (truncated, 18 lines omitted)
diff --git a/mcp/src/orchestrator.ts b/mcp/src/orchestrator.ts
index a0ce3f9..d7c88db 100644
--- a/mcp/src/orchestrator.ts
+++ b/mcp/src/orchestrator.ts
@@ -17,7 +17,11 @@ import {
   buildRevisionPrompt,
   translateFailureToFeedback,
   containsFrameworkTerms,
+  parseApproachPlan,
+  extractOneLineReason,
+  buildCircuitBreakPrompt,
 } from "./orchestrator-prompts.js";
+import type { ApproachEntry, FailedApproach } from "./orchestrator-prompts.js";
 import { StateManager, internalCheckpoint, extractTaskList } from "./state-manager.js";
 import {
   validatePhase1ReviewArtifact,
@@ -46,6 +50,8 @@ export interface NextTaskResult {
     reason: string;
     lastFeedback: string;
   };
+  /** When true, the prompt should be executed in a fresh subagent context (clean slate, no prior failure context) */
+  freshContext?: boolean;
   /** Informational message */
   message: string;
 }
@@ -55,6 +61,7 @@ export interface NextTaskResult {
 // ---------------------------------------------------------------------------
 
 const MAX_STEP_ITERATIONS = 3;
+const MAX_APPROACH_FAILURES = 2;
 
 const PHASE_SEQUENCE: Record<string, number[]> = {
   full: [1, 2, 3, 4, 5, 6, 7],
@@ -205,12 +212,25 @@ export function parseTribunalResult(toolResult: ToolResult): { passed: boolean;
 // Step State Helpers (raw JSON read/write for extra fields)
 // ---------------------------------------------------------------------------
 
+export interface ApproachState {
+  stepId: string;
+  approaches: ApproachEntry[];
+  currentIndex: number;
+  failedApproaches: FailedApproach[];
+}
+
 interface StepState {
   step: string | null;
   stepIteration: number;
   lastValidation: string | null;
+  approachState: ApproachState | null;
 }
 
+export type ApproachAction =
+  | { action: "CONTINUE"; approachState?: ApproachState; planFeedback?: string }
+  | { action: "CIRCUIT_BREAK"; prompt: string; approachState: ApproachState; failedApproach: string; nextApproach: string }
+  | { action: "ALL_EXHAUSTED" };
+
 async function readStepState(stateFilePath: string): Promise<StepState> {
   try {
     const raw = JSON.parse(await readFile(stateFilePath, "utf-8"));
@@ -218,9 +238,10 @@ async function readStepState(stateFilePath: string): Promise<StepState> {
       step: raw.step ?? null,
       stepIteration: raw.stepIteration ?? 0,
       lastValidation: raw.lastValidation ?? null,
+      approachState: raw.approachState ?? null,
     };
   } catch {
-    return { step: null, stepIteration: 0, lastValidation: null };
+    return { step: null, stepIteration: 0, lastValidation: null, approachState: null };
   }
 }
 
@@ -273,6 +294,108 @@ export function computeNextStep(currentStep: string, phases: number[]): string |
   return null; // all done
 }
 
+// ---------------------------------------------------------------------------
+// Circuit Breaker — approach failure handling
+// ---------------------------------------------------------------------------
+
+/** Extract the goal for a given step from plan.md */
+async function getStepGoal(step: string, outputDir: string): Promise<string> {
+  const planPath = join(outputDir, "plan.md");
+  const content = await readFileSafe(planPath);
+  if (!content) return `完成步骤 ${step} 的任务`;
+
+  // Try to find a task section matching the step number
+  const phase = parseInt(step.replace(/[a-z]/g, ""), 10);
+  // Look for "## Task N:" or similar patterns
+  const taskRegex = new RegExp(
+    `## Task\\s+${phase}[^\\n]*\\n([\\s\\S]*?)(?=\\n## |$)`,
+    "i",
+  );
+  const match = content.match(taskRegex);
+  if (match) {
+    // Extract the description line (first line after heading)
+    const descLine = match[1].split("\n").map((l) => l.trim()).filter((l) => l.length > 0)[0];
+    if (descLine) return descLine;
+  }
+
+  return `完成步骤 ${step} 的任务`;
... (truncated, 216 lines omitted)
```

## 检查清单

## 裁决检查清单（Phase 5: 测试裁决）

> 默认立场是 FAIL。PASS 必须逐条举证。

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

