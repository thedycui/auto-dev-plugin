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

## Phase 1 设计评审
```
# Design Review

## P0 (阻塞性问题)

### P0-1: `regressToPhase` 机制在 `computeNextTask` 中不存在 -- 设计描述的消费方逻辑需要从零实现

设计 4.2 节说："`computeNextTask` 中处理 `validation.regressToPhase` 的逻辑"，暗示已有基础设施可以复用。但经代码验证：

- `validateStep` 的返回类型声明了 `regressToPhase?: number`（第 401 行），但 `computeNextTask` 中 **从未读取** `validation.regressToPhase`（grep 搜索 `validation\.regressToPhase` 零匹配）。
- 现有的回退机制是 tribunal ESCALATE_REGRESS（第 772 行），走的是固定回退到 Phase 3 + `phaseEscalateCount` 计数器，与设计中 `shipRound` + `shipMaxRounds` 是完全不同的计数体系。

**风险**：这是一个 **休眠路径**（Dormant Path），`regressToPhase` 从 `validateStep` 返回后在 `computeNextTask` 中无人消费。设计需要明确：Phase 8 的 CODE_BUG 回退是通过新增通用 `regressToPhase` 处理分支实现，还是走类似 tribunal ESCALATE_REGRESS 的专用分支。

**修复建议**：在设计 4.2 节明确 `computeNextTask` 中新增 `regressToPhase` 处理的代码位置和逻辑——应在 `validation.passed === false` 但无 `tribunalResult` 的分支中（约第 806 行之后），先检查 `validation.regressToPhase`，如果有值则走 ship 回退逻辑（shipRound 递增、ESCALATE 判断），否则走现有 circuit breaker 逻辑。

### P0-2: `computeNextDirective` maxPhase 硬编码为 7，未感知 ship

设计 4.3 节说 `computeNextDirective` 的 `maxPhase` 计算需感知 ship。但当前代码（phase-enforcer.ts 第 111 行）：

```
const maxPhase = isDryRun ? 2 : mode === "turbo" ? 3 : 7;
```

这里硬编码了 `7`，而 `computeNextDirective` 的签名 `(currentPhase, status, state, regressTo?)` 虽然接收 `state`，但函数内部并未读取 `state.ship`。

**影响**：`computeNextDirective` 不仅被 `auto_dev_checkpoint` 调用（第 445 行附近），还是 Phase 推进的强制指令源。如果 `ship=true` 时 maxPhase 仍为 7，Phase 7 完成后会返回 "所有 Phase 已完成"（第 165 行），导致 checkpoint 路径认为任务已结束，与 orchestrator 的 Phase 8 追加逻辑矛盾。

**修复建议**：设计中需补充 `computeNextDirective` 的具体修改：`const maxPhase = isDryRun ? 2 : mode === "turbo" ? 3 : state.ship ? 8 : 7;` 并在 `PHASE_META` 中新增 Phase 8 条目。

## P1 (重要问题)

### P1-1: `validateCompletion` 新增参数改变函数签名，现有调用方需同步修改

设计 4.3 节说 `validateCompletion` 需新增第 5 个参数 `ship: boolean`。当前签名（phase-enforcer.ts 第 197-201 行）：

```typescript
export function validateCompletion(
  progressLogContent: string,
  mode: "full" | "quick" | "turbo",
  isDryRun: boolean,
  skipE2e: boolean = false,
): CompletionValidation
```

调用方在 `index.ts` 第 1304 行：`validateCompletion(progressLogContent, state.mode, state.dryRun === true, state.skipE2e === true)`。

设计 4.4 节提到了 `auto_dev_complete` 需传入 `state.ship === true`，这是正确的。但建议改用 options 对象模式 `validateCompletion(content, { mode, isDryRun, skipE2e, ship })` 以避免 5 个位置参数的可读性问题，并便于未来扩展。

**修复建议**：P1 不阻塞，但建议在设计中标注参数传递方式（追加位置参数 vs options 对象）。如果选择追加位置参数，需确保 `ship` 有默认值 `false`，以保证现有调用方不报错。

### P1-2: `PHASE_SEQUENCE` 不改但运行时动态追加 Phase 8，可能与现有测试断言冲突

设计说 `PHASE_SEQUENCE` 不改，Phase 8 在 `computeNextTask` 中运行时动态追加。当前代码（第 68-72 行）：

```typescript
const PHASE_SEQUENCE: Record<string, number[]> = {
  full: [1, 2, 3, 4, 5, 6, 7],
  quick: [3, 4, 5, 7],
  turbo: [3],
};
```

动态追加的方式 `phases = [...phases, 8]` 在功能上可行，但存在隐患：
- 如果其他地方直接引用 `PHASE_SEQUENCE[mode]` 而非 `computeNextTask` 中的 `phases` 局部变量，就不会包含 Phase 8。需确认无其他消费方。

经 grep 搜索，`PHASE_SEQUENCE` 仅在 `computeNextTask` 内部使用（第 688 行），无其他引用处，此风险可控。

**修复建议**：设计中可明确注明 "PHASE_SEQUENCE 仅在 computeNextTask 内部解引用，动态追加安全"，避免实现时产生疑虑。

### P1-3: Phase 8 step 8a-8d 全部映射到 `auto-dev-developer`，但 Phase 8 涉及 DevOps 操作

设计 4.2 节将 8a-8d 全部映射到 `auto-dev-developer` agent。但 Phase 8 的操作性质（git push、DevOps 构建、部署、远程验证）与 Phase 3 的代码实现有本质区别。当前 agent 类型用于 prompt 路由和 cost mode 选择（`getModel` 第 104-108 行只看 phase 编号），但未来如果 agent 映射影响权限或工具集，Phase 8 用 developer agent 可能不合适。

**修复建议**：当前 agent 映射只影响 `getModel` 路由，暂无实际风险。建议在设计中说明选择 `auto-dev-developer` 的理由（Phase 8 不需要额外 agent 类型，且不走 tribunal），避免实现时疑惑。

### P1-4: Step 8d CODE_BUG 回退到 Phase 3 后，Phase 4-7 的 CHECKPOINT 记录仍在 progress-log 中

Phase 8d 回退到 Phase 3 后，agent 重新实现代码，然后需要再次通过 Phase 4-7。但 progress-log 中之前的 Phase 4-7 PASS 记录仍然存在。`validateCompletion` 通过 regex 匹配 `CHECKPOINT phase=N status=PASS` 来判断完成，因此旧记录会让门禁误认为 Phase 4-7 已通过。

不过 orchestrator 模式下，完成门禁是由 `computeNextTask` 的步骤序列驱动（第 910-927 行），不依赖 `validateCompletion`。但 `auto_dev_complete` 仍然调用 `validateCompletion`（第 1304 行），需要确认不会被旧记录欺骗。

**修复建议**：设计中应明确回退后 progress-log 的处理策略——是追加回退标记（让 `validateCompletion` 只认最后一次记录），还是依赖 orchestrator 步骤序列不走 `validateCompletion`。建议追加一行 `<!-- CHECKPOINT phase=3 status=REGRESS_FROM_SHIP round=1 -->` 作为审计记录。

## P2 (优化建议)

### P2-1: `shipRound` 和 `shipMaxRounds` 可以复用现有 `regressionCount` 概念

State.json 已有 `regressionCount`（第 126 行），用于 tribunal ESCALATE_REGRESS 的回退计数。Phase 8 新增 `shipRound` + `shipMaxRounds` 是独立的计数体系。虽然语义不同（tribunal 回退 vs ship 回退），但可以考虑统一为通用的 "回退计数器" 避免概念膨胀。当前设计的独立方案也合理，仅作参考。

### P2-2: Step 8a 的 git unpushed 检查命令可能在特定 git 配置下失败

设计中 Step 8a 用 `git log --oneline --branches --not --remotes` 检测未 push 的 commit。这在没有设置 remote tracking branch 的情况下可能返回空（false positive），建议在 prompt 中引导 agent 先确认 remote tracking 关系。

### P2-3: 验收标准中缺少 Phase 8 回退后重新走 Phase 4-7 的集成测试 AC

AC-10 覆盖了 shipRound 递增和 ESCALATE，但没有覆盖回退后 orchestrator 是否正确从 Phase 3 重新走到 Phase 8。建议增加 AC-14：Phase 8d CODE_BUG 回退后，orchestrator 能从 Phase 3 正确推进到 Phase 8d。

## 跨组件影响分析

### 变更清单
... (truncated, 48 lines omitted)
```

## Phase 2 计划评审
```
# Plan Review

## P0 (阻塞性问题)

- **P0-1: 缺少 SKILL.md 更新任务** -- 设计文档 5.1 明确列出 `skills/auto-dev/SKILL.md` 需要修改（新增 ship 参数说明），但计划中没有任何 Task 覆盖此文件。SKILL.md 是主 Agent 调用 auto-dev 时的入口文档，缺少 ship 参数说明会导致用户不知道如何使用此功能。
  - 修复建议: 新增 Task（建议在 Task 12 之后），修改 `skills/auto-dev/SKILL.md`，新增 `ship`、`deployTarget`、`deployBranch`、`deployEnv`、`verifyMethod`、`verifyConfig`、`shipMaxRounds` 参数说明。完成标准：SKILL.md 包含 Phase 8 的功能描述和所有 ship 参数的用法说明。

## P1 (重要问题)

- **P1-1: Task 9 computeNextDirective 修改方式不完整** -- Task 9 只提到修改 `maxPhase` 的三元表达式，但 `computeNextDirective` 的函数签名是 `(currentPhase, status, state, regressTo?)`，它通过 `state` 参数已经能拿到 `state.ship`。然而计划没有说明如何传入 ship 信息。当前签名中 state 已经包含所有字段，所以实际上能直接读取 `state.ship`，但计划应该明确说明这一点，避免实现时误以为需要修改签名。
  - 修复建议: Task 9 描述中补充说明"直接从 state 参数读取 `state.ship`，无需修改函数签名"。

- **P1-2: Task 11 buildTaskForStep 需要传递 state 中的 ship 配置字段，但未说明具体传递机制** -- `buildTaskForStep` 当前签名为 `(step, outputDir, projectRoot, topic, buildCmd, ...)`，不接受 state 参数。Task 11 描述中写了"需传入或从 state 获取"，但没有明确方案。这是一个实现关键决策点，不能留到实现时再决定。
  - 修复建议: Task 11 明确说明传递方式。查看现有代码，`buildTaskForStep` 的 `variables` 对象（约第 596 行构造）可以在调用方（`computeNextTask`）中扩展，将 `state.deployTarget` 等字段加入 variables。Task 11 应指明：(1) 在 `computeNextTask` 调用 `buildTaskForStep` 处构造 variables 时，当 step 以 "8" 开头时从 state 中提取 ship 字段加入 variables；(2) `buildTaskForStep` 本身签名不变。

- **P1-3: 路径激活风险 -- `regressToPhase` 处理路径从未被现有代码使用过** -- `validateStep` 返回的 `regressToPhase` 字段虽然在类型定义中存在（第 401 行），但当前没有任何 step 会返回此值，`computeNextTask` 中也没有消费 `regressToPhase` 的逻辑。Task 7 是首次激活这条路径，属于"代码存在但从未执行"的高风险场景。Task 14 的测试覆盖了基本场景，但应额外覆盖：回退后 Phase 3 -> Phase 4 的验证是否仍然正常、回退后 stepIteration 是否正确重置、回退后 approachState 清空后不影响 Phase 3 的 approach plan 机制。
  - 修复建议: Task 14 的完成标准中增加以下测试场景：(1) 回退后 stepIteration 确认为 0；(2) 回退后 approachState 确认为 null；(3) 回退后从 Phase 3 成功推进到 Phase 4、再到 Phase 8 的完整路径测试（计划中的 P2-3 已部分覆盖，但需确认包含 approachState 的验证）。

- **P1-4: Task 6 Step 8a 的 git 命令执行方式未说明** -- `validateStep` 当前所有 case 都是文件读取 + 内容检查，不涉及 shell 命令执行。Step 8a 需要执行 `git log --oneline --branches --not --remotes`，这是 validateStep 中首次引入 shell 命令调用。计划没有说明使用什么机制执行（`execFile`? `child_process.exec`?）以及错误处理（git 命令失败怎么办）。
  - 修复建议: Task 6 描述中补充：(1) 使用 orchestrator.ts 已有的 `execFile` import 执行 git 命令；(2) git 命令执行失败时（如不在 git repo 中）应返回 `passed: false` 并在 feedback 中说明错误原因；(3) 设置合理的超时（如 10 秒）。

## P2 (优化建议)

- **P2-1: Task 12 prompt 模板的 verifyConfig 嵌套变量渲染** -- phase8-ship.md 需要渲染 `verifyConfig` 中的嵌套字段（`endpoint`、`logPath`、`sshHost` 等），但现有的 `TemplateRenderer` 是否支持嵌套变量（如 `{{verifyConfig.endpoint}}`）没有在计划中确认。建议 Task 12 先确认 TemplateRenderer 的能力，如不支持嵌套则需要在 Task 11 中将嵌套字段打平后传入 variables。

- **P2-2: Task 13 和 Task 15 合并建议** -- 两个 Task 都写入同一个文件 `ship-integration.test.ts`，且都依赖 phase-enforcer 的变更。可以合并为一个 Task 以减少上下文切换。

- **P2-3: Task 16 可前置部分检查** -- "检查 STEP_ORDER 长度相关的断言"这个步骤可以在 Task 4 完成后就立即执行，不必等到最后。建议 Task 4 的完成标准中就包含"检查并更新现有测试中 STEP_ORDER 长度硬编码断言"。

- **P2-4: 缺少 1c/2c 步骤在 STEP_ORDER 中的说明** -- 当前代码 `STEP_AGENTS` 中有 "1c" 和 "2c" 的映射，但 `STEP_ORDER` 中没有这两个步骤（它们是审查修订循环中动态产生的）。计划正确地只在 STEP_ORDER 末尾追加 8a-8d，但 Task 4 完成标准中写"STEP_ORDER 长度从 10 变为 14"，这是正确的。仅作为提醒：5c 也在 STEP_AGENTS 中但不在 STEP_ORDER 中，确认 8a-8d 不存在类似的动态步骤需求。

## Coverage Matrix

| 设计章节/功能点 | 对应任务 | 覆盖状态 |
|----------------|---------|---------|
| 4.1 StateJsonSchema 新增 8 个字段 | Task 1 | OK |
| 4.1 InitInputSchema 新增 7 个参数 | Task 2 | OK |
| 4.1 auto_dev_init ship=true 时 deployTarget 必填校验 | Task 3 | OK |
| 4.1 auto_dev_init behaviorUpdates 写入 ship 字段 | Task 3 | OK |
| 4.2 STEP_ORDER 追加 8a-8d | Task 4 | OK |
| 4.2 STEP_AGENTS 新增 8a-8d -> auto-dev-developer | Task 4 | OK |
| 4.2 firstStepForPhase 新增 8: "8a" | Task 4 | OK |
| 4.2 PHASE_SEQUENCE 不改，运行时动态追加 | Task 5 | OK |
| 4.2 validateStep 新增 8a case (git unpushed) | Task 6 | OK |
| 4.2 validateStep 新增 8b case (build result) | Task 6 | OK |
| 4.2 validateStep 新增 8c case (deploy result) | Task 6 | OK |
| 4.2 validateStep 新增 8d case (verify + CODE_BUG/ENV_ISSUE) | Task 6 | OK |
| 4.2 regressToPhase 回退逻辑 + shipRound 递增 + ESCALATE | Task 7 | OK |
| 4.3 PHASE_META 新增 8 | Task 8 | OK |
| 4.3 computeNextDirective maxPhase 感知 ship | Task 9 | OK |
| 4.3 validateCompletion 新增 ship 参数 | Task 10 | OK |
| 4.4 auto_dev_init tool schema 新增参数 | Task 3 | OK |
| 4.4 auto_dev_complete 传 ship 参数 | Task 10 | OK |
| 4.5 phase8-ship.md prompt 模板 | Task 12 | OK |
| 4.5 buildTaskForStep 新增 8a-8d 处理 | Task 11 | OK |
| 5.1 SKILL.md 修改（ship 参数说明） | -- | **MISSING** |
| 验收标准 AC-1 ~ AC-3 (init 参数) | Task 13 | OK |
| 验收标准 AC-4 ~ AC-5 (phases 列表) | Task 14 | OK |
| 验收标准 AC-6 ~ AC-10 (step 验证 + 回退) | Task 14 | OK |
| 验收标准 AC-11 (validateCompletion) | Task 13 | OK |
| 验收标准 AC-12 (不触发 tribunal) | Task 6, Task 14 | OK |
| 验收标准 AC-13 (prompt 模板渲染) | Task 11, Task 12 | OK |
| 编译回归验证 | Task 16 | OK |

## 结论

**NEEDS_REVISION**

存在 1 个 P0 问题（SKILL.md 更新任务缺失）和 4 个 P1 问题（computeNextDirective 读取方式不明确、buildTaskForStep 传参机制不明确、regressToPhase 路径首次激活需增强测试、Step 8a git 命令执行机制未说明）。修复后可 PASS。

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

