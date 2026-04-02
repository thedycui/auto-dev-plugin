# Orchestrator UX 改进设计文档

> 日期：2026-04-02
> 状态：待审查
> 触发：executable-ac 全流程复盘中发现的 5 个调度问题
> 原始设计：`docs/design-orchestrator-ux-improvements.md`

---

## 一、背景与目标

### 1.1 问题来源

在 executable-ac 的 auto-dev 全流程中，orchestrator（主持 agent）暴露了以下 5 个调度问题：

1. **Phase 回退无正规通道**：用户请求 `--phase=3` 回退时，`auto_dev_checkpoint` 的 `PHASE_STEP_DESYNC` 保护拦截了请求，orchestrator 被迫直接 Edit state.json 绕过保护，违反了"orchestrator 不直接操作文件"原则。

2. **FAIL 原因不透明**：Step 5b 首次 FAIL 后，`auto_dev_next` 返回的修订 prompt 中没有上次失败的具体原因，orchestrator 只能依赖猜测，导致修订方向不准确。

3. **Step 3 并行派发无支持**：用户要求多个 subagent 并行实现，但 `auto_dev_next` 将所有 Task 打包为单一 prompt，无法拆分并行派发。

4. **Tribunal 对大变更审查深度不足**：734 行变更的 code review 缺少"变更规模 → 审查严格度"的自动调节，大变更和小变更接受同等深度的审查。

5. **orchestrator 依赖命令获取状态**：FAIL 后 orchestrator 需要自己运行命令来了解失败详情，违背了只调 MCP 工具的原则。

### 1.2 设计目标

- orchestrator 只调 MCP 工具 + 派发 subagent，不直接操作文件或运行命令
- FAIL -> 修订循环有足够上下文，orchestrator 无需猜测失败原因
- Step 3 可按 Task 拆分并行派发
- 大变更自动升级 tribunal 审查严格度

### 1.3 不做什么（范围外）

- 不重构 orchestrator 的核心状态机流程
- 不引入 task 级别的独立状态追踪（嵌套子步骤）
- 不修改 SKILL.md 中已定义的 orchestrator 侧并行策略
- 不改变现有工具的调用签名（向后兼容）

---

## 二、现状分析

### 2.1 现有架构关键点

**`mcp/src/index.ts`**
- 注册 16 个 MCP 工具，包括 `auto_dev_next`（Step 16）
- `auto_dev_next` 调用 `computeNextTask()` 并注入 `mandate` 字段
- 工具注册遵循 `server.tool(name, description, inputSchema, handler)` 格式

**`mcp/src/orchestrator.ts`**
- `computeNextTask()` 是核心入口，读取 state 后分发到各 step 处理函数
- `NextTaskResult` 接口定义返回结构，当前包含 `done/step/agent/prompt/escalation/freshContext/mandate/message` 字段
- `handleValidationFailure()` 处理 3 种失败分支：tribunal FAIL、circuit breaker、普通 revision
- `buildTaskForStep()` 构建各 step 的 prompt，case `"3"` 调用 `extractTaskDetails(planContent)` 提取任务列表
- 当前 tribunal FAIL under limit 的 return 点（约 1386 行）不携带失败原因

**`mcp/src/tribunal.ts`**
- `prepareTribunalInput()` 构建 digest 内容，当前已有 `getDiffStatWithUntracked()` 调用获取 diff 统计
- `getKeyDiff()` 默认 budget 为 300 行，不感知变更规模
- diff stat 摘要行（如 `26 files changed, 734 insertions(+)`）已存在于 diffStat 中但未解析用于调节审查深度

**`mcp/src/types.ts`**
- `StateJsonSchema` 当前有 `lastValidation` 字段（字符串，"FAILED" 等）
- 无 `lastFailureDetail` 字段，失败详情不持久化
- `NextTaskResult` 接口无 `tasks` 和 `lastFailureDetail` 字段

### 2.2 关键约束

- `PHASE_STEP_DESYNC` 保护目前阻止了所有通过 `auto_dev_checkpoint` 的 phase 修改
- `STEP_ORDER` 数组定义了线性推进路径，不支持跳转
- `PHASE_SEQUENCE` 按 mode 定义允许的 phase 列表（full/quick/turbo）

---

## 三、方案设计

### 3.1 方案对比

| 维度 | 方案 A：增量改进（推荐） | 方案 B：Task-level Orchestration |
|------|------------------------|----------------------------------|
| 核心思路 | 在现有架构上增量添加新字段和新工具 | 引入 task 级状态机，MCP 逐 Task 返回 |
| 改动量 | ~200 行，4 个文件 | ~500 行，需新增 task 状态机 |
| 向后兼容 | 完全兼容，新字段为 optional | 需迁移现有 state.json，破坏性变更 |
| Step 3 并行 | orchestrator 侧拆分（SKILL.md 已定义策略） | MCP 侧逐 Task 返回，orchestrator 循环调用 |
| 架构复杂度 | 低，保持线性 step 模型 | 高，step 嵌套子步骤，状态机复杂度倍增 |
| 风险 | 低，可逐条验证 | 中，状态一致性难以保证 |
| 回滚难度 | 低，字段删除即可 | 高，需要迁移脚本 |

**选择方案 A**：方案 B 带来的状态机复杂度增加不值得，且用户在 SKILL.md 中已定义了 orchestrator 侧的并行拆分策略，MCP 只需提供 `tasks` 数据支撑即可。

### 3.2 方案 A 的 5 个子改动

| 子改动 | 解决问题 | 改动文件 |
|--------|---------|---------|
| 新增 `auto_dev_reset` 工具 | 问题 1：Phase 回退 | `index.ts` |
| `NextTaskResult` 增加 `lastFailureDetail` | 问题 2：FAIL 原因不透明 | `orchestrator.ts` |
| `buildTaskForStep` case "3" 增加 `tasks` | 问题 3：Step 3 并行 | `orchestrator.ts` |
| `prepareTribunalInput` 注入变更规模信号 | 问题 4：审查深度不足 | `tribunal.ts` |
| `StateJsonSchema` 持久化 `lastFailureDetail` | 问题 5：状态不可见 | `types.ts` |

---

## 四、详细设计

### 4.1 新增 `auto_dev_reset` 工具（解决问题 1）

**目的**：提供正规的 Phase 回退通道，取代手动编辑 state.json。

**工具签名**（在 `index.ts` 注册）：

```typescript
server.tool(
  "auto_dev_reset",
  "Reset orchestrator to a target phase. Clears step state and writes audit trail to progress-log.",
  {
    projectRoot: z.string(),
    topic: z.string(),
    targetPhase: z.number().int().min(1).max(7),
    reason: z.string().min(1),
  },
  async ({ projectRoot, topic, targetPhase, reason }) => { ... }
);
```

**实现逻辑**：

1. 加载 state.json，校验非 COMPLETED 状态
2. 校验 `targetPhase <= state.phase`（只能回退，不能前跳）
3. 校验 `targetPhase` 在 `PHASE_SEQUENCE[state.mode]` 中
4. 重置字段：
   - `phase = targetPhase`
   - `status = "IN_PROGRESS"`
   - `step = String(targetPhase)`（回到该 phase 的第一个 step）
   - `stepIteration = 0`
   - `lastValidation = null`
   - `lastFailureDetail = null`
   - `approachState = null`
5. 清除关联状态：
   - `tribunalSubmits`：key 为字符串（如 `"3"`、`"5b"`），清除时使用 `parseInt(key) >= targetPhase` 进行数值比较：
     ```typescript
     const filteredSubmits = Object.fromEntries(
       Object.entries(submits).filter(([k]) => parseInt(k) < targetPhase)
     );
     ```
   - `phaseEscalateCount`：同样使用 `parseInt(key) >= targetPhase` 过滤。若不清除，回退后可能因历史 escalate 计数（`escCount >= 2`）导致立即 BLOCKED，因此**必须清除 `>= targetPhase` 的条目**：
     ```typescript
     const filteredEscalateCount = Object.fromEntries(
       Object.entries(phaseEscalateCount).filter(([k]) => parseInt(k) < targetPhase)
     );
     ```
6. 写入 progress-log：`<!-- RESET phase=${targetPhase} reason="${reason}" timestamp=... -->`
7. 调用 `sm.atomicUpdate()`

**安全约束**：
- `status === "COMPLETED"` 时返回错误，不允许重开已完成的 session
- `targetPhase > state.phase` 时返回错误（禁止前跳）
- `reason` 为空字符串时返回错误
- 保留 `startCommit`（git 基线不变）和 `tddTaskStates`（已完成的 TDD 状态仍有效）

### 4.2 `auto_dev_next` 返回 `lastFailureDetail`（解决问题 2）

**修改 `NextTaskResult` 接口**（`orchestrator.ts`）：

```typescript
export interface NextTaskResult {
  // ... 现有字段不变 ...
  lastFailureDetail?: string;  // 新增：FAIL 后的具体失败原因
  tasks?: TaskInfo[];          // 新增：仅 Step 3 时返回（见 4.3）
}
```

**填充位置**：`handleValidationFailure()` 共有 5 条 return 路径，全部覆盖：

| return 路径 | 触发条件 | `lastFailureDetail` 处理方式 |
|------------|---------|---------------------------|
| Tribunal FAIL under limit（约第 1383 行） | `count < 3` 且有 `tribunalResult` | 填充 `validation.feedback`，同时写入 state.json |
| `regressToPhase` 路径（`handlePhaseRegress`） | `validation.regressToPhase !== undefined` | 填充 `validation.feedback`，同时写入 state.json；`handlePhaseRegress` 内 `atomicUpdate` 时追加 `lastFailureDetail` 字段 |
| `ALL_APPROACHES_EXHAUSTED` 路径（`handleCircuitBreaker` 内） | `approachResult.action === "ALL_EXHAUSTED"` | 填充 `validation.feedback`，同时写入 state.json；该路径已设 `status: "BLOCKED"`，`lastFailureDetail` 便于人工排查 |
| Circuit breaker（`CIRCUIT_BREAK` 路径） | `approachResult.action === "CIRCUIT_BREAK"` | 填充 `validation.feedback`，同时写入 state.json；该路径切换方案，失败原因仍需保留供 orchestrator 参考 |
| Iteration limit exceeded | `!hasApproachState && currentIteration >= MAX_STEP_ITERATIONS` | 不需要另填 `lastFailureDetail`（该路径返回 `escalation` 对象，`escalation.lastFeedback` 已携带失败原因，语义等价） |

**说明**：`regressToPhase` 和 `ALL_APPROACHES_EXHAUSTED` 两条路径在原代码中未持久化 `lastFailureDetail`，本次需要在各路径的 `atomicUpdate()` 调用处补充该字段。Iteration limit 路径通过 `escalation.lastFeedback` 传递失败信息，不单独填充 `lastFailureDetail`，以避免与 escalation 结构重复。

**同时**在 `index.ts` 的 `auto_dev_next` handler 中，当注入 mandate 时将 `lastFailureDetail` 传递到返回值（已在 `result` 对象中，`textResult()` 会序列化它）。

### 4.3 Step 3 返回 `tasks` 数组（解决问题 3）

**实现约束说明**：

`buildTaskForStep` 当前签名为 `Promise<string>`，共有 7 个调用方直接使用其返回值作为字符串（赋值给 `prompt` 字段）。**不修改 `buildTaskForStep` 的返回类型**，以避免破坏所有调用方。

`tasks` 数组的生成在 `computeNextTask` 内 step "3" 的**上层调用点**完成：先调用 `buildTaskForStep("3", ...)` 获得 prompt 字符串，再读取 plan.md 内容并单独调用 `parseTaskList(planContent)`，最后将两者独立组装进 `NextTaskResult`。

**新增 `TaskInfo` 接口**（`orchestrator.ts`）：

```typescript
export interface TaskInfo {
  taskNumber: number;
  title: string;
  description: string;   // 该 Task 的完整 markdown 内容
  files: string[];       // 从 "新建:" / "修改:" 中提取
  dependencies: number[]; // 从 "依赖: Task N" 中提取
}
```

**新增 `parseTaskList()` 函数**（`orchestrator.ts`）：

```typescript
function parseTaskList(planContent: string): TaskInfo[] {
  // 按 ## Task N 分割，逐块解析
  // taskNumber: 从 "## Task N:" 提取 N
  // title: 从 "## Task N: {title}" 提取
  // files: 匹配 "新建:" / "修改:" 后的路径列表
  // dependencies: 匹配 "依赖: Task N, Task M" 后的编号数组
}
```

**step "3" 上层调用点的修改**（`computeNextTask` 内，不改动 `buildTaskForStep`）：

```typescript
// step "3" 分支（位于 computeNextTask 中，约第 679 行附近）
const prompt = await buildTaskForStep("3", outputDir, projectRoot, topic, buildCmd, testCmd, feedback, ctx.getExtraVars("3"));
const planContent = await readFile(join(outputDir, "plan.md"), "utf-8");
const tasks = parseTaskList(planContent);
return {
  done: false,
  step: "3",
  agent: STEP_AGENTS["3"] ?? null,
  prompt,
  tasks,  // tasks 独立组装，不经过 buildTaskForStep
};
```

**向后兼容保证**：
- `buildTaskForStep` 签名不变，所有现有调用方不受影响
- `prompt` 字段仍返回完整合并 prompt（旧行为不变）
- `tasks` 为 optional，其他 step 的 return 点不携带此字段
- orchestrator 侧：`tasks` 存在且长度 > 1 时按 SKILL.md 定义的 Wave 策略并行派发
- `parseTaskList` 解析失败时返回空数组，orchestrator 退化为单 agent 模式

### 4.4 Tribunal Digest 注入变更规模信号（解决问题 4）

**修改位置**：`tribunal.ts` `prepareTribunalInput()` 函数，在 `## 框架统计` 章节后注入。

**新增 `parseDiffSummary()` 函数**：

```typescript
function parseDiffSummary(summaryLine: string): { files: number; insertions: number; deletions: number } {
  // 解析 "26 files changed, 734 insertions(+), 44 deletions(-)"
  // 处理边界：只有增/只有删的情况
}
```

**风险等级与注入内容**：

| 总变更行数（insertions + deletions） | 风险等级 | 额外审查指令 | diff budget |
|-------------------------------------|---------|------------|------------|
| ≤ 100 | LOW | 无 | 300 行 |
| 101-500 | MEDIUM | "重点审查核心逻辑文件" | 300 行 |
| > 500 | HIGH | "必须逐文件审查，不能仅看摘要" | 500 行 |

**注入格式**（在 `## 框架统计` 后，`## 关键代码变更` 前）：

```markdown
## 变更规模
- 文件数: 26
- 新增行: 734
- 删除行: 44
- 风险等级: HIGH (>500 行变更)

> 大规模变更：必须逐文件审查关键源文件（非 dist/map/lock），不能仅看 diff 摘要。
```

**diffStat 解析说明**：summaryLine 取 `diffStat.split("\n")` 的最后一个非空行，该行格式由 git 保证。

### 4.5 `StateJsonSchema` 持久化 `lastFailureDetail`（解决问题 5）

**修改 `types.ts`**：

```typescript
export const StateJsonSchema = z.object({
  // ... 现有字段 ...
  lastFailureDetail: z.string().nullable().optional(),  // 新增
});
```

**写入时机**（`orchestrator.ts` 中 `handleValidationFailure`）：

```typescript
await sm.atomicUpdate({
  stepIteration: newIteration,
  lastValidation: "FAILED",
  lastFailureDetail: validation.feedback,  // 新增
});
```

**清除时机**（`advanceToNextStep`）：

```typescript
await sm.atomicUpdate({
  step: nextStep,
  stepIteration: 0,
  lastValidation: null,
  lastFailureDetail: null,  // 清除
});
```

**效果**：`auto_dev_state_get` 无需修改，自动返回 `lastFailureDetail`，orchestrator 直接读取无需运行额外命令。

---

## 五、影响分析

### 5.1 文件变更清单

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `mcp/src/index.ts` | 新增 handler | 新增 `auto_dev_reset` 工具注册（约 50 行） |
| `mcp/src/orchestrator.ts` | 修改接口 + 函数 | `NextTaskResult` 增加 2 个可选字段；`handleValidationFailure` 3 个 return 点填充 `lastFailureDetail`；`buildTaskForStep` case "3" 新增 `parseTaskList` 调用（约 80 行新增） |
| `mcp/src/tribunal.ts` | 修改函数 | `prepareTribunalInput` 注入规模信号；新增 `parseDiffSummary`；HIGH 时调整 diff budget（约 40 行新增） |
| `mcp/src/types.ts` | 修改 schema | `StateJsonSchema` 新增 `lastFailureDetail` 字段（3 行） |

**估算总改动量**：约 170-200 行

### 5.2 向后兼容性

- 所有新字段均为 `optional`，现有 state.json 无需迁移
- `NextTaskResult` 新字段不影响现有 caller（MCP JSON 序列化忽略 undefined）
- `auto_dev_reset` 为全新工具，不影响现有工具
- Tribunal digest 格式变化为追加，不改变现有字段结构
- `parseTaskList` 返回空数组时行为退化为原有逻辑

### 5.3 回滚策略

若本次改动引入问题，可按以下顺序逐步回滚：
1. 删除 `auto_dev_reset` 工具注册（不影响其他工具）
2. 从 `NextTaskResult` 移除 `lastFailureDetail` 和 `tasks` 字段
3. 从 `StateJsonSchema` 移除 `lastFailureDetail`
4. 从 `prepareTribunalInput` 移除规模信号注入代码

---

## 六、风险与缓解

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|---------|
| `parseDiffSummary` 解析失败（非标准 git 输出格式） | 低 | 中（规模信号缺失，降级为无注入） | try-catch 包裹，失败时静默跳过，不阻断 tribunal 流程 |
| `parseTaskList` 解析失败（plan.md 格式不规范） | 中 | 低（`tasks` 为 null，orchestrator 退化为单 agent 模式） | 返回空数组，日志记录解析失败原因 |
| `auto_dev_reset` 被误用（前跳到未完成的 phase） | 低 | 高（状态不一致） | 强制校验 `targetPhase <= state.phase` |
| HIGH 时 diff budget 扩大（500 行）导致 tribunal 超 token | 低 | 中（tribunal 超时/截断） | budget 上限 500 行不超过现有 maxBuffer 限制 |
| `lastFailureDetail` 累积导致 state.json 膨胀 | 极低 | 低（单字符串，步骤推进时清除） | 每次 `advanceToNextStep` 时清除 |

---

## 七、验收标准

| AC | 描述 | 验证方式 |
|----|------|---------|
| AC-1 | 调用 `auto_dev_reset(targetPhase=3)` 后，state.json 中 `phase=3`、`step="3"`、`stepIteration=0`、`lastValidation=null`，且 progress-log 包含 `RESET phase=3` 标记 | 单元测试 |
| AC-2 | `auto_dev_reset(targetPhase > currentPhase)` 返回错误，state.json 不变 | 单元测试 |
| AC-3 | `auto_dev_reset` 在 `status=COMPLETED` 状态下返回错误 | 单元测试 |
| AC-4 | Step 5b FAIL 后调用 `auto_dev_next`，返回的 `lastFailureDetail` 非空且内容与 `validation.feedback` 一致 | 单元测试 |
| AC-5 | Step 3 `auto_dev_next` 返回的 `tasks` 数组长度与 plan.md 中 `## Task N` 块的数量相等 | 单元测试 |
| AC-6 | `tasks[n].files` 包含 plan.md 对应 Task 中 `新建:` 和 `修改:` 后列出的全部路径 | 单元测试 |
| AC-7 | `tasks[n].dependencies` 正确提取 plan.md 中 `依赖: Task N` 声明的依赖编号列表 | 单元测试 |
| AC-8 | 700+ 行变更（insertions+deletions）时，tribunal digest 包含 `HIGH` 字样和"必须逐文件审查"指令 | 单元测试 |
| AC-9 | 50 行以内变更时，tribunal digest 包含 `LOW` 字样，且不包含"必须逐文件审查"字样 | 单元测试 |
| AC-10 | Step 5b FAIL 后调用 `auto_dev_state_get`，返回的 state 中 `lastFailureDetail` 为非空字符串 | 集成测试 |
| AC-11 | Step 3 `auto_dev_next` 在 `prompt` 字段仍返回完整任务描述，与无 `tasks` 字段时行为相同 | 单元测试 |
| AC-12 | `buildTaskForStep` 函数签名保持 `Promise<string>` 不变，`tasks` 字段只在 step "3" 的上层调用点组装，不通过 `buildTaskForStep` 返回 | 代码审查 |
| AC-13 | `auto_dev_reset(targetPhase=3)` 后，state.json 中 `tribunalSubmits` 不含 key >= 3 的条目，`phaseEscalateCount` 不含 key >= 3 的条目 | 单元测试 |
| AC-14 | `regressToPhase` 路径（CODE_BUG 回退）触发后，state.json 中 `lastFailureDetail` 为非空字符串，内容与 `validation.feedback` 一致 | 单元测试 |
| AC-15 | `ALL_APPROACHES_EXHAUSTED` 路径触发后，state.json 中 `lastFailureDetail` 为非空字符串，status 为 "BLOCKED" | 单元测试 |
