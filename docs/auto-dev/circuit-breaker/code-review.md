# 代码审查报告：断路器机制（Circuit Breaker）

## 审查范围

- 审查文件 4 个，新增/修改代码约 280 行（含测试）
- `mcp/src/orchestrator.ts` — ApproachState 接口、handleApproachFailure()、getStepGoal()、computeNextTask() 断路器集成、buildTaskForStep() 方案计划指令（约 120 行新增/修改）
- `mcp/src/orchestrator-prompts.ts` — parseApproachPlan()、extractOneLineReason()、buildCircuitBreakPrompt()（约 85 行新增）
- `mcp/src/__tests__/orchestrator.test.ts` — 断路器集成测试（约 220 行新增）
- `mcp/src/__tests__/orchestrator-prompts.test.ts` — 解析和 prompt 构建测试（约 180 行新增）

全量测试 282 个用例全部通过。

---

## Must-Execute Rule 1: 调用方审查（Caller-Side Review）

### 新增函数调用关系追踪

| 函数 | 生产者（定义） | 消费者（调用方） | 调用参数/返回值匹配 |
|------|---------------|-----------------|-------------------|
| `parseApproachPlan()` | `orchestrator-prompts.ts:134` | `orchestrator.ts:337`（handleApproachFailure 内） | 匹配：传入 `string`，返回 `ApproachEntry[] \| null`，消费方正确处理 null |
| `extractOneLineReason()` | `orchestrator-prompts.ts:168` | `orchestrator.ts:365`（handleApproachFailure 内） | 匹配：传入 `feedback: string`，返回 `string`，消费方用于 `failReason` 字段 |
| `buildCircuitBreakPrompt()` | `orchestrator-prompts.ts:180` | `orchestrator.ts:378`（handleApproachFailure 内） | 匹配：调用方传 `{goal, approach, prohibited, outputDir}`，与签名一致 |
| `handleApproachFailure()` | `orchestrator.ts:322` | `orchestrator.ts:707`（computeNextTask 内） | 匹配：3 种 action 返回值均被正确处理（CIRCUIT_BREAK/ALL_EXHAUSTED/CONTINUE） |
| `getStepGoal()` | `orchestrator.ts:300` | `orchestrator.ts:375`（handleApproachFailure 内） | 匹配：传入 `(step, outputDir)`，返回 `Promise<string>` |

**设计文档与实现偏差**：设计文档 4.6 节定义 `buildCircuitBreakPrompt({originalGoal, nextApproach, prohibited})`，实际实现改为 `{goal, approach, prohibited, outputDir}`。参数名重命名 + 新增 `outputDir` 字段。偏差合理（outputDir 为 agent 提供上下文），调用方与定义一致，不构成问题。

### 消费方处理验证

- `handleApproachFailure` 返回的 `ApproachAction` 联合类型在 `computeNextTask` 中被完整消费：
  - `CIRCUIT_BREAK`: 写入 state（stepIteration=0, approachState），返回清零 prompt -- 正确
  - `ALL_EXHAUSTED`: 写入 state，atomicUpdate BLOCKED，返回 escalation -- 正确
  - `CONTINUE`: 持久化 approachState（如果有），走现有 revision 逻辑 -- 正确

---

## Must-Execute Rule 2: 休眠路径检测（Dormant Path Detection）

| 代码路径 | 状态 | 风险说明 |
|----------|------|---------|
| `computeNextTask()` validation.passed === false 分支 | 已验证（生产在用） | escalation、revision prompt 都是已有路径 |
| `handleApproachFailure()` 整体 | 新代码 | 全新路径，但有单元测试覆盖 3 种 action |
| `getStepGoal()` 解析 plan.md | 新代码 | 有 fallback "完成步骤 N 的任务"，测试中通过 mock 验证 |
| `parseApproachPlan()` | 新代码 | 有 5 个测试用例覆盖 happy/edge case |
| `buildCircuitBreakPrompt()` | 新代码 | 有 5 个测试用例 |
| `writeStepState()` 写入 approachState 字段 | 已验证（生产在用） | Object.assign 机制，新增字段自然支持 |
| `readStepState()` 读取 approachState 字段 | 已验证（生产在用） | `raw.approachState ?? null` 安全 |
| `buildTaskForStep()` approachPlanInstruction 追加 | 已验证路径的扩展 | 在已有函数末尾追加字符串，低风险 |

---

## 审查发现

### P0: 阻塞性问题

无。

### P1: 重要问题

**P1-1: 步骤推进时未清除 approachState，导致跨步骤状态泄漏**

文件：`/Users/admin/.claude/plugins/auto-dev-plugin/mcp/src/orchestrator.ts`，第 841-845 行

当 validation 通过、推进到下一个 step 时：

```typescript
await writeStepState(sm.stateFilePath, {
  step: nextStep,
  stepIteration: 0,
  lastValidation: null,
  // 缺少 approachState: null
});
```

`writeStepState` 使用 `Object.assign(raw, updates)` 合并，如果上一个 step 的 `approachState` 已写入 state.json，推进到新 step 后旧的 `approachState` 仍然残留。新 step 的首次失败会读到旧 step 的方案列表，导致错误的断路器行为。

同样的问题出现在第 822-826 行（所有步骤完成时）和第 673-679 行（首次设置 step 时），但这两处影响较低（首次没有旧状态；完成时不再执行）。

**修复建议**：

```typescript
// 第 841-845 行
await writeStepState(sm.stateFilePath, {
  step: nextStep,
  stepIteration: 0,
  lastValidation: null,
  approachState: null,  // 清除上一步的方案状态
});
```

---

### P2: 优化建议

**P2-1: parseApproachPlan 缺少 `**方法**` 字段缺失时的 fallback summary 测试**

`parseApproachPlan` 代码中对 `**方法**` 字段缺失有 fallback 逻辑（`?? "主方案"` / `?? "备选方案 X"`），但测试用例中没有覆盖这个分支。建议补充一个测试用例，验证当 `**方法**` 行不存在时 summary 使用 fallback 值。

**P2-2: handleApproachFailure 直接修改入参对象**

`handleApproachFailure` 中 `current.failCount++`（第 354 行）和 `approachState.currentIndex++`（第 367 行）直接修改了传入的 `stepState.approachState` 引用。虽然当前调用方不依赖入参不变性，但属于防御性编程的改进点。如果未来有其他调用方或在同一个 computeNextTask 调用中多次引用 stepState，可能产生副作用。

**P2-3: getStepGoal 使用 phase 号而非 step 字符串匹配**

`getStepGoal` 将 step "3" 转换为 phase 3 后匹配 `## Task 3:`，但 step "4a" 也会匹配 `## Task 4:`。如果 plan.md 中没有严格的 Task 编号对应关系（比如 plan.md 的 Task 编号是顺序的而非按 phase 编号），可能匹配到错误的 task。当前由于 getStepGoal 只在 circuit break 时提供 goal 描述，误匹配影响可控（fallback 文案也可接受）。

---

## AC 验收检查

| AC | 状态 | 说明 |
|----|------|------|
| AC-1 | PASS | parseApproachPlan 正确解析主方案 + 备选方案，测试覆盖标准格式和变体 |
| AC-2 | PASS | CIRCUIT_BREAK 返回的 prompt 包含 "禁止" 字样，测试验证 |
| AC-3 | PASS | 断路器切换后 stepIteration 重置为 0，测试验证 writeStepState 调用 |
| AC-4 | PASS | 方案耗尽时返回 escalation，status 变为 BLOCKED，测试验证 |
| AC-5 | PASS | 无 approach-plan.md 时返回 CONTINUE，测试验证 |
| AC-6 | PASS | 格式不规范时 parseApproachPlan 返回 null，测试覆盖 |
| AC-7 | PASS | 清零 prompt 不包含框架术语，containsFrameworkTerms 测试验证 |
| AC-8 | PASS | step "3" prompt 包含方案计划指令，step "1a" 不包含，测试验证 |

---

## 总结

**NEEDS_FIX**

1 个 P1 问题需要修复（步骤推进时未清除 approachState），修复方案明确且改动极小（加一行 `approachState: null`）。修复后可 PASS。

整体实现质量高：
- 与设计文档高度一致，偏差合理
- 三种 action 的消费方处理完整
- 向后兼容性好（无 approach-plan.md 时退化为现有行为）
- 测试覆盖充分（13 个断路器相关测试用例）
- 符合 Invisible Framework 原则（prompt 无框架术语）
