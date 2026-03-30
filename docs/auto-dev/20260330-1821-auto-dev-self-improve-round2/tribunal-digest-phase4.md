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
 mcp/dist/index.js                                  |      7 +
 mcp/dist/index.js.map                              |      2 +-
 mcp/dist/orchestrator.js                           |     46 +-
 mcp/dist/orchestrator.js.map                       |      2 +-
 mcp/dist/types.d.ts                                |      1 +
 mcp/dist/types.js                                  |      1 +
 mcp/dist/types.js.map                              |      2 +-
 mcp/node_modules/typescript/README.md              |     50 -
 mcp/node_modules/typescript/SECURITY.md            |     41 -
 mcp/node_modules/typescript/bin/tsc                |      2 -
 mcp/node_modules/typescript/bin/tsserver           |      2 -
 mcp/node_modules/typescript/lib/_tsc.js            | 133818 ------------
 mcp/node_modules/typescript/lib/_tsserver.js       |    659 -
 .../typescript/lib/_typingsInstaller.js            |    222 -
 .../lib/cs/diagnosticMessages.generated.json       |   2122 -
 .../lib/de/diagnosticMessages.generated.json       |   2122 -
 .../lib/es/diagnosticMessages.generated.json       |   2122 -
 .../lib/fr/diagnosticMessages.generated.json       |   2122 -
 .../lib/it/diagnosticMessages.generated.json       |   2122 -
 .../lib/ja/diagnosticMessages.generated.json       |   2122 -
 .../lib/ko/diagnosticMessages.generated.json       |   2122 -
 mcp/node_modules/typescript/lib/lib.d.ts           |     22 -
 .../typescript/lib/lib.decorators.d.ts             |    384 -
 .../typescript/lib/lib.decorators.legacy.d.ts      |     22 -
 .../typescript/lib/lib.dom.asynciterable.d.ts      |     41 -
 mcp/node_modules/typescript/lib/lib.dom.d.ts       |  31451 ---
 .../lib/pl/diagnosticMessages.generated.json       |   2122 -
 .../lib/pt-br/diagnosticMessages.generated.json    |   2122 -
 .../lib/ru/diagnosticMessages.generated.json       |   2122 -
 .../lib/tr/diagnosticMessages.generated.json       |   2122 -
 mcp/node_modules/typescript/lib/tsc.js             |      8 -
 mcp/node_modules/typescript/lib/tsserver.js        |      8 -
 mcp/node_modules/typescript/lib/tsserverlibrary.js |     21 -
 mcp/node_modules/typescript/lib/typesMap.json      |    497 -
 mcp/node_modules/typescript/lib/typescript.js      | 200276 ------------------
 .../typescript/lib/typingsInstaller.js             |      8 -
 mcp/node_modules/typescript/lib/watchGuard.js      |     53 -
 .../lib/zh-cn/diagnosticMessages.generated.json    |   2122 -
 .../lib/zh-tw/diagnosticMessages.generated.json    |   2122 -
 mcp/node_modules/typescript/package.json           |    120 -
 mcp/src/__tests__/orchestrator.test.ts             |    180 +
 mcp/src/index.ts                                   |      8 +
 mcp/src/orchestrator.ts                            |     45 +-
 mcp/src/types.ts                                   |      1 +
 44 files changed, 283 insertions(+), 395303 deletions(-)

Untracked new files:
 docs/auto-dev/20260330-1821-auto-dev-self-improve-round2/approach-plan.md (new file)
 docs/auto-dev/20260330-1821-auto-dev-self-improve-round2/design-review.md (new file)
 docs/auto-dev/20260330-1821-auto-dev-self-improve-round2/design.md (new file)
 docs/auto-dev/20260330-1821-auto-dev-self-improve-round2/plan-review.md (new file)
 docs/auto-dev/20260330-1821-auto-dev-self-improve-round2/plan.md (new file)
 docs/auto-dev/20260330-1821-auto-dev-self-improve-round2/progress-log.md (new file)
 docs/auto-dev/20260330-1821-auto-dev-self-improve-round2/state.json (new file)
 docs/auto-dev/auto-dev-self-improve-round2-design.md (new file)
 docs/auto-dev/tribunal-crash-observability (new file)
 docs/design-review-enhancement.md (new file)
 docs/docs/auto-dev/_global/lessons-global.json (new file)
 mcp/npm (new file)

```

## Phase 1 设计评审
```
# 设计审查报告（第二轮）

**文档**: `design.md` (Auto-Dev 自评改进方案 Round 2)
**审查人**: Architecture Reviewer
**日期**: 2026-03-30
**结论**: **PASS**

---

## 1. 第一轮问题修复验证

### P0-1: tribunal verdict 后 step 推进（R2-1）

**状态**: 已修复

设计第 4.1 节明确改为在 `auto_dev_tribunal_verdict` PASS 分支中执行 `sm.atomicUpdate({ step: null, stepIteration: 0, lastValidation: null, approachState: null })`，让 orchestrator 在下次 `auto_dev_next` 时走 `if (!stepState.step)` 分支（`orchestrator.ts:1024`）重新接管。

代码验证：
- `internalCheckpoint`（`state-manager.ts:627-674`）确认只更新 `phase`、`status`、`iteration`、`phaseTimings`、`tokenUsage`，不触碰 `step` 相关字段，与设计描述一致
- `orchestrator.ts:1024` 的 `if (!stepState.step)` 分支确实存在且功能正确
- 不再在 `index.ts` 中调用 `computeNextStep`，保持 step 管理的单一职责在 orchestrator

### P1-3: TDD 门禁全局 BLOCK（R2-2）

**状态**: 已修复

设计第 4.2 节改为硬性 BLOCK（`TDD_GATE_GLOBAL_INCOMPLETE`）：
1. 统计 plan.md 中非 exempt task 数量 N
2. N > 0 且 GREEN_CONFIRMED 不足时阻断
3. N === 0（全部 exempt）时正常通过

代码验证：
- `isTddExemptTask` 函数存在于 `phase-enforcer.ts:576`，签名为 `(outputDir: string, task: number): Promise<boolean>`，可复用
- AC-3 和 AC-3b 分别覆盖了阻断和全 exempt 放行场景

### P1-5: skipSteps 替代 shouldSkipStep（R2-4）

**状态**: 已修复

设计第 4.4 节明确使用 `skipSteps: string[]` 状态字段，在 `computeNextStep` 中增加第三个 optional 参数进行过滤。

代码验证：
- `shouldSkipStep` 在整个 `mcp/src/` 中不存在（grep 确认），设计不再引用不存在的函数
- `computeNextStep`（`orchestrator.ts:306`）当前签名为 `(currentStep: string, phases: number[]): string | null`，增加第三个 optional 参数技术可行
- 调用方在 `orchestrator.ts:1374`，需同步传入 `skipSteps` 参数

### P1-4: mode === "full" 前提条件（R2-4）

**状态**: 已修复

设计第 4.4 节明确写了 `mode === "full" && estimatedLines <= 50 && estimatedFiles <= 3`，仅 full 模式有意义。

### P1-1: 不在 index.ts 中调用 computeNextStep（R2-1）

**状态**: 已修复

设计第 4.1 节末尾明确声明"不修改 orchestrator.ts"和"本方案不需要在 index.ts 中调用它"。

---

## 2. 新方案技术可行性

### R2-1: step 清空方案 -- 无问题

`sm.atomicUpdate` 在 `index.ts` 中已有 20+ 处调用（grep 确认），接受任意 `Record<string, unknown>`，写入 `{ step: null }` 完全可行。orchestrator 的 `readStepState` 在 step 为 null 时走首次初始化逻辑，路径成熟。

### R2-2: TDD 全局 BLOCK -- P2 建议

**P2**: 设计提到"读取 plan.md，匹配 `## Task N` 提取 task 编号列表"，这是文本解析。建议在实现时复用已有的 `extractTaskList`（`state-manager.ts` 导出）而非自行正则匹配，减少解析逻辑重复。设计第 4.2 节未提及此函数，但实际可用。

### R2-3: Phase 5a 文件检查 -- P2 建议

**P2**: 设计使用 `fileExists(join(outputDir, "e2e-test-cases.md"))`，但 `fileExists` 未在现有代码中发现通用实现。建议使用已有的 `readFileSafe`（orchestrator.ts 中有使用）做空值检查代替，或在实现时确认引入方式。这是实现细节，不影响设计正确性。

### R2-4: computeNextStep skipSteps 过滤 -- 无问题

在 `computeNextStep` 的 for 循环中增加 `if (skipSteps?.includes(candidate)) continue` 即可，改动约 2 行，技术可行。调用方（`orchestrator.ts:1374`）需从 state 中读取 `skipSteps` 并传入。

---

## 3. 跨组件影响分析（规则 1: 调用方审查）

### R2-1 消费方追踪

`auto_dev_tribunal_verdict` PASS 后返回的 JSON 包含 `nextPhase` 和 `mandate` 字段，由调用方（agent）消费。step 清空不影响返回值结构，因为 `nextDirective` 仍由 `computeNextDirective` 或 `internalCheckpoint` 返回值计算。agent 下一步调用 `auto_dev_next`，此时 orchestrator 从 null step 重新计算——这正是设计意图。无消费方兼容性问题。

### R2-4 消费方追踪

`skipSteps` 字段由 `auto_dev_init` 写入 state，由 `computeNextStep` 消费。`computeNextStep` 的唯一调用方在 `orchestrator.ts:1374`，需在此处从 state 读取 `skipSteps` 并传入。设计已覆盖此改动点。

---

## 4. 路径激活风险评估（规则 2: 休眠路径检测）

| 路径 | 状态 | 风险 |
|------|------|------|
| `orchestrator.ts:1024` `if (!stepState.step)` 首次初始化分支 | **已验证**（每次任务首次 `auto_dev_next` 调用时执行） | 低 |
| `internalCheckpoint` PASS 分支 | **已验证**（生产在用） | 低 |
| `isTddExemptTask` 函数 | **已验证**（现有 TDD 门禁在用） | 低 |
| `computeNextStep` 跳过逻辑（新增 skipSteps） | **未验证**（新代码） | 低（逻辑简单，AC-7/AC-8 覆盖） |
... (truncated, 32 lines omitted)
```

## Phase 2 计划评审
```
# 计划审查报告：Auto-Dev 自评改进 Round 2

**审查日期**: 2026-03-30
**审查对象**: `plan.md`
**对照文档**: `design.md`

---

## A. 覆盖度审查：设计功能点 vs 任务映射

| 设计功能点 | 对应任务 | 覆盖状态 |
|-----------|---------|---------|
| R2-1: tribunal verdict step 推进修复 | Task 1 (实现) + Task 2 (测试) | 完整覆盖 |
| R2-2: TDD 门禁全局校验 | Task 3 (实现) + Task 4 (测试) | 完整覆盖 |
| R2-3: Phase 5a 文件存在性检查 | Task 5 (实现) + Task 6 (测试) | 部分覆盖（见 P1-1） |
| R2-4: skipSteps lightweight 模式 | Task 7 (实现) + Task 8 (测试) | 完整覆盖 |
| 全量回归验证 | Task 9 | 完整覆盖 |
| AC-1 ~ AC-9 | 全部有对应任务 | 完整覆盖 |

**覆盖度评分**: 9/10 — 有一个功能点的实现与设计存在偏差（见下方 P1-1）。

---

## B. INVEST 原则检查

| 原则 | 评价 |
|------|------|
| **I**ndependent | 通过。Task 1/2、3/4、5/6、7/8 各组独立，组间无循环依赖。 |
| **N**egotiable | 通过。各 Task 描述了目标和约束，未过度规定实现细节。 |
| **V**aluable | 通过。每个 Task 对应一个独立的用户价值（P0 bug 修复、门禁增强、质量检查、效率提升）。 |
| **E**stimable | 通过。行数估算具体（+5、+25、+12 等），且与设计文档一致。 |
| **S**mall | 通过。单个 Task 最大改动 25 行（实现），测试最大 30 行。 |
| **T**estable | 通过。每个实现 Task 都有配对的测试 Task，且明确映射到 AC。 |

---

## C. 依赖关系检查

计划中的依赖图：

```
Task 1 → Task 2 → Task 3 → Task 4 → Task 5/7 → Task 6/8 → Task 9
```

**无循环依赖**。依赖方向单一、合理。

但有一个可优化点：Task 3 (R2-2) 标注为"依赖: 无"但在依赖图中画为 Task 2 之后。这是交付顺序而非代码依赖，计划已正确说明"可与 Task 1 并行开发，但按优先级串行交付"。

---

## D. 任务描述质量

### 文件路径准确性

经源码验证：

| 计划描述 | 实际代码 | 状态 |
|---------|---------|------|
| `index.ts` 约 1906-1923 行（tribunal PASS 分支） | 实际在 1907-1923 行 | 准确 |
| `orchestrator.ts` 约 306 行（computeNextStep） | 实际在 306 行 | 准确 |
| `orchestrator.ts` 约 730-733 行（case "5a"） | 实际在 730-732 行 | 准确 |
| `fileExists` 在 `orchestrator.ts:148` | 实际在 148 行 | 准确 |
| `isTddExemptTask` 在 `phase-enforcer.ts:576` | 实际在 576 行 | 准确 |
| `behaviorUpdates` 在 `index.ts` 约 410-427 行 | 实际在 410-427 行 | 准确 |

**文件路径和行号准确性优秀**。

### 改动描述清晰度

- Task 1: 给出了完整的代码片段（`atomicUpdate` 调用），条件分支（仅 PASS + ckptResult.ok）清晰。
- Task 3: 给出了完整的逻辑步骤（6 步），包括正则、循环、统计。
- Task 7: 拆分为 4 个子步骤（7a/7b/7c/7d），每步都有修改位置和代码示例。

**改动描述质量优秀**。

---

## E. 测试任务完整性

| 实现 Task | 测试 Task | 测试场景覆盖 |
|----------|----------|-------------|
| Task 1 (R2-1) | Task 2 | PASS 后 step=null 验证、step=null 时 computeNextTask 正确推进 |
| Task 3 (R2-2) | Task 4 | 空 tddTaskStates BLOCK、全 exempt 通过、满额 GREEN_CONFIRMED 通过 |
| Task 5 (R2-3) | Task 6 | 文件不存在 -> false、文件存在 -> true |
| Task 7 (R2-4) | Task 8 | 跳过 1b、跳过 2b、不跳 4a、init 设置 skipSteps |

**测试覆盖充分**，每个 AC 都有对应测试用例。

---

## 审查发现

### P1-1: R2-3 计划与设计不一致 — 设计要求"自举场景条件判断"，计划改为"无条件文件检查"

**问题描述**：

设计文档 4.3 节明确指出 Phase 5a 改动是**条件验证**：

> "若项目是自举场景（`projectRoot` 包含 auto-dev 相关路径或 `topic` 包含自举关键词），要求 `e2e-test-cases.md` 存在"

... (truncated, 73 lines omitted)
```

## 关键代码变更
```diff
diff --git a/mcp/src/index.ts b/mcp/src/index.ts
index 9f67a75..50a372a 100644
--- a/mcp/src/index.ts
+++ b/mcp/src/index.ts
@@ -414,6 +414,9 @@ server.tool(
     behaviorUpdates["tdd"] = tdd !== false;  // TDD on by default, --no-tdd to disable
     if (brainstorm) behaviorUpdates["brainstorm"] = true;
     behaviorUpdates["costMode"] = costMode ?? "beast"; // beast=全部最强(默认), economy=按阶段选模型
+    if (mode === "full" && (estimatedLines ?? 999) <= 50 && (estimatedFiles ?? 999) <= 3) {
+      behaviorUpdates["skipSteps"] = ["1b", "2b"];
+    }
     if (ship === true) {
       behaviorUpdates["ship"] = true;
       behaviorUpdates["deployTarget"] = deployTarget;
@@ -1908,6 +1911,11 @@ server.tool(
       const ckptSummary = `[TRIBUNAL-FALLBACK] Fallback 裁决通过。${issues.length} 个建议项。`;
       const ckptResult = await internalCheckpoint(sm, state, phase, "PASS", ckptSummary);
 
+      // Clear step fields so orchestrator re-computes the next step on next auto_dev_next call
+      if (ckptResult.ok) {
+        await sm.atomicUpdate({ step: null, stepIteration: 0, lastValidation: null, approachState: null });
+      }
+
       const nextDirective = ckptResult.ok
         ? ckptResult.nextDirective
         : computeNextDirective(phase, "PASS", state);

diff --git a/mcp/src/orchestrator.ts b/mcp/src/orchestrator.ts
index 4b6978d..24e0c83 100644
--- a/mcp/src/orchestrator.ts
+++ b/mcp/src/orchestrator.ts
@@ -26,6 +26,7 @@ import { StateManager, extractTaskList } from "./state-manager.js";
 import {
   validatePhase1ReviewArtifact,
   validatePhase2ReviewArtifact,
+  isTddExemptTask,
 } from "./phase-enforcer.js";
 import { evaluateTribunal } from "./tribunal.js";
 import type { EvalTribunalResult } from "./tribunal.js";
@@ -303,12 +304,13 @@ export function firstStepForPhase(phase: number): string {
  * Compute the next step in sequence, skipping steps whose phase
  * is not in the mode's phase sequence.
  */
-export function computeNextStep(currentStep: string, phases: number[]): string | null {
+export function computeNextStep(currentStep: string, phases: number[], skipSteps?: string[]): string | null {
   const idx = STEP_ORDER.indexOf(currentStep);
   if (idx < 0) return null;
 
   for (let i = idx + 1; i < STEP_ORDER.length; i++) {
     const candidate = STEP_ORDER[i]!;
+    if (skipSteps?.includes(candidate)) continue;
     const candidatePhase = phaseForStep(candidate);
     if (phases.includes(candidatePhase)) {
       return candidate;
@@ -728,7 +730,10 @@ export async function validateStep(
     }
 
     case "5a": {
-      // Just check that test design output exists (pass through)
+      const hasTestCases = await fileExists(join(outputDir, "e2e-test-cases.md"));
+      if (!hasTestCases) {
+        return { passed: false, feedback: "e2e-test-cases.md 不存在。Phase 5a 要求输出测试用例设计文件。" };
+      }
       return { passed: true, feedback: "" };
     }
 
@@ -992,6 +997,7 @@ export async function computeNextTask(
   }
   const buildCmd = state.stack.buildCmd;
   const testCmd = state.stack.testCmd;
+  const skipSteps = state.skipSteps ?? [];
 
   // Ship extra variables for Phase 8 prompt rendering
   const shipExtraVars: Record<string, string> | undefined = state.ship === true
@@ -1022,7 +1028,9 @@ export async function computeNextTask(
 
   // 3. If no step: determine first phase, set step, return first task prompt
   if (!stepState.step) {
-    const firstPhase = phases[0]!;
+    // Use state.phase if already mid-flow (e.g. after tribunal verdict cleared step),
+    // otherwise fall back to the mode's first phase for initial startup.
+    const firstPhase = (state.phase && phases.includes(state.phase)) ? state.phase : phases[0]!;
     let firstStep = firstStepForPhase(firstPhase);
 
     // Skip Phase 1a if design doc already exists and is compliant
@@ -1371,7 +1379,36 @@ export async function computeNextTask(
     tribunalUpdates.tribunalSubmits = { ...(state.tribunalSubmits ?? {}), [phaseKey]: 0 };
   }
 
-  const nextStep = computeNextStep(currentStep, phases);
+  const nextStep = computeNextStep(currentStep, phases, skipSteps);
+
+  // TDD global gate: block Phase 3 → Phase 4 transition if not all tasks are GREEN_CONFIRMED
+  if (nextStep && state.tdd === true && phaseForStep(currentStep) === 3 && phaseForStep(nextStep) >= 4) {
+    const planContent = await readFileSafe(join(outputDir, "plan.md"));
+    if (planContent) {
+      const taskMatches = planContent.match(/^## Task\s+(\d+)/gm) ?? [];
+      const taskNums = taskMatches.map(m => parseInt(m.replace(/^## Task\s+/, ""), 10));
+      let nonExemptCount = 0;
+      let greenCount = 0;
+      for (const t of taskNums) {
+        const exempt = await isTddExemptTask(outputDir, t);
+        if (!exempt) {
+          nonExemptCount++;
+          if (state.tddTaskStates?.[String(t)]?.status === "GREEN_CONFIRMED") {
+            greenCount++;
+          }
+        }
+      }
+      if (nonExemptCount > 0 && greenCount < nonExemptCount) {
+        return {
+          done: false,
+          step: currentStep,
+          agent: null,
+          prompt: null,
+          message: `TDD_GATE_GLOBAL_INCOMPLETE: ${greenCount}/${nonExemptCount} non-exempt tasks are GREEN_CONFIRMED. All must pass before Phase 4.`,
+        };
+      }
+    }
+  }
 
   if (!nextStep) {
     // All steps done — single atomicUpdate

diff --git a/mcp/src/types.ts b/mcp/src/types.ts
index 8dd9d1c..cf3dfb7 100644
--- a/mcp/src/types.ts
+++ b/mcp/src/types.ts
@@ -114,6 +114,7 @@ export const StateJsonSchema = z.object({
   interactive: z.boolean().optional(),  // --interactive mode (default: false = fully automatic)
   dryRun: z.boolean().optional(),       // --dry-run mode (only Phase 1-2)
   skipE2e: z.boolean().optional(),      // --skip-e2e mode (skip Phase 5)
+  skipSteps: z.array(z.string()).optional(),  // lightweight mode: skip specific steps (e.g. ["1b", "2b"])
   tdd: z.boolean().optional(),          // --tdd mode (RED-GREEN-REFACTOR in Phase 3)
   tddTaskStates: z.record(z.string(), z.object({
     status: z.enum(["PENDING", "RED_CONFIRMED", "GREEN_CONFIRMED"]),

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

