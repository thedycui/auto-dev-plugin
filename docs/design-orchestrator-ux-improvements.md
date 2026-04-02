# Orchestrator 调度质量改进设计文档

> 日期：2026-04-02
> 状态：待审查
> 触发：executable-ac 全流程复盘中发现的 5 个调度问题

## 一、背景与动机

### 1.1 问题来源

在 executable-ac 的 auto-dev 全流程中，orchestrator（主持 agent）暴露了以下问题：

1. **Phase 回退无正规通道**：用户请求 `--phase=3` 回退，但 `auto_dev_checkpoint` 的 `PHASE_STEP_DESYNC` 保护拦住了请求，orchestrator 被迫直接 Edit state.json 绕过保护
2. **FAIL 原因不透明**：Step 5b 首次 FAIL 后，`auto_dev_next` 返回的修订 prompt 中没有上次失败的具体原因，orchestrator 只能猜测
3. **Step 3 并行派发无支持**：用户要求"使用多个 subagent"，但 `auto_dev_next` 将所有 Task 打包为单一 prompt，无法拆分派发
4. **Tribunal FALLBACK 对大变更审查深度不足**：734 行变更的 code review 由 subagent fallback 完成，缺少"变更规模 → 审查深度"的自动调节
5. **orchestrator 需要自己跑命令了解状态**：`auto_dev_state_get` 不返回运行时验证信息（如最近 build/test 结果）

### 1.2 设计目标

- orchestrator 只调 MCP 工具 + 派发 subagent，不直接操作文件/运行命令
- FAIL → 修订循环有足够上下文，不需要猜测
- Step 3 可按 Task 拆分并行派发
- 大变更自动升级审查严格度

## 二、方案设计

### 方案 A：最小改动（推荐）

在现有 orchestrator 架构上做增量改进，不重构核心流程。

### 方案 B：引入 Task-level orchestration

让 `auto_dev_next` 在 Step 3 时逐 Task 返回（类似 Phase 8 的子步骤），orchestrator 循环派发。需要新增 task 级别的状态追踪。

**选择方案 A**：方案 B 改动大（需要 step 状态机支持子步骤嵌套），且用户已在 SKILL.md 中定义了 orchestrator 侧的并行拆分策略，只需 MCP 提供支撑数据。

## 三、详细设计

### 3.1 新增 `auto_dev_reset` 工具（解决问题 1）

**目的**：提供正规的 Phase 回退通道，取代手动编辑 state.json。

```typescript
// index.ts — 新增 tool handler
{
  name: "auto_dev_reset",
  description: "Reset orchestrator to a target phase. Writes audit trail to progress-log.",
  inputSchema: {
    projectRoot: string,
    topic: string,
    targetPhase: number,     // 1-7
    reason: string,          // 必填，写入 progress-log
  }
}
```

**实现逻辑**（在 `index.ts` 中新增 handler）：

1. 加载 state.json
2. 校验 `targetPhase` 在 `PHASE_SEQUENCE[state.mode]` 中且 `<= state.phase`（只能回退，不能前跳）
3. 重置字段：
   ```
   phase = targetPhase
   status = "IN_PROGRESS"
   step = String(targetPhase)   // 回到该 phase 的第一个 step
   stepIteration = 0
   lastValidation = null
   approachState = null
   ```
4. 清除关联状态：`tribunalSubmits` 中 >= targetPhase 的 key 全部删除
5. 写入 progress-log：`<!-- RESET phase=${targetPhase} reason="${reason}" timestamp=... -->`
6. 调用 `sm.atomicUpdate()`

**不需要的字段清理**：`startCommit` 保留（git 基线不变）、`tddTaskStates` 保留（已完成的 TDD 状态仍有效）。

**安全约束**：
- 不允许回退到 Phase 0（不存在）
- 不允许在 `status === "COMPLETED"` 时回退（已完成的 session 不可重开）
- `reason` 必填且非空

### 3.2 `auto_dev_next` 返回 `lastFailureDetail`（解决问题 2）

**目的**：FAIL 后返回具体失败原因，orchestrator 不需要猜测。

**修改 `NextTaskResult` 接口**：

```typescript
interface NextTaskResult {
  // ... 现有字段 ...
  lastFailureDetail?: string;  // 新增：上次失败的具体原因
}
```

**来源**：在 `handleValidationFailure` 各分支中填充：

| 分支 | lastFailureDetail 来源 |
|------|----------------------|
| Tribunal FAIL（under limit） | `validation.feedback`（tribunal 的裁决反馈） |
| Circuit breaker | `validation.feedback` + approach 切换说明 |
| Iteration limit | `validation.feedback` |
| 非 tribunal 普通 FAIL | `validation.feedback` |

**对于 tribunal subagent 模式**：`lastFailureDetail` 在 escalation 中已有 `lastFeedback` 字段，不重复。仅在**返回修订 prompt 的场景**（即 `handleValidationFailure` 走到 revision 分支时）填充。

**实现位置**：`orchestrator.ts` `handleValidationFailure()` 的 3 个 return 点：

```typescript
// 1. tribunal under limit (line ~1386)
return {
  ...existing,
  lastFailureDetail: validation.feedback,
  message: `Step ${currentStep} tribunal FAIL (attempt ${count}/3). Revision needed.`,
};

// 2. non-tribunal revision (line ~1445)
return {
  ...existing,
  lastFailureDetail: combinedFeedback,
  message: `Step ${currentStep} validation failed...`,
};

// 3. (escalation 场景已有 lastFeedback，不需要额外字段)
```

**同时**：在 `index.ts` 的 `auto_dev_next` handler 中，当注入 mandate 时，也将 `lastFailureDetail` 传递到返回值中，让 orchestrator 可以将失败原因注入到 subagent 的 prompt 中。

### 3.3 Step 3 返回 Task 列表支持并行拆分（解决问题 3）

**目的**：让 orchestrator 能按 Task 拆分并行派发，而不是只能派发一个巨型 prompt。

**方案**：`auto_dev_next` 在 Step 3 时返回额外的 `tasks` 字段：

```typescript
interface NextTaskResult {
  // ... 现有字段 ...
  tasks?: TaskInfo[];  // 新增：仅 Step 3 返回
}

interface TaskInfo {
  taskNumber: number;
  title: string;           // Task 标题
  description: string;     // Task 完整描述（从 plan.md 提取）
  files: string[];         // 涉及的文件列表（从描述中提取）
  dependencies: number[];  // 依赖的 Task 编号
}
```

**实现位置**：`orchestrator.ts` `buildTaskForStep()` case `"3"` 分支：

1. 复用现有 `extractTaskDetails(planContent)` 提取所有 Task
2. **新增** `parseTaskList(planContent)` 函数：逐个解析 `## Task N` 块，提取：
   - `taskNumber`：从 `## Task N:` 中的 N
   - `title`：`## Task N: {title}` 中的 title
   - `description`：该 Task 的完整 markdown 内容
   - `files`：从 "文件" 部分提取（匹配 `新建:` / `修改:` 后的路径）
   - `dependencies`：从 "依赖" 部分提取（匹配 `Task N`）
3. `prompt` 字段仍返回完整的合并 prompt（向后兼容）
4. `tasks` 字段返回解析后的 TaskInfo 数组

**orchestrator 侧使用**（SKILL.md 已描述的流程）：
- 如果 `tasks` 存在且长度 > 1：按 `files` 重叠分 Wave，同 Wave 并行派发
- 如果 `tasks` 不存在或长度 <= 1：使用 `prompt` 单 agent 派发（向后兼容）

### 3.4 Tribunal digest 注入变更规模信号（解决问题 4）

**目的**：大变更时 tribunal/reviewer 自动提高审查严格度。

**修改位置**：`tribunal.ts` `prepareTribunalInput()` 函数。

**实现**：

1. 在 `getDiffStatWithUntracked()` 返回后，解析统计行提取总行数：
   ```typescript
   const diffStatLines = diffStat.split("\n");
   const summaryLine = diffStatLines[diffStatLines.length - 1]; // "26 files changed, 734 insertions(+), 44 deletions(-)"
   const totalChanges = parseDiffSummary(summaryLine); // { files: 26, insertions: 734, deletions: 44 }
   ```

2. 在 digest 头部（FAIL 默认立场之后）注入规模信号：
   ```markdown
   ## 变更规模
   - 文件数: 26
   - 新增行: 734
   - 删除行: 44
   - 风险等级: HIGH (>500 行变更)
   
   > ⚠️ 大规模变更：必须逐文件审查关键源文件（非 dist/map/lock），不能仅看 diff 摘要。
   ```

3. 风险等级阈值：
   | 总变更行数 | 风险等级 | 额外指令 |
   |-----------|---------|---------|
   | ≤ 100 | LOW | 无 |
   | 101-500 | MEDIUM | "重点审查核心逻辑文件" |
   | > 500 | HIGH | "必须逐文件审查，不能仅看摘要" |

4. 同时增大 HIGH 级别的 diff budget：`getKeyDiff()` 的 `maxLines` 从 300 提升到 500（仅当 HIGH 时）。

### 3.5 `auto_dev_state_get` 增加 `lastFailureDetail` 快照（解决问题 5）

**目的**：减少 orchestrator 需要自己跑命令的场景。

这不需要修改 `auto_dev_state_get` 本身（它已经返回完整的 StateJson），而是在 state.json 中持久化 `lastFailureDetail`。

**修改**：在 `types.ts` 的 `StateJsonSchema` 中新增：

```typescript
lastFailureDetail: z.string().nullable().optional(),
```

在 `handleValidationFailure` 写入 `lastValidation: "FAILED"` 时，同时写入 `lastFailureDetail`：

```typescript
await sm.atomicUpdate({
  stepIteration: newIteration,
  lastValidation: "FAILED",
  lastFailureDetail: validation.feedback,  // 新增
});
```

在 `advanceToNextStep` 时清除：

```typescript
await sm.atomicUpdate({
  step: nextStep,
  stepIteration: 0,
  lastValidation: null,
  lastFailureDetail: null,  // 清除
});
```

这样 `auto_dev_state_get` 自动就能返回失败详情，orchestrator 无需自己分析。

## 四、文件变更清单

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `mcp/src/index.ts` | 修改 | 新增 `auto_dev_reset` handler |
| `mcp/src/orchestrator.ts` | 修改 | `NextTaskResult` 增加 `lastFailureDetail` + `tasks`；`handleValidationFailure` 填充字段；`buildTaskForStep` case "3" 增加 `parseTaskList` |
| `mcp/src/tribunal.ts` | 修改 | `prepareTribunalInput` 注入变更规模信号 |
| `mcp/src/types.ts` | 修改 | `StateJsonSchema` 增加 `lastFailureDetail` 字段 |

## 五、验收标准

- AC-1: `auto_dev_reset(targetPhase=3)` 能正确重置 state 并在 progress-log 写入 RESET 标记
- AC-2: `auto_dev_reset` 不允许前跳（targetPhase > currentPhase 返回错误）
- AC-3: `auto_dev_reset` 不允许在 COMPLETED 状态回退
- AC-4: Step 5b FAIL 后 `auto_dev_next` 返回的 `lastFailureDetail` 非空且包含具体失败原因
- AC-5: Step 3 `auto_dev_next` 返回的 `tasks` 数组长度与 plan.md 中的 Task 数量一致
- AC-6: `tasks[].files` 正确提取了 plan.md 中每个 Task 的文件列表
- AC-7: `tasks[].dependencies` 正确提取了 Task 间依赖关系
- AC-8: 700+ 行变更时 tribunal digest 包含 "HIGH" 风险等级和逐文件审查指令
- AC-9: 50 行变更时 tribunal digest 包含 "LOW" 风险等级，无额外指令
- AC-10: `auto_dev_state_get` 在 FAIL 后返回 `lastFailureDetail` 非空字符串
- AC-11: 向后兼容——不使用 `tasks` 字段时，Step 3 仍返回完整 `prompt`

## 六、方案对比

| 维度 | 方案 A（推荐） | 方案 B（Task-level orchestration） |
|------|--------------|----------------------------------|
| 改动量 | ~200 行（4 个文件） | ~500 行（需新增 task 状态机） |
| 向后兼容 | 完全兼容 | 需要迁移现有 state.json |
| Step 3 并行 | orchestrator 侧拆分（SKILL.md 已定义） | MCP 侧逐 Task 返回 |
| 复杂度 | 低 | 高（step 嵌套子步骤） |
| 风险 | 低 | 中（状态机复杂度增加） |
