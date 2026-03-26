# 设计文档：断路器机制（Circuit Breaker）

## 1. 背景与目标

### 1.1 问题

Agent 在执行 step 时，遇到失败会反复用相同方法重试。典型场景：

- `npm install vitest` 因 Node 版本不兼容失败，agent 连续尝试 `--force`、`--legacy-peer-deps`、`rm node_modules` 等变体，本质上都是"安装 vitest"这条路径
- 失败 context 越积越多，agent 思维被锚定在当前方案上，无法跳出来选择替代路径

**根因分析**：

1. **锚定效应** -- context 中充满失败细节，agent 思维被当前方案锁定
2. **缺乏方案级退出机制** -- 现有 `MAX_STEP_ITERATIONS = 3` 只控制 step 级别的重试上限，没有方案粒度的熔断
3. **没有预案** -- 失败后才临时想替代方案，但在被锚定的 context 中很难跳出来

### 1.2 目标

1. 执行前要求 agent 准备备选方案（预案制）
2. 同一方案连续失败 N 次后，自动切换到备选方案（断路器）
3. 切换时构建干净的 prompt，不继承失败 context（清零重启）
4. 所有方案耗尽后标记 BLOCKED，交给人工介入

### 1.3 Non-Goals

1. **不做自动方案生成** -- 方案由 agent 基于实际环境制定，框架只强制要求有备选
2. **不做方案质量审查** -- 不用 tribunal 审方案（过重），只检查数量和差异性
3. **不做跨 step 的方案共享** -- 每个 step 独立管理自己的方案状态
4. **不做代码回退** -- 熔断后不回退代码，新 prompt 在当前代码状态上继续
5. **不做 "spawn 新 agent"** -- 当前架构中 orchestrator 不控制 agent 生命周期，只返回 prompt；清零通过构建不含失败细节的 prompt 实现

## 2. 现状分析

### 2.1 现有重试机制

`orchestrator.ts` 中的 `computeNextTask()` 处理 step 失败的流程：

```
validateStep() 返回 {passed: false, feedback}
  -> 检查 stepIteration >= MAX_STEP_ITERATIONS (3)
     -> 超限: 返回 escalation, 标记 BLOCKED
     -> 未超限: stepIteration++, 返回 revision prompt
```

关键数据结构（`StepState`，存储在 state.json 的扩展字段中）：

```typescript
interface StepState {
  step: string | null;        // 当前 step，如 "3", "5b"
  stepIteration: number;      // 当前 step 的重试次数
  lastValidation: string | null; // 上次验证结果
}
```

### 2.2 现有 prompt 构建

- `buildRevisionPrompt()` 接收 `{originalTask, feedback, artifacts}` 构建修订 prompt
- `buildTaskForStep()` 根据 step 类型选择 prompt 模板或直接拼装
- `translateFailureToFeedback()` 将框架错误码转为技术反馈文本

### 2.3 关键约束

1. **Orchestrator 是纯计算函数** -- `computeNextTask()` 不 spawn agent，只返回 `{prompt, agent, step}` 给主 agent 调度
2. **StepState 不在 Zod schema 中** -- 通过 `readStepState()` / `writeStepState()` 直接读写 JSON 扩展字段
3. **Invisible Framework 原则** -- agent 看到的 prompt 中不能出现框架术语（checkpoint、tribunal 等）

## 3. 方案设计

### 方案 A：Orchestrator 内置断路器（推荐）

**思路**：在 `computeNextTask()` 的失败处理逻辑中增加方案跟踪。方案信息持久化在 state.json 扩展字段中，prompt 中通过约定格式要求 agent 输出 `approach-plan.md`。

**数据流**：

```
Step 首次执行:
  buildTaskForStep() 在 prompt 末尾附加"方案计划要求"
  -> agent 执行任务，输出 approach-plan.md + 实际产物

Step 验证失败:
  computeNextTask() 读取 approach-plan.md 解析方案列表
  -> 判断当前方案 failCount
     -> 未达阈值: 返回 revision prompt（现有逻辑）
     -> 达到阈值: 构建 circuit-break prompt（清零 prompt）
        -> 不含失败细节，只含目标 + 下一个方案 + 禁用列表
     -> 方案耗尽: escalation / BLOCKED
```

**优点**：
- 改动集中在 orchestrator.ts，对其他模块影响小
- 方案解析在 orchestrator 侧完成，agent 只需按格式写 approach-plan.md
- 完全兼容现有 stepIteration 机制（断路器是 stepIteration 之上的一层）

**缺点**：
- 需要解析 agent 输出的 approach-plan.md，增加了 orchestrator 对 agent 产物的耦合
- approach-plan.md 格式不规范时需要 fallback

### 方案 B：纯 Prompt 驱动断路器

**思路**：不在 orchestrator 中跟踪方案状态，完全通过 prompt 指令让 agent 自我管理方案切换。在 revision prompt 中加入"如果同一方法已失败 2 次，必须切换到不同技术路径"的规则。

**数据流**：

```
Step 验证失败:
  buildRevisionPrompt() 在 feedback 中追加方案切换规则
  -> agent 自行决定是否切换方案
  -> 框架不跟踪方案状态
```

**优点**：
- 实现极简，几乎不改 orchestrator 逻辑
- 不需要解析 approach-plan.md

**缺点**：
- 依赖 agent 自觉遵守规则，缺乏强制力（agent gaming 的核心问题就是不遵守规则）
- 无法实现"清零重启" -- agent 的 context 中仍然充满失败细节，锚定效应无法解决
- 无法准确知道当前处于第几个方案，也无法在方案耗尽时精确 BLOCK
- **不解决根本问题**

### 方案对比

| 维度 | 方案 A（Orchestrator 内置） | 方案 B（纯 Prompt 驱动） |
|------|--------------------------|------------------------|
| 方案切换强制力 | 强：框架控制，agent 无法绕过 | 弱：依赖 agent 自觉 |
| 清零重启 | 支持：构建不含失败细节的 prompt | 不支持：context 中仍有失败历史 |
| 方案状态跟踪 | 精确：持久化在 state.json | 无：框架不感知方案状态 |
| 实现复杂度 | 中等（~120 行新代码） | 低（~20 行 prompt 修改） |
| 可靠性 | 高 | 低（锚定效应未解决） |

**选型结论**：选择方案 A。方案 B 不解决锚定效应这个核心问题，属于治标不治本。

## 4. 详细设计

### 4.1 数据模型

在 state.json 扩展字段中新增 `approachState`（与 `step`、`stepIteration` 同级，不在 Zod schema 中）：

```typescript
interface ApproachState {
  stepId: string;                    // 当前 step，如 "3", "5b"
  approaches: ApproachEntry[];       // 方案列表（从 approach-plan.md 解析）
  currentIndex: number;              // 当前方案索引（0 = 主方案）
  failedApproaches: FailedApproach[];// 已熔断的方案
}

interface ApproachEntry {
  id: string;                        // "primary", "alt-a", "alt-b"
  summary: string;                   // 一句话描述，如 "安装 vitest + jsdom"
  failCount: number;                 // 当前方案连续失败次数
}

interface FailedApproach {
  id: string;
  summary: string;
  failReason: string;                // 一句话失败原因
}
```

更新 `StepState` 接口：

```typescript
interface StepState {
  step: string | null;
  stepIteration: number;
  lastValidation: string | null;
  approachState: ApproachState | null;  // 新增
}
```

### 4.2 approach-plan.md 格式约定

Agent 在执行 step 前输出到 `{output_dir}/approach-plan.md`：

```markdown
## 目标
为 Guide.vue 的 API Key 安装流程编写验证测试

## 主方案
- **方法**: 安装 vitest + @vue/test-utils，编写组件单元测试
- **核心工具**: vitest, jsdom
- **风险**: Node 版本可能不兼容

## 备选方案 A
- **方法**: 纯 Node.js 脚本，提取核心逻辑函数单独测试
- **核心工具**: node (内置)
- **适用**: 主方案安装失败时

## 备选方案 B
- **方法**: 编译验证 + 代码静态审查
- **核心工具**: tsc, grep
- **适用**: 无法运行任何测试框架时
```

### 4.3 approach-plan.md 解析逻辑

新增 `parseApproachPlan()` 函数：

```typescript
function parseApproachPlan(content: string): ApproachEntry[] | null {
  const approaches: ApproachEntry[] = [];

  // 解析 "## 主方案" 段落
  const primaryMatch = content.match(
    /## 主方案\s*\n([\s\S]*?)(?=\n## |$)/
  );
  if (primaryMatch) {
    const methodMatch = primaryMatch[1].match(/-\s*\*\*方法\*\*:\s*(.+)/);
    approaches.push({
      id: "primary",
      summary: methodMatch?.[1]?.trim() ?? "主方案",
      failCount: 0,
    });
  }

  // 解析 "## 备选方案 X" 段落
  const altRegex = /## 备选方案\s+(\w)\s*\n([\s\S]*?)(?=\n## |$)/g;
  let match;
  while ((match = altRegex.exec(content)) !== null) {
    const label = match[1].toLowerCase();
    const section = match[2];
    const methodMatch = section.match(/-\s*\*\*方法\*\*:\s*(.+)/);
    approaches.push({
      id: `alt-${label}`,
      summary: methodMatch?.[1]?.trim() ?? `备选方案 ${match[1]}`,
      failCount: 0,
    });
  }

  return approaches.length >= 2 ? approaches : null;
  // 至少需要主方案 + 1 个备选
}
```

### 4.4 computeNextTask() 改动

在现有失败处理逻辑中插入断路器判断。关键变更点在 `validation.passed === false` 分支：

```typescript
// 现有逻辑：
if (currentIteration >= MAX_STEP_ITERATIONS) {
  // escalation
}
// 返回 revision prompt

// 新增逻辑（插入在 escalation 检查之前）：
const approachResult = await handleApproachFailure(
  stepState, currentStep, outputDir, validation.feedback
);

if (approachResult.action === "CIRCUIT_BREAK") {
  // 重置 stepIteration（新方案从 0 开始计数）
  await writeStepState(sm.stateFilePath, {
    stepIteration: 0,
    lastValidation: "CIRCUIT_BREAK",
    approachState: approachResult.approachState,
  });

  return {
    done: false,
    step: currentStep,
    agent: STEP_AGENTS[currentStep] ?? null,
    prompt: approachResult.prompt,  // 清零 prompt
    message: `方案 "${approachResult.failedApproach}" 已熔断，切换到 "${approachResult.nextApproach}"。`,
  };
}

if (approachResult.action === "ALL_EXHAUSTED") {
  // 所有方案耗尽，直接 BLOCKED
  await writeStepState(sm.stateFilePath, {
    lastValidation: "ALL_APPROACHES_EXHAUSTED",
  });
  await sm.atomicUpdate({ status: "BLOCKED" });

  return {
    done: false,
    step: currentStep,
    agent: null,
    prompt: null,
    escalation: {
      reason: "all_approaches_exhausted",
      lastFeedback: validation.feedback,
    },
    message: `Step ${currentStep} 所有方案均已失败，需要人工介入。`,
  };
}

// approachResult.action === "CONTINUE" -> 走现有 revision 逻辑
```

### 4.5 handleApproachFailure() 核心逻辑

```typescript
const MAX_APPROACH_FAILURES = 2;

async function handleApproachFailure(
  stepState: StepState,
  step: string,
  outputDir: string,
  feedback: string,
): Promise<ApproachAction> {
  let approachState = stepState.approachState;

  // 首次失败且尚无方案状态：尝试从 approach-plan.md 解析
  if (!approachState) {
    const planPath = join(outputDir, "approach-plan.md");
    const planContent = await readFileSafe(planPath);
    if (!planContent) {
      // 没有 approach-plan.md，走常规 revision 流程
      return { action: "CONTINUE" };
    }
    const approaches = parseApproachPlan(planContent);
    if (!approaches) {
      return { action: "CONTINUE" };
    }
    approachState = {
      stepId: step,
      approaches,
      currentIndex: 0,
      failedApproaches: [],
    };
  }

  // 递增当前方案的 failCount
  const current = approachState.approaches[approachState.currentIndex];
  if (!current) {
    return { action: "ALL_EXHAUSTED" };
  }
  current.failCount++;

  // 未达阈值：正常 revision
  if (current.failCount < MAX_APPROACH_FAILURES) {
    return { action: "CONTINUE", approachState };
  }

  // 达到阈值：熔断当前方案
  approachState.failedApproaches.push({
    id: current.id,
    summary: current.summary,
    failReason: extractOneLineReason(feedback),
  });
  approachState.currentIndex++;

  // 检查是否还有备选方案
  if (approachState.currentIndex >= approachState.approaches.length) {
    return { action: "ALL_EXHAUSTED" };
  }

  const next = approachState.approaches[approachState.currentIndex];

  // 构建清零 prompt
  const prompt = buildCircuitBreakPrompt({
    originalGoal: await getStepGoal(step, outputDir),
    nextApproach: next.summary,
    prohibited: approachState.failedApproaches,
  });

  return {
    action: "CIRCUIT_BREAK",
    prompt,
    approachState,
    failedApproach: current.summary,
    nextApproach: next.summary,
  };
}
```

### 4.6 清零 Prompt 模板

```typescript
function buildCircuitBreakPrompt(input: {
  originalGoal: string;
  nextApproach: string;
  prohibited: FailedApproach[];
}): string {
  const lines: string[] = [];
  lines.push("# 任务");
  lines.push("");
  lines.push(input.originalGoal);
  lines.push("");
  lines.push("## 方案");
  lines.push("");
  lines.push("请按以下方案执行：");
  lines.push(input.nextApproach);
  lines.push("");

  if (input.prohibited.length > 0) {
    lines.push("## 约束（以下方案已失败，禁止使用）");
    lines.push("");
    for (const p of input.prohibited) {
      lines.push(`- 禁止: ${p.summary}（原因: ${p.failReason}）`);
    }
    lines.push("");
  }

  lines.push("## 要求");
  lines.push("");
  lines.push("- 不要尝试任何已禁止的方案");
  lines.push("- 如果当前方案也遇到困难，先分析根因再决定下一步");
  lines.push("");

  return lines.join("\n");
}
```

### 4.7 Agent Prompt 中的方案计划要求

在 `buildTaskForStep()` 中，对 step "3"、"4a"、"5b" 的 prompt 末尾追加方案计划指令段：

```markdown
## 执行前：方案计划

在开始编码/测试之前，先输出方案计划到 {output_dir}/approach-plan.md：

1. 主方案 + 1~2 个备选方案
2. 每个方案标注方法、核心工具、风险
3. 备选方案应与主方案在技术路径上有本质区别
   （换参数/换 flag 不算，换工具/换思路才算）
```

注意：此段使用自然语言描述，不含任何框架术语，符合 Invisible Framework 原则。

### 4.8 流程图

```
computeNextTask() 调用 validateStep()
  |
  v
validation.passed?
  |-- YES -> 推进到下一个 step（现有逻辑不变）
  |
  |-- NO -> handleApproachFailure()
              |
              v
            有 approachState?
              |-- NO -> 尝试解析 approach-plan.md
              |           |-- 解析失败 -> action: CONTINUE（走现有 revision 逻辑）
              |           |-- 解析成功 -> 创建 approachState
              |
              v
            current.failCount < MAX_APPROACH_FAILURES?
              |-- YES -> action: CONTINUE（走现有 revision 逻辑）
              |           并把更新后的 approachState 写入 state.json
              |
              |-- NO -> 熔断当前方案
                          |
                          v
                        还有备选方案?
                          |-- YES -> action: CIRCUIT_BREAK
                          |           构建清零 prompt
                          |           重置 stepIteration = 0
                          |
                          |-- NO -> action: ALL_EXHAUSTED
                                    标记 BLOCKED
```

### 4.9 与现有 stepIteration 的协作

| 场景 | stepIteration 行为 | approachState 行为 |
|------|-------------------|-------------------|
| 方案内第 1 次失败 | +1 | failCount +1, action: CONTINUE |
| 方案内第 2 次失败 | +1（但可能被断路器拦截） | failCount = 2, 触发 CIRCUIT_BREAK |
| 断路器切换方案后 | 重置为 0 | currentIndex +1, failCount = 0 |
| 最后一个方案也失败 2 次 | 不再递增 | ALL_EXHAUSTED -> BLOCKED |

**iteration 上限调整**：`MAX_STEP_ITERATIONS` 从 3 调整为 `方案数 * MAX_APPROACH_FAILURES`，或者在有 approachState 时不使用 MAX_STEP_ITERATIONS（由断路器自行管理上限）。推荐后者，更简洁。

## 5. 影响分析

### 5.1 改动范围

| 文件 | 改动类型 | 预估行数 | 说明 |
|------|---------|---------|------|
| `mcp/src/orchestrator.ts` | 修改 | ~80 | handleApproachFailure、computeNextTask 中插入断路器分支 |
| `mcp/src/orchestrator-prompts.ts` | 新增 | ~40 | buildCircuitBreakPrompt、parseApproachPlan、extractOneLineReason |
| `mcp/src/orchestrator.ts` | 修改 | ~15 | buildTaskForStep 中追加方案计划指令 |
| `mcp/src/orchestrator.ts` | 修改 | ~10 | readStepState/writeStepState 支持 approachState 字段 |
| **合计** | | **~145** | |

### 5.2 不改动的文件

- `types.ts` -- approachState 不加入 Zod schema，保持扩展字段模式与现有 StepState 一致
- `state-manager.ts` -- 不需要改动，approachState 通过现有的 readStepState/writeStepState 读写
- `phase-enforcer.ts` -- 不需要改动，断路器在 orchestrator 层处理完毕后，phase-enforcer 的逻辑不受影响
- prompt 模板文件 -- 方案计划指令通过代码追加，不修改模板文件

### 5.3 向后兼容性

- **无 approach-plan.md 时**：`handleApproachFailure()` 返回 `CONTINUE`，完全走现有 revision 逻辑，行为不变
- **现有 state.json 无 approachState 字段**：`readStepState()` 返回 `approachState: null`，不影响
- **MAX_STEP_ITERATIONS**：当存在 approachState 时跳过 iteration 上限检查（由断路器管理），无 approachState 时保持现有行为

### 5.4 迁移路径

无需迁移。新增字段均有 null/undefined 默认值，旧版 state.json 自动兼容。

### 5.5 回滚方案

删除断路器相关代码即可回滚。approachState 字段在 state.json 中会被忽略，不影响现有逻辑。

## 6. 风险与缓解

| 风险 | 影响 | 概率 | 缓解措施 |
|------|------|------|---------|
| Agent 不按格式输出 approach-plan.md | 断路器无法激活，退化为现有 revision 逻辑 | 中 | parseApproachPlan 做宽松解析 + 返回 null 时 graceful fallback |
| Agent 输出的备选方案实质上是同一方案的变体 | 切换方案后仍然失败 | 中 | prompt 中明确"换参数/换 flag 不算不同方案"；可选：未来增加核心工具差异检测 |
| approach-plan.md 解析逻辑有 bug | 误触发或漏触发断路器 | 低 | 单元测试覆盖各种格式变体 |
| 清零 prompt 过于精简导致 agent 缺少上下文 | 新方案执行效率降低 | 低 | 清零 prompt 保留原始目标完整描述 + 项目根目录信息 |

## 7. 验收标准

| AC | 描述 | 验证方式 |
|----|------|---------|
| AC-1 | 当 step 验证失败且 approach-plan.md 存在时，orchestrator 能正确解析方案列表（主方案 + 至少 1 个备选），并创建 approachState | 单元测试：mock approach-plan.md 内容，验证 parseApproachPlan 返回正确的 ApproachEntry 数组 |
| AC-2 | 当前方案连续失败 2 次后，computeNextTask 返回的 prompt 是清零 prompt（包含目标 + 下一个方案 + 禁用列表），而非 revision prompt | 单元测试：模拟 failCount=2 场景，验证返回的 prompt 包含 "禁止:" 字样且不含失败堆栈 |
| AC-3 | 断路器切换方案后，stepIteration 重置为 0 | 单元测试：模拟切换后读取 stepState，验证 stepIteration === 0 |
| AC-4 | 所有方案耗尽时（currentIndex >= approaches.length），computeNextTask 返回 escalation 且 state.json status 变为 BLOCKED | 单元测试：模拟 3 个方案全部 failCount=2，验证返回 escalation.reason === "all_approaches_exhausted" |
| AC-5 | 无 approach-plan.md 时，行为与改动前完全一致（向后兼容）：仍走现有 revision + MAX_STEP_ITERATIONS 逻辑 | 单元测试：不创建 approach-plan.md，验证 handleApproachFailure 返回 CONTINUE |
| AC-6 | approach-plan.md 格式不规范（缺少"备选方案"段落、只有主方案等）时，parseApproachPlan 返回 null，不触发断路器 | 单元测试：传入不规范内容，验证返回 null |
| AC-7 | 清零 prompt 不包含任何 FRAMEWORK_TERMS 中定义的框架术语 | 单元测试：调用 containsFrameworkTerms(circuitBreakPrompt)，验证返回 false |
| AC-8 | step "3"、"5b" 的初始 prompt 中包含方案计划指令段（要求输出 approach-plan.md），step "1a"、"7" 等设计/审查 step 不包含 | 单元测试：验证 buildTaskForStep 对不同 step 的输出 |
