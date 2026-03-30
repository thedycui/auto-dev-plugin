# 设计文档：Step Orchestrator（步进式编排器）

## 问题回顾

策略 A（`claude -p` 物理隔离）在实测中失败：task agent 没有项目上下文、没有 MCP 工具、无法探索代码，5 分钟内完不成任何有意义的工作。而主 agent 手动接管后表现优异，没有任何 gaming 行为。

核心教训：**隔离能力比隔离感知的代价大得多。**

## 设计目标

- **G1**：Subagent 保留完整能力（Read/Write/Bash/Grep/Agent 等全部工具）
- **G2**：Subagent 收到的 prompt 不含框架术语（复用已清理的 phase prompt）
- **G3**：框架控制流程推进、验证、重试，主 agent 只做"调度员"
- **G4**：最小改动——复用现有 orchestrator.ts 的验证逻辑和 phase prompt

## 核心概念：Step Function

把 `auto_dev_orchestrate`（长时间运行的循环）改为 `auto_dev_next`（每次调用返回一个任务）：

```
auto_dev_orchestrate (旧，已废弃):
  MCP 工具内部跑完整循环 → 用 claude -p 派 agent → agent 能力被阉割

auto_dev_next (新):
  每次调用 → 验证上一步产出 → 返回下一个任务 prompt → 主 agent 派 subagent 执行
  Subagent 通过 Agent() 启动，保留完整能力
```

## 交互流程

```
主 Agent                              auto_dev_next (MCP)
  │                                        │
  │── next(topic) ───────────────────────> │
  │                                        │  检查 state: phase=0, 无 design.md
  │                                        │  渲染 phase1-architect prompt
  │ <── { task, agentType, model } ────── │
  │                                        │
  │  Agent(type=architect, prompt=task)    │
  │  → subagent 探索代码、写 design.md     │
  │  → subagent 完成返回                   │
  │                                        │
  │── next(topic) ───────────────────────> │
  │                                        │  检查: design.md 存在且 >= 100 chars ✓
  │                                        │  渲染 phase1-design-reviewer prompt
  │ <── { task, agentType, model } ────── │
  │                                        │
  │  Agent(type=reviewer, prompt=task)    │
  │  → subagent 审查 design.md             │
  │  → subagent 完成返回                   │
  │                                        │
  │── next(topic) ───────────────────────> │
  │                                        │  检查: design-review.md 存在
  │                                        │  解析 verdict: PASS
  │                                        │  写 checkpoint(phase=1, PASS)
  │                                        │  渲染 phase2-planner prompt
  │ <── { task, agentType, model } ────── │
  │                                        │
  │  ...继续...                            │
  │                                        │
  │── next(topic) ───────────────────────> │
  │                                        │  检查: 所有 phase 完成
  │ <── { done: true, summary } ────────── │
```

## auto_dev_next 返回值

```typescript
interface NextTaskResult {
  // 是否还有任务
  done: boolean;

  // 任务 prompt（纯技术描述，无框架术语）
  task?: string;

  // 建议的 subagent 类型（主 agent 用 Agent() 派发）
  agentType?: string;

  // 建议的模型
  model?: "opus" | "sonnet";

  // 人工介入（done=false 且无 task 时）
  escalation?: {
    reason: string;
    feedback: string;
  };

  // 完成摘要（done=true 时）
  summary?: string;
}
```

## 内部状态机

`auto_dev_next` 每次被调用时：

1. **读取当前状态**（state.json）
2. **验证上一步产出**：
   - 如果是 Phase 1 首次调用 → 无需验证，直接返回设计任务
   - 如果上一步是"写 design.md" → 检查 design.md 是否存在且有效
   - 如果上一步是"审查 design.md" → 检查 design-review.md，解析 verdict
   - 如果上一步是"实现 task N" → 运行 build+test
   - 如果是 tribunal phase → 运行 executeTribunal
3. **决定下一步**：
   - 验证通过 → 推进到下一个 sub-step 或下一个 phase
   - 验证失败 → 返回修订任务（附带翻译后的技术反馈）
   - 迭代耗尽 → 返回 escalation
   - 全部完成 → 返回 done=true
4. **渲染下一步 prompt**（复用已清理的 phase prompt 模板）
5. **写 checkpoint**（如果 phase 推进了）

## Sub-step 分解

每个 Phase 不再是一个原子操作，而是拆成多个 sub-step：

```
Phase 1:
  step 1a: 设计（architect prompt → 产出 design.md）
  step 1b: 审查（reviewer prompt → 产出 design-review.md）
  step 1c: [可选] 修订（revision prompt → 更新 design.md）→ 回到 1b

Phase 2:
  step 2a: 规划（planner prompt → 产出 plan.md）
  step 2b: 审查（reviewer prompt → 产出 plan-review.md）
  step 2c: [可选] 修订 → 回到 2b

Phase 3:
  step 3a: 实现 task 1（developer prompt → 代码变更）
  step 3b: 实现 task 2 ...
  step 3n: 实现 task N
  (每个 task 后 framework 自动跑 build+test)

Phase 4: (tribunal)
  step 4a: framework 跑 build+test + tribunal
  step 4b: [如果 FAIL] 修复任务 → 回到 4a

Phase 5-7: 类似 Phase 4
```

## State 扩展

在 state.json 中新增 `step` 字段追踪 sub-step：

```typescript
// 新增字段
interface StepState {
  phase: number;          // 当前 phase
  step: string;           // 当前 sub-step，如 "1a", "1b", "3a-task2"
  stepIteration: number;  // 当前 step 的修订次数
  lastValidation?: {      // 上次验证结果
    passed: boolean;
    feedback?: string;
  };
}
```

## 改动范围

### 改什么

| 文件 | 改动 |
|------|------|
| `mcp/src/orchestrator.ts` | 重写：从 long-running loop 改为 step function `computeNextTask()` |
| `mcp/src/index.ts` | 替换 `auto_dev_orchestrate` 为 `auto_dev_next` |
| `skills/auto-dev/SKILL.md` | 更新：描述 init → next 循环 + Agent() 派发 |

### 不改什么

| 文件 | 原因 |
|------|------|
| `agent-spawner.ts` | 保留（tribunal 仍用 claude -p，这是合理的——tribunal 不需要探索代码） |
| `orchestrator-prompts.ts` | 保留（反馈翻译逻辑不变） |
| `phase-enforcer.ts` | 保留（验证逻辑不变） |
| `state-manager.ts` | 保留（checkpoint 逻辑不变） |
| `tribunal.ts` | 保留（tribunal 仍用独立 claude -p 进程，这是正确的隔离） |
| `prompts/*.md` | 保留（已清理框架术语） |

### 废弃什么

| 组件 | 原因 |
|------|------|
| `runOrchestrator()` | 被 `computeNextTask()` 替代 |
| `OrchestratorPhaseRunner.spawn()` | 不再 spawn claude -p，由主 agent 派 subagent |
| `auto_dev_orchestrate` MCP 工具 | 被 `auto_dev_next` 替代 |

## SKILL.md 新内容

```markdown
## 使用方式

1. `auto_dev_init(projectRoot, topic, mode?, ...)`
2. 循环:
   ```
   result = auto_dev_next(projectRoot, topic)
   while !result.done:
     if result.task:
       Agent(subagent_type=result.agentType, prompt=result.task, model=result.model)
     elif result.escalation:
       告知用户需要人工介入
       break
     result = auto_dev_next(projectRoot, topic)
   ```
3. result.done == true 时，流程完成
```

主 agent 只看到一个简单循环：调 next → 派 subagent → 调 next。不知道有几个 phase，不知道 tribunal 存在。

## Turbo 模式的修复

turbo 模式跳过 Phase 1/2，直接进 Phase 3。当 plan.md 不存在时，`computeNextTask` 应该：

1. 把 topic 描述作为唯一任务
2. 不要求 plan.md 存在
3. 返回一个 "请实现 {topic} 功能" 的 prompt

## 验收标准

- **AC-1**：Subagent 通过 Agent() 启动，保留完整工具能力
- **AC-2**：Subagent 的 prompt 不含框架术语
- **AC-3**：`auto_dev_next` 每次调用返回一个任务，不阻塞
- **AC-4**：支持 full/quick/turbo 三种模式
- **AC-5**：turbo 模式无 plan.md 时正常工作
- **AC-6**：tribunal phase 仍用独立 claude -p（隔离合理）
- **AC-7**：迭代耗尽时返回 escalation 而非死循环
- **AC-8**：SKILL.md 描述的循环不超过 20 行
