# 设计文档: 统一测试文件正则检测，消除重复副本

## 1. 背景与目标

### 背景

测试文件/实现文件的检测逻辑散布在 4 个源文件中，各维护独立的正则列表。模式不完全一致，导致：

- **行为不一致**: `tribunal.ts` 的 `testPatterns` 缺少 `tsx/jsx` 和 `_test.go/py`，会漏判前端测试文件和 Go/Python 下划线命名测试文件。
- **误判 (false positive)**: `isTestFile("src/main/java/TestDataFactory.java")` 存在误判风险（需实测确认具体触发条件）。
- **维护成本高**: 每次新增语言支持（如 Rust, Kotlin），需要同步修改 4-5 处正则，容易遗漏。

### 目标

1. 将测试文件检测正则统一到 `tdd-gate.ts` 的 `isTestFile()` 函数，消除所有重复副本。
2. 将实现文件检测正则统一到 `tdd-gate.ts` 的 `isImplFile()` 函数，消除 `implPatterns` 的重复。
3. 修复 `TestDataFactory.java` 类 false positive 问题。
4. 将 `countTestFiles()` 改为基于 `isTestFile()` 实现，消除 `phase-enforcer.ts` 中的独立正则。

### Non-Goals

- 不改变 `tdd-gate.ts` 的模块定位和导出接口（`isTestFile`、`isImplFile` 签名不变）。
- 不引入配置化的正则（当前硬编码即可，YAGNI）。
- 不改变各调用方的业务逻辑，只替换文件分类的实现来源。

## 2. 现状分析

### 2.1 重复副本清单

| 位置 | 变量名 | 用途 | 覆盖语言 | 差异 |
|------|--------|------|----------|------|
| `tdd-gate.ts:11-16` | `TEST_PATTERNS` | `isTestFile()` | java/ts/js/py/go | 缺 kt/go/rs 在 `[Tt]est` 模式；`.spec` 缺 tsx/jsx |
| `phase-enforcer.ts:378-384` | `testPatterns` | `countTestFiles()` | java/py/ts/js/kt/go/rs | 多了 `tests?/` 目录匹配；最全 |
| `tribunal.ts:455-459` | `testPatterns` | `runQuickPreCheck()` Phase 5 | java/ts/js/py | 最简版，缺 tsx/jsx、缺 _test.go/py |
| `tribunal.ts:672-676` | `testPatterns` | `crossValidate()` Phase 5 | 同上 | 与 455 行完全重复 |
| `index.ts:531` | `testPatterns` | checkpoint Phase 5 | java/py/ts/js/kt/go/rs | 内联单行，和 phase-enforcer 一致 |

`implPatterns` 重复：

| 位置 | 覆盖语言 |
|------|----------|
| `tribunal.ts:454` | java/ts/js/py（缺 go/rs/kt）|
| `tribunal.ts:671` | 同上 |
| `index.ts:530` | java/ts/js/py/go/rs/kt（最全）|
| `tdd-gate.ts:34` (`SOURCE_EXT`) | java/ts/js/py/go/rs/kt（最全）|

### 2.2 False Positive 分析

当前 `TEST_PATTERNS` 第一条: `/[Tt]est\.(java|ts|js|py)$/`

这会匹配任何以 `Test.java` 结尾的文件名。对于 `TestDataFactory.java`，该正则 **不匹配**（以 `Factory.java` 结尾）。但 `phase-enforcer.ts:383` 的 `/tests?\//i` 目录匹配可能在特定路径下误判。

统一正则后，`tests?/` 目录匹配将从 `TEST_PATTERNS` 中移除（已有 `TEST_RESOURCE_DIR` 专门处理测试资源文件），从根源上消除此类风险。

### 2.3 模块关系

```
index.ts ──imports──> phase-enforcer.ts (countTestFiles)
                      tdd-gate.ts (isTestFile, isImplFile)
tribunal.ts ──imports──> phase-enforcer.ts (countTestFiles)
```

`tdd-gate.ts` 已经是文件分类的"权威来源"，但 `phase-enforcer.ts` 和 `tribunal.ts` 没有复用它。

## 3. 方案设计

### 方案 A: 统一到 tdd-gate.ts，各调用方改为 import

**思路**: 完善 `tdd-gate.ts` 中的 `TEST_PATTERNS` 和 `SOURCE_EXT`，让 `isTestFile()` 和 `isImplFile()` 成为唯一真相源。`countTestFiles()` 改为调用 `isTestFile()`。`tribunal.ts` 和 `index.ts` 中的内联正则全部删除，改为 import `isTestFile` / `isImplFile`。

**改动范围**:
- `tdd-gate.ts`: 完善 `TEST_PATTERNS`（加 kt/go/rs、tsx/jsx），修复 false positive
- `phase-enforcer.ts`: `countTestFiles()` 改为 `return diffFileNames.filter(isTestFile).length`
- `tribunal.ts`: 两处内联正则替换为 `isTestFile()` / `isImplFile()` 调用
- `index.ts`: 一处内联正则替换为 `isImplFile()` 调用

**优点**:
- 改动最小（约 30 行），风险可控
- 保持现有模块边界不变
- `tdd-gate.ts` 已有完善的单元测试

**缺点**:
- `phase-enforcer.ts` 新增对 `tdd-gate.ts` 的依赖（但 `index.ts` 已经同时依赖两者，不构成循环）

### 方案 B: 抽取独立 file-classifier.ts 模块

**思路**: 创建新模块 `file-classifier.ts`，将所有文件分类逻辑集中于此（`isTestFile`、`isImplFile`、`countTestFiles`、`isTestResource` 等）。`tdd-gate.ts` 和 `phase-enforcer.ts` 都从新模块 import。

**改动范围**:
- 新增 `file-classifier.ts`
- `tdd-gate.ts`: 删除分类相关代码，改为 re-export from `file-classifier.ts`
- `phase-enforcer.ts`: `countTestFiles()` 改为 import from `file-classifier.ts`
- `tribunal.ts` / `index.ts`: 同方案 A

**优点**:
- 职责更清晰（`tdd-gate.ts` 专注 TDD 验证，文件分类独立）

**缺点**:
- 改动更大（约 50 行 + 新文件），需要更新 import 路径
- `tdd-gate.ts` 已有的测试需要调整 import 或增加 re-export
- 增加了一个模块，但 `file-classifier.ts` 本身代码量很小（< 30 行），为此单独建模块属于过度设计

### 方案对比

| 维度 | 方案 A（统一到 tdd-gate） | 方案 B（独立 file-classifier） |
|------|--------------------------|------------------------------|
| 改动行数 | ~30 行 | ~50 行 + 新文件 |
| 新增模块 | 0 | 1 |
| 依赖关系变化 | phase-enforcer 新增 import tdd-gate | 所有模块改 import |
| 测试影响 | 现有测试不变 | 需调整 import 或加 re-export |
| 循环依赖风险 | 无（已验证） | 无 |
| 后续扩展性 | 足够（直接加正则） | 略好（但 YAGNI） |

### 选型结论: 方案 A

理由：`tdd-gate.ts` 本身就定位为"文件分类 + TDD 验证"模块，`isTestFile` 和 `isImplFile` 天然属于它。改动最小、测试不变、无新模块。方案 B 在当前规模下属于过度设计。

## 4. 详细设计

### 4.1 统一后的 tdd-gate.ts 正则

```typescript
// --- 测试文件名模式 ---
const TEST_PATTERNS = [
  /[Tt]est\.(java|ts|js|py|kt|go|rs)$/,              // FooTest.java, TestFoo.py, FooTest.kt
  /\.test\.(ts|js|tsx|jsx)$/,          // foo.test.ts, foo.test.tsx
  /\.spec\.(ts|js|tsx|jsx)$/,          // foo.spec.ts, foo.spec.jsx
  /_test\.(go|py|rs)$/,                // foo_test.go, foo_test.py, foo_test.rs
  /(?:^|\/)test_\w+\.py$/,             // test_foo.py (Python pytest 命名)
];
```

变更点：
1. `.spec` 模式加入 `tsx|jsx`（对齐 phase-enforcer）
2. `_test` 模式加入 `rs`（Rust 支持，对齐 phase-enforcer）
3. `[Tt]est` 模式加入 `kt/go/rs`（Kotlin/Go/Rust 支持，对齐 phase-enforcer，确保超集）
4. 新增 `test_*.py` 模式（pytest 标准命名，之前全部副本都缺失）
5. **不** 将 `tests?/` 目录匹配放入 `TEST_PATTERNS` -- 它已经在 `TEST_RESOURCE_DIR` 中处理测试资源文件

`TEST_RESOURCE_EXT`、`TEST_RESOURCE_DIR`、`SOURCE_EXT` 保持不变。

### 4.2 countTestFiles 改造（phase-enforcer.ts）

```typescript
import { isTestFile } from "./tdd-gate.js";

export function countTestFiles(diffFileNames: string[]): number {
  return diffFileNames.filter(f => isTestFile(f)).length;
}
```

删除原函数体中的 `testPatterns` 局部变量。

**行为变化**: 原 `countTestFiles` 包含 `/tests?\//i` 目录匹配，会把 `tests/utils.py` 这类非测试文件也计入。改造后依赖 `isTestFile()` 的精确匹配。这是行为改进，不是 regression。

### 4.3 tribunal.ts 内联正则替换

**位置 1 (runQuickPreCheck, ~L454-465)**:

```typescript
// Before:
const implPatterns = [/\.java$/, /\.ts$/, /\.js$/, /\.py$/];
const testPatterns = [
  /[Tt]est\.(java|ts|js|py)$/,
  /\.test\.(ts|js)$/,
  /\.spec\.(ts|js)$/,
];
const implCount = files.filter(
  (f) => implPatterns.some((p) => p.test(f)) && !testPatterns.some((p) => p.test(f)),
).length;
const testCount = files.filter(
  (f) => testPatterns.some((p) => p.test(f)),
).length;

// After:
const implCount = files.filter(f => isImplFile(f)).length;
const testCount = files.filter(f => isTestFile(f)).length;
```

**位置 2 (crossValidate, ~L671-679)**: 同样替换。

新增 import: `import { isTestFile, isImplFile } from "./tdd-gate.js";`

### 4.4 index.ts 内联正则替换

**位置 (~L530-534)**:

```typescript
// Before:
const implPatterns = [/\.java$/, /\.ts$/, /\.js$/, /\.py$/, /\.go$/, /\.rs$/, /\.kt$/];
const testPatterns = [/[Tt]est\.(java|py|ts|js|kt|go|rs)$/, ...];
implFileCount = newFiles.filter(f =>
  implPatterns.some(p => p.test(f)) && !testPatterns.some(p => p.test(f))
).length;

// After:
implFileCount = newFiles.filter(f => isImplFile(f)).length;
```

`index.ts` 当前已 import `isTestFile`，需新增 `isImplFile` 到同一 import 语句。`tribunal.ts` 当前未 import `tdd-gate.ts`，需新增 `import { isTestFile, isImplFile } from "./tdd-gate.js";`。

## 5. 影响分析

### 5.1 改动范围

| 文件 | 改动类型 | 改动行数（估算） |
|------|---------|----------------|
| `tdd-gate.ts` | 修改 `TEST_PATTERNS` 正则 | ~5 行 |
| `phase-enforcer.ts` | `countTestFiles` 改为调用 `isTestFile`，新增 import | ~5 行 |
| `tribunal.ts` | 两处内联正则替换为函数调用，新增 import | ~15 行 |
| `index.ts` | 一处内联正则替换，移除冗余变量 | ~5 行 |
| `tdd-gate.test.ts` | 新增测试用例（新语言、false positive） | ~15 行 |
| **合计** | | **~45 行** |

### 5.2 兼容性

- `isTestFile` / `isImplFile` 函数签名不变，对外 API 无 breaking change。
- `countTestFiles` 函数签名不变，但行为略有变化（不再将 `tests/` 目录下的非测试源码文件计入）。
- 新增 `test_*.py` 和 `_test.rs` 模式是扩展，不影响原有匹配。

### 5.3 迁移路径

无需迁移。所有改动都是内部重构，不涉及外部接口、数据格式或状态变更。

### 5.4 回滚方案

标准 git revert 即可。改动不涉及持久化状态。

## 6. 风险与缓解

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| 正则合并后漏匹配某种测试文件 | 低 | 中（tribunal 误判） | 合并后的正则是所有副本的超集，不会漏匹配；新增测试用例覆盖所有语言 |
| `countTestFiles` 行为变化导致 Phase 5 验证更严格 | 中 | 低（更准确是好事） | 原 `tests?/` 目录匹配会把非测试文件计入，移除后更精确 |
| `phase-enforcer.ts` 新增对 `tdd-gate.ts` 的依赖引入循环 | 无 | - | 已验证: `tdd-gate.ts` 不 import `phase-enforcer.ts`，无循环 |

## 7. 验收标准

| AC | 描述 | 验证方式 |
|----|------|---------|
| AC-1 | `tdd-gate.ts` 中的 `TEST_PATTERNS` 是唯一的测试文件正则定义，`phase-enforcer.ts`、`tribunal.ts`、`index.ts` 中不存在任何独立的 `testPatterns` / `implPatterns` 正则数组 | 代码审查 + grep 验证 |
| AC-2 | `isTestFile("foo.test.tsx")` 返回 true（tsx 支持） | 单元测试 |
| AC-3 | `isTestFile("foo.spec.jsx")` 返回 true（jsx 支持） | 单元测试 |
| AC-4 | `isTestFile("foo_test.rs")` 返回 true（Rust 支持） | 单元测试 |
| AC-5 | `isTestFile("FooTest.kt")` 返回 true（Kotlin 支持） | 单元测试 |
| AC-6 | `isTestFile("test_foo.py")` 返回 true（pytest 命名） | 单元测试 |
| AC-7 | `isTestFile("src/main/java/TestDataFactory.java")` 返回 false（非测试文件不误判） | 单元测试 |
| AC-8 | `isImplFile("src/main/java/Foo.java")` 返回 true，`isImplFile("FooTest.java")` 返回 false | 单元测试 |
| AC-9 | `countTestFiles(["foo.test.tsx", "bar.ts"])` 返回 1（通过 `isTestFile` 实现） | 单元测试 |
| AC-10 | `tribunal.ts` 中 `runQuickPreCheck` 和 `crossValidate` 使用 `isTestFile`/`isImplFile` 而非内联正则 | 代码审查 |
| AC-11 | `index.ts` checkpoint Phase 5 逻辑使用 `isImplFile` 而非内联正则 | 代码审查 |
| AC-12 | 现有 `tdd-gate.test.ts` 和 `tdd-gate-integration.test.ts` 全部通过（无 regression） | 运行 `npx vitest run` |
