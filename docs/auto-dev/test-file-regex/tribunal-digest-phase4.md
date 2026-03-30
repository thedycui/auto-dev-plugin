# Phase 4 独立裁决

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

## Phase 1 设计评审
```
# 设计审查报告: 统一测试文件正则检测

**Topic**: test-file-regex
**审查日期**: 2026-03-27
**审查结论**: **NEEDS_REVISION**

---

## 1. 目标对齐

- [x] 问题陈述清晰 -- 4 处重复正则、模式不一致、维护成本高，描述准确
- [x] 方案解决的是根因而非症状 -- 统一到单一真相源是正确的根因方案
- [x] 范围合理 -- 只做正则统一，不做过度设计
- [x] 有成功标准 -- AC-1 到 AC-12 覆盖全面

## 2. 技术可行性

- [x] 设计中引用的类/方法/接口在代码中真实存在（已 grep 验证）
  - `tdd-gate.ts` 的 `TEST_PATTERNS` (L11-16)、`SOURCE_EXT` (L34)、`isTestFile()` (L24)、`isImplFile()` (L39) -- 均存在，行号准确
  - `phase-enforcer.ts` 的 `countTestFiles()` (L377) 和内部 `testPatterns` (L378-384) -- 存在，行号准确
  - `tribunal.ts` 的两处 `testPatterns`/`implPatterns` (L454-459, L671-676) -- 存在，行号准确
  - `index.ts` 的 `testPatterns`/`implPatterns` (L530-531) -- 存在，行号准确
- [x] API 签名正确 -- `isTestFile(filePath: string): boolean` 和 `isImplFile(filePath: string): boolean` 签名不变
- [x] 数据流可追踪
- [x] 依赖项可用
- [x] 无明显性能问题

### P0: 新 TEST_PATTERNS 不是旧模式的超集，存在回归风险

设计 4.1 节提出的新 `TEST_PATTERNS` 第一条为:

```typescript
/[Tt]est\.(java|kt)$/,  // 只匹配 java 和 kt
```

但当前 `tdd-gate.ts` L12 的模式为:

```typescript
/[Tt]est\.(java|ts|js|py)$/,  // 匹配 java, ts, js, py
```

且 `phase-enforcer.ts` L379 和 `index.ts` L531 的模式为:

```typescript
/[Tt]est\.(java|py|ts|js|kt|go|rs)$/,  // 匹配全部 7 种语言
```

**新模式从 `[Tt]est.` 形式中移除了 `ts|js|py|go|rs`**，导致以下文件将不再被识别为测试文件:

| 文件名 | 当前是否匹配 | 新模式是否匹配 | 风险 |
|--------|------------|--------------|------|
| `TestFoo.py` | 是 (Python unittest 命名) | 否 | **回归** |
| `TestFoo.ts` | 是 | 否 | 低风险（TS 惯例是 `.test.ts`） |
| `FooTest.js` | 是 | 否 | 低风险（JS 惯例是 `.test.js`） |
| `FooTest.go` | 是 (phase-enforcer) | 否 | 低风险（Go 惯例是 `_test.go`） |
| `FooTest.rs` | 是 (phase-enforcer) | 否 | 低风险（Rust 惯例是 `_test.rs`） |

其中 `TestFoo.py` 是 Python unittest 的标准命名（`class TestFoo(unittest.TestCase)` 对应文件 `TestFoo.py`）。设计新增了 `test_foo.py`（pytest 命名）但遗漏了 `TestFoo.py`（unittest 命名）。

**修复建议**: 第一条正则应保持全语言覆盖，与 `phase-enforcer.ts` 对齐:

```typescript
/[Tt]est\.(java|ts|js|py|kt|go|rs)$/,
```

## 3. 完整性

- [x] 边界情况已覆盖 -- false positive 分析合理
- [x] 错误处理已定义 -- 不涉及错误处理变更
- [x] 回滚策略 -- git revert，合理
- [x] 新配置项已文档化 -- 无新配置项

### P2: `test_*.py` 模式的边界考量

新增的 `/(?:^|\/)test_\w+\.py$/` 使用 `\w+` 要求至少一个字符，这是合理的。但 `\w` 不匹配连字符，所以 `test/test_my-module.py` 不会被匹配。Python 文件名中使用连字符极其罕见（会导致 import 失败），所以这不是实际问题，仅记录。

## 4. 跨组件影响分析

### 步骤 A -- 变更清单

| 变更项 | 文件 | 类型 |
|--------|------|------|
| 完善 `TEST_PATTERNS` 正则 | `tdd-gate.ts` | 修改 |
| `countTestFiles` 改用 `isTestFile` | `phase-enforcer.ts` | 修改 |
| 两处内联正则替换 | `tribunal.ts` | 修改 |
| 一处内联正则替换 | `index.ts` | 修改 |

### 步骤 B -- 调用方验证（grep 验证完成）

**`isTestFile` 调用方**:
- `tdd-gate.ts` L40 (`isImplFile` 内部调用) -- 不受影响
- `tdd-gate.test.ts` L6 -- 需要新增测试用例
- `tdd-gate-integration.test.ts` L21 -- 不受影响
- 改造后新增: `phase-enforcer.ts`、`tribunal.ts`、`index.ts`

**`isImplFile` 调用方**:
- `tdd-gate.test.ts` L6 -- 现有测试
- `tdd-gate-integration.test.ts` L21 -- 现有测试
- 改造后新增: `tribunal.ts`、`index.ts`

... (truncated, 53 lines omitted)
```

## Phase 2 计划评审
```
# 计划审查报告: test-file-regex

**审查时间**: 2026-03-27
**审查对象**: plan.md (7 个 Task)
**对照**: design.md (方案 A, 12 个 AC)

---

## A. 覆盖度（设计 -> 计划追溯）

| 设计章节 | 计划任务 | 覆盖 |
|---------|---------|------|
| 4.1 统一 TEST_PATTERNS 正则 | Task 1 | OK |
| 4.2 countTestFiles 改造 | Task 3 | OK |
| 4.3 tribunal.ts runQuickPreCheck | Task 4 | OK |
| 4.3 tribunal.ts crossValidate | Task 5 | OK |
| 4.4 index.ts checkpoint | Task 6 | OK |
| 7. AC-2~AC-8 测试用例 | Task 2 | OK |
| 7. AC-9 countTestFiles 测试 | Task 2/7 | 见 P1-1 |
| 7. AC-10/AC-11 代码审查 | Task 7 grep | OK |
| 7. AC-12 无 regression | Task 7 | OK |

## B. 任务粒度（INVEST）

整体粒度合理。Task 4 和 Task 5 都是改同一个文件 tribunal.ts，拆分为两个 Task 有利于分步验证，可接受。

## C. 依赖关系

```
Task 1 (tdd-gate 正则)
  |--- Task 2 (测试用例)
  |--- Task 3 (phase-enforcer)
  |--- Task 4 (tribunal runQuickPreCheck)
  |      |--- Task 5 (tribunal crossValidate)
  |--- Task 6 (index.ts)
  |
  +--> Task 7 (全量验证, 依赖 2/3/5/6)
```

无循环依赖。关键路径: 1 -> 4 -> 5 -> 7。依赖标注清晰。

## D. 任务描述质量

所有任务均包含文件路径、改动描述、完成标准。文件路径使用绝对路径，便于执行。

---

## 问题清单

### P1-1: Task 2 未明确覆盖 AC-9（countTestFiles 集成测试）

**问题**: 设计文档 AC-9 要求 `countTestFiles(["foo.test.tsx", "bar.ts"])` 返回 1，验证 countTestFiles 通过 isTestFile 实现后的行为正确性。Task 2 的描述只提到"覆盖 AC-2 ~ AC-8"，未包含 AC-9。Task 7 的完成标准也只有 grep 检查和全量测试通过，没有明确要求新增 AC-9 的测试用例。

**风险**: countTestFiles 改造后（Task 3）虽然逻辑简单，但作为 index.ts 和 tribunal.ts 的共用函数，行为变化（移除了 tests?/ 目录匹配）应该有对应的测试用例验证。

**修复建议**: 在 Task 2 的描述中将覆盖范围从"AC-2 ~ AC-8"扩展为"AC-2 ~ AC-9"，或在 Task 3 中新增一条完成标准："为 countTestFiles 新增测试用例验证 AC-9"。

### P2-1: Task 5 对 Task 4 的依赖可放宽为对 Task 1 的依赖

**问题**: Task 5 标注依赖 Task 4，但实际上 Task 5 只需要 Task 4 中新增的 import 语句。由于两者改的是同一个文件，sequential 执行是合理的，但严格来说 Task 5 的实质依赖是 Task 1（正则定义）。

**影响**: 不影响执行，当前排列顺序已经正确。仅为准确性建议。

### P2-2: index.ts 中 isTestFile 是否已被 import 未在 Task 6 中说明

**问题**: 设计文档 4.4 节指出 index.ts 当前已 import isTestFile。但经源码验证，index.ts:20 的 import 是 `validateRedPhase, buildTestCommand, TDD_TIMEOUTS`，并未 import isTestFile 或 isImplFile。设计文档此处描述有误。Task 6 的描述中说"新增 isImplFile"到现有 tdd-gate import 语句，也隐含假设 isTestFile 已存在。

**修复建议**: Task 6 描述应明确为："在 index.ts 第 20 行的 tdd-gate import 中新增 isImplFile（若 isTestFile 也未被 import，则一并新增）"。实际上 index.ts 的 implFileCount 计算逻辑只需要 isImplFile（因为 isImplFile 内部已排除测试文件），所以只新增 isImplFile 即可满足需求。这不是 blocker，但描述应更准确。

---

## E. 路径激活风险评估（规则 2）

本次变更是纯重构，所有调用方（tribunal.ts runQuickPreCheck/crossValidate、index.ts checkpoint、phase-enforcer.ts countTestFiles）均为生产在用的代码路径。tdd-gate.ts 的 isTestFile/isImplFile 也已有单元测试和集成测试覆盖。**无未验证的休眠路径**。

## F. 调用方审查（规则 1）

isTestFile/isImplFile 函数签名不变（string -> boolean），返回值语义不变。正则扩展是超集（只会让更多文件被识别为测试文件），不会导致原来被识别的文件失去匹配。唯一的行为收窄点是 countTestFiles 移除 tests?/ 目录匹配，这是设计文档中明确标注的"行为改进"。**调用方兼容性无风险**。

---

## 总结

| 级别 | 数量 | 详情 |
|------|------|------|
| P0 | 0 | - |
| P1 | 1 | AC-9 测试覆盖遗漏 |
| P2 | 2 | 依赖精确性、import 描述准确性 |

**结论: PASS**

P1-1 问题不构成阻塞，在实现阶段补充 AC-9 测试用例即可。计划整体结构清晰、覆盖度完整、依赖关系正确、任务粒度合理。

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

## 裁决检查清单（Phase 4: Code Review + Phase 1/2 回溯验证）

> 默认立场是 FAIL。PASS 必须逐条举证。

> **审查范围约束**: 只审查本次 diff 涉及的文件和变更。不得对 diff 之外的代码、架构或历史遗留问题提出 P0/P1。P0/P1 必须关联具体的验收标准（acRef）。

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

