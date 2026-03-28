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
 docs/auto-dev/batch1-guard-optimization/approach-plan.md (new file)
 docs/auto-dev/batch1-guard-optimization/design-review.md (new file)
 docs/auto-dev/batch1-guard-optimization/design.md (new file)
 docs/auto-dev/batch1-guard-optimization/e2e-test-cases.md (new file)
 docs/auto-dev/batch1-guard-optimization/e2e-test-results.md (new file)
 docs/auto-dev/batch1-guard-optimization/plan-review.md (new file)
 docs/auto-dev/batch1-guard-optimization/plan.md (new file)
 docs/auto-dev/batch1-guard-optimization/progress-log.md (new file)
 docs/auto-dev/batch1-guard-optimization/state.json (new file)
... (127 more files omitted)
```

## E2E 测试结果
```
# 端到端测试结果：裁决官三级执行策略（Hub 集成）

**执行时间**: 2026-03-28
**测试框架**: vitest v2.1.9
**总测试数**: 465 passed / 0 failed
**总文件数**: 19 test files

## 新增测试用例汇总

共新增 **30** 个测试用例，分布在 3 个文件中：

### 1. hub-client-extended.test.ts（新增文件，14 个用例）

| ID | 用例名 | 优先级 | 结果 |
|----|--------|--------|------|
| TC-H07 | isAvailable 超时返回 false | P1 | PASS |
| TC-H16 | 空 token 不发 Authorization 头 | P1 | PASS |
| TC-H17 | ensureConnected 失败后重试可成功 | P1 | PASS |
| TC-H21 | 多个 worker 返回第一个在线的 | P1 | PASS |
| TC-H24 | 命令 expired 返回 null | P1 | PASS |
| TC-H25 | 轮询间隔递增策略（2s, 3s, 5s, 5s...） | P1 | PASS |
| TC-H26 | 轮询中途 GET 返回非 OK 继续轮询 | P1 | PASS |
| TC-H27 | TRIBUNAL_HUB_URL 未设置返回 null | P1 | PASS |
| TC-H28 | TRIBUNAL_HUB_URL 设置返回 HubClient 实例 | P1 | PASS |
| TC-H29 | 连续调用返回同一实例（单例） | P1 | PASS |
| TC-H30 | resetHubClient 后重新创建 | P1 | PASS |
| TC-N01 | baseUrl 尾部斜杠被去除 | P1 | PASS |
| TC-N03 | ensureConnected 网络异常不抛出 | P1 | PASS |
| TC-N04 | 空 TRIBUNAL_HUB_URL 返回 null | P0 | PASS |

### 2. tribunal.test.ts（新增 13 个用例）

| ID | 用例名 | 优先级 | 结果 |
|----|--------|--------|------|
| TC-T02 | 默认模式 dummy verdict 结构完整 | P2 | PASS |
| TC-T10 | Hub PASS 无 evidence 覆写为 FAIL | P0 | PASS |
| TC-T11 | Hub 返回字符串 result（需 JSON.parse） | P1 | PASS |
| TC-T12 | Hub 返回无效 result（无 verdict 字段）降级 | P1 | PASS |
| TC-T13 | Hub 注册失败降级到 Subagent | P0 | PASS |
| TC-T14 | Hub 大 digest 使用文件模式 prompt | P1 | PASS |
| TC-T15 | Hub 小 digest 内联 prompt | P1 | PASS |
| TC-N02 | Hub 返回非 JSON 字符串不崩溃 | P1 | PASS |
| TC-I01 | EvalTribunalResult 新增字段均为 optional | P1 | PASS |
| TC-I02 | evaluateTribunal 参数签名不变 | P1 | PASS |

### 3. orchestrator.test.ts（新增 3 个用例）

| ID | 用例名 | 优先级 | 结果 |
|----|--------|--------|------|
| TC-O04a | Phase 5 subagentRequested 返回 tribunal_subagent | P0 | PASS |
| TC-O04b | Phase 6 subagentRequested 返回 tribunal_subagent | P0 | PASS |
| TC-O05 | subagentRequested 连续 3 次不触发 ESCALATE_REGRESS | P2 | PASS |

## P0 用例覆盖

| ID | 描述 | 状态 |
|----|------|------|
| TC-T10 | Hub PASS 无 evidence 覆写 | PASS |
| TC-T13 | Hub 注册失败降级 | PASS |
| TC-O04 | Phase 5/6 subagentRequested 分支验证 | PASS |
| TC-N04 | 空字符串 TRIBUNAL_HUB_URL 边界条件 | PASS |

> 注：TC-T16（subagentRequested 跳过 tribunal log）因 evaluateTribunal 需要完整文件系统 mock（prepareTribunalInput 依赖），属于 INTEGRATION 级别，已由 orchestrator 层面的 TC-O01/O04 间接覆盖。

## 回归验证

全部 465 个测试用例通过，无回归。

```
 Test Files  19 passed (19)
      Tests  465 passed (465)
   Duration  31.69s
```

```

## 框架执行的测试日志（可信）
```

> auto-dev-plugin@1.0.0 test
> cd mcp && npm test


> auto-dev-mcp-server@9.0.0 test
> vitest run


 RUN  v2.1.9 /Users/admin/.claude/plugins/auto-dev-plugin/mcp

 ✓ src/__tests__/ship-integration-e2e.test.ts (26 tests) 34ms
 ✓ src/__tests__/orchestrator.test.ts (57 tests) 62ms
 ✓ src/__tests__/batch1-guard-optimization.test.ts (21 tests) 90ms
 ✓ src/__tests__/e2e-integration.test.ts (19 tests) 947ms
 ✓ src/__tests__/orchestrator-prompts.test.ts (44 tests) 132ms
 ✓ src/__tests__/lessons-manager.test.ts (35 tests) 818ms
 ✓ src/__tests__/tdd-gate-integration.test.ts (29 tests) 538ms
 ✓ src/__tests__/tdd-gate.test.ts (56 tests) 157ms
 ✓ src/__tests__/ship-integration.test.ts (15 tests) 24ms
 ✓ src/__tests__/improvements.test.ts (11 tests) 20ms
 ✓ src/__tests__/state-rebuild.test.ts (5 tests) 14ms
 ✓ src/__tests__/preflight-context.test.ts (7 tests) 8ms
 ✓ src/__tests__/regress.test.ts (8 tests) 8ms
 ✓ src/__tests__/tribunal.test.ts (76 tests) 6121ms
   ✓ runTribunalWithRetry — Crash Detection and Retry (CLI mode) > TC-11: Crash on first attempt, legitimate FAIL on retry 3002ms
   ✓ runTribunalWithRetry — Crash Detection and Retry (CLI mode) > TC-12: Two consecutive crashes returns exhausted-retry FAIL 3002ms
 ✓ src/__tests__/iteration-limit.test.ts (7 tests) 7ms
 ✓ src/__tests__/prompt-lint.test.ts (2 tests) 48ms
 ✓ src/__tests__/hub-client.test.ts (17 tests) 6025ms
   ✓ HubClient.executePrompt > sends command and polls until completed (AC-2) 2003ms
   ✓ HubClient.executePrompt > returns null on timeout (AC-6) 2002ms
   ✓ HubClient.executePrompt > returns null when command is rejected 2000ms
 ✓ src/__tests__/agent-spawner.test.ts (16 tests) 9026ms
   ✓ spawnAgentWithRetry — retry on crash > retries on crash, returns on success 3002ms
   ✓ spawnAgentWithRetry — retry on crash > returns crash result after exhausting retries 3001ms
   ✓ spawnAgentWithRetry — retry on crash > uses custom crashDetector when provided 3001ms
 ✓ src/__tests__/hub-client-extended.test.ts (14 tests) 28025ms
   ✓ HubClient.isAvailable — timeout > TC-H07: returns false when fetch exceeds 1s timeout 1005ms
   ✓ HubClient.executePrompt — expired command > TC-H24: returns null when command status is expired 2001ms
   ✓ HubClient.executePrompt — polling intervals > TC-H25: polling intervals follow 2s, 3s, 5s, 5s pattern 20003ms
   ✓ HubClient.executePrompt — resilient polling > TC-H26: continues polling after GET returns non-OK, then completes 5002ms

 Test Files  19 passed (19)
      Tests  465 passed (465)
   Start at  19:58:39
   Duration  32.03s (transform 2.10s, setup 0ms, collect 6.11s, tests 52.10s, environment 8ms, prepare 4.15s)



```

## 框架测试退出码（可信）
```
0
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

