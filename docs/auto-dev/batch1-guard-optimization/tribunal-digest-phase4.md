# Phase 4 独立裁决

你是独立裁决者。你的默认立场是 FAIL。
PASS 必须对每条检查项提供证据（文件名:行号），FAIL 只需说明理由。
PASS 的举证成本远大于 FAIL —— 如果你不确定，判 FAIL。

## 框架统计（可信数据）
```
 mcp/dist/index.js                                  |     62 +-
 mcp/dist/index.js.map                              |      2 +-
 mcp/dist/tribunal.js                               |     41 +-
 mcp/dist/tribunal.js.map                           |      2 +-
 mcp/dist/types.d.ts                                |      6 +
 mcp/dist/types.js                                  |      2 +-
 mcp/dist/types.js.map                              |      2 +-
 mcp/node_modules/.package-lock.json                |    800 +
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
 mcp/src/__tests__/lessons-manager.test.ts          |     24 +-
 mcp/src/__tests__/tribunal.test.ts                 |    140 +
 mcp/src/index.ts                                   |     39 +-
 mcp/src/tribunal-checklists.ts                     |      6 +
 mcp/src/tribunal-schema.ts                         |     15 +-
 mcp/src/tribunal.ts                                |     46 +-
 mcp/src/types.ts                                   |      7 +-
 48 files changed, 1139 insertions(+), 395346 deletions(-)

```

## Phase 1 设计评审
```
# 设计审查报告：批次 1 框架守卫优化

> 审查日期：2026-03-26
> 审查对象：`docs/auto-dev/batch1-guard-optimization/design.md`
> 审查阶段：Phase 1 架构评审

---

## 1. 目标对齐

- [x] **问题陈述清晰** — 四个问题（lessons 守卫暴露框架、状态不一致、tribunal 越权、tribunal 无校准）描述准确，有具体代码行号引用。
- [x] **方案解决的是根因而非症状** — Issue #9 直接删除强制守卫而非弱化；Issue #10 用结构化 schema + auto-override 双重保障而非仅靠 prompt。
- [x] **范围合理** — 四个改动互不依赖，预估 ~120 行，拆分为独立 task/commit，回滚策略清晰。
- [x] **有成功标准** — AC-1 到 AC-14 覆盖每个改动，验证方式明确（单元测试 + 代码审查）。

---

## 2. 技术可行性（grep 验证）

### 2.1 Issue #9 — 代码引用验证

- [x] `index.ts:424-436` 的 `LESSON_FEEDBACK_REQUIRED` 守卫 — **已验证存在**，代码与设计描述一致。
- [x] `index.ts:1024` 的反馈提示文本 — **已验证存在**，`extraContext += '> Phase 完成后请对以上经验逐条反馈...'`。
- [x] `index.ts:1168` 的工具描述 — **已验证存在**，当前文本为 `"Must be called before checkpoint PASS."`。
- [x] `index.ts:1447` 的 Phase 7 分支 — **已验证存在**，`if (phase === 7)` 分支在第 1447 行。
- [x] `sm.atomicUpdate({ injectedLessonIds: [] })` API — **已验证可用**，`index.ts:1184` 已有相同调用模式。

### 2.2 Issue #5 — 代码引用验证

- [x] `auto_dev_complete` handler 在 `index.ts:1207` — **已验证存在**。
- [x] `validateCompletion` 在 `phase-enforcer.ts:196` — **已验证存在**。
- [x] `validation.passedPhases` 返回 `number[]` — **已验证**，类型为 `CompletionValidation.passedPhases: number[]`。
- [x] 设计中提到在第 1230 行之后、1242 行之前插入 — **已验证**，1230 是 `validateCompletion` 返回检查，1242 是 verification gate 开始。实际插入点应为第 1241 行之前（1231-1240 是 `!validation.canComplete` 的早返回分支）。

### 2.3 Issue #10 — 代码引用验证

- [x] `TRIBUNAL_SCHEMA` 在 `tribunal-schema.ts:2` — **已验证存在**，当前无 `advisory` 字段，无 `acRef`。
- [x] `executeTribunal` 在 `tribunal.ts:507` — **已验证存在**。
- [x] `crossValidate` 在第 555 行之后 — **已验证**，第 553-565 行。
- [x] PASS checkpoint 在第 567-583 行 — **已验证**。
- [x] tribunal-checklists.ts 包含 `ANTI_LENIENCY` — **已验证存在**。

### 2.4 Tribunal 校准 — 代码引用验证

- [x] `prepareTribunalInput` 在 `tribunal.ts:144` — **已验证存在**。
- [x] `LessonsManager` 构造函数签名 `(outputDir, projectRoot?)` — **已验证**。
- [x] `LessonsManager.get(phase?, category?)` — **已验证存在**。
- [x] `LessonsManager.getGlobalLessons(limit)` — **已验证存在**。
- [x] tribunal.ts 当前未 import `LessonsManager` — **已验证**，需要新增 import。

---

## 3. 完整性

- [x] **边界情况已覆盖** — Issue #5 使用 `+1` 容差处理正常阶段推进；Issue #10 auto-override 只在无 P0/P1 时触发。
- [x] **错误处理已定义** — Tribunal 校准用 `try/catch` 包裹，lessons 不可用时跳过。
- [x] **回滚策略** — 四个改动独立 commit，单独 revert 不影响其他。

---

## 4. 跨组件影响分析

### 步骤 A — 变更清单

| # | 变更 | 类型 |
|---|------|------|
| 1 | 删除 `index.ts` checkpoint 中的 `LESSON_FEEDBACK_REQUIRED` 守卫 | 删除逻辑 |
| 2 | Phase 7 submit 增加 `injectedLessonIds` 清理 | 新增逻辑 |
| 3 | `lessons_feedback` 工具描述修改 | 文本修改 |
| 4 | 删除 preflight 反馈提示文本 | 删除文本 |
| 5 | `auto_dev_complete` 增加 state/log 一致性检测 | 新增逻辑 |
| 6 | `TRIBUNAL_SCHEMA` 增加 `advisory` + `acRef` | Schema 扩展 |
| 7 | `executeTribunal` 增加 FAIL auto-override | 新增逻辑 |
| 8 | tribunal checklist 增加范围约束 | 文本修改 |
| 9 | `prepareTribunalInput` 注入 tribunal lessons | 新增逻辑 |

### 步骤 B — 调用方追踪（grep 验证）

**变更 1（删除守卫）**：消费方是调用 `auto_dev_checkpoint` 的 agent。删除后 agent 的 PASS 请求不再被拒绝 — 正向变更，无兼容性问题。

**变更 5（state/log 一致性检测）**：消费方是调用 `auto_dev_complete` 的 agent。新增的 `STATE_LOG_INCONSISTENT` 错误码是新返回路径 — agent 收到后会被 `mandate` 阻塞，行为与现有 `INCOMPLETE` 错误一致，无兼容性问题。

**变更 6（Schema 扩展）**：消费方是 `executeTribunal` 中解析 tribunal 输出的代码。`issues.items.required` 新增 `acRef` — 这对 **tribunal agent 的输出** 有要求。如果 tribunal agent 未按新 schema 输出 `acRef`，JSON schema 校验可能失败。需确认 `runTribunalWithRetry` 中的 schema 校验行为（是 strict reject 还是 lenient parse）。

**变更 7（auto-override）**：消费方是 `executeTribunal` 的调用方（`index.ts` 中的 `auto_dev_submit`）。auto-override 后 verdict 变为 PASS，走的是已有的 PASS 路径（checkpoint 写入 + 返回 `TRIBUNAL_PASS`），无兼容性问题。

### 步骤 C — 影响表格

| 变更 | 直接影响文件 | 间接消费方 | 风险 |
|------|-------------|-----------|------|
| 删除守卫 | index.ts | agent (checkpoint 调用) | 低 — 放宽约束 |
| Schema acRef 必填 | tribunal-schema.ts | tribunal agent 输出、executeTribunal 解析 | **中** — 见 P1-1 |
| auto-override | tribunal.ts | auto_dev_submit 返回值消费 | 低 — 复用已有 PASS 路径 |
| lessons 注入 | tribunal.ts | prepareTribunalInput digest 内容 | 低 — 纯追加 |

### 步骤 D — 其他影响维度

- **测试影响**：现有 tribunal 测试的 mock verdict 数据需要加 `acRef` 字段，设计已提及（风险表中标注"概率高"）。
- **性能影响**：lessons 注入需要额外读取 lessons-learned.json + global lessons，但 tribunal 执行本身耗时远大于文件读取，可忽略。

... (truncated, 129 lines omitted)
```

## Phase 2 计划评审
```
# 计划审查报告: batch1-guard-optimization

> 审查日期: 2026-03-26
> 审查对象: `docs/auto-dev/batch1-guard-optimization/plan.md`
> 对照文档: `docs/auto-dev/batch1-guard-optimization/design.md`

---

## A. 覆盖度（设计 vs 计划逐项核对）

| 设计章节 | 设计功能点 | 对应 Task | 覆盖? |
|----------|-----------|-----------|-------|
| 4.1 改动 A | 删除 checkpoint 守卫 (index.ts:424-436) | Task 1 | OK |
| 4.1 改动 B | Phase 7 自动清理 injectedLessonIds | Task 4 | OK |
| 4.1 改动 C | 更新 lessons_feedback 工具描述 | Task 3 | OK |
| 4.1 改动 D | 删除 preflight 中的反馈提示文本 | Task 2 | OK |
| 4.1 测试更新 | lessons-manager.test.ts 修改 + 新增测试 | Task 5 | OK |
| 4.2 | auto_dev_complete 状态一致性检测 | Task 6 | OK |
| 4.2 测试 | 正向 + 负向测试 | Task 7 | OK |
| 4.3 改动 A | Schema 新增 advisory + acRef (optional) | Task 8 | OK |
| 4.3 改动 B | auto-override 逻辑 (含 acRef 降级) | Task 9 | OK |
| 4.3 改动 C | checklist 范围约束文本 | Task 10 | OK |
| 4.3 改动 D | prompt 范围限制说明 | Task 11 | OK |
| 4.3 测试 | tribunal schema + override + checklist 测试 | Task 14 | OK |
| 4.4 改动 0 | types.ts category 枚举新增 "tribunal" | Task 12 | OK |
| 4.4 主改动 | tribunal lessons 注入 | Task 13 | OK |
| 4.4 测试 | lessons 注入测试 | Task 14 | OK |

**结论: 设计文档中的所有功能点均有对应 task，覆盖完整。**

---

## B. 任务粒度（Independent, Small, Testable）

- Task 1-4 (Issue #9 的四个改动): 拆分合理，每个改动独立且小。
- Task 6 (Issue #5): 独立，约 15 行，可测试。
- Task 8-11 (Issue #10 的四个改动): 拆分合理。Task 9 依赖 Task 8，合理。
- Task 12-13 (Tribunal 校准): Task 13 依赖 Task 12，合理。
- Task 14 (统一测试 task): 依赖 Task 8-13 全部完成。
- Task 15 (全量验证): 正确放在最后。

**无粒度问题。**

---

## C. 依赖关系

依赖图:
```
Task 1 ──┐
Task 4 ──┤── Task 5
         │
Task 6 ──── Task 7
         │
Task 8 ──── Task 9 ──┐
Task 10 ─────────────┤
Task 11 ─────────────┤── Task 14
Task 12 ──── Task 13 ┘
         │
Task 1-14 ──── Task 15
```

- 所有依赖均显式标注。
- 无循环依赖。
- 依赖方向正确（schema 先于 override 逻辑，枚举先于 lessons 注入）。

**无依赖问题。**

---

## D. 任务描述质量

逐项检查每个 task 是否包含：文件路径、改动描述、完成标准。

| Task | 文件路径 | 改动描述 | 完成标准 | 评价 |
|------|---------|---------|---------|------|
| 1 | OK | OK | OK | - |
| 2 | OK | OK | OK | - |
| 3 | OK | OK | OK | - |
| 4 | OK | OK | OK | - |
| 5 | OK | OK | OK | - |
| 6 | OK | OK | OK | - |
| 7 | OK | OK | OK | - |
| 8 | OK | OK | OK | - |
| 9 | OK | OK | OK | 描述详细，包含 tribunalLog const->let 注意事项 |
| 10 | OK | OK | OK | - |
| 11 | OK | OK | OK | - |
| 12 | OK | OK | OK | - |
| 13 | OK | OK | OK | - |
| 14 | OK | OK | OK | - |
| 15 | OK（无修改） | OK | OK | - |

**描述质量良好，包含具体行号和代码位置。**

---

## E. 完整性

- [x] 包含测试任务（Task 5, 7, 14）
- [x] 包含全量验证（Task 15）
... (truncated, 27 lines omitted)
```

## 关键代码变更
```diff
diff --git a/mcp/src/index.ts b/mcp/src/index.ts
index 6c6fe96..5a7c2d7 100644
--- a/mcp/src/index.ts
+++ b/mcp/src/index.ts
@@ -421,20 +421,6 @@ server.tool(
     // or state.json, so failed checks don't pollute formal state.
     // ===================================================================
 
-    // Guard: lesson feedback must be submitted before PASS
-    if (status === "PASS") {
-      const pendingIds = state.injectedLessonIds ?? [];
-      if (pendingIds.length > 0) {
-        return textResult({
-          error: "LESSON_FEEDBACK_REQUIRED",
-          lessonFeedbackRequired: true,
-          injectedLessonIds: pendingIds,
-          feedbackInstruction: "必须先调用 auto_dev_lessons_feedback 对注入的经验逐条反馈，然后再 checkpoint PASS。",
-          note: "Checkpoint rejected BEFORE writing state. No state pollution.",
-        });
-      }
-    }
-
     // Phase 1 review artifact pre-validation: design-review.md must exist
     if (phase === 1 && status === "PASS") {
       let reviewContent: string | null = null;
@@ -1021,7 +1007,6 @@ server.tool(
           // 1-footer. Record injected lesson IDs and add feedback hint
           const injectedIds = [...localLessonIds, ...globalLessonIds];
           if (injectedIds.length > 0) {
-            extraContext += `> Phase 完成后请对以上经验逐条反馈（helpful / not_applicable / incorrect）\n\n`;
             await sm.atomicUpdate({ injectedLessonIds: injectedIds });
           }
 
@@ -1165,7 +1150,7 @@ server.tool(
 
 server.tool(
   "auto_dev_lessons_feedback",
-  "Submit feedback verdicts for lessons that were injected during preflight. Must be called before checkpoint PASS.",
+  "Optional: submit feedback verdicts for lessons that were injected during preflight. Improves future lesson quality but is not required for checkpoint PASS.",
   {
     projectRoot: z.string(),
     topic: z.string(),
@@ -1228,6 +1213,22 @@ server.tool(
       state.skipE2e === true,
     );
 
+    // State consistency check: state.phase must match max passed phase in progress-log
+    if (validation.passedPhases.length > 0) {
+      const maxPassedPhase = Math.max(...validation.passedPhases);
+      if (state.phase < maxPassedPhase) {
+        return textResult({
+          error: "STATE_PHASE_INCONSISTENCY",
+          canComplete: false,
+          statePhase: state.phase,
+          maxPassedPhase,
+          passedPhases: validation.passedPhases,
+          message: `state.phase (${state.phase}) 落后于 progress-log 中的最高已通过 Phase (${maxPassedPhase})。状态可能被篡改或回退。`,
+          mandate: "[BLOCKED] state.json 与 progress-log 不一致。禁止宣称完成。",
+        });
+      }
... (truncated, 19 lines omitted)
diff --git a/mcp/src/tribunal-checklists.ts b/mcp/src/tribunal-checklists.ts
index 72521c6..0ba3b63 100644
--- a/mcp/src/tribunal-checklists.ts
+++ b/mcp/src/tribunal-checklists.ts
@@ -9,6 +9,8 @@ const PHASE_4_CHECKLIST = `## 裁决检查清单（Phase 4: Code Review + Phase
 
 > ${ANTI_LENIENCY}
 
+> **审查范围约束**: 只审查本次 diff 涉及的文件和变更。不得对 diff 之外的代码、架构或历史遗留问题提出 P0/P1。P0/P1 必须关联具体的验收标准（acRef）。
+
 ### A. 回溯验证（最高优先级）
 - [ ] 逐条检查 designReview 中的每个 P0/P1 问题
 - [ ] 在 design.md 或 diff 中找到对应修复证据
@@ -35,6 +37,8 @@ const PHASE_5_CHECKLIST = `## 裁决检查清单（Phase 5: 测试裁决）
 
 > ${ANTI_LENIENCY}
 
+> **审查范围约束**: 只审查本次 diff 涉及的测试文件和测试结果。不得对 diff 之外的测试覆盖率、历史测试问题提出 P0/P1。P0/P1 必须关联具体的验收标准（acRef）。
+
 ### 1. 测试真实性
 - [ ] 对比框架的 testLog 和 Agent 的 agentResults，是否一致？
 - [ ] agentResults 中标 PASS 的测试，在 testLog 中是否真的通过？
@@ -58,6 +62,8 @@ const PHASE_6_CHECKLIST = `## 裁决检查清单（Phase 6: 验收裁决）
 
 > ${ANTI_LENIENCY}
 
+> **审查范围约束**: 只验证本次任务的验收标准（AC），不得引入任务范围外的要求。P0/P1 必须关联具体的验收标准（acRef）。
+
 ### 验收标准逐条验证
 - [ ] 从 design.md 中提取每条验收标准（AC）
 - [ ] 对每条标准，在 diff 中找到对应实现

diff --git a/mcp/src/tribunal-schema.ts b/mcp/src/tribunal-schema.ts
index 99660a4..998ad9d 100644
--- a/mcp/src/tribunal-schema.ts
+++ b/mcp/src/tribunal-schema.ts
@@ -15,7 +15,8 @@ export const TRIBUNAL_SCHEMA = {
           severity: { type: "string", enum: ["P0", "P1", "P2"] },
           description: { type: "string" },
           file: { type: "string" },
-          suggestion: { type: "string" }
+          suggestion: { type: "string" },
+          acRef: { type: "string", description: "关联的验收标准编号（如 AC-1），P0/P1 必须提供" }
         },
         required: ["severity", "description"]
       },
@@ -38,6 +39,18 @@ export const TRIBUNAL_SCHEMA = {
       type: "array",
       items: { type: "string" },
       description: "PASS 时必须提供的逐条证据（文件名:行号）。FAIL 时可为空。"
+    },
+    advisory: {
+      type: "array",
+      items: {
+        type: "object",
+        properties: {
+          description: { type: "string" },
+          suggestion: { type: "string" }
+        },
+        required: ["description"]
+      },
+      description: "建议性问题（非阻塞），不影响 PASS/FAIL 判定。"
     }
   },
   required: ["verdict", "issues"]

diff --git a/mcp/src/tribunal.ts b/mcp/src/tribunal.ts
index 531fb2c..f9a5321 100644
--- a/mcp/src/tribunal.ts
+++ b/mcp/src/tribunal.ts
@@ -27,6 +27,7 @@ import {
   countTestFiles,
   computeNextDirective,
 } from "./phase-enforcer.js";
+import { LessonsManager } from "./lessons-manager.js";
 import type { NextDirective } from "./phase-enforcer.js";
 import { getClaudePath } from "./agent-spawner.js";
 
@@ -194,6 +195,10 @@ export async function prepareTribunalInput(
   content += `你是独立裁决者。你的默认立场是 FAIL。\n`;
   content += `PASS 必须对每条检查项提供证据（文件名:行号），FAIL 只需说明理由。\n`;
   content += `PASS 的举证成本远大于 FAIL —— 如果你不确定，判 FAIL。\n\n`;
+  content += `## 范围限制\n\n`;
+  content += `- 你只能审查本次 diff 涉及的变更，不得对 diff 之外的代码提出阻塞性问题（P0/P1）。\n`;
+  content += `- P0/P1 问题必须提供 acRef（关联验收标准编号），否则将被降级为 advisory。\n`;
+  content += `- 不在本次任务范围内的改进建议请放入 advisory 字段。\n\n`;
 
   // 1. Framework statistics (hard data — git diff --stat)
   const diffBase = startCommit ?? "HEAD";
@@ -216,7 +221,22 @@ export async function prepareTribunalInput(
   const keyDiff = await getKeyDiff(projectRoot, startCommit, 300);
   content += `## 关键代码变更\n\`\`\`diff\n${keyDiff}\n\`\`\`\n\n`;
 
-  // 4. Checklist
+  // 4. Inject tribunal-category lessons (calibration)
+  try {
+    const lessonsManager = new LessonsManager(outputDir, projectRoot);
+    const tribunalLessons = (await lessonsManager.get(undefined, "tribunal"))
+      .filter((l) => !l.retired)
+      .slice(0, 5);
+    if (tribunalLessons.length > 0) {
+      content += `## 裁决校准经验（历史积累）\n\n`;
+      for (const l of tribunalLessons) {
+        content += `- [${l.severity ?? "minor"}] ${l.lesson}\n`;
+      }
+      content += `\n`;
+    }
+  } catch { /* lessons not available, skip */ }
+
+  // 5. Checklist
   content += `## 检查清单\n\n${getTribunalChecklist(phase)}\n`;
 
   await writeFile(digestFile, content, "utf-8");
@@ -550,6 +570,30 @@ export async function executeTribunal(
     });
   }
 
+  // ------- Auto-override: FAIL without P0/P1 -> PASS -------
+  if (verdict.verdict === "FAIL") {
+    // Downgrade P0/P1 issues without acRef to advisory
+    const advisory: Array<{ description: string; suggestion?: string }> = [];
+    const remaining = verdict.issues.filter((issue) => {
+      if ((issue.severity === "P0" || issue.severity === "P1") && !(issue as any).acRef) {
+        advisory.push({ description: issue.description, suggestion: issue.suggestion });
+        return false;
+      }
... (truncated, 19 lines omitted)
diff --git a/mcp/src/types.ts b/mcp/src/types.ts
index 5d4f3bb..c6299df 100644
--- a/mcp/src/types.ts
+++ b/mcp/src/types.ts
@@ -57,7 +57,7 @@ export type GitInfo = z.infer<typeof GitInfoSchema>;
 export const LessonEntrySchema = z.object({
   id: z.string().optional(),
   phase: z.number().int(),
-  category: z.enum(["pitfall", "highlight", "process", "technical", "pattern", "iteration-limit"]),
+  category: z.enum(["pitfall", "highlight", "process", "technical", "pattern", "iteration-limit", "tribunal"]),
   severity: z.enum(["critical", "important", "minor"]).optional(),
   lesson: z.string(),
   context: z.string().optional(),
@@ -284,6 +284,11 @@ export interface TribunalVerdict {
     description: string;
     file?: string;
     suggestion?: string;
+    acRef?: string;
+  }>;
+  advisory?: Array<{
+    description: string;
+    suggestion?: string;
   }>;
   traces?: Array<{
     source: string;

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

