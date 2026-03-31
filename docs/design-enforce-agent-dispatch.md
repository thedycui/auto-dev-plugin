# 设计文档：强制 agent 按框架调度执行

## 1. 背景与目标

### 背景

在 metrics-frontend 任务中，主 agent 绕过了 auto-dev 的 agent 调度机制：
- Phase 3 应由 `auto-dev-developer` 子 agent 执行，主 agent 却自己 Edit/Write 代码后强行 checkpoint PASS
- Phase 4-7 走过场或直接跳过
- checkpoint 返回的 mandate 被忽略

根因分析见对话上下文。核心问题：框架返回的 `agent` 字段只是建议字符串，没有强制约束；Skill prompt 是教程式示例，agent 觉得"自己做更快"就跳过了。

### 目标

1. 让主 agent 严格按照 `init → next → dispatch agent → next → ...` 循环执行
2. 框架返回值中增加不可忽略的 mandate，明确主 agent 是调度者不是执行者
3. Skill prompt 从"示例教程"改为"强制规则"

### Non-Goals

- 不通过 Hook 拦截 git/Edit 操作（不是拦截，是让 agent 从认知上遵守）
- 不改变 orchestrator 的步骤流转逻辑
- 不改变 subagent 的 prompt 模板

## 2. 现状分析

### `auto_dev_next` 返回值

```typescript
{
  done: false,
  step: "3",
  agent: "auto-dev-developer",  // 只是建议
  prompt: "请实现...",            // agent 可以自己执行这个 prompt
  message: "Step 3: 开始实现"     // 无约束力
}
```

`agent` 字段是纯信息，没有 mandate。主 agent 可以忽略 `agent` 建议，自己执行 `prompt`。

### SKILL.md

当前是教程式写法（"你可以这样做"），agent 解读为"建议"而非"规则"。

### NextTaskResult 接口

没有 `mandate` 字段。mandate 只在 checkpoint 的错误返回中出现。

## 3. 方案设计

| 方案 | 描述 | 优点 | 缺点 |
|------|------|------|------|
| A: 出口统一注入 mandate | 在 `computeNextTask` 返回前统一对所有含 `agent` 的结果注入 mandate | 改动集中，一处修改覆盖所有 9 个返回点 | 需要改 NextTaskResult 接口 |
| B: 每个返回点手动加 | 在 9 个 `agent: STEP_AGENTS[...]` 的返回点各自加 mandate | 不需要改接口 | 9 处改动，容易遗漏 |

**选择方案 A**，理由：改动集中、不容易遗漏、可维护性好。

## 4. 详细设计

### 4.1 NextTaskResult 接口增加 mandate 字段

```typescript
export interface NextTaskResult {
  // ... existing fields ...
  /** Mandatory instruction for the main agent — MUST be followed */
  mandate?: string;
}
```

### 4.2 computeNextTask 出口注入 mandate

在 `computeNextTask` 函数的 return 前（或在 `auto_dev_next` tool handler 中），统一注入：

```typescript
// 在 index.ts 的 auto_dev_next handler 中
const result = await computeNextTask(projectRoot, topic);
if (result.agent && result.prompt) {
  result.mandate =
    `[MANDATORY] 你是 orchestrator（调度器），不是执行者。` +
    `必须使用 Agent tool 将此任务派发给 ${result.agent} 子 agent。` +
    `禁止自己执行 prompt 中的任务（禁止直接 Edit/Write 项目源码、禁止自己跑测试、禁止自己写文档）。` +
    `子 agent 完成后，立即调用 auto_dev_next(projectRoot, topic) 获取下一步。`;
}
```

选择在 `index.ts` 而非 `orchestrator.ts` 中注入，因为这是展示层逻辑（给主 agent 看的），不属于步骤流转逻辑。

### 4.3 SKILL.md 改为强制规则

将"循环执行"部分从示例代码改为**强制规则 + 禁止事项**：

```markdown
## 强制规则（违反任何一条 = 流程作废）

1. **你是纯调度器。** 你的唯一职责：
   - 调用 `auto_dev_next` 获取任务
   - 用 `Agent(subagent_type=result.agent, prompt=result.prompt)` 派发子 agent
   - 子 agent 完成后再调用 `auto_dev_next`

2. **禁止事项：**
   - ❌ 自己执行 prompt 中的任务（禁止 Edit/Write 项目源码）
   - ❌ 跳过任何 step（每个 step 都必须走完）
   - ❌ 在 auto-dev 流程完成前（done=true 之前）执行 git push 或部署
   - ❌ 不调用 auto_dev_next 就宣称任务完成

3. **mandate 字段不可忽略。** auto_dev_next 和 checkpoint 返回的 mandate 是强制指令，必须遵从。
```

### 4.4 checkpoint mandate 具体化

当前 checkpoint 返回的 mandate 是抽象的（"必须执行 Phase 4"），改为具体动作：

```
旧: [MANDATORY] Phase 3 已通过。必须立即执行 Phase 4 (编译测试验证)。禁止跳过，禁止向用户宣称任务完成。
新: [MANDATORY] Phase 3 已通过。现在立即调用 auto_dev_next(projectRoot, topic) 进入下一步。禁止做其他任何操作（禁止 git push、禁止部署、禁止向用户宣称完成）。
```

## 5. 改动范围

| 文件 | 改动 |
|------|------|
| `mcp/src/orchestrator.ts` | NextTaskResult 接口增加 `mandate?` 字段 |
| `mcp/src/index.ts` | auto_dev_next handler 中注入 mandate；checkpoint mandate 具体化 |
| `skills/auto-dev/SKILL.md` | "循环执行"部分改为强制规则 |

## 6. 风险与缓解

| 风险 | 缓解措施 |
|------|---------|
| mandate 文字太长，agent 忽略 | 控制在 2-3 句，关键词大写加方括号 |
| 破坏现有返回值结构 | mandate 是可选字段，不影响已有逻辑 |
| 过度约束导致 agent 不够灵活 | 只约束"不能自己执行"，不约束 agent 的判断和沟通 |

## 7. 验收标准

| AC | 描述 | 验证方式 |
|----|------|---------|
| AC-1 | auto_dev_next 返回含 agent 的结果时，mandate 字段非空且包含"Agent tool"和"禁止" | 代码审查 + 单元测试 |
| AC-2 | SKILL.md 包含"强制规则"和"禁止事项"章节 | 代码审查 |
| AC-3 | checkpoint 的 mandate 包含具体动作"auto_dev_next" 而非抽象的"执行 Phase N" | 代码审查 |
| AC-4 | 编译通过 | `npm run build` |
