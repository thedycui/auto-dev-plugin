# Phase 6 独立裁决

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

## 验收报告
```
# 验收报告：断路器机制（Circuit Breaker）

## AC 来源

设计文档 `design.md` 第 7 节"验收标准"，共 8 条 AC。

## 验收结果

| AC | 描述 | 验证方式 | 结果 | 证据 |
|----|------|---------|------|------|
| AC-1 | 当 step 验证失败且 approach-plan.md 存在时，orchestrator 能正确解析方案列表（主方案 + 至少 1 个备选），并创建 approachState | 代码审查 + 单元测试 | PASS | `parseApproachPlan()` 在 `orchestrator-prompts.ts:134` 实现，正确解析"主方案"和"备选方案 X"段落，不足 2 个方案时返回 null。`handleApproachFailure()` 在 `orchestrator.ts:324` 调用解析结果创建 approachState。测试覆盖：TC-01, TC-02, TC-03 及 5 个 parseApproachPlan 基础测试（全部 PASS） |
| AC-2 | 当前方案连续失败 2 次后，computeNextTask 返回清零 prompt（包含目标 + 下一个方案 + 禁用列表），而非 revision prompt | 代码审查 + 单元测试 | PASS | `handleApproachFailure()` 在 `orchestrator.ts:362` 检查 `failCount < MAX_APPROACH_FAILURES(=2)`，达到阈值后调用 `buildCircuitBreakPrompt()` 构建清零 prompt。`buildCircuitBreakPrompt()` 在 `orchestrator-prompts.ts:180` 输出包含"禁止:"字样和方案指示的 prompt。测试覆盖：TC-04/05、基础 CIRCUIT_BREAK 测试（验证 prompt 包含"禁止"且不含失败堆栈） |
| AC-3 | 断路器切换方案后，stepIteration 重置为 0 | 代码审查 + 单元测试 | PASS | `computeNextTask()` 在 `orchestrator.ts:718` 的 CIRCUIT_BREAK 分支中调用 `writeStepState` 设置 `stepIteration: 0`。测试覆盖：TC-04/05 验证 writeStepState 调用参数包含 `stepIteration: 0`，基础 CIRCUIT_BREAK 测试同样验证 |
| AC-4 | 所有方案耗尽时（currentIndex >= approaches.length），computeNextTask 返回 escalation 且 status 变为 BLOCKED | 代码审查 + 单元测试 | PASS | `handleApproachFailure()` 在 `orchestrator.ts:375` 检查 `currentIndex >= approaches.length` 返回 ALL_EXHAUSTED。`computeNextTask()` 在 `orchestrator.ts:734` 处理 ALL_EXHAUSTED：调用 `sm.atomicUpdate({ status: "BLOCKED" })`，返回 `escalation.reason === "all_approaches_exhausted"`。测试覆盖：TC-06、基础 ALL_EXHAUSTED 测试（验证 BLOCKED 状态和 escalation 返回） |
| AC-5 | 无 approach-plan.md 时，行为与改动前完全一致（向后兼容） | 代码审查 + 单元测试 | PASS | `handleApproachFailure()` 在 `orchestrator.ts:336-337` 检查文件不存在时返回 `{ action: "CONTINUE" }`。`computeNextTask()` 在 `orchestrator.ts:762` 无 approachState 时仍使用 `MAX_STEP_ITERATIONS` 限制。测试覆盖：TC-07b（无 approach-plan.md 走正常 revision）、TC-08（无 approach-plan.md 超限走 escalation） |
| AC-6 | approach-plan.md 格式不规范（缺少"备选方案"段落、只有主方案等）时，parseApproachPlan 返回 null，不触发断路器 | 代码审查 + 单元测试 | PASS | `parseApproachPlan()` 在 `orchestrator-prompts.ts:164` 检查 `approaches.length >= 2`，不足则返回 null。`handleApproachFailure()` 在 `orchestrator.ts:340-344` 对 null 返回 CONTINUE 并附带 planFeedback 提示补充备选方案。测试覆盖：TC-09（只有主方案返回 planFeedback）、TC-10（随机文本返回 null）、TC-26（格式不规范返回 planFeedback） |
| AC-7 | 清零 prompt 不包含任何 FRAMEWORK_TERMS 中定义的框架术语 | 代码审查 + 单元测试 | PASS | `buildCircuitBreakPrompt()` 在 `orchestrator-prompts.ts:180-215` 使用纯自然语言构建 prompt，不含 checkpoint/tribunal/phase 等术语。测试覆盖：TC-11 调用 `containsFrameworkTerms()` 验证返回 false；`orchestrator.test.ts:704` 在集成测试中同样验证 |
| AC-8 | step "3"、"5b" 的初始 prompt 包含方案计划指令段，step "1a"、"7" 等不包含 | 代码审查 + 单元测试 | PASS | `orchestrator.ts:594` 定义 `APPROACH_PLAN_STEPS = ["3", "4a", "5b"]`，仅对这些 step 追加方案计划指令。指令内容为自然语言，要求输出 approach-plan.md。测试覆盖：TC-15（step 5b 包含"方案计划"和"approach-plan.md"）、TC-16（step 1a 不包含）、TC-17（step 7 不包含） |

## 额外发现（代码审查报告 P1-1 修复确认）

代码审查报告中的 P1-1 问题（步骤推进时未清除 approachState 导致跨步骤状态泄漏）已修复。`orchestrator.ts:857` 在步骤推进时显式设置 `approachState: null`。TC-18 测试用例验证了此修复。

## 汇总

- 通过率：**8/8 PASS, 0 FAIL, 0 SKIP**
- 全量测试：303 个用例全部通过（含 38 个新增断路器测试）
- 结论：**PASS**

```

## 关键代码变更
```diff
diff --git a/docs/auto-dev/_global/lessons-global.json b/docs/auto-dev/_global/lessons-global.json
index 58b35e6..a0a887f 100644
--- a/docs/auto-dev/_global/lessons-global.json
+++ b/docs/auto-dev/_global/lessons-global.json
@@ -7,10 +7,10 @@
     "lesson": "Phase 1 required revision",
     "topic": "lessons-evolution",
     "reusable": true,
-    "appliedCount": 20,
+    "appliedCount": 25,
     "timestamp": "2026-03-25T09:48:52.283Z",
-    "lastAppliedAt": "2026-03-26T07:19:01.900Z",
-    "score": 35,
+    "lastAppliedAt": "2026-03-26T15:00:38.324Z",
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
+    "appliedCount": 25,
     "timestamp": "2026-03-25T09:34:30.919Z",
-    "lastAppliedAt": "2026-03-26T07:19:01.900Z",
-    "score": 7,
+    "lastAppliedAt": "2026-03-26T15:00:38.324Z",
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
+    "appliedCount": 25,
     "timestamp": "2026-03-25T09:34:36.026Z",
-    "lastAppliedAt": "2026-03-26T07:19:01.900Z",
-    "score": 23,
+    "lastAppliedAt": "2026-03-26T15:00:38.324Z",
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

## 裁决检查清单（Phase 6: 验收裁决）

> 默认立场是 FAIL。PASS 必须逐条举证。

### 验收标准逐条验证
- [ ] 从 design.md 中提取每条验收标准（AC）
- [ ] 对每条标准，在 diff 中找到对应实现
- [ ] 找不到实现的标准 → FAIL
- [ ] SKIP 必须有合理理由（真的做不到，不是偷懒）

### 输出要求
- AC 验证表：AC: {描述} → PASS/FAIL/SKIP → {证据或原因}

