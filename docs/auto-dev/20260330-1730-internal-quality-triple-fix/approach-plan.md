# 方案计划: internal-quality-triple-fix

## 主方案: 增量式结构化重构（推荐）

**方法**: 按 IMP-009 -> IMP-007 -> IMP-004 顺序逐个实现，每个改进项完成后运行测试验证。

- **IMP-009**: 新增 `extractTribunalCrashes()` 函数 + 扩展类型 + 加固正则 + 集成渲染。导出内部函数供测试。
- **IMP-007**: `isCheckpointDuplicate` 改用 `fs.open()` + `fh.read()` 尾部读取，保留回退逻辑。
- **IMP-004**: 抽取 `getLessonsFromPool()` 和 `addToPool()` 私有方法，增强前缀去重。

**核心工具**: TypeScript, Vitest, node:fs/promises (open/read for tail-read)
**风险**: IMP-004 重构可能引入行为差异，通过现有 490 个测试回归覆盖。

## 备选方案 A: 纯补丁式修复（不重构 LessonsManager）

**方法**: IMP-009/IMP-007 同主方案，IMP-004 仅在现有 `addToProject`/`addToCrossProject` 中内联增强去重逻辑，不抽取通用方法。

**核心工具**: 同主方案
**风险**: 低（改动最小），但代码重复问题未解决，不符合设计文档选型结论。

## 备选方案 B: 基于 Stream 的尾部读取

**方法**: IMP-007 使用 `createReadStream` + `{ start, end }` 选项代替 `fs.open()`/`fh.read()` 来实现尾部读取。

**核心工具**: node:fs createReadStream
**风险**: Stream API 需要额外的 Buffer 拼接处理，代码复杂度更高，且对于固定 4KB 的读取场景 `open()+read()` 更直接。

## 选型结论

选择主方案。备选 A 不满足设计文档要求；备选 B 技术上可行但增加了不必要的复杂度。
