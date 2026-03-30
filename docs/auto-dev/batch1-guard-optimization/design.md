# 批次 1：框架守卫优化 — 统一设计文档

> 2026-03-27 | 涵盖 Issue #9, #5, #10 + Tribunal 校准（lessons 注入）
> 修订版：2026-03-26 — 修复 P0-1, P1-1, P1-2, P1-3

---

## 1. 背景与目标

本批次改动聚焦于 **框架对 agent 的约束方式优化**，核心原则：
- **隐形框架**：agent 不应感知框架控制机制的存在
- **审查有界**：tribunal 只能基于 AC/task 判定，不能自创需求
- **状态可信**：框架应能检测并报告状态不一致

四个改动互不依赖，可以分 task 并行实现。

---

## 2. 现状分析

### 2.1 Lessons 反馈守卫（Issue #9）

当前 `index.ts:424-436` 有一个 checkpoint 守卫：如果 `injectedLessonIds` 非空，则阻止 PASS。这迫使 agent 必须先调用 `auto_dev_lessons_feedback` 工具，违反了"隐形框架"原则 — agent 被迫感知框架的 lessons 机制。此外，反馈质量无法保证（agent 随便填 helpful 即可绕过），所以这个强制守卫的实际收益很低。

### 2.2 完成状态一致性（Issue #5）

`auto_dev_complete`（index.ts:1207）调用 `validateCompletion`（phase-enforcer.ts:196）检查 progress-log 中的 PASS 记录。但如果 agent 手动修改了 state.json 的 phase 字段跳过了中间阶段，当前检测不够严格 — 只检查了 progress-log 中哪些 phase 有 PASS，没有交叉比对 state.json 的 phase 值。

### 2.3 Tribunal 审查范围（Issue #10）

当前 `TRIBUNAL_SCHEMA`（tribunal-schema.ts:2）的 `issues` 字段没有 `acRef` 关联，tribunal agent 可以自由提出任何问题并判 FAIL，包括与 AC/plan 无关的"额外要求"。这导致 tribunal 经常因超出范围的意见判 FAIL，浪费重试次数。

### 2.4 Tribunal 校准

当前 tribunal digest（tribunal.ts `prepareTribunalInput` 函数，第 144 行）没有注入历史经验教训。tribunal 的判断偏差无法通过历史数据校准。

---

## 3. 方案对比

### Issue #9：Lessons 反馈机制

| 维度 | 方案 A：删除守卫 + Phase 7 自动清理 | 方案 B：降级为 soft warning |
|------|--------------------------------------|---------------------------|
| 描述 | 删除 checkpoint 守卫，Phase 7 submit 时自动清理未反馈的 IDs | 保留守卫但改为 warning（不阻塞 PASS），日志记录 |
| 优点 | 彻底移除 agent 感知；代码更简洁 | 保留反馈入口的可见性 |
| 缺点 | agent 可能完全忽略 lessons feedback | 仍然暴露框架机制给 agent |
| 风险 | 反馈率下降 | 半措施，不彻底 |

**选择：方案 A。** 理由：反馈质量本身不可控（agent 随意填写），强制反馈的 ROI 很低。彻底移除更符合"隐形框架"原则。lessons feedback 工具保留为可选调用。

### Issue #5：状态一致性检测

| 维度 | 方案 A：state.phase vs progress-log 交叉检测 | 方案 B：每次 checkpoint 写入时加 hash 校验链 |
|------|----------------------------------------------|---------------------------------------------|
| 描述 | 在 auto_dev_complete 中比对 state.phase 与 progress-log 最高 PASS phase | 每次 checkpoint 写入 progress-log 时追加 hash，完成时校验 hash 链 |
| 优点 | 实现简单（~15 行），检测最常见的篡改 | 更强的完整性保证 |
| 缺点 | 只检测 phase 跳跃，不防 log 被删除 | 实现复杂（~60 行），hash 链管理成本高 |
| 风险 | 覆盖面有限 | 过度设计，增加维护负担 |

**选择：方案 A。** 理由：当前最大风险是 agent 修改 state.json 跳过 phase，简单交叉检测即可覆盖。hash 链属于过度设计（YAGNI）。

### Issue #10：Tribunal 审查范围约束

| 维度 | 方案 A：Schema 拆分 blocking/advisory + auto-override | 方案 B：仅在 prompt 中约束范围 |
|------|-------------------------------------------------------|-------------------------------|
| 描述 | Schema 新增 advisory 字段 + acRef optional（prompt 强调必填）；FAIL 但无 P0/P1 时 auto-override 为 PASS | 只在 tribunal prompt/checklist 中加范围约束文字 |
| 优点 | 结构化约束 + 框架兜底；即使 tribunal 不遵守 prompt 也能自动修正 | 实现极简 |
| 缺点 | 改动量较大（~55 行） | LLM 可能忽略 prompt 约束，无法兜底 |
| 风险 | 需要更新现有 tribunal 测试 | 效果不可靠 |

**选择：方案 A。** 理由：仅靠 prompt 约束 LLM 行为不可靠，必须有框架层的结构化兜底。auto-override 机制确保即使 tribunal agent 不遵守规则，框架也能纠正。

> **修订说明（P1-1）：** acRef 改为 optional 而非 required，避免 LLM 输出校验失败触发不必要的 retry。框架层通过 auto-override 逻辑对缺少 acRef 的 P0/P1 issues 进行降级处理。

---

## 4. 改动项详细设计

### 4.1 Issue #9：删除 LESSON_FEEDBACK_REQUIRED 守卫

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

**改动 B：Phase 7 自动清理未反馈的 lessons（index.ts:1447，auto_dev_submit phase 7 分支）**

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
- `lessons-manager.test.ts` 第 609 行 "AC-2/AC-9: non-empty injectedLessonIds blocks PASS" 测试改为验证**不再阻塞**
- 新增测试：Phase 7 submit 后 injectedLessonIds 被清空

---

### 4.2 Issue #5：auto_dev_complete 状态一致性检测

**目标：** 检测 state.json 与 progress-log 的不一致。

**改动位置：** index.ts `auto_dev_complete` handler（第 1207 行）中 `validateCompletion` 之后（第 1230 行）、verification gate 之前（第 1242 行）。

> **前置条件说明（P2-1）：** 此检测代码位于 `if (!validation.canComplete) return ...` 之后，即只有当 progress-log 声称所有 phase 都 PASS 时才会执行。如果 progress-log 本身不完整，已被上游的 `INCOMPLETE` 检查拦截，不需要重复检测。

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

### 4.3 Issue #10：Tribunal Schema 拆分 blocking/advisory

**目标：** Tribunal 只能基于 AC/task 判 FAIL，超出范围的发现仅作为建议。

**改动 A：tribunal-schema.ts — 新增 advisory 字段，issues 增加 acRef（optional）**

> **修订说明（P1-1）：** `acRef` 不设为 required，改为 optional。原因：tribunal agent 是 LLM，不一定能严格遵守 schema required 约束。如果 acRef 设为 required，缺少该字段的输出会导致 JSON schema 校验失败，触发不必要的 retry。改为 optional 后，由框架层的 auto-override 逻辑负责处理缺少 acRef 的 P0/P1 issues（降级为 advisory）。

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
            description: "对应的 AC 编号或 plan task 编号（如 AC-3, Task-5）。P0/P1 issues 必须填写，无法引用则放入 advisory。"
          }
        },
        required: ["severity", "description"]
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

**改动 B：tribunal.ts executeTribunal（第 507 行）— auto-override 逻辑**

> **修订说明（P1-2）：** auto-override 逻辑放在 `crossValidate` **之前**，而非之后。这样 override 后的 PASS 会自然经过 crossValidate 检查，避免跳过框架硬数据交叉验证。
>
> **修订说明（P1-1 续）：** auto-override 条件增加 acRef 缺失检查：P0/P1 issues 如果缺少 acRef，自动降级为 advisory（视为无法证明在审查范围内的问题）。

代码结构调整为：

```
原始流程：
1. 获取 verdict
2. crossValidate (仅 PASS 时执行)
3. PASS checkpoint / FAIL return

修订后流程：
1. 获取 verdict
2. FAIL auto-override 检查（在 crossValidate 之前）
3. crossValidate (对所有 PASS 执行，包括 override 后的 PASS)
4. PASS checkpoint / FAIL return
```

在获取 verdict 之后、`crossValidate` 之前插入：

```typescript
// ------- FAIL without blocking issues: auto-override to PASS -------
if (verdict.verdict === "FAIL") {
  // Step 1: P0/P1 issues 缺少 acRef 的，降级为 advisory
  const downgraded: any[] = [];
  const remaining: any[] = [];
  for (const issue of (verdict.issues ?? [])) {
    if ((issue.severity === "P0" || issue.severity === "P1") && !issue.acRef) {
      downgraded.push({
        description: `[auto-downgraded: missing acRef] [${issue.severity}] ${issue.description}`,
        suggestion: issue.suggestion,
      });
    } else {
      remaining.push(issue);
    }
  }
  verdict.issues = remaining;
  verdict.advisory = [...(verdict.advisory ?? []), ...downgraded];

  // Step 2: 降级后如果不再有 P0/P1，override 为 PASS
  const blockingIssues = remaining.filter(
    (i: any) => i.severity === "P0" || i.severity === "P1"
  );
  if (blockingIssues.length === 0) {
    verdict.verdict = "PASS";
    // 将剩余 P2 issues 也移入 advisory
    verdict.advisory = [...(verdict.advisory ?? []), ...remaining.map((i: any) => ({
      description: `[auto-moved from issues] ${i.description}`,
      suggestion: i.suggestion,
    }))];
    verdict.issues = [];
    const overrideNote =
      `\n\n[FRAMEWORK OVERRIDE] FAIL->PASS: 无 P0/P1 blocking issues（含 acRef 降级），advisory 已记录。\n`;
    tribunalLog += overrideNote;
  }
}
```

> **修订说明（P1-3）：** 不再使用 `appendFile` 追加到 tribunal log 文件。改为在 override 时修改 `tribunalLog` 变量，让后续的 `writeFile` 一次性写入完整内容。这样无需额外 import `appendFile`，也避免了文件写入时序问题。

**改动 C：tribunal-checklists.ts — 每个 phase checklist 头部加范围约束**

在每个 checklist 的 `> ${ANTI_LENIENCY}` 行后追加：

```markdown
> **审查范围：** 只能基于 design.md 的 AC 和 plan.md 的 task 判定 PASS/FAIL。
> 超出 AC/task 范围的发现请放入 advisory 字段（不要标为 P0/P1 issue）。
> issues 中每条强烈建议填写 acRef（如 AC-3, Task-5），填不出来说明可能不在审查范围内。
```

**改动 D：tribunal.ts prepareTribunalInput（第 144 行）— prompt 增加范围约束**

在 tribunal prompt 头部（tribunal.ts:196）追加一行：

```diff
  content += `PASS 的举证成本远大于 FAIL —— 如果你不确定，判 FAIL。\n\n`;
+ content += `**范围限制：** issues 中的每条问题必须关联到 design.md 的 AC 或 plan.md 的 task（通过 acRef 字段）。无法关联的发现只能放入 advisory。P0/P1 issues 缺少 acRef 会被框架自动降级为 advisory。\n\n`;
```

**测试：**
- 新增：TRIBUNAL_SCHEMA 包含 advisory 字段
- 新增：issues.items.required 不包含 "acRef"（acRef 为 optional）
- 新增：issues.items.properties 包含 "acRef"
- 新增：FAIL + 0 个 P0/P1 issues → auto-override 为 PASS
- 新增：FAIL + 1 个 P1 issue（有 acRef）→ 保持 FAIL
- 新增：FAIL + 1 个 P1 issue（无 acRef）→ P1 降级为 advisory → auto-override 为 PASS
- 新增：auto-override 后仍经过 crossValidate 检查
- 新增：checklist 包含 "审查范围" 文本
- 更新：现有 tribunal 测试适配新 schema（issues 不再 require acRef，但 advisory 字段可能存在）

---

### 4.4 新增：Tribunal Lessons 注入（校准 tribunal）

**目标：** 把 `category: "tribunal"` 的历史经验自动注入到 tribunal prompt，实现持续校准。

**来源：** Anthropic 文章 "Evaluator Calibration" — 通过历史数据反复校准 evaluator 的判断偏差。

> **修订说明（P0-1）：** `LessonEntrySchema.category` 枚举（types.ts:60）当前值为 `"pitfall" | "highlight" | "process" | "technical" | "pattern" | "iteration-limit"`，**不包含 `"tribunal"`**。必须在枚举中新增 `"tribunal"` 值，否则 `lessonsManager.get(undefined, "tribunal")` 永远返回空数组，整个校准功能无法生效。

**改动 0（前置）：types.ts:60 — 扩展 LessonEntry.category 枚举**

```diff
- category: z.enum(["pitfall", "highlight", "process", "technical", "pattern", "iteration-limit"]),
+ category: z.enum(["pitfall", "highlight", "process", "technical", "pattern", "iteration-limit", "tribunal"]),
```

这确保：
1. `lessonsManager.get(undefined, "tribunal")` 能正确筛选出 tribunal 类别的 lessons
2. `lessons_add` 工具允许写入 category="tribunal" 的条目
3. `getGlobalLessons` 返回的条目中 `l.category === "tribunal"` 筛选能命中

**改动位置：** tribunal.ts `prepareTribunalInput` 函数（第 144 行），在 checklist 之后（第 220 行）、写入 digest 文件之前（第 222 行）。

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

**需要在 prepareTribunalInput 中增加 import：** `LessonsManager`（当前未 import）。

注意：`prepareTribunalInput` 已经接收 `projectRoot` 参数（第 147 行），无需修改函数签名。

**改动范围：**
| 文件 | 改动 |
|------|------|
| `types.ts` (第 60 行) | category 枚举新增 "tribunal" |
| `tribunal.ts` prepareTribunalInput | 增加 LessonsManager import，注入 tribunal lessons |

**测试：**
- 新增：当 lessons-learned.json 包含 category=tribunal 的条目时，digest 中包含 "历史校准" section
- 新增：无 tribunal lessons 时，digest 中不包含 "历史校准"
- 新增：LessonEntrySchema 允许 category="tribunal"（z.enum 包含 "tribunal"）

---

## 5. 文件影响矩阵

| 文件 | Issue #9 | Issue #5 | Issue #10 | Tribunal 校准 |
|------|----------|----------|-----------|---------------|
| `types.ts` (~60) | | | | 枚举加 "tribunal" |
| `index.ts` (checkpoint, ~424) | 删守卫 | | | |
| `index.ts` (submit phase 7, ~1447) | 清理 IDs | | | |
| `index.ts` (preflight, ~1024) | 删提示文本 | | | |
| `index.ts` (lessons_feedback, ~1168) | 改描述 | | | |
| `index.ts` (auto_dev_complete, ~1230) | | 加检测 | | |
| `tribunal-schema.ts` | | | 加 advisory, acRef(optional) | |
| `tribunal.ts` (executeTribunal, ~507) | | | FAIL override（crossValidate 之前） | |
| `tribunal.ts` (import 区) | | | | 加 LessonsManager import |
| `tribunal.ts` (prepareTribunalInput, ~196) | | | 加范围约束 | 注入 lessons |
| `tribunal-checklists.ts` | | | 加范围约束 | |
| `lessons-manager.test.ts` (~609) | 改测试 | | | |
| `tribunal.test.ts` (新增) | | | 新增测试 | 新增测试 |
| `e2e-integration.test.ts` (新增) | | 新增测试 | | |

---

## 6. 风险与缓解

| 风险 | 影响 | 概率 | 缓解措施 |
|------|------|------|----------|
| 删除 lessons 守卫后 agent 完全不反馈 | 低 — 反馈质量本身不可控 | 高 | lessons feedback 工具保留为可选；Phase 7 自动清理 |
| Tribunal auto-override 误判（本应 FAIL 的被 override 为 PASS） | 中 — 可能放过有问题的代码 | 低 — 仅 P2 only 或 acRef 缺失的 FAIL 才 override | override 记录在 tribunal log 中；crossValidate 在 override 之后仍然执行 |
| 现有 tribunal 测试因 schema 变更而失败 | 中 — CI 红灯 | 中 — acRef 改为 optional，影响面比 required 小 | 实施时同步更新现有测试 mock 数据，主要是新增 advisory 字段处理 |
| state.phase 检测的 +1 容差被绕过 | 低 — 仅检测明显跳跃 | 低 | 当前够用，后续可收紧容差 |
| LLM 输出的 P0/P1 issue 缺少 acRef 被错误降级 | 中 — 真正的 P0/P1 问题可能被忽略 | 低 — prompt 强调 P0/P1 必须有 acRef | prompt 中明确警告"缺少 acRef 会被降级"，LLM 有动机填写 |

**回滚方案：** 四个改动互不依赖，每个 task 独立 commit。如果某个改动出问题，可以单独 revert 对应 commit，不影响其他改动。

---

## 7. 验收标准

| AC | 描述 | 验证方式 |
|----|------|---------|
| AC-1 | checkpoint PASS 不再因 `injectedLessonIds` 非空而被拒绝（传入 status="PASS" 且 injectedLessonIds=["id1"] 时返回 PASS 而非 LESSON_FEEDBACK_REQUIRED） | 单元测试 |
| AC-2 | Phase 7 submit 后 `injectedLessonIds` 被清空为 `[]` | 单元测试 |
| AC-3 | `auto_dev_lessons_feedback` 工具描述包含 "Optional" 且不包含 "Must be called" | 代码审查 |
| AC-4 | preflight 输出不包含 "请对以上经验逐条反馈" 提示文本 | 单元测试 |
| AC-5 | `auto_dev_complete` 当 state.phase=7 且 progress-log 最高 PASS phase=4 时返回 `STATE_LOG_INCONSISTENT` 错误 | 单元测试 |
| AC-6 | `auto_dev_complete` 当 state.phase=7 且 progress-log 包含 1-7 全部 PASS 时正常通过（不返回 STATE_LOG_INCONSISTENT） | 单元测试 |
| AC-7 | `TRIBUNAL_SCHEMA.properties` 包含 `advisory` 字段，类型为 array | 单元测试 |
| AC-8 | `TRIBUNAL_SCHEMA.properties.issues.items.properties` 包含 `acRef` 字段（optional，不在 required 中） | 单元测试 |
| AC-9 | tribunal 判 FAIL 但 issues 中无 P0/P1 时，框架自动 override 为 PASS，并将原 issues 移入 advisory | 单元测试 |
| AC-10 | tribunal 判 FAIL 且 issues 中有 P1（带 acRef）时，保持 FAIL 不 override | 单元测试 |
| AC-11 | tribunal 判 FAIL 且 issues 中有 P1（无 acRef）时，P1 被降级为 advisory，触发 auto-override 为 PASS | 单元测试 |
| AC-12 | auto-override 后的 PASS 仍经过 crossValidate 检查（override 在 crossValidate 之前执行） | 单元测试 |
| AC-13 | 每个 phase 的 tribunal checklist 包含 "审查范围" 约束文本 | 单元测试 |
| AC-14 | tribunal digest prompt 包含 "范围限制" 说明文本，且提及 "缺少 acRef 会被框架自动降级" | 单元测试 |
| AC-15 | `LessonEntrySchema.category` 枚举包含 "tribunal" | 单元测试 |
| AC-16 | 当 lessons-learned.json 包含 category=tribunal 条目时，tribunal digest 中包含 "历史校准" section | 单元测试 |
| AC-17 | 无 tribunal 类别 lessons 时，tribunal digest 正常生成且不包含 "历史校准" section | 单元测试 |

---

## 8. 实施建议

预估总改动量：~130 行（含测试）。建议按 4 个 task 拆分：
1. Task 1：Issue #9 — 删除 lessons 守卫（~25 行）
2. Task 2：Issue #5 — 状态一致性检测（~15 行）
3. Task 3：Issue #10 — Tribunal Schema 拆分 + auto-override（~60 行，含 acRef 降级逻辑）
4. Task 4：Tribunal 校准 — types.ts 枚举扩展 + lessons 注入（~30 行）

四个 task 互不依赖，可并行实现。每个 task 独立 commit。

---

## 修订记录

| 修订 | 问题 | 修改内容 |
|------|------|---------|
| P0-1 | LessonEntry.category 枚举不包含 "tribunal" | 4.4 节新增"改动 0"：types.ts:60 枚举扩展；影响矩阵新增 types.ts；AC 新增 AC-15 |
| P1-1 | acRef required 导致 LLM 校验失败 | 4.3 改动 A：acRef 从 required 改为 optional；4.3 改动 B：auto-override 增加 acRef 缺失降级逻辑；AC-8 修订、AC-11 新增 |
| P1-2 | auto-override 跳过 crossValidate | 4.3 改动 B：override 逻辑移到 crossValidate 之前；AC-12 新增 |
| P1-3 | appendFile import 遗漏 | 4.3 改动 B：改为修改 tribunalLog 变量，不再使用 appendFile；影响矩阵移除 appendFile 依赖 |
