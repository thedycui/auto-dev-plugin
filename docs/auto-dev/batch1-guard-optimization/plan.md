# Implementation Plan: batch1-guard-optimization

> 基于设计文档 `docs/auto-dev/batch1-guard-optimization/design.md`
> 四个改动互不依赖，按 task 串行实现，每个 task 独立 commit。

---

## Task 1: 删除 checkpoint LESSON_FEEDBACK_REQUIRED 守卫
- **描述**: 删除 `index.ts:424-436` 的 LESSON_FEEDBACK_REQUIRED 守卫代码块（`if (status === "PASS")` 中检查 `injectedLessonIds` 的逻辑），使 checkpoint PASS 不再因未反馈 lessons 而被拒绝。
- **文件**:
  - `mcp/src/index.ts`（删除第 424-436 行守卫代码）
- **依赖**: 无
- **完成标准**: checkpoint handler 中不存在 LESSON_FEEDBACK_REQUIRED 相关逻辑；`injectedLessonIds` 非空时传入 status="PASS" 不再被拒绝。

## Task 2: 删除 preflight 中的 lessons 反馈提示文本
- **描述**: 删除 `index.ts:1024` 的 `extraContext += '> Phase 完成后请对以上经验逐条反馈...'` 行，使 agent 不再被提示要进行 lessons 反馈。
- **文件**:
  - `mcp/src/index.ts`（删除第 1024 行提示文本）
- **依赖**: 无
- **完成标准**: preflight 输出不包含 "请对以上经验逐条反馈" 文本。

## Task 3: 更新 lessons_feedback 工具描述为 Optional
- **描述**: 将 `index.ts:1168` 的 `auto_dev_lessons_feedback` 工具描述从 "Must be called before checkpoint PASS" 改为 "Optional — not required for checkpoint PASS"。
- **文件**:
  - `mcp/src/index.ts`（修改第 1168 行描述文本）
- **依赖**: 无
- **完成标准**: 工具描述包含 "Optional" 且不包含 "Must be called"。

## Task 4: Phase 7 submit 自动清理未反馈的 injectedLessonIds
- **描述**: 在 `index.ts:1447` Phase 7 分支中，`generateRetrospectiveData` 之后、`internalCheckpoint` 之前，新增逻辑：如果 `state.injectedLessonIds` 非空则通过 `sm.atomicUpdate` 清空为 `[]`。
- **文件**:
  - `mcp/src/index.ts`（Phase 7 分支，约第 1449 行后插入）
- **依赖**: 无
- **完成标准**: Phase 7 submit 完成后 state.json 中 injectedLessonIds 为空数组。

## Task 5: 更新 lessons-manager 测试（适配守卫删除）
- **描述**: 修改 `lessons-manager.test.ts:609` 的 "AC-2/AC-9: non-empty injectedLessonIds blocks PASS" 测试，将其改为验证**不再阻塞** PASS。新增一个测试验证 Phase 7 submit 后 injectedLessonIds 被清空。
- **文件**:
  - `mcp/src/__tests__/lessons-manager.test.ts`（修改第 609 行测试；新增 Phase 7 清理测试）
- **依赖**: Task 1, Task 4
- **完成标准**: 修改后的测试断言 `shouldReject` 为 `false`（而非 `true`）；新增测试验证清理逻辑；所有测试通过。

## Task 6: auto_dev_complete 状态一致性检测
- **描述**: 在 `index.ts` 的 `auto_dev_complete` handler 中，`validateCompletion` 的 `if (!validation.canComplete)` 检查之后（约第 1241 行）、verification gate 之前（约第 1242 行），插入 state.phase vs progress-log maxPassPhase 的交叉检测逻辑。当 `state.phase > maxLogPhase + 1` 时返回 `STATE_LOG_INCONSISTENT` 错误。
- **文件**:
  - `mcp/src/index.ts`（auto_dev_complete handler，第 1241 行后插入）
- **依赖**: 无
- **完成标准**: state.phase=7 且 progress-log 最高 PASS phase=4 时返回 STATE_LOG_INCONSISTENT；正常情况不误报。

## Task 7: 状态一致性检测单元测试
- **描述**: 在 `e2e-integration.test.ts` 中新增两个测试：(1) state.phase=7 + progress-log 只有 phase 1-4 PASS 时返回 STATE_LOG_INCONSISTENT；(2) state.phase=7 + progress-log 有 1-7 全部 PASS 时正常通过。
- **文件**:
  - `mcp/src/__tests__/e2e-integration.test.ts`（新增测试）
- **依赖**: Task 6
- **完成标准**: 两个测试覆盖正向和负向场景，均通过。

## Task 8: Tribunal Schema 新增 advisory 字段和 acRef 字段
- **描述**: 修改 `tribunal-schema.ts` 的 `TRIBUNAL_SCHEMA`：(1) `issues.items.properties` 新增 `acRef` 字段（optional，不加入 required）；(2) `issues` 的 description 更新为范围内问题；(3) 新增顶层 `advisory` 字段（array，items 含 description + suggestion）；(4) `verdict` 的 description 更新强调只能基于 AC/task 判定。
- **文件**:
  - `mcp/src/tribunal-schema.ts`
- **依赖**: 无
- **完成标准**: TRIBUNAL_SCHEMA.properties 包含 advisory 字段；issues.items.properties 包含 acRef；acRef 不在 issues.items.required 中。

## Task 9: Tribunal auto-override 逻辑（FAIL 无 P0/P1 时 override 为 PASS）
- **描述**: 在 `tribunal.ts` 的 `executeTribunal` 函数中，获取 verdict 之后、crossValidate 之前，插入 auto-override 逻辑：(1) P0/P1 issues 缺少 acRef 的降级为 advisory；(2) 降级后无 P0/P1 则 override verdict 为 PASS，将剩余 issues 移入 advisory；(3) override 记录追加到 tribunalLog 变量。注意需要将 `tribunalLog` 从 `const` 改为 `let` 以支持追加。
- **文件**:
  - `mcp/src/tribunal.ts`（executeTribunal 函数，约第 537 行后、第 553 行前插入）
- **依赖**: Task 8
- **完成标准**: FAIL + 无 P0/P1 时 auto-override 为 PASS；FAIL + 有 P1（带 acRef）保持 FAIL；FAIL + P1（无 acRef）降级后 override 为 PASS；override 后仍经过 crossValidate。

## Task 10: Tribunal checklist 范围约束文本
- **描述**: 在 `tribunal-checklists.ts` 每个 phase checklist 的 `> ${ANTI_LENIENCY}` 行后追加审查范围约束文本（3 行 markdown，说明只能基于 AC/task 判定，超出范围放入 advisory，建议填写 acRef）。
- **文件**:
  - `mcp/src/tribunal-checklists.ts`
- **依赖**: 无
- **完成标准**: 每个 phase checklist 包含 "审查范围" 约束文本。

## Task 11: Tribunal prompt 范围限制说明
- **描述**: 在 `tribunal.ts` 的 `prepareTribunalInput` 函数中，`PASS 的举证成本远大于 FAIL` 行后（约第 196 行），追加范围限制说明文本，提及 "缺少 acRef 会被框架自动降级"。
- **文件**:
  - `mcp/src/tribunal.ts`（prepareTribunalInput 函数，约第 196 行后）
- **依赖**: 无
- **完成标准**: tribunal digest prompt 包含 "范围限制" 文本且提及 acRef 降级。

## Task 12: types.ts category 枚举新增 "tribunal"
- **描述**: 在 `types.ts:60` 的 `LessonEntrySchema.category` z.enum 中新增 `"tribunal"` 值。
- **文件**:
  - `mcp/src/types.ts`（第 60 行）
- **依赖**: 无
- **完成标准**: `LessonEntrySchema` 允许 category="tribunal"。

## Task 13: Tribunal lessons 注入（校准）
- **描述**: 在 `tribunal.ts` 的 `prepareTribunalInput` 函数中：(1) 新增 `LessonsManager` import；(2) 在 checklist 之后（约第 220 行）、writeFile 之前（约第 222 行），注入 tribunal-specific lessons（从本地 + 全局 lessons 中筛选 category="tribunal"，最多 10 条），生成 "历史校准" section。用 try/catch 包裹，失败时静默跳过。
- **文件**:
  - `mcp/src/tribunal.ts`（import 区 + prepareTribunalInput 函数）
- **依赖**: Task 12
- **完成标准**: 有 tribunal lessons 时 digest 包含 "历史校准" section；无 tribunal lessons 时不包含。

## Task 14: Tribunal 相关单元测试
- **描述**: 在 `tribunal.test.ts` 中新增以下测试：(1) TRIBUNAL_SCHEMA 包含 advisory 字段；(2) issues.items.properties 包含 acRef（不在 required 中）；(3) FAIL + 0 P0/P1 → auto-override PASS；(4) FAIL + P1（有 acRef）→ 保持 FAIL；(5) FAIL + P1（无 acRef）→ 降级 + override PASS；(6) auto-override 后经过 crossValidate；(7) checklist 包含 "审查范围"；(8) tribunal prompt 包含 "范围限制"；(9) LessonEntrySchema 包含 "tribunal" category；(10) tribunal lessons 注入时 digest 包含 "历史校准"；(11) 无 tribunal lessons 时不包含 "历史校准"。同步更新现有测试适配新 schema。
- **文件**:
  - `mcp/src/__tests__/tribunal.test.ts`（新增测试 + 更新现有 mock）
- **依赖**: Task 8, Task 9, Task 10, Task 11, Task 12, Task 13
- **完成标准**: 所有新增测试通过；现有测试不因 schema 变更而失败。

## Task 15: 全量测试验证
- **描述**: 运行完整测试套件，确保所有改动没有引入回归。
- **文件**: 无新增修改
- **依赖**: Task 1-14
- **完成标准**: `npm test` 或 `npx vitest run` 全部通过，无红灯。
