# batch1-guard-optimization E2E 测试结果

> 执行时间: 2026-03-26T01:33:49
> 测试框架: vitest 2.1.9
> 测试文件: `mcp/src/__tests__/batch1-guard-optimization.test.ts`

---

## 总览

| 指标 | 值 |
|------|-----|
| 总测试数 | 21 |
| 通过 | 21 |
| 失败 | 0 |
| 跳过 | 0 |
| 执行耗时 | 56ms (测试) / 1.59s (总计) |

---

## 全量回归

| 指标 | 值 |
|------|-----|
| 总测试文件 | 15 |
| 总测试数 | 337 |
| 全部通过 | 337 |
| 失败 | 0 |
| 总耗时 | 12.64s |

新增测试未影响任何既有测试。

---

## 详细结果

### 1. Issue #9: Lessons 反馈守卫移除 (4 tests)

| TC | AC | 描述 | 结果 |
|----|----|------|------|
| TC-1 | AC-1 | checkpoint PASS 不再被 injectedLessonIds 阻塞 | PASS |
| TC-2 | AC-2 | Phase 7 submit 自动清理 injectedLessonIds | PASS |
| TC-3 | AC-3 | lessons_feedback 工具描述包含 "Optional" | PASS |
| TC-4 | AC-4 | preflight 不包含反馈提示文本 | PASS |

### 2. Issue #5: auto_dev_complete 状态一致性 (3 tests)

| TC | AC | 描述 | 结果 |
|----|----|------|------|
| TC-5 | AC-5 | state.phase 超前于 progress-log -> 检测到不一致 | PASS |
| TC-6 | AC-6 | 正常情况全部 PASS -> 通过 | PASS |
| TC-7 | AC-5 | 集成入口: auto_dev_complete 管线（incomplete log） | PASS |

### 3. Issue #10: Tribunal Schema + Auto-Override (8 tests)

| TC | AC | 描述 | 结果 |
|----|----|------|------|
| TC-8 | AC-7 | TRIBUNAL_SCHEMA 包含 advisory 字段 | PASS |
| TC-9 | AC-8 | issues.items.properties 包含 acRef（optional） | PASS |
| TC-10 | AC-9 | FAIL + 0 P0/P1 -> auto-override PASS | PASS |
| TC-11 | AC-10 | FAIL + P1(有 acRef) -> 保持 FAIL | PASS |
| TC-12 | AC-11 | FAIL + P1(无 acRef) -> 降级 advisory, override PASS | PASS |
| TC-13 | AC-12 | auto-override 在 crossValidate 之前（代码顺序验证） | PASS |
| TC-14 | AC-13 | 每个 phase checklist 包含 "审查范围" | PASS |
| TC-15 | AC-14 | tribunal digest 包含 "范围限制" + "acRef" 文本 | PASS |

### 4. Tribunal 校准: Lessons 注入 (3 tests)

| TC | AC | 描述 | 结果 |
|----|----|------|------|
| TC-16 | AC-15 | LessonEntrySchema.category 允许 "tribunal" | PASS |
| TC-17 | AC-16 | digest 包含 "裁决校准经验" section（有 lessons） | PASS |
| TC-18 | AC-17 | digest 不包含 "裁决校准经验"（无 lessons） | PASS |

### 5. 负面测试 (2 tests)

| TC | AC | 描述 | 结果 |
|----|----|------|------|
| TC-19 | AC-9~11 | 混合 issues: P0(acRef) + P1(无 acRef) + P2 -> FAIL 保持 | PASS |
| TC-20 | AC-15 | LessonEntrySchema 拒绝无效 category | PASS |

### 6. 集成入口测试 (1 test)

| TC | AC | 描述 | 结果 |
|----|----|------|------|
| TC-22 | AC-16 | prepareTribunalInput 全管线: tribunal lessons 注入 | PASS |

---

## AC 覆盖矩阵

| AC | 描述 | 覆盖的 TC |
|----|------|----------|
| AC-1 | checkpoint PASS 不被 lessons 阻塞 | TC-1 |
| AC-2 | Phase 7 清理 injectedLessonIds | TC-2 |
| AC-3 | 工具描述含 Optional | TC-3 |
| AC-4 | preflight 无反馈提示 | TC-4 |
| AC-5 | 状态不一致检测 | TC-5, TC-7 |
| AC-6 | 正常情况通过 | TC-6 |
| AC-7 | schema 有 advisory | TC-8 |
| AC-8 | acRef optional | TC-9 |
| AC-9 | FAIL 无 P0/P1 override PASS | TC-10, TC-19 |
| AC-10 | FAIL 有 P1+acRef 保持 | TC-11 |
| AC-11 | P1 无 acRef 降级 | TC-12, TC-19 |
| AC-12 | override 在 crossValidate 前 | TC-13 |
| AC-13 | checklist 含审查范围 | TC-14 |
| AC-14 | digest 含范围限制 | TC-15 |
| AC-15 | category 枚举含 tribunal | TC-16, TC-20 |
| AC-16 | 有 lessons 时 digest 含校准 | TC-17, TC-22 |
| AC-17 | 无 lessons 时 digest 无校准 | TC-18 |

所有 AC-1 ~ AC-17 均被至少一个测试用例覆盖。
