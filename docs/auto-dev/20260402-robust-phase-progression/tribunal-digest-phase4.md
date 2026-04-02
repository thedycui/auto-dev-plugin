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
 .claude-plugin/plugin.json                     |   2 +-
 mcp/dist/index.js                              | 148 +++++++-
 mcp/dist/index.js.map                          |   2 +-
 mcp/dist/orchestrator-prompts.js               |  33 +-
 mcp/dist/orchestrator-prompts.js.map           |   2 +-
 mcp/dist/orchestrator.js                       | 322 ++++++++++++++--
 mcp/dist/orchestrator.js.map                   |   2 +-
 mcp/dist/state-manager.d.ts                    |  11 +
 mcp/dist/state-manager.js                      |  29 ++
 mcp/dist/state-manager.js.map                  |   2 +-
 mcp/dist/types.d.ts                            |  23 ++
 mcp/dist/types.js                              |  28 ++
 mcp/dist/types.js.map                          |   2 +-
 mcp/src/__tests__/orchestrator-prompts.test.ts |  49 ++-
 mcp/src/__tests__/orchestrator.test.ts         | 486 ++++++++++++++++++++++++-
 mcp/src/__tests__/worktree-integration.test.ts | 463 +++++++++++++++++++++++
 mcp/src/index.ts                               | 143 +++++++-
 mcp/src/orchestrator-prompts.ts                |  38 +-
 mcp/src/orchestrator.ts                        | 345 ++++++++++++++++--
 mcp/src/state-manager.ts                       |  34 +-
 mcp/src/types.ts                               |  37 ++
 skills/auto-dev/SKILL.md                       |   2 +
 22 files changed, 2087 insertions(+), 116 deletions(-)

Untracked new files:
 .auto-dev-tmp-gaOK5iFSSLmf/design.md (new file)
 docs/auto-dev/20260331-0029-refactor-orchestrator-god-function/approach-plan.md (new file)
 docs/auto-dev/20260331-0029-refactor-orchestrator-god-function/design-review.md (new file)
 docs/auto-dev/20260331-0029-refactor-orchestrator-god-function/design.md (new file)
 docs/auto-dev/20260331-0029-refactor-orchestrator-god-function/plan-review.md (new file)
 docs/auto-dev/20260331-0029-refactor-orchestrator-god-function/plan.md (new file)
 docs/auto-dev/20260331-0029-refactor-orchestrator-god-function/progress-log.md (new file)
 docs/auto-dev/20260331-0029-refactor-orchestrator-god-function/state.json (new file)
 docs/auto-dev/20260402-0902-orchestrator-ux-improvements/acceptance-criteria.json (new file)
 docs/auto-dev/20260402-0902-orchestrator-ux-improvements/acceptance-report.md (new file)
 docs/auto-dev/20260402-0902-orchestrator-ux-improvements/approach-plan.md (new file)
 docs/auto-dev/20260402-0902-orchestrator-ux-improvements/design-review.md (new file)
 docs/auto-dev/20260402-0902-orchestrator-ux-improvements/design.md (new file)
 docs/auto-dev/20260402-0902-orchestrator-ux-improvements/e2e-test-cases.md (new file)
 docs/auto-dev/20260402-0902-orchestrator-ux-improvements/framework-ac-results.json (new file)
 docs/auto-dev/20260402-0902-orchestrator-ux-improvements/lessons-learned.json (new file)
 docs/auto-dev/20260402-0902-orchestrator-ux-improvements/plan-review.md (new file)
 docs/auto-dev/20260402-0902-orchestrator-ux-improvements/plan.md (new file)
 docs/auto-dev/20260402-0902-orchestrator-ux-improvements/progress-log.md (new file)
 docs/auto-dev/20260402-0902-orchestrator-ux-improvements/retrospective.md (new file)
 docs/auto-dev/20260402-0902-orchestrator-ux-improvements/state.json (new file)
 docs/auto-dev/20260402-0902-orchestrator-ux-improvements/summary.md (new file)
 docs/auto-dev/20260402-0902-orchestrator-ux-improvements/tribunal-digest-phase4.md (new file)
 docs/auto-dev/20260402-0902-orchestrator-ux-improvements/tribunal-digest-phase5.md (new file)
 docs/auto-dev/20260402-0902-orchestrator-ux-improvements/tribunal-digest-phase6.md (new file)
 docs/auto-dev/20260402-0902-orchestrator-ux-improvements/tribunal-phase4.md (new file)
 docs/auto-dev/20260402-0902-orchestrator-ux-improvements/tribunal-phase5.md (new file)
 docs/auto-dev/20260402-0902-orchestrator-ux-improvements/tribunal-phase6.md (new file)
 docs/auto-dev/20260402-robust-phase-progression/acceptance-criteria.json (new file)
 docs/auto-dev/20260402-robust-phase-progression/approach-plan.md (new file)
 docs/auto-dev/20260402-robust-phase-progression/design-review.md (new file)
 docs/auto-dev/20260402-robust-phase-progression/design.md (new file)
 docs/auto-dev/20260402-robust-phase-progression/plan-review.md (new file)
 docs/auto-dev/20260402-robust-phase-progression/plan.md (new file)
 docs/auto-dev/20260402-robust-phase-progression/progress-log.md (new file)
 docs/auto-dev/20260402-robust-phase-progression/state.json (new file)
 docs/auto-dev/tribunal-crash-observability (new file)
 docs/design-review-enhancement.md (new file)
 docs/docs/auto-dev/_global/lessons-global.json (new file)
 mcp/npm (new file)

```

## 变更规模

- 规模等级：**LOW**（+0 -0，共 0 行）
- 审查指令：变更规模较小，快速审查即可。

## Phase 1 设计评审
```
# Design Review

> 审查日期：2026-04-02
> 审查人：架构评审专家（Phase 1，第 2 次审查）

---

## P0 (阻塞性问题)

无

---

## P1 (重要问题)

无（已在修订版中全部解决）

### 已解决的问题

- **P1-A**（已解决）：4.1.4a 节明确了 `effectiveRoot` 与 `effectiveCodeRoot` 的组合规则。在 worktree 模式下，`effectiveCodeRoot` 通过 `path.join(worktreeRoot, path.relative(projectRoot, codeRoot))` 计算，保留了技能类项目的子目录映射。同时明确了 `validateStep` 接收 `effectiveCodeRoot`（build/test 相关），`tribunal.ts` 接收 `effectiveRoot`（git diff 相关）。

- **P1-B**（已解决）：5.3 节明确了 Phase 8 必须在 `auto_dev_complete` 之后执行。Phase 8 的 `validateStep` 加入 guard 检查：若 `state.worktreeRoot` 仍非空（worktree 未合并），返回 `passed=false` 并提示"请先调用 auto_dev_complete"。AC-16 覆盖此场景的单元测试。

- **P1-C**（已解决）：`case "5c"` 改为 hash delta 检查，不再使用 `git diff startCommit`。基准 hash 在 5b 失败进入 5c 时记录（通过 `atomicUpdate(step="5c")` 同时写入 `lastArtifactHashes["test-files"]`），与 1c/2c 的逻辑保持一致。AC-17 覆盖未修改测试文件时验证失败的场景。

- **P1-D**（已解决）：4.7.2 节明确标注"这是一次格式重写，不仅仅是增加一个字段"，列出了影响范围（4 处 `buildRevisionPrompt` 调用、`orchestrator-prompts.test.ts` 中所有旧格式断言需同步更新），并给出了分两步实施的策略（先更新格式+快照，再填充 `previousAttemptSummary`）。AC-14 要求同步更新旧断言。

---

## P2 (优化建议)

以下问题来自上轮审查，评估为优化建议，不阻塞实现：

- **P1-E（上调为 P2）**：`checkBuildWithBaseline` 中 `installDepsIfNeeded` 的依赖安装成本无上界。设计 6.3 节已将其列为已知限制，建议实现时在 AC 注释中明确标注，待后续 PR 补充 lockfile hash 缓存方案。

- **P2-1**：`getWorktreeDir` 路径碰撞风险，建议在路径中加入 topic 的短 hash（6 位）以保证唯一性。

- **P2-2**：`stepIteration` 与 `stepEffort` 双轨并存增加维护成本，建议在同一 PR 中加注释标明 deprecation 路径。

- **P2-3**：hash 记录时机应明确为 `atomicUpdate` 的一部分（设计 4.3 节已补充说明，已达标）。

---

## 跨组件影响分析

### 变更清单

（已在原始审查中完成，修订版未引入新的接口变更）

| 序号 | 变更项 | 类型 |
|---|---|---|
| 1 | `StateJsonSchema` 新增 `worktreeRoot`、`worktreeBranch`、`sourceBranch`、`stepEffort`、`lastArtifactHashes` 字段 | 数据结构 |
| 2 | `InitInputSchema` 新增 `useWorktree` 参数 | MCP tool 参数 |
| 3 | `validateStep` 新增 `case "1c"/"2c"/"5c"/"8a"（worktree guard）` | 函数内部 |
| 4 | `advanceToNextStep` 修改 revision→parent 逻辑（effort 计数） | 函数内部 |
| 5 | `handleValidationFailure` 新增 effort budget 检查 | 函数内部 |
| 6 | `checkBuildWithBaseline` 重写（worktree 模式替代 stash） | 函数内部 |
| 7 | `buildRevisionPrompt` 格式重写（markdown 标题结构）并填充 `previousAttemptSummary` | 函数接口+实现 |
| 8 | `buildTaskForStep("3")` 嵌入 plan.md 上下文 | 函数内部 |
| 9 | `buildTaskForStep("4a")` 新增 null 返回值 | 返回类型扩展 |
| 10 | `auto_dev_init` 新增 worktree 创建逻辑 | MCP tool |
| 11 | `auto_dev_complete` 新增 merge + worktree 清理逻辑 | MCP tool |
| 12 | `EFFORT_LIMITS` 新常量 | 配置 |
| 13 | `STEP_PREREQUISITES` 新常量 | 配置 |

### 调用方影响

| 调用方 | 所在位置 | 影响类型 | 设计已覆盖 |
|---|---|---|---|
| `buildRevisionPrompt` 的 4 处调用 | `orchestrator.ts:1081, 1089, 1097, 1161` | 格式重写（breaking change） | 是（4.7.2 节明确标注，AC-14 要求同步更新测试） |
| `validateStep` 的测试 | `orchestrator.test.ts` | 新增 case 需要新测试 | 是（AC-5/6/7/16/17） |
| `computeNextTask` 接收 `buildTaskForStep` 返回 null | `orchestrator.ts` | 新增 null 返回值路径 | 是（4.7.1 节） |
| `tribunal.ts` 接收 `projectRoot` | `tribunal.ts:179, 699, 827` | 需改为 `effectiveRoot` | 是（设计提到 effectiveRoot 透传） |
| `auto_dev_complete` 调用时机 | SKILL.md | Phase 7 后、Phase 8 前的合并时机 | 是（5.3 节明确，AC-16） |

---

## 结论

PASS

```

## Phase 2 计划评审
```
# Plan Review

## 已解决问题

- P1-1（已解决）：Task 8 依赖字段已更正为 Task 1、Task 6，与关键路径图对齐
- P1-2（已解决）：Task 12 的完成标准中已补充 SKILL.md 更新要求——在 Phase 7 完成节点后添加"必须先调用 `auto_dev_complete` 再推进 Phase 8"的说明
- P1-3（已解决）：Task 12 的完成标准中已补充 baseline worktree 依赖安装验证——要求 `checkBuildWithBaseline` 调用 `installDepsIfNeeded(baselineDir)` 并在 finally 块中执行 `git worktree remove --force`

## P2 (优化建议，不阻塞实施)

### P2-1：Task 7 同步更新测试的风险提示

Task 7 要求"在同一 task 中完成"对 `orchestrator-prompts.test.ts` 的格式断言更新，设计文档 4.7.2 也明确强调了这一实施策略。计划在这里是正确的，但可以补充一句完成标准："`npm test -- orchestrator-prompts` 通过，且不存在跳过（skip）的测试"，以防实现者删掉测试而不是更新断言。

### P2-2：Task 13 测试文件路径歧义

Task 13 描述中写"新增 `worktree-integration.test.ts`（或在 `orchestrator.test.ts` 中新增 worktree describe block）"。"或"会让实现者面临选择，可能导致测试分散在两个文件中。建议明确指定一个位置，消除歧义。

### P2-3：EFFORT_LIMITS 常量的 `maxTribunalAttempts` 与现有逻辑的双写问题

设计文档 4.2 节指出 `tribunalSubmits` 的现有 "3次→escalate" 逻辑保留不变，`stepEffort.tribunalAttempts` 只是同步更新。Task 3 的完成标准没有验证两者是否一致（同步更新是否真的发生）。建议在 Task 9 的 AC-8 测试里补充一个验证：当 `tribunalAttempts` 递增时，对应的 `tribunalSubmits` 也同步更新。

---

## Coverage Matrix

| 设计章节/功能点 | 对应任务 | 覆盖状态 |
|----------------|---------|---------|
| 4.1.1 目标架构（worktree 目录结构） | Task 10 | OK |
| 4.1.2 Worktree 生命周期 — init 创建 worktree | Task 10 | OK |
| 4.1.2 Worktree 生命周期 — complete 合并与清理 | Task 11 | OK |
| 4.1.3 Worktree 路径规则（getWorktreeDir / getWorktreeBranch） | Task 10 | OK |
| 4.1.4 effectiveRoot 计算（computeNextTask 顶部） | Task 12 | OK |
| 4.1.4a effectiveCodeRoot 组合规则 | Task 12 | OK |
| 4.1.5 消除 stash hack（checkBuildWithBaseline 重构） | Task 12 | OK |
| 4.1.6 --no-worktree 兼容模式 | Task 10 | OK |
| 4.1.7 Resume 时 worktree 恢复 | Task 10 | OK |
| 4.2 StepEffort 数据结构（types.ts） | Task 1 | OK |
| 4.2 EFFORT_LIMITS / REVISION_TO_REVIEW 常量 | Task 1 | OK |
| 4.2 StepEffort 深度合并（state-manager.ts） | Task 2 | OK |
| 4.2 effortKeyForStep / hashContent 工具函数 | Task 2 | OK |
| 4.2 预算检查（handleValidationFailure 开头） | Task 3 | OK |
| 4.2 预算更新时机（totalAttempts++/tribunalAttempts++） | Task 3 | OK |
| 4.2 与现有计数器的关系（stepIteration 降级 fallback） | Task 3 | OK（隐含）|
| 4.3 validateStep "1c"/"2c"/"5c" 新增 case | Task 5 | OK |
| 4.3 Artifact Hash 追踪（lastArtifactHashes 记录时机） | Task 5 | OK |
| 4.4 修复 advanceToNextStep revision→parent 逻辑（P0-1） | Task 4 | OK |
| 4.5 Phase 3 空转检测（git diff 为空时返回 failed） | Task 6 | OK |
| 4.6 STEP_PREREQUISITES 常量 + checkPrerequisites 函数 | Task 6 | OK |
| 4.7.1 Phase 4a 空 dispatch（buildTaskForStep 返回 null） | Task 8 | OK |
| 4.7.2 buildRevisionPrompt 格式重写为 markdown 标题 | Task 7 | OK |
| 4.7.2 previousAttemptSummary 填充 + buildPreviousAttemptSummary | Task 7 | OK |
| 4.7.3 Phase 3 嵌入 plan.md 全文 + design 目标摘要 | Task 8 | OK |
| 5.1 向后兼容（旧 state.json 不 crash） | Task 13 AC-11 | OK |
| 5.3 Phase 8 守卫（validateStep("8a") 检查 worktreeRoot） | Task 12 | OK |
| 5.3 SKILL.md 流程文档更新（Phase 7 → complete → Phase 8） | Task 12 | OK |
| 6 风险缓解 — baseline worktree 依赖安装 | Task 12 | OK |
| AC-1 worktree 隔离验证 | Task 13 | OK |
| AC-2 complete 合并验证 | Task 13 | OK |
| AC-3 tribunal diff 隔离验证 | Task 13 | OK |
| AC-4 无 stash 调用验证 | Task 13 | OK |
| AC-5 revision 循环上限 | Task 9 | OK |
| AC-6 validateStep("1c") delta check | Task 9 | OK |
| AC-7 Phase 3 空 diff 阻止 | Task 9 | OK |
| AC-8 effort_exhausted escalation | Task 9 | OK |
| AC-9 prerequisite_missing escalation | Task 9 | OK |
| AC-10 --no-worktree 全流程兼容 | Task 13 | OK |
| AC-11 旧 state.json 不 crash | Task 13 | OK |
| AC-12 resume worktree 重建 | Task 13 | OK |
| AC-13 Phase 4a agent=null | Task 9 | OK |
| AC-14 revision prompt 格式 + previousAttemptSummary | Task 9 | OK |
| AC-15 Phase 3 prompt 含 plan 上下文 | Task 9 | OK |
| AC-16 Phase 8 守卫 | Task 9 + Task 12 | OK |
| AC-17 validateStep("5c") delta check | Task 9 | OK |

---

## 结论

PASS

```

## 关键代码变更
```diff
diff --git a/.claude-plugin/plugin.json b/.claude-plugin/plugin.json
index 18d2628..2824ece 100644
--- a/.claude-plugin/plugin.json
+++ b/.claude-plugin/plugin.json
@@ -1,6 +1,6 @@
 {
   "name": "auto-dev",
-  "version": "9.4.4",
+  "version": "9.5.1",
   "description": "Intelligent development automation plugin that provides guided workflows, context-aware code generation, and best-practice enforcement for full-stack projects",
   "author": {
     "name": "Auto Dev Team"

diff --git a/mcp/src/index.ts b/mcp/src/index.ts
index aa9bae0..9387cfd 100644
--- a/mcp/src/index.ts
+++ b/mcp/src/index.ts
@@ -159,6 +159,26 @@ function inferChangeTypeFromContent(content: string): ChangeType | undefined {
   return bestScore >= 3 ? best : undefined;
 }
 
+// ---------------------------------------------------------------------------
+// Worktree helpers
+// ---------------------------------------------------------------------------
+
+function getWorktreeDir(projectRoot: string, topic: string): string {
+  const sanitized = topic
+    .replace(/[^a-zA-Z0-9\u4e00-\u9fff-]/g, "-")
+    .replace(/-+/g, "-")
+    .slice(0, 50);
+  return join(resolve(projectRoot, ".."), `.auto-dev-wt-${sanitized}`);
+}
+
+function getWorktreeBranch(topic: string): string {
+  const sanitized = topic
+    .replace(/[^a-zA-Z0-9\u4e00-\u9fff-]/g, "-")
+    .replace(/-+/g, "-")
+    .slice(0, 50);
+  return `auto-dev/${sanitized}`;
+}
+
 // ---------------------------------------------------------------------------
 // Server
 // ---------------------------------------------------------------------------
@@ -205,8 +225,9 @@ server.tool(
     }).optional(),
     shipMaxRounds: z.number().int().optional(),
     codeRoot: z.string().optional(),
+    useWorktree: z.boolean().optional().default(true),
   },
-  async ({ projectRoot, topic, mode: explicitMode, estimatedLines, estimatedFiles, changeType, startPhase, interactive, dryRun, skipE2e, tdd, brainstorm, costMode, onConflict, designDoc, ship, deployTarget, deployBranch, deployEnv, verifyMethod, verifyConfig, shipMaxRounds, codeRoot }) => {
+  async ({ projectRoot, topic, mode: explicitMode, estimatedLines, estimatedFiles, changeType, startPhase, interactive, dryRun, skipE2e, tdd, brainstorm, costMode, onConflict, designDoc, ship, deployTarget, deployBranch, deployEnv, verifyMethod, verifyConfig, shipMaxRounds, codeRoot, useWorktree }) => {
     const sm = await StateManager.create(projectRoot, topic);
 
     // Handle existing directory
... (truncated, 156 lines omitted)
diff --git a/mcp/src/orchestrator-prompts.ts b/mcp/src/orchestrator-prompts.ts
index 9dc816c..7a5508f 100644
--- a/mcp/src/orchestrator-prompts.ts
+++ b/mcp/src/orchestrator-prompts.ts
@@ -44,20 +44,44 @@ export interface RevisionInput {
 /** Builds a revision prompt from structured input. */
 export function buildRevisionPrompt(input: RevisionInput): string {
   const lines: string[] = [];
-  lines.push("你之前的工作有以下需要修订的地方：");
+  lines.push("## 修订任务");
+  lines.push("");
+  lines.push(input.originalTask);
+  lines.push("");
+  if (input.previousAttemptSummary) {
+    lines.push("## 历史尝试");
+    lines.push("");
+    lines.push(input.previousAttemptSummary);
+    lines.push("");
+  }
+  lines.push("## 审查反馈（必须逐条回应）");
+  lines.push("");
   lines.push(input.feedback);
+  lines.push("");
   if (input.artifacts.length > 0) {
-    lines.push("请修订以下文件：");
+    lines.push("## 待修改文件");
+    lines.push("");
     for (const a of input.artifacts) {
       lines.push(`- ${a}`);
     }
+    lines.push("");
   }
-  if (input.previousAttemptSummary) {
-    lines.push("上次尝试摘要：");
-    lines.push(input.previousAttemptSummary);
+  return lines.join("\n");
+}
+
+/** Builds a previous attempt summary from step effort and current feedback. */
+export function buildPreviousAttemptSummary(
+  stepId: string,
+  effort: { totalAttempts: number; revisionCycles: number; tribunalAttempts: number },
... (truncated, 15 lines omitted)
diff --git a/mcp/src/orchestrator.ts b/mcp/src/orchestrator.ts
index df2dee7..53ad1c7 100644
--- a/mcp/src/orchestrator.ts
+++ b/mcp/src/orchestrator.ts
@@ -10,11 +10,12 @@
 
 import { execFile } from "node:child_process";
 import { readFile, stat, writeFile } from "node:fs/promises";
-import { join, resolve, dirname } from "node:path";
+import { join, resolve, dirname, relative } from "node:path";
 import { fileURLToPath } from "node:url";
 
 import {
   buildRevisionPrompt,
+  buildPreviousAttemptSummary,
   translateFailureToFeedback,
   containsFrameworkTerms,
   parseApproachPlan,
@@ -22,7 +23,7 @@ import {
   buildCircuitBreakPrompt,
 } from "./orchestrator-prompts.js";
 import type { ApproachEntry, FailedApproach } from "./orchestrator-prompts.js";
-import { StateManager, extractTaskList } from "./state-manager.js";
+import { StateManager, extractTaskList, effortKeyForStep, hashContent } from "./state-manager.js";
 import {
   validatePhase1ReviewArtifact,
   validatePhase2ReviewArtifact,
@@ -36,6 +37,7 @@ import { evaluateTribunal } from "./tribunal.js";
 import type { EvalTribunalResult } from "./tribunal.js";
 import { TemplateRenderer } from "./template-renderer.js";
 import type { StateJson } from "./types.js";
+import { EFFORT_LIMITS, StepEffortSchema } from "./types.js";
 
 // ---------------------------------------------------------------------------
 // Design Doc Compliance Check
@@ -157,6 +159,41 @@ const SKILLS_DIR = resolve(
   "..", "..", "skills", "auto-dev",
 );
 
+// ---------------------------------------------------------------------------
+// Step Prerequisites (P1-3)
+// ---------------------------------------------------------------------------
... (truncated, 567 lines omitted)
diff --git a/mcp/src/state-manager.ts b/mcp/src/state-manager.ts
index 0a520db..58b18dc 100644
--- a/mcp/src/state-manager.ts
+++ b/mcp/src/state-manager.ts
@@ -13,7 +13,9 @@ import { join, dirname, resolve } from "node:path";
 import { lstatSync } from "node:fs";
 import { fileURLToPath } from "node:url";
 import { homedir } from "node:os";
+import { createHash } from "node:crypto";
 import { StateJsonSchema } from "./types.js";
+import { REVISION_TO_REVIEW } from "./types.js";
 import type { StateJson, StackInfo } from "./types.js";
 import { computeNextDirective } from "./phase-enforcer.js";
 import type { NextDirective } from "./phase-enforcer.js";
@@ -120,6 +122,28 @@ function parseStackVariables(content: string): Record<string, string> {
   return vars;
 }
 
+// ---------------------------------------------------------------------------
+// Effort tracking utilities
+// ---------------------------------------------------------------------------
+
+/**
+ * Returns the effort key for a given step.
+ * Revision steps (1c, 2c, 5c) map to their parent review step.
+ * All other steps map to themselves.
+ */
+export function effortKeyForStep(step: string): string {
+  return REVISION_TO_REVIEW[step] ?? step;
+}
+
+/**
+ * Returns a 16-character hex SHA-256 hash of the given content.
+ * Returns "" for null input.
+ */
+export function hashContent(content: string | null): string {
+  if (content === null) return "";
+  return createHash("sha256").update(content).digest("hex").slice(0, 16);
+}
+
 // ---------------------------------------------------------------------------
 // StateManager
... (truncated, 19 lines omitted)
diff --git a/mcp/src/types.ts b/mcp/src/types.ts
index 6cba3b7..73e8391 100644
--- a/mcp/src/types.ts
+++ b/mcp/src/types.ts
@@ -95,6 +95,32 @@ export const LessonEntrySchema = z.object({
 
 export type LessonEntry = z.infer<typeof LessonEntrySchema>;
 
+// ---------------------------------------------------------------------------
+// StepEffort — per-step effort tracking
+// ---------------------------------------------------------------------------
+
+export const StepEffortSchema = z.object({
+  totalAttempts: z.number().int().default(0),
+  revisionCycles: z.number().int().default(0),
+  tribunalAttempts: z.number().int().default(0),
+});
+
+export type StepEffort = z.infer<typeof StepEffortSchema>;
+
+/** Maximum attempt budgets per step */
+export const EFFORT_LIMITS = {
+  maxTotalAttempts: 6,
+  maxRevisionCycles: 2,
+  maxTribunalAttempts: 3,
+} as const;
+
+/** Maps revision steps to their parent review step */
+export const REVISION_TO_REVIEW: Record<string, string> = {
+  "1c": "1b",
+  "2c": "2b",
+  "5c": "5b",
+};
+
 // ---------------------------------------------------------------------------
 // ApproachState — circuit breaker approach tracking
 // ---------------------------------------------------------------------------
@@ -223,6 +249,17 @@ export const StateJsonSchema = z.object({
   shipRound: z.number().int().optional(),
   shipMaxRounds: z.number().int().optional(),
 
+  // Per-step effort tracking
... (truncated, 14 lines omitted)
diff --git a/skills/auto-dev/SKILL.md b/skills/auto-dev/SKILL.md
index 2bb85f6..27cfc18 100644
--- a/skills/auto-dev/SKILL.md
+++ b/skills/auto-dev/SKILL.md
@@ -130,6 +130,8 @@ auto_dev_init(
 
 未传 `ship=true` 时 Phase 8 不激活，不影响 Phase 1-7 的行为。
 
+> **注意（Worktree 模式）**：当 `useWorktree=true`（默认）时，**必须先调用 `auto_dev_complete` 完成 worktree 合并，再推进 Phase 8**。在 worktree 合并之前调用 Phase 8 会被阻止（`validateStep("8a")` 返回失败）。
+
 ### 5. 设计文档模板（推荐）
 
 使用以下模板编写设计文档，可让 auto-dev **跳过 Phase 1a（设计重写）**，直接进入 Phase 1b（审查），节省约 10-15 分钟。

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

