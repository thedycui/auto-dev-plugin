# 设计文档：断路器机制 — 预案制 + 清零重启

## 一、问题

Agent 在执行任务时，遇到失败会反复用相同方法重试（如 npm install vitest 重试 6 次），原因：

1. **锚定效应**：context 里充满失败细节，思维被当前方案锁定
2. **缺乏退出机制**：框架只有 iteration 计数，没有方案级别的熔断
3. **没有预案**：失败后才临时想替代方案，但在锚定状态下想不出来

## 二、设计目标

1. 执行前必须准备备选方案（预案制）
2. 同一方案失败 2 次后，自动切换到备选方案（断路器）
3. 切换时使用新 agent，不继承失败 context（清零重启）
4. 所有方案耗尽后 BLOCKED，交给人

## 三、核心概念

### 3.1 方案（Approach）

一个方案是解决某个 step 的具体技术路径。例如：

```
Step: 为 Guide.vue 编写验证测试

方案 A（主）: 安装 vitest + jsdom，编写 Vue 组件测试
方案 B（备）: 纯 Node.js 脚本，import 逻辑函数直接验证
方案 C（备）: 编译验证 + 运行时 Playwright 截图对比
```

### 3.2 断路器状态

```
CLOSED  → 正常执行当前方案
OPEN    → 当前方案熔断（失败 2 次），切换到下一个方案
BLOCKED → 所有方案耗尽，需要人工介入
```

### 3.3 生命周期

```
Step 开始
  │
  ├─ 1. Agent 输出方案列表（主 + 1~2 个备选）
  │     写入 {output_dir}/approach-plan.md
  │
  ├─ 2. 执行主方案
  │     ├─ 成功 → Step 完成
  │     ├─ 失败第 1 次 → 分析原因，修正后重试
  │     └─ 失败第 2 次 → 熔断主方案
  │
  ├─ 3. 熔断：spawn 新 agent
  │     ├─ prompt 只包含：原始目标 + 禁用列表 + 备选方案 B
  │     ├─ 不包含：主方案的执行细节和失败日志
  │     └─ 新 agent 执行备选方案 B
  │           ├─ 成功 → Step 完成
  │           ├─ 失败 2 次 → 熔断方案 B
  │           └─ 继续下一个备选...
  │
  └─ 4. 所有方案耗尽 → BLOCKED
```

## 四、详细设计

### 4.1 approach-plan.md 格式

Agent 在执行任务前，必须先输出方案计划：

```markdown
## 目标
为 Guide.vue 的 API Key 安装流程编写验证测试

## 主方案
- **方法**: 安装 vitest + @vue/test-utils，编写组件单元测试
- **前提**: Node >= 20.19.0, npm install 正常
- **风险**: Node 版本可能不兼容

## 备选方案 A
- **方法**: 纯 Node.js 脚本，提取核心逻辑函数单独测试
- **前提**: 无额外依赖
- **适用**: 主方案安装失败时

## 备选方案 B
- **方法**: npm run build 编译验证 + 代码静态审查（grep 关键逻辑）
- **前提**: 无
- **适用**: 无法运行任何测试框架时
```

### 4.2 状态持久化

在 state.json 中新增 `approachState` 字段：

```typescript
interface ApproachState {
  // 当前 step 的方案跟踪
  stepId: string              // 如 "5b", "3"
  approaches: Approach[]      // 方案列表
  currentIndex: number        // 当前方案索引（0 = 主方案）
  failedApproaches: FailedApproach[]  // 已熔断的方案
}

interface Approach {
  id: string                  // "primary", "alt-a", "alt-b"
  summary: string             // 一句话描述
  failCount: number           // 当前方案失败次数
  maxRetries: number          // 固定为 2
}

interface FailedApproach {
  id: string
  summary: string
  failReason: string          // 一句话失败原因
}
```

### 4.3 orchestrator 改动

#### computeNextTask() 新增逻辑

```typescript
// 在 step validation 失败时
function handleStepFailure(step, error) {
  const approach = state.approachState

  if (!approach) {
    // 第一次执行，还没有方案计划 → 正常 revision
    return buildRevisionPrompt(error)
  }

  const current = approach.approaches[approach.currentIndex]
  current.failCount++

  if (current.failCount < current.maxRetries) {
    // 还在阈值内 → 正常 revision prompt
    return buildRevisionPrompt(error)
  }

  // 熔断！
  approach.failedApproaches.push({
    id: current.id,
    summary: current.summary,
    failReason: extractOneLineReason(error)
  })
  approach.currentIndex++

  if (approach.currentIndex >= approach.approaches.length) {
    // 所有方案耗尽
    return { action: "BLOCK", reason: "所有方案均已失败" }
  }

  // 切换到下一个方案 → 清零重启
  return {
    action: "CIRCUIT_BREAK",
    nextApproach: approach.approaches[approach.currentIndex],
    constraints: approach.failedApproaches
  }
}
```

#### 清零重启：spawn 新 agent

当 `action === "CIRCUIT_BREAK"` 时，orchestrator 不给当前 agent 发 revision prompt，而是：

```typescript
function circuitBreak(step, nextApproach, failedApproaches) {
  // 构建清零 prompt — 只包含目标和约束，不包含失败细节
  const prompt = buildCircuitBreakPrompt({
    // 原始目标
    goal: step.originalGoal,

    // 备选方案
    approach: nextApproach.summary,

    // 禁用列表（只有一句话原因，不带细节）
    prohibited: failedApproaches.map(f =>
      `禁止: ${f.summary}（原因: ${f.failReason}）`
    ),

    // 不包含：之前的执行日志、错误堆栈、文件修改历史
  })

  // 用新 agent 执行（关键：不继承 context）
  return {
    agent: step.agent,
    prompt: prompt,
    freshContext: true  // 标记使用新 agent
  }
}
```

#### 清零 prompt 模板

```markdown
# 任务

{goal}

## 方案

请按以下方案执行：
{approach}

## 约束（以下方案已失败，禁止使用）

{prohibited}

## 要求

- 不要尝试任何已禁止的方案
- 如果当前方案也遇到困难，先分析根因再决定下一步
- 产出文件: {output_files}
```

### 4.4 developer prompt 改动

在 phase3-developer.md 和其他执行类 prompt 中，新增方案计划要求：

```markdown
## 执行前：方案计划

在开始编码/测试之前，先输出方案计划到 {output_dir}/approach-plan.md：

1. 主方案 + 1~2 个备选方案
2. 每个方案标注前提条件和风险
3. 备选方案应与主方案在技术路径上有本质区别
   （换参数/换 flag 不算，换工具/换思路才算）

## 执行中：失败处理

- 同一操作（如 npm install、编译、API 调用）连续失败 2 次 → 停止
- 分析根因，判断是否可修复
- 不可修复 → 在 approach-plan.md 中标记当前方案失败，切换到备选方案
- 严禁：同一命令换 flag 重试超过 2 次（--force、--legacy-peer-deps 等算同一方案）
```

### 4.5 方案验证规则

什么算"不同方案"？orchestrator 需要验证：

```
同一方案的变体（不算不同方案）:
  - npm install vitest --force
  - npm install vitest --legacy-peer-deps
  - rm node_modules && npm install vitest
  → 都是"安装 vitest"，工具和目标相同

真正不同的方案:
  - 安装 vitest → 纯 Node.js 脚本（换工具）
  - 安装 vitest → 编译验证 + 静态检查（换策略）
  - 本地测试 → 部署后远程测试（换环境）
```

验证方式：在 approach-plan.md 中要求每个方案标注**核心工具/技术**，orchestrator 检查备选方案的核心工具与主方案不同。

## 五、改动范围

| 文件 | 改动 | 预估行数 |
|------|------|---------|
| mcp/src/types.ts | 新增 ApproachState 类型 | ~20 |
| mcp/src/state-manager.ts | approachState 持久化/读取 | ~15 |
| mcp/src/orchestrator.ts | handleStepFailure、circuitBreak 逻辑 | ~60 |
| mcp/src/orchestrator-prompts.ts | buildCircuitBreakPrompt 模板 | ~30 |
| prompts/phase3-developer.md | 新增方案计划要求 | ~15 |
| prompts/phase5-test-developer.md | 新增方案计划要求 | ~10 |
| prompts/phase8-integration-test.md | 新增方案计划要求 | ~10 |
| **合计** | | **~160** |

## 六、与现有机制的关系

| 现有机制 | 断路器如何集成 |
|---------|--------------|
| iteration 计数 | 保留。iteration 跟踪 step 级别的重试，approachState 跟踪方案级别的切换。iteration 上限 = 方案数 × 2 |
| tribunal | 不变。tribunal 在方案切换后仍然审查最终结果 |
| revision prompt | 方案内失败用 revision prompt，方案间切换用 circuit break prompt |
| BLOCKED | 所有方案耗尽 → BLOCKED，与现有 BLOCKED 逻辑合并 |

## 七、示例流程

```
Step 5b: 编写测试

1. Developer agent 输出 approach-plan.md:
   主方案: vitest + jsdom
   备选 A: 纯 Node.js 脚本
   备选 B: 编译验证

2. 执行主方案:
   npm install vitest → 失败（Node 版本不兼容）
   failCount = 1, revision: "检查 Node 版本"
   npm install vitest@1.6.0 → 失败（依赖链同样不兼容）
   failCount = 2 → 熔断！

3. Circuit Break:
   spawn 新 agent, prompt:
     "目标: 为 Guide.vue 编写验证测试
      方案: 纯 Node.js 脚本，import 逻辑函数直接验证
      禁止: 安装 vitest（Node v20.16.0 不兼容 jsdom 29.x）"

4. 新 agent 执行备选 A:
   写 test.mjs, 直接 node --experimental-vm-modules test.mjs
   测试通过 → Step 5b 完成

5. 如果备选 A 也失败 2 次 → 熔断，spawn 第三个 agent 用备选 B
6. 备选 B 也失败 → BLOCKED
```

## 八、不做的事情

1. **不做自动方案生成** — 方案由 agent 基于实际情况制定，框架只强制要求有备选
2. **不做方案质量审查** — 不用 tribunal 审方案（过重），只检查数量和差异性
3. **不做跨 step 的方案共享** — 每个 step 独立管理自己的方案状态
4. **不做回退恢复** — 熔断后不尝试回退代码，新 agent 在当前代码状态上继续
