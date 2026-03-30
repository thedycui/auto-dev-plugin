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

## 验收报告
```
# 验收报告: test-file-regex

**日期**: 2026-03-27
**设计文档**: docs/auto-dev/test-file-regex/design.md
**验证人**: Claude Opus 4.6

## 验收结果

| AC | 描述 | 验证方式 | 结果 | 证据 |
|----|------|---------|------|------|
| AC-1 | `tdd-gate.ts` 中的 `TEST_PATTERNS` 是唯一的测试文件正则定义，其他文件中不存在独立的 `testPatterns`/`implPatterns` | grep 源码搜索 | PASS | `grep testPatterns\|implPatterns mcp/src/*.ts` 返回 0 匹配（排除测试文件） |
| AC-2 | `isTestFile("foo.test.tsx")` 返回 true | 单元测试 | PASS | tdd-gate.test.ts L59-60: `expect(isTestFile("foo.test.tsx")).toBe(true)` -- 测试通过 |
| AC-3 | `isTestFile("foo.spec.jsx")` 返回 true | 单元测试 | PASS | tdd-gate.test.ts L63-64: `expect(isTestFile("foo.spec.jsx")).toBe(true)` -- 测试通过 |
| AC-4 | `isTestFile("foo_test.rs")` 返回 true | 单元测试 | PASS | tdd-gate.test.ts L67-68: `expect(isTestFile("foo_test.rs")).toBe(true)` -- 测试通过 |
| AC-5 | `isTestFile("FooTest.kt")` 返回 true | 单元测试 | PASS | tdd-gate.test.ts L71-72: `expect(isTestFile("FooTest.kt")).toBe(true)` -- 测试通过 |
| AC-6 | `isTestFile("test_foo.py")` 返回 true | 单元测试 | PASS | tdd-gate.test.ts L75-76: `expect(isTestFile("test_foo.py")).toBe(true)` -- 测试通过 |
| AC-7 | `isTestFile("src/main/java/TestDataFactory.java")` 返回 false | 单元测试 | PASS | tdd-gate.test.ts L83-84: `expect(isTestFile("src/main/java/TestDataFactory.java")).toBe(false)` -- 测试通过 |
| AC-8 | `isImplFile("src/main/java/Foo.java")` 返回 true，`isImplFile("FooTest.java")` 返回 false | 单元测试 | PASS | tdd-gate.test.ts L106/L126: 两个断言均通过 |
| AC-9 | `countTestFiles(["foo.test.tsx", "bar.ts"])` 返回 1（通过 `isTestFile` 实现） | 单元测试 + 代码审查 | PASS | tdd-gate.test.ts L311-322: countTestFiles 测试通过；phase-enforcer.ts 中 countTestFiles 实现已改为 `diffFileNames.filter(f => isTestFile(f)).length` |
| AC-10 | `tribunal.ts` 中 `runQuickPreCheck` 和 `crossValidate` 使用 `isTestFile`/`isImplFile` 而非内联正则 | 代码审查 | PASS | tribunal.ts L31: `import { isTestFile, isImplFile } from "./tdd-gate.js"`; L455-456 (crossValidate): `files.filter(f => isImplFile(f))` / `files.filter(f => isTestFile(f))`; L662 (runQuickPreCheck): `files.filter(f => isImplFile(f))` |
| AC-11 | `index.ts` checkpoint Phase 5 逻辑使用 `isImplFile` 而非内联正则 | 代码审查 | PASS | index.ts L20: `import { ..., isImplFile } from "./tdd-gate.js"`; L530: `newFiles.filter(f => isImplFile(f)).length` |
| AC-12 | 现有测试全部通过（无 regression） | 运行 `npx vitest run` | PASS | 15 test files, 348 tests, 全部通过 (vitest 2.1.9) |

## 总结

通过率：**12/12 PASS, 0 FAIL, 0 SKIP**

结论：**PASS**

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

## 裁决检查清单（Phase 6: 验收裁决）

> 默认立场是 FAIL。PASS 必须逐条举证。

> **审查范围约束**: 只验证本次任务的验收标准（AC），不得引入任务范围外的要求。P0/P1 必须关联具体的验收标准（acRef）。

### 验收标准逐条验证
- [ ] 从 design.md 中提取每条验收标准（AC）
- [ ] 对每条标准，在 diff 中找到对应实现
- [ ] 找不到实现的标准 → FAIL
- [ ] SKIP 必须有合理理由（真的做不到，不是偷懒）

### 输出要求
- AC 验证表：AC: {描述} → PASS/FAIL/SKIP → {证据或原因}

