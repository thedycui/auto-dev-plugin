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
