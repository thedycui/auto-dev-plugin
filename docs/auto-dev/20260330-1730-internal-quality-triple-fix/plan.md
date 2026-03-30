# Implementation Plan: 20260330-1730-internal-quality-triple-fix

## Task 1: 扩展 RetrospectiveAutoData 类型，新增 tribunalCrashes 字段
- **描述**: 在 `types.ts` 的 `RetrospectiveAutoData` 接口中新增 `tribunalCrashes` 字段，类型为 `Array<{ phase: number; category?: string; exitCode?: string; retryable?: boolean; timestamp?: string }>`
- **文件**: `/Users/admin/dycui/auto-dev-plugin/mcp/src/types.ts`
- **依赖**: 无
- **完成标准**: TypeScript 编译通过，`RetrospectiveAutoData` 包含 `tribunalCrashes` 字段

## Task 2: 实现 extractTribunalCrashes() 函数
- **描述**: 在 `retrospective-data.ts` 中新增 `extractTribunalCrashes(progressLog: string)` 函数，解析两种 TRIBUNAL_CRASH 格式（简单格式 `<!-- TRIBUNAL_CRASH phase=N -->` 和完整格式含 category/exitCode/retryable/timestamp 属性）。返回结构化数组。
- **文件**: `/Users/admin/dycui/auto-dev-plugin/mcp/src/retrospective-data.ts`
- **依赖**: Task 1
- **完成标准**: 函数能正确解析简单格式和完整格式的 TRIBUNAL_CRASH 事件，空输入返回空数组

## Task 3: 集成 tribunalCrashes 到 generateRetrospectiveData 和 renderRetrospectiveDataMarkdown
- **描述**: 在 `generateRetrospectiveData()` 中调用 `extractTribunalCrashes()` 填充 `data.tribunalCrashes`。在 `renderRetrospectiveDataMarkdown()` 中新增 "Tribunal Crashes" 表格段落（在 Tribunal Results 之后），当存在 crash 事件时渲染表格，否则显示 "No tribunal crashes recorded."
- **文件**: `/Users/admin/dycui/auto-dev-plugin/mcp/src/retrospective-data.ts`
- **依赖**: Task 2
- **完成标准**: 生成的 markdown 包含 Tribunal Crashes 段落；无 crash 事件时显示占位文本

## Task 4: 加固 extractPhaseTimings 正则
- **描述**: 改进 `extractPhaseTimings` 中的正则表达式，使其能正确处理 CHECKPOINT 中包含 `task=N` 属性以及 summary 中含特殊字符（中文、括号、斜杠、`status=`/`timestamp=` 子串）的情况。利用属性已知顺序和 summary 的双引号边界写更精确的正则。同步加固 `extractSubmitRetries` 中的正则。
- **文件**: `/Users/admin/dycui/auto-dev-plugin/mcp/src/retrospective-data.ts`
- **依赖**: 无
- **完成标准**: 正则能正确解析包含 task 属性和特殊字符 summary 的 CHECKPOINT，不会因 summary 中含 `status=` 而误匹配

## Task 5: retrospective-data 单元测试
- **描述**: 新建 `retrospective-data.test.ts` 测试文件，覆盖以下场景：(1) extractTribunalCrashes 简单格式、完整格式、混合事件；(2) extractPhaseTimings 标准 CHECKPOINT、含 task 属性、summary 含特殊字符；(3) extractSubmitRetries 基本场景；(4) generateRetrospectiveData 输出包含 Tribunal Crashes 段落；(5) 空 progress-log 时 tribunalCrashes 返回空数组。导出需要测试的函数（或通过 generateRetrospectiveData 间接测试）。
- **文件**: `/Users/admin/dycui/auto-dev-plugin/mcp/src/__tests__/retrospective-data.test.ts`, `/Users/admin/dycui/auto-dev-plugin/mcp/src/retrospective-data.ts`（可能需要 export 内部函数供测试使用）
- **依赖**: Task 2, Task 3, Task 4
- **完成标准**: 所有新增测试用例通过，覆盖 AC-1 到 AC-5 和 AC-12

## Task 6: isCheckpointDuplicate 改为尾部读取
- **描述**: 重写 `state-manager.ts` 中的 `isCheckpointDuplicate` 方法：用 `fs.open()` + `fh.stat()` 获取文件大小，若文件大于 4096 字节则只读取最后 4096 字节（用 `fh.read(buffer, 0, 4096, fileSize - 4096)`），否则读取全文件。在读取的内容中查找最后一个 `<!-- CHECKPOINT ... -->` 并解析属性。需要从 `node:fs/promises` 引入 `open` 方法。增加回退逻辑：若尾部 4KB 未找到 CHECKPOINT，则读取全文件。
- **文件**: `/Users/admin/dycui/auto-dev-plugin/mcp/src/state-manager.ts`
- **依赖**: 无
- **完成标准**: 大文件只读取尾部 4KB，小文件行为不变，解析结果与原实现一致

## Task 7: isCheckpointDuplicate 单元测试
- **描述**: 在现有测试文件中（或新建 `state-manager-checkpoint.test.ts`）添加测试用例：(1) 大于 4KB 的 progress-log 只读取尾部（mock `fs.open`/`fh.read` 验证读取偏移量）；(2) 小于 4KB 的 progress-log 正确判断重复；(3) 文件不存在时返回 false；(4) 尾部 4KB 未找到 CHECKPOINT 时回退到全文件读取。
- **文件**: `/Users/admin/dycui/auto-dev-plugin/mcp/src/__tests__/state-manager-checkpoint.test.ts`
- **依赖**: Task 6
- **完成标准**: 所有测试通过，覆盖 AC-6 和 AC-7

## Task 8: LessonsManager 抽取 getLessonsFromPool 通用方法
- **描述**: 在 `LessonsManager` 中新增私有方法 `getLessonsFromPool(filePath: string, limit: number): Promise<LessonEntry[]>`，将 `getProjectLessons` 和 `getCrossProjectLessons` 中的共同逻辑（读取 -> lazy retirement -> filter active -> sort -> select -> update appliedCount -> write）移入此方法。`getProjectLessons` 和 `getCrossProjectLessons` 改为单行委托调用。同时合并 `readProjectEntries` 和 `readCrossProjectEntries` 为通用的 `readEntriesFrom(filePath)` 私有方法，`readProjectEntries` 保留公共方法签名但内部委托。
- **文件**: `/Users/admin/dycui/auto-dev-plugin/mcp/src/lessons-manager.ts`
- **依赖**: 无
- **完成标准**: `getProjectLessons` 和 `getCrossProjectLessons` 均委托 `getLessonsFromPool`，公共 API 签名不变，现有测试全部通过

## Task 9: LessonsManager 抽取 addToPool 通用方法并增强去重
- **描述**: 在 `LessonsManager` 中新增私有方法 `addToPool(filePath: string, entry: LessonEntry, poolMax: number): Promise<{ added: boolean; displaced?: LessonEntry }>`，将 `addToProject` 和 `addToCrossProject` 的共同逻辑（读取 -> 去重检查 -> 池满判断 -> displacement）移入此方法。`addToProject` 和 `addToCrossProject` 改为单行委托调用。去重逻辑从精确匹配增强为：精确匹配 **或** 前缀匹配（取两条 lesson text 中较短者的前 60 个字符，若较长者以此前缀开头则视为重复）。
- **文件**: `/Users/admin/dycui/auto-dev-plugin/mcp/src/lessons-manager.ts`
- **依赖**: Task 8
- **完成标准**: `addToProject` 和 `addToCrossProject` 均委托 `addToPool`，去重逻辑能识别前缀相同的 lesson，公共 API 签名不变

## Task 10: LessonsManager 去重增强单元测试
- **描述**: 在 `lessons-manager.test.ts` 中新增测试用例：(1) lesson text 前 60 字符相同的条目被视为重复，`addToProject` 返回 `{ added: false }`；(2) lesson text 前 60 字符不同的条目正常添加，返回 `{ added: true }`；(3) 精确匹配仍然生效。
- **文件**: `/Users/admin/dycui/auto-dev-plugin/mcp/src/__tests__/lessons-manager.test.ts`
- **依赖**: Task 9
- **完成标准**: 新增测试通过，覆盖 AC-9 和 AC-10

## Task 11: 全量回归测试
- **描述**: 运行 `npm test` 确认所有现有测试（490/490）加上新增测试全部通过。修复因重构引起的任何回归问题。
- **文件**: 无新增文件（修复可能涉及 Task 5-10 中的文件）
- **依赖**: Task 5, Task 7, Task 10
- **完成标准**: `npm test` 全部通过，零失败（AC-11）
