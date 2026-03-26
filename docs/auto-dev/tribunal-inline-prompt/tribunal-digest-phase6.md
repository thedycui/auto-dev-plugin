# Phase 6 独立裁决

你是独立裁决者。你的默认立场是 FAIL。
PASS 必须对每条检查项提供证据（文件名:行号），FAIL 只需说明理由。
PASS 的举证成本远大于 FAIL —— 如果你不确定，判 FAIL。

## 框架统计（可信数据）
```
 docs/auto-dev/_global/lessons-global.json | 1063 +++++++++++++++++++++++++++--
 mcp/dist/index.js                         |  118 +++-
 mcp/dist/index.js.map                     |    2 +-
 mcp/dist/tribunal.js                      |  251 +++++--
 mcp/dist/tribunal.js.map                  |    2 +-
 mcp/node_modules/.package-lock.json       |  800 ++++++++++++++++++++++
 mcp/src/__tests__/tribunal.test.ts        |   69 +-
 mcp/src/index.ts                          |  136 +++-
 mcp/src/tribunal-schema.ts                |    8 -
 mcp/src/tribunal.ts                       |  285 ++++++--
 skills/auto-dev/SKILL.md                  |    9 +
 11 files changed, 2534 insertions(+), 209 deletions(-)

```

## 验收报告
```
# 验收报告: tribunal-inline-prompt

| AC | 描述 | 验证方式 | 结果 | 证据 |
|----|------|---------|------|------|
| AC-1 | runTribunal 的 prompt 中直接包含 digest 内容 | 代码审查 | PASS | tribunal.ts:302 — prompt 使用模板字符串内联 digestContent |
| AC-2 | prepareTribunalInput 返回 { digestPath, digestContent } | 代码审查 | PASS | tribunal.ts:202 返回类型声明, tribunal.ts:276 返回对象 |
| AC-3 | Build 通过，所有现有测试通过 | 运行验证 | PASS | npm run build 退出码 0, npm test 213/213 pass |

通过率：3/3 PASS, 0 FAIL, 0 SKIP
结论：PASS

## 额外验证

Phase 4 tribunal 一次通过（之前 tribunal-resilience 任务中 Phase 4 连续崩溃 3 次），证明内联 prompt 方案有效消除了 error_max_turns 问题。

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
index 37dd224..3dfc422 100644
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
... (truncated, 385 lines omitted)
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

## 裁决检查清单（Phase 6: 验收裁决）

> 默认立场是 FAIL。PASS 必须逐条举证。

### 验收标准逐条验证
- [ ] 从 design.md 中提取每条验收标准（AC）
- [ ] 对每条标准，在 diff 中找到对应实现
- [ ] 找不到实现的标准 → FAIL
- [ ] SKIP 必须有合理理由（真的做不到，不是偷懒）

### 输出要求
- AC 验证表：AC: {描述} → PASS/FAIL/SKIP → {证据或原因}

