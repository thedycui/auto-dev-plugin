# Phase 6 独立裁决

你是独立裁决者。你的默认立场是 FAIL。
PASS 必须对每条检查项提供证据（文件名:行号），FAIL 只需说明理由。
PASS 的举证成本远大于 FAIL —— 如果你不确定，判 FAIL。

## 框架统计（可信数据）
```
 docs/auto-dev/_global/lessons-global.json | 1003 +++++++++++++++++++++++++++--
 mcp/dist/index.js                         |  118 +++-
 mcp/dist/index.js.map                     |    2 +-
 mcp/dist/tribunal.js                      |  244 +++++--
 mcp/dist/tribunal.js.map                  |    2 +-
 mcp/node_modules/.package-lock.json       |  800 +++++++++++++++++++++++
 mcp/src/__tests__/tribunal.test.ts        |   39 +-
 mcp/src/index.ts                          |  136 +++-
 mcp/src/tribunal-schema.ts                |    8 -
 mcp/src/tribunal.ts                       |  278 ++++++--
 skills/auto-dev/SKILL.md                  |    9 +
 11 files changed, 2453 insertions(+), 186 deletions(-)

```

## 验收报告
```
# 验收报告 — tribunal-resilience

**验收日期**：2026-03-26
**AC 来源**：design.md 验收标准章节（AC-1 至 AC-11）
**代码版本**：当前工作目录（未提交变更）

---

| AC | 描述 | 验证方式 | 结果 | 证据 |
|----|------|---------|------|------|
| AC-1 | prepareTribunalInput 产出单个 digest 文件，digest < 50KB | 代码审查 | PASS | tribunal.ts:197-277 — `prepareTribunalInput` 生成 `tribunal-digest-phase${phase}.md` 单文件，内联所有审查材料 + 截断后的 diff（totalBudget=300 行）。所有材料通过 `safeRead` 截断到 maxLines（80-100 行），不再要求 tribunal 自己读多个文件 |
| AC-2 | runTribunal 使用 `--dangerously-skip-permissions` 且不包含 `--max-turns` | 代码审查 | PASS | tribunal.ts:305-312 — args 数组包含 `"--dangerously-skip-permissions"`；全文 grep `max-turns` 和 `allowedTools` 均无匹配；`TRIBUNAL_MAX_TURNS` 常量已从 tribunal-schema.ts 中移除（grep 确认无匹配） |
| AC-3 | tribunal 崩溃时返回 TRIBUNAL_PENDING 包含 digest 内容 | 代码审查 + 单元测试 | PASS | tribunal.ts:393-427 — `runTribunalWithRetry` 返回 `{verdict, crashed}` 结构体，连续崩溃时 `crashed=true`。tribunal.ts:594-604 — `executeTribunal` 在 `crashed=true` 时返回 `TRIBUNAL_PENDING` + digest + digestHash。TC-12 验证两次连续崩溃返回 `crashed: true` |
| AC-4 | 新增 auto_dev_tribunal_verdict 工具，接受 verdict 并执行 crossValidate | 代码审查 | PASS | index.ts:1452-1577 — `auto_dev_tribunal_verdict` 工具已注册，接受 projectRoot/topic/phase/verdict/issues/passEvidence/summary/digestHash 参数，第 1514-1515 行对 PASS verdict 调用 `crossValidate` |
| AC-5 | auto_dev_tribunal_verdict 对 PASS 要求 passEvidence 非空 | 代码审查 | PASS | index.ts:1502-1507 — `if (verdict === "PASS" && (!passEvidence \|\| passEvidence.length === 0))` 返回 `PASS_EVIDENCE_REQUIRED` 错误。注意：无直接单元测试覆盖此路径（code-review P2-1 已记录），但代码逻辑明确 |
| AC-6 | SKILL.md 包含 TRIBUNAL_PENDING fallback 分支说明 | 代码审查 | PASS | skills/auto-dev/SKILL.md:47-56 — 包含 `TRIBUNAL_PENDING` 注释说明和 `if submit_result.status == "TRIBUNAL_PENDING"` 分支，描述了 fallback subagent 裁决流程 |
| AC-7 | 预消化 diff 排除 dist/、*.map、*.lock、node_modules/、__tests__/ | 代码审查 | PASS | tribunal.ts:154-157 — `getKeyDiff` 的 git diff 参数包含 `:!*/dist/*`, `:!*.map`, `:!*.lock`, `:!*/node_modules/*`, `:!*/__tests__/*`，完全匹配设计要求 |
| AC-8 | timeout 从 120s 增加到 180s | 代码审查 | PASS | tribunal.ts:315 — `timeout: 180_000`（180 秒） |
| AC-9 | crossValidate 为 Phase 4/6/7 增加硬数据校验 | 代码审查 + 单元测试（部分） | PASS | Phase 4: tribunal.ts:452-465 — 检查 git diff 非空 + startCommit 未定义时返回错误。TC-16 + TC-16a 覆盖。Phase 6: tribunal.ts:505-513 — 检查 acceptance-report.md 存在且含 PASS/FAIL。TC-16b 覆盖。Phase 7: tribunal.ts:517-527 — 检查 retrospective.md 存在且 >= 50 行。注意：Phase 7 crossValidate 无直接单元测试，但代码逻辑清晰 |
| AC-10 | auto_dev_tribunal_verdict 校验 digestHash 一致性 | 代码审查 | PASS | index.ts:1492-1499 — 重新读取 digest 文件计算 sha256 并截取前 16 位，与传入的 digestHash 比对，不一致返回 `DIGEST_HASH_MISMATCH`。注意：无直接单元测试覆盖此路径（code-review P2-1 已记录） |
| AC-11 | fallback PASS + crossValidate 不通过时返回 TRIBUNAL_OVERRIDDEN | 代码审查 | PASS | index.ts:1514-1533 — `auto_dev_tribunal_verdict` 中 verdict=PASS 时调用 crossValidate，若返回非 null，写 tribunal log（source: "fallback-subagent"）并返回 `TRIBUNAL_OVERRIDDEN`。注意：无直接单元测试覆盖此路径 |

---

## 测试执行结果

```
Test Files  10 passed (10)
     Tests  213 passed (213)
  Duration  7.75s
```

所有 213 个测试用例全部通过。

---

## 备注

1. **AC-5、AC-10、AC-11** 虽然代码逻辑已实现，但 `auto_dev_tribunal_verdict` 工具的完整路径缺少直接单元测试（code-review P2-1 已记录此缺口）。代码审查确认逻辑正确，不影响验收结论。
2. **AC-9 Phase 7** crossValidate 逻辑（retrospective.md >= 50 行）无直接单元测试，但代码结构与 Phase 6 对称，且 Phase 6 已有 TC-16b 覆盖。
3. **AC-1 的 50KB 大小限制** 为目标值而非硬约束，代码通过 `safeRead` 截断（maxLines 80-100）+ diff 总预算 300 行实现。实际大小取决于输入内容，但在正常场景下远低于 50KB。

---

通过率：11/11 PASS, 0 FAIL, 0 SKIP
结论：**PASS**

```

## 关键代码变更
```diff
diff --git a/docs/auto-dev/_global/lessons-global.json b/docs/auto-dev/_global/lessons-global.json
index a76a2d8..5e84916 100644
--- a/docs/auto-dev/_global/lessons-global.json
+++ b/docs/auto-dev/_global/lessons-global.json
@@ -7,8 +7,97 @@
     "lesson": "Phase 1 required revision",
     "topic": "lessons-evolution",
     "reusable": true,
-    "appliedCount": 0,
-    "timestamp": "2026-03-25T09:48:52.283Z"
+    "appliedCount": 19,
+    "timestamp": "2026-03-25T09:48:52.283Z",
+    "lastAppliedAt": "2026-03-26T07:13:55.895Z",
+    "score": 32,
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
... (truncated, 1080 lines omitted)
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

## 裁决检查清单（Phase 6: 验收裁决）

> 默认立场是 FAIL。PASS 必须逐条举证。

### 验收标准逐条验证
- [ ] 从 design.md 中提取每条验收标准（AC）
- [ ] 对每条标准，在 diff 中找到对应实现
- [ ] 找不到实现的标准 → FAIL
- [ ] SKIP 必须有合理理由（真的做不到，不是偷懒）

### 输出要求
- AC 验证表：AC: {描述} → PASS/FAIL/SKIP → {证据或原因}

