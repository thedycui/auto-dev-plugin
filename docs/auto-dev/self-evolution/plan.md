# Implementation Plan: self-evolution

## Task 1: 扩展 LessonEntry 数据模型
- **描述**: 在 `LessonEntrySchema` 中新增 `sourceProject`、`promotedAt`、`promotionPath` 三个 optional 字段，支持跨项目晋升追踪
- **文件**:
  - `D:\dycuui\auto-dev-plugin\mcp\src\types.ts`
- **依赖**: 无
- **完成标准**: Schema 定义包含三个新字段，类型推导正确，现有 JSON 文件可正常反序列化

## Task 2: 新增 Global 层常量
- **描述**: 在 `lessons-constants.ts` 中新增 `MAX_CROSS_PROJECT_POOL`、`MAX_CROSS_PROJECT_INJECT`、`GLOBAL_PROMOTE_MIN_SCORE` 三个常量
- **文件**:
  - `D:\dycuui\auto-dev-plugin\mcp\src\lessons-constants.ts`
- **依赖**: 无
- **完成标准**: 常量定义存在，值分别为 100、15、6

## Task 3: 实现 Global 层文件路径方法
- **描述**: 在 `LessonsManager` 中新增 `crossProjectFilePath()` 私有方法，返回 `~/.auto-dev/lessons-global.json` 路径
- **文件**:
  - `D:\dycuui\auto-dev-plugin\mcp\src\lessons-manager.ts`
- **依赖**: 无
- **完成标准**: 方法返回 `path.join(os.homedir(), '.auto-dev', 'lessons-global.json')`

## Task 4: 实现 getCrossProjectLessons 方法
- **描述**: 读取 Global 层文件，按 decayed score 降序返回 top-N 条目，文件不存在时返回空数组
- **文件**:
  - `D:\dycuui\auto-dev-plugin\mcp\src\lessons-manager.ts`
- **依赖**: Task 2, Task 3
- **完成标准**: 方法签名 `async getCrossProjectLessons(limit?: number): Promise<LessonEntry[]>`，复用现有 `applyDecay()` 逻辑

## Task 5: 实现 promoteToGlobal 方法
- **描述**: 将 Project 层中 `reusable=true` 且 `applyDecay(entry) >= 6` 的条目晋升到 Global 层，去重，pool 满时执行 displacement
- **文件**:
  - `D:\dycuui\auto-dev-plugin\mcp\src\lessons-manager.ts`
- **依赖**: Task 1, Task 2, Task 4
- **完成标准**: 方法签名 `async promoteToGlobal(minScore?: number): Promise<number>`，返回晋升数量，displacement 逻辑与现有 `addToGlobal()` 一致

## Task 6: 实现 injectGlobalLessons 方法
- **描述**: 启动时从 Global 层读取高分 lessons，返回注入的条目列表（供 init 写入 state.injectedGlobalLessonIds）
- **文件**:
  - `D:\dycuui\auto-dev-plugin\mcp\src\lessons-manager.ts`
- **依赖**: Task 4
- **完成标准**: 方法签名 `async injectGlobalLessons(): Promise<LessonEntry[]>`，调用 `getCrossProjectLessons()` 并更新 appliedCount

## Task 7: 重命名现有方法（向后兼容）
- **描述**: 将 `getGlobalLessons` 重命名为 `getProjectLessons`，`addToGlobal` 重命名为 `addToProject`，`promoteReusableLessons` 重命名为 `promoteToProject`，导出旧名称作为别名
- **文件**:
  - `D:\dycuui\auto-dev-plugin\mcp\src\lessons-manager.ts`
- **依赖**: 无
- **完成标准**: 旧方法名通过 `export { getProjectLessons as getGlobalLessons }` 仍可调用，编译通过

## Task 8: 集成 injectGlobalLessons 到 init 流程
- **描述**: 在 `auto_dev_init` 工具中调用 `LessonsManager.injectGlobalLessons()`，将返回的 lesson IDs 写入 `state.injectedGlobalLessonIds`
- **文件**:
  - `D:\dycuui\auto-dev-plugin\mcp\src\index.ts`
- **依赖**: Task 6
- **完成标准**: init 成功后 state.json 包含 `injectedGlobalLessonIds` 字段

## Task 9: 集成 promoteToGlobal 到 Retrospective
- **描述**: 在 Phase 7 Retrospective 完成后自动调用 `LessonsManager.promoteToGlobal()`
- **文件**:
  - `D:\dycuui\auto-dev-plugin\mcp\src\retrospective.ts`
- **依赖**: Task 5
- **完成标准**: `runRetrospective()` 末尾调用 `promoteToGlobal()`，返回晋升数量

## Task 10: 单元测试 - Global 层基础功能
- **描述**: 测试 `getCrossProjectLessons()` 和 `promoteToGlobal()` 的正向场景（文件存在、晋升成功）
- **文件**:
  - `D:\dycuui\auto-dev-plugin\mcp\src\__tests__\lessons-manager.test.ts`
- **依赖**: Task 4, Task 5
- **完成标准**: 至少 2 个测试用例通过，覆盖 AC-1 和 AC-2

## Task 11: 单元测试 - Global 层边界场景
- **描述**: 测试文件不存在、pool 满时 displacement、低分条目拒绝晋升、格式异常文件处理
- **文件**:
  - `D:\dycuui\auto-dev-plugin\mcp\src\__tests__\lessons-manager.test.ts`
- **依赖**: Task 10
- **完成标准**: 至少 4 个测试用例通过，覆盖 AC-3、AC-10、AC-11

## Task 12: 单元测试 - 数据兼容性
- **描述**: 测试现有 JSON 文件（不含新字段）可正常反序列化，旧方法名别名可正常调用
- **文件**:
  - `D:\dycuui\auto-dev-plugin\mcp\src\__tests__\lessons-manager.test.ts`
- **依赖**: Task 1, Task 7
- **完成标准**: 至少 2 个测试用例通过，覆盖 AC-6 和 AC-9

## Task 13: 创建 Self-Assess Prompt 模板
- **描述**: 创建 `skills/auto-dev/prompts/self-assess.md`，包含数据收集指令、分析任务、产出格式定义
- **文件**:
  - `D:\dycuui\auto-dev-plugin\skills\auto-dev\prompts\self-assess.md`
- **依赖**: 无
- **完成标准**: 文件包含 `{{project_root}}`、`{{output_dir}}` 变量占位符，产出格式为 improvement-candidates.md 表格

## Task 14: 验证 Self-Assess Prompt 可渲染
- **描述**: 编写单元测试验证 `TemplateRenderer.render()` 可正确渲染 self-assess.md（变量替换无报错）
- **文件**:
  - `D:\dycuui\auto-dev-plugin\mcp\src\__tests__\template-renderer.test.ts`（如不存在则创建）
- **依赖**: Task 13
- **完成标准**: 测试用例通过，覆盖 AC-7

## Task 15: 文档 - 更新 README 或使用说明
- **描述**: 在项目文档中说明三层 Lessons 架构、Global 层路径、Self-Assess 使用方式
- **文件**:
  - `D:\dycuui\auto-dev-plugin\README.md` 或 `D:\dycuui\auto-dev-plugin\docs\auto-dev\self-evolution\usage.md`
- **依赖**: Task 9, Task 13
- **完成标准**: 文档包含 Global 层路径说明、晋升触发时机、Self-Assess 手动触发示例
