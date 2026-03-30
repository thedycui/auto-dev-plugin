# 设计审查报告: 统一测试文件正则检测

**Topic**: test-file-regex
**审查日期**: 2026-03-27
**审查结论**: **NEEDS_REVISION**

---

## 1. 目标对齐

- [x] 问题陈述清晰 -- 4 处重复正则、模式不一致、维护成本高，描述准确
- [x] 方案解决的是根因而非症状 -- 统一到单一真相源是正确的根因方案
- [x] 范围合理 -- 只做正则统一，不做过度设计
- [x] 有成功标准 -- AC-1 到 AC-12 覆盖全面

## 2. 技术可行性

- [x] 设计中引用的类/方法/接口在代码中真实存在（已 grep 验证）
  - `tdd-gate.ts` 的 `TEST_PATTERNS` (L11-16)、`SOURCE_EXT` (L34)、`isTestFile()` (L24)、`isImplFile()` (L39) -- 均存在，行号准确
  - `phase-enforcer.ts` 的 `countTestFiles()` (L377) 和内部 `testPatterns` (L378-384) -- 存在，行号准确
  - `tribunal.ts` 的两处 `testPatterns`/`implPatterns` (L454-459, L671-676) -- 存在，行号准确
  - `index.ts` 的 `testPatterns`/`implPatterns` (L530-531) -- 存在，行号准确
- [x] API 签名正确 -- `isTestFile(filePath: string): boolean` 和 `isImplFile(filePath: string): boolean` 签名不变
- [x] 数据流可追踪
- [x] 依赖项可用
- [x] 无明显性能问题

### P0: 新 TEST_PATTERNS 不是旧模式的超集，存在回归风险

设计 4.1 节提出的新 `TEST_PATTERNS` 第一条为:

```typescript
/[Tt]est\.(java|kt)$/,  // 只匹配 java 和 kt
```

但当前 `tdd-gate.ts` L12 的模式为:

```typescript
/[Tt]est\.(java|ts|js|py)$/,  // 匹配 java, ts, js, py
```

且 `phase-enforcer.ts` L379 和 `index.ts` L531 的模式为:

```typescript
/[Tt]est\.(java|py|ts|js|kt|go|rs)$/,  // 匹配全部 7 种语言
```

**新模式从 `[Tt]est.` 形式中移除了 `ts|js|py|go|rs`**，导致以下文件将不再被识别为测试文件:

| 文件名 | 当前是否匹配 | 新模式是否匹配 | 风险 |
|--------|------------|--------------|------|
| `TestFoo.py` | 是 (Python unittest 命名) | 否 | **回归** |
| `TestFoo.ts` | 是 | 否 | 低风险（TS 惯例是 `.test.ts`） |
| `FooTest.js` | 是 | 否 | 低风险（JS 惯例是 `.test.js`） |
| `FooTest.go` | 是 (phase-enforcer) | 否 | 低风险（Go 惯例是 `_test.go`） |
| `FooTest.rs` | 是 (phase-enforcer) | 否 | 低风险（Rust 惯例是 `_test.rs`） |

其中 `TestFoo.py` 是 Python unittest 的标准命名（`class TestFoo(unittest.TestCase)` 对应文件 `TestFoo.py`）。设计新增了 `test_foo.py`（pytest 命名）但遗漏了 `TestFoo.py`（unittest 命名）。

**修复建议**: 第一条正则应保持全语言覆盖，与 `phase-enforcer.ts` 对齐:

```typescript
/[Tt]est\.(java|ts|js|py|kt|go|rs)$/,
```

## 3. 完整性

- [x] 边界情况已覆盖 -- false positive 分析合理
- [x] 错误处理已定义 -- 不涉及错误处理变更
- [x] 回滚策略 -- git revert，合理
- [x] 新配置项已文档化 -- 无新配置项

### P2: `test_*.py` 模式的边界考量

新增的 `/(?:^|\/)test_\w+\.py$/` 使用 `\w+` 要求至少一个字符，这是合理的。但 `\w` 不匹配连字符，所以 `test/test_my-module.py` 不会被匹配。Python 文件名中使用连字符极其罕见（会导致 import 失败），所以这不是实际问题，仅记录。

## 4. 跨组件影响分析

### 步骤 A -- 变更清单

| 变更项 | 文件 | 类型 |
|--------|------|------|
| 完善 `TEST_PATTERNS` 正则 | `tdd-gate.ts` | 修改 |
| `countTestFiles` 改用 `isTestFile` | `phase-enforcer.ts` | 修改 |
| 两处内联正则替换 | `tribunal.ts` | 修改 |
| 一处内联正则替换 | `index.ts` | 修改 |

### 步骤 B -- 调用方验证（grep 验证完成）

**`isTestFile` 调用方**:
- `tdd-gate.ts` L40 (`isImplFile` 内部调用) -- 不受影响
- `tdd-gate.test.ts` L6 -- 需要新增测试用例
- `tdd-gate-integration.test.ts` L21 -- 不受影响
- 改造后新增: `phase-enforcer.ts`、`tribunal.ts`、`index.ts`

**`isImplFile` 调用方**:
- `tdd-gate.test.ts` L6 -- 现有测试
- `tdd-gate-integration.test.ts` L21 -- 现有测试
- 改造后新增: `tribunal.ts`、`index.ts`

**`countTestFiles` 调用方**:
- `index.ts` L19（import）、L528（调用）-- 行为变化: 不再将 `tests/utils.py` 类文件计入，是行为改进

### 步骤 C -- 影响表格

| 调用方 | 影响 | 风险等级 | 说明 |
|--------|------|---------|------|
| `index.ts` checkpoint Phase 5 | `implFileCount` 计算更精确 | 低 | 正面变化 |
| `tribunal.ts` runQuickPreCheck | `implCount`/`testCount` 覆盖更多语言 | 低 | 正面变化 |
| `tribunal.ts` crossValidate | 同上 | 低 | 正面变化 |
| `phase-enforcer.ts` countTestFiles | 移除 `tests?/` 目录匹配 | 中 | 行为变化，但是改进 |

### 步骤 D -- 其他影响

**P1: `index.ts` 当前未 import `isTestFile`/`isImplFile`**

当前 `index.ts` L20 的 import 为:
```typescript
import { validateRedPhase, buildTestCommand, TDD_TIMEOUTS } from "./tdd-gate.js";
```

设计 4.4 节提到"需确认，如未引入则添加"。已确认: **需要添加 `isImplFile` 到 import**。

`tribunal.ts` 当前也未 import `tdd-gate.ts` 的任何内容，设计 4.3 节正确标注了需要新增 import。

两处 import 变更不构成循环依赖风险（已验证 `tdd-gate.ts` 不 import `phase-enforcer.ts` 或 `tribunal.ts`）。

**路径激活风险评估（规则 2）**:

所有被替换的代码路径（`tribunal.ts` 的 `runQuickPreCheck` 和 `crossValidate`、`index.ts` 的 checkpoint Phase 5、`phase-enforcer.ts` 的 `countTestFiles`）**均为生产在用的已验证路径**。此次改动是将内联正则替换为函数调用，不激活任何新路径。风险可控。

## 5. 代码对齐

- [x] 设计中的方法位置/行号与实际代码一致（全部 6 处行号已逐一验证）
- [x] 类名、文件名存在且正确
- [x] 模块关系图与实际 import 一致

---

## 问题汇总

| 级别 | 问题 | 修复建议 |
|------|------|---------|
| **P0** | 设计 4.1 节 `TEST_PATTERNS` 第一条 `/[Tt]est\.(java\|kt)$/` 遗漏了 `ts\|js\|py\|go\|rs`，导致 `TestFoo.py` 等文件无法匹配，是相对于当前行为和 `phase-enforcer.ts` 模式的回归 | 改为 `/[Tt]est\.(java\|ts\|js\|py\|kt\|go\|rs)$/`，保持全语言覆盖 |
| **P1** | `index.ts` 和 `tribunal.ts` 的 import 变更需要在设计中明确列出（当前只在正文中提及"需确认"），实现计划应将其作为显式步骤 | 在 4.3 和 4.4 节明确标注当前 import 状态和需要添加的具体 import 语句 |
| P2 | `test_*.py` 中 `\w+` 不匹配连字符文件名 | 无需修复，仅记录 |

## 结论

**NEEDS_REVISION**

P0 问题必须修复后方可进入实现阶段。新 `TEST_PATTERNS` 第一条正则意外缩小了匹配范围，与设计目标"合并后的正则是所有副本的超集"（风险表第一行）直接矛盾。修复方式简单明确：恢复全语言后缀列表。
