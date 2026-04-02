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
 docs/auto-dev/20260401-2045-executable-ac/acceptance-report.md (new file)
 docs/auto-dev/20260401-2045-executable-ac/approach-plan.md (new file)
 docs/auto-dev/20260401-2045-executable-ac/design-review.md (new file)
 docs/auto-dev/20260401-2045-executable-ac/design.md (new file)
 docs/auto-dev/20260401-2045-executable-ac/e2e-test-cases.md (new file)
 docs/auto-dev/20260401-2045-executable-ac/e2e-test-results.md (new file)
 docs/auto-dev/20260401-2045-executable-ac/plan-review.md (new file)
 docs/auto-dev/20260401-2045-executable-ac/plan.md (new file)
 docs/auto-dev/20260401-2045-executable-ac/progress-log.md (new file)
 docs/auto-dev/20260401-2045-executable-ac/state.json (new file)
 docs/auto-dev/20260401-2045-executable-ac/tribunal-digest-phase4.md (new file)
 docs/auto-dev/20260401-2045-executable-ac/tribunal-digest-phase5.md (new file)
 docs/auto-dev/20260401-2045-executable-ac/tribunal-phase4.md (new file)
 docs/auto-dev/20260401-2045-executable-ac/tribunal-phase5.md (new file)
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

## 验收报告
```
# 验收报告

> Topic: executable-ac
> 日期: 2026-04-01
> 验证方式: 全部 manual（本项目无 framework-ac-results.json，因为本项目本身就是实现 AC 框架的项目）

## 说明

设计文档 `design.md` 没有独立的 "验收标准" 章节（含 AC-1, AC-2... 编号），验收标准隐含在各功能模块的设计描述和 `plan.md` 的 Task 完成标准中。以下从设计文档的核心功能需求中提取可验证的验收项。

---

## 验收标准表

| AC | 描述 | 验证方式 | 结果 | 证据 |
|----|------|---------|------|------|
| D-1 | AC Schema：Zod schema 定义 7 种断言类型的 discriminatedUnion，包含 version/criteria 顶层结构 | 代码审查 | PASS | `ac-schema.ts` L13-46 定义了 file_exists/file_not_exists/file_contains/file_not_contains/config_value/build_succeeds/test_passes 共 7 种；L54-60 AcceptanceCriterionSchema 含 id/description/layer/structuralAssertions；L68-71 顶层含 version+criteria |
| D-2 | AC Hash：computeAcHash 产生 32 字符 hex，覆盖 id+layer+structuralAssertions，不含 description | 代码审查 + 测试验证 | PASS | `ac-schema.ts` L84-94 实现 SHA-256 取前 32 hex，payload 只含 id/layer/structuralAssertions；测试 ac-schema.test.ts "should produce a 32-char hex string"/"should not include description in hash" 均 PASS |
| D-3 | Structural 断言引擎：实现 7 种断言类型，file_exists 支持 glob，不执行任意 shell 命令（build_succeeds/test_passes 除外使用受控 execFile） | 代码审查 + 测试验证 | PASS | `ac-runner.ts` L96-218 逐类型实现；globToRegex+findFilesByGlob 实现 glob 支持（L36-69）；execWithTimeout 使用 execFile 而非 exec（L75-90）；ac-runner.test.ts 26 tests 全 PASS |
| D-4 | runStructuralAssertions 只处理 layer="structural" 的 AC，跳过 test-bound 和 manual | 代码审查 + 测试验证 | PASS | `ac-runner.ts` L235 `criteria.filter(c => c.layer === "structural")`；测试 "non-structural ACs: should skip test-bound and manual ACs" PASS |
| D-5 | 测试绑定发现：discoverAcBindings 支持 Java(@DisplayName+void ACN_)、Node(test/it/describe)、Python(def test_acN_/@pytest.mark.ac) 三种语言 | 代码审查 + 测试验证 | PASS | `ac-test-binding.ts` L41-53 定义三种语言的正则模式；ac-test-binding.test.ts 涵盖 java/node/python 发现场景，18 tests 全 PASS |
| D-6 | 绑定覆盖率检查：validateAcBindingCoverage 返回 covered/missing/extraBindings | 代码审查 + 测试验证 | PASS | `ac-test-binding.ts` L188-204 实现完整；测试 "should report covered, missing, and extra bindings" / "should return empty missing when all covered" / "should handle no test-bound ACs" 均 PASS |
| D-7 | 测试命令生成：buildTargetedTestCommand 按语言生成 Maven/Vitest/pytest 命令 | 代码审查 + 测试验证 | PASS | `ac-test-binding.ts` L218-241 switch 语句覆盖 java/node/python/default；测试 "should generate vitest command for node" / "should generate maven command for java" / "should generate pytest command for python" 均 PASS |
| D-8 | Phase 1 checkpoint：AC JSON schema 校验 + manual 占比 >40% 阻断 + AC_LOCK hash 写入 progress-log | 代码审查 + 测试验证 | PASS | `index.ts` L744-761 读取 AC JSON 调用 validateAcJson 并写入 AC_LOCK；`phase-enforcer.ts` L611-648 validateAcJson 实现 schema 校验+manual 占比检查+hash 计算；集成测试 TC-E2E-06/07/08 均 PASS |
| D-9 | Phase 1 checkpoint：无 AC JSON 但 design.md 有 AC 表格且为 auto-dev 自生成时 BLOCKED | 代码审查 | PASS | `index.ts` L773-774 包含对应逻辑：检测 `/\|\s*AC-\d+/` 匹配 + `!sm.designDocSource` 条件 |
| D-10 | Phase 6 防篡改：validateAcIntegrity 对比 AC_LOCK hash，不匹配返回 BLOCKED | 代码审查 + 测试验证 | PASS | `phase-enforcer.ts` L664-693 validateAcIntegrity 实现完整；`orchestrator.ts` L838 和 `index.ts` L1874 均调用此函数；集成测试 TC-E2E-03 "hash tamper BLOCKED" PASS |
| D-11 | Phase 6 orchestrator 主路径：hash 校验 -> structural 断言 -> test-bound 测试 -> 写 framework-ac-results.json -> FAIL 短路 | 代码审查 + 测试验证 | PASS | `orchestrator.ts` L828-897 按设计顺序执行：读取 AC JSON -> validateAcIntegrity -> discoverAcBindings+validateAcBindingCoverage -> runStructuralAssertions -> runAcBoundTests -> writeFile framework-ac-results.json -> FAIL 判断；集成测试 TC-E2E-01~05 覆盖 |
| D-12 | Phase 6 index.ts 兜底路径：非 orchestrator 模式下同样执行 AC 框架验证 | 代码审查 + 测试验证 | PASS | `index.ts` L1868-1924 实现与 orchestrator 同构的逻辑（读 AC JSON -> integrity -> structural -> bindings -> tests -> write results -> FAIL 短路）；集成测试 TC-E2E-09/10 覆盖 |
| D-13 | 向后兼容：无 AC JSON 时退化为旧 Tribunal 流程 | 代码审查 + 测试验证 | PASS | `orchestrator.ts` L828-830 try-catch 读取 AC JSON，不存在时 acContent=null 跳过新流程；集成测试 TC-E2E-05 "no AC JSON legacy fallback" PASS |
| D-14 | Phase 6 tribunal checklist 增强：含框架自动验证(A)/AC 绑定完整性(B)/Manual AC 验证(C)/输出要求(D) 四板块 | 代码审查 | PASS | `tribunal-checklists.ts` L61-79 Phase 6 checklist 含 A(framework-ac-results.json/Layer 1 FAIL/Layer 2 FAIL)/B(test-bound 绑定/降级/structural 覆盖)/C(manual AC 提取/证据/SKIP 理由)/D(输出要求) |
| D-15 | Prompt 更新：phase1-architect.md 含 AC JSON 编写指南 + 7 种断言类型 + manual<=40% 约束 | 代码审查 | PASS | `phase1-architect.md` L52-86 包含 acceptance-criteria.json 编写指南、layer 分类说明、7 种断言类型白名单、manual<=40% 约束、示例 JSON |
| D-16 | Prompt 更新：phase5-test-architect.md 含 AC 绑定规范 + [AC-N] 标注格式 + AC 绑定矩阵模板 | 代码审查 | PASS | `phase5-test-architect.md` L92-132 包含 AC 绑定规范、三语言标注格式、未绑定警告、AC 绑定矩阵模板 |
| D-17 | Prompt 更新：phase6-acceptance.md 重构为三层验证流程 | 代码审查 | PASS | `phase6-acceptance.md` L16-57 包含三层验证流程说明、Layer 1/2/3 分工、更新后的输出格式表 |
| D-18 | Agent 更新：acceptance-validator.md 职责更新为仅负责 manual AC + FAIL 分析 | 代码审查 | PASS | `acceptance-validator.md` L8-23 明确只负责 Layer 3(manual) 和 FAIL 分析，不重复验证 Layer 1/2 的 PASS 项 |
| D-19 | Checklist 更新：design-review.md 含结构化 AC 审查板块（schema 合法/layer 标注/manual<=40%） | 代码审查 | PASS | `design-review.md` L57-61 包含 "I. 结构化 AC 审查" 板块含 schema 合法性、layer 标注、manual<=40% 等检查项 |
| D-20 | types.ts re-export AC 相关类型 | 代码审查 | PASS | `types.ts` L13-15 re-export AcceptanceCriteria, AssertionType from ac-schema.js |
| D-21 | phase-enforcer.ts 新增 validateAcJson + validateAcIntegrity 两个函数 | 代码审查 | PASS | `phase-enforcer.ts` L611 validateAcJson / L664 validateAcIntegrity 均已实现 |
| D-22 | 新建文件符合设计：ac-schema.ts / ac-runner.ts / ac-test-binding.ts + 4 个测试文件 | 文件存在检查 | PASS | 全部 7 个文件均存在于 git status（untracked）中 |
| D-23 | 全部 85 个 AC 相关测试通过（638 全局测试零失败） | 测试验证 | PASS | e2e-test-results.md 记录 85 AC 测试全 PASS，638 全局测试全 PASS |
| D-24 | SKILL.md Phase 6 流程描述更新为三层验证 | 代码审查 | FAIL | SKILL.md 中未找到 structural/test-bound/三层 等关键词，Phase 6 描述未更新 |

---

## 通过率统计

- 总计: 24 项
- PASS: 23 项
- FAIL: 1 项 (D-24)
- SKIP: 0 项

## FAIL 分析

### D-24: SKILL.md Phase 6 流程描述未更新

**问题描述**: 设计文档第十节 "分阶段实施计划" 的 Task 12 明确要求 "更新 `skills/auto-dev/SKILL.md` 中 Phase 6 流程描述，反映三层验证机制"。但当前 SKILL.md 中不包含 structural/test-bound/三层验证 等关键词，Phase 6 相关描述未被更新。

**影响评估**: 低影响。SKILL.md 是面向用户的技能描述文件，不影响框架运行逻辑。核心功能代码和 prompt 文件均已正确实现。

**修复建议**: 在 SKILL.md 中找到 Phase 6 相关描述（如有），补充三层验证机制说明（structural 断言 -> test-bound 测试 -> manual 审查）。如 SKILL.md 中没有 Phase 6 细节描述，可在适当位置增加一段简要说明。

---

## 结论

**FAIL** -- 23/24 PASS。1 项 FAIL 为 SKILL.md 文档未同步更新（D-24），不影响核心功能。核心代码模块（ac-schema/ac-runner/ac-test-binding/phase-enforcer/orchestrator/index.ts）、prompt 模板、agent 定义、tribunal checklist 均按设计实现，85 个测试全部通过。

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

