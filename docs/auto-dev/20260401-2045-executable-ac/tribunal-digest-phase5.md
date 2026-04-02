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
 docs/auto-dev/20260401-2045-executable-ac/e2e-test-cases.md (new file)
 docs/auto-dev/20260401-2045-executable-ac/e2e-test-results.md (new file)
 docs/auto-dev/20260401-2045-executable-ac/plan-review.md (new file)
 docs/auto-dev/20260401-2045-executable-ac/plan.md (new file)
 docs/auto-dev/20260401-2045-executable-ac/progress-log.md (new file)
 docs/auto-dev/20260401-2045-executable-ac/state.json (new file)
 docs/auto-dev/20260401-2045-executable-ac/tribunal-digest-phase4.md (new file)
 docs/auto-dev/20260401-2045-executable-ac/tribunal-phase4.md (new file)
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

## E2E 测试结果
```
# E2E Test Results: executable-ac

## 执行环境
- 日期: 2026-04-01
- 命令: npm test
- 框架: vitest v2.1.9
- Node 环境: darwin

## 测试结果汇总
- 全局总测试数: 638 (27 个测试文件)
- 全局通过: 638
- 全局失败: 0
- AC 相关测试数: 85
- AC 相关通过: 85
- AC 相关失败: 0

## AC 相关测试文件明细

| 测试文件 | 用例数 | 结果 |
|----------|--------|------|
| ac-schema.test.ts | 15 | 全部 PASS |
| ac-runner.test.ts | 26 | 全部 PASS |
| ac-test-binding.test.ts | 18 | 全部 PASS |
| ac-integration.test.ts | 26 | 全部 PASS |

## 详细结果 — 已有测试（55 个基线用例）

### ac-schema.test.ts (11 基线)

| 编号 | 测试名称 | 结果 | 备注 |
|------|---------|------|------|
| - | should parse valid AC JSON with all layers | PASS | |
| - | should parse all 7 assertion types | PASS | |
| - | should reject missing required fields | PASS | |
| - | should reject invalid layer value | PASS | |
| - | should reject invalid assertion type | PASS | |
| - | should accept null structuralAssertions | PASS | |
| - | should accept missing structuralAssertions (optional) | PASS | |
| - | should produce a 32-char hex string | PASS | |
| - | should produce stable output for same input | PASS | |
| - | should produce different output for different input | PASS | |
| - | should not include description in hash | PASS | |

### ac-runner.test.ts (22 基线)

| 编号 | 测试名称 | 结果 | 备注 |
|------|---------|------|------|
| - | file_exists: should pass when file exists | PASS | |
| - | file_exists: should fail when file does not exist | PASS | |
| - | file_exists: should support glob patterns | PASS | |
| - | file_not_exists: should pass when file does not exist | PASS | |
| - | file_not_exists: should fail when file exists | PASS | |
| - | file_contains: should pass when file contains pattern | PASS | |
| - | file_contains: should fail when file does not contain pattern | PASS | |
| - | file_contains: should fail when file does not exist | PASS | |
| - | file_not_contains: should pass when file does not contain pattern | PASS | |
| - | file_not_contains: should fail when file contains pattern | PASS | |
| - | file_not_contains: should pass when file does not exist (x2) | PASS | |
| - | config_value: should pass when JSON config value matches | PASS | |
| - | config_value: should fail when JSON config value does not match | PASS | |
| - | config_value: should fail when key path does not exist | PASS | |
| - | build_succeeds: should pass when build command succeeds | PASS | |
| - | build_succeeds: should fail when build command fails | PASS | |
| - | build_succeeds: should fail when no build command configured | PASS | |
| - | test_passes: should pass when test command succeeds | PASS | |
| - | test_passes: should fail when test command fails | PASS | |
| - | multiple assertions per AC: should fail if any assertion fails | PASS | |
| - | non-structural ACs: should skip test-bound and manual ACs | PASS | |

### ac-test-binding.test.ts (13 基线)

| 编号 | 测试名称 | 结果 | 备注 |
|------|---------|------|------|
| - | discoverAcBindings - node: should discover test() with [AC-N] | PASS | |
| - | discoverAcBindings - node: should discover describe() with AC-N: prefix | PASS | |
| - | discoverAcBindings - node: should discover it() with [AC-N] | PASS | |
| - | discoverAcBindings - java: should discover @DisplayName with [AC-N] | PASS | |
| - | discoverAcBindings - java: should discover void ACN_ method pattern | PASS | |
| - | discoverAcBindings - python: should discover def test_acN_ pattern | PASS | |
| - | discoverAcBindings - python: should discover @pytest.mark.ac pattern | PASS | |
... (truncated, 86 lines omitted)
```

## 框架执行的测试日志（可信）
```

> auto-dev-plugin@1.1.0 test
> cd mcp && npm test


> auto-dev-mcp-server@9.1.1 test
> vitest run


 RUN  v2.1.9 /Users/admin/dycui/auto-dev-plugin/mcp

 ✓ src/__tests__/ship-integration-e2e.test.ts (26 tests) 134ms
 ✓ src/__tests__/orchestrator.test.ts (70 tests) 165ms
 ✓ src/__tests__/e2e-integration.test.ts (19 tests) 501ms
 ✓ src/__tests__/lessons-manager.test.ts (58 tests) 851ms
 ✓ src/__tests__/ac-integration.test.ts (26 tests) 122ms
 ✓ src/__tests__/batch1-guard-optimization.test.ts (21 tests) 148ms
 ✓ src/__tests__/orchestrator-prompts.test.ts (44 tests) 39ms
 ✓ src/__tests__/tdd-gate-integration.test.ts (29 tests) 383ms
 ✓ src/__tests__/ac-runner.test.ts (26 tests) 225ms
 ✓ src/__tests__/tdd-gate.test.ts (56 tests) 239ms
 ✓ src/__tests__/ac-test-binding.test.ts (18 tests) 67ms
 ✓ src/__tests__/retrospective-data.test.ts (20 tests) 78ms
 ✓ src/__tests__/self-evolution-e2e.test.ts (5 tests) 102ms
 ✓ src/__tests__/ac-schema.test.ts (15 tests) 15ms
 ✓ src/__tests__/ship-integration.test.ts (15 tests) 14ms
 ✓ src/__tests__/state-manager-checkpoint.test.ts (8 tests) 45ms
 ✓ src/__tests__/improvements.test.ts (11 tests) 11ms
 ✓ src/__tests__/state-rebuild.test.ts (5 tests) 7ms
 ✓ src/__tests__/preflight-context.test.ts (7 tests) 5ms
 ✓ src/__tests__/regress.test.ts (8 tests) 5ms
 ✓ src/__tests__/iteration-limit.test.ts (7 tests) 6ms
 ✓ src/__tests__/prompt-lint.test.ts (2 tests) 28ms
 ✓ src/__tests__/template-renderer.test.ts (2 tests) 7ms
 ✓ src/__tests__/hub-client.test.ts (17 tests) 6033ms
   ✓ HubClient.executePrompt > sends command and polls until completed (AC-2) 2002ms
   ✓ HubClient.executePrompt > returns null on timeout (AC-6) 2001ms
   ✓ HubClient.executePrompt > returns null when command is rejected 2000ms
 ✓ src/__tests__/tribunal.test.ts (93 tests) 9108ms
   ✓ runTribunalWithRetry — Crash Detection and Retry (CLI mode) > TC-11: Crash on first attempt, legitimate FAIL on retry 3003ms
   ✓ runTribunalWithRetry — Crash Detection and Retry (CLI mode) > TC-12: Two consecutive crashes returns exhausted-retry FAIL 3004ms
   ✓ IMP-002: runTribunalWithRetryCli skips non-retryable crashes > retries when crashInfo.isRetryable is true (timeout) 3002ms
 ✓ src/__tests__/agent-spawner.test.ts (16 tests) 9021ms
   ✓ spawnAgentWithRetry — retry on crash > retries on crash, returns on success 3003ms
   ✓ spawnAgentWithRetry — retry on crash > returns crash result after exhausting retries 3001ms
   ✓ spawnAgentWithRetry — retry on crash > uses custom crashDetector when provided 3001ms
 ✓ src/__tests__/hub-client-extended.test.ts (14 tests) 28031ms
   ✓ HubClient.isAvailable — timeout > TC-H07: returns false when fetch exceeds 1s timeout 1008ms
   ✓ HubClient.executePrompt — expired command > TC-H24: returns null when command status is expired 2002ms
   ✓ HubClient.executePrompt — polling intervals > TC-H25: polling intervals follow 2s, 3s, 5s, 5s pattern 20007ms
   ✓ HubClient.executePrompt — resilient polling > TC-H26: continues polling after GET returns non-OK, then completes 5005ms

 Test Files  27 passed (27)
      Tests  638 passed (638)
   Start at  22:04:08
   Duration  31.04s (transform 1.95s, setup 0ms, collect 5.21s, tests 55.39s, environment 8ms, prepare 3.48s)


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

... (truncated, 22 lines omitted)
```

## 框架测试退出码（可信）
```
0
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

