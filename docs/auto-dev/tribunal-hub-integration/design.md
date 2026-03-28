# 设计文档：裁决官三级执行策略（Hub 集成）

## 1. 背景与目标

### 背景

当前 auto-dev 的裁决官（tribunal）通过 `execFile("claude", ["-p", ...])` 方式 spawn 独立 CLI 进程执行裁决。这种方式存在严重的稳定性问题：

1. **Shell 参数溢出**：digest 内容最大 40K 字符，拼接 JSON schema 后作为命令行参数传递，容易触发 OS 的 ARG_MAX 限制
2. **转义崩溃**：digest 包含代码 diff（各种引号、反斜杠、特殊符号），shell 转义链路脆弱
3. **冷启动开销**：每次裁决 spawn 新 claude 进程，启动耗时 10-30 秒
4. **超时后无法恢复**：进程被硬杀后没有任何中间结果

虽然已做了文件模式优化（digest > 8K 时走文件读取、超时 10 分钟），但根本问题仍未解决——spawn CLI 进程本身就不稳定。

更关键的是，**CLI spawn 是默认路径**，崩溃后才 fallback 到 subagent。每次裁决都要先经历一次不稳定的 CLI 调用。

### 目标

- 建立三级裁决执行策略：Hub > Subagent > CLI（opt-in）
- **默认不走 CLI spawn**，消除最常见的崩溃源
- Hub 模式为可选增强，Subagent 为无 Hub 用户的默认方案
- 保持裁决的独立性（prompt/结果/审计不受影响）

### Non-Goals

- 不改变裁决逻辑（检查清单、cross-validation、auto-override 等）
- 不改变 `evaluateTribunal()` / `runTribunalVerdict()` 的对外接口
- 不支持跨机器 digest 文件传输（Hub 模式下 worker 必须与 auto-dev 在同一台机器）

## 2. 现状分析

### 当前裁决调用链

```
evaluateTribunal() / runTribunalVerdict()
  -> prepareTribunalInput()        # 生成 digest 文件 + 内容
  -> runTribunalWithRetry()        # 最多 2 次尝试
    -> runTribunal()               # spawn claude CLI 进程（默认且唯一路径）
      -> execFile("claude", ["-p", prompt, "--json-schema", schema, ...])
      -> 解析 stdout JSON -> TribunalVerdict
  -> 崩溃时 orchestrator 返回 escalation（reason: tribunal_crashed）
     -> skill prompt 指示主 agent 启动 subagent 裁决
```

**核心问题**：CLI spawn 是默认路径，subagent 只有在 CLI 崩溃后才作为 escalation fallback 启动。每次裁决都要先冒一次 CLI 崩溃的风险。

### 关键代码位置

| 文件 | 职责 |
|------|------|
| `mcp/src/tribunal.ts` | `runTribunal()` -- CLI spawn 逻辑；`runTribunalWithRetry()` -- 重试；`evaluateTribunal()` -- 纯评估（无副作用） |
| `mcp/src/orchestrator.ts` | `runStepValidation()` 调用 `evaluateTribunal()`，处理 crashed/rawParseFailure 返回的 escalation |
| `mcp/src/tribunal-schema.ts` | TribunalVerdict 的 JSON Schema（传给 CLI --json-schema） |
| `mcp/src/tribunal-checklists.ts` | 各 phase 的检查清单 |
| `mcp/src/agent-spawner.ts` | `getClaudePath()` -- 4 级 fallback 解析 claude CLI 路径 |

### Agent Hub 已有能力

Hub（`agent-communication-mcp`）提供：

- `POST /agents/register`：注册 agent
- `POST /commands`：向目标 agent 发送命令（action: `execute_prompt`）
- `GET /commands/:id`：查询命令状态和结果（已实现）
- `GET /agents`：列出所有 agent（支持按 name 过滤）
- Worker（session-proxy）收到命令后用 Agent SDK 执行 prompt，完成后通过 `PATCH /commands/:id` 回传结果

关键优势：prompt 通过 HTTP JSON body 传输，无 shell 参数限制、无转义问题。

### Subagent 裁决（已有 escalation 机制）

当 CLI spawn 崩溃后，orchestrator 返回 `escalation.reason = "tribunal_crashed"`，skill prompt 指示主 agent 启动 subagent 执行裁决。该机制已验证可用：
- 运行在 Claude Code 内部，零进程开销
- 无 shell 转义风险
- 直接读取文件，无参数大小限制
- 唯一缺点：与主 agent 共享 API key 额度

## 3. 方案设计

### 方案对比

| 维度 | 方案 A：Hub > CLI > Subagent | 方案 B：Hub > Subagent > CLI(opt-in) | 方案 C：仅 Hub + Subagent（移除 CLI） |
|------|------|------|------|
| 描述 | Hub 优先，CLI 其次，Subagent 兜底 | Hub 优先，Subagent 为默认 fallback，CLI 仅显式 opt-in | 彻底移除 CLI spawn |
| 默认路径稳定性 | 低 -- CLI 仍是无 Hub 用户的默认路径 | 高 -- 无 Hub 用户默认走 Subagent | 高 -- 无 CLI |
| 独立进程能力 | 保留（默认启用） | 保留（显式 opt-in） | 失去 |
| 改动量 | ~100 行（调整优先级） | ~200 行（新增 hub-client + 策略改造） | ~300 行（需移除 CLI 相关代码） |
| 兼容性风险 | 低 -- 只改顺序 | 低 -- 默认行为变更方向是更稳定 | 中 -- 移除 CLI 可能影响依赖 CLI 隔离计费的用户 |
| 回滚方案 | 设 TRIBUNAL_MODE=cli | 设 TRIBUNAL_MODE=cli | 无法回滚到 CLI |

### 选型：方案 B

理由：
1. **Subagent 裁决已经是验证可用的 fallback 机制**，升级为默认路径零风险
2. **无 Hub 用户体验大幅改善**：从"经常崩溃的 CLI"升级为"稳定的 Subagent"
3. **CLI 的独立性优势保留**给显式需要隔离计费的场景（`TRIBUNAL_MODE=cli`）
4. 方案 C 虽然最简洁，但完全移除 CLI 过于激进，违反渐进式改进原则

## 4. 详细设计

### 4.1 三级执行策略

```
runTribunal(digestContent, phase, digestPath)
  |
  +-- Level 1: TRIBUNAL_HUB_URL 已设置？
  |    -> tryRunViaHub(digestPath, phase)
  |    -> 成功 -> 返回 TribunalVerdict
  |    -> 失败 -> 降级到 Level 2
  |
  +-- Level 2: 默认（无需任何配置）
  |    -> 返回特殊标记 { _subagentMode: true }
  |    -> evaluateTribunal() 识别后返回 { crashed: false, subagentRequested: true }
  |    -> orchestrator 以 escalation 形式交给主 agent 启动 subagent
  |
  +-- Level 3: TRIBUNAL_MODE=cli 显式指定
       -> 走现有的 execFile/exec CLI spawn 逻辑（保留不变）
```

### 4.2 环境变量配置

| 变量 | 用途 | 默认值 |
|------|------|--------|
| `TRIBUNAL_HUB_URL` | Hub 服务地址（设置后启用 Level 1） | 未设置 = 跳过 Hub |
| `TRIBUNAL_HUB_TOKEN` | Hub 认证 token | 无 |
| `TRIBUNAL_HUB_WORKER` | 指定 tribunal worker agent name（可选） | 自动查找 |
| `TRIBUNAL_MODE` | 设为 `cli` 时使用 CLI spawn（Level 3） | 未设置 = Subagent |

**不设置任何变量 = Subagent 模式（Level 2）**，这是最安全的默认。

### 4.3 核心接口变更

#### `runTribunal()` 返回值扩展

`runTribunal()` 在 Level 2 时返回一个带 `_subagentMode: true` 内部标记的 TribunalVerdict，由 `runTribunalWithRetry()` 识别并传递给上层。

#### `runTribunalWithRetry()` 返回值扩展

在现有的 `{ verdict, crashed, rawParseFailure }` 基础上增加 `subagentRequested?: boolean` 字段。

#### `EvalTribunalResult` 扩展

在现有接口基础上增加：
- `subagentRequested?: boolean` -- 标识需要 subagent 裁决
- `digestPath?: string` -- digest 文件路径（供 subagent 读取）

#### `HubClient` 新增模块

新增 `mcp/src/hub-client.ts`，封装与 Hub 的 HTTP 通信：

| 方法 | 职责 |
|------|------|
| `isAvailable()` | 检查 Hub 是否可达（1s 超时，快速失败） |
| `ensureConnected()` | 注册 agent（幂等，多次调用只注册一次） |
| `findTribunalWorker()` | 按名称查找在线的 tribunal worker agent |
| `executePrompt(targetAgentId, prompt, timeoutMs)` | 发送 execute_prompt 命令 + 轮询等待结果 |

### 4.4 Hub 模式轮询策略

通过 `GET /commands/:id` 端点精确查询命令状态，指数退避轮询：

- 轮询间隔：1s, 2s, 3s, 5s, 5s, 5s, ...（递增后稳定在 5s）
- 总超时：600s（10 分钟，与现有 CLI spawn 超时对齐）
- 状态判定：`completed` / `rejected` = 终止；其余继续轮询
- 超时 = 降级到 Level 2（Subagent）

选择 HTTP 轮询而非 WebSocket，因为 auto-dev MCP server 是请求驱动的短生命周期进程，不适合维护长连接。

### 4.5 数据流

#### Hub 模式（Level 1）

```
auto-dev MCP          Agent Hub              session-proxy (worker)
     |                    |                         |
     | POST /agents/register                        |
     |------------------->|                         |
     |                    |                         |
     | GET /agents?name=tribunal-worker             |
     |------------------->|                         |
     |                    |                         |
     | POST /commands     |  WS: command.new        |
     |  { execute_prompt }|------------------------>|
     |------------------->|                         |
     |                    |  SDK.query(prompt)       |
     | GET /commands/:id  |  -> Read(digestPath)     |
     |------------------->|  -> 裁决                 |
     | { pending }        |                         |
     |                    |  PATCH /commands/:id     |
     | GET /commands/:id  |  { completed, result }   |
     |------------------->|<------------------------|
     | { completed }      |                         |
     |                    |                         |
     | 解析 result -> TribunalVerdict               |
```

#### Subagent 模式（Level 2，默认）

```
auto-dev MCP                 orchestrator
     |                           |
     | evaluateTribunal()        |
     | -> subagentRequested=true |
     |-------------------------->|
     |                           |
     |   返回 escalation:        |
     |   { reason: "tribunal_subagent",
     |     digest, digestPath }  |
     |                           |
     |   主 agent 启动 subagent   |
     |   -> Read(digestPath)     |
     |   -> 裁决                 |
     |   -> auto_dev_tribunal_verdict()
     |<--------------------------|
```

### 4.6 orchestrator 适配

orchestrator 中 `runStepValidation()` 已有处理 `crashed` 和 `rawParseFailure` 的 escalation 分支。新增 `subagentRequested` 处理分支，逻辑与 `crashed` 类似但语义不同——不是崩溃，而是主动选择 subagent 路径：

- escalation reason: `"tribunal_subagent"`（区分于 `"tribunal_crashed"`）
- 不计入 crash 计数
- 携带 digestPath 供 subagent 直接读取文件

## 5. 影响分析

### 改动范围

| 文件 | 改动类型 | 描述 |
|------|---------|------|
| `mcp/src/hub-client.ts` | **新增** | Hub HTTP client，预估 ~150 行 |
| `mcp/src/tribunal.ts` | 修改 | `runTribunal()` 三级策略 + `runTribunalWithRetry()` subagentRequested 标记，预估改动 ~50 行 |
| `mcp/src/orchestrator.ts` | 修改 | `runStepValidation()` 新增 subagentRequested 分支，预估改动 ~20 行 |
| `mcp/src/__tests__/hub-client.test.ts` | **新增** | Hub client 单元测试 |
| `mcp/src/__tests__/tribunal.test.ts` | 修改 | 新增 Hub 和 Subagent 模式测试用例 |

### 兼容性

- **完全向后兼容**：不设任何环境变量时，行为从 CLI spawn 变为 Subagent（更稳定的方向）
- `TRIBUNAL_MODE=cli` 可显式恢复旧行为
- `evaluateTribunal()` 对外接口签名不变，仅返回值新增可选字段
- 裁决逻辑（cross-validation、auto-override、passEvidence 检查）不受影响

### 迁移路径

| 用户类型 | 之前 | 之后 | 需要做什么 |
|---------|------|------|-----------|
| 无 Hub，无特殊配置 | CLI spawn（经常崩溃） | Subagent（稳定） | 无需操作 |
| 有 Hub | CLI spawn | Hub 优先 -> Subagent 降级 | 设置 `TRIBUNAL_HUB_URL` 和 `TRIBUNAL_HUB_TOKEN` |
| 想要独立进程隔离 | CLI spawn | CLI spawn | 设置 `TRIBUNAL_MODE=cli` |

### 回滚方案

- **快速回滚**：设置 `TRIBUNAL_MODE=cli` 环境变量即可恢复旧行为，无需代码变更
- **完全回滚**：git revert 即可，因为对外接口签名未变

## 6. 风险与缓解

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|---------|
| Subagent 与主 agent 共享 API key 额度 | 确定 | 低 -- 裁决消耗 token 较少 | 需要隔离的用户设 `TRIBUNAL_MODE=cli` |
| Hub 服务不可用 | 中 | 低 -- 有降级 | `isAvailable()` 1s 快速检测，失败立即降级到 Subagent |
| Worker agent 离线 | 中 | 低 -- 有降级 | `findTribunalWorker()` 返回 null，降级到 Subagent |
| Worker 执行超时 | 低 | 低 -- 有超时 | 轮询 10 分钟上限，超时后降级到 Subagent |
| Worker 返回非 JSON 结果 | 低 | 低 | 复用现有 `rawParseFailure` 机制 |
| digest 文件路径 worker 不可达 | 低 | 中 | Non-Goal 已声明：worker 必须与 auto-dev 在同一台机器 |
| 默认行为变化影响现有用户 | 确定 | 正面 | Subagent 比 CLI spawn 更稳定；`TRIBUNAL_MODE=cli` 可回退 |

## 7. Hub 侧前置改动（agent-communication-mcp）

经分析，Hub 所需的 API 端点已全部就绪：

- `GET /commands/:id` -- 已实现（按 commandId 查询状态和结果）
- `GET /agents` -- 已实现（支持按 name 过滤）
- `POST /agents/register` -- 已有
- `POST /commands` -- 已有
- `PATCH /commands/:id` -- 已有（worker 回传结果）

**不需要额外的 Hub 侧改动**。命令级 deadline（僵尸命令清理）为可选优化，tribunal 端自带 10 分钟轮询上限，可后续迭代。

## 验收标准

| AC | 描述 | 验证方式 |
|----|------|---------|
| AC-1 | 不设任何环境变量时，`runTribunal()` 返回带 `_subagentMode: true` 标记的结果，`runTribunalWithRetry()` 返回 `subagentRequested: true`，不调用 `execFile` | 单元测试：清空 `TRIBUNAL_HUB_URL` 和 `TRIBUNAL_MODE`，mock `execFile`，验证 `execFile` 未被调用且返回值包含 `subagentRequested: true` |
| AC-2 | 设置 `TRIBUNAL_HUB_URL` 且 Hub 可达、worker 在线时，裁决通过 Hub 执行并返回正确的 `TribunalVerdict`（包含 verdict、issues 字段） | 集成测试：mock Hub HTTP 端点（/agents/register, /commands, /commands/:id），验证请求序列正确且返回解析后的 verdict |
| AC-3 | Hub 不可用（连接超时/拒绝）时，自动降级到 Subagent 模式，不抛出异常 | 单元测试：mock fetch 抛出连接错误，验证返回 `subagentRequested: true` 且无异常 |
| AC-4 | Hub 可达但 worker 离线（`findTribunalWorker()` 返回 null）时，自动降级到 Subagent 模式 | 单元测试：mock `/agents` 返回空列表，验证返回 `subagentRequested: true` |
| AC-5 | 设置 `TRIBUNAL_MODE=cli` 时，走 CLI spawn 路径（调用 `execFile`），与改动前行为一致 | 单元测试：设置环境变量，mock `execFile`，验证 `execFile` 被调用 |
| AC-6 | Hub 模式下 Worker 执行超时（轮询超过 10 分钟）时，降级到 Subagent 模式 | 单元测试：mock 轮询永远返回 `{ status: "pending" }`，设置短超时（如 100ms），验证超时后返回 `subagentRequested: true` |
| AC-7 | `HubClient.ensureConnected()` 幂等——连续调用 2 次，只发送 1 次 `POST /agents/register` | 单元测试：mock fetch，连续调用 `ensureConnected()` 两次，验证 fetch 只被调用 1 次 |
| AC-8 | orchestrator 中 `runStepValidation()` 收到 `subagentRequested: true` 时，返回 escalation（reason: `tribunal_subagent`），不增加 crash 计数 | 单元测试：mock `evaluateTribunal` 返回 subagentRequested，验证 escalation 结构正确且 tribunal submit count 正确更新 |
| AC-9 | `evaluateTribunal()` 的对外接口签名（参数列表和返回类型的必选字段）保持不变，新增字段均为 optional | 代码审查：对比改动前后的 `EvalTribunalResult` 接口定义 |
