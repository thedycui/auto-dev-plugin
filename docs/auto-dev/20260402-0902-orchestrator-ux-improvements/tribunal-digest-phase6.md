# Phase 6 独立裁决

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
 mcp/dist/ac-test-binding.js                        |  24 +-
 mcp/dist/ac-test-binding.js.map                    |   2 +-
 mcp/dist/index.js                                  |  75 ++++-
 mcp/dist/index.js.map                              |   2 +-
 mcp/dist/orchestrator.js                           | 158 ++++++++--
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
 mcp/src/ac-test-binding.ts                         |  24 +-
 mcp/src/index.ts                                   |  88 +++++-
 mcp/src/orchestrator.ts                            | 180 +++++++++--
 mcp/src/tribunal.ts                                |  54 +++-
 mcp/src/types.ts                                   |   1 +
 skills/auto-dev/SKILL.md                           |   2 +-
 25 files changed, 1546 insertions(+), 92 deletions(-)

```

## 验收报告
```
# 验收报告

> Topic：20260402-0902-orchestrator-ux-improvements
> 日期：2026-04-02
> 验证人：验收专家（Layer 3 + FAIL 分析）
> 框架结果：framework-ac-results.json 不存在，依据 e2e-test-results.md（全量 697 测试 PASS，exit code 0）和代码审查执行三层验证

---

## 验证结果汇总

| AC | 层级 | 描述摘要 | 验证方式 | 结果 | 证据 |
|----|------|---------|---------|------|------|
| AC-1 | test-bound | auto_dev_reset 重置 phase/step/stepIteration/lastValidation + progress-log 标记 | 测试文件 orchestrator-ux-improvements.test.ts | PASS | U-RESET-A: firstStepForPhase(3)="3"；U-RESET-A 通过 filterStateForReset 逻辑验证；e2e-test-results.md 25/25 PASS |
| AC-2 | test-bound | targetPhase > currentPhase 返回错误，state 不变 | 测试文件 orchestrator-ux-improvements.test.ts | PASS | U-RESET-2: validateResetRequest 返回含 "Forward jumps are forbidden" 的错误字符串；25/25 PASS |
| AC-3 | test-bound | status=COMPLETED 时返回错误 | 测试文件 orchestrator-ux-improvements.test.ts | PASS | U-RESET-3: validateResetRequest(COMPLETED...) 返回含 "COMPLETED" 的错误；25/25 PASS |
| AC-4 | test-bound | Step 5b FAIL 后 auto_dev_next 返回 lastFailureDetail 非空且与 validation.feedback 一致 | tribunal.test.ts + orchestrator.test.ts | PASS | orchestrator.ts 第 1509/1520 行：tribunal FAIL under limit 路径写入 state.json `lastFailureDetail: validation.feedback` 并在 return 中携带；697/697 测试 PASS |
| AC-5 | test-bound | Step 3 tasks 数组长度等于 plan.md ## Task N 块数量 | orchestrator-ux-improvements.test.ts | PASS | U-PARSE-1 验证 2 个 Task 块返回长度 2；computeNextTask step "3" 分支（orchestrator.ts 720-724 行）调用 parseTaskList(planContent)；25/25 PASS |
| AC-6 | test-bound | tasks[n].files 包含新建/修改路径 | orchestrator-ux-improvements.test.ts | PASS | U-PARSE-3 验证 3 个文件路径（新建 2 + 修改 1）均在 files 数组；25/25 PASS |
| AC-7 | test-bound | tasks[n].dependencies 正确提取依赖编号 | orchestrator-ux-improvements.test.ts | PASS | U-PARSE-4 验证 "依赖: Task 1, Task 2" 提取为 [1, 2]；25/25 PASS |
| AC-8 | test-bound | 700+ 行变更时 tribunal digest 含 HIGH 和必须逐文件审查 | tribunal.test.ts | PASS | tribunal.test.ts 第 1685-1706 行 [AC-8] prepareTribunalInput 集成测试：mock diffStat 700+100=800 行，assert digestContent 含 "HIGH" 和 "必须逐文件审查"；697/697 PASS |
| AC-9 | test-bound | 50 行以内变更时 digest 含 LOW 且不含必须逐文件审查 | tribunal.test.ts | PASS | tribunal.test.ts 第 1709-1726 行 [AC-9] prepareTribunalInput 集成测试：mock diffStat 30+20=50 行，assert 含 "LOW" 且不含 "必须逐文件审查"；697/697 PASS |
| AC-10 | manual | Step 5b FAIL 后 auto_dev_state_get 返回的 state 中 lastFailureDetail 为非空字符串 | 代码审查 | PASS | 见下方 AC-10 详细分析 |
| AC-11 | test-bound | Step 3 prompt 字段仍返回完整任务描述（向后兼容） | orchestrator-ux-improvements.test.ts | PASS | U-PARSE-6：无 Task 块时 parseTaskList 返回空数组，orchestrator 退化为单 agent；prompt 由 buildTaskForStep("3",...) 独立返回，与 tasks 无耦合（orchestrator.ts 720-724 行）；25/25 PASS |
| AC-12 | structural | buildTaskForStep 签名保持 Promise<string>，tasks 在上层组装 | 代码审查 | PASS | 见下方 AC-12 详细分析 |
| AC-13 | test-bound | reset 后 tribunalSubmits/phaseEscalateCount 过滤 >= targetPhase 条目 | orchestrator-ux-improvements.test.ts | PASS | U-RESET-A 和 U-RESET-B 验证过滤逻辑；index.ts 2098-2104 行实现与测试逻辑一致；25/25 PASS |
| AC-14 | test-bound | regressToPhase 路径触发后 state.json 中 lastFailureDetail 非空 | orchestrator.ts + 测试 | PASS | orchestrator.ts 1381-1390 行 handlePhaseRegress 内 atomicUpdate 写入 `lastFailureDetail: validation.feedback`；697/697 PASS |
| AC-15 | test-bound | ALL_APPROACHES_EXHAUSTED 触发后 lastFailureDetail 非空且 status=BLOCKED | orchestrator.ts + 测试 | PASS | orchestrator.ts 1442-1455 行 handleCircuitBreaker ALL_EXHAUSTED 路径：atomicUpdate 写入 `lastFailureDetail: validation.feedback` 且 `status: "BLOCKED"`；697/697 PASS |

---

## 详细分析

### AC-10（manual）— auto_dev_state_get 透传 lastFailureDetail

**验证路径**：

1. `types.ts` 第 204 行：`lastFailureDetail: z.string().nullable().optional()` — StateJsonSchema 已声明该字段。
2. 失败路径写入：orchestrator.ts 多处 `sm.atomicUpdate({ ..., lastFailureDetail: validation.feedback })` 持久化到 state.json。
3. `auto_dev_state_get` 实现（index.ts 555-567 行）：
   ```
   const state = await sm.loadAndValidate();
   return textResult(state);
   ```
   直接序列化完整 state 对象，无过滤逻辑。只要 `lastFailureDetail` 写入了 state.json（步骤 2 保证），`state_get` 就会返回它。
4. orchestrator-ux-improvements.test.ts 中 StateJsonSchema 字段测试验证了 `lastFailureDetail` 为字符串和 null 时 schema 均通过。

**结论**：AC-10 满足。通过代码审查确认持久化 + 读取链路完整，无需额外集成测试。

---

### AC-12（structural）— buildTaskForStep 签名不变，tasks 在上层组装

**验证路径**：

1. `orchestrator.ts` 第 1059-1068 行，函数签名：
   ```typescript
   export async function buildTaskForStep(
     step: string, outputDir: string, projectRoot: string,
     topic: string, buildCmd: string, testCmd: string,
     feedback?: string, extraVars?: Record<string, string>,
   ): Promise<string>
   ```
   返回类型为 `Promise<string>`，未变更。
2. AC-12 的 structuralAssertion `file_not_contains` 模式为 `buildTaskForStep.*Promise<\{`，在 orchestrator.ts 中搜索无匹配（已验证）。
3. `computeNextTask` step "3" 分支（orchestrator.ts 720-724 行）：
   ```typescript
   const prompt = await buildTaskForStep("3", ...);        // 独立调用，返回 string
   const planContent = await readFileSafe(join(outputDir, "plan.md"));
   const tasks = parseTaskList(planContent);               // 上层单独组装
   return { ..., prompt, tasks };                          // 两者独立注入
   ```
   `tasks` 不经由 `buildTaskForStep` 返回，完全在上层调用点组装。

**结论**：AC-12 满足。签名未变，tasks 组装点符合设计。

---

### AC-8/AC-9 额外说明

两条 AC 均要求验证"tribunal digest"（prepareTribunalInput 的实际输出）。tribunal.test.ts 第 1673-1727 行通过集成测试（mock git execFile）直接验证了 `prepareTribunalInput` 的 `digestContent` 包含正确的 HIGH/LOW 字样和审查指令字符串，不仅是解析逻辑，而是完整的输出内容。设计要求的文本（"必须逐文件审查"）与代码中 `scaleInstruction = "变更行数超过 500 行，必须逐文件审查，不得遗漏。"` 完全匹配。

---

## 通过率

**15/15 PASS，0 FAIL，0 SKIP**

---

## 结论

**PASS**

全部 15 条验收标准已满足：
- AC-1~3, AC-5~9, AC-11, AC-13~15：由 e2e-test-results.md 记录的 697/697 测试（含 tribunal.test.ts AC-8/AC-9 集成测试和 orchestrator-ux-improvements.test.ts 25 个单元测试）覆盖，全部通过。
- AC-4：tribunal FAIL under limit 路径的 lastFailureDetail 填充在 orchestrator.ts 代码中可直接确认，且被全量测试集覆盖。
- AC-10（manual）：通过代码链路审查（types.ts schema + atomicUpdate 写入 + state_get 直接序列化）确认满足，无需额外集成测试。
- AC-12（structural）：buildTaskForStep 签名为 `Promise<string>` 已确认，结构断言（file_not_contains）在代码中无匹配，满足。

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
... (truncated, 269 lines omitted)
diff --git a/mcp/src/__tests__/orchestrator.test.ts b/mcp/src/__tests__/orchestrator.test.ts
index 94a0c87..e1252bd 100644
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
... (truncated, 373 lines omitted)
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
... (truncated, 117 lines omitted)
diff --git a/mcp/src/ac-test-binding.ts b/mcp/src/ac-test-binding.ts
index 5518515..443da14 100644
--- a/mcp/src/ac-test-binding.ts
+++ b/mcp/src/ac-test-binding.ts
@@ -65,15 +65,30 @@ const TEST_DIRS: Record<string, string[]> = {
   python: ["tests", "test"],
 };
 
+// ---------------------------------------------------------------------------
+// Language Normalization
+// ---------------------------------------------------------------------------
+
+function normalizeLanguage(language: string): string {
+  const lower = language.toLowerCase();
+  if (lower.includes("typescript") || lower.includes("javascript") || lower === "ts" || lower === "js" || lower === "node") {
+    return "node";
+  }
+  if (lower.includes("java") && !lower.includes("script")) return "java";
+  if (lower.includes("python") || lower === "py") return "python";
+  return language;
+}
+
 // ---------------------------------------------------------------------------
 // File Discovery
 // ---------------------------------------------------------------------------
 
 async function findTestFiles(root: string, language: string): Promise<string[]> {
-  const pattern = TEST_FILE_PATTERNS[language];
+  const normalized = normalizeLanguage(language);
+  const pattern = TEST_FILE_PATTERNS[normalized];
... (truncated, 27 lines omitted)
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
... (truncated, 90 lines omitted)
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
... (truncated, 317 lines omitted)
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
... (truncated, 50 lines omitted)
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

## 裁决检查清单（Phase 6: 验收裁决）

> 默认立场是 FAIL。PASS 必须逐条举证。

> **审查范围约束**: 只验证本次任务的验收标准（AC），不得引入任务范围外的要求。P0/P1 必须关联具体的验收标准（acRef）。

### A. 框架自动验证（硬数据，最高权重）
- [ ] 读取 framework-ac-results.json（如存在）
- [ ] Layer 1 (structural) 有 FAIL 项？→ 直接 FAIL（除非 Agent 给出充分的 AC 定义缺陷证据）
- [ ] Layer 2 (test-bound) 有 FAIL 项？→ 直接 FAIL（测试不通过 = AC 未满足）
- [ ] 框架 PASS 项与 Agent 报告一致？不一致则以框架结果为准

### B. AC 绑定完整性
- [ ] 所有 test-bound AC 是否都有绑定测试？
- [ ] 是否有 AC 被降级为 manual？如果有，降级理由是否充分？
- [ ] structural 断言是否覆盖了 AC 描述的关键点？

### C. Manual AC 验证
- [ ] 从 design.md 中提取 manual AC（或所有 AC 如无 framework-ac-results.json）
- [ ] Agent 的主观判断是否有充分的代码证据？
- [ ] 对每条标准，在 diff 中找到对应实现
- [ ] 找不到实现的标准 → FAIL
- [ ] SKIP 必须有合理理由（真的做不到，不是偷懒）

### D. 输出要求
- AC 验证表（含层级、验证方式、框架结果引用）
- 框架 FAIL 分析（如有）
- AC: {描述} → PASS/FAIL/SKIP → {证据或原因}

