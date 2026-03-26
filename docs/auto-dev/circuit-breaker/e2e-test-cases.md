# 端到端测试用例：断路器机制（Circuit Breaker）

## 测试范围

测试断路器机制从 `computeNextTask()` 调用方入口到最终返回结果的完整路径，覆盖 8 个验收标准（AC-1 ~ AC-8）。

**被测入口函数**：`computeNextTask(projectRoot, topic)` — orchestrator.ts
**辅助被测函数**：`handleApproachFailure()` — orchestrator.ts（组件级测试，补充入口测试）
**依赖链**：`computeNextTask -> validateStep -> handleApproachFailure -> parseApproachPlan / extractOneLineReason / buildCircuitBreakPrompt`

---

## 测试前置条件（所有用例共用）

- Mock `node:fs/promises`（readFile / writeFile / stat）
- Mock `node:child_process`（execFile，用于 shell 命令结果）
- Mock `StateManager`（loadAndValidate / atomicUpdate）
- Mock `TemplateRenderer`（renderPrompt 返回固定字符串）
- Mock `executeTribunal`

---

## 用例列表

### TC-01: approach-plan.md 标准格式解析（AC-1）

**层级**：组件测试（parseApproachPlan）
**前置**：无
**输入**：

```markdown
## 目标
为 Guide.vue 编写验证测试

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

**预期结果**：
- 返回数组长度 = 3
- `[0]` = `{id: "primary", summary: "安装 vitest + @vue/test-utils，编写组件单元测试", failCount: 0}`
- `[1]` = `{id: "alt-a", summary: "纯 Node.js 脚本，提取核心逻辑函数单独测试", failCount: 0}`
- `[2]` = `{id: "alt-b", summary: "编译验证 + 代码静态审查", failCount: 0}`

---

### TC-02: approach-plan.md 缺少 `**方法**` 字段时使用 fallback summary（AC-1 / P2-1 补充）

**层级**：组件测试（parseApproachPlan）
**输入**：

```markdown
## 主方案
- **核心工具**: vitest

## 备选方案 A
- **核心工具**: jest
```

**预期结果**：
- 返回数组长度 = 2
- `[0].summary` = `"主方案"`（fallback 值）
- `[1].summary` = `"备选方案 A"`（fallback 值）

---

### TC-03: 首次失败 + approach-plan.md 存在 -> CONTINUE 并返回 approachState（AC-1 集成入口）

**层级**：入口测试（computeNextTask）
**前置**：
- state.json: `{step: "3", stepIteration: 0, approachState: null}`, mode = "turbo"
- approach-plan.md 存在（标准格式，主方案 + 1 备选）
- shell() build 命令返回 exitCode=1（编译失败）

**步骤**：调用 `computeNextTask("/tmp/test-project", "test-topic")`

**预期结果**：
- `result.done` = false
- `result.step` = "3"
- `result.prompt` 非 null（返回 revision prompt）
- `result.escalation` 未定义
- writeStepState 被调用，写入的 state.json 包含 `approachState`，其中 `currentIndex = 0`，`approaches[0].failCount = 1`
- `result.prompt` 不包含任何 `FRAMEWORK_TERMS` 匹配项

---

### TC-04: 同一方案连续失败 2 次 -> 触发 CIRCUIT_BREAK，返回清零 prompt（AC-2）

**层级**：入口测试（computeNextTask）
**前置**：
- state.json: `{step: "3", stepIteration: 1, approachState: {stepId: "3", currentIndex: 0, approaches: [{id: "primary", summary: "vitest mock", failCount: 1}, {id: "alt-a", summary: "jest 测试", failCount: 0}], failedApproaches: []}}`
- mode = "turbo"
- plan.md 存在，内容含 `## Task 3: 实现用户模块\n构建用户认证功能`
- shell() build 命令返回 exitCode=1

**步骤**：调用 `computeNextTask("/tmp/test-project", "test-topic")`

**预期结果**：
- `result.step` = "3"
- `result.prompt` 包含 "禁止" 字样
- `result.prompt` 包含 "jest 测试"（下一个方案描述）
- `result.prompt` 包含 "vitest mock"（被禁止的方案描述）
- `result.prompt` 不包含 shell 的 stderr 内容（清零，不含失败堆栈）
- `result.freshContext` = true
- `result.message` 包含 "熔断"
- `result.escalation` 未定义

---

### TC-05: CIRCUIT_BREAK 时 stepIteration 重置为 0（AC-3）

**层级**：入口测试（computeNextTask）
**前置**：与 TC-04 相同（stepIteration: 1，failCount: 1，即将触发 CIRCUIT_BREAK）

**步骤**：调用 `computeNextTask("/tmp/test-project", "test-topic")`

**预期结果**：
- writeStepState 最终写入 state.json 时，`stepIteration` = 0
- `lastValidation` = "CIRCUIT_BREAK"
- `approachState.currentIndex` = 1（切换到备选方案 A）
- `approachState.failedApproaches` 长度 = 1

---

### TC-06: 所有方案耗尽 -> 返回 escalation + BLOCKED（AC-4）

**层级**：入口测试（computeNextTask）
**前置**：
- state.json: `{step: "3", stepIteration: 1, approachState: {stepId: "3", currentIndex: 1, approaches: [{id: "primary", summary: "方案A", failCount: 2}, {id: "alt-a", summary: "方案B", failCount: 1}], failedApproaches: [{id: "primary", summary: "方案A", failReason: "编译失败"}]}}`
- mode = "turbo"
- shell() build 命令返回 exitCode=1

**步骤**：调用 `computeNextTask("/tmp/test-project", "test-topic")`

**预期结果**：
- `result.done` = false
- `result.prompt` = null
- `result.escalation.reason` = "all_approaches_exhausted"
- `result.escalation.lastFeedback` 非空
- `atomicUpdate` 被调用，参数为 `{status: "BLOCKED"}`
- writeStepState 写入 `lastValidation` = "ALL_APPROACHES_EXHAUSTED"

---

### TC-07: 无 approach-plan.md 时向后兼容 -> 走现有 revision + MAX_STEP_ITERATIONS 逻辑（AC-5）

**层级**：入口测试（computeNextTask）
**前置**：
- state.json: `{step: "3", stepIteration: 2, approachState: null}`, mode = "turbo"
- approach-plan.md 不存在（readFile 抛 ENOENT）
- shell() build 命令返回 exitCode=1

**步骤**：调用 `computeNextTask("/tmp/test-project", "test-topic")`

**预期结果**：
- `result.prompt` = null（因为 stepIteration=2 >= MAX_STEP_ITERATIONS=3 时触发 escalation）

**补充子用例 TC-07b**：stepIteration=1 时（未超限）
- result.prompt 非 null
- result.prompt 包含 revision 内容（"修订" / "修复" 等字样）
- result.escalation 未定义
- stepIteration 递增到 2

---

### TC-08: 无 approach-plan.md 且 stepIteration 达到 MAX_STEP_ITERATIONS -> escalation（AC-5 边界值）

**层级**：入口测试（computeNextTask）
**前置**：
- state.json: `{step: "3", stepIteration: 3, approachState: null}`, mode = "turbo"
- approach-plan.md 不存在
- shell() build 命令返回 exitCode=1

**步骤**：调用 `computeNextTask("/tmp/test-project", "test-topic")`

**预期结果**：
- `result.escalation.reason` = "iteration_limit_exceeded"
- `result.prompt` = null
- `atomicUpdate` 被调用，参数包含 `{status: "BLOCKED"}`

---

### TC-09: approach-plan.md 格式不规范（只有主方案无备选）-> graceful fallback（AC-6）

**层级**：入口测试（computeNextTask）
**前置**：
- state.json: `{step: "3", stepIteration: 0, approachState: null}`, mode = "turbo"
- approach-plan.md 内容为：`## 主方案\n- **方法**: 只有一个方案`（无备选方案段落）
- shell() build 命令返回 exitCode=1

**步骤**：调用 `computeNextTask("/tmp/test-project", "test-topic")`

**预期结果**：
- 走正常 revision 逻辑（不触发断路器）
- `result.prompt` 非 null
- `result.prompt` 包含 planFeedback 提示（要求补充备选方案）：包含 "备选方案" 字样
- `result.escalation` 未定义
- stepIteration 递增到 1

---

### TC-10: approach-plan.md 为随机文本（无任何识别标题）-> graceful fallback（AC-6）

**层级**：组件测试（parseApproachPlan）
**输入**：`"这是一段无关的文本\n没有任何方案格式"`

**预期结果**：返回 null

---

### TC-11: 清零 prompt 不包含框架术语（AC-7）

**层级**：组件测试（buildCircuitBreakPrompt）
**输入**：

```typescript
{
  goal: "实现数据库迁移功能",
  approach: "使用 Prisma 迁移工具进行 schema 同步",
  prohibited: [
    { id: "primary", summary: "手动编写 SQL DDL", failReason: "SQL 语法错误" },
    { id: "alt-a", summary: "使用 Knex 迁移", failReason: "依赖版本冲突" },
  ],
  outputDir: "/tmp/output",
}
```

**预期结果**：
- `containsFrameworkTerms(result)` = false
- 不包含 "checkpoint"、"tribunal"、"auto_dev_"、"Phase N"、"迭代限制"、"回退限制"、"submit"、"preflight"、"mandate" 等

---

### TC-12: 清零 prompt 从 computeNextTask 入口返回时不含框架术语（AC-7 集成入口）

**层级**：入口测试（computeNextTask）
**前置**：与 TC-04 相同（即将触发 CIRCUIT_BREAK 的状态）

**步骤**：调用 `computeNextTask("/tmp/test-project", "test-topic")`

**预期结果**：
- `containsFrameworkTerms(result.prompt)` = false

---

### TC-13: step "3" 的初始 prompt 包含方案计划指令（AC-8）

**层级**：入口测试（computeNextTask）
**前置**：
- state.json: 无 step 字段（首次启动）
- mode = "turbo"（首个 step 为 "3"）

**步骤**：调用 `computeNextTask("/tmp/test-project", "test-topic")`

**预期结果**：
- `result.step` = "3"
- `result.prompt` 包含 "方案计划" 字样
- `result.prompt` 包含 "approach-plan.md" 字样
- `result.prompt` 包含 "备选方案" 字样

---

### TC-14: step "4a" 的初始 prompt 包含方案计划指令（AC-8）

**层级**：入口测试（computeNextTask）
**前置**：
- state.json: `{step: "3"}`, mode = "quick"（包含 phase 3, 4, 5, 7）
- step 3 验证通过（build + test 均 exitCode=0）

**步骤**：调用 `computeNextTask(...)` 使 step 3 通过后推进到 step 4a

**预期结果**：
- `result.step` = "4a"
- `result.prompt` 包含 "方案计划" 字样

---

### TC-15: step "5b" 的初始 prompt 包含方案计划指令（AC-8）

**层级**：组件测试（buildTaskForStep）
**输入**：调用 `buildTaskForStep("5b", outputDir, projectRoot, topic, buildCmd, testCmd)`

**预期结果**：
- 返回的 prompt 包含 "方案计划" 字样
- 返回的 prompt 包含 "approach-plan.md" 字样

---

### TC-16: step "1a" 的初始 prompt 不包含方案计划指令（AC-8 负面）

**层级**：入口测试（computeNextTask）
**前置**：
- state.json: 无 step 字段（首次启动）
- mode = "full"（首个 step 为 "1a"）

**步骤**：调用 `computeNextTask("/tmp/test-project", "test-topic")`

**预期结果**：
- `result.step` = "1a"
- `result.prompt` 不包含 "方案计划" 字样

---

### TC-17: step "7" 的 prompt 不包含方案计划指令（AC-8 负面）

**层级**：组件测试（buildTaskForStep）
**输入**：调用 `buildTaskForStep("7", outputDir, projectRoot, topic, buildCmd, testCmd)`

**预期结果**：
- 返回的 prompt 不包含 "方案计划" 字样

---

### TC-18: 步骤推进时清除 approachState（P1-1 修复验证）

**层级**：入口测试（computeNextTask）
**前置**：
- state.json: `{step: "3", stepIteration: 0, approachState: {stepId: "3", currentIndex: 0, approaches: [...], failedApproaches: []}}`, mode = "quick"
- step 3 验证通过（build + test exitCode=0）

**步骤**：调用 `computeNextTask(...)` 使 step 3 通过后推进到下一步

**预期结果**：
- writeStepState 写入新 step 时，`approachState` = null
- 旧 step 的 approachState 不会泄漏到新 step

---

### TC-19: 有 approachState 时跳过 MAX_STEP_ITERATIONS 检查

**层级**：入口测试（computeNextTask）
**前置**：
- state.json: `{step: "3", stepIteration: 5, approachState: {stepId: "3", currentIndex: 0, approaches: [{id: "primary", summary: "方案A", failCount: 0}, {id: "alt-a", summary: "方案B", failCount: 0}], failedApproaches: []}}`
- mode = "turbo"
- shell() build 返回 exitCode=1

**步骤**：调用 `computeNextTask("/tmp/test-project", "test-topic")`

**预期结果**：
- 不触发 "iteration_limit_exceeded" escalation（即使 stepIteration=5 > MAX_STEP_ITERATIONS=3）
- `result.escalation` 未定义
- `result.prompt` 非 null（返回 revision prompt）
- approachState.approaches[0].failCount 递增到 1

---

### TC-20: CIRCUIT_BREAK 后新方案再次失败 -> 正常 revision（非立即再触发 CIRCUIT_BREAK）

**层级**：入口测试（computeNextTask）
**前置**：
- state.json: `{step: "3", stepIteration: 0, approachState: {stepId: "3", currentIndex: 1, approaches: [{id: "primary", summary: "方案A", failCount: 2}, {id: "alt-a", summary: "方案B", failCount: 0}], failedApproaches: [{id: "primary", summary: "方案A", failReason: "编译失败"}]}}`
- mode = "turbo"
- shell() build 返回 exitCode=1

**步骤**：调用 `computeNextTask("/tmp/test-project", "test-topic")`

**预期结果**：
- `result.prompt` 非 null（revision prompt，不是清零 prompt）
- `result.freshContext` 未定义或为 false
- approachState.approaches[1].failCount = 1（递增一次，未达阈值 2）
- `result.escalation` 未定义

---

### TC-21: 3 个方案的完整断路器生命周期（集成入口 + 状态转换）

**层级**：入口测试（computeNextTask），多次调用模拟完整生命周期
**前置**：mode = "turbo"，approach-plan.md 含 3 个方案

**状态转换序列**：

| 调用序号 | 输入状态 | 预期 action | 预期 currentIndex | 预期 failedApproaches.length |
|---------|---------|------------|-------------------|------------------------------|
| 1 | 首次失败, 无 approachState | CONTINUE | 0 | 0 |
| 2 | primary.failCount=1 | CIRCUIT_BREAK | 1 | 1 |
| 3 | alt-a.failCount=0（刚切换） | CONTINUE | 1 | 1 |
| 4 | alt-a.failCount=1 | CIRCUIT_BREAK | 2 | 2 |
| 5 | alt-b.failCount=0（刚切换） | CONTINUE | 2 | 2 |
| 6 | alt-b.failCount=1 | ALL_EXHAUSTED | - | - |

**验证点**：
- 每次 CIRCUIT_BREAK 时 stepIteration 重置为 0
- 每次 CIRCUIT_BREAK 时 freshContext = true
- ALL_EXHAUSTED 时 status = "BLOCKED"
- 清零 prompt 中被禁止方案累积增长（第 2 次清零 prompt 包含 2 个被禁方案）

---

### TC-22: approach-plan.md 格式变体 -- 标题间有多余空行（AC-1 边界值）

**层级**：组件测试（parseApproachPlan）
**输入**：

```markdown

## 主方案

- **方法**: 直接调用 REST API

## 备选方案 A

- **方法**: 通过 GraphQL 代理层
```

**预期结果**：
- 返回数组长度 = 2
- `[0].summary` = "直接调用 REST API"
- `[1].summary` = "通过 GraphQL 代理层"

---

### TC-23: extractOneLineReason 截断超长 feedback（边界值）

**层级**：组件测试（extractOneLineReason）
**输入**：`"A".repeat(200) + "\n第二行"`

**预期结果**：返回 `"A".repeat(120) + "..."`（总长 123 字符）

---

### TC-24: extractOneLineReason 处理全空白输入（负面测试）

**层级**：组件测试（extractOneLineReason）
**输入**：`"   \n\n  \n  "`

**预期结果**：返回 `"未知原因"`

---

### TC-25: getStepGoal 无 plan.md 时使用 fallback（负面测试）

**层级**：组件测试（handleApproachFailure 内部调用 getStepGoal）
**前置**：
- approachState 已存在，primary.failCount=1（即将触发 CIRCUIT_BREAK）
- plan.md 不存在（readFile 抛 ENOENT）

**步骤**：调用 `handleApproachFailure(...)`

**预期结果**：
- action = "CIRCUIT_BREAK"
- prompt 包含 `"完成步骤 3 的任务"`（fallback goal）

---

### TC-26: approach-plan.md 解析失败时返回 planFeedback 提示补充备选方案（AC-6 增强）

**层级**：组件测试（handleApproachFailure）
**前置**：
- approachState = null
- approach-plan.md 内容只有主方案（`parseApproachPlan` 返回 null）

**步骤**：调用 `handleApproachFailure(stepState, "3", outputDir, "test failed")`

**预期结果**：
- `result.action` = "CONTINUE"
- `result.planFeedback` 包含 "备选方案" 字样

---

---

## 覆盖矩阵

| AC | 描述 | 组件测试 | 入口测试（computeNextTask） |
|----|------|---------|---------------------------|
| AC-1 | approach-plan.md 解析正确 | TC-01, TC-02, TC-22 | TC-03 |
| AC-2 | 同一方案失败 2 次触发 CIRCUIT_BREAK | -- | TC-04, TC-21 |
| AC-3 | CIRCUIT_BREAK 时 stepIteration 重置为 0 | -- | TC-05, TC-21 |
| AC-4 | 所有方案耗尽后 BLOCKED | -- | TC-06, TC-21 |
| AC-5 | 无 approach-plan.md 时向后兼容 | -- | TC-07, TC-08 |
| AC-6 | 格式不规范时 graceful fallback | TC-10 | TC-09, TC-26 |
| AC-7 | 清零 prompt 不含框架术语 | TC-11 | TC-12 |
| AC-8 | 方案计划指令只注入 step "3"/"4a"/"5b" | TC-15, TC-17 | TC-13, TC-14, TC-16 |

### 补充覆盖

| 场景 | 用例 |
|------|------|
| P1-1 步骤推进时清除 approachState | TC-18 |
| 有 approachState 时跳过 MAX_STEP_ITERATIONS | TC-19 |
| 新方案首次失败走 revision（非再次 CIRCUIT_BREAK） | TC-20 |
| 完整生命周期状态转换 | TC-21 |
| extractOneLineReason 边界值 | TC-23, TC-24 |
| getStepGoal fallback | TC-25 |
| planFeedback 提示 | TC-26 |

### 集成入口测试覆盖验证

根据"集成入口测试"规则，以下用例从 `computeNextTask()` 入口发起，验证断路器在完整管线中的行为：

- **TC-03**: 首次失败 -> approachState 被正确创建并持久化
- **TC-04/TC-05**: CIRCUIT_BREAK -> 清零 prompt 返回 + stepIteration 重置
- **TC-06**: ALL_EXHAUSTED -> escalation + BLOCKED
- **TC-07/TC-08**: 无 approach-plan.md -> 退化为原有 revision 逻辑
- **TC-09**: 格式不规范 -> planFeedback 附加到 revision prompt
- **TC-12**: 清零 prompt 从入口返回时无框架术语
- **TC-13/TC-14/TC-16**: 方案计划指令注入验证
- **TC-18**: 步骤推进时 approachState 清零
- **TC-19**: approachState 存在时跳过 iteration 上限
- **TC-20**: 新方案首次失败不误触发 CIRCUIT_BREAK
- **TC-21**: 3 个方案完整生命周期
