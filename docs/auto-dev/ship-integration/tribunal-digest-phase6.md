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

## 验收报告
```
# 验收报告

## 验收对象

- **设计文档**: `docs/auto-dev/ship-integration/design.md`
- **验收日期**: 2026-03-27

## 逐条验证

| AC | 描述 | 验证方式 | 结果 | 证据 |
|----|------|---------|------|------|
| AC-1 | `auto_dev_init(ship=true, deployTarget="app")` 成功初始化，state.json 中包含 `ship: true`、`deployTarget: "app"`、`shipRound: 0`、`shipMaxRounds: 5` | 代码审查 + 单元测试 | PASS | `index.ts:284-292` behaviorUpdates 写入 ship/deployTarget/shipRound=0/shipMaxRounds=5；`types.ts:160-173` StateJsonSchema 含所有 ship 字段；`ship-integration.test.ts` 5 条 AC-1 测试全 PASS |
| AC-2 | `auto_dev_init(ship=true)` 不传 `deployTarget` 时返回 `MISSING_DEPLOY_TARGET` 错误 | 代码审查 | PASS | `index.ts:210-215` `if (ship === true && !deployTarget)` 守卫返回 `error: "MISSING_DEPLOY_TARGET"`；无独立 handler 测试但逻辑为简单 if-return 守卫 |
| AC-3 | 无 ship 时 Phase 7 完成后 `computeNextStep` 返回 null（COMPLETED） | 代码审查 + 单元测试 | PASS | `phase-enforcer.ts:112` maxPhase 在非 ship 时为 7；`orchestrator.ts:68-72` PHASE_SEQUENCE 不含 8；`ship-integration.test.ts` "ship=false: Phase 7 PASS -> canDeclareComplete=true" PASS |
| AC-4 | full 模式 + ship=true 时 phases 为 `[1,2,3,4,5,6,7,8]`，Phase 7 PASS 后下一步为 "8a" | 代码审查 + 单元测试 | PASS | `orchestrator.ts:764-766` `if (state.ship === true) phases = [...phases, 8]`；`ship-integration.test.ts` "ship=true: Phase 7 PASS -> nextPhase=8" PASS；`ship-integration-e2e.test.ts` T-INT-02 "Phase 7 PASS -> advances to 8a" PASS |
| AC-5 | `skipE2e=true` + `ship=true` 时 phases 为 `[1,2,3,4,6,7,8]` | 代码审查 + 单元测试 | PASS | `orchestrator.ts:761-766` 先 filter 掉 5 再追加 8；`ship-integration.test.ts` "skipE2e + ship: requires [1,2,3,4,6,7,8]" PASS；`ship-integration-e2e.test.ts` T-INT-05 两条测试 PASS |
| AC-6 | Step 8a 验证：git unpushed commit 时 passed=false；无 unpushed 时 passed=true | 代码审查 + 单元测试 | PASS | `orchestrator.ts:552-567` case "8a" 执行 `git log --oneline --branches --not --remotes`，stdout 非空返回 passed=false；`ship-integration-e2e.test.ts` T-INT-02 Step 2 + T-INT-14 PASS |
| AC-7 | Step 8b 验证：`ship-build-result.md` 不存在或不含 "SUCCEED" 返回 passed=false | 代码审查 + 单元测试 | PASS | `orchestrator.ts:569-578` case "8b" readFileSafe + includes("SUCCEED") 检查；`ship-integration-e2e.test.ts` T-INT-09 (三轮失败) + T-INT-13 (大小写敏感) PASS |
| AC-8 | Step 8c 验证：`ship-deploy-result.md` 不存在或不含 "SUCCEED" 返回 passed=false | 代码审查 + 单元测试 | PASS | `orchestrator.ts:580-589` case "8c" 逻辑与 8b 对称；`ship-integration-e2e.test.ts` T-INT-02 Step 4 PASS |
| AC-9 | Step 8d 验证：PASS/CODE_BUG/ENV_ISSUE 三路分支 | 代码审查 + 单元测试 | PASS | `orchestrator.ts:591-611` case "8d" 三路判断：includes("PASS") -> passed=true, includes("CODE_BUG") -> regressToPhase=3, 其他 -> passed=false 无 regress；`ship-integration-e2e.test.ts` T-INT-03/10/11/12 全 PASS |
| AC-10 | CODE_BUG 回退后 shipRound 递增；shipRound >= shipMaxRounds 时 ESCALATE | 代码审查 + 单元测试 | PASS | `orchestrator.ts:906-919` currentShipRound = shipRound+1，>=maxRounds 返回 escalation.reason="ship_max_rounds"；`orchestrator.ts:921-930` 否则 atomicUpdate shipRound=currentShipRound；`ship-integration-e2e.test.ts` T-INT-03 (round=1) + T-INT-04a/04b/04c PASS |
| AC-11 | `validateCompletion(ship=true)` 要求 Phase 8 PASS；ship=false 不要求 | 代码审查 + 单元测试 | PASS | `phase-enforcer.ts:198-217` ship 参数追加 8 到 requiredPhases；`index.ts:1340` 调用时传 `state.ship === true`；`ship-integration.test.ts` 4 条 AC-11 测试 + `ship-integration-e2e.test.ts` T-INT-08a/08b PASS |
| AC-12 | Phase 8 步骤不触发 tribunal | 代码审查 + 单元测试 | PASS | `orchestrator.ts` 中 `evaluateTribunal` 仅在 case "4a"/"5b"/"6" 调用，case "8a"-"8d" 无 evaluateTribunal 调用；`ship-integration-e2e.test.ts` T-INT-02 Step 6 显式验证 "evaluateTribunal never called during Phase 8" PASS |
| AC-13 | `phase8-ship.md` prompt 模板存在且包含 Step 8a-8d 指令，能渲染变量 | 代码审查 | PASS | `skills/auto-dev/prompts/phase8-ship.md` 存在（71 行），包含 Step 8a-8d 完整分步指引，使用 `{{deployTarget}}`/`{{deployBranch}}`/`{{deployEnv}}`/`{{verifyMethod}}` 变量；`orchestrator.ts:700-703` 将 8a-8d 映射到 "phase8-ship" 模板，`orchestrator.ts:788-791` 注入 shipExtraVars |

## 汇总

通过率：13/13 PASS, 0 FAIL, 0 SKIP

结论：**PASS**

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

