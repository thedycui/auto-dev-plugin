# Design Review（第二轮）

> 审查日期：2026-04-01
> 审查轮次：第二轮（验证第一轮修复）

## 第一轮问题修复验证

### P0-1: 删除第十二节 additionalRepos 引用

**状态：已修复**

第十二节（第 823-834 行）已不再引用 `additionalRepos`。仅文档头部更新记录中保留了"移除 additionalRepos"的变更说明，属正常的变更历史描述。

### P0-2: runAcBoundTests 改为逐条 AC 独立运行

**状态：已修复**

第 297-316 行代码已改为 `for (const binding of bindings)` 逐条运行，每次调用 `buildTargetedTestCommand(language, binding.testFile, [binding], projectRoot)`，传入单个 binding 的数组。注释明确说明"逐条 AC 独立运行测试，避免同文件多 AC 时 exitCode 误归因"。

### P1-1: testCmd 改为从 ctx.testCmd 获取

**状态：已修复**

第 679-680 行注释明确写出"testCmd 从 OrchestratorContext (ctx.testCmd) 获取"，代码使用 `ctx.testCmd`。`language` 仍从 `state.stack.language` 获取（该路径在 `StackInfoSchema` 中确实存在），两者来源正确。

### P1-4: FAIL 时仍调用 acceptance-validator Agent 分析

**状态：已修复**

第 697-714 行：当 structural 或 test-bound 有 FAIL 时，先调用 `runAcceptanceValidatorAgent(projectRoot, outputDir, topic)` 生成分析报告，再返回失败结果。feedback 中包含"详细分析见 acceptance-report.md"指引。修复了第一轮指出的第五节流程描述与 8.2 实现代码的矛盾。

### P1-5: hash 扩展为 32 字符，正则改为 [a-f0-9]+

**状态：已修复**

第 612 行 `.slice(0, 32)` 保留 128 bit hash。第 659 行正则 `([a-f0-9]+)` 正确匹配十六进制字符。

### P1-6: auto-dev 生成的设计强制要求 AC JSON

**状态：已修复**

第 625-636 行：当 `acContent` 为 null 时，检查 design.md 是否包含 AC 表格（`/\|\s*AC-\d+/`）且为 auto-dev 自生成（`!sm.designDocSource`），两者同时满足时返回 `AC_JSON_MISSING` 阻断。`sm.designDocSource` 在 `mcp/src/types.ts` 和 `mcp/src/index.ts` 中已有定义和赋值，路径正确。

## 新发现的问题

### P2 (优化建议)

1. **第 3.3 节示例格式与实现代码不一致** — 第 162 行示例写的是 `hash=sha256:xxxx`（带 `sha256:` 前缀），但第 618 行实现代码写入的是 `hash=${acHash}`（纯十六进制，无前缀），第 659 行正则也匹配纯十六进制 `([a-f0-9]+)`。代码自身是一致的，但示例会误导读者。建议将第 162 行示例改为 `hash=xxxxxxxx...`（不带 `sha256:` 前缀）。

## 第一轮遗留项状态

以下第一轮 P1/P2 项维持原判，可在实现阶段处理，不阻塞设计通过：

| 原编号 | 描述 | 状态 |
|--------|------|------|
| P1-2 | `execWithTimeout` 和 `groupBy` 工具函数不存在 | 实现阶段处理（`groupBy` 已无需，逐条运行后不再需要分组） |
| P1-3 | `config_value` 类型缺少 YAML 解析能力 | 实现阶段处理 |
| P2-1 | `cd ${projectRoot}` 路径注入风险 | 实现阶段改用 `cwd` 选项 |
| P2-2 | `test_passes` 与 Layer 2 功能重叠 | 实现阶段在 prompt 中明确边界 |
| P2-3 | `escapeRegex` 函数未定义 | 实现阶段处理 |
| P2-4 | manual 占比阈值 40% 硬编码 | 实现阶段抽为常量 |

## 结论

**PASS**

所有 P0（2 项）和关键 P1（4 项）均已在文档中正确体现修复，未引入新的矛盾或阻塞性问题。新发现的 P2 级别文档示例不一致不影响设计通过。遗留的 P1-2/P1-3 和 P2 项可在实现阶段处理。
