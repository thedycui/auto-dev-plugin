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
 .claude-plugin/marketplace.json                  |   2 +-
 .claude-plugin/plugin.json                       |   2 +-
 agents/auto-dev-acceptance-validator.md          |  30 ++++--
 mcp/dist/index.js                                |  97 ++++++++++++++++++-
 mcp/dist/index.js.map                            |   2 +-
 mcp/dist/orchestrator.js                         |  67 ++++++++++++-
 mcp/dist/orchestrator.js.map                     |   2 +-
 mcp/dist/phase-enforcer.js                       |  71 ++++++++++++++
 mcp/dist/phase-enforcer.js.map                   |   2 +-
 mcp/dist/tribunal-checklists.js                  |  22 ++++-
 mcp/dist/tribunal-checklists.js.map              |   2 +-
 mcp/dist/tribunal.js                             |   1 +
 mcp/dist/tribunal.js.map                         |   2 +-
 mcp/dist/types.d.ts                              |   7 +-
 mcp/dist/types.js.map                            |   2 +-
 mcp/src/index.ts                                 | 114 ++++++++++++++++++++++-
 mcp/src/orchestrator.ts                          |  81 ++++++++++++++++
 mcp/src/phase-enforcer.ts                        | 102 ++++++++++++++++++++
 mcp/src/tribunal-checklists.ts                   |  22 ++++-
 mcp/src/tribunal.ts                              |   1 +
 mcp/src/types.ts                                 |   7 ++
 skills/auto-dev/SKILL.md                         |  20 +++-
 skills/auto-dev/checklists/design-review.md      |   7 ++
 skills/auto-dev/prompts/phase1-architect.md      |  47 ++++++++++
 skills/auto-dev/prompts/phase5-test-architect.md |  29 ++++++
 skills/auto-dev/prompts/phase6-acceptance.md     |  37 ++++++--
 26 files changed, 734 insertions(+), 44 deletions(-)

Untracked new files:
 docs/auto-dev/20260331-0029-refactor-orchestrator-god-function/approach-plan.md (new file)
 docs/auto-dev/20260331-0029-refactor-orchestrator-god-function/design-review.md (new file)
 docs/auto-dev/20260331-0029-refactor-orchestrator-god-function/design.md (new file)
 docs/auto-dev/20260331-0029-refactor-orchestrator-god-function/plan-review.md (new file)
 docs/auto-dev/20260331-0029-refactor-orchestrator-god-function/plan.md (new file)
 docs/auto-dev/20260331-0029-refactor-orchestrator-god-function/progress-log.md (new file)
 docs/auto-dev/20260331-0029-refactor-orchestrator-god-function/state.json (new file)
 docs/auto-dev/20260401-2045-executable-ac/approach-plan.md (new file)
 docs/auto-dev/20260401-2045-executable-ac/design-review.md (new file)
 docs/auto-dev/20260401-2045-executable-ac/design.md (new file)
 docs/auto-dev/20260401-2045-executable-ac/plan-review.md (new file)
 docs/auto-dev/20260401-2045-executable-ac/plan.md (new file)
 docs/auto-dev/20260401-2045-executable-ac/progress-log.md (new file)
 docs/auto-dev/20260401-2045-executable-ac/state.json (new file)
 docs/auto-dev/tribunal-crash-observability (new file)
 docs/design-review-enhancement.md (new file)
 docs/docs/auto-dev/_global/lessons-global.json (new file)
 mcp/dist/ac-runner.js (new file)
 mcp/dist/ac-runner.js.map (new file)
 mcp/dist/ac-schema.js (new file)
 mcp/dist/ac-schema.js.map (new file)
 mcp/dist/ac-test-binding.js (new file)
 mcp/dist/ac-test-binding.js.map (new file)
 mcp/npm (new file)
 mcp/src/__tests__/ac-integration.test.ts (new file)
 mcp/src/__tests__/ac-runner.test.ts (new file)
 mcp/src/__tests__/ac-schema.test.ts (new file)
 mcp/src/__tests__/ac-test-binding.test.ts (new file)
 mcp/src/ac-runner.ts (new file)
 mcp/src/ac-schema.ts (new file)
 mcp/src/ac-test-binding.ts (new file)

```

## Phase 1 设计评审
```
# Design Review（第二轮）

> 审查日期：2026-04-01
> 审查轮次：第二轮（验证第一轮修复）

## 第一轮问题修复验证

### P0-1: 删除第十二节 additionalRepos 引用

**状态：已修复**

第十二节（第 823-834 行）已不再引用 `additionalRepos`。仅文档头部更新记录中保留了"移除 additionalRepos"的变更说明，属正常的变更历史描述。

### P0-2: runAcBoundTests 改为逐条 AC 独立运行

**状态：已修复**

第 297-316 行代码已改为 `for (const binding of bindings)` 逐条运行，每次调用 `buildTargetedTestCommand(language, binding.testFile, [binding], projectRoot)`，传入单个 binding 的数组。注释明确说明"逐条 AC 独立运行测试，避免同文件多 AC 时 exitCode 误归因"。

### P1-1: testCmd 改为从 ctx.testCmd 获取

**状态：已修复**

第 679-680 行注释明确写出"testCmd 从 OrchestratorContext (ctx.testCmd) 获取"，代码使用 `ctx.testCmd`。`language` 仍从 `state.stack.language` 获取（该路径在 `StackInfoSchema` 中确实存在），两者来源正确。

### P1-4: FAIL 时仍调用 acceptance-validator Agent 分析

**状态：已修复**

第 697-714 行：当 structural 或 test-bound 有 FAIL 时，先调用 `runAcceptanceValidatorAgent(projectRoot, outputDir, topic)` 生成分析报告，再返回失败结果。feedback 中包含"详细分析见 acceptance-report.md"指引。修复了第一轮指出的第五节流程描述与 8.2 实现代码的矛盾。

### P1-5: hash 扩展为 32 字符，正则改为 [a-f0-9]+

**状态：已修复**

第 612 行 `.slice(0, 32)` 保留 128 bit hash。第 659 行正则 `([a-f0-9]+)` 正确匹配十六进制字符。

### P1-6: auto-dev 生成的设计强制要求 AC JSON

**状态：已修复**

第 625-636 行：当 `acContent` 为 null 时，检查 design.md 是否包含 AC 表格（`/\|\s*AC-\d+/`）且为 auto-dev 自生成（`!sm.designDocSource`），两者同时满足时返回 `AC_JSON_MISSING` 阻断。`sm.designDocSource` 在 `mcp/src/types.ts` 和 `mcp/src/index.ts` 中已有定义和赋值，路径正确。

## 新发现的问题

### P2 (优化建议)

1. **第 3.3 节示例格式与实现代码不一致** — 第 162 行示例写的是 `hash=sha256:xxxx`（带 `sha256:` 前缀），但第 618 行实现代码写入的是 `hash=${acHash}`（纯十六进制，无前缀），第 659 行正则也匹配纯十六进制 `([a-f0-9]+)`。代码自身是一致的，但示例会误导读者。建议将第 162 行示例改为 `hash=xxxxxxxx...`（不带 `sha256:` 前缀）。

## 第一轮遗留项状态

以下第一轮 P1/P2 项维持原判，可在实现阶段处理，不阻塞设计通过：

| 原编号 | 描述 | 状态 |
|--------|------|------|
| P1-2 | `execWithTimeout` 和 `groupBy` 工具函数不存在 | 实现阶段处理（`groupBy` 已无需，逐条运行后不再需要分组） |
| P1-3 | `config_value` 类型缺少 YAML 解析能力 | 实现阶段处理 |
| P2-1 | `cd ${projectRoot}` 路径注入风险 | 实现阶段改用 `cwd` 选项 |
| P2-2 | `test_passes` 与 Layer 2 功能重叠 | 实现阶段在 prompt 中明确边界 |
| P2-3 | `escapeRegex` 函数未定义 | 实现阶段处理 |
| P2-4 | manual 占比阈值 40% 硬编码 | 实现阶段抽为常量 |

## 结论

**PASS**

所有 P0（2 项）和关键 P1（4 项）均已在文档中正确体现修复，未引入新的矛盾或阻塞性问题。新发现的 P2 级别文档示例不一致不影响设计通过。遗留的 P1-2/P1-3 和 P2 项可在实现阶段处理。

```

## Phase 2 计划评审
```
# Plan Review（第二轮）

> 基于第一轮 review 修订后的计划重新审查。

## 第一轮问题修复验证

| 编号 | 级别 | 问题 | 修复方式 | 状态 |
|------|------|------|---------|------|
| P0-1 | P0 | phase-enforcer.ts 改动未覆盖 | 新增 Task 6a，含 validateAcJson() 和 validateAcIntegrity() | **已修复** |
| P0-2 | P0 | index.ts Phase 6 兜底路径遗漏 | 新增 Task 7a，覆盖 auto_dev_submit(phase=6) handler | **已修复** |
| P1-1 | P1 | Phase 6 preflight 绑定覆盖率检查未体现 | Task 7 描述显式包含 validateAcBindingCoverage() 及 BLOCKED 逻辑 | **已修复** |
| P1-2 | P1 | test-bound AC 降级策略未体现 | Task 7 描述增加"或允许降级为 manual 并记录降级原因" | **已修复** |
| P1-3 | P1 | Task 4 缺少 ac-schema.test.ts | Task 4 文件列表新增 ac-schema.test.ts | **已修复** |
| P1-4 | P1 | Task 11 未覆盖 index.ts 兜底路径 | Task 11 新增第 6 个场景覆盖 index.ts 兜底路径 | **已修复** |

## P0 (阻塞性问题)

无。

## P1 (重要问题)

无。

## P2 (优化建议，不阻塞)

- **Task 6 与 Task 6a 描述存在轻微不一致**：Task 6 描述中仍保留了内联实现的措辞（"尝试读取...schema 校验...manual 占比检查..."），而 Task 6a 的完成标准要求"Task 6 的 index.ts 中 Phase 1 校验逻辑调用 validateAcJson() 而非内联实现"。实现时应以 Task 6a 的完成标准为准（调用函数而非内联），但不影响功能正确性。
- **Task 9 粒度偏大**（沿用第一轮 P2）：同时修改 3 个 prompt 文件，建议拆为子任务以便独立验证。
- **Task 12 的编译验证可前移**（沿用第一轮 P2）：建议在 Task 7 完成后做一次增量编译验证。
- **Task 2 的 build_succeeds/test_passes 安全性约束**（沿用第一轮 P2）：建议在完成标准中明确命令白名单。

## Coverage Matrix

| 设计章节/功能点 | 对应任务 | 覆盖状态 |
|----------------|---------|---------|
| 二、AC 分类（三层定义） | Task 1 | OK |
| 三、Layer 1 断言类型白名单（7 种） | Task 1, Task 2 | OK |
| 三、AC 结构化文件格式（JSON schema） | Task 1 | OK |
| 三、防篡改机制（Phase 1 hash 写入） | Task 6, Task 6a | OK |
| 三、防篡改机制（Phase 6 hash 校验） | Task 7, Task 6a | OK |
| 四、AC 标注规范（Java/TS/Python） | Task 3 | OK |
| 四、绑定发现机制（grep 扫描） | Task 3 | OK |
| 四、绑定完整性检查（validateAcBindingCoverage） | Task 3（定义），Task 7（preflight 调用） | OK |
| 四、测试运行（buildTargetedTestCommand） | Task 3 | OK |
| 四、missing AC 降级策略 | Task 7（降级为 manual 并记录原因） | OK |
| 五、Phase 6 完整流程（6 步） | Task 7, Task 7a | OK |
| 六、Phase 1 Architect prompt 改动 | Task 9 | OK |
| 六、Design Review checklist 改动 | Task 10 | OK |
| 六、Phase 5 Test Architect prompt 改动 | Task 9 | OK |
| 六、Phase 6 Acceptance Validator 改动 | Task 10 | OK |
| 六、Phase 6 Acceptance prompt 改动 | Task 9 | OK |
| 七、Tribunal checklist 改动 | Task 8 | OK |
| 八、Phase 1 checkpoint AC JSON 校验 | Task 6, Task 6a | OK |
| 八、Phase 6 orchestrator 框架自动执行 | Task 7 | OK |
| 八、Phase 6 index.ts 兜底路径 | Task 7a | OK |
| 八、phase-enforcer.ts 改动 | Task 6a | OK |
| 八、types.ts re-export | Task 6 | OK |
| 八、新增文件（ac-schema/ac-runner/ac-test-binding） | Task 1, 2, 3 | OK |
| 八、测试文件 | Task 4, 5 | OK |
| 九、向后兼容（无 AC JSON 退化） | Task 6, Task 7, Task 7a | OK |
| SKILL.md 更新 | Task 12 | OK |
| 单元测试 | Task 4, 5 | OK |
| 集成测试 | Task 11 | OK |

## 结论

**PASS**

第一轮的 2 个 P0 和 4 个 P1 问题均已修复到位，无新增阻塞性或重要问题。计划与设计文档的 Coverage Matrix 全部为 OK，关键路径标注合理（Task 1 → Task 3 → Task 5 → Task 7 → Task 7a → Task 11 → Task 12），任务依赖关系正确。可以进入实现阶段。

```

## 关键代码变更
```diff
diff --git a/.claude-plugin/marketplace.json b/.claude-plugin/marketplace.json
index bffe3ac..319b9fd 100644
--- a/.claude-plugin/marketplace.json
+++ b/.claude-plugin/marketplace.json
@@ -7,7 +7,7 @@
     {
       "name": "auto-dev",
       "source": "./",
-      "version": "5.1.1",
+      "version": "9.2.1",
       "description": "自治开发循环 — 从设计到验收的全自动闭环"
     }
   ]

diff --git a/.claude-plugin/plugin.json b/.claude-plugin/plugin.json
index f6a14c4..943be6a 100644
--- a/.claude-plugin/plugin.json
+++ b/.claude-plugin/plugin.json
@@ -1,6 +1,6 @@
 {
   "name": "auto-dev",
-  "version": "9.1.0",
+  "version": "9.2.1",
   "description": "Intelligent development automation plugin that provides guided workflows, context-aware code generation, and best-practice enforcement for full-stack projects",
   "author": {
     "name": "Auto Dev Team"

diff --git a/agents/auto-dev-acceptance-validator.md b/agents/auto-dev-acceptance-validator.md
index 888f0b4..d6bc1a5 100644
--- a/agents/auto-dev-acceptance-validator.md
+++ b/agents/auto-dev-acceptance-validator.md
@@ -5,13 +5,22 @@ capabilities: ["acceptance-testing", "code-verification", "test-verification", "
 
 # Auto-Dev Acceptance Validator
 
-你是验收专家。你的任务是逐条验证设计文档中的验收标准（AC-N）是否被正确实现。
+你是验收专家。你的任务是在框架自动验证的基础上，完成 manual AC 的验证和 FAIL 分析。
 
-## 验证方式（按优先级）
+## 验证方式（更新）
 
-1. **代码验证**：读相关源码，确认功能逻辑已实现
-2. **测试验证**：确认有对应的测试用例且通过
-3. **运行验证**（如可行）：构造输入数据实际运行，验证输出
+Phase 6 采用三层验证，你只负责 Layer 3（manual）和 FAIL 分析：
+
+1. **Layer 1 (structural)**: 框架已自动执行，结果在 framework-ac-results.json 中
+2. **Layer 2 (test-bound)**: 框架已自动运行测试，结果在 framework-ac-results.json 中
... (truncated, 30 lines omitted)
diff --git a/mcp/src/index.ts b/mcp/src/index.ts
index 0645e7f..9a87448 100644
--- a/mcp/src/index.ts
+++ b/mcp/src/index.ts
@@ -16,7 +16,7 @@ import { TemplateRenderer } from "./template-renderer.js";
 import { GitManager } from "./git-manager.js";
 import type { StateJson } from "./types.js";
 import { LessonsManager } from "./lessons-manager.js";
-import { validateCompletion, validatePhase5Artifacts, validatePhase6Artifacts, validatePhase7Artifacts, countTestFiles, checkIterationLimit, validatePredecessor, parseInitMarker, validatePhase1ReviewArtifact, validatePhase2ReviewArtifact, isTddExemptTask, computeNextDirective } from "./phase-enforcer.js";
+import { validateCompletion, validatePhase5Artifacts, validatePhase6Artifacts, validatePhase7Artifacts, countTestFiles, checkIterationLimit, validatePredecessor, parseInitMarker, validatePhase1ReviewArtifact, validatePhase2ReviewArtifact, isTddExemptTask, computeNextDirective, validateAcJson, validateAcIntegrity } from "./phase-enforcer.js";
 import { validateRedPhase, buildTestCommand, TDD_TIMEOUTS, isImplFile } from "./tdd-gate.js";
 import { extractDocSummary, extractTaskList } from "./state-manager.js";
 import { runRetrospective } from "./retrospective.js";
@@ -26,6 +26,9 @@ import type { ToolResult } from "./tribunal.js";
 import { generateRetrospectiveData } from "./retrospective-data.js";
 import { getClaudePath } from "./tribunal.js";
 import { computeNextTask } from "./orchestrator.js";
+import { runStructuralAssertions } from "./ac-runner.js";
+import { discoverAcBindings, validateAcBindingCoverage, runAcBoundTests } from "./ac-test-binding.js";
+import { AcceptanceCriteriaSchema } from "./ac-schema.js";
 
... (truncated, 126 lines omitted)
diff --git a/mcp/src/orchestrator.ts b/mcp/src/orchestrator.ts
index e6e29e7..ebbd89e 100644
--- a/mcp/src/orchestrator.ts
+++ b/mcp/src/orchestrator.ts
@@ -27,7 +27,11 @@ import {
   validatePhase1ReviewArtifact,
   validatePhase2ReviewArtifact,
   isTddExemptTask,
+  validateAcIntegrity,
 } from "./phase-enforcer.js";
+import { runStructuralAssertions } from "./ac-runner.js";
+import { discoverAcBindings, validateAcBindingCoverage, runAcBoundTests } from "./ac-test-binding.js";
+import { AcceptanceCriteriaSchema } from "./ac-schema.js";
 import { evaluateTribunal } from "./tribunal.js";
 import type { EvalTribunalResult } from "./tribunal.js";
 import { TemplateRenderer } from "./template-renderer.js";
@@ -820,6 +824,83 @@ export async function validateStep(
     }
 
     case "6": {
+      // AC framework execution — runs before Tribunal
... (truncated, 80 lines omitted)
diff --git a/mcp/src/phase-enforcer.ts b/mcp/src/phase-enforcer.ts
index 2e71e18..fe7677f 100644
--- a/mcp/src/phase-enforcer.ts
+++ b/mcp/src/phase-enforcer.ts
@@ -9,6 +9,8 @@ import { readFile } from "node:fs/promises";
 import { join } from "node:path";
 import type { StateJson } from "./types.js";
 import { isTestFile } from "./tdd-gate.js";
+import { AcceptanceCriteriaSchema, computeAcHash } from "./ac-schema.js";
+import type { AcceptanceCriteria } from "./ac-schema.js";
 
 /** Phase 元数据 */
 const PHASE_META: Record<number, { name: string; description: string }> = {
@@ -589,3 +591,103 @@ export async function isTddExemptTask(outputDir: string, task: number): Promise<
 
   return /\*\*TDD\*\*:\s*skip/i.test(section);
 }
+
+// ---------------------------------------------------------------------------
+// AC JSON Validation (Phase 1 checkpoint)
+// ---------------------------------------------------------------------------
... (truncated, 97 lines omitted)
diff --git a/mcp/src/tribunal-checklists.ts b/mcp/src/tribunal-checklists.ts
index 0ba3b63..dead177 100644
--- a/mcp/src/tribunal-checklists.ts
+++ b/mcp/src/tribunal-checklists.ts
@@ -64,14 +64,28 @@ const PHASE_6_CHECKLIST = `## 裁决检查清单（Phase 6: 验收裁决）
 
 > **审查范围约束**: 只验证本次任务的验收标准（AC），不得引入任务范围外的要求。P0/P1 必须关联具体的验收标准（acRef）。
 
-### 验收标准逐条验证
-- [ ] 从 design.md 中提取每条验收标准（AC）
+### A. 框架自动验证（硬数据，最高权重）
+- [ ] 读取 framework-ac-results.json（如存在）
+- [ ] Layer 1 (structural) 有 FAIL 项？→ 直接 FAIL（除非 Agent 给出充分的 AC 定义缺陷证据）
+- [ ] Layer 2 (test-bound) 有 FAIL 项？→ 直接 FAIL（测试不通过 = AC 未满足）
+- [ ] 框架 PASS 项与 Agent 报告一致？不一致则以框架结果为准
+
+### B. AC 绑定完整性
+- [ ] 所有 test-bound AC 是否都有绑定测试？
+- [ ] 是否有 AC 被降级为 manual？如果有，降级理由是否充分？
+- [ ] structural 断言是否覆盖了 AC 描述的关键点？
+
... (truncated, 17 lines omitted)
diff --git a/mcp/src/tribunal.ts b/mcp/src/tribunal.ts
index 0746326..1642d6d 100644
--- a/mcp/src/tribunal.ts
+++ b/mcp/src/tribunal.ts
@@ -1084,3 +1084,4 @@ export function buildTribunalLog(
   log += `## Raw Output\n\`\`\`\n${verdict.raw}\n\`\`\`\n`;
   return log;
 }
+// test

diff --git a/mcp/src/types.ts b/mcp/src/types.ts
index 9b3fbe3..4b4c1ce 100644
--- a/mcp/src/types.ts
+++ b/mcp/src/types.ts
@@ -7,6 +7,13 @@
 
 import { z } from "zod/v4";
 
+// Re-export AC schema types for external consumers
+export type {
+  AcceptanceCriterion,
+  AcceptanceCriteria,
+  AssertionType,
+} from "./ac-schema.js";
+
 // ---------------------------------------------------------------------------
 // Enums / Shared Literals
 // ---------------------------------------------------------------------------

diff --git a/skills/auto-dev/SKILL.md b/skills/auto-dev/SKILL.md
index c8a010b..59732cb 100644
--- a/skills/auto-dev/SKILL.md
+++ b/skills/auto-dev/SKILL.md
@@ -51,8 +51,24 @@ auto_dev_init(projectRoot, topic, mode?, skipE2e?, tdd?, costMode?, onConflict?,
 result = auto_dev_next(projectRoot, topic)
 while !result.done:
   if result.prompt:
-    // 必须 dispatch 子 agent，禁止自己执行
-    Agent(subagent_type=result.agent, prompt=result.prompt, model=result.model)
+    // Step 3 并行优化：按 task 拆分并行派发，其余 step 保持单 agent 派发
+    if result.step === "3":
+      // 1. 读取 {outputDir}/plan.md，解析所有 Task（格式：`- [ ] Task N: ...`）
+      // 2. 提取每个 task 关联的文件列表（plan 中 task 描述里提到的文件名）
+      // 3. 按文件重叠分 Wave：文件无重叠 → 同 Wave 并行；有重叠 → 下一 Wave 顺序执行
+      // 4. 构造每个 task 的 scoped_prompt：
+      //    = result.prompt 的共享 header（项目根目录/输出目录/构建命令等）
+      //      + 单个 task 描述（只包含该 task 的内容与完成标准）
+      // 5. 对每个 Wave，在同一条消息里并行 dispatch（一条消息多个 Agent 调用）：
+      for each wave in waves:
+        parallel:
... (truncated, 11 lines omitted)
diff --git a/skills/auto-dev/checklists/design-review.md b/skills/auto-dev/checklists/design-review.md
index 6c3b5e5..5c7db0a 100644
--- a/skills/auto-dev/checklists/design-review.md
+++ b/skills/auto-dev/checklists/design-review.md
@@ -53,3 +53,10 @@
 - [ ] 有架构图 / 流程图？
 - [ ] 技术约束和假设显式声明？
 - [ ] 迁移路径（如果替换旧系统）？
+
+## I. 结构化 AC 审查
+- [ ] acceptance-criteria.json 文件已生成且 schema 合法？
+- [ ] 每条 AC 都有 layer 标注（structural / test-bound / manual）？
+- [ ] structural 类型的 AC 断言是否合理（path 是否可能存在、pattern 是否正确）？
+- [ ] manual 占比是否 <= 40%？
+- [ ] test-bound 类型的 AC 描述是否足够具体，让 Phase 5 能写出对应测试？

diff --git a/skills/auto-dev/prompts/phase1-architect.md b/skills/auto-dev/prompts/phase1-architect.md
index 87b548f..8ee64f8 100644
--- a/skills/auto-dev/prompts/phase1-architect.md
+++ b/skills/auto-dev/prompts/phase1-architect.md
@@ -49,6 +49,53 @@
 - 例：`AC-N: 关键数据转换节点有 WARN 级别日志，包含输入/输出值和类型，可通过 grep '[TRACE]' 验证`
 - 例：`AC-N: 外部 API 调用有日志记录请求摘要和响应状态，便于部署后定位问题`
 
+8. **结构化验收标准** — 在写入 design.md 的同时，将 AC 以结构化格式写入 `{output_dir}/acceptance-criteria.json`
+
+### acceptance-criteria.json 编写指南
+
+每条 AC 需要指定验证层级：
+- `structural`：可以通过文件检查、配置值检查验证的 AC — 必须写 structuralAssertions
+- `test-bound`：需要通过运行测试验证的功能行为 AC — 测试阶段会绑定测试，此处无需写断言
+- `manual`：无法自动验证的 AC（架构合理性、代码风格等）
+
+**约束**：`manual` 占比不得超过 40%。
+
+structural 断言可用类型：
+- `file_exists`：检查文件存在（支持 glob）
... (truncated, 38 lines omitted)
diff --git a/skills/auto-dev/prompts/phase5-test-architect.md b/skills/auto-dev/prompts/phase5-test-architect.md
index ec6468e..a4b1a45 100644
--- a/skills/auto-dev/prompts/phase5-test-architect.md
+++ b/skills/auto-dev/prompts/phase5-test-architect.md
@@ -89,6 +89,21 @@
 ## TC-2: ...
 ```
 
+## AC 绑定规范
+
+5. 读取 `{output_dir}/acceptance-criteria.json`（如存在），对所有 `layer: "test-bound"` 的 AC：
+   - 为每条 AC 设计至少一个对应测试用例
+   - 在测试用例标题中标注 `[AC-N]` 前缀
+
+每个 `layer: "test-bound"` 的 AC 必须在测试代码中有对应标注：
+
+**Java**: `@DisplayName("[AC-1] 描述")` 或方法名 `AC1_methodName`
+**TypeScript**: `test("[AC-1] description", ...)` 或 `describe("AC-1: ...", ...)`
+**Python**: `def test_ac1_description():` 或 `@pytest.mark.ac("AC-1")`
+
+验收阶段框架会自动扫描这些标注并运行对应测试，作为 AC 的自动验证。
... (truncated, 27 lines omitted)
diff --git a/skills/auto-dev/prompts/phase6-acceptance.md b/skills/auto-dev/prompts/phase6-acceptance.md
index 3eee189..30c0165 100644
--- a/skills/auto-dev/prompts/phase6-acceptance.md
+++ b/skills/auto-dev/prompts/phase6-acceptance.md
@@ -13,12 +13,28 @@
 
 ## Requirements
 
-1. 从 `{output_dir}/design.md` 提取所有 AC-N 验收标准
-2. 如果 design.md 无显式 AC 章节，从设计目标和改动清单中自动提取
-3. 对每条 AC 执行验证（代码验证 > 测试验证 > 运行验证）
-4. 将验收报告写入 `{output_dir}/acceptance-report.md`
+1. 读取 `{output_dir}/framework-ac-results.json`（框架自动验证结果，如存在）
+2. 从 `{output_dir}/design.md` 提取所有 AC-N 验收标准
+3. 如果 design.md 无显式 AC 章节，从设计目标和改动清单中自动提取
+4. 执行三层验证（见下文）
+5. 将验收报告写入 `{output_dir}/acceptance-report.md`
 
-## Verification Hierarchy
+## 三层验证流程
+
... (truncated, 36 lines omitted)
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

