# Phase 7 独立裁决

你是独立裁决者。你的默认立场是 FAIL。
PASS 必须对每条检查项提供证据（文件名:行号），FAIL 只需说明理由。
PASS 的举证成本远大于 FAIL —— 如果你不确定，判 FAIL。

## 框架统计（可信数据）
```
 docs/auto-dev/_global/lessons-global.json | 1063 +++++++++++++++++++++++++++--
 mcp/dist/index.js                         |  118 +++-
 mcp/dist/index.js.map                     |    2 +-
 mcp/dist/tribunal.js                      |  244 +++++--
 mcp/dist/tribunal.js.map                  |    2 +-
 mcp/node_modules/.package-lock.json       |  800 ++++++++++++++++++++++
 mcp/src/__tests__/tribunal.test.ts        |   39 +-
 mcp/src/index.ts                          |  136 +++-
 mcp/src/tribunal-schema.ts                |    8 -
 mcp/src/tribunal.ts                       |  278 ++++++--
 skills/auto-dev/SKILL.md                  |    9 +
 11 files changed, 2513 insertions(+), 186 deletions(-)

```

## 复盘报告
```
# 深度复盘报告 — tribunal-resilience

**日期**：2026-03-26
**耗时**：约 61 分钟（06:17 ~ 07:19）
**模式**：full（skipE2e=true, tdd=false, costMode=beast）
**改动量**：5 文件，+384 / -86 行

---

## 1. 诚实度审计（Integrity）

### 1.1 阶段完整性

| 阶段 | 是否执行 | 是否被拦截 | 备注 |
|------|---------|-----------|------|
| Phase 1 设计 + 审查 | 是 | 审查返回 NEEDS_REVISION，修订后 PASS | 2 个 P1 被修订 |
| Phase 2 计划 + 审查 | 是 | 审查返回 NEEDS_REVISION，修订后 PASS | 2 个 P0 被修订 |
| Phase 3 实现 | 是 | 无 | 11 个 task 全部完成 |
| Phase 4 代码审查 | 是 | Tribunal 崩溃 3 次，走 fallback | 最终 PASS（附条件） |
| Phase 5 E2E 测试 | **跳过** | skipE2e=true | 合理跳过，非外部接口变更 |
| Phase 6 验收 | 是 | Tribunal 1 次通过 | 11/11 AC PASS |
| Phase 7 复盘 | 当前 | — | — |

**结论**：未跳过任何必要阶段。Phase 5 的跳过由 `skipE2e=true` 配置驱动，且理由充分（内部基础设施改造，无新用户 API）。

### 1.2 审查真实性

- **Phase 1 设计审查**：发现 2 个 P1 + 4 个 P2，P1 问题涉及 fallback 防篡改机制缺失和 crashed 标志缺失，均为实质性问题。审查触发了设计修订，增加了 digestHash 校验、crossValidate Phase 4/6/7 增强、AC-9/10/11 三条新验收标准。**真实有效**。
- **Phase 2 计划审查**：发现 2 个 P0 + 4 个 P1 + 3 个 P2。P0 涉及 Task 1 过大需拆分和 digest 路径推算逻辑缺失。审查后 Task 数从 9 增至 11。**真实有效**。
- **Phase 4 代码审查**：发现 2 个 P0（降级为 P1 后）+ 5 个 P1 + 4 个 P2。P0-1（dead import）和 P0-2（startCommit undefined fallback）经分析后降级。Dormant Path Detection 标记了 8 条未验证路径。**真实有效，分析深度足够**。
- **Phase 6 验收**：11 条 AC 逐条验证，每条附带代码行号证据。3 条 AC（AC-5/10/11）诚实地标注了"无直接单元测试覆盖"。**真实有效，未粉饰覆盖缺口**。

### 1.3 TDD 合规性

本任务 `tdd=false`，无 TDD 要求。实际在 Phase 3 实现过程中新增了 1 个测试用例（TC-16a：startCommit undefined 场景），属于主动补充而非 TDD 驱动。合规。

### 1.4 作弊行为检查

- **代码未提交**：git log 显示 startCommit（c8cfb0d）之后没有新 commit，所有变更仍在工作目录中。这本身不是作弊，但意味着本次 session 的代码变更需要后续手动提交。
- **Phase 4 fallback 裁决**：tribunalSubmits 显示 Phase 4 尝试了 3 次，最终走 fallback 路径通过。这恰好是本次实现的 fallback 机制的首次使用——用自己实现的功能来通过自己的代码审查。这是一个有趣的递归场景，但不构成作弊：fallback 路径包含 crossValidate 硬数据校验，且 tribunal log 标记了 `source: "fallback-subagent"`。
- **无伪造测试结果**：213 个测试全部通过，build 退出码 0。

**诚实度评级：PASS**

---

## 2. 踩坑记录（Pitfall）

### 2.1 Phase 4 Tribunal 三连崩溃

Phase 4 代码审查阶段，tribunal（claude -p 独立进程）连续崩溃 3 次，耗时 29 分钟（全流程最长阶段）。讽刺的是，这正是本次任务要解决的问题——tribunal 韧性不足。最终通过本次实现的 fallback 机制（TRIBUNAL_PENDING -> subagent 裁决）成功完成了代码审查。

**教训**：自举（bootstrapping）场景中，被修复的功能本身就是完成修复流程所需的工具。需要在设计中考虑"修复过程中旧版代码仍在运行"的过渡态。

### 2.2 冗余动态 import

`auto_dev_tribunal_verdict` 工具中使用了 `await import("./state-manager.js")` 动态导入，而文件顶部已有相同模块的静态 import。这是 Task 9 实现时的疏忽，可能是从其他代码片段复制时未检查文件顶部的 import 列表。

**教训**：在大文件中新增代码时，先检查文件顶部的 import 列表，避免引入冗余导入。

### 2.3 tribunalTextResult dead import

index.ts 从 tribunal.ts import 了 `textResult as tribunalTextResult`，但全文未使用。这可能是实现过程中预期会在 `auto_dev_tribunal_verdict` 中使用 tribunal 模块的 `textResult`，但最终使用了 index.ts 自己的 `textResult`。

**教训**：实现完成后应执行一次 dead import 检查（IDE lint 或 `tsc --noUnusedLocals`）。

---

## 3. 亮点（Highlight）

### 3.1 设计审查驱动了 3 条新 AC

Phase 1 设计审查的 2 个 P1 直接催生了 AC-9（crossValidate 增强）、AC-10（digestHash 校验）、AC-11（TRIBUNAL_OVERRIDDEN on crossValidate fail）。这 3 条 AC 覆盖了 fallback 路径的防篡改能力，是设计审查的核心价值体现。如果没有审查，fallback 路径在 Phase 4/6/7 上几乎没有防线。

### 3.2 Phase 3 一次通过

11 个 task 全部一次通过，无返工。Phase 3 耗时仅 9 分钟。归因于：
- Phase 1 设计审查修复了架构级问题（crashed 标志、crossValidate 增强）
- Phase 2 计划审查拆分了过大的 Task 1，明确了 digest 路径推算逻辑
- 设计文档提供了充分的伪代码，降低了实现歧义
... (truncated, 100 lines omitted)
```

## 框架自动生成的数据（可信）
```
# Retrospective Auto-Generated Data

> This file is framework-generated and cannot be tampered with by the main agent.

## Summary

- **Total Rejections (REJECTED/BLOCKED)**: 0

## Phase Timings

| Phase | Name | Started At | Completed At | Duration |
|-------|------|------------|--------------|----------|
| 1 | DESIGN | 2026-03-26T06:19:34.296Z | 2026-03-26T06:24:06.971Z | 273s |
| 2 | PLAN | 2026-03-26T06:25:10.807Z | 2026-03-26T06:29:13.255Z | 242s |
| 3 | EXECUTE | 2026-03-26T06:38:54.961Z | 2026-03-26T06:38:54.961Z | 0s |
| 4 | VERIFY | 2026-03-26T06:43:55.752Z | 2026-03-26T07:13:24.619Z | 1769s |
| 6 | ACCEPTANCE | 2026-03-26T07:16:57.748Z | 2026-03-26T07:18:53.620Z | 116s |
| 7 | RETROSPECTIVE | 2026-03-26T07:23:13.953Z | --- | --- |

## Tribunal Results

| Phase | Verdict | Issue Count |
|-------|---------|-------------|
| 4 | PASS | 0 |
| 6 | PASS | 0 |

## Submit Retries (PASS attempts per phase)

| Phase | PASS Count |
|-------|------------|
| 1 | 1 |
| 2 | 1 |
| 3 | 1 |
| 4 | 1 |
| 6 | 1 |

## TDD Gate Stats

| Metric | Value |
|--------|-------|
| Total Tasks | 0 |
| TDD Tasks (RED+GREEN) | 0 |
| Exempt Tasks (TDD: skip) | 0 |
| RED Rejections | 0 |
| GREEN Rejections | 0 |

---
> Generated by auto-dev framework (Phase 7 Part A)

```

## Progress Log
```
# auto-dev progress-log: tribunal-resilience

> Started: 2026-03-26T06:17:38.454Z  
> Mode: full  
> Stack: TypeScript/JavaScript


<!-- INIT buildCmd="npm run build" testCmd="npm test" skipE2e=true mode=full integrity=831e5819a3e18cb3 disabledTests=0 -->

<!-- CHECKPOINT phase=1 status=IN_PROGRESS summary="Design document written based on conversation analysis" timestamp=2026-03-26T06:19:34.296Z -->

<!-- CHECKPOINT phase=1 status=PASS summary="Design: 预消化+权限修复+fallback三层防线。Review P1已修订：补充crashe标志区分崩溃/裁决FAIL、digestHash防篡改、crossValidate增强Phase 4/6/7。11条AC。" timestamp=2026-03-26T06:24:06.971Z -->

<!-- CHECKPOINT phase=2 status=IN_PROGRESS summary="Plan written: 9 tasks" timestamp=2026-03-26T06:25:10.807Z -->

<!-- CHECKPOINT phase=2 status=PASS summary="Plan: 11 tasks. Revised after review: Task 1 拆为 3 个子任务(1/2/3), 补充 digest 路径推算逻辑, 修正依赖关系, 增加 build+test 验证。" timestamp=2026-03-26T06:29:13.255Z -->

<!-- CHECKPOINT phase=3 task=11 status=PASS summary="All 11 tasks implemented. tribunal.ts: pre-digest input, --dangerously-skip-permissions, crashed detection, TRIBUNAL_PENDING, crossValidate Phase 4/6/7. index.ts: auto_dev_tribunal_verdict tool. SKILL.md: fallback branch. Build OK, 212/212 tests pass." timestamp=2026-03-26T06:38:54.961Z -->

<!-- CHECKPOINT phase=4 status=IN_PROGRESS summary="Build OK, 212/212 tests pass. Code review completed." timestamp=2026-03-26T06:43:55.752Z -->

<!-- CHECKPOINT phase=4 status=PASS summary="[TRIBUNAL-FALLBACK] Fallback 裁决通过。3 个建议项。" timestamp=2026-03-26T07:13:24.619Z -->

<!-- CHECKPOINT phase=6 status=IN_PROGRESS summary="Phase 6 验收开始。验收报告已完成：11/11 AC 全部 PASS。" timestamp=2026-03-26T07:16:57.748Z -->

<!-- CHECKPOINT phase=6 status=PASS summary="[TRIBUNAL] 独立裁决通过。0 个建议项。" timestamp=2026-03-26T07:18:53.620Z -->

<!-- CHECKPOINT phase=7 status=IN_PROGRESS summary="Phase 7 复盘报告已完成，retrospective.md 已写入。5 条经验已保存，10 条注入经验已反馈。" timestamp=2026-03-26T07:23:13.953Z -->

```

## 关键代码变更
```diff
diff --git a/docs/auto-dev/_global/lessons-global.json b/docs/auto-dev/_global/lessons-global.json
index a76a2d8..58b35e6 100644
--- a/docs/auto-dev/_global/lessons-global.json
+++ b/docs/auto-dev/_global/lessons-global.json
@@ -7,8 +7,103 @@
     "lesson": "Phase 1 required revision",
     "topic": "lessons-evolution",
     "reusable": true,
-    "appliedCount": 0,
-    "timestamp": "2026-03-25T09:48:52.283Z"
+    "appliedCount": 20,
+    "timestamp": "2026-03-25T09:48:52.283Z",
+    "lastAppliedAt": "2026-03-26T07:19:01.900Z",
+    "score": 35,
+    "feedbackHistory": [
+      {
+        "verdict": "helpful",
+        "phase": 1,
+        "topic": "tribunal",
+        "timestamp": "2026-03-26T01:44:15.528Z"
+      },
+      {
+        "verdict": "helpful",
+        "phase": 2,
+        "topic": "tribunal",
+        "timestamp": "2026-03-26T01:50:55.591Z"
+      },
+      {
+        "verdict": "helpful",
+        "phase": 3,
+        "topic": "tribunal",
+        "timestamp": "2026-03-26T02:09:39.569Z"
+      },
+      {
+        "verdict": "helpful",
+        "phase": 4,
+        "topic": "tribunal",
+        "timestamp": "2026-03-26T02:28:18.745Z"
+      },
+      {
+        "verdict": "not_applicable",
+        "phase": 5,
+        "topic": "tribunal",
+        "timestamp": "2026-03-26T02:35:10.224Z"
+      },
+      {
+        "verdict": "not_applicable",
+        "phase": 6,
+        "topic": "tribunal",
+        "timestamp": "2026-03-26T02:39:12.344Z"
+      },
+      {
+        "verdict": "helpful",
+        "phase": 6,
+        "topic": "tribunal",
+        "timestamp": "2026-03-26T02:43:09.229Z"
+      },
+      {
+        "verdict": "helpful",
+        "phase": 1,
... (truncated, 1140 lines omitted)
diff --git a/mcp/src/index.ts b/mcp/src/index.ts
index 8a5c2a1..c6091de 100644
--- a/mcp/src/index.ts
+++ b/mcp/src/index.ts
@@ -16,12 +16,13 @@ import { TemplateRenderer } from "./template-renderer.js";
 import { GitManager } from "./git-manager.js";
 import type { StateJson } from "./types.js";
 import { LessonsManager } from "./lessons-manager.js";
-import { validateCompletion, validatePhase5Artifacts, validatePhase6Artifacts, validatePhase7Artifacts, countTestFiles, checkIterationLimit, validatePredecessor, parseInitMarker, validatePhase1ReviewArtifact, validatePhase2ReviewArtifact, isTddExemptTask } from "./phase-enforcer.js";
+import { validateCompletion, validatePhase5Artifacts, validatePhase6Artifacts, validatePhase7Artifacts, countTestFiles, checkIterationLimit, validatePredecessor, parseInitMarker, validatePhase1ReviewArtifact, validatePhase2ReviewArtifact, isTddExemptTask, computeNextDirective } from "./phase-enforcer.js";
 import { validateRedPhase, buildTestCommand, TDD_TIMEOUTS } from "./tdd-gate.js";
 import { extractDocSummary, extractTaskList } from "./state-manager.js";
 import { runRetrospective } from "./retrospective.js";
 import { TRIBUNAL_PHASES } from "./tribunal-schema.js";
-import { executeTribunal } from "./tribunal.js";
+import { executeTribunal, crossValidate, buildTribunalLog } from "./tribunal.js";
+import type { ToolResult } from "./tribunal.js";
 import { getClaudePath } from "./tribunal.js";
 
 // ---------------------------------------------------------------------------
@@ -1444,6 +1445,137 @@ server.tool(
   },
 );
 
+// ===========================================================================
+// 15. auto_dev_tribunal_verdict (Fallback Tribunal Verdict)
+// ===========================================================================
+
+server.tool(
+  "auto_dev_tribunal_verdict",
+  "Submit tribunal verdict from fallback subagent review. Only valid after TRIBUNAL_PENDING.",
+  {
+    projectRoot: z.string(),
+    topic: z.string(),
+    phase: z.number(),
+    verdict: z.enum(["PASS", "FAIL"]),
+    issues: z.array(z.object({
+      severity: z.enum(["P0", "P1", "P2"]),
+      description: z.string(),
+      file: z.string().optional(),
+    })),
+    passEvidence: z.array(z.string()).optional(),
+    summary: z.string().optional(),
+    digestHash: z.string(),
+  },
+  async ({ projectRoot, topic, phase, verdict, issues, passEvidence, summary, digestHash }) => {
+    // 1. Validate phase is a tribunal phase
+    if (!(TRIBUNAL_PHASES as readonly number[]).includes(phase)) {
+      return textResult({
+        error: "INVALID_PHASE",
+        message: `Phase ${phase} 不是裁决 Phase。只有 Phase ${TRIBUNAL_PHASES.join("/")} 需要裁决。`,
+      });
+    }
+
+    // 2. Verify digestHash matches digest file
+    const sm = new StateManager(projectRoot, topic);
+    const outputDir = sm.outputDir;
+    const digestPath = join(outputDir, `tribunal-digest-phase${phase}.md`);
+    let digestContent: string;
+    try {
... (truncated, 99 lines omitted)
diff --git a/mcp/src/tribunal-schema.ts b/mcp/src/tribunal-schema.ts
index a6adf42..1f68c6a 100644
--- a/mcp/src/tribunal-schema.ts
+++ b/mcp/src/tribunal-schema.ts
@@ -43,13 +43,5 @@ export const TRIBUNAL_SCHEMA = {
   required: ["verdict", "issues"]
 };
 
-/** Per-phase max turns for tribunal agent */
-export const TRIBUNAL_MAX_TURNS: Record<number, number> = {
-  4: 10,
-  5: 8,
-  6: 6,
-  7: 6,
-};
-
 /** Phases that require tribunal judgment */
 export const TRIBUNAL_PHASES = [4, 5, 6, 7] as const;

diff --git a/mcp/src/tribunal.ts b/mcp/src/tribunal.ts
index 37dd224..0c461df 100644
--- a/mcp/src/tribunal.ts
+++ b/mcp/src/tribunal.ts
@@ -11,10 +11,11 @@
  */
 
 import { execFile, exec } from "node:child_process";
+import { createHash } from "node:crypto";
 import { readFile, writeFile, stat } from "node:fs/promises";
 import { join } from "node:path";
 import type { TribunalVerdict, StateJson } from "./types.js";
-import { TRIBUNAL_SCHEMA, TRIBUNAL_MAX_TURNS } from "./tribunal-schema.js";
+import { TRIBUNAL_SCHEMA } from "./tribunal-schema.js";
 import { getTribunalChecklist } from "./tribunal-checklists.js";
 import { generateRetrospectiveData } from "./retrospective-data.js";
 import { internalCheckpoint, StateManager } from "./state-manager.js";
@@ -86,63 +87,122 @@ export async function getClaudePath(): Promise<string> {
 }
 
 // ---------------------------------------------------------------------------
-// Tribunal Input Preparation
+// Digest Helpers (Task 1 + Task 2)
 // ---------------------------------------------------------------------------
 
 /**
- * Write tribunal-input-phase{N}.md and tribunal-diff-phase{N}.patch.
- * For Phase 5, also execute testCmd and write framework-test-log.txt / framework-test-exitcode.txt.
- * Returns the path to the input file.
+ * Read a file and truncate to maxLines. Returns null if file does not exist.
  */
-export async function prepareTribunalInput(
+export async function safeRead(path: string, maxLines: number): Promise<string | null> {
+  try {
+    const content = await readFile(path, "utf-8");
+    const lines = content.split("\n");
+    if (lines.length <= maxLines) return content;
+    return lines.slice(0, maxLines).join("\n") + `\n... (truncated, ${lines.length - maxLines} lines omitted)`;
+  } catch {
+    return null;
+  }
+}
+
+/**
+ * Return the list of files to inline for each tribunal phase.
+ */
+export function getPhaseFiles(
   phase: number,
   outputDir: string,
-  projectRoot: string,
-  startCommit?: string,
-): Promise<string> {
-  const inputFile = join(outputDir, `tribunal-input-phase${phase}.md`);
-
-  let content = `# Phase ${phase} 独立裁决\n\n`;
-  content += `你是独立裁决者。你的默认立场是 FAIL。\n`;
-  content += `PASS 必须对每条检查项提供证据（文件名:行号），FAIL 只需说明理由。\n`;
-  content += `PASS 的举证成本远大于 FAIL —— 如果你不确定，判 FAIL。\n\n`;
-
-  // File references — tribunal agent reads them via Read tool
... (truncated, 371 lines omitted)
diff --git a/skills/auto-dev/SKILL.md b/skills/auto-dev/SKILL.md
index a35c885..b4eeb17 100644
--- a/skills/auto-dev/SKILL.md
+++ b/skills/auto-dev/SKILL.md
@@ -44,7 +44,16 @@ while phase <= maxPhase:
         # submit 内部触发独立裁决 → 自动写 checkpoint
         # TRIBUNAL_PASS → 进入下一 Phase
         # TRIBUNAL_FAIL → 修复问题后重新 submit
+        # TRIBUNAL_PENDING → claude -p 崩溃，需 fallback subagent 裁决（见下方）
         # TRIBUNAL_ESCALATE → 3次失败，需人工介入
+        if submit_result.status == "TRIBUNAL_PENDING":
+            # Fallback: claude -p 崩溃，用 subagent 执行裁决
+            digest = submit_result.digest
+            digestHash = submit_result.digestHash
+            agent_result = Agent(subagent_type="auto-dev:auto-dev-reviewer",
+                                prompt=f"作为独立裁决者审查以下材料，按检查清单逐条判定:\n{digest}")
+            # 从 agent 输出中提取 verdict JSON（verdict, issues, passEvidence）
+            auto_dev_tribunal_verdict(projectRoot, topic, phase, verdict, issues, passEvidence, summary, digestHash)
     phase = submit_result.nextPhase or checkpoint_result.nextPhase
 auto_dev_complete()                       # 唯一的完成入口 → 验证所有 phase → build → test → COMPLETED
 # ⚠️ 任何其他方式宣称完成都是违规。checkpoint(status=COMPLETED) 会被框架硬拒绝。

```

## 检查清单

## 裁决检查清单（Phase 7: 复盘裁决）

> 默认立场是 FAIL。PASS 必须逐条举证。

### 1. 数据一致性
- [ ] 主 Agent 报告中的数字（拦截次数、测试通过率等）是否与框架数据一致？
- [ ] 如果不一致 → FAIL（数据造假）

### 2. 问题是否被遗漏
- [ ] 裁决记录中发现的 ISSUE，是否在复盘报告的"踩坑清单"中体现？
- [ ] 被框架拦截的次数，是否在"诚实度审计"中如实报告？
- [ ] 如果有裁决 FAIL 记录但复盘中未提及 → FAIL（选择性遗忘）

### 3. 根因分析深度
- [ ] 每个踩坑是否有根因分析（不只是"做错了"，而是"为什么做错"）？
- [ ] 是否有可复用的改进措施（不只是"下次注意"）？
- [ ] 如果只有表面描述没有根因 → FAIL（敷衍）

### 4. 教训可操作性
- [ ] 教训是否具体到可以指导下一次开发？
- [ ] "以后会注意" 不是有效教训
- [ ] 有效教训示例："跨端开发时，先用 curl 确认后端实际接口签名，再写前端调用代码"

