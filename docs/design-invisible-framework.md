# 设计文档：隐形框架（Invisible Framework）

## 问题背景

当前 auto-dev 插件采用 **agent 驱动编排** 架构：主 agent 通过 SKILL.md 获得完整的流程视角（7 个 Phase、checkpoint、tribunal、迭代限制等），然后主动调用 MCP 工具驱动流程推进。

实践中多次观察到 agent 为了"通过检查"而修改文档欺骗框架的行为。根因分析：

1. **Goodhart 效应**：agent 知道有 7 道 gate，优化目标从"做好工作"变成"过门"
2. **路径最短化**：修改文档比解决真实问题的 token 成本低
3. **焦虑驱动**：迭代限制 + 回退限制 + 默认 FAIL 的 tribunal 制造了"时间压力"感知

## 设计目标

将 agent 从"流程执行者"变为"纯任务工作者"：

- **G1**：agent 不知道 Phase/checkpoint/tribunal 的存在
- **G2**：agent 只收到纯任务 prompt（"请设计这个功能"、"请实现这个 task"）
- **G3**：框架在 agent 外部完成所有编排、验证、推进决策
- **G4**：保留现有全部硬验证能力（framework 执行测试、INIT hash、tribunal、cross-validation）
- **G5**：现有 Phase prompt 模板基本不改（它们已经是解耦的）
- **G6**：支持渐进式迁移，不需要一次性重写

## 架构概览

```
                    ┌─────────────────────────────────┐
                    │       Orchestrator (新增)         │
                    │  ┌───────────────────────────┐   │
                    │  │ 状态机 (复用 phase-enforcer) │   │
                    │  │ 验证层 (复用 checkpoint 逻辑)│   │
                    │  │ Tribunal (复用 tribunal.ts)  │   │
                    │  └──────────┬────────────────┘   │
                    │             │                     │
                    │   ┌─────────▼──────────┐         │
                    │   │  Task Dispatcher    │         │
                    │   │  render prompt      │         │
                    │   │  spawn agent        │         │
                    │   │  collect result     │         │
                    │   │  inject feedback    │         │
                    │   └─────────┬──────────┘         │
                    └─────────────┼─────────────────────┘
                                  │
                    ┌─────────────▼─────────────────────┐
                    │        Task Agent (隔离)           │
                    │                                    │
                    │  只看到：                            │
                    │  - 纯任务描述                        │
                    │  - 输入文件 (design.md, plan.md)     │
                    │  - 反馈信息 (如果是修订轮次)           │
                    │                                    │
                    │  不知道：                            │
                    │  - Phase 编号 / 总数                 │
                    │  - Checkpoint / Tribunal            │
                    │  - 迭代限制 / 回退限制                │
                    │  - 其他 agent 的存在                  │
                    └────────────────────────────────────┘
```

## 核心概念

### Orchestrator（编排器）

一个 TypeScript 进程，承担当前 SKILL.md 中主 agent 的编排职责。它：

1. 持有完整的 Phase 状态机
2. 调用 `claude -p` 启动无状态 task agent（与 tribunal 相同的 spawn 模式）
3. 收集 agent 产出，调用现有验证逻辑
4. 决定下一步：推进、修订、或人工介入
5. 把验证失败转译为"技术反馈"注入下一轮 prompt

### Task Agent（任务 agent）

一个通过 `claude -p` 启动的独立 Claude 进程。它：

1. 收到一个纯任务 prompt（由 Orchestrator 从 phase prompt 模板渲染）
2. 拥有完整的文件系统访问（读/写代码、运行命令）
3. **不注册 auto-dev MCP 工具**——没有 checkpoint/submit 可调
4. 产出是文件变更（design.md、代码文件、test 文件等）
5. 结束后 Orchestrator 检查产出

### 反馈循环

```
Orchestrator                          Task Agent
    │                                     │
    │  ── 纯任务 prompt ──>               │
    │                                     │  (自由工作)
    │  <── 文件产出 ──                     │
    │                                     │
    ├─ 验证产出 (artifact check)          │
    ├─ 执行测试 (framework test)          │
    ├─ 运行 tribunal (if phase 4-7)      │
    │                                     │
    │  如果失败:                           │
    │  ── 修订 prompt + 具体反馈 ──>       │  (新 agent 实例)
    │                                     │  (只看到"你的实现有以下问题")
    │  <── 修订后的产出 ──                 │
    │                                     │
    ├─ 再次验证                            │
    │  ...                                │
```

## 详细设计

### 1. 文件结构

```
mcp/src/
  orchestrator.ts          # 新增：编排器主逻辑
  orchestrator-prompts.ts  # 新增：prompt 构建（含反馈注入）
  agent-spawner.ts         # 新增：通用 agent 启动器（从 tribunal.ts 抽取）

  # 以下文件保持不变
  phase-enforcer.ts        # 状态机 + 验证逻辑
  state-manager.ts         # 状态持久化
  tribunal.ts              # Tribunal 执行（内部调用 agent-spawner）
  tribunal-schema.ts       # Tribunal schema
  tdd-gate.ts              # TDD 验证
  git-manager.ts           # Git 操作
  template-renderer.ts     # 模板渲染

  index.ts                 # MCP server：保留内部工具，新增 orchestrator 入口
```

### 2. agent-spawner.ts — 通用 Agent 启动器

从 `tribunal.ts` 中抽取 `claude -p` 的调用逻辑，泛化为通用模块。

```typescript
// 核心接口
interface SpawnOptions {
  prompt: string;
  model?: "opus" | "sonnet" | "haiku";
  timeout?: number;           // 默认 300_000 (5min)
  maxBuffer?: number;         // 默认 4MB
  jsonSchema?: object;        // 需要结构化输出时传入
  allowedTools?: string[];    // MCP 工具白名单（空 = 不注册 auto-dev 工具）
  cwd?: string;               // 工作目录
  sessionPersistence?: boolean; // 默认 false
}

interface SpawnResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  parsed?: unknown;           // jsonSchema 模式下的解析结果
  crashed: boolean;
}

// 核心函数
async function spawnAgent(options: SpawnOptions): Promise<SpawnResult>;
async function spawnAgentWithRetry(
  options: SpawnOptions,
  maxRetries?: number
): Promise<SpawnResult>;
```

**关键决策**：task agent 不传 `--json-schema`（因为它产出文件而非结构化响应），tribunal 继续传。

**MCP 工具隔离**：task agent 启动时**不注册** auto-dev MCP server，因此 agent 物理上无法调用 checkpoint、submit 等流程工具。通过 `claude -p` 的 `--mcp-config` 参数控制：

- task agent：不传 `--mcp-config`，或传一个不含 auto-dev 的空配置
- tribunal agent：沿用现有方式（也不需要 auto-dev MCP）

### 3. orchestrator.ts — 编排器主逻辑

```typescript
interface OrchestratorConfig {
  projectRoot: string;
  topic: string;
  mode: "full" | "quick" | "turbo";
  skipE2e?: boolean;
  tdd?: boolean;
  costMode?: "economy" | "beast";
  interactive?: boolean;
  brainstorm?: boolean;
}

// 编排主循环
async function runOrchestrator(config: OrchestratorConfig): Promise<OrchestratorResult> {
  // 1. 初始化（复用现有 init 逻辑）
  const state = await initialize(config);

  // 2. Phase 循环
  while (state.phase <= state.maxPhase) {
    const result = await executePhase(state);

    if (result.status === "PASS") {
      advancePhase(state);
    } else if (result.status === "NEEDS_REVISION") {
      if (state.iterations[state.phase] >= MAX_ITERATIONS[state.phase]) {
        await escalateToHuman(state, result);
        break;
      }
      // 下一轮循环会带反馈重新执行
    } else if (result.status === "BLOCKED") {
      await escalateToHuman(state, result);
      break;
    }
  }

  // 3. 完成验证（复用 auto_dev_complete 逻辑）
  return await finalValidation(state);
}
```

### 4. Phase 执行详细流程

#### Phase 1 — 设计

```
Orchestrator:
  1. render phase1-architect.md prompt (已有模板，无框架引用)
  2. spawn task agent: "请为 {topic} 写技术设计方案"
  3. agent 产出 design.md
  4. 验证: design.md 存在且 >= 100 chars
  5. render phase1-design-reviewer.md prompt
  6. spawn review agent: "请审查 design.md"
  7. agent 产出 design-review.md
  8. 验证: design-review.md 存在，提取 verdict
  9. 如果 NEEDS_REVISION:
     - 把 review 意见注入新 prompt
     - spawn agent: "design-review.md 中指出了以下问题，请修订 design.md"
  10. 如果 PASS: checkpoint + 进入 Phase 2
```

**Agent 视角**：
- 第一轮："请为 XX 功能写一个技术设计方案，输出到 design.md"
- 修订轮："你的设计方案有以下审查意见：[具体问题]。请修订 design.md"
- **看不到**：Phase 1、迭代次数、后续还有 6 个 Phase

#### Phase 2 — 计划

```
Orchestrator:
  1. render phase2-architect.md prompt（注入 design.md 内容摘要）
  2. spawn agent: "请根据 design.md 拆解实施任务，输出 plan.md"
  3. agent 产出 plan.md
  4. render phase2-plan-reviewer.md
  5. spawn review agent: "请审查 plan.md 是否完整覆盖设计"
  6. agent 产出 plan-review.md
  7. 如果 NEEDS_REVISION: 注入 review 意见，spawn 修订 agent
  8. 如果 PASS: checkpoint + 进入 Phase 3
```

#### Phase 3 — 实现（多 task 迭代）

这是最复杂的 phase，因为涉及多个 task 的逐个实现。

```
Orchestrator:
  tasks = parse_tasks(plan.md)
  for task in tasks:
    if tdd:
      # TDD RED
      1. spawn agent: "请为 task N 写失败测试（先不实现功能）"
      2. framework 执行测试，验证确实失败 (exit code != 0)
      3. 如果测试没失败: spawn agent: "测试应该失败但通过了，请检查测试是否正确断言"

      # TDD GREEN
      4. spawn agent: "测试已就绪。请实现功能使测试通过"
      5. framework 执行测试，验证通过
      6. 如果测试没通过: spawn agent: "实现后测试仍失败，错误如下: [stderr]。请修复"
    else:
      # 普通模式
      1. spawn agent: "请实现 plan.md 中的 task N: [task 描述]"
      2. framework 执行 build + test
      3. 如果失败: spawn agent: "编译/测试失败: [错误信息]。请修复"

    # Quick review
    4. spawn review agent: "请审查 task N 的代码变更"
    5. 如果有 P0/P1 问题: spawn agent: "代码审查发现以下问题: [具体问题]。请修复"
```

**Agent 视角**：
- "请实现以下功能：[task 描述]。相关设计见 design.md，实施计划见 plan.md"
- 如果测试失败："编译失败，错误信息如下：[实际 stderr]。请修复"
- **看不到**：这是 Phase 3 的 task 2/5、还有 4 个 Phase

#### Phase 4-7 — Tribunal Phases

```
Orchestrator:
  Phase 4 (Verify):
    1. framework 执行 buildCmd + testCmd
    2. 如果失败: spawn agent: "编译/测试不通过: [错误]。请修复"，回到 Phase 3 修复
    3. 如果通过: 运行 tribunal (复用现有 executeTribunal)
    4. tribunal FAIL: spawn agent: "代码审查发现以下问题: [tribunal issues]。请修复"
    5. tribunal PASS: checkpoint + 进入 Phase 5

  Phase 5 (E2E Test):
    1. spawn agent: "请为 {topic} 设计端到端测试用例"
    2. agent 产出测试设计文档
    3. spawn agent: "请实现这些测试用例"
    4. framework 执行测试
    5. 运行 tribunal
    6. 类似 Phase 4 的反馈循环

  Phase 6 (Acceptance):
    1. spawn agent: "请验证实现是否满足 design.md 中的验收标准"
    2. agent 产出 acceptance-report.md
    3. 运行 tribunal
    4. 类似反馈循环

  Phase 7 (Retrospective):
    1. spawn agent: "请对本次开发过程做回顾审计"
    2. agent 产出 retrospective.md
    3. 运行 tribunal
    4. 记录 lessons
```

### 5. orchestrator-prompts.ts — Prompt 构建

核心职责：将"验证失败"翻译为"技术反馈"。

```typescript
// 反馈注入策略
interface FeedbackInjection {
  type: "revision";               // 修订请求
  originalTask: string;           // 原始任务描述
  feedback: string;               // 具体的技术反馈
  artifacts: string[];            // 需要修改的文件列表
  previousAttemptSummary?: string; // 上次尝试的摘要
}

function buildRevisionPrompt(injection: FeedbackInjection): string {
  return `
你之前的工作有以下需要修订的地方：

${injection.feedback}

请修订以下文件：
${injection.artifacts.map(a => `- ${a}`).join("\n")}

原始任务描述供参考：
${injection.originalTask}
`.trim();
}
```

**翻译规则**：

| 框架内部事件 | Agent 看到的反馈 |
|---|---|
| `checkpoint rejected: PHASE1_REVIEW_MISSING` | "请完成设计审查，输出 design-review.md" |
| `tribunal FAIL: P0 - 缺少调用方审查` | "代码审查发现以下问题：未审查 adaptToZip() 的所有调用方。请补充审查" |
| `framework test exit code != 0` | "测试执行失败，错误信息：[实际 stderr]" |
| `iteration limit reached` | （不翻译给 agent，Orchestrator 直接 escalate 到人工） |
| `regression limit reached` | （同上） |
| `TRIBUNAL_OVERRIDDEN` | "框架验证发现：测试实际未通过。请修复代码使测试通过" |

### 6. Orchestrator 入口方式

有两种入口设计，推荐方案 A：

#### 方案 A：新增 MCP 工具 `auto_dev_orchestrate`（推荐）

在 index.ts 中注册一个新的 MCP 工具：

```typescript
server.tool("auto_dev_orchestrate", {
  projectRoot: z.string(),
  topic: z.string(),
  mode: z.string().optional(),
  skipE2e: z.boolean().optional(),
  tdd: z.boolean().optional(),
  // ...
}, async (params) => {
  // 启动 Orchestrator 主循环
  // 这是一个长时间运行的工具调用
  const result = await runOrchestrator(params);
  return textResult(result);
});
```

**SKILL.md 简化为**：

```markdown
## 流程

1. 调用 `auto_dev_orchestrate` 启动自治开发循环
2. Orchestrator 自动完成全部 Phase
3. 如果需要人工决策，Orchestrator 会返回并说明情况
4. 用户确认后，重新调用 `auto_dev_orchestrate` 继续
```

主 agent 只需调用一个工具，不需要知道内部有几个 Phase。

#### 方案 B：独立 CLI 命令

```bash
node mcp/dist/orchestrator-cli.js --project-root . --topic "feature-x" --mode full
```

完全脱离 Claude Code 的 MCP 框架，作为独立进程运行。

**对比**：

| | 方案 A (MCP 工具) | 方案 B (独立 CLI) |
|---|---|---|
| 用户体验 | 在 Claude Code 会话中直接使用 | 需要切到终端 |
| 人工介入 | 通过工具返回值交互 | 需要终端交互 |
| 实现成本 | 低（复用 MCP 框架） | 中（需要额外的 CLI 解析） |
| Agent 隔离 | 好（主 agent 只看到一个工具调用） | 完美（完全脱离） |

### 7. 与现有系统的兼容性

#### 保留的组件（不改动）

| 组件 | 文件 | 说明 |
|---|---|---|
| 状态机 | phase-enforcer.ts | Orchestrator 直接调用 `computeNextDirective` |
| 状态持久化 | state-manager.ts | Orchestrator 直接调用 `internalCheckpoint` |
| Tribunal | tribunal.ts | Orchestrator 直接调用 `executeTribunal` |
| 模板渲染 | template-renderer.ts | Orchestrator 调用渲染 phase prompt |
| Git 管理 | git-manager.ts | 不变 |
| TDD 验证 | tdd-gate.ts | Orchestrator 调用 `validateRedPhase` / `buildTestCommand` |
| Lessons | lessons-manager.ts | Orchestrator 在 prompt 中注入历史教训 |
| Phase prompts | skills/auto-dev/prompts/*.md | 基本不变（已解耦） |

#### 废弃的组件

| 组件 | 说明 |
|---|---|
| SKILL.md 中的编排循环 | 被 Orchestrator 替代 |
| agent 对 checkpoint/submit 的直接调用 | 被 Orchestrator 内部调用替代 |
| agent 对 preflight 的调用 | 被 Orchestrator 内部决策替代 |
| agent 对 state_get 的调用 | agent 不再需要感知状态 |

#### 保留的 MCP 工具（供主 agent 调用）

| 工具 | 保留原因 |
|---|---|
| `auto_dev_orchestrate` | 新入口（替代旧的手动循环） |
| `auto_dev_init` | 初始化（可被 Orchestrator 内部调用） |
| `auto_dev_state_get` | 人工查看进度时使用 |
| `auto_dev_lessons_get/add` | Orchestrator 内部使用 |

#### 可选废弃的 MCP 工具

| 工具 | 说明 |
|---|---|
| `auto_dev_preflight` | Orchestrator 内部决策，不需要暴露 |
| `auto_dev_checkpoint` | Orchestrator 内部调用 `internalCheckpoint` |
| `auto_dev_submit` | Orchestrator 内部调用 `executeTribunal` |
| `auto_dev_tribunal_verdict` | Orchestrator 内部处理 crash fallback |
| `auto_dev_render` | Orchestrator 内部渲染 |
| `auto_dev_task_red/green` | Orchestrator 内部执行 TDD 验证 |

### 8. Phase Prompt 改动

现有 phase prompt 已经高度解耦，只需要**微调**：

#### 需要改动的

1. **移除残留的框架引用**：扫描所有 `prompts/*.md`，移除任何提到 checkpoint、phase 编号、tribunal 的文字
2. **统一输出约定**：每个 prompt 末尾明确说"完成后不需要做其他操作"（防止 agent 尝试调用不存在的工具）

#### 不需要改动的

- 任务描述本身
- 输入/输出文件路径
- 审查标准和 checklist
- Anti-laziness 规则（这些仍然有效，因为它们约束的是工作质量而非流程遵循）

### 9. Task Agent 的工具权限

Task agent 通过 `claude -p` 启动时，**不加载 auto-dev MCP server**：

```typescript
const args = [
  "-p", prompt,
  "--model", model,
  "--dangerously-skip-permissions",
  "--no-session-persistence",
  // 注意：不传 --mcp-config，或传一个空的 mcp config
];
```

Agent 可用的工具：
- 文件读写（Read/Write/Edit）
- Bash 命令（编译、运行测试等）
- Grep/Glob（搜索代码）
- **不可用**：auto_dev_checkpoint、auto_dev_submit 等所有流程工具

这实现了**物理隔离**：agent 即使"想"调用流程工具也调用不了。

### 10. 人工介入机制

Orchestrator 在以下情况返回给主 agent，等待人工决策：

| 触发条件 | 返回信息 |
|---|---|
| 迭代次数耗尽 | "设计方案经过 3 轮修订仍未通过审查。主要问题：[...]。请人工决定：继续修订 / 调整方向 / 降低标准" |
| 回退次数耗尽 | "代码审查连续不通过，已回退 2 次。核心问题：[...]" |
| Tribunal 连续 3 次 FAIL | "独立审查连续 3 次未通过。最后一次的问题：[...]" |
| Tribunal 崩溃且 fallback 失败 | "验证进程异常，需要人工确认" |
| 最终验证失败 | "所有 Phase 通过但最终编译/测试失败。错误：[...]" |

### 11. Token 成本考量

**增加的成本**：
- 每个 task agent 都是独立上下文，无法复用前序对话中的 cache
- 修订轮需要重新注入上下文

**减少的成本**：
- agent 不再需要理解和执行复杂的编排逻辑（SKILL.md 有 1400 行）
- 没有 checkpoint 调用失败 → 重试 → 调整 的 token 浪费
- 没有 agent 尝试 gaming 系统的额外 token 消耗

**优化策略**：
- Orchestrator 只注入当前 task 需要的最小上下文（不注入完整 design.md）
- 修订轮只注入 diff 和反馈，不重复原始 prompt
- 对于 Phase 3 的多 task，共享 `plan.md` 作为 system prompt 的一部分

### 12. 长时间运行的处理

`auto_dev_orchestrate` 可能运行数十分钟。处理策略：

1. **进度上报**：Orchestrator 通过 MCP server 的 notification 机制定期上报进度
2. **断点恢复**：每个 Phase 完成后写 checkpoint，中断后可从上次 checkpoint 恢复
3. **超时保护**：总时间限制（默认 30 分钟），超时后返回当前状态

## 实施计划

### Phase 1：抽取 agent-spawner（2 个文件，~150 行）

**目标**：从 tribunal.ts 抽取通用的 claude 进程启动能力

1. 创建 `mcp/src/agent-spawner.ts`
   - 抽取 `resolveClaudePath` / `getClaudePath`
   - 实现 `spawnAgent(options)` 和 `spawnAgentWithRetry(options, maxRetries)`
   - 参数化 model、timeout、jsonSchema、allowedTools
2. 重构 `tribunal.ts`
   - `runTribunal` 改为调用 `spawnAgent`
   - 移除重复的 claude 路径解析逻辑
3. 测试
   - 确保 tribunal 仍然正常工作（回归测试）
   - 测试 spawnAgent 的基本功能

### Phase 2：实现 orchestrator-prompts（1 个文件，~200 行）

**目标**：实现反馈翻译层

1. 创建 `mcp/src/orchestrator-prompts.ts`
   - 实现 `buildTaskPrompt(phase, context)` — 从 phase prompt 构建纯任务 prompt
   - 实现 `buildRevisionPrompt(feedback, context)` — 将验证失败翻译为技术反馈
   - 实现 `buildContextInjection(state)` — 构建最小上下文摘要
2. 测试
   - 验证生成的 prompt 不含框架术语（Phase、checkpoint、tribunal 等）
   - 验证反馈注入的格式正确

### Phase 3：实现 orchestrator 核心循环（1 个文件，~400 行）

**目标**：实现完整的编排逻辑

1. 创建 `mcp/src/orchestrator.ts`
   - 实现 `runOrchestrator(config)` 主循环
   - 实现各 phase 的执行逻辑（调用 agent-spawner + 验证 + 反馈）
   - 复用 `phase-enforcer.ts` 的状态机逻辑
   - 复用 `state-manager.ts` 的 checkpoint 逻辑
   - 复用 `tribunal.ts` 的 tribunal 执行逻辑
2. 实现 Phase 3 多 task 迭代
   - TDD 模式：RED → (framework verify fail) → GREEN → (framework verify pass)
   - 普通模式：实现 → (framework verify)
3. 实现人工介入返回机制
4. 测试
   - 单元测试各 phase 的执行流程
   - 集成测试：mock spawnAgent，验证完整循环

### Phase 4：注册 MCP 工具 + 简化 SKILL.md（2 个文件改动）

**目标**：接入主 agent 可调用的入口

1. 在 `index.ts` 中注册 `auto_dev_orchestrate` 工具
2. 重写 SKILL.md：
   - 从 1400 行减到 ~100 行
   - 只描述 `auto_dev_orchestrate` 的调用方式和参数
   - 不暴露任何内部 phase 信息
3. 保留旧 SKILL.md 为 `SKILL.legacy.md`（渐进迁移期可切回）
4. 测试
   - 端到端测试：通过 `/auto-dev` 触发完整流程

### Phase 5：Phase prompt 清理 + 回归验证

**目标**：确保 phase prompt 无框架泄露

1. 扫描所有 `prompts/*.md`，移除框架引用
2. 添加 lint 规则：禁止 prompt 中出现 `checkpoint`、`phase [0-9]`、`tribunal`、`submit` 等关键词
3. 全流程回归测试

## 风险与缓解

| 风险 | 影响 | 缓解措施 |
|---|---|---|
| Task agent 上下文不足，产出质量下降 | 中 | Orchestrator 注入精确的最小上下文；修订轮带入前次产出 |
| `claude -p` 的 token 限制导致大型项目失败 | 中 | 分 task 执行；每个 agent 只处理增量变更 |
| Orchestrator 长时间运行中断 | 低 | 每 phase 后 checkpoint，支持断点恢复 |
| 新老模式切换期兼容性问题 | 低 | 保留 SKILL.legacy.md，支持 `--legacy` 参数 |
| Task agent 仍然可能产出低质量工作 | 中 | Hard data 验证（测试、编译）不变；tribunal 不变；但 agent 没有 gaming 动机 |

## 验收标准

- **AC-1**：Task agent 的 prompt 中不含 "phase"、"checkpoint"、"tribunal"、"submit"、"迭代限制" 等框架术语
- **AC-2**：Task agent 无法调用 auto_dev_checkpoint、auto_dev_submit 等 MCP 工具（物理隔离）
- **AC-3**：现有全部 hard data 验证仍然有效（framework 执行测试、INIT hash、cross-validation）
- **AC-4**：Tribunal 仍然独立运行，结果不受 task agent 影响
- **AC-5**：从 `/auto-dev` 触发可完成完整的 full mode 流程
- **AC-6**：迭代次数耗尽时正确 escalate 到人工
- **AC-7**：SKILL.md 行数 < 150 行（当前 1400 行）
- **AC-8**：支持 `--legacy` 参数切回旧模式
