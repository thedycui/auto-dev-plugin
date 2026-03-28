# 端到端测试用例：裁决官三级执行策略（Hub 集成）

## 覆盖矩阵

| AC | 描述 | 测试用例 | 类型 | 状态 |
|----|------|---------|------|------|
| AC-1 | 默认 Subagent 模式，不调用 execFile | TC-T01, TC-T02 | UNIT | 已有 |
| AC-2 | Hub 模式完整流程 | TC-H01, TC-H02, TC-H03, TC-H04 | UNIT/INTEGRATION | 部分已有 |
| AC-3 | Hub 不可用自动降级 | TC-H05, TC-H06, TC-H07 | UNIT | 已有 |
| AC-4 | Worker 离线自动降级 | TC-H08, TC-H09 | UNIT | 已有 |
| AC-5 | TRIBUNAL_MODE=cli 走 CLI 路径 | TC-T03 | UNIT | 已有 |
| AC-6 | Hub 模式 Worker 超时降级 | TC-H10, TC-H11 | UNIT | 已有 |
| AC-7 | ensureConnected 幂等 | TC-H12, TC-H13 | UNIT | 已有 |
| AC-8 | orchestrator subagentRequested 分支 | TC-O01, TC-O02, TC-O03, TC-O04 | UNIT | 部分已有 |
| AC-9 | EvalTribunalResult 接口兼容性 | TC-I01, TC-I02 | UNIT | 需新增 |

## 1. HubClient 单元测试（hub-client.test.ts）

### 1.1 isAvailable

| ID | 用例名 | 前置条件 | 输入 | 预期结果 | 类型 | 状态 |
|----|--------|---------|------|---------|------|------|
| TC-H01 | Hub 正常响应返回 true | mock fetch 返回 200 | `client.isAvailable()` | 返回 `true`，fetch 调用 1 次，URL 为 `{baseUrl}/agents` | UNIT | 已有 |
| TC-H05 | 网络错误返回 false（AC-3） | mock fetch 抛出 `ECONNREFUSED` | `client.isAvailable()` | 返回 `false`，不抛异常 | UNIT | 已有 |
| TC-H06 | HTTP 500 返回 false | mock fetch 返回 status=500 | `client.isAvailable()` | 返回 `false` | UNIT | 已有 |
| TC-H07 | 超时 1s 后返回 false | mock fetch 延迟 2s 响应 | `client.isAvailable()` | 返回 `false`，AbortController 在 1s 后触发 abort | UNIT | **需新增** |

### 1.2 ensureConnected

| ID | 用例名 | 前置条件 | 输入 | 预期结果 | 类型 | 状态 |
|----|--------|---------|------|---------|------|------|
| TC-H12 | 注册成功返回 true | mock fetch 返回 `{ id: "agent-123" }` | `client.ensureConnected()` | 返回 `true`，POST 到 `/agents/register`，body 包含 `name: "auto-dev-tribunal-client"` | UNIT | 已有 |
| TC-H13 | 幂等性：连续调用 2 次只发 1 次请求（AC-7） | mock fetch 返回 200 | 连续两次 `client.ensureConnected()` | fetch 调用总计 1 次 | UNIT | 已有 |
| TC-H14 | 注册失败返回 false | mock fetch 返回 500 | `client.ensureConnected()` | 返回 `false`，`_registered` 保持 false | UNIT | 已有 |
| TC-H15 | 请求头携带 Bearer token | mock fetch，client token="test-token" | `client.ensureConnected()` | fetch 调用的 headers 包含 `Authorization: "Bearer test-token"` | UNIT | 已有 |
| TC-H16 | 空 token 不发 Authorization 头 | `new HubClient(url, "")` | `client.ensureConnected()` | fetch headers 中无 `Authorization` 字段 | UNIT | **需新增** |
| TC-H17 | 注册失败后重试可成功 | 第 1 次 fetch 返回 500，第 2 次返回 200 | 两次 `ensureConnected()` | 第 1 次返回 false，第 2 次返回 true，fetch 调用 2 次 | UNIT | **需新增** |

### 1.3 findTribunalWorker

| ID | 用例名 | 前置条件 | 输入 | 预期结果 | 类型 | 状态 |
|----|--------|---------|------|---------|------|------|
| TC-H08 | 找到在线 worker | mock 返回 `[{ id: "w1", status: "online" }]` | `client.findTribunalWorker()` | 返回 `{ id: "w1" }` | UNIT | 已有 |
| TC-H09 | 无 worker 返回 null（AC-4） | mock 返回 `[]` | `client.findTribunalWorker()` | 返回 `null` | UNIT | 已有 |
| TC-H18 | Worker 离线返回 null | mock 返回 `[{ id: "w1", status: "offline" }]` | `client.findTribunalWorker()` | 返回 `null` | UNIT | 已有 |
| TC-H19 | 网络错误返回 null | mock fetch 抛出 Error | `client.findTribunalWorker()` | 返回 `null`，不抛异常 | UNIT | 已有 |
| TC-H20 | 使用 TRIBUNAL_HUB_WORKER 环境变量 | `TRIBUNAL_HUB_WORKER=my-custom-worker` | `client.findTribunalWorker()` | fetch URL 包含 `name=my-custom-worker` | UNIT | 已有 |
| TC-H21 | 多个 worker 只返回第一个在线的 | mock 返回 `[{ status: "offline" }, { status: "online", id: "w2" }]` | `client.findTribunalWorker()` | 返回 `{ id: "w2" }` | UNIT | **需新增** |

### 1.4 executePrompt

| ID | 用例名 | 前置条件 | 输入 | 预期结果 | 类型 | 状态 |
|----|--------|---------|------|---------|------|------|
| TC-H02 | 发送命令并轮询到完成（AC-2） | mock POST /commands 返回 `{ id: "cmd-1" }`，GET /commands/cmd-1 第 1 次返回 `{ status: "completed", result: { verdict: "PASS", issues: [] } }` | `client.executePrompt("w1", "prompt", 30000)` | 返回 `{ verdict: "PASS", issues: [] }` | UNIT | 已有 |
| TC-H03 | 命令创建失败返回 null | mock POST /commands 返回 500 | `client.executePrompt("w1", "prompt", 5000)` | 返回 `null` | UNIT | 已有 |
| TC-H10 | 轮询超时返回 null（AC-6） | mock POST 返回 pending，GET 始终返回 `{ status: "pending" }`，timeout=100ms | `client.executePrompt("w1", "prompt", 100)` | 返回 `null` | UNIT | 已有 |
| TC-H22 | 命令被 rejected 返回 null | mock POST 返回 cmd，GET 返回 `{ status: "rejected" }` | `client.executePrompt("w1", "prompt", 30000)` | 返回 `null` | UNIT | 已有 |
| TC-H23 | 网络错误返回 null | mock fetch 始终抛出 Error | `client.executePrompt("w1", "prompt", 5000)` | 返回 `null`，不抛异常 | UNIT | 已有 |
| TC-H24 | 命令 expired 返回 null | mock POST 返回 cmd，GET 返回 `{ status: "expired" }` | `client.executePrompt("w1", "prompt", 30000)` | 返回 `null` | UNIT | **需新增** |
| TC-H25 | 轮询间隔递增策略（2s, 3s, 5s, 5s...） | mock 多次轮询后完成 | 观察轮询间隔 | 第 1 次间隔 2s，第 2 次 3s，第 3 次起稳定 5s | UNIT | **需新增**（可通过 spy setTimeout 验证） |
| TC-H26 | 轮询中途 GET 返回非 OK 继续轮询 | mock GET 第 1 次返回 500，第 2 次返回 completed | `client.executePrompt(...)` | 最终返回 completed 的 result | UNIT | **需新增** |

### 1.5 getHubClient 单例工厂

| ID | 用例名 | 前置条件 | 输入 | 预期结果 | 类型 | 状态 |
|----|--------|---------|------|---------|------|------|
| TC-H27 | TRIBUNAL_HUB_URL 未设置返回 null | 无环境变量 | `getHubClient()` | 返回 `null` | UNIT | **需新增** |
| TC-H28 | TRIBUNAL_HUB_URL 设置返回 HubClient 实例 | `TRIBUNAL_HUB_URL=http://localhost:3100` | `getHubClient()` | 返回非 null 的 HubClient 实例 | UNIT | **需新增** |
| TC-H29 | 连续调用返回同一实例（单例） | `TRIBUNAL_HUB_URL` 已设置 | 两次 `getHubClient()` | 两次返回同一对象引用 | UNIT | **需新增** |
| TC-H30 | resetHubClient 后重新创建 | 先 `getHubClient()`，再 `resetHubClient()` | 再次 `getHubClient()` | 返回新实例 | UNIT | **需新增** |

## 2. Tribunal 三级策略测试（tribunal.test.ts）

### 2.1 Level 2：Subagent 模式（默认）

| ID | 用例名 | 前置条件 | 输入 | 预期结果 | 类型 | 状态 |
|----|--------|---------|------|---------|------|------|
| TC-T01 | 默认模式返回 subagentRequested=true（AC-1） | 无 `TRIBUNAL_HUB_URL`、无 `TRIBUNAL_MODE` | `runTribunalWithRetry("digest", 5)` | 返回 `{ subagentRequested: true, crashed: false }`，execFile 未被调用 | UNIT | 已有 |
| TC-T02 | 默认模式的 verdict 字段 | 同上 | `runTribunalWithRetry("digest", 5)` | 返回 `verdict.verdict === "FAIL"`，`verdict.issues === []` | UNIT | **需新增**（验证 dummy verdict 结构完整） |

### 2.2 Level 3：CLI 模式

| ID | 用例名 | 前置条件 | 输入 | 预期结果 | 类型 | 状态 |
|----|--------|---------|------|---------|------|------|
| TC-T03 | TRIBUNAL_MODE=cli 调用 execFile（AC-5） | `TRIBUNAL_MODE=cli` | `runTribunalWithRetry("digest", 5)` | execFile 被调用，`subagentRequested` 为 undefined | UNIT | 已有 |
| TC-T04 | CLI 模式 crash 重试逻辑 | `TRIBUNAL_MODE=cli`，第 1 次 execFile crash，第 2 次正常 FAIL | `runTribunalWithRetry("digest", 5)` | execFile 调用 2 次，`crashed=false`，verdict 为 FAIL | UNIT | 已有 |
| TC-T05 | CLI 模式连续 crash 返回 crashed=true | `TRIBUNAL_MODE=cli`，execFile 始终 crash | `runTribunalWithRetry("digest", 5)` | `crashed=true`，issues 包含"连续"和"崩溃" | UNIT | 已有 |

### 2.3 Level 1：Hub 模式

| ID | 用例名 | 前置条件 | 输入 | 预期结果 | 类型 | 状态 |
|----|--------|---------|------|---------|------|------|
| TC-T06 | Hub 成功执行返回 verdict（AC-2） | mock HubClient 全部成功，返回 `{ verdict: "PASS", passEvidence: ["..."] }` | `runTribunalWithRetry("digest", 5)` | `verdict.verdict === "PASS"`，`subagentRequested` 为 undefined，`crashed=false` | UNIT | 已有 |
| TC-T07 | Hub 不可用降级到 Subagent（AC-3） | mock `isAvailable()` 返回 false | `runTribunalWithRetry("digest", 5)` | `subagentRequested=true`，ensureConnected 未调用 | UNIT | 已有 |
| TC-T08 | Hub 可达但 Worker 离线降级到 Subagent（AC-4） | mock `findTribunalWorker()` 返回 null | `runTribunalWithRetry("digest", 5)` | `subagentRequested=true`，executePrompt 未调用 | UNIT | 已有 |
| TC-T09 | Hub Worker 超时降级到 Subagent（AC-6） | mock `executePrompt()` 返回 null | `runTribunalWithRetry("digest", 5)` | `subagentRequested=true` | UNIT | 已有 |
| TC-T10 | Hub 返回 PASS 无 evidence 被覆写为 FAIL | mock executePrompt 返回 `{ verdict: "PASS", passEvidence: [] }` | `runTribunalWithRetry("digest", 5)` | `verdict.verdict === "FAIL"`，issues 包含"passEvidence 为空" | UNIT | **需新增** |
| TC-T11 | Hub 返回字符串 result（需 JSON.parse） | mock executePrompt 返回 JSON 字符串 | `runTribunalWithRetry("digest", 5)` | 正确解析为 TribunalVerdict | UNIT | **需新增** |
| TC-T12 | Hub 返回无效 result（无 verdict 字段）降级 | mock executePrompt 返回 `{ foo: "bar" }` | `runTribunalWithRetry("digest", 5)` | `subagentRequested=true`（tryRunViaHub 返回 null） | UNIT | **需新增** |
| TC-T13 | Hub 注册失败降级到 Subagent | mock `ensureConnected()` 返回 false | `runTribunalWithRetry("digest", 5)` | `subagentRequested=true` | UNIT | **需新增** |
| TC-T14 | Hub 大 digest 使用文件模式 prompt | digestContent.length > 8000，digestPath="/tmp/digest.md" | `tryRunViaHub(...)` 内部 | prompt 包含 `Read 工具读取文件` 而非 digest 全文 | UNIT | **需新增** |
| TC-T15 | Hub 小 digest 内联 prompt | digestContent.length < 8000 | `tryRunViaHub(...)` 内部 | prompt 包含 digest 全文 | UNIT | **需新增** |

### 2.4 evaluateTribunal 完整流程

| ID | 用例名 | 前置条件 | 输入 | 预期结果 | 类型 | 状态 |
|----|--------|---------|------|---------|------|------|
| TC-T16 | subagentRequested 时跳过 tribunal log 写入 | 默认模式（无 Hub） | `evaluateTribunal(root, dir, 4, topic, summary)` | 返回 `subagentRequested=true`，不写入 `tribunal-phase4.md`，返回 `digestPath` 和 `digestHash` | UNIT | **需新增** |
| TC-T17 | subagentRequested 时跳过 cross-validation | 默认模式 | `evaluateTribunal(root, dir, 5, topic, summary)` | 不调用 `crossValidate`，直接返回 | UNIT | **需新增** |
| TC-T18 | Hub 成功时走完整 post-processing | mock Hub 成功返回 PASS+evidence | `evaluateTribunal(root, dir, 4, topic, summary)` | 写入 `tribunal-phase4.md`，经过 cross-validation | INTEGRATION | **需新增** |

## 3. Orchestrator 集成测试（orchestrator.test.ts）

### 3.1 subagentRequested 分支（集成入口测试）

| ID | 用例名 | 前置条件 | 输入 | 预期结果 | 类型 | 状态 |
|----|--------|---------|------|---------|------|------|
| TC-O01 | subagentRequested 返回 tribunal_subagent escalation（AC-8） | state: phase=4, step="4a"，mock evaluateTribunal 返回 `{ subagentRequested: true, digestPath, digest, digestHash }` | `computeNextTask(projectRoot, topic)` | `escalation.reason === "tribunal_subagent"`，`escalation.digestPath` 有值，`prompt === null` | UNIT | 已有 |
| TC-O02 | subagentRequested 不增加 crash 计数（AC-8） | 同上 | `computeNextTask(...)` 后检查 atomicUpdate 参数 | `tribunalSubmits[phaseKey]` 递增 1，但不触发 crash 相关逻辑 | UNIT | 已有 |
| TC-O03 | subagentRequested escalation 包含 lastFeedback | 同 TC-O01 | `computeNextTask(...)` | `escalation.lastFeedback` 非空，包含"subagent"或"digestPath" | UNIT | 已有 |
| TC-O04 | subagentRequested 在 Phase 5 和 Phase 6 同样生效 | state: phase=5/6，mock evaluateTribunal 返回 subagentRequested | `computeNextTask(...)` | 均返回 `tribunal_subagent` escalation | UNIT | **需新增** |
| TC-O05 | subagentRequested 连续 3 次后不触发 ESCALATE_REGRESS | state: `tribunalSubmits["4"]=2`，再次 subagentRequested | `computeNextTask(...)` | 返回 `tribunal_subagent`（非 `tribunal_max_escalations`），因为 subagent 委托不计入 FAIL | UNIT | **需新增** |

### 3.2 与其他 tribunal 分支的对比

| ID | 用例名 | 前置条件 | 输入 | 预期结果 | 类型 | 状态 |
|----|--------|---------|------|---------|------|------|
| TC-O06 | crashed 返回 tribunal_crashed escalation | mock evaluateTribunal 返回 `{ crashed: true }` | `computeNextTask(...)` | `escalation.reason === "tribunal_crashed"` | UNIT | 已有（在 orchestrator.test.ts） |
| TC-O07 | rawParseFailure 返回 tribunal_parse_failure | mock evaluateTribunal 返回 `{ rawParseFailure: true, rawOutput: "..." }` | `computeNextTask(...)` | `escalation.reason === "tribunal_parse_failure"` | UNIT | 已有 |
| TC-O08 | 正常 FAIL（非 subagent/crash/parse）进入 revision 分支 | mock evaluateTribunal 返回 `{ verdict: "FAIL", issues: [...] }` | `computeNextTask(...)` | 不返回 escalation，返回 revision prompt | UNIT | 已有 |

## 4. 接口兼容性测试（AC-9）

| ID | 用例名 | 前置条件 | 输入 | 预期结果 | 类型 | 状态 |
|----|--------|---------|------|---------|------|------|
| TC-I01 | EvalTribunalResult 新增字段均为 optional | 无 | 构造不包含 `subagentRequested` 和 `digestPath` 的 EvalTribunalResult | TypeScript 编译通过，无必选字段缺失错误 | UNIT | **需新增**（编译时验证 + 运行时赋值检查） |
| TC-I02 | evaluateTribunal 参数签名不变 | 无 | 调用 `evaluateTribunal(root, dir, phase, topic, summary, startCommit)` | 函数接受 6 个参数（最后 1 个 optional），与改动前一致 | UNIT | **需新增**（TypeScript 编译验证） |

## 5. 负面测试

| ID | 用例名 | 前置条件 | 输入 | 预期结果 | 类型 | 状态 |
|----|--------|---------|------|---------|------|------|
| TC-N01 | HubClient baseUrl 尾部斜杠被去除 | `new HubClient("http://host:3100///", "token")` | `client.isAvailable()` | fetch URL 为 `http://host:3100/agents`（无多余斜杠） | UNIT | **需新增** |
| TC-N02 | Hub 返回 JSON parse 异常不崩溃 | mock executePrompt 返回非 JSON 字符串 result | `tryRunViaHub(...)` | 返回 null（catch block），不抛异常 | UNIT | **需新增** |
| TC-N03 | Hub ensureConnected 网络异常不抛出 | mock fetch 抛出 TypeError | `client.ensureConnected()` | 返回 false，不抛异常 | UNIT | **需新增** |
| TC-N04 | 空 TRIBUNAL_HUB_URL（空字符串）不创建 HubClient | `TRIBUNAL_HUB_URL=""` | `getHubClient()` | 返回 null（空字符串为 falsy） | UNIT | **需新增** |

## 6. E2E 集成测试（需真实 Hub 服务）

| ID | 用例名 | 前置条件 | 输入 | 预期结果 | 类型 | 状态 |
|----|--------|---------|------|---------|------|------|
| TC-E01 | 完整 Hub 模式裁决 | 启动 agent-communication-mcp 服务 + tribunal-worker session-proxy | 设置 `TRIBUNAL_HUB_URL`，调用 `evaluateTribunal()` 对一个简单 Phase 4 项目 | 返回有效 TribunalVerdict（verdict 为 PASS 或 FAIL），tribunal-phase4.md 被写入 | E2E | DEFERRED |
| TC-E02 | Hub 服务中途宕机降级 | 启动 Hub 服务，发送命令后关闭 Hub | `evaluateTribunal()` | 轮询失败后降级返回 `subagentRequested=true` | E2E | DEFERRED |
| TC-E03 | Worker 长时间无响应超时 | 启动 Hub 但不启动 worker | `evaluateTribunal()` with 短超时 | 超时后降级返回 `subagentRequested=true` | E2E | DEFERRED |

## 7. 集成入口测试（Integration Entry Point）

> 口诀：组件正确 != 集成正确，必须从入口测。

以下测试从调用方入口 `computeNextTask()` 发起，验证 Hub 集成在完整管线中的行为：

| ID | 用例名 | 前置条件 | 入口函数 | 预期结果 | 类型 | 状态 |
|----|--------|---------|---------|---------|------|------|
| TC-INT01 | 从 computeNextTask 发起 Phase 4 裁决（默认 Subagent 模式） | state: mode=full, phase=4, step="4a"，mock build/test 通过，evaluateTribunal 返回 subagentRequested | `computeNextTask(projectRoot, topic)` | 返回 escalation `{ reason: "tribunal_subagent", digestPath: "..." }`，state.tribunalSubmits["4"] 递增 | UNIT | 已有 |
| TC-INT02 | 从 computeNextTask 发起 Phase 5 裁决（Hub 模式成功） | state: mode=full, phase=5, step="5b"，mock test 通过，mock evaluateTribunal 返回 PASS | `computeNextTask(projectRoot, topic)` | step 推进到下一步，无 escalation | UNIT | **需新增** |
| TC-INT03 | 从 computeNextTask 发起 Phase 4 裁决（Hub 降级到 Subagent） | state: phase=4, step="4a"，mock evaluateTribunal 返回 `{ subagentRequested: true }` | `computeNextTask(projectRoot, topic)` | 返回 `tribunal_subagent` escalation，不返回 `tribunal_crashed` | UNIT | 已有 |

## 测试优先级

### P0（必须实现）
- TC-T10: Hub PASS 无 evidence 覆写（关键安全逻辑在 Hub 路径中的复现）
- TC-T13: Hub 注册失败降级（Hub 完整降级链路验证）
- TC-T16: subagentRequested 跳过 tribunal log（避免误导审计记录）
- TC-O04: Phase 5/6 的 subagentRequested 分支验证
- TC-N04: 空字符串 TRIBUNAL_HUB_URL 边界条件

### P1（应该实现）
- TC-H07: isAvailable 超时测试
- TC-H17: ensureConnected 失败后重试
- TC-H21: 多 worker 选择
- TC-H24/H25/H26: executePrompt 边界场景
- TC-H27-H30: getHubClient 单例工厂
- TC-T11/T12: Hub 返回值解析边界
- TC-T14/T15: digest 文件模式 vs 内联模式
- TC-I01/I02: 接口兼容性
- TC-N01/N02/N03: 负面测试

### P2（可以延后）
- TC-T02: 默认模式 dummy verdict 结构
- TC-T17/T18: evaluateTribunal post-processing 细节
- TC-O05: subagentRequested 连续 3 次行为
- TC-INT02: Hub 成功场景的入口测试
- TC-E01/E02/E03: 真实 Hub E2E 测试（DEFERRED）
