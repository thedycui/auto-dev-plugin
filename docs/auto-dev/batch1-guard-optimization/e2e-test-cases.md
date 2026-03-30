# batch1-guard-optimization 端到端测试用例

> 2026-03-26 | 覆盖 AC-1 ~ AC-17

---

## 1. Issue #9: Lessons 反馈守卫移除

### TC-1: checkpoint PASS 不再被 injectedLessonIds 阻塞 (AC-1)

- **前置条件**: state.injectedLessonIds = ["id-aaa", "id-bbb"]，status = "PASS"
- **操作**: 模拟 checkpoint handler 中的守卫逻辑
- **预期结果**: 不返回 LESSON_FEEDBACK_REQUIRED 错误，正常通过
- **验证方式**: 断言 guard 不再存在（shouldBlock = false）

### TC-2: Phase 7 submit 后 injectedLessonIds 被清空 (AC-2)

- **前置条件**: state.injectedLessonIds = ["id-aaa"]，phase = 7
- **操作**: 模拟 Phase 7 submit 快捷路径中的自动清理逻辑
- **预期结果**: state.injectedLessonIds 被清空为 []
- **验证方式**: 读取更新后的 state，断言 injectedLessonIds === []

### TC-3: lessons_feedback 工具描述包含 "Optional" (AC-3)

- **前置条件**: 无
- **操作**: 检查 index.ts 中 auto_dev_lessons_feedback 工具描述
- **预期结果**: 描述包含 "Optional"，不包含 "Must be called"
- **验证方式**: 字符串匹配断言

### TC-4: preflight 输出不包含反馈提示文本 (AC-4)

- **前置条件**: 有 injected lessons
- **操作**: 检查 preflight 代码中是否移除了 "请对以上经验逐条反馈"
- **预期结果**: 不包含 "请对以上经验逐条反馈" 提示
- **验证方式**: 在 index.ts 源码中搜索确认该文本已移除

---

## 2. Issue #5: auto_dev_complete 状态一致性检测

### TC-5: state.phase 超前于 progress-log 最高 PASS phase 时返回错误 (AC-5)

- **前置条件**: state.phase = 7，progress-log 只有 phase 1-4 的 PASS
- **操作**: 调用 validateCompletion + 状态一致性检查逻辑
- **预期结果**: 检测到 state.phase(7) > maxLogPhase(4) + 1，返回不一致错误
- **验证方式**: 断言 statePhase < maxPassedPhase 或 statePhase 超前触发 STATE_PHASE_INCONSISTENCY

### TC-6: 正常情况通过一致性检测 (AC-6)

- **前置条件**: state.phase = 7，progress-log 有 1-7 全部 PASS
- **操作**: 调用 validateCompletion + 状态一致性检查逻辑
- **预期结果**: 不返回不一致错误
- **验证方式**: validateCompletion.canComplete === true

### TC-7: 集成入口测试 -- auto_dev_complete handler 管线 (AC-5)

- **前置条件**: StateManager 真实实例，state.phase = 7，progress-log 只有 phase 1-4 PASS
- **操作**: 从 auto_dev_complete handler 入口模拟完整管线
- **预期结果**: 返回 INCOMPLETE（progress-log 缺少 5-7 PASS），因上游 INCOMPLETE 检查先于一致性检查
- **验证方式**: 断言返回 error 包含 "INCOMPLETE" 或 missingPhases

---

## 3. Issue #10: Tribunal Schema 拆分 + Auto-Override

### TC-8: TRIBUNAL_SCHEMA 包含 advisory 字段 (AC-7)

- **前置条件**: 无
- **操作**: 导入 TRIBUNAL_SCHEMA 检查 properties
- **预期结果**: properties 包含 advisory，类型为 array，items.required 包含 "description"
- **验证方式**: 直接断言 schema 结构

### TC-9: issues.items.properties 包含 acRef（optional，不在 required 中）(AC-8)

- **前置条件**: 无
- **操作**: 导入 TRIBUNAL_SCHEMA 检查 issues schema
- **预期结果**: issues.items.properties 包含 acRef，issues.items.required 不包含 "acRef"
- **验证方式**: 断言 schema 结构

### TC-10: FAIL + 0 个 P0/P1 issues -> auto-override 为 PASS (AC-9)

- **前置条件**: verdict = { verdict: "FAIL", issues: [{ severity: "P2", description: "minor style" }] }
- **操作**: 模拟 executeTribunal 中的 auto-override 逻辑
- **预期结果**: verdict 被 override 为 "PASS"，P2 issue 被移入 advisory
- **验证方式**: 断言 verdict.verdict === "PASS"，advisory 包含原 P2 issue

### TC-11: FAIL + 1 个 P1 issue（有 acRef）-> 保持 FAIL (AC-10)

- **前置条件**: verdict = { verdict: "FAIL", issues: [{ severity: "P1", description: "missing test", acRef: "AC-5" }] }
- **操作**: 模拟 auto-override 逻辑
- **预期结果**: 保持 FAIL，issues 不变
- **验证方式**: 断言 verdict.verdict === "FAIL"

### TC-12: FAIL + 1 个 P1 issue（无 acRef）-> P1 降级 -> override PASS (AC-11)

- **前置条件**: verdict = { verdict: "FAIL", issues: [{ severity: "P1", description: "unrelated issue" }] }（无 acRef）
- **操作**: 模拟 auto-override 逻辑（含 acRef 降级）
- **预期结果**: P1 被降级为 advisory，FAIL override 为 PASS
- **验证方式**: 断言 verdict.verdict === "PASS"，advisory 包含降级后的 issue

### TC-13: auto-override 后仍经过 crossValidate (AC-12)

- **前置条件**: verdict = FAIL，issues 只有 P2（会被 override 为 PASS）
- **操作**: 模拟 executeTribunal 中 override -> crossValidate 顺序
- **预期结果**: override 为 PASS 后，crossValidate 被调用
- **验证方式**: 验证代码中 auto-override 在 crossValidate 之前

### TC-14: 每个 phase 的 tribunal checklist 包含 "审查范围" (AC-13)

- **前置条件**: 无
- **操作**: 调用 getTribunalChecklist(4), getTribunalChecklist(5), getTribunalChecklist(6)
- **预期结果**: 每个返回值都包含 "审查范围" 文本
- **验证方式**: 字符串包含断言

### TC-15: tribunal digest prompt 包含 "范围限制" (AC-14)

- **前置条件**: 真实临时目录，最小化的 progress-log 和必要文件
- **操作**: 调用 prepareTribunalInput
- **预期结果**: digest 内容包含 "范围限制" 和 "acRef" 相关文本
- **验证方式**: 断言 digestContent 包含目标文本

---

## 4. Tribunal 校准: Lessons 注入

### TC-16: LessonEntrySchema.category 枚举包含 "tribunal" (AC-15)

- **前置条件**: 无
- **操作**: 用 LessonEntrySchema 解析 category = "tribunal" 的条目
- **预期结果**: 解析成功，不抛异常
- **验证方式**: z.parse 不抛错

### TC-17: lessons-learned.json 包含 tribunal lessons 时 digest 有 "校准" section (AC-16)

- **前置条件**: lessons-learned.json 包含 category="tribunal" 的条目
- **操作**: 调用 prepareTribunalInput
- **预期结果**: digest 内容包含 "校准" 或 "裁决校准经验"
- **验证方式**: 断言 digestContent 包含 "裁决校准经验"

### TC-18: 无 tribunal lessons 时 digest 不包含 "校准" section (AC-17)

- **前置条件**: lessons-learned.json 为空或不存在
- **操作**: 调用 prepareTribunalInput
- **预期结果**: digest 不包含 "裁决校准经验"
- **验证方式**: 断言 digestContent 不包含 "裁决校准经验"

---

## 5. 负面测试

### TC-19: FAIL + 混合 issues（P0 有 acRef + P1 无 acRef + P2）-> P0 保留, P1 降级, 保持 FAIL

- **前置条件**: issues = [{ P0 + acRef }, { P1 无 acRef }, { P2 }]
- **操作**: 模拟 auto-override 逻辑
- **预期结果**: P1 降级为 advisory，P0 保留，仍有 P0 所以保持 FAIL
- **验证方式**: verdict === "FAIL"，issues 只剩 P0 和 P2，advisory 包含降级的 P1

### TC-20: LessonEntrySchema 拒绝 category="invalid_category"

- **前置条件**: 无
- **操作**: 用 LessonEntrySchema 解析 category = "invalid_category" 的条目
- **预期结果**: 解析失败抛异常
- **验证方式**: expect(() => parse).toThrow()

---

## 6. 集成入口测试

### TC-21: executeTribunal 管线 -- FAIL auto-override 全流程

- **前置条件**: 真实临时目录，mock claude CLI 返回 FAIL + 只有 P2
- **操作**: 调用 executeTribunal 全管线
- **预期结果**: auto-override 为 PASS，crossValidate 被执行，最终返回 TRIBUNAL_PASS 或 TRIBUNAL_OVERRIDDEN
- **验证方式**: 断言返回的 status 值

### TC-22: prepareTribunalInput 管线 -- tribunal lessons 注入全流程

- **前置条件**: 真实临时目录 + lessons-learned.json 含 tribunal 条目 + progress-log + design.md
- **操作**: 调用 prepareTribunalInput
- **预期结果**: digest 文件写入，内容包含 "裁决校准经验" section
- **验证方式**: 读取 digest 文件，断言内容

---

## 测试矩阵

| TC | AC | 类型 | 入口级别 |
|----|-----|------|---------|
| TC-1 | AC-1 | 单元 | 组件 |
| TC-2 | AC-2 | 单元 | 组件 |
| TC-3 | AC-3 | 静态检查 | 代码审查 |
| TC-4 | AC-4 | 静态检查 | 代码审查 |
| TC-5 | AC-5 | 单元 | 组件 |
| TC-6 | AC-6 | 单元 | 组件 |
| TC-7 | AC-5 | 集成入口 | handler 管线 |
| TC-8 | AC-7 | 单元 | Schema |
| TC-9 | AC-8 | 单元 | Schema |
| TC-10 | AC-9 | 单元 | 组件 |
| TC-11 | AC-10 | 单元 | 组件 |
| TC-12 | AC-11 | 单元 | 组件 |
| TC-13 | AC-12 | 结构验证 | 代码顺序 |
| TC-14 | AC-13 | 单元 | 组件 |
| TC-15 | AC-14 | 集成 | prepareTribunalInput |
| TC-16 | AC-15 | 单元 | Schema |
| TC-17 | AC-16 | 集成 | prepareTribunalInput |
| TC-18 | AC-17 | 集成 | prepareTribunalInput |
| TC-19 | AC-9~11 | 负面 | 组件 |
| TC-20 | AC-15 | 负面 | Schema |
| TC-21 | AC-9,12 | 集成入口 | executeTribunal 管线 |
| TC-22 | AC-16 | 集成入口 | prepareTribunalInput 管线 |
