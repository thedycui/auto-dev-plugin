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
 docs/auto-dev/_global/lessons-global.json          |     40 +-
 mcp/dist/lessons-constants.js                      |      4 +
 mcp/dist/lessons-constants.js.map                  |      2 +-
 mcp/dist/orchestrator.js                           |     14 +
 mcp/dist/orchestrator.js.map                       |      2 +-
 mcp/dist/retrospective.js                          |     10 +-
 mcp/dist/retrospective.js.map                      |      2 +-
 mcp/dist/tribunal.js                               |     69 +-
 mcp/dist/tribunal.js.map                           |      2 +-
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
 mcp/src/__tests__/orchestrator.test.ts             |     95 +-
 mcp/src/__tests__/tribunal.test.ts                 |    194 +
 mcp/src/orchestrator.ts                            |     14 +
 mcp/src/tribunal.ts                                |    103 +-
 46 files changed, 513 insertions(+), 395329 deletions(-)

Untracked new files:
 docs/ROADMAP.md (new file)
 docs/auto-dev/20260330-1355-tribunal-crash-observability/approach-plan.md (new file)
 docs/auto-dev/20260330-1355-tribunal-crash-observability/code-review.md (new file)
 docs/auto-dev/20260330-1355-tribunal-crash-observability/design-review.md (new file)
 docs/auto-dev/20260330-1355-tribunal-crash-observability/design.md (new file)
 docs/auto-dev/20260330-1355-tribunal-crash-observability/plan-review.md (new file)
 docs/auto-dev/20260330-1355-tribunal-crash-observability/plan.md (new file)
 docs/auto-dev/20260330-1355-tribunal-crash-observability/progress-log.md (new file)
 docs/auto-dev/20260330-1355-tribunal-crash-observability/state.json (new file)
 docs/auto-dev/tribunal-crash-observability (new file)
 docs/design-review-enhancement.md (new file)
 docs/docs/auto-dev/_global/lessons-global.json (new file)
 mcp/dist/__tests__/improvements.test.js (new file)
 mcp/dist/__tests__/improvements.test.js.map (new file)
 mcp/npm (new file)
 notes/2026-02-28-work-summary.md (new file)
 notes/2026-03-01-work-summary.md (new file)
 notes/2026-03-02-work-summary.md (new file)
 notes/2026-03-03-work-summary.md (new file)
 notes/2026-03-04-work-summary.md (new file)
 notes/2026-03-05-work-summary.md (new file)
 notes/2026-03-06-work-summary.md (new file)
 notes/2026-03-09-work-summary.md (new file)
 notes/2026-03-10-work-summary.md (new file)
 notes/2026-03-11-work-summary.md (new file)
 notes/2026-03-12-work-summary.md (new file)
 notes/2026-03-13-work-summary.md (new file)
 notes/2026-03-16-work-summary.md (new file)
 notes/2026-03-17-work-summary.md (new file)
 notes/2026-03-18-work-summary.md (new file)
 notes/2026-03-19-work-summary.md (new file)
 notes/2026-03-20-work-summary.md (new file)
 notes/2026-03-23-work-summary.md (new file)
 notes/2026-03-24-work-summary.md (new file)
 notes/2026-03-25-work-summary.md (new file)
 notes/2026-03-26-work-summary.md (new file)
 notes/2026-03-27-work-summary 2.md (new file)
 notes/2026-03-27-work-summary.md (new file)
 notes/2026-03-28-work-summary.md (new file)
 notes/2026-03-30-work-summary.md (new file)

```

## Phase 1 设计评审
```
# Design Review

**Topic**: tribunal-crash-observability
**审查日期**: 2026-03-30
**审查文档**: `docs/auto-dev/tribunal-crash-observability/design.md`

---

## P0 (阻塞性问题)

### P0-1: evaluateTribunal 中无法调用 appendToProgressLog — 违反纯函数契约

**问题**: 设计文档第 4.5 节提出在 `evaluateTribunal` 的 `crashed === true` 分支（L766-768）中调用 `appendToProgressLog` 写入 progress-log。但 `evaluateTribunal` 是一个**纯函数**（代码注释 L677 `Pure Tribunal Evaluation (no state side effects)`、L707 `runs tribunal and returns verdict WITHOUT writing any state`），它不接受 `StateManager` 参数，无法访问 `appendToProgressLog` 方法。

`appendToProgressLog` 是 `StateManager` 类的实例方法（`state-manager.ts:553`），需要 `StateManager` 实例才能调用。`evaluateTribunal` 的签名是 `(projectRoot, outputDir, phase, topic, summary, startCommit?)`，不包含 `StateManager` 参数。

**grep 证据**:
- `tribunal.ts:677` 注释: `Pure Tribunal Evaluation (no state side effects)`
- `tribunal.ts:707` 注释: `runs tribunal and returns verdict WITHOUT writing any state`
- `state-manager.ts:553` 签名: `async appendToProgressLog(content: string): Promise<void>` — 属于 StateManager 类
- `tribunal.ts:712-718` evaluateTribunal 参数列表中无 StateManager

**修复建议**: 有两个可行方案:

- **方案 1（推荐）: 在 evaluateTribunal 中直接用 writeFile 追加 progress-log**。tribunal.ts 已经 import 了 `writeFile`（L15），且 evaluateTribunal 已经在使用 `writeFile` 写 `tribunal-phase{N}.md`（L748）。可以用 `readFile` + `writeFile` 模拟 append 行为，不引入 StateManager 依赖，也不改变纯函数性质（写 progress-log 是审计日志，不是状态变更）。但需注意与 StateManager 的 `atomicWrite`（temp-rename 模式）的一致性问题。

- **方案 2: 将 progress-log 写入移到 orchestrator.ts 的 crashed 处理分支中**。orchestrator.ts L956-972 已经处理了 `validation.tribunalResult.crashed`，且 orchestrator 持有 `sm: StateManager` 实例，可以直接调用 `sm.appendToProgressLog`。这样 evaluateTribunal 保持纯函数不变，将 audit 写入的职责上移到 orchestrator。这更符合当前的架构分层。

---

## P1 (重要问题)

### P1-1: runTribunalWithRetryCli 中解析 raw 字段获取 crashInfo 存在数据流断裂

**问题**: 设计文档第 4.3 节提出在 `runTribunalWithRetryCli` 中从 `result.raw` 解析 `crashInfo.isRetryable`。但 `runTribunalWithRetryCli` 调用的是 `runTribunal`（L503），`runTribunal` 返回的是 `TribunalVerdict`。而 `TribunalVerdict.raw` 字段类型是 `string`（`types.ts:350`），设计要求在 error path 中将 `raw` 设为 `JSON.stringify({ crashInfo, stderrSnippet, errMessage })`（第 4.2 节）。

问题是：在非 error path（成功解析 JSON 或 JSON 解析失败）中，`raw` 会被设置为 `stdout`（原始 LLM 输出）。因此 `runTribunalWithRetryCli` 在读取 `result.raw` 做 `JSON.parse` 时，需要先确认这是 crash path 的 raw 还是正常 path 的 raw。

但 `runTribunalWithRetryCli` 当前用 `CRASH_INDICATORS`（L278, 包含 `"裁决进程执行失败"`）来判断是否 crash，这个判断发生在 raw 解析之前（L514-516）。所以在 `isCrash === true` 的分支中，`result.raw` 确实是 error path 设置的 JSON。然而，设计要求 crashInfo 中的 `stderrSnippet` 字段同时存在于 `crashInfo` 对象内和顶层 `stderrSnippet` 字段（第 4.2 节: `JSON.stringify({ crashInfo, stderrSnippet, errMessage })`），这是冗余的，且顶层 `stderrSnippet` 会被 `crashInfo.stderrSnippet` 覆盖。

**修复建议**: 统一 `raw` 中的 JSON 结构为 `{ crashInfo, errMessage }`，不要在顶层再加 `stderrSnippet`（因为 `crashInfo` 内已含 `stderrSnippet`）。在 `runTribunalWithRetryCli` 中用 try-catch 包裹 `JSON.parse(result.raw)` 时，添加注释说明只在 `isCrash === true` 分支中执行此解析。

### P1-2: 设计未覆盖 executeTribunal（deprecated 路径）的同类改进

**问题**: 设计文档只修改了 `evaluateTribunal` 的 crashed 分支写 progress-log，但 `executeTribunal`（L819-930，deprecated 但仍在使用）也有同样的 crashed 分支（L853-863），且此路径不会经过 orchestrator。`executeTribunal` 被 `index.ts:1811` 直接调用（legacy 路径），如果只改 evaluateTribunal 不改 executeTribunal，legacy 用户看不到任何改进。

**grep 证据**:
- `index.ts:1811`: `const tribunalResult = await executeTribunal(...)` — legacy 路径仍在使用
- `tribunal.ts:853-863`: executeTribunal 的 crashed 分支直接返回 TRIBUNAL_PENDING

**修复建议**: 设计应明确说明 executeTribunal 的处理策略：
- 如果认为 legacy 路径不再重要，在设计中注明 "executeTribunal 为 deprecated，不在本次改进范围内"
- 如果认为应该覆盖，则需要在 executeTribunal 的 crashed 分支中也写入 TRIBUNAL_CRASH 事件

### P1-3: tryRunViaHub catch 块的 console.warn 在 MCP server 环境中可能不可见

**问题**: 设计文档第 4.4 节提出在 `tryRunViaHub` 的 catch 块中添加 `console.warn`。但 auto-dev 以 MCP server 方式运行时，`console.warn/stderr` 的输出目标取决于宿主进程（Claude Code、Cursor 等）。设计声称 "MCP server 的 stderr 会显示在宿主进程日志中"，但这一点未经验证。如果宿主进程不捕获 MCP server 的 stderr，这些诊断信息仍然会丢失。

**修复建议**: 除了 `console.warn` 外，建议同时将 hub 失败信息写入一个独立的 audit 文件（如 `tribunal-hub-failures.log`），或在 `TribunalVerdict.raw` 中追加 hub 错误信息。这样即使 stderr 不可见，信息也不会丢失。

---

## P2 (优化建议)

### P2-1: TribunalCrashInfo 可考虑扩展 errorCategory 联合类型

当前 `errorCategory` 是 7 个字符串字面量组成的联合类型。考虑到后续迭代可能新增分类，建议使用 `string` 基础类型或定义常量枚举，避免每次新增分类时都需修改类型定义。不过这不是阻塞性问题，当前设计已足够。

### P2-2: stderrSnippet 截取 500 字符的边界处理

设计中提到截取前 500 字符，但没有说明如何处理 UTF-8 多字节字符截断问题（在字符中间截断可能导致乱码）。建议使用 `stderr.slice(0, 500)` 替代 `stderr.substring(0, 500)`，或在截取后验证 UTF-8 完整性。由于实际场景中 stderr 内容多为 ASCII，此问题概率极低。

### P2-3: design.md 中行号偏移需更新

设计文档引用的行号与实际代码存在轻微偏差：

| 设计引用 | 实际位置 | 偏差 |
|---------|---------|------|
| `tribunal.ts:299-395` (`runTribunal`) | 实际 L299-395 | 正确 |
| `tribunal.ts:334` (`_stderr` 参数) | 实际 L334 | 正确 |
| `tribunal.ts:440-489` (`tryRunViaHub`) | 实际 L440-489 | 正确 |
| `tribunal.ts:486-488` (`catch {}`) | 实际 L486-488 | 正确 |
| `tribunal.ts:495-542` (`runTribunalWithRetryCli`) | 实际 L495-542 | 正确 |
| `tribunal.ts:528-536` (崩溃结果) | 实际 L527-537 | 偏移 1 行 |
| `tribunal.ts:712-808` (`evaluateTribunal`) | 实际 L712-808 | 正确 |
| `L766-768` (crashed 分支) | 实际 L766-768 | 正确 |

大部分行号准确，L528 偏差极小，不影响理解。

---

## 跨组件影响分析

### 步骤 A: 变更清单

| 序号 | 变更项 | 类型 |
|------|--------|------|
| 1 | `TribunalCrashInfo` 接口（新增） | 接口 |
| 2 | `classifyTribunalError()` 函数（新增） | 函数 |
| 3 | `runTribunal` callback 签名：`_stderr` -> `stderr` | 函数修改 |
... (truncated, 105 lines omitted)
```

## Phase 2 计划评审
```
# Plan Review: tribunal-crash-observability

**审查对象**: `plan.md`
**对照文档**: `design.md`
**日期**: 2026-03-30

---

## P0 (阻塞性问题)

### P0-1: Task 5 数据源缺失 -- evaluateTribunal crashed 分支未传递 crashInfo

**问题**: Task 5 计划在 `orchestrator.ts` 的 crashed 分支（L956-972）写入包含 `category`、`exitCode`、`retryable` 的 TRIBUNAL_CRASH progress-log 事件。但追踪完整数据流后发现，这些字段在到达 orchestrator 之前就已经丢失了。

**数据流追踪**:
1. `runTribunal` callback (Task 2) 将 crashInfo 写入 `verdict.raw`（JSON 格式） -- 正确
2. `runTribunalWithRetryCli` L527-537 在 crashed 分支返回 `{ verdict: {..., raw: result.raw}, crashed: true }` -- raw 保留
3. `evaluateTribunal` L766-768 在 crashed 分支返回 `{ verdict: "FAIL", issues: [], crashed: true, digest, digestHash }` -- **raw 字段被丢弃**
4. `EvalTribunalResult` 接口没有 `raw` 字段 -- 无法传递
5. orchestrator 通过 `validation.tribunalResult` 只能拿到 `crashed: true` + `digest` + `digestHash`

**结果**: Task 5 无法从 `validation.tribunalResult` 获取 crashInfo，写出的 TRIBUNAL_CRASH 事件只能包含 `phase` 和 `timestamp`，不包含 `category`、`exitCode`、`retryable`，直接违反设计文档 4.5 节的事件格式和 AC-9。

**修复建议**:
- 方案 A（推荐）: 在 `evaluateTribunal` L768 的 crashed 分支中，将 `verdict.raw`（含 crashInfo JSON）透传到 `EvalTribunalResult`。具体做法：在 `EvalTribunalResult` 接口中新增可选字段 `crashRaw?: string`，在 crashed 分支赋值为 `verdict.raw`。对应新增一个 Task（或合并到 Task 5），修改 `tribunal.ts` L768 和接口定义。
- 方案 B: 不修改 `EvalTribunalResult`，在 Task 5 中让 orchestrator 直接解析 `validation.tribunalResult.digest` 中是否包含 crashInfo。但 digest 是 tribunal 的输入材料，不是输出，不可行。

**影响范围**: `tribunal.ts` EvalTribunalResult 接口 + evaluateTribunal L768 + orchestrator.ts Task 5

---

## P1 (重要问题)

### P1-1: 依赖关系图 Task 4 -> Task 7 连线错误

**问题**: 依赖关系图中 `Task 4 (tryRunViaHub catch) ──> Task 7 (stderr 捕获测试)` 的连线是错误的。Task 7 描述的是测试 `runTribunal` 的 stderr 捕获和 crashInfo enrich（AC-5, AC-6），这属于 Task 2 的测试，不是 Task 4 的测试。Task 7 自身的依赖字段也明确标注为 "依赖: Task 2"。

**修复建议**: 将依赖关系图中的 `Task 4 ──> Task 7` 改为 `Task 2 ──> Task 7`（与 Task 7 的描述一致）。Task 4 只连接到 Task 10（tryRunViaHub 测试）。

### P1-2: Task 3 行号引用偏差

**问题**: Task 3 描述中引用 "修改 L514-524 的 isCrash 分支"，但根据源码，isCrash 检测在 L514-516，retry 判断在 L520-524。插入 isRetryable 检查的位置应在 L516 之后、L520 之前（即 `if (!isCrash)` 判断之后、`if (attempt < MAX_RETRIES)` 之前），而非 Task 描述的 "在 `attempt < MAX_RETRIES` 判断之前"。描述中的位置虽然与实际意图一致，但引用的行号范围不够精确，可能导致实现者误判插入点。

**修复建议**: 将 Task 3 的行号引用更新为更精确的 "L518-520 之间（isCrash 为 true 时、进入 retry 之前）"。

### P1-3: Task 7 描述与依赖图不一致

**问题**: Task 7 描述中写 "依赖: Task 2"，但依赖关系图画的是 `Task 4 ──> Task 7`。虽然 Task 7 实际确实依赖 Task 2（测试的是 Task 2 的 runTribunal stderr 捕获功能），但文字和图表的不一致会在执行时造成困惑。

**修复建议**: 这是 P1-1 的同一个问题的不同表现，修正 P1-1 即可消除此不一致。

---

## P2 (优化建议)

### P2-1: Task 5 的事件格式建议增加 crashInfo 可选字段

设计文档 4.5 节的事件格式为:
```
<!-- TRIBUNAL_CRASH phase=4 category="cli_not_found" exitCode=1 retryable=false timestamp=... -->
```

但 Task 5 的描述简化为:
```
<!-- TRIBUNAL_CRASH phase=N timestamp=ISO -->
```

在 P0-1 修复后，建议 Task 5 的描述恢复完整的事件格式，使 progress-log 事件包含 category、exitCode、retryable 字段，与设计文档一致。

### P2-2: 建议增加 integration/smoke test 任务

当前计划中 Task 11（回归验证）仅运行 `npm test`。考虑到 `classifyTribunalError` 和 retry isRetryable 逻辑对 tribunal 崩溃恢复的正确性至关重要，建议在 Task 11 中明确包含一个端到端验证步骤：设置 `TRIBUNAL_MODE=cli` 并 mock 一个不存在的 CLI 路径，验证 `isRetryable=false` 时不会产生 3 秒等待和不必要的重试。

### P2-3: Task 2 的 raw 字段序列化格式应在 Task 中明确

Task 2 描述中提到 "将 crashInfo 序列化后写入 raw 字段（JSON 格式）"，且 P1-1 修正为 `{ crashInfo, errMessage }`。但 Task 3 中解析 raw 的代码需要与 Task 2 的写入格式完全一致。建议在 Task 2 或 Task 3 中用代码注释标明 JSON 的 key 名称（如 `crashInfo` 和 `errMessage`），确保写入和解析两侧对齐。

---

## Coverage Matrix

| 设计章节/功能点 | 对应任务 | 覆盖状态 |
|----------------|---------|---------|
| 4.1 classifyTribunalError 函数 | Task 1 (实现) + Task 6 (测试) | 完整覆盖 |
| 4.2 runTribunal callback 修改 | Task 2 (实现) + Task 7 (测试) | 完整覆盖 |
| 4.3 runTribunalWithRetryCli isRetryable | Task 3 (实现) + Task 8 (测试) | 完整覆盖 |
| 4.4 tryRunViaHub catch 块修改 | Task 4 (实现) + Task 10 (测试) | 完整覆盖 |
| 4.5 evaluateTribunal 崩溃分支 -- progress-log | Task 5 (实现) + Task 9 (测试) | **不完整** (P0-1) |
| 4.6 数据流图 (crashInfo 传递链) | Task 1-5 串联 | **断裂** (P0-1) |
| AC-1 ENOENT 分类 | Task 6 | 覆盖 |
| AC-2 prompt_too_long 分类 | Task 6 | 覆盖 |
| AC-3 oom_killed 分类 | Task 6 | 覆盖 |
| AC-4 unknown 分类 | Task 6 | 覆盖 |
| AC-5 description 含错误类别 | Task 7 | 覆盖 |
| AC-6 raw 是合法 JSON | Task 7 | 覆盖 |
| AC-7 isRetryable=false 不重试 | Task 8 | 覆盖 |
| AC-8 isRetryable=true 重试 | Task 8 | 覆盖 |
| AC-9 progress-log 含 TRIBUNAL_CRASH | Task 9 | **部分覆盖** (P0-1: 缺少 category/exitCode/retryable) |
| AC-10 tryRunViaHub 返回 null | Task 10 | 覆盖 |
| AC-11 全量测试通过 | Task 11 | 覆盖 |
... (truncated, 16 lines omitted)
```

## 主 Agent 的代码审查
```
# Code Review: tribunal-crash-observability

**审查日期**: 2026-03-30
**审查范围**: tribunal.ts, orchestrator.ts, tribunal.test.ts
**审查行数**: ~200 行变更（tribunal.ts ~120 行, orchestrator.ts ~15 行, tribunal.test.ts ~65 行）
**审查文件数**: 3 个文件

---

## Must-Execute Rule 1: Caller-Side Review

### classifyTribunalError 调用方追踪

**grep 结果**:

| 调用位置 | 用途 | 验证结果 |
|---------|------|---------|
| `tribunal.ts:406` (runTribunal callback) | 生成 crashInfo，序列化到 raw 字段 | 正确 -- crashInfo 被正确序列化为 JSON 并写入 `raw` |
| `tribunal.test.ts:1412-1493` (16 个测试用例) | 单元测试 classifyTribunalError 的 7 种分类 | 正确 -- 覆盖 AC-1 到 AC-4 |

### crashRaw 字段消费方追踪

**grep 结果**:

| 消费位置 | 读取方式 | 验证结果 |
|---------|---------|---------|
| `tribunal.ts:863` (evaluateTribunal) | `verdict.raw` 透传到 `crashRaw` | 正确 -- `raw` 是 `classifyTribunalError` 生成的 JSON |
| `orchestrator.ts:959` (computeNextTask) | `validation.tribunalResult.crashRaw` | **发现问题** -- 见下方 P0 |

### TRIBUNAL_CRASH progress-log 事件消费方追踪

**grep 结果**:

| 消费位置 | 用途 | 验证结果 |
|---------|------|---------|
| `orchestrator.ts:960-968` (computeNextTask) | 写入 progress-log.md | 正确 -- best-effort try-catch，不阻塞主流程 |
| `retrospective-data.ts` | 解析 TRIBUNAL_CRASH 事件 | **未实现** -- 当前不解析 TRIBUNAL_CRASH 事件，设计文档也注明"后续迭代" |

### isRetryable 字段消费方追踪

**grep 结果**:

| 消费位置 | 用途 | 验证结果 |
|---------|------|---------|
| `tribunal.ts:594-600` (runTribunalWithRetryCli) | 解析 crashInfo.isRetryable 决定是否重试 | 正确 -- JSON.parse fallback 到 isRetryable=true |
| `orchestrator.ts:965` (computeNextTask) | 写入 progress-log 的 retryable 属性 | 正确 -- 但 exitCode 可能为字符串（见 P0） |

---

## Must-Execute Rule 2: Dormant Path Detection

| 代码路径 | 翔状态 | 风险等级 | 说明 |
|---------|------|---------|------|
| `runTribunal` error callback (L404-412) | **首次激活** | **P1** | 本次改动首次让 classifyTribunalError + crashInfo enrich 路径被执行。之前的 `runTribunal` 只返回原始 err.message，现在额外做了 classifyTribunalError + JSON.stringify 并写入 raw。 已有测试覆盖。 |
| `runTribunalWithRetryCli` isRetryable 检查 (L594-600) | **首次激活** | **P1** | 之前 isCrash 后一律重试 2 次。现在新增了 JSON.parse(raw).crashInfo.isRetryable 分支。 已有测试覆盖. |
| `tryRunViaHub` catch 块 console.warn (L557-560) | **首次激活** | **P2** | 之前 catch {} 静默吞异常, 緻加了 console.warn. 无直接测试验证 console.warn 被调用. |
| `orchestrator.ts` crashed 分支 TRIBUNAL_CRASH 写入 (L957-969) | **首次激活** | **P1** | 之前 crashed 分支只做了 atomicUpdate + 返回 escalation. 緻加了 appendToProgressLog(crashEvent) 调用. 无直接测试验证 progress-log 内容. |

---

## P0 (阻塞性问题)

### P0-1: exitCode 字段传入的是 Node.js error code (字符串) 而非进程 exit code (数字)

 类型不匹配

**文件**: `mcp/src/tribunal.ts` L406

**问题**: `classifyTribunalError(err, stderr, (err as any)?.code)` 中， `(err as any)?.code` 返回的是 Node.js 的 error code（如 `"ENOENT"`, `"EPERM"` 等字符串），而不是进程 exit code（数字）。

- `TribunalCrashInfo.exitCode` 类型定义为 `number | undefined`
- 当 `err.code === "ENOENT"` 时, exitCode 会收到字符串 `"ENOENT"` 而不是数字 `null` 或 `undefined`
- `orchestrator.ts` L965 使用 `ci.exitCode ?? "N/A"` 输出到 progress-log, 当 `exitCode` 是 `"ENOENT"` 时, progress-log 中会显示 `exitCode="ENOENT"` 而非预期的数字

**修复建议**:
```typescript
// tribunal.ts L406: 将 (err as any)?.code 改为正确的 exit code 揥取方式
const crashInfo = classifyTribunalError(err, stderr, undefined);
// Node.js exec callback 没有直接的 exit code 属性。
// err.code 是 Node.js 系统错误码(如 "ENOENT"), 不是 exit code.
// 如需 exit code, 需通过 err.exitCode (在某些 exec 实现中存在) 或其他方式获取.
```

**严重程度**: 中等 -- 不会导致运行时崩溃（`TribunalCrashInfo.exitCode` 是 `number | undefined` 类型, 传入字符串不会引发类型错误, 但语义错误, 且 progress-log 中显示 `exitCode="ENOENT"` 不可读).

### P0-2: TribunalCrashInfo 接口定义缺少 isRetryable 字段

**文件**: `mcp/src/tribunal.ts` L283-301

**问题**: `TribunalCrashInfo` interface 中定义了 `errorCategory`, `isRetryable`, `exitCode`, `stderrSnippet`, `errMessage` 五个字段, 但在接口声明中 `isRetryable` 的 JSDoc 注释说 "Whether retrying..." 却实际在字段列表中存在. 经过重新检查, 接口定义是正确的 -- `isRetryable: boolean` 确实存在于接口中 (L294).

  ****更新**: 重新检查后, 接口定义中 `isRetryable: boolean` 确实存在 (L294). 这个问题不存在. **撤回此 P0**。

---

## P1 (重要问题)

### P1-1: issues[0].description 未包含错误类别和 exit code 信息

**文件**: `mcp/src/tribunal.ts` L409
... (truncated, 130 lines omitted)
```

## 关键代码变更
```diff
diff --git a/docs/auto-dev/_global/lessons-global.json b/docs/auto-dev/_global/lessons-global.json
index f06ba16..842a19f 100644
--- a/docs/auto-dev/_global/lessons-global.json
+++ b/docs/auto-dev/_global/lessons-global.json
@@ -7,9 +7,9 @@
     "lesson": "Phase 1 required revision",
     "topic": "lessons-evolution",
     "reusable": true,
-    "appliedCount": 26,
+    "appliedCount": 27,
     "timestamp": "2026-03-25T09:48:52.283Z",
-    "lastAppliedAt": "2026-03-26T15:04:43.596Z",
+    "lastAppliedAt": "2026-03-30T07:42:01.430Z",
     "score": 33,
     "feedbackHistory": [
       {
@@ -234,9 +234,9 @@
     "context": "Design review v1 found getGlobalLessons() missing writeAtomic() after retirement pass. Fixed in v2 by adding explicit persist step. This is a classic \"read-modify but forget to write\" pattern in lazy evaluation designs.",
     "topic": "lessons-evolution",
     "reusable": true,
-    "appliedCount": 26,
+    "appliedCount": 27,
     "timestamp": "2026-03-25T09:34:30.919Z",
-    "lastAppliedAt": "2026-03-26T15:04:43.596Z",
+    "lastAppliedAt": "2026-03-30T07:42:01.430Z",
     "score": 5,
     "feedbackHistory": [
       {
@@ -353,9 +353,9 @@
     "context": "Design review v1 caught this by tracing preflight injection path (local + global) against feedback search path (local only). Fixed by dual-file search in feedback(). Textbook violation of Rule 1: \"not only review the producer, must review the consumer.\"",
     "topic": "lessons-evolution",
     "reusable": true,
-    "appliedCount": 26,
+    "appliedCount": 27,
     "timestamp": "2026-03-25T09:34:36.026Z",
-    "lastAppliedAt": "2026-03-26T15:04:43.596Z",
+    "lastAppliedAt": "2026-03-30T07:42:01.430Z",
     "score": 21,
     "feedbackHistory": [
       {
@@ -472,9 +472,9 @@
     "context": "checkpoint returns mandate from computeNextDirective() for normal flow. Adding a second mandate for lesson feedback would confuse the agent consumer. Fixed by using feedbackInstruction as the field name.",
     "topic": "lessons-evolution",
     "reusable": true,
-    "appliedCount": 26,
+    "appliedCount": 27,
     "timestamp": "2026-03-25T09:34:40.844Z",
-    "lastAppliedAt": "2026-03-26T15:04:43.596Z",
+    "lastAppliedAt": "2026-03-30T07:42:01.430Z",
     "score": 25,
     "feedbackHistory": [
       {
@@ -591,9 +591,9 @@
     "context": "Phase 3 ran from 08:48 to 09:18 (30 minutes) for 7 tasks. Zero rework. Design iteration in Phase 1 (08:06 to 08:30, two rounds) paid off by preventing implementation-phase surprises.",
     "topic": "lessons-evolution",
     "reusable": true,
-    "appliedCount": 14,
+    "appliedCount": 15,
     "timestamp": "2026-03-25T09:34:51.701Z",
-    "lastAppliedAt": "2026-03-26T15:04:43.596Z",
+    "lastAppliedAt": "2026-03-30T07:42:01.430Z",
     "score": 14,
     "feedbackHistory": [
       {
@@ -715,9 +715,9 @@
     "context": "types.ts uses optional Zod fields, lessons-constants.ts provides ensureDefaults() that fills score/feedbackHistory/retired. Tests #1-6 explicitly verify legacy entries get correct defaults.",
     "topic": "lessons-evolution",
     "reusable": true,
-    "appliedCount": 23,
+    "appliedCount": 24,
     "timestamp": "2026-03-25T09:35:01.447Z",
-    "lastAppliedAt": "2026-03-26T15:04:43.596Z",
+    "lastAppliedAt": "2026-03-30T07:42:01.430Z",
     "score": 17,
     "feedbackHistory": [
       {
@@ -816,9 +816,9 @@
     "context": "Phase 1: 08:06 -> 08:13 (v1 review, NEEDS_REVISION) -> 08:30 (v2 review, PASS). Total 24 min. Without this, P0-1 (phantom pool) and P0-2 (silent feedback loss) would have been runtime bugs.",
     "topic": "lessons-evolution",
     "reusable": true,
-    "appliedCount": 26,
+    "appliedCount": 27,
     "timestamp": "2026-03-25T09:35:18.769Z",
-    "lastAppliedAt": "2026-03-26T15:04:43.596Z",
+    "lastAppliedAt": "2026-03-30T07:42:01.430Z",
     "score": 41,
     "feedbackHistory": [
       {
@@ -935,9 +935,9 @@
     "context": "Phase 5 ran 09:23 to 09:30 (7 min). Code review (Phase 4) had already flagged AC-1/2/9 as coverage gaps. Phase 5 closed them with 5 integration tests (#31-35). The gap was predictable -- future plans should include handler-level test tasks.",
     "topic": "lessons-evolution",
     "reusable": true,
-    "appliedCount": 26,
+    "appliedCount": 27,
     "timestamp": "2026-03-25T09:35:24.844Z",
-    "lastAppliedAt": "2026-03-26T15:04:43.596Z",
+    "lastAppliedAt": "2026-03-30T07:42:01.430Z",
     "score": 25,
     "feedbackHistory": [
       {
... (truncated, 25 lines omitted)
diff --git a/mcp/src/orchestrator.ts b/mcp/src/orchestrator.ts
index e97570c..77f7209 100644
--- a/mcp/src/orchestrator.ts
+++ b/mcp/src/orchestrator.ts
@@ -954,6 +954,20 @@ export async function computeNextTask(
 
       // Crashed tribunal → full fallback needed (process-level failure)
       if (validation.tribunalResult.crashed) {
+        // Task 5: Write TRIBUNAL_CRASH event to progress-log for observability
+        try {
+          const crashRaw = validation.tribunalResult.crashRaw;
+          let crashEvent = `<!-- TRIBUNAL_CRASH phase=${state.phase} -->`;
+          if (crashRaw) {
+            const parsed = JSON.parse(crashRaw);
+            if (parsed.crashInfo) {
+              const ci = parsed.crashInfo;
+              crashEvent = `<!-- TRIBUNAL_CRASH phase=${state.phase} category="${ci.errorCategory}" exitCode="${ci.exitCode ?? "N/A"}" retryable="${ci.isRetryable}" -->`;
+            }
+          }
+          await sm.appendToProgressLog(crashEvent);
+        } catch { /* best-effort — don't block on logging failure */ }
+
         await sm.atomicUpdate({
           tribunalSubmits: { ...submits, [phaseKey]: count },
         });

diff --git a/mcp/src/tribunal.ts b/mcp/src/tribunal.ts
index c31bfc8..abedcb4 100644
--- a/mcp/src/tribunal.ts
+++ b/mcp/src/tribunal.ts
@@ -273,6 +273,75 @@ export async function prepareTribunalInput(
 // Tribunal Invocation
 // ---------------------------------------------------------------------------
 
+// ---------------------------------------------------------------------------
+// Crash Classification (pure function)
+// ---------------------------------------------------------------------------
+
+/**
+ * Structured crash information extracted from tribunal process failures.
+ */
+export interface TribunalCrashInfo {
+  /** One of 7 known error categories */
+  errorCategory:
+    | "ENOENT"
+    | "EPERM"
+    | "prompt-too-long"
+    | "timeout"
+    | "OOM"
+    | "cli-internal"
+    | "unknown";
+  /** Whether retrying the tribunal invocation might succeed */
+  isRetryable: boolean;
+  /** Process exit code (if available) */
+  exitCode?: number;
+  /** First 500 chars of stderr (if available) */
+  stderrSnippet?: string;
+  /** The original error message */
+  errMessage: string;
+}
+
+/**
+ * Classify a tribunal process error into one of 7 known fault categories.
+ * Pure function — no side effects.
+ *
+ * Categories and retryability:
+ * - ENOENT:  claude CLI binary not found (not retryable)
+ * - EPERM:   permission denied (not retryable)
+ * - prompt-too-long: prompt exceeds shell limits (not retryable)
+ * - timeout:  process exceeded time limit (retryable)
+ * - OOM:     out of memory (retryable)
+ * - cli-internal: internal CLI error (retryable)
+ * - unknown: uncategorized error (retryable by default)
+ */
+export function classifyTribunalError(
+  err: Error | string,
+  stderr?: string,
+  exitCode?: number,
+): TribunalCrashInfo {
+  const msg = typeof err === "string" ? err : err.message;
+
+  if (/ENOENT/i.test(msg)) {
+    return { errorCategory: "ENOENT", isRetryable: false, exitCode, stderrSnippet: stderr?.slice(0, 500), errMessage: msg };
+  }
+  if (/EPERM|EACCES/i.test(msg)) {
+    return { errorCategory: "EPERM", isRetryable: false, exitCode, stderrSnippet: stderr?.slice(0, 500), errMessage: msg };
+  }
+  if (/arg.*too long|argument list too long/i.test(msg) || /E2BIG/i.test(msg)) {
+    return { errorCategory: "prompt-too-long", isRetryable: false, exitCode, stderrSnippet: stderr?.slice(0, 500), errMessage: msg };
+  }
+  if (/timed?\s*out|timeout|SIGTERM|ETIMEDOUT/i.test(msg)) {
+    return { errorCategory: "timeout", isRetryable: true, exitCode, stderrSnippet: stderr?.slice(0, 500), errMessage: msg };
+  }
+  if (/OOM|out of memory|heap|ENOMEM/i.test(msg) || (stderr && /OOM|out of memory|heap|ENOMEM/i.test(stderr))) {
+    return { errorCategory: "OOM", isRetryable: true, exitCode, stderrSnippet: stderr?.slice(0, 500), errMessage: msg };
+  }
+  if (/internal|ECONNREFUSED|ECONNRESET|SIGKILL|SIGSEGV/i.test(msg) || (stderr && /internal|fatal|abort/i.test(stderr))) {
+    return { errorCategory: "cli-internal", isRetryable: true, exitCode, stderrSnippet: stderr?.slice(0, 500), errMessage: msg };
+  }
+
+  return { errorCategory: "unknown", isRetryable: true, exitCode, stderrSnippet: stderr?.slice(0, 500), errMessage: msg };
+}
+
 /** Known error strings that indicate a crash (not a legitimate verdict) */
 const CRASH_INDICATORS = [
   "裁决进程执行失败",
@@ -331,12 +400,14 @@ export async function runTribunal(
   };
 
   return new Promise<TribunalVerdict>((resolve) => {
-    const callback = (err: Error | null, stdout: string, _stderr: string) => {
+    const callback = (err: Error | null, stdout: string, stderr: string) => {
       if (err) {
+        // Task 2: Enrich crash info with classified error category
+        const crashInfo = classifyTribunalError(err, stderr, typeof (err as any)?.code === "number" ? (err as any).code : undefined);
         resolve({
           verdict: "FAIL",
           issues: [{ severity: "P0", description: `裁决进程执行失败: ${err.message}` }],
-          raw: err.message,
+          raw: JSON.stringify({ crashInfo, errMessage: err.message }),
         });
         return;
       }
@@ -483,7 +554,9 @@ async function tryRunViaHub(
       return data as TribunalVerdict;
     }
... (truncated, 54 lines omitted)
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

