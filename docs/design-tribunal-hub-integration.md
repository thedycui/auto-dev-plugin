# 设计文档：裁决官三级执行策略

## 1. 背景与目标

### 背景

当前 auto-dev 的裁决官（tribunal）通过 `execFile("claude", ["-p", digestContent, ...])` 方式 spawn 独立 CLI 进程执行裁决。这种方式存在严重的稳定性问题：

1. **Shell 参数溢出**：digest 内容最大 40K 字符，拼接 JSON schema 后作为命令行参数传递，容易触发 OS 的 ARG_MAX 限制
2. **转义崩溃**：digest 包含代码 diff（各种引号、反斜杠、特殊符号），shell 转义链路脆弱
3. **冷启动开销**：每次裁决 spawn 新 claude 进程，启动耗时 10-30 秒
4. **超时后无法恢复**：进程被硬杀后没有任何中间结果

虽然已做了文件模式优化（digest > 8K 时走文件读取、超时 10 分钟），但根本问题仍未解决——spawn CLI 进程本身就不稳定。

更关键的是，**CLI spawn 目前是默认路径**，崩溃后才 fallback 到 subagent。这意味着每次裁决都要先经历一次不稳定的 CLI 调用，才可能走到更稳定的 subagent 路径。

### 目标

- 建立三级裁决执行策略：Hub > Subagent > CLI（opt-in）
- **默认不走 CLI spawn**，消除最常见的崩溃源
- Hub 模式为可选增强，Subagent 为无 Hub 用户的默认方案
- 保持裁决的独立性

### Non-Goals

- 不改变裁决逻辑（检查清单、cross-validation、auto-override 等）
- 不改变 `evaluateTribunal()` / `runTribunalVerdict()` 的对外接口
- 不支持跨机器 digest 文件传输（Hub 模式下 worker 必须与 auto-dev 在同一台机器）

## 2. 现状分析

### 当前裁决调用链

```
evaluateTribunal() / runTribunalVerdict()
  → prepareTribunalInput()        # 生成 digest 文件 + 内容
  → runTribunalWithRetry()        # 最多 2 次尝试
    → runTribunal()               # spawn claude CLI 进程（默认）
      → execFile("claude", ["-p", prompt, "--json-schema", schema, ...])
      → 解析 stdout JSON → TribunalVerdict
  → 崩溃时返回 TRIBUNAL_PENDING   # fallback: 主 agent 启动 subagent 裁决
```

**问题**：CLI spawn 是默认路径，subagent 是崩溃后的 fallback。每次裁决都要先冒一次 CLI 崩溃的风险。

### Agent Hub 能力

Hub（`agent-communication-mcp`）提供：

- **`hub_connect`**：注册 agent，建立 WebSocket 心跳
- **`hub_command`**：向目标 agent 发送 `execute_prompt` 命令
- **`GET /commands/:id`**：查询命令状态和结果（已新增）
- **`GET /agents?name=`**：按名称查找 agent（已新增）

Worker agent（session-proxy）收到 `execute_prompt` 命令后：
1. `sessionManager.startHeadless(prompt)` 创建 session
2. `SdkRunner.execute()` 用 Agent SDK 执行 prompt
3. 执行完毕通过 `hub_command_update(commandId, status: "completed", result: "...")` 回传结果

关键优势：prompt 通过 HTTP JSON body 传输，无 shell 参数限制。

### Subagent 裁决（已有机制）

当前 CLI spawn 崩溃后，框架返回 `TRIBUNAL_PENDING`，skill prompt 指示主 agent 启动 `auto-dev:auto-dev-reviewer` subagent 执行裁决。这个机制已经验证可用，且：
- 运行在 Claude Code 内部，零进程开销
- 无 shell 转义风险
- 直接读取文件，无参数大小限制
- 唯一缺点：与主 agent 共享 API key 额度（非独立进程计费）

## 3. 方案设计

| 方案 | 描述 | 优点 | 缺点 |
|------|------|------|------|
| A: Hub > CLI > Subagent（当前设计） | Hub 优先，CLI 其次，Subagent 兜底 | 最大化独立性 | CLI 仍是默认路径之一，崩溃频繁 |
| B: Hub > Subagent > CLI（opt-in） | Hub 优先，Subagent 为默认，CLI 仅在显式指定时使用 | 消除最常见崩溃源；无 Hub 用户也获得稳定体验 | Subagent 非独立进程，共享 API key |
| C: 仅 Hub + Subagent，移除 CLI | 彻底移除 CLI spawn | 最简洁 | 失去"独立进程裁决"能力，有些用户可能需要 |

**选择方案 B**，理由：
1. Subagent 裁决已经是验证可用的 fallback 机制，升级为默认路径零风险
2. CLI spawn 的独立性优势（独立进程、独立计费）保留给显式需要的场景
3. 无 Hub 用户从"经常崩溃的 CLI"升级为"稳定的 Subagent"，体验大幅改善

## 4. 详细设计

### 4.1 三级执行策略

```
runTribunal(digestContent, phase, digestPath)
  │
  ├─ Level 1: TRIBUNAL_HUB_URL 已设置？
  │    → tryRunViaHub(digestPath, phase)
  │    → 成功 → 返回 TribunalVerdict
  │    → 失败 → 降级到 Level 2
  │
  ├─ Level 2: 默认（无需任何配置）
  │    → 返回 TRIBUNAL_PENDING
  │    → skill prompt 触发 auto-dev-reviewer subagent 裁决
  │    → subagent 读取 digest 文件，输出结构化裁决
  │
  └─ Level 3: TRIBUNAL_MODE=cli 显式指定
       → runViaCliSpawn(digestContent, phase, digestPath)
       → 现有的 execFile/exec 逻辑（保留不变）
```

### 4.2 环境变量配置

```bash
# === Level 1: Hub 模式 ===
# 设置后启用 Hub 优先（不设置则跳过）
TRIBUNAL_HUB_URL=http://localhost:6800
TRIBUNAL_HUB_TOKEN=worker_token
# 指定 tribunal worker 的 agent name（可选，默认自动查找带 "tribunal" 能力的 agent）
TRIBUNAL_HUB_WORKER=tribunal-worker

# === Level 3: CLI 模式（显式 opt-in）===
# 设置后使用 CLI spawn 而非 Subagent（不建议，仅独立计费场景使用）
TRIBUNAL_MODE=cli
```

**不设置任何变量 = Subagent 模式（Level 2）**，这是最安全的默认。

### 4.3 `runTribunal()` 改造

```typescript
export async function runTribunal(
  digestContent: string,
  phase: number,
  digestPath?: string,
): Promise<TribunalVerdict> {
  // Level 1: Hub 模式
  if (process.env.TRIBUNAL_HUB_URL) {
    try {
      const result = await tryRunViaHub(digestPath ?? "", phase);
      if (result) return result;
    } catch {
      // Hub 失败，降级到 Level 2/3
    }
  }

  // Level 3: CLI 模式（显式 opt-in）
  if (process.env.TRIBUNAL_MODE === "cli") {
    return runViaCliSpawn(digestContent, phase, digestPath);
  }

  // Level 2: Subagent 模式（默认）
  // 返回特殊 verdict 触发 TRIBUNAL_PENDING 流程
  return {
    verdict: "FAIL",
    issues: [{
      severity: "P0",
      description: "TRIBUNAL_SUBAGENT_REQUESTED",
    }],
    raw: "",
    _subagentMode: true,  // 内部标记，让上层识别
  };
}
```

### 4.4 `runTribunalWithRetry()` 适配

```typescript
export async function runTribunalWithRetry(
  digestContent: string,
  phase: number,
  digestPath?: string,
): Promise<{ verdict: TribunalVerdict; crashed: boolean; rawParseFailure?: boolean; subagentRequested?: boolean }> {
  // ...
  const result = await runTribunal(digestContent, phase, digestPath);

  // Subagent 模式：不是崩溃，是主动请求 subagent
  if ((result as any)._subagentMode) {
    return { verdict: result, crashed: false, subagentRequested: true };
  }

  // 其余逻辑不变...
}
```

### 4.5 `evaluateTribunal()` 适配

```typescript
// 在 evaluateTribunal() 中：
const { verdict, crashed, rawParseFailure, subagentRequested } =
  await runTribunalWithRetry(digestContent, phase, digestPath);

// Subagent 请求：返回 digest 信息供主 agent 启动 subagent
if (subagentRequested) {
  const digestHash = createHash("sha256").update(digestContent).digest("hex").slice(0, 16);
  return {
    verdict: "FAIL",
    issues: [],
    crashed: false,
    subagentRequested: true,
    digest: digestContent,
    digestHash,
    digestPath,
  };
}
```

### 4.6 Hub 模式实现：`hub-client.ts`

```typescript
// mcp/src/hub-client.ts

export interface HubConfig {
  baseUrl: string;    // e.g. "http://localhost:6800"
  token: string;      // agent auth token
  agentName: string;  // e.g. "auto-dev-tribunal"
}

export interface CommandResult {
  commandId: string;
  status: "completed" | "rejected" | "timeout";
  result?: string;
}

export class HubClient {
  private config: HubConfig;
  private agentId: string | null = null;

  constructor(config: HubConfig) { ... }

  /** 检查 Hub 是否可达（1s 超时） */
  async isAvailable(): Promise<boolean>;

  /** 注册 agent（幂等） */
  async ensureConnected(): Promise<string>;

  /** 按名称查找 tribunal worker */
  async findTribunalWorker(): Promise<string | null>;

  /** 发送 execute_prompt 并轮询等待结果 */
  async executePrompt(
    targetAgentId: string,
    prompt: string,
    timeoutMs?: number,
  ): Promise<CommandResult>;

  /** 断开连接 */
  async disconnect(): Promise<void>;
}
```

### 4.7 轮询策略（Hub 模式）

通过 `GET /commands/:id` 端点精确查询，指数退避轮询：

```typescript
const POLL_INTERVALS = [1000, 2000, 3000, 5000, 5000, 5000, ...];
const MAX_POLL_TIME = 600_000; // 10 分钟

async waitForCompletion(commandId: string): Promise<CommandResult> {
  const start = Date.now();
  let i = 0;
  while (Date.now() - start < MAX_POLL_TIME) {
    const cmd = await this.getCommand(commandId);
    if (cmd.status === "completed" || cmd.status === "rejected") {
      return cmd;
    }
    await sleep(POLL_INTERVALS[Math.min(i++, POLL_INTERVALS.length - 1)]);
  }
  return { commandId, status: "timeout" };
}
```

选择 HTTP 轮询而非 WebSocket，因为 auto-dev MCP server 是请求驱动的短生命周期进程，不适合维护长连接。

### 4.8 数据流图

#### Hub 模式（Level 1）

```
auto-dev MCP server                    Agent Hub                     session-proxy (worker)
       │                                   │                                │
       │ POST /agents/register             │                                │
       │──────────────────────────────────>│                                │
       │ { agentId }                       │                                │
       │<──────────────────────────────────│                                │
       │                                   │                                │
       │ GET /agents?name=tribunal-worker  │                                │
       │──────────────────────────────────>│                                │
       │ [{ agentId, name, status }]       │                                │
       │<──────────────────────────────────│                                │
       │                                   │                                │
       │ POST /commands                    │  WS: command.new              │
       │  { action: execute_prompt }       │──────────────────────────────>│
       │──────────────────────────────────>│                                │
       │ { commandId }                     │    SDK.query(prompt)           │
       │<──────────────────────────────────│    → Read(digestPath)          │
       │                                   │    → 逐条裁决                  │
       │ GET /commands/{id} (poll)         │    → 输出 verdict              │
       │──────────────────────────────────>│                                │
       │ { status: pending }               │  PATCH /commands/{id}          │
       │<──────────────────────────────────│  { status: completed,          │
       │                                   │    result: "{verdict}" }       │
       │ GET /commands/{id} (poll)         │<──────────────────────────────│
       │──────────────────────────────────>│                                │
       │ { status: completed, result }     │                                │
       │<──────────────────────────────────│                                │
       │                                   │                                │
       │ 解析 result → TribunalVerdict     │                                │
```

#### Subagent 模式（Level 2，默认）

```
auto-dev MCP server                    skill prompt (主 agent)
       │                                   │
       │ TRIBUNAL_PENDING                  │
       │  { digest, digestPath }           │
       │──────────────────────────────────>│
       │                                   │
       │                                   │ 启动 auto-dev-reviewer subagent
       │                                   │  → Read(digestPath)
       │                                   │  → 逐条裁决
       │                                   │  → 返回裁决结果
       │                                   │
       │ auto_dev_tribunal_verdict()       │
       │  { verdict, issues, ... }         │
       │<──────────────────────────────────│
```

## 5. Hub 侧前置改动（agent-communication-mcp）✅ 已完成

经分析，Hub 现有机制有 3 个缺口，其中 2 个已完成：

### 5.1 ✅ 新增 `GET /commands/:id`（已合入 9f96cc6）

Hub `packages/hub/src/routes/commands.ts` 新增路由，鉴权限制只有 sender/receiver 可查。

### 5.2 ✅ 新增 `GET /agents?name=&capability=` 过滤（已合入 9f96cc6）

Hub `packages/hub/src/routes/agents.ts` 加 query param 过滤。

### 5.3 命令级 deadline（建议，可后续迭代）

**现状**：pending 的 command 永不过期，僵尸命令堆积。
**影响**：如果 worker 崩溃，tribunal 的命令永远 pending。
**改动**：Command 表新增 `deadline` 字段，Hub 定期清理超时命令。

此项非阻塞——tribunal 端已有自己的超时机制（轮询 10 分钟上限），可在第一版不做。

## 6. 影响分析

### 改动范围

**auto-dev-plugin（主改动）：**

| 文件 | 改动类型 | 描述 |
|------|---------|------|
| `mcp/src/hub-client.ts` | **新增** | Hub HTTP client，~150 行 |
| `mcp/src/tribunal.ts` | 修改 | `runTribunal()` 三级策略 + subagentRequested 标记，~50 行 |
| `mcp/src/__tests__/hub-client.test.ts` | **新增** | Hub client 单元测试 |
| `mcp/src/__tests__/tribunal.test.ts` | 修改 | 新增 Hub 和 Subagent 模式测试用例 |

### 兼容性

- **完全向后兼容**：不设任何环境变量时，行为从 CLI spawn 变为 Subagent（更稳定）
- `TRIBUNAL_MODE=cli` 显式恢复旧行为
- 不改变 `evaluateTribunal()` / `runTribunalVerdict()` 的对外接口签名
- 不改变裁决逻辑（cross-validation、auto-override 等不受影响）

### 迁移路径

| 用户类型 | 之前 | 之后 | 需要做什么 |
|---------|------|------|-----------|
| 无 Hub，无特殊配置 | CLI spawn（经常崩溃） | Subagent（稳定） | 无需操作 |
| 有 Hub | CLI spawn | Hub 优先 → Subagent 降级 | 设置 `TRIBUNAL_HUB_URL` 和 `TRIBUNAL_HUB_TOKEN` |
| 想要独立进程隔离 | CLI spawn | CLI spawn | 设置 `TRIBUNAL_MODE=cli` |

## 7. 风险与缓解

| 风险 | 缓解措施 |
|------|---------|
| Subagent 与主 agent 共享 API key 额度 | 这是权衡：稳定性 > 计费隔离。需要隔离的用户设 `TRIBUNAL_MODE=cli` |
| Hub 服务不可用 | `isAvailable()` 快速检测（1s 超时），失败立即降级到 Subagent |
| Worker agent 离线 | `findTribunalWorker()` 返回 null，降级到 Subagent |
| Worker 执行超时 | 轮询 10 分钟上限，超时后降级到 Subagent |
| Worker 返回非 JSON 结果 | 复用现有 `rawParseFailure` 机制，交给主 agent 提取 |
| digest 文件路径 worker 不可达 | worker 必须与 auto-dev 在同一台机器上（共享文件系统） |
| 默认行为变化可能影响现有用户 | Subagent 比 CLI spawn 更稳定，属正面变化；不满意可 `TRIBUNAL_MODE=cli` 回退 |

## 8. 验收标准

| AC | 描述 | 验证方式 |
|----|------|---------|
| AC-1 | 不设任何环境变量时，裁决走 Subagent 模式（返回 `subagentRequested: true` + digest 信息） | 单元测试：清空环境变量，验证返回 subagentRequested |
| AC-2 | 设置 `TRIBUNAL_HUB_URL` + Hub 运行 + worker 在线时，裁决通过 Hub 执行并返回正确的 `TribunalVerdict` | 集成测试：mock Hub HTTP 端点，验证 command 创建 + 轮询 + 结果解析 |
| AC-3 | Hub 不可用（连接失败 / worker 离线）时，自动降级到 Subagent 模式 | 单元测试：mock Hub 连接失败，验证返回 subagentRequested |
| AC-4 | 设置 `TRIBUNAL_MODE=cli` 时，走 CLI spawn 路径（与改动前行为一致） | 单元测试：设置环境变量，验证调用 execFile |
| AC-5 | Hub 模式下 Worker 执行超时（>10 分钟）时，降级到 Subagent 模式 | 单元测试：mock 轮询永远返回 pending，验证超时后返回 subagentRequested |
| AC-6 | `HubClient.ensureConnected()` 幂等，多次调用只注册一次 agent | 单元测试：连续调用 2 次，验证只发送 1 次 POST /agents/register |
