# Phase 4 独立裁决

你是独立裁决者。你的默认立场是 FAIL。
PASS 必须对每条检查项提供证据（文件名:行号），FAIL 只需说明理由。
PASS 的举证成本远大于 FAIL —— 如果你不确定，判 FAIL。

## 范围限制

- 你只能审查本次 diff 涉及的变更，不得对 diff 之外的代码提出阻塞性问题（P0/P1）。
- P0/P1 问题必须提供 acRef（关联验收标准编号），否则将被降级为 advisory。
- 不在本次任务范围内的改进建议请放入 advisory 字段。

## 框架统计（可信数据）
```
 .claude-plugin/plugin.json                     |   2 +-
 mcp/dist/index.js                              |  84 ++++++-
 mcp/dist/index.js.map                          |   2 +-
 mcp/dist/orchestrator.js                       | 135 ++++++++--
 mcp/dist/orchestrator.js.map                   |   2 +-
 mcp/dist/tribunal.js                           |  54 +++-
 mcp/dist/tribunal.js.map                       |   2 +-
 mcp/dist/types.d.ts                            |   1 +
 mcp/dist/types.js                              |   1 +
 mcp/dist/types.js.map                          |   2 +-
 mcp/src/__tests__/orchestrator.test.ts         | 335 ++++++++++++++++++++++++-
 mcp/src/__tests__/ship-integration-e2e.test.ts |   4 +-
 mcp/src/__tests__/tribunal.test.ts             |  69 +++++
 mcp/src/index.ts                               |  97 ++++++-
 mcp/src/orchestrator.ts                        | 151 +++++++++--
 mcp/src/tribunal.ts                            |  54 +++-
 mcp/src/types.ts                               |   1 +
 skills/auto-dev/SKILL.md                       |   2 +-
 18 files changed, 917 insertions(+), 81 deletions(-)

```

## Phase 1 设计评审
```
# Design Review（第二轮）

> 日期：2026-04-02
> 审查对象：`docs/auto-dev/20260402-0902-orchestrator-ux-improvements/design.md`
> 审查人：Auto-Dev Reviewer（Phase 1 架构评审）

---

## P0 (阻塞性问题)

无。

---

## P1 (重要问题)

### P1-1：`buildTaskForStep` 签名问题 — 已修复

设计文档第 4.3 节明确说明：

> `buildTaskForStep` 当前签名为 `Promise<string>`，共有 7 个调用方直接使用其返回值作为字符串。**不修改 `buildTaskForStep` 的返回类型**。

并给出了具体实现约束：`parseTaskList` 在 `computeNextTask` 内 step "3" 的上层调用点独立调用，`tasks` 字段单独组装进 `NextTaskResult`。伪代码示例清晰展示了调用顺序（先 `buildTaskForStep`，再 `parseTaskList`，两者结果分别赋值）。AC-12 也将此作为可验证的验收标准。

代码验证：`buildTaskForStep` 当前签名（第 1015 行）为 `Promise<string>`，8 个调用点（第 679、1172、1200、1220、1268、1383、1441、1554 行）均直接使用返回字符串，设计保持签名不变的承诺是可实现的。

**结论：P1-1 已修复。**

---

### P1-2：`auto_dev_reset` 重置字段 — 已修复

设计文档第 4.1 节第 5 步明确补充：

**`parseInt` 字符串 key 处理**：`tribunalSubmits` 和 `phaseEscalateCount` 均使用 `parseInt(k) >= targetPhase` 进行数值比较，并给出了完整代码片段：

```typescript
const filteredSubmits = Object.fromEntries(
  Object.entries(submits).filter(([k]) => parseInt(k) < targetPhase)
);
const filteredEscalateCount = Object.fromEntries(
  Object.entries(phaseEscalateCount).filter(([k]) => parseInt(k) < targetPhase)
);
```

**`phaseEscalateCount` 清除逻辑**：设计文档明确说明"若不清除，回退后可能因历史 escalate 计数（`escCount >= 2`）导致立即 BLOCKED，因此**必须清除 `>= targetPhase` 的条目**"，并配套 AC-13 进行验证。

代码验证：`phaseEscalateCount` 当前在 `StateJsonSchema`（第 207 行）和 orchestrator（第 657、676 行）中均以字符串 key 存储（如 `phaseKey = String(phaseForStep(currentStep))`），`parseInt` 处理是必要的。

**结论：P1-2 已修复。**

---

### P1-3：`handleValidationFailure` 5 条 return 路径 — 已修复

设计文档第 4.2 节提供了完整的 5 条路径覆盖表格，并对每条路径的处理方式有明确说明：

| return 路径 | 是否填充 `lastFailureDetail` |
|------------|---------------------------|
| Tribunal FAIL under limit（约第 1383 行） | 是，填充 `validation.feedback` |
| `regressToPhase` 路径（`handlePhaseRegress`） | 是，且在 `atomicUpdate` 时补充该字段 |
| `ALL_APPROACHES_EXHAUSTED`（`handleCircuitBreaker` 内） | 是，`status: "BLOCKED"` 时仍填充 |
| `CIRCUIT_BREAK` 路径 | 是，切换方案时保留失败原因 |
| Iteration limit exceeded | 不另填（`escalation.lastFeedback` 已携带，语义等价） |

设计文档还明确指出："`regressToPhase` 和 `ALL_APPROACHES_EXHAUSTED` 两条路径在原代码中未持久化 `lastFailureDetail`，本次需要在各路径的 `atomicUpdate()` 调用处补充该字段。"配套 AC-14、AC-15 分别验证这两条路径。

代码验证：
- `handlePhaseRegress`（第 1258-1266 行）当前 `atomicUpdate` 中无 `lastFailureDetail`，需在实现时补充。
- `handleCircuitBreaker` 中 `ALL_EXHAUSTED` 分支（第 1316-1318 行）当前 `atomicUpdate` 中无 `lastFailureDetail`，需在实现时补充。

设计文档已正确识别这两个缺失位置，并提供了明确修复指令。

**结论：P1-3 已修复。**

---

## P2 (优化建议)

### P2-1：`step = String(targetPhase)` 的潜在歧义

设计文档第 4.1 节第 4 步中：`step = String(targetPhase)`（注释：回到该 phase 的第一个 step）。

但实际上 `firstStepForPhase(targetPhase)` 才是正确调用（已在 `handlePhaseRegress` 第 1257 行使用）。例如 Phase 1 的第一个 step 是 `"1a"` 而非 `"1"`，若直接 `String(targetPhase)` 会得到错误的 step 字符串。

AC-1 的验证条件 `step="3"` 恰好对应 `firstStepForPhase(3) === "3"`，掩盖了其他 phase 的潜在问题。建议实现时改为 `step = firstStepForPhase(targetPhase)`，与 `handlePhaseRegress` 保持一致。

### P2-2：`getKeyDiff` budget 升级的消费方确认

设计文档第 4.4 节提出 HIGH 时将 diff budget 从 300 提升到 500 行。`getKeyDiff` 当前在 `prepareTribunalInput` 第 225 行硬编码 `300`。两个外部调用点（第 784、900 行）传入 `startCommit` 而非 budget，budget 的动态化属于 `prepareTribunalInput` 内部修改，无需变更外部调用方，设计意图是正确的，仅建议实现时显式确认此点以免误改外部调用。

---

## 跨组件影响分析

### 变更清单

| 文件 | 变更类型 | 关键符号 |
|------|---------|---------|
| `mcp/src/index.ts` | 新增 handler | `auto_dev_reset` 工具注册（约 50 行） |
... (truncated, 31 lines omitted)
```

## Phase 2 计划评审
```
# Plan Review（第二轮）

> 审查日期：2026-04-02
> 计划文件：`plan.md`（修订版）
> 设计文件：`design.md`
> 审查人：Phase 2 计划审查专家
> 上轮结论：NEEDS_REVISION（P0×2, P1×3）

---

## P0 (阻塞性问题)

无。

**P0-1 已修复**：Task 4 第 48-51 行明确列出全部 3 个 `buildTaskForStep("3", ...)` 调用点（`resolveInitialStep` 约 line 1220、`advanceToNextStep` 约 line 1554、`handleTribunalEscalation` 约 line 679），每处均有独立的 plan.md 读取和 `tasks` 注入说明。

**P0-2 已修复**：Task 4 完成标准第 2 条明确写出"tasks 字段在 step '3' 的全部 3 个 return 路径中均出现（`resolveInitialStep`、`advanceToNextStep`、`handleTribunalEscalation`），非 step '3' 的路径不携带 `tasks`"。

---

## P1 (重要问题)

无。

**P1-1 已修复**：Task 6 完成标准明确要求 `step` 字段使用 `firstStepForPhase(targetPhase)` 而非 `String(targetPhase)`，并补充了 `targetPhase=1` 时 `step="1a"`、`targetPhase=2` 时 `step="2a"` 的具体断言，以验证该函数被正确使用而非简单字符串转换。

**P1-2 已修复**：Task 3 描述部分第 37 行明确声明 `handleTribunalEscalation` 路径属于 escalation 路径，其失败上下文通过 `lastFeedback` 传递，不填充 `lastFailureDetail`，并注明"这是有意为之的设计决策"。完成标准亦与该决策保持一致（括号内明确说明该路径不单独填充及原因）。

**P1-3 已修复**：Task 4 描述第 52 行明确写出"三处均使用 `readFileSafe`（而非 `readFile`）以与 `buildTaskForStep` 内部实现保持一致，避免 plan.md 不存在时抛出异常"，完成标准第 5 条同样明确要求"上层读取 plan.md 使用 `readFileSafe`"。

---

## P2 (优化建议)

### P2-1：双次 IO 读取已知权衡在完成标准中仅披露于描述，测试未覆盖

Task 4 第 53 行描述中承认 `parseTaskList` 上层读取与 `buildTaskForStep` 内部 `extractTaskDetails` 存在双次 IO 读取，并指出"已在设计文档 4.3 节承认"。此为 P2 级优化建议，若后续性能敏感可将 plan.md 内容作为参数传入 `buildTaskForStep`，但当前实现层面已充分披露，无需修改。

### P2-2：Task 6 完成标准第 8 条提醒 import 补充（保留自上轮，已在计划中标注）

Task 6 完成标准第 8 条已明确注明"确认 `firstStepForPhase` 已从 `./orchestrator.js` 导入（`index.ts` 当前仅导入 `computeNextTask`，需补充 import）"。实现时需确保该条目被执行，否则 TypeScript 编译会失败（编译检查已在完成标准兜底）。

---

## AC 覆盖度（与上轮一致，P0/P1 修复后无变化）

| AC | 测试任务 | 覆盖状态 |
|----|---------|---------|
| AC-1 | Task 8 | 覆盖（含 phase=1 step="1a"、phase=2 step="2a" 断言，已在 Task 8 完成标准中明确）|
| AC-2 | Task 8 | 覆盖 |
| AC-3 | Task 8 | 覆盖 |
| AC-4 | Task 9 | 覆盖 |
| AC-5 | Task 7 | 覆盖（3 个调用点均注入 tasks，P0-1 已修复）|
| AC-6 | Task 7 | 覆盖 |
| AC-7 | Task 7 | 覆盖 |
| AC-8 | Task 7 | 覆盖 |
| AC-9 | Task 7 | 覆盖 |
| AC-10 | 无任务 | 手动集成验证，不在自动测试范围（同上轮 P2-3）|
| AC-11 | Task 9 | 覆盖 |
| AC-12 | Task 9 | 覆盖（TypeScript 类型检查）|
| AC-13 | Task 8 | 覆盖 |
| AC-14 | Task 9 | 覆盖 |
| AC-15 | Task 9 | 覆盖 |

---

## 结论

**PASS**

上轮 P0×2、P1×3 问题已在本次修订中逐条明确修复，无新增 P0/P1 问题。计划可进入实现阶段。

**问题**：Task 4 描述写道 "step '3' 分支（约第 679 行的 `buildTaskForStep("3", ...)` 调用所在函数）的上层调用点"，但实际代码中 line 679 位于 `handleTribunalEscalation` 函数内（tribunal 3 次未通过回退到 Phase 3 的路径），**不是** step "3" 的正常分发路径。

step "3" 的 `buildTaskForStep` 调用实际分散在以下 3 处：

| 调用位置 | 函数 | 触发场景 |
|---------|------|---------|
| line 679 | `handleTribunalEscalation` | tribunal 3 次失败 → 强制回退 Phase 3 |
| line ~1220 | `resolveInitialStep` | 首次启动 / 首次进入 step "3" |
| line ~1554 | `advanceToNextStep` | 上一个 step 验证通过后推进到 step "3" |

如果实现者只修改 line 679 附近，`tasks` 字段将只出现在 tribunal 强制回退场景，而正常 step "3" 派发（`resolveInitialStep` 和 `advanceToNextStep`）完全没有 `tasks`，AC-5/6/7 的正常路径无法通过。

**修复建议**：
Task 4 描述必须明确列出 **所有 3 个** `buildTaskForStep` 调用点，并说明在每个调用点的上层 return 处都需要注入 `tasks`。建议改写为：
> "在 `resolveInitialStep`（line ~1220）、`advanceToNextStep` 的 step "3" 分支（line ~1554）、`handleTribunalEscalation` 的回退路径（line ~679）三处的 return 对象中分别注入 `tasks`。"

---

### P0-2：Task 4 未覆盖 `handleTribunalEscalation` 注入 `tasks` 后的消费者风险（路径激活风险）

**问题**：`handleTribunalEscalation` 在 line 679 返回 step "3" 时，此路径历史上可能从未携带 `tasks` 字段。若只在 `resolveInitialStep` 和 `advanceToNextStep` 加了 `tasks`，而遗漏 `handleTribunalEscalation`，则 orchestrator 在 tribunal 强制回退后会以"无 `tasks`"进入 step "3"，退化为单 agent 模式（设计上说"parseTaskList 失败返回空数组"是退化兜底）。

但问题在于 `handleTribunalEscalation` 读 plan.md 时，该文件**已存在**（已通过 Task 2 生成），所以 `parseTaskList` **应当**成功。若此路径漏注入 `tasks`，AC-5 的测试可能因覆盖路径不完整而误报通过，但实际生产中 tribunal 回退后并行化失效，与设计目标不符。

**修复建议**：在 Task 4 的完成标准中明确加入："`handleTribunalEscalation` 回退到 step "3" 的 return 对象中也必须注入 `tasks`。"

---

... (truncated, 80 lines omitted)
```

## 关键代码变更
```diff
diff --git a/mcp/src/__tests__/orchestrator.test.ts b/mcp/src/__tests__/orchestrator.test.ts
index 94a0c87..31ff7cf 100644
--- a/mcp/src/__tests__/orchestrator.test.ts
+++ b/mcp/src/__tests__/orchestrator.test.ts
@@ -85,7 +85,7 @@ vi.mock("node:fs/promises", async (importOriginal) => {
 });
 
 // Now import modules under test (after mocks)
-import { computeNextTask, computeNextStep, handleApproachFailure, buildTaskForStep } from "../orchestrator.js";
+import { computeNextTask, computeNextStep, handleApproachFailure, buildTaskForStep, parseTaskList, firstStepForPhase } from "../orchestrator.js";
 import type { NextTaskResult, ApproachState } from "../orchestrator.js";
 
 // ---------------------------------------------------------------------------
@@ -149,7 +149,7 @@ describe("computeNextTask", () => {
 
       expect(result.done).toBe(false);
       expect(result.step).toBe("1a");
-      expect(result.agent).toBe("auto-dev-architect");
+      expect(result.agent).toBe("auto-dev:auto-dev-architect");
       expect(result.prompt).toBeDefined();
       expect(result.prompt).not.toBeNull();
     });
@@ -222,7 +222,7 @@ describe("computeNextTask", () => {
 
       expect(result.done).toBe(false);
       expect(result.step).toBe("3");
-      expect(result.agent).toBe("auto-dev-developer");
+      expect(result.agent).toBe("auto-dev:auto-dev-developer");
       expect(result.prompt).toContain("请实现以下功能");
       expect(result.prompt).toContain("test-topic");
     });
@@ -251,7 +251,7 @@ describe("computeNextTask", () => {
 
       expect(result.done).toBe(false);
       expect(result.step).toBe("1b");
-      expect(result.agent).toBe("auto-dev-reviewer");
+      expect(result.agent).toBe("auto-dev:auto-dev-reviewer");
       expect(result.prompt).toBeDefined();
       expect(result.message).toContain("1a");
       expect(result.message).toContain("passed");
@@ -359,7 +359,7 @@ describe("computeNextTask", () => {
       const result = await computeNextTask("/tmp/test-project", "test-topic");
... (truncated, 351 lines omitted)
diff --git a/mcp/src/__tests__/ship-integration-e2e.test.ts b/mcp/src/__tests__/ship-integration-e2e.test.ts
index 20537ac..bcf423e 100644
--- a/mcp/src/__tests__/ship-integration-e2e.test.ts
+++ b/mcp/src/__tests__/ship-integration-e2e.test.ts
@@ -158,7 +158,7 @@ describe("T-INT-02: Complete Phase 8 progression path", () => {
 
     expect(result.done).toBe(false);
     expect(result.step).toBe("8a");
-    expect(result.agent).toBe("auto-dev-developer");
+    expect(result.agent).toBe("auto-dev:auto-dev-developer");
   });
 
   it("Step 2: 8a passes (no unpushed) -> advances to 8b", async () => {
@@ -309,7 +309,7 @@ describe("T-INT-03: Phase 8d CODE_BUG -> regress to Phase 3", () => {
 
     expect(result.done).toBe(false);
     expect(result.step).toBe("3");
-    expect(result.agent).toBe("auto-dev-developer");
+    expect(result.agent).toBe("auto-dev:auto-dev-developer");
     expect(result.message).toContain("CODE_BUG");
     expect(result.message).toContain("round 1");
 

diff --git a/mcp/src/__tests__/tribunal.test.ts b/mcp/src/__tests__/tribunal.test.ts
index 96d2c65..86d4e36 100644
--- a/mcp/src/__tests__/tribunal.test.ts
+++ b/mcp/src/__tests__/tribunal.test.ts
@@ -44,6 +44,7 @@ import {
   runTribunalWithRetry,
   crossValidate,
   classifyTribunalError,
+  parseDiffSummary,
 } from "../tribunal.js";
 import type { TribunalCrashInfo } from "../tribunal.js";
 import { TRIBUNAL_PHASES } from "../tribunal-schema.js";
@@ -1594,3 +1595,71 @@ describe("IMP-002: tryRunViaHub catch logs warning", () => {
     warnSpy.mockRestore();
   });
 });
+
+// ===========================================================================
+// Task 7 — parseDiffSummary unit tests (AC-8, AC-9)
+// ===========================================================================
+
+describe("parseDiffSummary", () => {
+  it("AC-8: 700 insertions + 100 deletions = HIGH (totalLines=800)", () => {
+    const result = parseDiffSummary("10 files changed, 700 insertions(+), 100 deletions(-)");
+    expect(result.files).toBe(10);
+    expect(result.insertions).toBe(700);
+    expect(result.deletions).toBe(100);
+    // Verify that the total (800) exceeds the HIGH threshold (500)
+    expect(result.insertions + result.deletions).toBeGreaterThan(500);
+  });
+
+  it("AC-9: 30 insertions + 20 deletions = LOW (totalLines=50)", () => {
+    const result = parseDiffSummary("3 files changed, 30 insertions(+), 20 deletions(-)");
+    expect(result.insertions).toBe(30);
+    expect(result.deletions).toBe(20);
+    expect(result.insertions + result.deletions).toBeLessThanOrEqual(100);
+  });
+
+  it("only insertions, no deletions — parses correctly", () => {
+    const result = parseDiffSummary("2 files changed, 50 insertions(+)");
+    expect(result.insertions).toBe(50);
+    expect(result.deletions).toBe(0);
... (truncated, 43 lines omitted)
diff --git a/mcp/src/index.ts b/mcp/src/index.ts
index 9a87448..023b3cd 100644
--- a/mcp/src/index.ts
+++ b/mcp/src/index.ts
@@ -25,7 +25,7 @@ import { executeTribunal, crossValidate, buildTribunalLog } from "./tribunal.js"
 import type { ToolResult } from "./tribunal.js";
 import { generateRetrospectiveData } from "./retrospective-data.js";
 import { getClaudePath } from "./tribunal.js";
-import { computeNextTask } from "./orchestrator.js";
+import { computeNextTask, firstStepForPhase, PHASE_SEQUENCE } from "./orchestrator.js";
 import { runStructuralAssertions } from "./ac-runner.js";
 import { discoverAcBindings, validateAcBindingCoverage, runAcBoundTests } from "./ac-test-binding.js";
 import { AcceptanceCriteriaSchema } from "./ac-schema.js";
@@ -1271,21 +1271,21 @@ server.tool(
       const isBeast = state.costMode === "beast";
 
       const phasePromptMap: Record<number, { promptFile: string; agent: string; model: string }> = {
-        0: { promptFile: "phase0-brainstorm", agent: "auto-dev-architect", model: isBeast ? "opus" : "sonnet" },
-        1: { promptFile: "phase1-architect", agent: "auto-dev-architect", model: "opus" },       // 设计始终用最强
-        2: { promptFile: "phase2-planner", agent: "auto-dev-architect", model: isBeast ? "opus" : "sonnet" },
-        3: { promptFile: "phase3-developer", agent: "auto-dev-developer", model: "opus" },       // 实现始终用最强
-        4: { promptFile: "phase4-full-reviewer", agent: "auto-dev-reviewer", model: "opus" },    // 代码审查始终用最强
-        5: { promptFile: "phase5-test-architect", agent: "auto-dev-test-architect", model: isBeast ? "opus" : "sonnet" },
-        6: { promptFile: "phase6-acceptance", agent: "auto-dev-acceptance-validator", model: isBeast ? "opus" : "sonnet" },
-        7: { promptFile: "phase7-retrospective", agent: "auto-dev-reviewer", model: isBeast ? "opus" : "sonnet" },
+        0: { promptFile: "phase0-brainstorm", agent: "auto-dev:auto-dev-architect", model: isBeast ? "opus" : "sonnet" },
+        1: { promptFile: "phase1-architect", agent: "auto-dev:auto-dev-architect", model: "opus" },       // 设计始终用最强
+        2: { promptFile: "phase2-planner", agent: "auto-dev:auto-dev-architect", model: isBeast ? "opus" : "sonnet" },
+        3: { promptFile: "phase3-developer", agent: "auto-dev:auto-dev-developer", model: "opus" },       // 实现始终用最强
+        4: { promptFile: "phase4-full-reviewer", agent: "auto-dev:auto-dev-reviewer", model: "opus" },    // 代码审查始终用最强
+        5: { promptFile: "phase5-test-architect", agent: "auto-dev:auto-dev-test-architect", model: isBeast ? "opus" : "sonnet" },
+        6: { promptFile: "phase6-acceptance", agent: "auto-dev:auto-dev-acceptance-validator", model: isBeast ? "opus" : "sonnet" },
+        7: { promptFile: "phase7-retrospective", agent: "auto-dev:auto-dev-reviewer", model: isBeast ? "opus" : "sonnet" },
       };
 
       // Phase 1: if design.md already exists, skip architect → go directly to reviewer
       if (phase === 1) {
         try {
           await stat(join(outputDir, "design.md"));
-          phasePromptMap[1] = { promptFile: "phase1-design-reviewer", agent: "auto-dev-reviewer", model: "opus" };
+          phasePromptMap[1] = { promptFile: "phase1-design-reviewer", agent: "auto-dev:auto-dev-reviewer", model: "opus" };
           result.designExists = true;
... (truncated, 87 lines omitted)
diff --git a/mcp/src/orchestrator.ts b/mcp/src/orchestrator.ts
index ebbd89e..ebfb293 100644
--- a/mcp/src/orchestrator.ts
+++ b/mcp/src/orchestrator.ts
@@ -70,6 +70,14 @@ export function checkDesignDocCompliance(content: string): { compliant: boolean;
 // Types
 // ---------------------------------------------------------------------------
 
+export interface TaskInfo {
+  taskNumber: number;
+  title: string;
+  description: string;
+  files: string[];
+  dependencies: number[];
+}
+
 export interface NextTaskResult {
   /** Whether all phases are done */
   done: boolean;
@@ -93,6 +101,10 @@ export interface NextTaskResult {
   mandate?: string;
   /** Informational message */
   message: string;
+  /** Last failure detail (feedback from validation) — populated on failure paths */
+  lastFailureDetail?: string;
+  /** Parsed task list from plan.md — only populated for step "3" */
+  tasks?: TaskInfo[];
 }
 
 // ---------------------------------------------------------------------------
@@ -102,30 +114,30 @@ export interface NextTaskResult {
 const MAX_STEP_ITERATIONS = 3;
 const MAX_APPROACH_FAILURES = 2;
 
-const PHASE_SEQUENCE: Record<string, number[]> = {
+export const PHASE_SEQUENCE: Record<string, number[]> = {
   full: [1, 2, 3, 4, 5, 6, 7],
   quick: [3, 4, 5, 7],
   turbo: [3],
 };
 
 const STEP_AGENTS: Record<string, string> = {
... (truncated, 269 lines omitted)
diff --git a/mcp/src/tribunal.ts b/mcp/src/tribunal.ts
index 1642d6d..4bfe80d 100644
--- a/mcp/src/tribunal.ts
+++ b/mcp/src/tribunal.ts
@@ -135,6 +135,33 @@ export async function getKeyDiff(
   return truncated.join("\n");
 }
 
+// ---------------------------------------------------------------------------
+// parseDiffSummary — parse git diff --stat summary line
+// ---------------------------------------------------------------------------
+
+/**
+ * Parse a git diff --stat summary line like:
+ *   "5 files changed, 120 insertions(+), 30 deletions(-)"
+ * Handles edge cases: only insertions, only deletions, unrecognized format.
+ * Returns { files: 0, insertions: 0, deletions: 0 } on any parse failure.
+ */
+export function parseDiffSummary(summaryLine: string): { files: number; insertions: number; deletions: number } {
+  try {
+    const filesMatch = summaryLine.match(/(\d+)\s+files?\s+changed/);
+    const insertMatch = summaryLine.match(/(\d+)\s+insertions?\(\+\)/);
+    const deleteMatch = summaryLine.match(/(\d+)\s+deletions?\(-\)/);
+
+    const files = filesMatch ? parseInt(filesMatch[1], 10) : 0;
+    const insertions = insertMatch ? parseInt(insertMatch[1], 10) : 0;
+    const deletions = deleteMatch ? parseInt(deleteMatch[1], 10) : 0;
+
+    if (!filesMatch) return { files: 0, insertions: 0, deletions: 0 };
+    return { files, insertions, deletions };
+  } catch {
+    return { files: 0, insertions: 0, deletions: 0 };
+  }
+}
+
 // ---------------------------------------------------------------------------
 // Tribunal Input Preparation
 // ---------------------------------------------------------------------------
@@ -214,6 +241,31 @@ export async function prepareTribunalInput(
     : diffStat;
   content += `## 框架统计（可信数据）\n\`\`\`\n${truncatedDiffStat}\n\`\`\`\n\n`;
 
... (truncated, 38 lines omitted)
diff --git a/mcp/src/types.ts b/mcp/src/types.ts
index 4b4c1ce..6cba3b7 100644
--- a/mcp/src/types.ts
+++ b/mcp/src/types.ts
@@ -201,6 +201,7 @@ export const StateJsonSchema = z.object({
   step: z.string().nullable().optional(),
   stepIteration: z.number().int().optional(),
   lastValidation: z.string().nullable().optional(),
+  lastFailureDetail: z.string().nullable().optional(),
   approachState: z.any().nullable().optional(), // Complex nested object, validated at orchestrator level
 
   // Phase-level escalation counter (Issue #2: ESCALATE auto-regress)

```

## 检查清单

## 裁决检查清单（Phase 4: Code Review + Phase 1/2 回溯验证）

> 默认立场是 FAIL。PASS 必须逐条举证。

> **审查范围约束**: 只审查本次 diff 涉及的文件和变更。不得对 diff 之外的代码、架构或历史遗留问题提出 P0/P1。P0/P1 必须关联具体的验收标准（acRef）。

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

