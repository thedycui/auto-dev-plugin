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
 mcp/dist/index.js                                  |     38 +-
 mcp/dist/index.js.map                              |      2 +-
 mcp/dist/orchestrator.js                           |    139 +-
 mcp/dist/orchestrator.js.map                       |      2 +-
 mcp/dist/phase-enforcer.js                         |     20 +-
 mcp/dist/phase-enforcer.js.map                     |      2 +-
 mcp/dist/state-manager.js                          |     18 +-
 mcp/dist/state-manager.js.map                      |      2 +-
 mcp/dist/types.d.ts                                |     48 +
 mcp/dist/types.js                                  |     38 +-
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
 mcp/src/__tests__/orchestrator.test.ts             |    340 +
 mcp/src/index.ts                                   |     34 +-
 mcp/src/orchestrator.ts                            |    148 +-
 mcp/src/phase-enforcer.ts                          |      9 +-
 mcp/src/types.ts                                   |     30 +
 skills/auto-dev/SKILL.md                           |     39 +-
 51 files changed, 1673 insertions(+), 395329 deletions(-)

```

## E2E 测试结果
```
# E2E Test Results: ship-integration

## 执行环境
- 测试框架: vitest 2.1.9
- 执行命令: npm test
- 执行时间: 2026-03-27T14:35:33
- 总耗时: 13.56s

## 测试结果汇总
- 总用例数: 412
- 通过: 412
- 失败: 0
- 跳过: 0
- 测试文件: 17 passed (17)

## ship-integration 相关测试详细结果

### ship-integration-e2e.test.ts (26 tests)

| TC ID | 测试名称 | 结果 |
|-------|---------|------|
| T-INT-02 | Step 1: Phase 7 PASS -> advances to 8a | PASS |
| T-INT-02 | Step 2: 8a passes (no unpushed) -> advances to 8b | PASS |
| T-INT-02 | Step 3: 8b passes (SUCCEED) -> advances to 8c | PASS |
| T-INT-02 | Step 4: 8c passes (SUCCEED) -> advances to 8d | PASS |
| T-INT-02 | Step 5: 8d PASS -> done=true | PASS |
| T-INT-02 | Step 6: evaluateTribunal never called during Phase 8 (AC-12) | PASS |
| T-INT-03 | CODE_BUG triggers regress to Phase 3, step='3', shipRound=1 | PASS |
| T-INT-03 | After regress, Phase 3 build+test pass -> advances to 4a | PASS |
| T-INT-04a | shipRound=4, shipMaxRounds=5, CODE_BUG -> ESCALATE | PASS |
| T-INT-04b | shipRound=0, shipMaxRounds=1, CODE_BUG -> ESCALATE (minimal boundary) | PASS |
| T-INT-04c | shipRound=3, shipMaxRounds=5, CODE_BUG -> no ESCALATE, regress to Phase 3 | PASS |
| T-INT-05 | skipE2e=true skips Phase 5 but Phase 8 remains: 4a -> 6 | PASS |
| T-INT-05 | skipE2e=true, Phase 7 -> 8a (Phase 8 not skipped) | PASS |
| T-INT-06 | dryRun=true: maxPhase=2 regardless of ship, canDeclareComplete at Phase 2 | PASS |
| T-INT-06 | dryRun=true + ship=true: validateCompletion requires Phase 1,2,8 | PASS |
| T-INT-07 | turbo mode: maxPhase=3 regardless of ship, canDeclareComplete at Phase 3 | PASS |
| T-INT-08a | ship=true but Phase 8 not PASS -> canComplete=false | PASS |
| T-INT-08b | ship=true with Phase 8 PASS -> canComplete=true | PASS |
| T-INT-09 | iteration 0: 8b fails (no file) -> stays at 8b, prompt non-null | PASS |
| T-INT-09 | iteration 1: 8b fails again -> stays at 8b, prompt non-null | PASS |
| T-INT-09 | iteration 2: 8b fails third time -> ESCALATE (iteration_limit_exceeded) | PASS |
| T-INT-10 | ENV_ISSUE stays at 8d, no phase change, shipRound unchanged | PASS |
| T-INT-11 | validateStep('8d') returns passed=false, no regressToPhase (ENV_ISSUE fallback) | PASS |
| T-INT-12 | content with both PASS and CODE_BUG -> passed=true (PASS checked first) | PASS |
| T-INT-13 | lowercase 'succeed' -> passed=false (case-sensitive) | PASS |
| T-INT-14 | git exitCode=128 -> passed=false, feedback contains error message | PASS |

### ship-integration.test.ts (15 tests)

| TC ID | 测试名称 | 结果 |
|-------|---------|------|
| AC-1 | StateJsonSchema accepts all ship-related fields | PASS |
| AC-1 | ship fields are optional -- state without them is valid | PASS |
| AC-1 | InitInputSchema accepts ship parameters | PASS |
| AC-1 | ship parameters are optional | PASS |
| AC-1 | does not include shipRound (set by framework) | PASS |
| AC-3/4 | ship=true: Phase 7 PASS -> nextPhase=8 | PASS |
| AC-3/4 | ship=true: Phase 8 PASS -> canDeclareComplete=true | PASS |
| AC-3 | ship=false: Phase 7 PASS -> canDeclareComplete=true (unchanged) | PASS |
| AC-3 | isDryRun=true: maxPhase still 2 regardless of ship | PASS |
| AC-3 | turbo mode: maxPhase still 3 regardless of ship | PASS |
| AC-11 | ship=true requires Phase 8 PASS | PASS |
| AC-11 | ship=true with Phase 8 PASS -> canComplete | PASS |
| AC-11 | ship=false does not require Phase 8 | PASS |
| AC-11 | default ship parameter is false | PASS |
| AC-5 | skipE2e + ship: requires [1,2,3,4,6,7,8] | PASS |

## DEFERRED 用例

| TC ID | 原因 |
|-------|------|
| T-E2E-01 | 需要完整 MCP server 启动 + 模拟真实 MCP client 调用 |
| T-E2E-02 | 需要 DevOps 平台连接 + SSH 远程验证环境 |

## 未实现用例

| TC ID | 层级 | 状态 | 说明 |
|-------|------|------|------|
| T-INT-01a | INTEGRATION | 已覆盖(间接) | init handler 的正常路径已由 ship-integration.test.ts 中 InitInputSchema 和 StateJsonSchema 测试覆盖；handler 级集成测试因需 mock MCP server 入口未单独实现 |
... (truncated, 20 lines omitted)
```

## 框架执行的测试日志（可信）
```

> auto-dev-plugin@1.0.0 test
> cd mcp && npm test


> auto-dev-mcp-server@8.0.0 test
> vitest run


 RUN  v2.1.9 /Users/admin/.claude/plugins/auto-dev-plugin/mcp

 ✓ src/__tests__/ship-integration-e2e.test.ts (26 tests) 142ms
 ✓ src/__tests__/orchestrator.test.ts (51 tests) 251ms
 ✓ src/__tests__/batch1-guard-optimization.test.ts (21 tests) 264ms
 ✓ src/__tests__/e2e-integration.test.ts (19 tests) 977ms
 ✓ src/__tests__/orchestrator-prompts.test.ts (44 tests) 57ms
 ✓ src/__tests__/lessons-manager.test.ts (35 tests) 732ms
 ✓ src/__tests__/tdd-gate-integration.test.ts (29 tests) 600ms
 ✓ src/__tests__/tdd-gate.test.ts (56 tests) 187ms
 ✓ src/__tests__/ship-integration.test.ts (15 tests) 49ms
 ✓ src/__tests__/improvements.test.ts (11 tests) 23ms
 ✓ src/__tests__/state-rebuild.test.ts (5 tests) 48ms
 ✓ src/__tests__/preflight-context.test.ts (7 tests) 7ms
 ✓ src/__tests__/regress.test.ts (8 tests) 9ms
 ✓ src/__tests__/iteration-limit.test.ts (7 tests) 11ms
 ✓ src/__tests__/prompt-lint.test.ts (2 tests) 120ms
 ✓ src/__tests__/tribunal.test.ts (60 tests) 6135ms
   ✓ runTribunalWithRetry — Crash Detection and Retry > TC-11: Crash on first attempt, legitimate FAIL on retry 3031ms
   ✓ runTribunalWithRetry — Crash Detection and Retry > TC-12: Two consecutive crashes returns exhausted-retry FAIL 3003ms
 ✓ src/__tests__/agent-spawner.test.ts (16 tests) 9039ms
   ✓ spawnAgentWithRetry — retry on crash > retries on crash, returns on success 3003ms
   ✓ spawnAgentWithRetry — retry on crash > returns crash result after exhausting retries 3001ms
   ✓ spawnAgentWithRetry — retry on crash > uses custom crashDetector when provided 3001ms

 Test Files  17 passed (17)
      Tests  412 passed (412)
   Start at  14:38:40
   Duration  14.31s (transform 4.06s, setup 0ms, collect 9.98s, tests 18.65s, environment 9ms, prepare 5.08s)



```

## 框架测试退出码（可信）
```
0
```

## 关键代码变更
```diff
diff --git a/mcp/src/index.ts b/mcp/src/index.ts
index 4b4d7da..49da1a0 100644
--- a/mcp/src/index.ts
+++ b/mcp/src/index.ts
@@ -101,8 +101,21 @@ server.tool(
     costMode: z.enum(["economy", "beast"]).optional(),
     onConflict: z.enum(["resume", "overwrite"]).optional(),
     designDoc: z.string().optional(),
+    ship: z.boolean().optional(),
+    deployTarget: z.string().optional(),
+    deployBranch: z.string().optional(),
+    deployEnv: z.string().optional(),
+    verifyMethod: z.enum(["api", "log", "test", "combined"]).optional(),
+    verifyConfig: z.object({
+      endpoint: z.string().optional(),
+      expectedPattern: z.string().optional(),
+      logPath: z.string().optional(),
+      logKeyword: z.string().optional(),
+      sshHost: z.string().optional(),
+    }).optional(),
+    shipMaxRounds: z.number().int().optional(),
   },
-  async ({ projectRoot, topic, mode: explicitMode, estimatedLines, estimatedFiles, changeType, startPhase, interactive, dryRun, skipE2e, tdd, brainstorm, costMode, onConflict, designDoc }) => {
+  async ({ projectRoot, topic, mode: explicitMode, estimatedLines, estimatedFiles, changeType, startPhase, interactive, dryRun, skipE2e, tdd, brainstorm, costMode, onConflict, designDoc, ship, deployTarget, deployBranch, deployEnv, verifyMethod, verifyConfig, shipMaxRounds }) => {
     const sm = new StateManager(projectRoot, topic);
 
     // Handle existing directory
@@ -193,6 +206,14 @@ server.tool(
       }
     }
 
+    // --- Ship parameter validation ---
+    if (ship === true && !deployTarget) {
+      return textResult({
+        error: "MISSING_DEPLOY_TARGET",
+        message: "ship=true requires deployTarget parameter.",
+      });
+    }
+
     // --- Mode decision: explicit override or framework auto-select ---
     let mode: "full" | "quick" | "turbo";
     if (explicitMode) {
@@ -260,6 +281,16 @@ server.tool(
     behaviorUpdates["tdd"] = tdd !== false;  // TDD on by default, --no-tdd to disable
     if (brainstorm) behaviorUpdates["brainstorm"] = true;
     behaviorUpdates["costMode"] = costMode ?? "beast"; // beast=全部最强(默认), economy=按阶段选模型
+    if (ship === true) {
+      behaviorUpdates["ship"] = true;
+      behaviorUpdates["deployTarget"] = deployTarget;
+      if (deployBranch) behaviorUpdates["deployBranch"] = deployBranch;
+      if (deployEnv) behaviorUpdates["deployEnv"] = deployEnv;
+      if (verifyMethod) behaviorUpdates["verifyMethod"] = verifyMethod;
+      if (verifyConfig) behaviorUpdates["verifyConfig"] = verifyConfig;
+      behaviorUpdates["shipRound"] = 0;
+      behaviorUpdates["shipMaxRounds"] = shipMaxRounds ?? 5;
+    }
     await sm.atomicUpdate(behaviorUpdates);
 
     // --- Design doc binding (Issue #7) ---
@@ -1306,6 +1337,7 @@ server.tool(
... (truncated, 8 lines omitted)
diff --git a/mcp/src/orchestrator.ts b/mcp/src/orchestrator.ts
index 1326b37..79754d0 100644
--- a/mcp/src/orchestrator.ts
+++ b/mcp/src/orchestrator.ts
@@ -85,10 +85,14 @@ const STEP_AGENTS: Record<string, string> = {
   "5c": "auto-dev-developer",
   "6": "auto-dev-acceptance-validator",
   "7": "auto-dev-reviewer",
+  "8a": "auto-dev-developer",
+  "8b": "auto-dev-developer",
+  "8c": "auto-dev-developer",
+  "8d": "auto-dev-developer",
 };
 
 /** Ordered step transitions (happy path) */
-const STEP_ORDER = ["1a", "1b", "2a", "2b", "3", "4a", "5a", "5b", "6", "7"];
+const STEP_ORDER = ["1a", "1b", "2a", "2b", "3", "4a", "5a", "5b", "6", "7", "8a", "8b", "8c", "8d"];
 
 const ISOLATION_FOOTER = "\n\n---\n完成后不需要做其他操作。直接完成任务即可。\n";
 
@@ -260,7 +264,7 @@ export function phaseForStep(step: string): number {
 /** Return the first sub-step for a given phase */
 export function firstStepForPhase(phase: number): string {
   const map: Record<number, string> = {
-    1: "1a", 2: "2a", 3: "3", 4: "4a", 5: "5a", 6: "6", 7: "7",
+    1: "1a", 2: "2a", 3: "3", 4: "4a", 5: "5a", 6: "6", 7: "7", 8: "8a",
   };
   return map[phase] ?? String(phase);
 }
@@ -544,6 +548,68 @@ export async function validateStep(
       return { passed: true, feedback: "" };
     }
 
+    // Phase 8: Ship (delivery verification) — no tribunal
+    case "8a": {
+      // Check all commits are pushed
+      try {
+        const gitResult = await shell("git log --oneline --branches --not --remotes", projectRoot, 10_000);
+        if (gitResult.exitCode !== 0) {
+          return { passed: false, feedback: `git 命令执行失败: ${gitResult.stderr}` };
+        }
+        const unpushed = gitResult.stdout.trim();
+        if (unpushed.length > 0) {
+          return { passed: false, feedback: `存在未 push 的 commit:\n${unpushed}\n请执行 git push 推送所有变更。` };
+        }
+      } catch (err) {
+        return { passed: false, feedback: `git 命令执行异常: ${(err as Error).message}` };
+      }
+      return { passed: true, feedback: "" };
+    }
+
+    case "8b": {
+      const buildResultContent = await readFileSafe(join(outputDir, "ship-build-result.md"));
+      if (!buildResultContent || !buildResultContent.includes("SUCCEED")) {
+        return {
+          passed: false,
+          feedback: "ship-build-result.md 不存在或不含 'SUCCEED'，请确认构建成功后写入结果。",
+        };
+      }
+      return { passed: true, feedback: "" };
... (truncated, 176 lines omitted)
diff --git a/mcp/src/phase-enforcer.ts b/mcp/src/phase-enforcer.ts
index 6314ee9..adc28cc 100644
--- a/mcp/src/phase-enforcer.ts
+++ b/mcp/src/phase-enforcer.ts
@@ -19,6 +19,7 @@ const PHASE_META: Record<number, { name: string; description: string }> = {
   5: { name: "E2E_TEST", description: "端到端测试" },
   6: { name: "ACCEPTANCE", description: "验收" },
   7: { name: "RETROSPECTIVE", description: "经验萃取" },
+  8: { name: "SHIP", description: "交付验证" },
 };
 
 /** full 模式的必需 Phase */
@@ -108,7 +109,7 @@ export function computeNextDirective(
 ): NextDirective {
   const mode = state.mode;
   const isDryRun = state.dryRun === true;
-  const maxPhase = isDryRun ? 2 : mode === "turbo" ? 3 : 7;
+  const maxPhase = isDryRun ? 2 : mode === "turbo" ? 3 : state.ship === true ? 8 : 7;
 
   // REGRESS 分支必须在守卫之前
   if (status === "REGRESS") {
@@ -199,6 +200,7 @@ export function validateCompletion(
   mode: "full" | "quick" | "turbo",
   isDryRun: boolean,
   skipE2e: boolean = false,
+  ship: boolean = false,
 ): CompletionValidation {
   const basePhases = isDryRun
     ? [1, 2]
@@ -207,9 +209,12 @@ export function validateCompletion(
       : mode === "quick"
         ? REQUIRED_PHASES_QUICK
         : REQUIRED_PHASES_FULL;
-  const requiredPhases = skipE2e
+  let requiredPhases = skipE2e
     ? basePhases.filter((p) => p !== 5)
     : basePhases;
+  if (ship) {
+    requiredPhases = [...requiredPhases, 8];
+  }
 
   // 从 progress-log 中提取所有 PASS 的 phase
   const passedPhases = new Set<number>();

diff --git a/mcp/src/types.ts b/mcp/src/types.ts
index 13d8a65..883f333 100644
--- a/mcp/src/types.ts
+++ b/mcp/src/types.ts
@@ -156,6 +156,22 @@ export const StateJsonSchema = z.object({
   // Phase-level escalation counter (Issue #2: ESCALATE auto-regress)
   phaseEscalateCount: z.record(z.string(), z.number()).optional(),
 
+  // Ship (Phase 8) — optional delivery verification
+  ship: z.boolean().optional(),
+  deployTarget: z.string().optional(),
+  deployBranch: z.string().optional(),
+  deployEnv: z.string().optional(),
+  verifyMethod: z.enum(["api", "log", "test", "combined"]).optional(),
+  verifyConfig: z.object({
+    endpoint: z.string().optional(),
+    expectedPattern: z.string().optional(),
+    logPath: z.string().optional(),
+    logKeyword: z.string().optional(),
+    sshHost: z.string().optional(),
+  }).optional(),
+  shipRound: z.number().int().optional(),
+  shipMaxRounds: z.number().int().optional(),
+
   // Timestamps
   startedAt: z.string(),
   updatedAt: z.string(),
@@ -186,6 +202,20 @@ export const InitInputSchema = z.object({
   tdd: z.boolean().optional(),          // --tdd: RED-GREEN-REFACTOR in Phase 3
   brainstorm: z.boolean().optional(),   // --brainstorm: enable Phase 0
   onConflict: OnConflictSchema.optional(),
+  // Ship (Phase 8) parameters
+  ship: z.boolean().optional(),
+  deployTarget: z.string().optional(),
+  deployBranch: z.string().optional(),
+  deployEnv: z.string().optional(),
+  verifyMethod: z.enum(["api", "log", "test", "combined"]).optional(),
+  verifyConfig: z.object({
+    endpoint: z.string().optional(),
+    expectedPattern: z.string().optional(),
+    logPath: z.string().optional(),
+    logKeyword: z.string().optional(),
+    sshHost: z.string().optional(),
+  }).optional(),
+  shipMaxRounds: z.number().int().optional(),
 });
 
 export type InitInput = z.infer<typeof InitInputSchema>;

diff --git a/skills/auto-dev/SKILL.md b/skills/auto-dev/SKILL.md
index ebfb94b..94c4c9c 100644
--- a/skills/auto-dev/SKILL.md
+++ b/skills/auto-dev/SKILL.md
@@ -10,7 +10,7 @@ description: "自治开发循环 — 从设计到测试通过的全自动闭环
 ### 1. 初始化
 
 ```
-auto_dev_init(projectRoot, topic, mode?, skipE2e?, tdd?, costMode?, onConflict?, designDoc?)
+auto_dev_init(projectRoot, topic, mode?, skipE2e?, tdd?, costMode?, onConflict?, designDoc?, ship?, deployTarget?, deployBranch?, deployEnv?, verifyMethod?, verifyConfig?, shipMaxRounds?)
 ```
 
 - `mode` — `full`（默认）/ `quick`（跳过设计计划）/ `turbo`（仅实现）
@@ -18,6 +18,13 @@ auto_dev_init(projectRoot, topic, mode?, skipE2e?, tdd?, costMode?, onConflict?,
 - `onConflict` — `resume`（恢复上次）/ `overwrite`（覆盖重来）
 - `designDoc` — 指定已有设计文档路径（如 `docs/design-xxx.md`），自动复制并跳过重新设计
   - 不指定时，框架自动匹配 `docs/design-*{topic}*.md`
+- `ship` — 是否启用 Phase 8 交付验证（默认 false）。启用后 Phase 7 完成会自动进入 Phase 8
+- `deployTarget` — DevOps 组件名（`ship=true` 时必填）
+- `deployBranch` — 部署分支（默认当前 git 分支）
+- `deployEnv` — 目标环境（默认 `"green"`）
+- `verifyMethod` — 远程验证方式：`"api"` / `"log"` / `"test"` / `"combined"`
+- `verifyConfig` — 验证配置对象，包含 `endpoint?`、`expectedPattern?`、`logPath?`、`logKeyword?`、`sshHost?` 等可选字段
+- `shipMaxRounds` — 最大交付轮次（默认 5）。交付验证发现代码 bug 会自动回退 Phase 3 修复并重新交付，超过此轮次 ESCALATE
 
 ### 2. 循环执行
 
@@ -44,6 +51,36 @@ while !result.done:
 auto_dev_state_get(projectRoot, topic)
 ```
 
+### 4. Phase 8 交付验证（可选）
+
+当 `ship=true` 时，Phase 7（复盘）完成后自动进入 Phase 8，依次执行：
+
+- **8a — Push 代码**：commit 并 push 到远程仓库
+- **8b — 构建**：触发 DevOps 构建，验证构建成功
+- **8c — 部署**：部署到目标环境，验证部署成功
+- **8d — 远程验证**：根据 `verifyMethod` 执行 API 调用、日志检查或远程测试，确认功能正常
+
+Phase 8 不走 tribunal 裁决，验证基于硬数据（构建结果、部署状态、远程验证返回）。
+
+**回退机制**：Step 8d 验证失败时，若判定为代码问题（CODE_BUG），自动回退到 Phase 3 修复后重新交付；若判定为环境问题（ENV_ISSUE），直接 ESCALATE 给用户。回退轮次超过 `shipMaxRounds` 时 ESCALATE。
+
+**使用示例**：
+
+```
+auto_dev_init(
+  projectRoot="/path/to/project",
+  topic="add-user-export",
+  ship=true,
+  deployTarget="user-service",
+  deployBranch="common-test",
+  deployEnv="green",
+  verifyMethod="api",
+  verifyConfig={ endpoint: "http://test.example.com/api/users/export", expectedPattern: "200" }
+)
+```
+
+未传 `ship=true` 时 Phase 8 不激活，不影响 Phase 1-7 的行为。
... (truncated, 5 lines omitted)
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

