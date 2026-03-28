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
