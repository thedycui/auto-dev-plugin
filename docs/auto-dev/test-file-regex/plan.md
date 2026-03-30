# Implementation Plan: test-file-regex

## Task 1: 完善 tdd-gate.ts 中的 TEST_PATTERNS 正则

- **描述**: 修改 `tdd-gate.ts` 第 11-16 行的 `TEST_PATTERNS` 数组，使其成为所有副本的超集。具体变更：(1) `[Tt]est` 模式扩展语言到 `java|ts|js|py|kt|go|rs`；(2) `.spec` 模式加入 `tsx|jsx`；(3) `_test` 模式加入 `rs`；(4) 新增 `test_*.py` 模式（pytest 命名）。
- **文件**: `/Users/admin/.claude/plugins/auto-dev-plugin/mcp/src/tdd-gate.ts`
- **依赖**: 无
- **完成标准**: `TEST_PATTERNS` 包含设计文档 4.1 节定义的 5 条正则，现有 `isTestFile` / `isImplFile` 函数签名不变

## Task 2: 新增 tdd-gate.test.ts 测试用例

- **描述**: 在现有 `tdd-gate.test.ts` 的 `isTestFile` 和 `isImplFile` describe 块中新增测试用例，覆盖 AC-2 到 AC-8 的全部场景：`foo.test.tsx`、`foo.spec.jsx`、`foo_test.rs`、`FooTest.kt`、`test_foo.py`、`TestDataFactory.java` false positive、`isImplFile("FooTest.java")` 返回 false。
- **文件**: `/Users/admin/.claude/plugins/auto-dev-plugin/mcp/src/__tests__/tdd-gate.test.ts`
- **依赖**: Task 1
- **完成标准**: `npx vitest run tdd-gate.test` 全部通过，新增用例至少覆盖 AC-2 ~ AC-8

## Task 3: 改造 phase-enforcer.ts 的 countTestFiles

- **描述**: (1) 在 `phase-enforcer.ts` 顶部新增 `import { isTestFile } from "./tdd-gate.js";`；(2) 将 `countTestFiles` 函数体替换为 `return diffFileNames.filter(f => isTestFile(f)).length;`，删除函数内的 `testPatterns` 局部变量。
- **文件**: `/Users/admin/.claude/plugins/auto-dev-plugin/mcp/src/phase-enforcer.ts`
- **依赖**: Task 1
- **完成标准**: `countTestFiles` 不再包含独立正则；`npx vitest run` 无 regression

## Task 4: 替换 tribunal.ts runQuickPreCheck 中的内联正则

- **描述**: (1) 在 `tribunal.ts` 顶部新增 `import { isTestFile, isImplFile } from "./tdd-gate.js";`；(2) 将 ~L454-465 的 `implPatterns`/`testPatterns` 局部变量和 filter 逻辑替换为 `isImplFile(f)` / `isTestFile(f)` 调用。
- **文件**: `/Users/admin/.claude/plugins/auto-dev-plugin/mcp/src/tribunal.ts`
- **依赖**: Task 1
- **完成标准**: `runQuickPreCheck` 方法中不存在 `implPatterns` 或 `testPatterns` 局部变量

## Task 5: 替换 tribunal.ts crossValidate 中的内联正则

- **描述**: 将 ~L671-679 的 `implPatterns`/`testPatterns` 局部变量和 filter 逻辑替换为 `isImplFile(f)` / `isTestFile(f)` 调用（复用 Task 4 新增的 import）。
- **文件**: `/Users/admin/.claude/plugins/auto-dev-plugin/mcp/src/tribunal.ts`
- **依赖**: Task 4
- **完成标准**: `crossValidate` 方法中不存在 `implPatterns` 或 `testPatterns` 局部变量

## Task 6: 替换 index.ts checkpoint 中的内联正则

- **描述**: (1) 在 `index.ts` 第 20 行的 tdd-gate import 中新增 `isImplFile`；(2) 将 ~L530-534 的 `implPatterns`/`testPatterns` 局部变量和 filter 逻辑替换为 `isImplFile(f)` 调用（`testFileCount` 已通过 `countTestFiles` 获取，无需改动）。
- **文件**: `/Users/admin/.claude/plugins/auto-dev-plugin/mcp/src/index.ts`
- **依赖**: Task 1
- **完成标准**: `index.ts` 中不存在 `implPatterns` 或 `testPatterns` 局部变量

## Task 7: 全量测试验证 + grep 确认无残留

- **描述**: (1) 运行 `npx vitest run` 确认全部测试通过；(2) 在 `mcp/src/` 下 grep `testPatterns` 和 `implPatterns`，确认仅存在于 `tdd-gate.ts` 的 `TEST_PATTERNS`（私有常量），其他文件中不存在任何独立正则副本。
- **文件**: 无新增修改
- **依赖**: Task 2, Task 3, Task 5, Task 6
- **完成标准**: 全部测试通过；grep 结果确认 `phase-enforcer.ts`、`tribunal.ts`、`index.ts` 中不存在 `testPatterns` / `implPatterns` / `TEST_PATTERNS` 变量定义
