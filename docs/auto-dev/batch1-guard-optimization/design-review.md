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

---

## 5. 代码对齐

- [x] 设计中引用的所有行号与实际代码一致（±2 行内）。
- [x] 类名、方法名、文件名全部存在且正确。
- [x] import 需求已在设计中标注（`appendFile`、`LessonsManager`）。

---

## 发现的问题

### P0（阻塞性问题）

**P0-1：`LessonEntry.category` 枚举不包含 `"tribunal"`**

设计 4.4 节中写道：
```typescript
const tribunalLessons = await lessonsManager.get(undefined, "tribunal");
const globalTribunalLessons = (await lessonsManager.getGlobalLessons(20))
  .filter(l => l.category === "tribunal");
```

但 `LessonEntrySchema.category` 的枚举值为 `"pitfall" | "highlight" | "process" | "technical" | "pattern" | "iteration-limit"`，**不包含 `"tribunal"`**（见 `types.ts:60`）。

这意味着：
1. `lessonsManager.get(undefined, "tribunal")` 永远返回空数组（filter 条件永不满足）
2. `getGlobalLessons` 的 filter 同理永远为空
3. 整个 4.4 节的校准功能无法生效

**修复建议：** 在 `LessonEntrySchema.category` 枚举中增加 `"tribunal"` 值，并确认 `lessons_add` 工具允许写入该 category：

```typescript
// types.ts:60
category: z.enum(["pitfall", "highlight", "process", "technical", "pattern", "iteration-limit", "tribunal"]),
```

同时需要在设计文档的文件影响矩阵中增加 `types.ts` 的改动。

---

### P1（重要问题）

**P1-1：`acRef` 设为 `required` 可能导致 tribunal agent 输出校验失败**

设计将 `acRef` 加入 `issues.items.required`。tribunal agent 是通过 `claude -p --json-schema` 调用的 LLM — 即使 schema 要求 `acRef`，LLM 输出不一定严格遵守。如果 JSON schema 校验在 `runTribunalWithRetry` 中是 strict 模式，缺少 `acRef` 的输出会被视为 crash/invalid，触发不必要的 retry。

**修复建议：**
- 方案 A：`acRef` 不设为 required，仅在 prompt 中要求。auto-override 逻辑改为：FAIL 且 issues 中无 P0/P1 **或** issues 中任何条目缺少 acRef 则视为 advisory。
- 方案 B：保持 required，但在 `executeTribunal` 中解析 verdict 时对 `acRef` 缺失做 fallback 填充（如设为 `"unspecified"`），避免整体校验失败。

**P1-2：auto-override 逻辑插入位置有误**

设计描述插入点为"在 `crossValidate` 之后（第 565 行）、PASS checkpoint 之前（第 568 行）"。但第 565 行是 `crossValidate` 的 `if (verdict.verdict === "PASS")` 代码块的结尾 `}`。第 568 行是另一个 `if (verdict.verdict === "PASS")` 的开始。

auto-override 逻辑需要在 verdict 为 FAIL 时执行，应该插入在第 565 行的 `}` 之后、第 567 行的 `// ------- PASS: ...` 注释之前。设计中的描述不够精确但方向正确。

实际上有一个更关键的逻辑问题：**如果 auto-override 将 verdict 从 FAIL 改为 PASS，override 后的 verdict 会跳过 `crossValidate`**（因为 crossValidate 只在原始 verdict 为 PASS 时执行，此时已经过了那个分支）。这意味着 auto-override 的 PASS 不经过框架硬数据交叉验证。

**修复建议：** auto-override 后应再次执行 `crossValidate`，或将 auto-override 逻辑放在 crossValidate 之前（这样 override 后的 PASS 会自然经过 crossValidate 检查）。推荐方案：将 auto-override 放在 crossValidate 之前，改变代码结构为：

```
1. FAIL without blocking → override to PASS
2. crossValidate on PASS（包括 override 后的 PASS）
3. PASS checkpoint
4. FAIL return
```

**P1-3：`appendFile` 在 tribunal.ts 中不可用且未正确标注**

设计在 auto-override 逻辑中使用了 `appendFile`，并注明"需要在 tribunal.ts 顶部添加 `appendFile` 的 import"。当前 tribunal.ts 从 `node:fs/promises` import 了 `readFile` 和 `writeFile`。这个改动本身是可行的（`appendFile` 也在 `node:fs/promises` 中），但设计在文件影响矩阵中遗漏了这个 import 变更。

此外，auto-override 使用 `appendFile` 追加到 `tribunal-phase${phase}.md`，但这个文件在第 538 行已经通过 `writeFile` 写入了完整的 tribunal log。appendFile 追加内容在时序上没问题，但建议在设计中明确说明这一点。

**修复建议：** 影响矩阵中 tribunal.ts 行增加 "import appendFile" 的说明。或者更简单地，将 override 信息写入 tribunal log 的构建过程中（在 `writeFile` 之前修改 `tribunalLog` 内容），而非事后 append。

---

### P2（优化建议）

**P2-1：Issue #5 的一致性检测对 `validation.canComplete=false` 路径无效**

设计将一致性检测放在 `validateCompletion` 之后。但如果 `validation.canComplete === false`（已在第 1231 行 early return），则一致性检测代码不会执行。也就是说，只有当 progress-log 声称所有 phase 都 PASS 时，才会检测 state.phase 是否一致。这其实是合理的（如果 progress-log 本身就不完整，已经被 `INCOMPLETE` 拦截），但建议在设计中明确说明这个前置条件。

**P2-2：tribunal checklist 范围约束文本可提取为常量**

设计在每个 phase checklist 头部追加相同的范围约束文本。建议将这段文本提取为常量（类似 `ANTI_LENIENCY`），避免在多个 checklist 中重复相同的长文本。

---

## 路径激活风险评估（规则 2）

| 代码路径 | 状态 | 风险 |
|---------|------|------|
| `auto_dev_checkpoint` PASS 路径（删守卫后） | 已验证 — 生产在用 | 低 |
| Phase 7 submit 路径 | 已验证 — 生产在用 | 低 |
| `auto_dev_complete` 主路径 | 已验证 — 生产在用 | 低 |
| `executeTribunal` FAIL 返回路径 | 已验证 — 生产在用 | 低 |
| `executeTribunal` FAIL→PASS auto-override 路径 | **未验证 — 新增路径** | 中 — 需要充分测试 |
| `prepareTribunalInput` lessons 注入路径 | **未验证 — 新增路径** | 低 — try/catch 包裹，失败不影响主流程 |

---

## 总结

**NEEDS_FIX**

- 1 个 P0：`LessonEntry.category` 枚举缺少 `"tribunal"` — 4.4 节核心功能无法生效
- 3 个 P1：acRef required 可能导致校验失败、auto-override 跳过 crossValidate、appendFile import 遗漏
- 2 个 P2：文档补充和代码组织优化

P0 必须修复后才能进入实现阶段。P1 建议同步修复。


---

## 修订后复审 (2026-03-27)

设计文档已根据上述 P0/P1 问题进行修订：

- **P0-1 已修复**：types.ts category 枚举新增 "tribunal" 值，design.md 4.4 节新增改动 0
- **P1-1 已修复**：acRef 改为 optional，增加降级逻辑（缺 acRef 的 P0/P1 自动移入 advisory）
- **P1-2 已修复**：auto-override 逻辑移到 crossValidate 之前，override 后仍经过硬数据校验
- **P1-3 已修复**：不再使用 appendFile，改为修改 tribunalLog 变量

## 结论

PASS
