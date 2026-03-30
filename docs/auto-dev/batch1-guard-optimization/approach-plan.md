# Batch 1: Guard Optimization — 实施完成记录

## 完成时间
2026-03-26

## 修改文件清单

### 1. mcp/src/index.ts
- **Task 1**: 删除 LESSON_FEEDBACK_REQUIRED 守卫代码块（约12行）
- **Task 2**: 删除 preflight 中 "Phase 完成后请对以上经验逐条反馈" 提示文本
- **Task 3**: 更新 auto_dev_lessons_feedback 工具描述为 Optional
- **Task 4**: Phase 7 submit 分支中添加 injectedLessonIds 自动清理逻辑
- **Task 6**: auto_dev_complete handler 中添加 state.phase 与 progress-log passedPhases 一致性检测

### 2. mcp/src/types.ts
- **Task 12**: LessonEntry category 枚举新增 "tribunal"
- **Task 8**: TribunalVerdict 接口新增 acRef（issues 子项）和 advisory 字段

### 3. mcp/src/tribunal-schema.ts
- **Task 8**: JSON Schema issues.items 新增 acRef 属性，新增 advisory 数组字段

### 4. mcp/src/tribunal.ts
- **Task 9**: executeTribunal 中添加 auto-override 逻辑（FAIL 无 acRef 的 P0/P1 降级为 advisory）
- **Task 11**: prepareTribunalInput digest 中添加范围限制说明
- **Task 13**: digest 构建中注入 category=tribunal 的 lessons 校准经验

### 5. mcp/src/tribunal-checklists.ts
- **Task 10**: Phase 4/5/6 checklist 各自增加审查范围约束文本

### 6. mcp/src/__tests__/lessons-manager.test.ts
- **Task 5**: 适配守卫删除，更新 AC-2/AC-9 相关测试用例

### 7. mcp/src/__tests__/tribunal.test.ts
- **Task 7**: 新增 state 一致性检测单元测试（4 cases）
- **Task 14**: 新增 Tribunal schema、auto-override、checklist scope、category 相关测试（9 cases）

## 测试结果
- 14 个测试文件全部通过
- 316 个测试用例全部通过
