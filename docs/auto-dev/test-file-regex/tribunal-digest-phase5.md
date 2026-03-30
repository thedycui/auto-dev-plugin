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
 mcp/dist/index.js                                  |    178 +-
 mcp/dist/index.js.map                              |      2 +-
 mcp/dist/orchestrator.js                           |     29 +-
 mcp/dist/orchestrator.js.map                       |      2 +-
 mcp/dist/phase-enforcer.js                         |     10 +-
 mcp/dist/phase-enforcer.js.map                     |      2 +-
 mcp/dist/state-manager.js                          |     18 +-
 mcp/dist/state-manager.js.map                      |      2 +-
 mcp/dist/tribunal.js                               |     60 +-
 mcp/dist/tribunal.js.map                           |      2 +-
 mcp/dist/types.d.ts                                |     11 +
 mcp/dist/types.js                                  |      9 +-
 mcp/dist/types.js.map                              |      2 +-
 mcp/node_modules/.package-lock.json                |    800 +
 mcp/node_modules/typescript/README.md              |     50 -
 mcp/node_modules/typescript/SECURITY.md            |     41 -
 mcp/node_modules/typescript/bin/tsc                |      2 -
 mcp/node_modules/typescript/bin/tsserver           |      2 -
 mcp/node_modules/typescript/lib/_tsc.js            | 133818 ------------
 mcp/node_modules/typescript/lib/_tsserver.js       |    659 -
 .../typescript/lib/_typingsInstaller.js            |    222 -
 .../lib/cs/diagnosticMessages.generated.json       |   2122 -
 .../lib/de/diagnosticMessages.generated.json       |   2122 -
 .../lib/es/diagnosticMessages.generated.json       |   2122 -
 .../lib/fr/diagnosticMessages.generated.json       |   2122 -
 .../lib/it/diagnosticMessages.generated.json       |   2122 -
 .../lib/ja/diagnosticMessages.generated.json       |   2122 -
 .../lib/ko/diagnosticMessages.generated.json       |   2122 -
 mcp/node_modules/typescript/lib/lib.d.ts           |     22 -
 .../typescript/lib/lib.decorators.d.ts             |    384 -
 .../typescript/lib/lib.decorators.legacy.d.ts      |     22 -
 .../typescript/lib/lib.dom.asynciterable.d.ts      |     41 -
 mcp/node_modules/typescript/lib/lib.dom.d.ts       |  31451 ---
 .../lib/pl/diagnosticMessages.generated.json       |   2122 -
 .../lib/pt-br/diagnosticMessages.generated.json    |   2122 -
 .../lib/ru/diagnosticMessages.generated.json       |   2122 -
 .../lib/tr/diagnosticMessages.generated.json       |   2122 -
 mcp/node_modules/typescript/lib/tsc.js             |      8 -
 mcp/node_modules/typescript/lib/tsserver.js        |      8 -
 mcp/node_modules/typescript/lib/tsserverlibrary.js |     21 -
 mcp/node_modules/typescript/lib/typesMap.json      |    497 -
 mcp/node_modules/typescript/lib/typescript.js      | 200276 ------------------
 .../typescript/lib/typingsInstaller.js             |      8 -
 mcp/node_modules/typescript/lib/watchGuard.js      |     53 -
 .../lib/zh-cn/diagnosticMessages.generated.json    |   2122 -
 .../lib/zh-tw/diagnosticMessages.generated.json    |   2122 -
 mcp/node_modules/typescript/package.json           |    120 -
 mcp/src/__tests__/tdd-gate.test.ts                 |     61 +
 mcp/src/index.ts                                   |      8 +-
 mcp/src/phase-enforcer.ts                          |     12 +-
 mcp/src/tdd-gate.ts                                |      7 +-
 mcp/src/tribunal.ts                                |     25 +-
 52 files changed, 1123 insertions(+), 395408 deletions(-)

```

## E2E 测试结果
```
# E2E Test Results: test-file-regex

## Execution Summary

- **Date**: 2026-03-27
- **Test Runner**: vitest 2.1.9
- **Total Tests**: 56 (tdd-gate.test.ts) + 292 (other files) = 348
- **Result**: ALL PASSED

## TC-1 ~ TC-10: Unit Tests (tdd-gate.test.ts)

All implemented in `mcp/src/__tests__/tdd-gate.test.ts`:

| TC | Test Name | Status |
|----|-----------|--------|
| TC-1 | matches foo.test.tsx | PASSED |
| TC-2 | matches foo.spec.jsx | PASSED |
| TC-3 | matches foo_test.rs | PASSED |
| TC-4 | matches FooTest.kt | PASSED |
| TC-5 | matches test_foo.py | PASSED |
| TC-6 | matches tests/test_bar.py | PASSED |
| TC-7 | does NOT match src/main/java/TestDataFactory.java as false positive | PASSED |
| TC-8 | does NOT match FooTest.java (isImplFile) | PASSED |
| TC-9 | countTestFiles > counts test files in a diff list | PASSED |
| TC-10 | countTestFiles > returns 0 for empty list | PASSED |

## TC-11: grep Verification



Result: No matches found in phase-enforcer.ts, tribunal.ts, or index.ts. PASSED.

## TC-12: Full Regression



PASSED - no regression.

## Verdict: ALL 12 TEST CASES PASSED

```

## 框架执行的测试日志（可信）
```

> auto-dev-plugin@1.0.0 test
> cd mcp && npm test


> auto-dev-mcp-server@8.0.0 test
> vitest run


 RUN  v2.1.9 /Users/admin/.claude/plugins/auto-dev-plugin/mcp

 ✓ src/__tests__/orchestrator.test.ts (28 tests) 76ms
 ✓ src/__tests__/batch1-guard-optimization.test.ts (21 tests) 111ms
 ✓ src/__tests__/lessons-manager.test.ts (35 tests) 579ms
 ✓ src/__tests__/e2e-integration.test.ts (19 tests) 689ms
 ✓ src/__tests__/orchestrator-prompts.test.ts (44 tests) 71ms
 ✓ src/__tests__/tdd-gate.test.ts (56 tests) 60ms
 ✓ src/__tests__/tdd-gate-integration.test.ts (29 tests) 370ms
 ✓ src/__tests__/improvements.test.ts (11 tests) 21ms
 ✓ src/__tests__/state-rebuild.test.ts (5 tests) 15ms
 ✓ src/__tests__/preflight-context.test.ts (7 tests) 9ms
 ✓ src/__tests__/regress.test.ts (8 tests) 8ms
 ✓ src/__tests__/iteration-limit.test.ts (7 tests) 7ms
 ✓ src/__tests__/prompt-lint.test.ts (2 tests) 35ms
 ✓ src/__tests__/tribunal.test.ts (60 tests) 6096ms
   ✓ runTribunalWithRetry — Crash Detection and Retry > TC-11: Crash on first attempt, legitimate FAIL on retry 3005ms
   ✓ runTribunalWithRetry — Crash Detection and Retry > TC-12: Two consecutive crashes returns exhausted-retry FAIL 3001ms
 ✓ src/__tests__/agent-spawner.test.ts (16 tests) 9029ms
   ✓ spawnAgentWithRetry — retry on crash > retries on crash, returns on success 3003ms
   ✓ spawnAgentWithRetry — retry on crash > returns crash result after exhausting retries 3002ms
   ✓ spawnAgentWithRetry — retry on crash > uses custom crashDetector when provided 3003ms

 Test Files  15 passed (15)
      Tests  348 passed (348)
   Start at  08:34:25
   Duration  12.20s (transform 1.90s, setup 0ms, collect 4.97s, tests 17.18s, environment 6ms, prepare 3.64s)



```

## 框架测试退出码（可信）
```
0
```

## 关键代码变更
```diff
diff --git a/mcp/src/index.ts b/mcp/src/index.ts
index 625edc3..6a1d4d4 100644
--- a/mcp/src/index.ts
+++ b/mcp/src/index.ts
@@ -17,7 +17,7 @@ import { GitManager } from "./git-manager.js";
 import type { StateJson } from "./types.js";
 import { LessonsManager } from "./lessons-manager.js";
 import { validateCompletion, validatePhase5Artifacts, validatePhase6Artifacts, validatePhase7Artifacts, countTestFiles, checkIterationLimit, validatePredecessor, parseInitMarker, validatePhase1ReviewArtifact, validatePhase2ReviewArtifact, isTddExemptTask, computeNextDirective } from "./phase-enforcer.js";
-import { validateRedPhase, buildTestCommand, TDD_TIMEOUTS } from "./tdd-gate.js";
+import { validateRedPhase, buildTestCommand, TDD_TIMEOUTS, isImplFile } from "./tdd-gate.js";
 import { extractDocSummary, extractTaskList } from "./state-manager.js";
 import { runRetrospective } from "./retrospective.js";
 import { TRIBUNAL_PHASES } from "./tribunal-schema.js";
@@ -527,11 +527,7 @@ server.tool(
         const newFiles = diffOutput.trim().split("\n").filter(f => f.length > 0);
         testFileCount = countTestFiles(newFiles);
         // Count new implementation files (non-test source files)
-        const implPatterns = [/\.java$/, /\.ts$/, /\.js$/, /\.py$/, /\.go$/, /\.rs$/, /\.kt$/];
-        const testPatterns = [/[Tt]est\.(java|py|ts|js|kt|go|rs)$/, /\.test\.(ts|js|tsx|jsx)$/, /\.spec\.(ts|js|tsx|jsx)$/, /_test\.(go|py)$/, /tests?\//i];
-        implFileCount = newFiles.filter(f =>
-          implPatterns.some(p => p.test(f)) && !testPatterns.some(p => p.test(f))
-        ).length;
+        implFileCount = newFiles.filter(f => isImplFile(f)).length;
       } catch { /* ignore git errors */ }
 
       let resultsContent: string | null = null;

diff --git a/mcp/src/phase-enforcer.ts b/mcp/src/phase-enforcer.ts
index 721ef0c..6314ee9 100644
--- a/mcp/src/phase-enforcer.ts
+++ b/mcp/src/phase-enforcer.ts
@@ -8,6 +8,7 @@
 import { readFile } from "node:fs/promises";
 import { join } from "node:path";
 import type { StateJson } from "./types.js";
+import { isTestFile } from "./tdd-gate.js";
 
 /** Phase 元数据 */
 const PHASE_META: Record<number, { name: string; description: string }> = {
@@ -375,16 +376,7 @@ export function validatePhase6Artifacts(
  * 通过扫描 git diff 输出中的文件名模式判断。
  */
 export function countTestFiles(diffFileNames: string[]): number {
-  const testPatterns = [
-    /[Tt]est\.(java|py|ts|js|kt|go|rs)$/,
-    /\.test\.(ts|js|tsx|jsx)$/,
-    /\.spec\.(ts|js|tsx|jsx)$/,
-    /_test\.(go|py)$/,
-    /tests?\//i,
-  ];
-  return diffFileNames.filter((f) =>
-    testPatterns.some((p) => p.test(f))
-  ).length;
+  return diffFileNames.filter(f => isTestFile(f)).length;
 }
 
 // ---------------------------------------------------------------------------

diff --git a/mcp/src/tdd-gate.ts b/mcp/src/tdd-gate.ts
index d00182c..477b574 100644
--- a/mcp/src/tdd-gate.ts
+++ b/mcp/src/tdd-gate.ts
@@ -9,10 +9,11 @@
 // ---------------------------------------------------------------------------
 
 const TEST_PATTERNS = [
-  /[Tt]est\.(java|ts|js|py)$/,
+  /[Tt]est\.(java|ts|js|py|kt|go|rs)$/,
   /\.test\.(ts|js|tsx|jsx)$/,
-  /\.spec\.(ts|js)$/,
-  /_test\.(go|py)$/,
+  /\.spec\.(ts|js|tsx|jsx)$/,
+  /_test\.(go|py|rs)$/,
+  /(?:^|\/)test_\w+\.py$/,
 ];
 
 const TEST_RESOURCE_EXT = /\.(json|yml|yaml|xml|sql|txt|csv)$/;

diff --git a/mcp/src/tribunal.ts b/mcp/src/tribunal.ts
index f9a5321..b232e67 100644
--- a/mcp/src/tribunal.ts
+++ b/mcp/src/tribunal.ts
@@ -28,6 +28,7 @@ import {
   computeNextDirective,
 } from "./phase-enforcer.js";
 import { LessonsManager } from "./lessons-manager.js";
+import { isTestFile, isImplFile } from "./tdd-gate.js";
 import type { NextDirective } from "./phase-enforcer.js";
 import { getClaudePath } from "./agent-spawner.js";
 
@@ -451,18 +452,8 @@ export async function crossValidate(
       }, (err, stdout) => resolve(err ? "" : stdout || ""));
     });
     const files = diffOutput.trim().split("\n").filter((f) => f.length > 0);
-    const implPatterns = [/\.java$/, /\.ts$/, /\.js$/, /\.py$/];
-    const testPatterns = [
-      /[Tt]est\.(java|ts|js|py)$/,
-      /\.test\.(ts|js)$/,
-      /\.spec\.(ts|js)$/,
-    ];
-    const implCount = files.filter(
-      (f) => implPatterns.some((p) => p.test(f)) && !testPatterns.some((p) => p.test(f)),
-    ).length;
-    const testCount = files.filter(
-      (f) => testPatterns.some((p) => p.test(f)),
-    ).length;
+    const implCount = files.filter(f => isImplFile(f)).length;
+    const testCount = files.filter(f => isTestFile(f)).length;
     if (implCount > 0 && testCount === 0) {
       return `${implCount} 个新增实现文件但 0 个测试文件，裁决 Agent 不应判定 PASS`;
     }
@@ -668,15 +659,7 @@ async function runQuickPreCheck(
       resultsContent = await readFile(join(outputDir, "e2e-test-results.md"), "utf-8");
     } catch { /* file doesn't exist */ }
 
-    const implPatterns = [/\.java$/, /\.ts$/, /\.js$/, /\.py$/];
-    const testPatterns = [
-      /[Tt]est\.(java|ts|js|py)$/,
-      /\.test\.(ts|js)$/,
-      /\.spec\.(ts|js)$/,
-    ];
-    const implFileCount = files.filter(
-      (f) => implPatterns.some((p) => p.test(f)) && !testPatterns.some((p) => p.test(f)),
-    ).length;
+    const implFileCount = files.filter(f => isImplFile(f)).length;
 
     const result = await validatePhase5Artifacts(outputDir, testFileCount, resultsContent, implFileCount);
     if (!result.valid) {

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

