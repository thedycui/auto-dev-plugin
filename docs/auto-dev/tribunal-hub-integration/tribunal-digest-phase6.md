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
 mcp/dist/git-manager.js                            |     13 +-
 mcp/dist/git-manager.js.map                        |      2 +-
 mcp/dist/orchestrator.js                           |     21 +
 mcp/dist/orchestrator.js.map                       |      2 +-
 mcp/dist/tribunal.js                               |    105 +-
 mcp/dist/tribunal.js.map                           |      2 +-
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
 mcp/src/__tests__/orchestrator.test.ts             |    236 +
 mcp/src/__tests__/tribunal.test.ts                 |    323 +-
 mcp/src/git-manager.ts                             |     24 +-
 mcp/src/orchestrator.ts                            |     23 +
 mcp/src/tribunal.ts                                |    123 +-
 skills/auto-dev/SKILL.md                           |     20 +-
 46 files changed, 1659 insertions(+), 395326 deletions(-)

Untracked new files:
 .agent-hub/resume-sessions.json (new file)
 .claude/settings.local.json (new file)
 .playwright-mcp/console-2026-03-28T08-12-26-685Z.log (new file)
 .playwright-mcp/console-2026-03-28T09-16-22-188Z.log (new file)
 .playwright-mcp/console-2026-03-28T10-45-12-559Z.log (new file)
 .playwright-mcp/console-2026-03-28T11-05-15-452Z.log (new file)
 .playwright-mcp/element-2026-03-28T09-45-52-387Z.png (new file)
 .playwright-mcp/element-2026-03-28T09-46-22-462Z.png (new file)
 .playwright-mcp/element-2026-03-28T09-47-25-721Z.png (new file)
 .playwright-mcp/element-2026-03-28T09-48-06-350Z.png (new file)
 .playwright-mcp/element-2026-03-28T09-49-45-637Z.png (new file)
 .playwright-mcp/element-2026-03-28T09-50-51-341Z.png (new file)
 .playwright-mcp/element-2026-03-28T09-52-37-610Z.png (new file)
 .playwright-mcp/element-2026-03-28T09-54-10-068Z.png (new file)
 .playwright-mcp/element-2026-03-28T09-56-35-016Z.png (new file)
 .playwright-mcp/element-2026-03-28T09-59-23-385Z.png (new file)
 .playwright-mcp/element-2026-03-28T10-01-06-163Z.png (new file)
 .playwright-mcp/element-2026-03-28T10-03-02-731Z.png (new file)
 .playwright-mcp/element-2026-03-28T10-08-31-582Z.png (new file)
 .playwright-mcp/element-2026-03-28T10-11-10-018Z.png (new file)
 .playwright-mcp/page-2026-03-28T08-13-33-665Z.png (new file)
 .playwright-mcp/page-2026-03-28T09-20-22-547Z.png (new file)
 .playwright-mcp/page-2026-03-28T09-26-07-713Z.png (new file)
 .playwright-mcp/page-2026-03-28T09-29-15-513Z.png (new file)
 .playwright-mcp/page-2026-03-28T09-32-14-578Z.png (new file)
 .playwright-mcp/page-2026-03-28T09-36-25-177Z.png (new file)
 .playwright-mcp/page-2026-03-28T09-43-25-972Z.png (new file)
 .playwright-mcp/page-2026-03-28T09-44-40-301Z.png (new file)
 .playwright-mcp/page-2026-03-28T10-46-53-684Z.png (new file)
 .playwright-mcp/page-2026-03-28T10-47-07-617Z.png (new file)
 .playwright-mcp/page-2026-03-28T11-07-34-955Z.png (new file)
 .playwright-mcp/page-2026-03-28T11-08-55-303Z.png (new file)
 .playwright-mcp/page-2026-03-28T11-09-54-589Z.png (new file)
 .playwright-mcp/page-2026-03-28T11-12-16-853Z.png (new file)
 .playwright-mcp/page-2026-03-28T11-14-04-146Z.png (new file)
 .playwright-mcp/page-2026-03-28T11-18-23-124Z.png (new file)
 .playwright-mcp/page-2026-03-28T11-19-31-801Z.png (new file)
 .playwright-mcp/page-2026-03-28T11-34-23-442Z.png (new file)
 .playwright-mcp/page-2026-03-28T11-53-23-998Z.png (new file)
 .playwright-mcp/page-2026-03-28T11-54-41-393Z.png (new file)
 .playwright-mcp/page-2026-03-28T11-55-53-079Z.png (new file)
 .playwright-mcp/page-2026-03-28T11-58-01-801Z.png (new file)
 .playwright-mcp/page-2026-03-28T12-05-10-038Z.png (new file)
 docs/auto-dev/batch1-guard-optimization/approach-plan.md (new file)
 docs/auto-dev/batch1-guard-optimization/design-review.md (new file)
 docs/auto-dev/batch1-guard-optimization/design.md (new file)
 docs/auto-dev/batch1-guard-optimization/e2e-test-cases.md (new file)
 docs/auto-dev/batch1-guard-optimization/e2e-test-results.md (new file)
 docs/auto-dev/batch1-guard-optimization/plan-review.md (new file)
 docs/auto-dev/batch1-guard-optimization/plan.md (new file)
 docs/auto-dev/batch1-guard-optimization/progress-log.md (new file)
... (131 more files omitted)
```

## 验收报告
```
# 验收报告：裁决官三级执行策略（Hub 集成）

**验收时间**: 2026-03-28
**验收人**: Claude Opus 4.6 (自动验收)
**设计文档**: `docs/auto-dev/tribunal-hub-integration/design.md`
**测试结果**: 465 passed / 0 failed (vitest, 19 test files)

## 验收标准逐条验证

| AC | 描述 | 验证方式 | 结果 | 证据 |
|----|------|---------|------|------|
| AC-1 | 不设任何环境变量时，`runTribunal()` 返回带 `_subagentMode: true` 标记的结果，`runTribunalWithRetry()` 返回 `subagentRequested: true`，不调用 `execFile` | 代码审查 + 单元测试 | PASS | **代码**: `tribunal.ts:414-434` — `TRIBUNAL_MODE` 非 `cli` 且无 Hub 时，直接返回 `{ subagentRequested: true }`，不调用 `runTribunal()`/`execFile`。**测试**: `tribunal.test.ts` "AC-1: Default mode (no env vars) returns subagentRequested=true without calling execFile" — 验证 `subagentRequested=true`、`crashed=false`、`mockExecFile.not.toHaveBeenCalled()` |
| AC-2 | 设置 `TRIBUNAL_HUB_URL` 且 Hub 可达、worker 在线时，裁决通过 Hub 执行并返回正确的 `TribunalVerdict` | 代码审查 + 单元测试 | PASS | **代码**: `tribunal.ts:419-427` — Hub 路径：`getHubClient()` -> `tryRunViaHub()` -> 返回 verdict。`hub-client.ts:124-178` — `executePrompt()` 发送命令并轮询。**测试**: `tribunal.test.ts` "AC-2: Hub mode -- successful execution returns verdict" — mock Hub 端点验证 `verdict.verdict === "PASS"`、`subagentRequested` 未定义、`executePrompt` 被调用。`hub-client.test.ts` "returns result on successful completion (AC-2)" |
| AC-3 | Hub 不可用（连接超时/拒绝）时，自动降级到 Subagent 模式，不抛出异常 | 代码审查 + 单元测试 | PASS | **代码**: `hub-client.ts:50-67` — `isAvailable()` 1s 超时，catch 返回 false；`tribunal.ts:448-449` — available 为 false 时返回 null，降级到 Level 2。**测试**: `tribunal.test.ts` "AC-3: Hub unavailable -- degrades to subagent" — mock `isAvailable()` 返回 false，验证 `subagentRequested=true`。`hub-client.test.ts` "returns false when Hub is unreachable (AC-3)"。`hub-client-extended.test.ts` "TC-H07: returns false when fetch exceeds 1s timeout" |
| AC-4 | Hub 可达但 worker 离线时，自动降级到 Subagent 模式 | 代码审查 + 单元测试 | PASS | **代码**: `tribunal.ts:456-457` — worker 为 null 时返回 null，降级到 Level 2。`hub-client.ts:101-115` — `findTribunalWorker()` 在无在线 agent 时返回 null。**测试**: `tribunal.test.ts` "AC-4: Hub available but worker offline -- degrades to subagent" — mock `findTribunalWorker()` 返回 null，验证 `subagentRequested=true`。`hub-client.test.ts` "returns null when no worker is online (AC-4)" |
| AC-5 | 设置 `TRIBUNAL_MODE=cli` 时，走 CLI spawn 路径，与改动前行为一致 | 代码审查 + 单元测试 | PASS | **代码**: `tribunal.ts:415-417` — `TRIBUNAL_MODE === "cli"` 时调用 `runTribunalWithRetryCli()`，该函数保留原始 CLI spawn + retry 逻辑（`tribunal.ts:495-542`）。**测试**: `tribunal.test.ts` "AC-5: TRIBUNAL_MODE=cli uses CLI spawn path (calls execFile)" — 设置 env，验证 `mockExecFile.toHaveBeenCalled()`、`subagentRequested` 未定义 |
| AC-6 | Hub 模式下 Worker 执行超时时，降级到 Subagent 模式 | 代码审查 + 单元测试 | PASS | **代码**: `hub-client.ts:150-174` — 轮询超过 `timeoutMs` 后返回 null；`tribunal.ts:422-427` — Hub 返回 null 后 fall through 到 Level 2。**测试**: `tribunal.test.ts` "AC-6: Hub worker timeout -- degrades to subagent" — mock `executePrompt` 返回 null，验证 `subagentRequested=true`。`hub-client.test.ts` "returns null on timeout (AC-6)" — 使用短超时验证轮询超时返回 null |
| AC-7 | `HubClient.ensureConnected()` 幂等——连续调用 2 次，只发送 1 次 `POST /agents/register` | 代码审查 + 单元测试 | PASS | **代码**: `hub-client.ts:73-94` — `_registered` 标志位，首次成功后短路返回 true。**测试**: `hub-client.test.ts` "is idempotent -- second call does not send another request (AC-7)" — 连续调用两次，验证 `mockFetch.toHaveBeenCalledTimes(1)` |
| AC-8 | orchestrator 中 `runStepValidation()` 收到 `subagentRequested: true` 时，返回 escalation（reason: `tribunal_subagent`），不增加 crash 计数 | 代码审查 + 单元测试 | PASS | **代码**: `orchestrator.ts:914-929` — `subagentRequested` 分支返回 `escalation.reason = "tribunal_subagent"`，更新 `tribunalSubmits`（计数器非 crash 计数）。**测试**: `orchestrator.test.ts` "returns tribunal_subagent escalation when evaluateTribunal returns subagentRequested=true" — 验证 `escalation.reason === "tribunal_subagent"`。"tribunal_subagent does NOT count as crash" — 验证 submits 递增而非 crash。"TC-O04: subagentRequested in Phase 5/6" — 多 phase 验证。"TC-O05: subagentRequested after 2 prior submits still returns tribunal_subagent" — 不触发 max_escalations |
| AC-9 | `evaluateTribunal()` 的对外接口签名不变，新增字段均为 optional | 代码审查 + 单元测试 | PASS | **代码**: `tribunal.ts:680-704` — `EvalTribunalResult` 接口，`subagentRequested?: boolean` 和 `digestPath?: string` 均为可选字段（`?` 标记）。`evaluateTribunal()` 签名（`tribunal.ts:712-718`）参数列表与改动前一致：`(projectRoot, outputDir, phase, topic, summary, startCommit?)`。**测试**: `tribunal.test.ts` "TC-I01: EvalTribunalResult can be constructed without subagentRequested/digestPath" — 编译时 + 运行时验证可选性。"TC-I02: evaluateTribunal function signature accepts 5-6 parameters" — 验证函数存在且参数数量正确 |

## 总结

通过率：**9/9 PASS, 0 FAIL, 0 SKIP**

结论：**PASS**

所有 9 条验收标准均通过代码审查和单元测试验证。运行验证确认全部 465 个测试用例通过（含 30 个新增用例），无回归。

```

## 关键代码变更
```diff
diff --git a/mcp/src/git-manager.ts b/mcp/src/git-manager.ts
index f6ffe4b..28038bb 100644
--- a/mcp/src/git-manager.ts
+++ b/mcp/src/git-manager.ts
@@ -63,16 +63,32 @@ export class GitManager {
   ): Promise<DiffCheckOutput> {
     this.validateRef(baseCommit);
 
+    // Committed changes
     const nameOnlyOutput = await this.execGit(
       "diff",
       "--name-only",
       `${baseCommit}..HEAD`,
       "--",
     );
-    const actualFiles = nameOnlyOutput
-      .trim()
-      .split("\n")
-      .filter((f) => f.length > 0);
+    // Staged but not yet committed
+    const stagedOutput = await this.execGit(
+      "diff",
+      "--cached",
+      "--name-only",
+    );
+    // Untracked new files (invisible to git diff)
+    const untrackedOutput = await this.execGit(
+      "ls-files",
+      "--others",
+      "--exclude-standard",
+    );
+
+    const actualFiles = [...new Set(
+      (nameOnlyOutput + "\n" + stagedOutput + "\n" + untrackedOutput)
+        .trim()
+        .split("\n")
+        .filter((f) => f.length > 0),
+    )];
 
     const actualSet = new Set(actualFiles);
     const expectedSet = new Set(expectedFiles);

diff --git a/mcp/src/orchestrator.ts b/mcp/src/orchestrator.ts
index aa06450..e97570c 100644
--- a/mcp/src/orchestrator.ts
+++ b/mcp/src/orchestrator.ts
@@ -80,6 +80,7 @@ export interface NextTaskResult {
     lastFeedback: string;
     digest?: string;
     digestHash?: string;
+    digestPath?: string;
   };
   /** When true, the prompt should be executed in a fresh subagent context (clean slate, no prior failure context) */
   freshContext?: boolean;
@@ -908,6 +909,28 @@ export async function computeNextTask(
       const submits = state.tribunalSubmits ?? {};
       const count = (submits[phaseKey] ?? 0) + 1;
 
+      // Subagent requested: Hub unavailable or default mode — delegate to subagent.
+      // Does NOT count as crash — intentional delegation. Still increment tribunalSubmits.
+      if (validation.tribunalResult.subagentRequested) {
+        await sm.atomicUpdate({
+          tribunalSubmits: { ...submits, [phaseKey]: count },
+        });
+        return {
+          done: false,
+          step: currentStep,
+          agent: null,
+          prompt: null,
+          escalation: {
+            reason: "tribunal_subagent",
+            lastFeedback: "裁决已委托给 subagent，请读取 digestPath 文件执行裁决后调用 auto_dev_tribunal_verdict 提交。",
+            digest: validation.tribunalResult.digest,
+            digestHash: validation.tribunalResult.digestHash,
+            digestPath: validation.tribunalResult.digestPath,
+          },
+          message: `Step ${currentStep} tribunal 委托给 subagent 执行。`,
+        };
+      }
+
       // Parse failure: LLM responded but JSON was malformed.
       // Return raw output for the main agent to extract the verdict itself.
       if (validation.tribunalResult.rawParseFailure && validation.tribunalResult.rawOutput) {

diff --git a/mcp/src/tribunal.ts b/mcp/src/tribunal.ts
index 3936904..c31bfc8 100644
--- a/mcp/src/tribunal.ts
+++ b/mcp/src/tribunal.ts
@@ -31,6 +31,7 @@ import { LessonsManager } from "./lessons-manager.js";
 import { isTestFile, isImplFile } from "./tdd-gate.js";
 import type { NextDirective } from "./phase-enforcer.js";
 import { getClaudePath } from "./agent-spawner.js";
+import { getHubClient } from "./hub-client.js";
 
 // Re-export for backward compatibility
 export { getClaudePath, resolveClaudePath } from "./agent-spawner.js";
@@ -398,17 +399,103 @@ export async function runTribunal(
 // ---------------------------------------------------------------------------
 
 /**
- * Run tribunal with 1 retry for crash (not legitimate FAIL).
- * Uses crash detection via known error strings.
- * 3s backoff between attempts.
- * Returns { verdict, crashed, rawParseFailure } —
- *   crashed=true means process-level crash (needs full fallback),
- *   rawParseFailure=true means LLM responded but JSON was malformed (agent can parse raw).
+ * Run tribunal with three-tier strategy:
+ *   Level 1: Hub mode (TRIBUNAL_HUB_URL set) — execute via Agent Hub
+ *   Level 2: Subagent mode (default) — return subagentRequested=true for orchestrator
+ *   Level 3: CLI mode (TRIBUNAL_MODE=cli) — spawn claude CLI process with retry
+ *
+ * Returns { verdict, crashed, rawParseFailure, subagentRequested }.
  */
 export async function runTribunalWithRetry(
   digestContent: string,
   phase: number,
   digestPath?: string,
+): Promise<{ verdict: TribunalVerdict; crashed: boolean; rawParseFailure?: boolean; subagentRequested?: boolean }> {
+  // --- Level 3: CLI mode (explicit opt-in via TRIBUNAL_MODE=cli) ---
+  if (process.env.TRIBUNAL_MODE === "cli") {
+    return runTribunalWithRetryCli(digestContent, phase, digestPath);
+  }
+
+  // --- Level 1: Hub mode (TRIBUNAL_HUB_URL set) ---
+  const hubClient = getHubClient();
+  if (hubClient) {
+    const hubResult = await tryRunViaHub(hubClient, digestContent, phase, digestPath);
+    if (hubResult) {
+      return { verdict: hubResult, crashed: false };
+    }
+    // Hub failed — fall through to Level 2 (Subagent)
+  }
+
+  // --- Level 2: Subagent mode (default — no CLI spawn, no Hub) ---
+  return {
+    verdict: { verdict: "FAIL", issues: [], raw: "" },
+    crashed: false,
+    subagentRequested: true,
+  };
+}
+
+/**
+ * Try to run tribunal via Agent Hub. Returns TribunalVerdict on success, null on failure.
+ */
+async function tryRunViaHub(
+  hubClient: ReturnType<typeof getHubClient> & {},
+  digestContent: string,
+  phase: number,
+  digestPath?: string,
+): Promise<TribunalVerdict | null> {
+  try {
+    // 1. Check availability
+    const available = await hubClient.isAvailable();
+    if (!available) return null;
+
+    // 2. Register (idempotent)
+    const connected = await hubClient.ensureConnected();
+    if (!connected) return null;
+
... (truncated, 100 lines omitted)
diff --git a/skills/auto-dev/SKILL.md b/skills/auto-dev/SKILL.md
index b81f982..52faff5 100644
--- a/skills/auto-dev/SKILL.md
+++ b/skills/auto-dev/SKILL.md
@@ -34,9 +34,23 @@ while !result.done:
   if result.task:
     Agent(subagent_type=result.agentType, prompt=result.task, model=result.model)
   elif result.escalation:
-    告知用户: result.escalation.reason + result.escalation.feedback
-    等待用户决定后继续或终止
-    break
+    if result.escalation.reason == "tribunal_subagent":
+      // 自动启动 subagent 执行裁决（不中断流程）
+      digestPath = result.escalation.digestPath
+      Agent(subagent_type="auto-dev-reviewer", prompt="""
+        你是独立裁决者。请先用 Read 工具读取文件 "{digestPath}"，
+        然后按照其中的检查清单逐条裁决。
+        裁决完成后调用 auto_dev_tribunal_verdict 提交结果。
+        PASS 必须对每条检查项提供 passEvidence（文件名:行号）。
+        如果不确定，判 FAIL。
+      """)
+      result = auto_dev_next(projectRoot, topic)
+      continue
+    else:
+      // 其他 escalation（tribunal_crashed, tribunal_parse_failure, iteration_limit 等）
+      告知用户: result.escalation.reason + result.escalation.feedback
+      等待用户决定后继续或终止
+      break
   result = auto_dev_next(projectRoot, topic)
 ```
 

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

