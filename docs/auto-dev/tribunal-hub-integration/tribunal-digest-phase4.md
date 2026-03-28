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
 mcp/src/__tests__/orchestrator.test.ts             |    121 +
 mcp/src/__tests__/tribunal.test.ts                 |    125 +-
 mcp/src/git-manager.ts                             |     24 +-
 mcp/src/orchestrator.ts                            |     23 +
 mcp/src/tribunal.ts                                |    123 +-
 skills/auto-dev/SKILL.md                           |     20 +-
 46 files changed, 1346 insertions(+), 395326 deletions(-)

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
 docs/auto-dev/batch1-guard-optimization/approach-plan.md (new file)
 docs/auto-dev/batch1-guard-optimization/design-review.md (new file)
 docs/auto-dev/batch1-guard-optimization/design.md (new file)
 docs/auto-dev/batch1-guard-optimization/e2e-test-cases.md (new file)
 docs/auto-dev/batch1-guard-optimization/e2e-test-results.md (new file)
 docs/auto-dev/batch1-guard-optimization/plan-review.md (new file)
 docs/auto-dev/batch1-guard-optimization/plan.md (new file)
 docs/auto-dev/batch1-guard-optimization/progress-log.md (new file)
 docs/auto-dev/batch1-guard-optimization/state.json (new file)
 docs/auto-dev/batch1-guard-optimization/tribunal-digest-phase4.md (new file)
 docs/auto-dev/batch1-guard-optimization/tribunal-phase4.md (new file)
 docs/auto-dev/lessons-evolution.bak.2026-03-25T08-05-48-734Z/design.md (new file)
 docs/auto-dev/ship-integration/acceptance-report.md (new file)
... (116 more files omitted)
```

## Phase 1 设计评审
```
# Design Review

## P0 (阻塞性问题)

### P0-1: 设计引用了不存在的函数 `runStepValidation()`

设计文档 4.6 节和 AC-8 中多次引用 `runStepValidation()`，但代码中不存在该函数。实际执行 tribunal 结果处理的函数是 `validateStep()`（orchestrator.ts:464），由 `computeNextTask()` 在 orchestrator.ts:900 调用。

**修复建议**：将设计中所有 `runStepValidation()` 替换为 `validateStep()` + `computeNextTask()` 中的 tribunal 结果处理逻辑（orchestrator.ts:906-998）。AC-8 的描述也需同步修正。

### P0-2: `subagentRequested` 的消费路径未设计完整

设计提出在 `validateStep()` 返回的 `tribunalResult` 中新增 `subagentRequested` 字段，但未说明 `validateStep()` 自身如何产生这个字段。当前 `validateStep()` 的 case "4a"/"5b"/"6" 调用 `evaluateTribunal()` 后直接检查 `verdict === "PASS"`。如果 `evaluateTribunal()` 返回 `subagentRequested: true`，`verdict` 实际上会是什么值？

当前代码路径：
- `evaluateTribunal()` -> `runTribunalWithRetry()` -> `runTribunal()`
- 设计说 Level 2 时 `runTribunal()` 返回带 `_subagentMode: true` 标记的 TribunalVerdict
- `runTribunalWithRetry()` 检测到后返回 `{ verdict, crashed: false, subagentRequested: true }`
- 但 `evaluateTribunal()` 内部在 step 5b（641 行）只解构了 `{ verdict, crashed, rawParseFailure }`，不会识别 `subagentRequested`

**修复建议**：
1. 明确 `runTribunalWithRetry()` 返回类型新增 `subagentRequested?: boolean`
2. 明确 `evaluateTribunal()` 内部需要解构并传递 `subagentRequested`
3. 明确 `EvalTribunalResult` 新增 `subagentRequested?: boolean` 和 `digestPath?: string`
4. 明确 `validateStep()` 中 case "4a"/"5b"/"6" 如何将 `subagentRequested` 传递给 `computeNextTask()`（通过 `tribunalResult` 字段）
5. 补充完整数据流：`runTribunal` -> `runTribunalWithRetry` -> `evaluateTribunal` -> `validateStep` -> `computeNextTask` 每一层的字段传递

## P1 (重要问题)

### P1-1: `_subagentMode: true` 魔法标记破坏类型契约

设计提出 `runTribunal()` 在 Level 2 时返回"带 `_subagentMode: true` 内部标记的 TribunalVerdict"。这本质上是在类型系统之外传递信号，违反 TypeScript 类型安全原则。`TribunalVerdict` 类型定义中没有 `_subagentMode` 字段，下游代码（如 `crossValidate()`）可能对返回值做不符合预期的处理。

**修复建议**：`runTribunal()` 应返回扩展后的联合类型，例如 `TribunalVerdict | { subagentRequested: true }`，或者更简单地在 `runTribunal()` 返回值类型中显式新增 `subagentRequested` 字段，避免用 `_` 前缀的魔法属性。

### P1-2: escalation 接口缺少 `digestPath` 字段

设计 4.5 节 Subagent 模式数据流中，escalation 携带 `digestPath`。但当前 `NextTaskResult.escalation` 类型（orchestrator.ts:78-83）只有 `reason`、`lastFeedback`、`digest`、`digestHash`，没有 `digestPath`。

**修复建议**：在设计的改动范围表中明确：需要扩展 `NextTaskResult.escalation` 接口，新增 `digestPath?: string` 字段。同时需要确认 SKILL.md 中 escalation 处理逻辑需同步更新——当前 SKILL.md 对 escalation 的处理是"告知用户并 break"，而非自动启动 subagent。

### P1-3: SKILL.md 消费者端未适配 `tribunal_subagent` escalation

设计提出新增 `tribunal_subagent` escalation reason，但当前 SKILL.md（skills/auto-dev/SKILL.md:36-38）对所有 escalation 的处理都是"告知用户 + break"。如果不更新 SKILL.md，`tribunal_subagent` escalation 会导致流程中断而非自动启动 subagent 裁决。

旧的 SKILL.legacy.md 有 `TRIBUNAL_PENDING` 的自动 subagent 处理逻辑，但新的 SKILL.md 没有。

**修复建议**：
1. 在改动范围表中新增 `skills/auto-dev/SKILL.md` 的修改
2. SKILL.md 需要区分 `tribunal_subagent` escalation（自动启动 subagent）和其他 escalation（告知用户）
3. 或者在设计中明确：`tribunal_subagent` 不走 escalation 路径，而是由框架内部自动处理（类似 `tribunal_crashed` 在 `computeNextTask` 中自动产生 escalation）

### P1-4: Hub 模式下 `GET /commands/:id` 的授权约束未说明

Hub 的 `GET /commands/:id`（commands.ts:152-172）要求请求方必须是命令的 sender 或 receiver，否则返回 403。设计中 `executePrompt()` 方法负责发送命令并轮询，这意味着 hub-client 必须先通过 `ensureConnected()` 注册为 agent，才能作为 sender 轮询命令状态。

虽然设计流程中 `ensureConnected()` 在 `findTribunalWorker()` 之前调用（数据流图中已体现），但 `executePrompt()` 方法的设计中未明确说明"使用注册时获得的 token 进行后续 API 调用"的认证机制。

**修复建议**：在 HubClient 设计中明确 token 管理策略——注册时 Hub 返回 token（或使用 `TRIBUNAL_HUB_TOKEN` 预配置 token），后续所有 API 调用需要携带此 token 进行身份验证。

### P1-5: 默认行为从 CLI 变为 Subagent 是 breaking change，需要显式说明迁移风险

设计声称"完全向后兼容"，但默认行为从 CLI spawn（独立进程裁决）变为 Subagent（主 agent 上下文内裁决）。虽然 Subagent 更稳定，但两者有本质区别：
- CLI spawn 使用独立的 API key 额度
- Subagent 与主 agent 共享 API key 额度和上下文窗口
- Subagent 裁决在主 agent 上下文中执行，独立性弱于 CLI

这不是"向后兼容"，而是"向更好方向的 breaking change"。

**修复建议**：将兼容性描述从"完全向后兼容"修正为"默认行为变更（更稳定），可通过 `TRIBUNAL_MODE=cli` 恢复旧行为"。

## P2 (优化建议)

### P2-1: Hub 轮询间隔建议优化

设计的轮询间隔为 `1s, 2s, 3s, 5s, 5s, ...`，但裁决通常需要 2-5 分钟。建议前 10 次用 `2s, 3s, 5s, 5s, ...` 后稳定在 10s，减少无效轮询。

### P2-2: 预估改动量偏低

设计预估 `tribunal.ts` 改动 ~50 行，但需要修改 `runTribunal()`（三级策略选择）、`runTribunalWithRetry()`（新增 subagentRequested 传递）、`evaluateTribunal()`（新增 subagentRequested/digestPath 传递），再加上导入 hub-client 等，实际改动可能在 80-100 行。`orchestrator.ts` 需新增 `subagentRequested` 处理分支（类似 `crashed` 和 `rawParseFailure` 分支），实际改动也可能超过 20 行。

### P2-3: Worker 名称发现策略可增强

`findTribunalWorker()` 通过 `GET /agents?name=tribunal-worker` 精确匹配查找 worker。Hub 的 `GET /agents` 使用 `a.name === name` 做精确匹配。建议在设计中明确 worker 注册时必须使用的 name 值，或考虑支持 capability 过滤（Hub 已支持 `capability` 参数）。

## 跨组件影响分析

### 变更清单

| 序号 | 变更项 | 类型 |
|------|--------|------|
| 1 | `hub-client.ts` (新增) | 类/模块 |
| 2 | `runTribunal()` — 新增三级策略分支 | 函数 |
| 3 | `runTribunalWithRetry()` — 返回值新增 `subagentRequested` | 接口 |
| 4 | `EvalTribunalResult` — 新增 `subagentRequested`, `digestPath` 字段 | 接口 |
| 5 | `validateStep()` — 需传递 subagentRequested | 函数 |
| 6 | `computeNextTask()` — 新增 tribunal_subagent escalation 分支 | 函数 |
| 7 | `NextTaskResult.escalation` — 新增 `digestPath` 字段 | 接口 |
| 8 | 环境变量 `TRIBUNAL_HUB_URL`, `TRIBUNAL_HUB_TOKEN`, `TRIBUNAL_HUB_WORKER`, `TRIBUNAL_MODE` | 配置 |

... (truncated, 31 lines omitted)
```

## Phase 2 计划评审
```
# Plan Review

## P0 (阻塞性问题)

（无）

## P1 (重要问题)

- **P1-1: Task 4 改造 `runTribunal()` 返回类型不兼容**。当前 `runTribunal()` 返回 `Promise<TribunalVerdict>`，Task 4 描述"直接在 `runTribunal()` 层面用显式的 `subagentRequested` 字段传递信号"，但 `TribunalVerdict` 是 JSON Schema 定义的类型（用于 CLI --json-schema），不应该往里塞 `subagentRequested`。需要明确：(a) `runTribunal()` 的返回类型需要从 `Promise<TribunalVerdict>` 改为联合类型或新类型（如 `Promise<TribunalVerdict | { subagentRequested: true }>`），或者 (b) 在 `runTribunalWithRetry()` 中处理（Level 2 时 `runTribunal()` 不被调用，`runTribunalWithRetry()` 直接短路返回 `{ verdict: dummyVerdict, crashed: false, subagentRequested: true }`）。建议在 Task 4 描述中明确选择方案 (b)，即三级策略的分流逻辑放在 `runTribunalWithRetry()` 而非 `runTribunal()` 中，`runTribunal()` 只保持 CLI spawn 逻辑不变。

- **P1-2: Task 5 中 `subagentRequested=true` 时仍会执行 `prepareTribunalInput()` 和写 tribunal log**。`evaluateTribunal()` 的步骤 2（prepareTribunalInput）和步骤 4（写 tribunal log）在 `runTribunalWithRetry()` 之前/之后执行。如果 subagentRequested=true，步骤 4 的 `buildTribunalLog()` 会写入一个虚假的"FAIL"日志文件，干扰审计追踪。Task 5 应明确：当 `subagentRequested=true` 时，跳过步骤 4 的 log 写入（或写入明确标记"delegated to subagent"的 log）。digestPath 来自步骤 2 的 `prepareTribunalInput()`，这步仍然需要执行。

- **P1-3: Task 6 中 escalation 缺少 `lastFeedback` 字段**。观察 orchestrator.ts 中现有的 `tribunal_crashed` 和 `tribunal_parse_failure` escalation 都包含 `lastFeedback` 字段（分别为中文描述字符串）。Task 6 的完成标准只列出了 `reason, digestPath, digest, digestHash`，缺少 `lastFeedback`。这个字段会被 SKILL.md 中的 `result.escalation.feedback` 读取。建议补充 `lastFeedback` 字段，值如"裁决已委托给 subagent，请读取 digestPath 文件执行裁决后调用 auto_dev_tribunal_verdict 提交。"

- **P1-4: Task 7 SKILL.md 修改需更精确的处理逻辑描述**。当前 SKILL.md 中 escalation 处理是统一的"告知用户 + break"，Task 7 要求区分 `tribunal_subagent`。但 Task 7 完成标准只说"描述了 subagent 执行裁决的步骤"，没有具体说明 SKILL.md 中的伪代码/结构化指令应如何修改。建议在 Task 7 描述中给出目标代码片段的大致结构，例如将 `elif result.escalation:` 分支改为条件分支：`tribunal_subagent` -> 自动启动 subagent；其他 -> 告知用户 + break。同时需要说明 `tribunal_crashed` 现有的处理是否也应改为自动启动 subagent（因为新架构下 crashed 只有在 `TRIBUNAL_MODE=cli` 时才会出现）。

## P2 (优化建议)

- **P2-1: Task 3 HubClient 轮询起始间隔与设计文档不一致**。设计文档 4.4 节写的是"1s, 2s, 3s, 5s, 5s, ..."，Task 3 描述为"2s, 3s, 5s, 5s, ..."（跳过了 1s）。两者差异不大，但应保持一致。建议统一为 Task 3 中的版本（跳过 1s 起始更合理，因为 worker 不太可能 1 秒内完成裁决）。

- **P2-2: Task 12（接口签名不变性验证）作为独立任务价值低**。这本质上是一个 `npx tsc --noEmit` 检查，每个前置任务的完成标准都已包含 TypeScript 编译通过。建议合并到 Task 5 或 Task 6 的完成标准中，减少任务数。

- **P2-3: 关键路径标注过于线性**。概述中写"Task 1 -> Task 2 -> ... -> Task 10"是完全串行的，但依赖图明确显示 Task 1/2/3 可并行，Task 8 可与 Task 4 并行。建议修正关键路径为：`(Task 1 + Task 2 + Task 3) -> Task 4 -> Task 5 -> Task 6 -> Task 7`，并标注 Task 8/9/10/11 为测试并行组。

- **P2-4: 风险提示中提到的 ship-integration-e2e.test.ts 适配**。Task 11 提到需检查此文件，但没有提供其当前 mock 方式的具体分析。建议 Task 11 在描述中先列出需要检查的 mock 位置（grep `evaluateTribunal\|runTribunal\|execFile` 的结果），降低执行时的探索成本。

## Coverage Matrix

| 设计章节/功能点 | 对应任务 | 覆盖状态 |
|----------------|---------|----------|
| 4.1 三级执行策略 -- Level 1 (Hub) | Task 3, Task 4 | OK |
| 4.1 三级执行策略 -- Level 2 (Subagent 默认) | Task 4, Task 5 | OK |
| 4.1 三级执行策略 -- Level 3 (CLI opt-in) | Task 4 | OK |
| 4.2 环境变量 TRIBUNAL_HUB_URL | Task 3, Task 4 | OK |
| 4.2 环境变量 TRIBUNAL_HUB_TOKEN | Task 3 | OK |
| 4.2 环境变量 TRIBUNAL_HUB_WORKER | Task 3 | OK |
| 4.2 环境变量 TRIBUNAL_MODE | Task 4 | OK |
| 4.3 EvalTribunalResult 扩展 | Task 1 | OK |
| 4.3 runTribunalWithRetry 返回值扩展 | Task 1 | OK |
| 4.3 HubClient 模块 -- isAvailable() | Task 3 | OK |
| 4.3 HubClient 模块 -- ensureConnected() | Task 3 | OK |
| 4.3 HubClient 模块 -- findTribunalWorker() | Task 3 | OK |
| 4.3 HubClient 模块 -- executePrompt() | Task 3 | OK |
| 4.4 Hub 轮询策略（指数退避 + 600s 超时） | Task 3 | OK |
| 4.5 Hub 模式数据流 | Task 3, Task 4 | OK |
| 4.5 Subagent 模式数据流 | Task 5, Task 6, Task 7 | OK |
| 4.6 orchestrator 新增 subagentRequested 分支 | Task 6 | OK |
| 4.6 escalation reason: tribunal_subagent | Task 6, Task 7 | OK |
| 4.6 不计入 crash 计数 | Task 6 | OK |
| 4.6 携带 digestPath | Task 2, Task 6 | OK |
| AC-1 默认 subagent 模式 | Task 9 | OK |
| AC-2 Hub 执行成功 | Task 8, Task 9 | OK |
| AC-3 Hub 不可用降级 | Task 8, Task 9 | OK |
| AC-4 Worker 离线降级 | Task 8, Task 9 | OK |
| AC-5 CLI opt-in | Task 9 | OK |
| AC-6 轮询超时降级 | Task 8, Task 9 | OK |
| AC-7 ensureConnected 幂等 | Task 8 | OK |
| AC-8 orchestrator subagentRequested escalation | Task 10 | OK |
| AC-9 接口签名不变 | Task 12 | OK |
| 兼容性 -- 现有测试适配 | Task 11 | OK |
| 兼容性 -- TRIBUNAL_MODE=cli 回退 | Task 4, Task 9 | OK |

## 结论

**NEEDS_REVISION**

计划整体覆盖度完整，任务粒度合理，依赖关系清晰。需要修复 4 个 P1 问题：
1. Task 4 的返回类型兼容性方案需要明确（P1-1）
2. Task 5 需处理 subagentRequested 时的 tribunal log 写入问题（P1-2）
3. Task 6 的 escalation 需补充 lastFeedback 字段（P1-3）
4. Task 7 的 SKILL.md 修改指令需更精确（P1-4）

修复上述问题后可 PASS。

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

