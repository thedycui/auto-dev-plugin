# Phase 4 独立裁决

你是独立裁决者。你的默认立场是 FAIL。
PASS 必须对每条检查项提供证据（文件名:行号），FAIL 只需说明理由。
PASS 的举证成本远大于 FAIL —— 如果你不确定，判 FAIL。

## 框架统计（可信数据）
```
 docs/auto-dev/_global/lessons-global.json      | 202 +++++--
 mcp/dist/orchestrator-prompts.js               |  72 +++
 mcp/dist/orchestrator-prompts.js.map           |   2 +-
 mcp/dist/orchestrator.js                       | 159 ++++-
 mcp/dist/orchestrator.js.map                   |   2 +-
 mcp/node_modules/.package-lock.json            | 800 +++++++++++++++++++++++++
 mcp/src/__tests__/orchestrator-prompts.test.ts | 186 ++++++
 mcp/src/__tests__/orchestrator.test.ts         | 251 +++++++-
 mcp/src/orchestrator-prompts.ts                | 102 ++++
 mcp/src/orchestrator.ts                        | 205 ++++++-
 10 files changed, 1917 insertions(+), 64 deletions(-)

```

## Phase 1 设计评审
```
# 设计审查报告：断路器机制（Circuit Breaker）

**审查日期**: 2026-03-26
**审查阶段**: Phase 1 — 架构评审
**总体评价**: **PASS**

---

## 审查摘要

设计文档质量较高：问题分析到位（锚定效应 + 缺乏方案级退出），方案对比充分（A/B 两方案 + 对比表），AC 有 8 条且覆盖正向/负向/兼容性场景。选型方案 A（Orchestrator 内置断路器）在技术上与现有 `computeNextTask()` 架构兼容，改动范围合理。

以下按优先级列出需关注的问题。

---

## P0：阻塞性问题

无。

---

## P1：重要问题，应该修复

### P1-1：原始需求中的 "spawn 新 agent" 与设计文档的 "不 spawn" 存在认知偏差，需明确对齐

**问题**：原始需求文档（`design-circuit-breaker.md`）4.3 节明确写 `freshContext: true // 标记使用新 agent`，并且生命周期中反复提到 "spawn 新 agent"。但设计文档 1.3 Non-Goals 第 5 条明确写 "不做 spawn 新 agent"，清零通过构建不含失败细节的 prompt 实现。

这是一个正确的架构决策（`computeNextTask()` 是纯计算函数，不控制 agent 生命周期），但需要在设计文档中明确说明：**为什么不采纳原始需求的 spawn 方案，以及当前方案如何等效解决锚定效应问题。**

当前的 "清零 prompt" 方案在同一 agent context 中执行时，agent 的 conversation history 中仍然存在之前的失败交互。清零 prompt 只是新一轮的 task prompt，但 agent 的上下文窗口中可能仍包含旧失败信息。这一点需要在设计中讨论其影响和缓解措施。

**建议**：在 Non-Goals 第 5 条或 4.6 节中补充说明：
1. 为什么选择 "清零 prompt" 而非 "spawn 新 agent"
2. 主 agent 在收到 `computeNextTask` 返回的 circuit-break prompt 后，应以 `Agent()` subagent 方式执行（subagent 天然拥有干净 context），明确这一点是清零生效的前提

### P1-2：`handleApproachFailure` 返回 `CONTINUE` 时 `approachState` 未持久化

**问题**：设计文档 4.5 节中，当 `current.failCount < MAX_APPROACH_FAILURES` 时返回 `{ action: "CONTINUE", approachState }`。但在 4.4 节的 `computeNextTask()` 改动中，只有 `CIRCUIT_BREAK` 分支调用了 `writeStepState` 写入 `approachState`。`CONTINUE` 分支走的是现有 revision 逻辑，**没有持久化更新后的 `approachState`（failCount 已 +1）**。

这意味着如果方案内第 1 次失败后 agent 修正成功再次失败，`failCount` 会从 0 重新计算，而非从 1 开始。断路器永远不会触发。

**建议**：在 `CONTINUE` 分支也写入 `approachState`。修改 4.4 节，在现有 revision 逻辑的 `writeStepState` 调用中，增加 `approachState: approachResult.approachState` 字段。

### P1-3：stepIteration 与断路器的交互存在竞态

**问题**：设计文档 4.9 节提到 "在有 approachState 时不使用 MAX_STEP_ITERATIONS（由断路器自行管理上限）"，但 4.4 节的伪代码中，`handleApproachFailure()` 被插入在 `escalation 检查之前`。实际代码（`orchestrator.ts:580-598`）的执行顺序是：

```
validation failed -> 检查 currentIteration >= MAX_STEP_ITERATIONS -> escalation
```

如果 `handleApproachFailure` 插入在 escalation 检查之前，但没有修改 escalation 检查逻辑，可能出现：
- 方案 A 失败 2 次 -> 断路器切换到方案 B，`stepIteration` 重置为 0
- 方案 B 失败 1 次 -> `stepIteration` = 1，正常 revision
- 问题在于 escalation 检查仍在 `handleApproachFailure` 之后，两者不会冲突

实际分析后发现，只要在 `CIRCUIT_BREAK` 分支中 `return`（设计中已做到），`stepIteration >= MAX_STEP_ITERATIONS` 的检查就不会被执行到。但设计文档应明确说明：**当有 approachState 时，跳过 escalation 检查**，否则实现者可能把 `handleApproachFailure` 放错位置。

**建议**：在 4.4 节的伪代码中明确注释：`handleApproachFailure` 必须在 `MAX_STEP_ITERATIONS` 检查之前执行且各分支独立 return，或者显式添加 `if (approachState) { skip escalation check }` 的守卫逻辑。

### P1-4：approach-plan.md 首次解析时机的边界情况（路径激活风险）

**问题**：设计中 `handleApproachFailure` 在首次失败时才去读 `approach-plan.md`。但实际执行流程是：
1. Agent 收到 step 3 的 prompt（包含方案计划要求）
2. Agent 执行任务，输出 approach-plan.md + 代码
3. `validateStep("3")` 运行 build + test
4. 如果 build/test 失败，`handleApproachFailure` 尝试读 approach-plan.md

**边界情况**：Agent 可能在安装依赖阶段就失败了，根本没来得及写 approach-plan.md，也没来得及写代码。此时 `handleApproachFailure` 返回 `CONTINUE`，走常规 revision。这个行为是合理的 graceful degradation。

但另一个边界：Agent 写了 approach-plan.md 但格式不规范（只有主方案没有备选），`parseApproachPlan` 返回 null。此时断路器永远不会激活，Agent 将在 `MAX_STEP_ITERATIONS = 3` 次后被 escalate。**设计应讨论：是否在此场景下通过 revision prompt 要求 Agent 补充备选方案**。

**建议**：在 4.5 节或风险表中补充：当 `parseApproachPlan` 返回 null（格式不规范）时，考虑在 revision prompt 中追加 "你的 approach-plan.md 缺少备选方案，请补充" 的提示。

---

## P2：优化建议，可选

### P2-1：改动范围表遗漏测试文件

设计文档 5.1 节的改动范围表未列出测试文件。根据 AC-1 到 AC-8 的验证方式，至少需要新增 `orchestrator.test.ts` 中的测试用例，或新增 `circuit-breaker.test.ts`。建议在改动范围表中补充测试文件及预估行数。

### P2-2：`extractOneLineReason()` 未定义

设计文档 4.5 节引用了 `extractOneLineReason(feedback)` 函数，但未给出定义或说明其行为。feedback 可能是很长的编译错误输出（参见 `translateFailureToFeedback` 返回的内容），需要说明截取逻辑（首行？关键错误行？字数限制？）。

### P2-3：`getStepGoal()` 未定义

设计文档 4.5 节引用了 `getStepGoal(step, outputDir)` 来获取原始目标，但未定义其实现。需要说明是从 plan.md 解析、从 state.json 读取、还是从 prompt 模板中提取。

### P2-4：AC-8 的 step 覆盖范围与正文不一致

4.7 节说对 step "3"、"4a"、"5b" 追加方案计划指令。但 AC-8 说 step "3"、"5b" 包含指令，遗漏了 "4a"。而原始需求文档还提到了 phase8-integration-test。建议统一。

### P2-5：方案切换后 approach-plan.md 的处理

断路器切换方案后，旧的 approach-plan.md 仍在 outputDir 中。如果新方案的 agent 再次执行，是否会覆盖这个文件？如果覆盖了，`approachState` 中已有的方案列表是否会被新内容冲突？建议说明：切换后 orchestrator 应以持久化的 `approachState` 为准，不再重新解析 approach-plan.md。

---
... (truncated, 18 lines omitted)
```

## Phase 2 计划评审
```
# 计划审查报告：断路器机制（Circuit Breaker）

**审查日期**: 2026-03-26
**审查阶段**: Phase 2 -- 计划审查
**总体评价**: **PASS**

---

## 审查摘要

实施计划共 10 个任务，覆盖了设计文档的全部 8 条 AC 和设计审查中的 4 个 P1 问题中的 2 个（P1-2、P1-3）。任务粒度合理（每个任务 2-10 分钟可完成），依赖关系正确，文件路径均已验证存在于代码库中。

---

## P0：阻塞性问题

无。

---

## P1：重要问题，应该修复

### P1-1：设计审查 P1-1（清零 prompt 在同一 agent context 中的锚定效应）未在计划中体现

**问题**：设计审查 P1-1 指出 "清零 prompt" 在同一 agent context 中执行时，agent 的 conversation history 仍包含失败信息，建议在设计中补充说明 subagent 执行方式是清零生效的前提。计划中 Task 3（buildCircuitBreakPrompt）和 Task 5（computeNextTask 集成）均未提及此问题的处理方式。

虽然设计审查将此定性为需要 "在设计文档中补充说明"，但如果不在实现中确保 `computeNextTask` 返回的 circuit-break prompt 以某种方式标记需要干净 context 执行（例如返回值中增加 `freshContext: true` 字段），清零效果将依赖主 agent 的行为约定，缺乏强制力。

**建议**：在 Task 5 中增加一条完成标准：CIRCUIT_BREAK 返回值中应包含标记（如 `freshContext: true` 或在 `agent` 字段中指定 subagent），使调用方能识别此 prompt 需要在干净 context 中执行。或者在 Task 5 描述中明确说明此为 non-goal，由调用方自行保证。

### P1-2：设计审查 P1-4（approach-plan.md 格式不规范时的恢复策略）未在计划中体现

**问题**：设计审查 P1-4 建议：当 `parseApproachPlan` 返回 null（Agent 只写了主方案没有备选）时，应在 revision prompt 中追加 "你的 approach-plan.md 缺少备选方案，请补充" 的提示。

计划中 Task 5（computeNextTask 集成）的描述和完成标准均未涉及此场景。如果 Agent 写了不合格的 approach-plan.md，当前计划的行为是静默退化为常规 revision 逻辑，Agent 不会得到任何关于 approach-plan.md 格式问题的反馈，后续重试中仍不会输出合格的方案计划。

**建议**：在 Task 5 中增加：当 `handleApproachFailure` 返回 CONTINUE 且检测到 approach-plan.md 存在但解析失败时，在 revision prompt 中附加方案计划补充提示。或者在 Task 4（handleApproachFailure）中返回一个额外字段 `planFeedback`，由 Task 5 在构建 revision prompt 时拼入。

---

## P2：优化建议，可选

### P2-1：Task 6 中 step "4a" 追加方案计划指令的实际效果需考虑

**问题**：查看 `buildTaskForStep` 代码（`orchestrator.ts:503-511`），step "4a" 在有 feedback 时走 `buildRevisionPrompt` 路径，没有 feedback 时返回一段简短的修复提示。Task 6 要求对 "4a" 追加方案计划指令，但 "4a" 本质是一个修复/验证 step，Agent 在此 step 首次执行时通常不会做创造性的工作（安装依赖、选择工具等），断路器的价值有限。

设计文档 4.7 节和 AC-8 之间本身就存在不一致（P2-4），建议在实现时统一：只对 step "3" 和 "5b" 追加方案计划指令，"4a" 可选择不追加。

### P2-2：Task 9 的测试覆盖可进一步细化

Task 9 描述了 5 个测试场景，但缺少以下边界场景的测试：
- 方案 A 失败 1 次后成功，然后方案 A 再次失败 -- 验证 failCount 是否正确累积（测试 P1-2 修复的持久化逻辑）
- 方案切换后 stepIteration 重置为 0 的场景下，后续 revision 时 stepIteration 是否正确递增

建议在 Task 9 中补充这两个场景。

### P2-3：Task 1 和 Task 4 可考虑合并

Task 1（扩展 StepState 接口和读写函数）和 Task 4（handleApproachFailure 核心逻辑）高度相关，且 Task 1 的改动量很小（接口定义 + readStepState/writeStepState 各加一个字段）。分开可能导致 Task 1 独立测试困难（没有消费方）。不过当前拆分也可接受，不影响实现。

---

## Checklist 逐项评估

| 检查项 | 结果 | 备注 |
|--------|------|------|
| AC 覆盖 | PASS | AC-1~AC-8 均有对应任务覆盖。AC-1/AC-6 -> Task 7, AC-2/AC-7 -> Task 8, AC-3/AC-4/AC-5 -> Task 9, AC-8 -> Task 9 |
| 任务粒度 | PASS | 10 个任务均在 2-10 分钟范围内，无需拆分 |
| 依赖正确性 | PASS | Task 4 依赖 Task 1/2/3, Task 5 依赖 Task 4, Task 7/8/9 依赖对应实现任务，Task 10 依赖 7/8/9。DAG 无环，顺序合理 |
| 文件准确性 | PASS | 所有文件路径已验证存在：`mcp/src/orchestrator.ts`, `mcp/src/orchestrator-prompts.ts`, `mcp/src/__tests__/orchestrator.test.ts`, `mcp/src/__tests__/orchestrator-prompts.test.ts` |
| 完成标准 | PASS (minor) | 每个任务均有具体完成标准，可验证。P1-1/P1-2 指出的遗漏点需补充完成标准 |
| 设计审查 P1 覆盖 | NEEDS_ATTENTION | P1-2（持久化）和 P1-3（stepIteration 交互）已覆盖。P1-1（清零 context 保证）和 P1-4（格式不规范恢复策略）未覆盖 |
| 遗漏检查 | PASS | 设计文档中描述的所有代码改动均在计划中体现 |

---

## 结论

**PASS** -- 实施计划整体质量良好，任务拆分合理、依赖正确、文件路径准确、AC 覆盖完整。两个 P1 问题涉及设计审查中提出但未在计划中落地的改进建议，建议在实现前补充到 Task 4 和 Task 5 的描述和完成标准中，避免实现阶段遗漏。P2 问题为优化建议，可在实现阶段灵活处理。

```

## 主 Agent 的代码审查
```
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
... (truncated, 37 lines omitted)
```

## 关键代码变更
```diff
diff --git a/docs/auto-dev/_global/lessons-global.json b/docs/auto-dev/_global/lessons-global.json
index 58b35e6..54dc8c3 100644
--- a/docs/auto-dev/_global/lessons-global.json
+++ b/docs/auto-dev/_global/lessons-global.json
@@ -7,10 +7,10 @@
     "lesson": "Phase 1 required revision",
     "topic": "lessons-evolution",
     "reusable": true,
-    "appliedCount": 20,
+    "appliedCount": 23,
     "timestamp": "2026-03-25T09:48:52.283Z",
-    "lastAppliedAt": "2026-03-26T07:19:01.900Z",
-    "score": 35,
+    "lastAppliedAt": "2026-03-26T14:28:54.119Z",
+    "score": 33,
     "feedbackHistory": [
       {
         "verdict": "helpful",
@@ -101,6 +101,18 @@
         "phase": 6,
         "topic": "tribunal-resilience",
         "timestamp": "2026-03-26T07:20:28.508Z"
+      },
+      {
+        "verdict": "not_applicable",
+        "phase": 1,
+        "topic": "circuit-breaker",
+        "timestamp": "2026-03-26T14:18:14.967Z"
+      },
+      {
+        "verdict": "not_applicable",
+        "phase": 2,
+        "topic": "circuit-breaker",
+        "timestamp": "2026-03-26T14:28:41.054Z"
       }
     ],
     "lastPositiveAt": "2026-03-26T07:20:28.508Z"
@@ -222,10 +234,10 @@
     "context": "Design review v1 found getGlobalLessons() missing writeAtomic() after retirement pass. Fixed in v2 by adding explicit persist step. This is a classic \"read-modify but forget to write\" pattern in lazy evaluation designs.",
     "topic": "lessons-evolution",
     "reusable": true,
-    "appliedCount": 20,
+    "appliedCount": 23,
     "timestamp": "2026-03-25T09:34:30.919Z",
-    "lastAppliedAt": "2026-03-26T07:19:01.900Z",
-    "score": 7,
+    "lastAppliedAt": "2026-03-26T14:28:54.119Z",
+    "score": 5,
     "feedbackHistory": [
       {
         "verdict": "helpful",
@@ -316,6 +328,18 @@
         "phase": 6,
         "topic": "tribunal-resilience",
         "timestamp": "2026-03-26T07:20:28.508Z"
+      },
+      {
+        "verdict": "not_applicable",
+        "phase": 1,
+        "topic": "circuit-breaker",
+        "timestamp": "2026-03-26T14:18:14.967Z"
+      },
+      {
+        "verdict": "not_applicable",
+        "phase": 2,
+        "topic": "circuit-breaker",
+        "timestamp": "2026-03-26T14:28:41.054Z"
       }
     ],
     "lastPositiveAt": "2026-03-26T07:20:28.508Z"
@@ -329,10 +353,10 @@
     "context": "Design review v1 caught this by tracing preflight injection path (local + global) against feedback search path (local only). Fixed by dual-file search in feedback(). Textbook violation of Rule 1: \"not only review the producer, must review the consumer.\"",
     "topic": "lessons-evolution",
     "reusable": true,
-    "appliedCount": 20,
+    "appliedCount": 23,
     "timestamp": "2026-03-25T09:34:36.026Z",
-    "lastAppliedAt": "2026-03-26T07:19:01.900Z",
-    "score": 23,
+    "lastAppliedAt": "2026-03-26T14:28:54.119Z",
+    "score": 21,
     "feedbackHistory": [
       {
         "verdict": "helpful",
@@ -423,6 +447,18 @@
         "phase": 6,
         "topic": "tribunal-resilience",
         "timestamp": "2026-03-26T07:20:28.508Z"
+      },
+      {
+        "verdict": "not_applicable",
+        "phase": 1,
+        "topic": "circuit-breaker",
+        "timestamp": "2026-03-26T14:18:14.967Z"
+      },
+      {
+        "verdict": "not_applicable",
+        "phase": 2,
+        "topic": "circuit-breaker",
+        "timestamp": "2026-03-26T14:28:41.054Z"
... (truncated, 291 lines omitted)
diff --git a/mcp/src/orchestrator-prompts.ts b/mcp/src/orchestrator-prompts.ts
index 4a30b22..9dc816c 100644
--- a/mcp/src/orchestrator-prompts.ts
+++ b/mcp/src/orchestrator-prompts.ts
@@ -3,6 +3,19 @@
  * for task agents. Output prompts must NEVER contain framework terminology.
  */
 
+// Re-export types used by orchestrator.ts
+export interface ApproachEntry {
+  id: string;
+  summary: string;
+  failCount: number;
+}
+
+export interface FailedApproach {
+  id: string;
+  summary: string;
+  failReason: string;
+}
+
 /** Terms that must NEVER appear in prompts sent to task agents. */
 export const FRAMEWORK_TERMS: RegExp[] = [
   /\bcheckpoint\b/i,
@@ -111,3 +124,92 @@ function formatTribunalIssues(detail: string): string {
   lines.push("请根据以上问题逐一修复。");
   return lines.join("\n");
 }
+
+// ---------------------------------------------------------------------------
+// Circuit Breaker — approach-plan.md parsing
+// ---------------------------------------------------------------------------
+
+/** Parse approach-plan.md content into a list of ApproachEntry objects.
+ *  Returns null if fewer than 2 approaches (need primary + at least 1 alt). */
+export function parseApproachPlan(content: string): ApproachEntry[] | null {
+  const approaches: ApproachEntry[] = [];
+
+  // Parse "## 主方案" section
+  const primaryMatch = content.match(
+    /## 主方案\s*\n([\s\S]*?)(?=\n## |$)/,
+  );
+  if (primaryMatch) {
+    const methodMatch = primaryMatch[1].match(/-\s*\*\*方法\*\*:\s*(.+)/);
+    approaches.push({
+      id: "primary",
+      summary: methodMatch?.[1]?.trim() ?? "主方案",
+      failCount: 0,
+    });
+  }
+
+  // Parse "## 备选方案 X" sections
+  const altRegex = /## 备选方案\s+(\w)\s*\n([\s\S]*?)(?=\n## |$)/g;
+  let match;
+  while ((match = altRegex.exec(content)) !== null) {
+    const label = match[1].toLowerCase();
+    const section = match[2];
+    const methodMatch = section.match(/-\s*\*\*方法\*\*:\s*(.+)/);
+    approaches.push({
+      id: `alt-${label}`,
+      summary: methodMatch?.[1]?.trim() ?? `备选方案 ${match[1]}`,
+      failCount: 0,
+    });
+  }
+
+  return approaches.length >= 2 ? approaches : null;
+}
+
+/** Extract the first meaningful line from a long feedback string. */
+export function extractOneLineReason(feedback: string): string {
+  const lines = feedback.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
+  if (lines.length === 0) return "未知原因";
+  // Return the first non-empty line, truncated to 120 chars
+  const first = lines[0];
+  return first.length > 120 ? first.slice(0, 120) + "..." : first;
+}
+
+// ---------------------------------------------------------------------------
+// Circuit Breaker — clean prompt builder
+// ---------------------------------------------------------------------------
+
+export function buildCircuitBreakPrompt(params: {
+  goal: string;
+  approach: string;
+  prohibited: FailedApproach[];
+  outputDir: string;
+}): string {
+  const lines: string[] = [];
+  lines.push("# 任务");
+  lines.push("");
+  lines.push(params.goal);
+  lines.push("");
+  lines.push("## 方案");
+  lines.push("");
+  lines.push("请按以下方案执行：");
+  lines.push(params.approach);
+  lines.push("");
+
+  if (params.prohibited.length > 0) {
+    lines.push("## 约束（以下方案已失败，禁止使用）");
... (truncated, 18 lines omitted)
diff --git a/mcp/src/orchestrator.ts b/mcp/src/orchestrator.ts
index a0ce3f9..d7c88db 100644
--- a/mcp/src/orchestrator.ts
+++ b/mcp/src/orchestrator.ts
@@ -17,7 +17,11 @@ import {
   buildRevisionPrompt,
   translateFailureToFeedback,
   containsFrameworkTerms,
+  parseApproachPlan,
+  extractOneLineReason,
+  buildCircuitBreakPrompt,
 } from "./orchestrator-prompts.js";
+import type { ApproachEntry, FailedApproach } from "./orchestrator-prompts.js";
 import { StateManager, internalCheckpoint, extractTaskList } from "./state-manager.js";
 import {
   validatePhase1ReviewArtifact,
@@ -46,6 +50,8 @@ export interface NextTaskResult {
     reason: string;
     lastFeedback: string;
   };
+  /** When true, the prompt should be executed in a fresh subagent context (clean slate, no prior failure context) */
+  freshContext?: boolean;
   /** Informational message */
   message: string;
 }
@@ -55,6 +61,7 @@ export interface NextTaskResult {
 // ---------------------------------------------------------------------------
 
 const MAX_STEP_ITERATIONS = 3;
+const MAX_APPROACH_FAILURES = 2;
 
 const PHASE_SEQUENCE: Record<string, number[]> = {
   full: [1, 2, 3, 4, 5, 6, 7],
@@ -205,12 +212,25 @@ export function parseTribunalResult(toolResult: ToolResult): { passed: boolean;
 // Step State Helpers (raw JSON read/write for extra fields)
 // ---------------------------------------------------------------------------
 
+export interface ApproachState {
+  stepId: string;
+  approaches: ApproachEntry[];
+  currentIndex: number;
+  failedApproaches: FailedApproach[];
+}
+
 interface StepState {
   step: string | null;
   stepIteration: number;
   lastValidation: string | null;
+  approachState: ApproachState | null;
 }
 
+export type ApproachAction =
+  | { action: "CONTINUE"; approachState?: ApproachState; planFeedback?: string }
+  | { action: "CIRCUIT_BREAK"; prompt: string; approachState: ApproachState; failedApproach: string; nextApproach: string }
+  | { action: "ALL_EXHAUSTED" };
+
 async function readStepState(stateFilePath: string): Promise<StepState> {
   try {
     const raw = JSON.parse(await readFile(stateFilePath, "utf-8"));
@@ -218,9 +238,10 @@ async function readStepState(stateFilePath: string): Promise<StepState> {
       step: raw.step ?? null,
       stepIteration: raw.stepIteration ?? 0,
       lastValidation: raw.lastValidation ?? null,
+      approachState: raw.approachState ?? null,
     };
   } catch {
-    return { step: null, stepIteration: 0, lastValidation: null };
+    return { step: null, stepIteration: 0, lastValidation: null, approachState: null };
   }
 }
 
@@ -273,6 +294,108 @@ export function computeNextStep(currentStep: string, phases: number[]): string |
   return null; // all done
 }
 
+// ---------------------------------------------------------------------------
+// Circuit Breaker — approach failure handling
+// ---------------------------------------------------------------------------
+
+/** Extract the goal for a given step from plan.md */
+async function getStepGoal(step: string, outputDir: string): Promise<string> {
+  const planPath = join(outputDir, "plan.md");
+  const content = await readFileSafe(planPath);
+  if (!content) return `完成步骤 ${step} 的任务`;
+
+  // Try to find a task section matching the step number
+  const phase = parseInt(step.replace(/[a-z]/g, ""), 10);
+  // Look for "## Task N:" or similar patterns
+  const taskRegex = new RegExp(
+    `## Task\\s+${phase}[^\\n]*\\n([\\s\\S]*?)(?=\\n## |$)`,
+    "i",
+  );
+  const match = content.match(taskRegex);
+  if (match) {
+    // Extract the description line (first line after heading)
+    const descLine = match[1].split("\n").map((l) => l.trim()).filter((l) => l.length > 0)[0];
+    if (descLine) return descLine;
+  }
+
+  return `完成步骤 ${step} 的任务`;
... (truncated, 216 lines omitted)
```

## 检查清单

## 裁决检查清单（Phase 4: Code Review + Phase 1/2 回溯验证）

> 默认立场是 FAIL。PASS 必须逐条举证。

### A. 回溯验证（最高优先级）
- [ ] 逐条检查 designReview 中的每个 P0/P1 问题
- [ ] 在 design.md 或 diff 中找到对应修复证据
- [ ] 如果 designReview 中有 P0 未修复 → 直接 FAIL
- [ ] 逐条检查 planReview 中的问题，在 diff 中验证

### B. 代码审查
- [ ] 独立审查 diff，不要只依赖主 Agent 的 review 报告
- [ ] 检查设计文档中的每个需求是否在 diff 中有对应实现
- [ ] 检查安全问题（权限绕过、注入、数据泄露）
- [ ] 检查 API 一致性（前后端接口匹配）

### C. TDD Gate Verification (if tdd=true)
- [ ] Check state.json tddTaskStates: every non-exempt task should have status=GREEN_CONFIRMED
- [ ] If any task has status=RED_CONFIRMED or PENDING, TDD flow was not completed -> FAIL
- [ ] Cross-check: test files in diff should align with redTestFiles recorded in tddTaskStates

### D. 输出要求
- 回溯验证结果：TRACE: [Phase 1/2 问题描述] → FIXED / NOT_FIXED → [证据]
- 如果 FAIL，列出问题：ISSUE: [P0/P1] 问题描述 → 修复建议 → 涉及文件

