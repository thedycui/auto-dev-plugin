# 批次 1：框架守卫优化 — 统一设计文档

> 2026-03-27 | 涵盖 Issue #9, #5, #10 + 文章改进（tribunal lessons 注入）

---

## 1. 背景与目标

本批次改动聚焦于 **框架对 agent 的约束方式优化**，核心原则：
- **隐形框架**：agent 不应感知框架控制机制的存在
- **审查有界**：tribunal 只能基于 AC/task 判定，不能自创需求
- **状态可信**：框架应能检测并报告状态不一致

四个改动互不依赖，可以分 task 并行实现。

---

## 2. 改动项详细设计

### 2.1 Issue #9：删除 LESSON_FEEDBACK_REQUIRED 守卫

**目标：** checkpoint PASS 不再被 lessons 反馈阻塞。

**改动 A：删除 checkpoint 守卫（index.ts:424-436）**

删除以下代码块：
```typescript
// Guard: lesson feedback must be submitted before PASS
if (status === "PASS") {
  const pendingIds = state.injectedLessonIds ?? [];
  if (pendingIds.length > 0) {
    return textResult({
      error: "LESSON_FEEDBACK_REQUIRED",
      ...
    });
  }
}
```

**改动 B：Phase 7 自动清理未反馈的 lessons（index.ts，auto_dev_submit phase 7 分支）**

在现有 Phase 7 快捷路径中，`generateRetrospectiveData` 之后加入：
```typescript
// 自动清理未反馈的 lessons（不再要求 agent 手动反馈）
const pendingIds = state.injectedLessonIds ?? [];
if (pendingIds.length > 0) {
  await sm.atomicUpdate({ injectedLessonIds: [] });
}
```

**改动 C：更新 lessons_feedback 工具描述（index.ts:1168）**

```diff
- "Submit feedback verdicts for lessons that were injected during preflight. Must be called before checkpoint PASS.",
+ "Submit feedback verdicts for lessons that were injected during preflight. Optional — not required for checkpoint PASS.",
```

**改动 D：删除 preflight 中的反馈提示文本（index.ts:1024）**

```diff
- extraContext += `> Phase 完成后请对以上经验逐条反馈（helpful / not_applicable / incorrect）\n\n`;
```

**测试更新：**
- `lessons-manager.test.ts` 中 "AC-2/AC-9: non-empty injectedLessonIds blocks PASS" 测试改为验证**不再阻塞**
- 新增测试：Phase 7 submit 后 injectedLessonIds 被清空

---

### 2.2 Issue #5：auto_dev_complete 状态一致性检测

**目标：** 检测 state.json 与 progress-log 的不一致。

**改动位置：** index.ts，`auto_dev_complete` handler 中 `validateCompletion` 之后、verification gate 之前。

```typescript
// State/progress-log consistency check
const maxLogPhase = validation.passedPhases.length > 0
  ? Math.max(...validation.passedPhases)
  : 0;
if (state.phase > maxLogPhase + 1) {
  return textResult({
    error: "STATE_LOG_INCONSISTENT",
    canComplete: false,
    statePhase: state.phase,
    logMaxPhase: maxLogPhase,
    passedPhases: validation.passedPhases,
    message: `state.json phase=${state.phase} 但 progress-log 中最高 PASS 阶段为 ${maxLogPhase}。` +
      `可能存在手动修改 state.json 的情况。`,
    mandate: "[BLOCKED] state.json 与 progress-log 不一致，禁止宣称完成。",
  });
}
```

**测试：**
- 新增测试：state.phase=7 但 progress-log 只有 phase 1-4 的 PASS → 返回 STATE_LOG_INCONSISTENT
- 新增测试：正常情况（state.phase=7，progress-log 有 1-7 PASS）→ 通过

---

### 2.3 Issue #10：Tribunal Schema 拆分 blocking/advisory

**目标：** Tribunal 只能基于 AC/task 判 FAIL，超出范围的发现仅作为建议。

**改动 A：tribunal-schema.ts — 新增 advisory 字段，issues 增加 acRef**

```typescript
export const TRIBUNAL_SCHEMA = {
  type: "object",
  properties: {
    verdict: {
      type: "string",
      enum: ["PASS", "FAIL"],
      description: "裁决结果。只能基于 design.md AC 和 plan.md task 判定。"
    },
    issues: {
      type: "array",
      items: {
        type: "object",
        properties: {
          severity: { type: "string", enum: ["P0", "P1", "P2"] },
          description: { type: "string" },
          file: { type: "string" },
          suggestion: { type: "string" },
          acRef: {
            type: "string",
            description: "对应的 AC 编号或 plan task 编号（如 AC-3, Task-5）。无法引用则放入 advisory。"
          }
        },
        required: ["severity", "description", "acRef"]
      },
      description: "AC/Plan 范围内的问题列表 — 影响裁决结果"
    },
    advisory: {
      type: "array",
      items: {
        type: "object",
        properties: {
          description: { type: "string" },
          suggestion: { type: "string" }
        },
        required: ["description"]
      },
      description: "超出 AC/Plan 范围的观察和建议 — 仅记录，不影响裁决"
    },
    traces: {
      // ... 保持不变
    },
    passEvidence: {
      // ... 保持不变
    }
  },
  required: ["verdict", "issues"]
};
```

**改动 B：tribunal.ts executeTribunal — FAIL 但无 blocking issues 时 auto-override**

在 `crossValidate` 之后、PASS checkpoint 之前，增加 FAIL 校验：

```typescript
// ------- FAIL without blocking issues: auto-override to PASS -------
if (verdict.verdict === "FAIL") {
  const blockingIssues = (verdict.issues ?? []).filter(
    (i: any) => i.severity === "P0" || i.severity === "P1"
  );
  if (blockingIssues.length === 0) {
    // FAIL 但没有 P0/P1 → 只有建议性问题或 advisory → override 为 PASS
    verdict.verdict = "PASS";
    // 将原 issues 移入 advisory（它们不在 AC 范围内）
    verdict.advisory = [...(verdict.advisory ?? []), ...verdict.issues.map((i: any) => ({
      description: `[auto-moved from issues] ${i.description}`,
      suggestion: i.suggestion,
    }))];
    verdict.issues = [];
    // 记录 override
    await appendFile(
      join(outputDir, `tribunal-phase${phase}.md`),
      `\n\n[FRAMEWORK OVERRIDE] FAIL→PASS: 无 P0/P1 blocking issues，advisory 已记录。\n`,
    );
  }
}
```

**改动 C：tribunal-checklists.ts — 每个 phase checklist 头部加范围约束**

在 ANTI_LENIENCY 之后，每个 checklist 的 `> ${ANTI_LENIENCY}` 行后追加：

```markdown
> **审查范围：** 只能基于 design.md 的 AC 和 plan.md 的 task 判定 PASS/FAIL。
> 超出 AC/task 范围的发现请放入 advisory 字段（不要标为 P0/P1 issue）。
> issues 中每条必须填写 acRef（如 AC-3, Task-5），填不出来说明不在审查范围内。
```

**改动 D：tribunal.ts buildDigest — prompt 增加范围约束**

在 tribunal prompt 头部（tribunal.ts:193-196）追加一行：

```diff
  content += `PASS 的举证成本远大于 FAIL —— 如果你不确定，判 FAIL。\n\n`;
+ content += `**范围限制：** issues 中的每条问题必须关联到 design.md 的 AC 或 plan.md 的 task（通过 acRef 字段）。无法关联的发现只能放入 advisory。\n\n`;
```

**测试：**
- 新增：TRIBUNAL_SCHEMA 包含 advisory 字段
- 新增：issues.items.required 包含 "acRef"
- 新增：FAIL + 0 个 P0/P1 issues → auto-override 为 PASS
- 新增：FAIL + 1 个 P1 issue → 保持 FAIL
- 新增：checklist 包含 "审查范围" 文本
- 更新：现有 tribunal 测试适配新 schema（issues 需要 acRef）

---

### 2.4 新增：Tribunal Lessons 注入（校准 tribunal）

**目标：** 把 `category: "tribunal"` 的历史经验自动注入到 tribunal prompt，实现持续校准。

**来源：** Anthropic 文章 "Evaluator Calibration" — 人类反复校准 evaluator 的判断偏差。

**改动位置：** tribunal.ts `buildDigest` 函数，在 checklist 之后、写入 digest 文件之前。

```typescript
// 5. Inject tribunal-specific lessons for calibration
try {
  const lessonsManager = new LessonsManager(outputDir, projectRoot);
  const tribunalLessons = await lessonsManager.get(undefined, "tribunal");
  const globalTribunalLessons = (await lessonsManager.getGlobalLessons(20))
    .filter(l => l.category === "tribunal");
  const allTribunalLessons = [...tribunalLessons, ...globalTribunalLessons].slice(0, 10);

  if (allTribunalLessons.length > 0) {
    content += `\n## 历史校准（tribunal 相关经验教训）\n\n`;
    content += `> 以下是过去裁决中发现的偏差，请在本次裁决中避免重犯。\n\n`;
    for (const l of allTribunalLessons) {
      content += `- [${l.severity ?? "info"}] ${l.lesson}\n`;
    }
    content += `\n`;
  }
} catch { /* lessons not available, skip */ }
```

**需要在 buildDigest 中增加参数：** `projectRoot`（当前 buildDigest 的签名中没有，需要透传）。

**改动范围：**
| 文件 | 改动 |
|------|------|
| `tribunal.ts` buildDigest | 增加 projectRoot 参数，注入 tribunal lessons |
| `tribunal.ts` executeTribunal | 透传 projectRoot 到 buildDigest |

**测试：**
- 新增：当 lessons-learned.json 包含 category=tribunal 的条目时，digest 中包含 "历史校准" section
- 新增：无 tribunal lessons 时，digest 中不包含 "历史校准"

---

## 3. 文件影响矩阵

| 文件 | Issue #9 | Issue #5 | Issue #10 | Tribunal校准 |
|------|----------|----------|-----------|-------------|
| `index.ts` (checkpoint) | 删守卫 | | | |
| `index.ts` (submit phase 7) | 清理 IDs | | | |
| `index.ts` (preflight) | 删提示文本 | | | |
| `index.ts` (lessons_feedback) | 改描述 | | | |
| `index.ts` (auto_dev_complete) | | 加检测 | | |
| `tribunal-schema.ts` | | | 加 advisory + acRef | |
| `tribunal.ts` (executeTribunal) | | | FAIL override | |
| `tribunal.ts` (buildDigest) | | | 加范围约束 | 注入 lessons |
| `tribunal-checklists.ts` | | | 加范围约束 | |
| `lessons-manager.test.ts` | 改测试 | | | |
| `tribunal.test.ts` | | | 新增测试 | 新增测试 |
| `e2e-integration.test.ts` | | 新增测试 | | |

---

## 4. 验收标准

### AC-1（Issue #9）
- checkpoint PASS 不再因 injectedLessonIds 非空而被拒绝
- Phase 7 submit 后 injectedLessonIds 被清空
- auto_dev_lessons_feedback 工具仍可正常使用（可选调用）

### AC-2（Issue #5）
- state.phase 比 progress-log 最高 PASS phase 多 2 以上时，auto_dev_complete 返回 STATE_LOG_INCONSISTENT
- 正常流程不受影响

### AC-3（Issue #10）
- TRIBUNAL_SCHEMA 包含 advisory 数组字段
- issues 的 items.required 包含 acRef
- tribunal 判 FAIL 但无 P0/P1 issues 时，框架自动 override 为 PASS
- 每个 phase checklist 包含审查范围约束文本
- tribunal digest prompt 包含范围限制说明

### AC-4（Tribunal 校准）
- tribunal digest 中，当存在 category=tribunal 的 lessons 时包含 "历史校准" section
- 无相关 lessons 时不影响 digest 生成

---

## 5. 实施建议

预估总改动量：~120 行（含测试）。建议按 4 个 task 拆分：
1. Task 1：Issue #9（~25 行）
2. Task 2：Issue #5（~15 行）
3. Task 3：Issue #10（~55 行）
4. Task 4：Tribunal 校准（~25 行）
