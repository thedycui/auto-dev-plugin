# 设计审查报告: internal-quality-triple-fix

> 审查日期: 2026-03-30
> 审查阶段: Phase 1 (架构评审)
> 设计文档: design.md

---

## 1. 目标对齐

- [x] **问题陈述清晰**: 三个独立问题（IMP-009 正则遗漏 TRIBUNAL_CRASH、IMP-007 重复文件 I/O、IMP-004 代码重复+数据重复）描述准确，能一句话说清每个问题。
- [x] **方案解决根因**: IMP-009 修的是正则本身缺少对 TRIBUNAL_CRASH 格式的匹配（根因）；IMP-007 修的是全文读取的 I/O 模式（根因）；IMP-004 修的是 copy-paste 代码结构（根因）。
- [x] **范围合理**: Non-Goals 明确排除了 `index.ts` 调用方重构（属于 IMP-001）和静默 catch（IMP-006），避免了过度设计。
- [x] **成功标准**: AC-1 到 AC-12 共 12 条验收标准，覆盖了所有三个改进项的核心行为。

**结论**: PASS

---

## 2. 技术可行性

### 2.1 代码引用验证（grep 验证结果）

| 设计中引用 | 实际存在 | 位置 |
|-----------|---------|------|
| `extractPhaseTimings()` | 存在 | `retrospective-data.ts:61` |
| `extractSubmitRetries()` | 存在 | `retrospective-data.ts:122` |
| `countRejections()` | 存在 | `retrospective-data.ts:47` |
| `extractTddGateStats()` | 存在 | `retrospective-data.ts:210` |
| `RetrospectiveAutoData` 接口 | 存在 | `types.ts:358` |
| `isCheckpointDuplicate()` | 存在 | `state-manager.ts:509` |
| `getProjectLessons()` 行 135-170 | 存在，行号匹配 | `lessons-manager.ts:135-170` |
| `getCrossProjectLessons()` 行 285-320 | 存在，行号匹配 | `lessons-manager.ts:285-320` |
| `addToProject()` 行 188-236 | 存在，行号匹配 | `lessons-manager.ts:188-236` |
| `addToCrossProject()` 行 351-399 | 存在，行号匹配 | `lessons-manager.ts:351-399` |
| `readProjectEntries()` | 存在 | `lessons-manager.ts:247` |
| `readCrossProjectEntries()` | 存在（private） | `lessons-manager.ts:401` |
| `generateRetrospectiveData()` | 存在 | `retrospective-data.ts:20` |
| `renderRetrospectiveDataMarkdown()` | 存在 | `retrospective-data.ts:137` |
| `getGlobalLessons()` (deprecated alias) | 存在 | `lessons-manager.ts:261` |
| `injectGlobalLessons()` | 存在 | `lessons-manager.ts:347` |
| `index.ts:1248-1278` 三次 LessonsManager 构造 | 存在，行号匹配 | `index.ts:1248, 1263, 1278` |
| 去重逻辑 `addToProject` 行 192-194 | 存在，行号匹配 | `lessons-manager.ts:192` |
| `lessons-global.json` 重复 lesson (dual-file-write) | 已确认存在 | 2 条记录，前缀高度相似 |

- [x] **设计中引用的类/方法/接口在代码中真实存在**
- [x] **API 签名正确**: 设计中描述的方法参数（`filePath, limit, poolMax` 等）与现有代码的参数模式一致
- [x] **数据流可追踪**: progress-log.md -> extractXxx() -> RetrospectiveAutoData -> renderMarkdown -> retrospective-data.md，路径完整
- [x] **依赖项可用**: 仅使用 Node.js 内置模块（fs, path, crypto），无外部依赖

### 2.2 技术方案评估

**IMP-007 尾部读取**: 设计提到使用 `open()` + `read(fd, buffer, offset, length)` 读取最后 4KB。当前 `isCheckpointDuplicate` 使用的是 `readFile(path, "utf-8")`（`node:fs/promises`），切换到 `open()` + `read()` 是合理的，Node.js `fs.promises.open()` 返回 `FileHandle` 支持 `read()` 方法。

**P2**: 设计中提到"如果文件小于 4KB 回退到全文件"，建议同时考虑 4KB 截断恰好在 UTF-8 多字节字符中间的情况（如中文 summary）。实现时可以额外多读几个字节或从截断点向前查找 `<!--` 起始标记。

- [x] **无明显性能问题**

**结论**: PASS

---

## 3. 完整性

- [x] **边界情况**: 设计覆盖了空 progress-log（AC-12）、文件不存在（返回空数组/false）、文件小于 4KB 的回退。AC-3/AC-4 覆盖了特殊字符。
- [x] **错误处理**: `safeRead()` 已有 try-catch 返回空字符串；`isCheckpointDuplicate` 的文件不存在分支也已处理。
- [x] **回滚策略**: 三个改进项按 IMP-009 -> IMP-007 -> IMP-004 顺序独立提交，可逐个回滚。设计明确。
- [x] **新配置项**: 前缀去重阈值 N=60 字符在设计中有记录。无新增外部配置。

### P1: 前缀去重的边界行为未完全定义

设计 4.3.2 节说"取两者 lesson text 中较短的一条，如果较长的以较短的前 N 个字符开头"，但未定义以下边界：
1. 如果 lesson text 本身短于 60 个字符，是否直接做精确匹配（前缀匹配退化为精确匹配）？
2. 如果一条 lesson 是另一条的完整前缀（如 "Use atomic writes" vs "Use atomic writes for all file operations..."），是否应该判定为重复？

**修复建议**: 在实现计划中补充明确的算法伪代码，覆盖 `len(shorter) < N` 的情况。建议：当 shorter 长度 < N 时，仍使用前缀匹配（shorter 是 longer 的前缀则视为重复），这样可以覆盖一条是另一条完整前缀的场景。

**结论**: 边界处理基本充分，P1 项需在实现阶段明确。

---

## 4. 跨组件影响分析

### 步骤 A: 变更清单

| 变更项 | 类型 | 文件 |
|--------|------|------|
| `RetrospectiveAutoData.tribunalCrashes` | 新增 optional 字段 | `types.ts` |
| `extractTribunalCrashes()` | 新增函数 | `retrospective-data.ts` |
| `renderRetrospectiveDataMarkdown()` | 修改（新增段落） | `retrospective-data.ts` |
| `extractPhaseTimings()` 正则 | 修改 | `retrospective-data.ts` |
| `isCheckpointDuplicate()` | 修改（全文读取 -> 尾部读取） | `state-manager.ts` |
| `getLessonsFromPool()` | 新增私有方法 | `lessons-manager.ts` |
| `addToPool()` | 新增私有方法 | `lessons-manager.ts` |
| `readEntriesFrom()` | 新增私有方法 | `lessons-manager.ts` |
| `getProjectLessons()` | 修改（委托调用） | `lessons-manager.ts` |
| `getCrossProjectLessons()` | 修改（委托调用） | `lessons-manager.ts` |
| `addToProject()` | 修改（委托调用 + 增强去重） | `lessons-manager.ts` |
| `addToCrossProject()` | 修改（委托调用 + 增强去重） | `lessons-manager.ts` |
| `readProjectEntries()` | 修改（委托调用） | `lessons-manager.ts` |
| `readCrossProjectEntries()` | 修改（委托调用） | `lessons-manager.ts` |

### 步骤 B: 调用方搜索（grep 证据）

**1. `RetrospectiveAutoData` 的消费方:**
- `retrospective-data.ts`: `generateRetrospectiveData()` 构造并返回此类型，`renderRetrospectiveDataMarkdown()` 消费此类型渲染 markdown
- `tribunal.ts:194`: 调用 `generateRetrospectiveData(outputDir)` 但不使用返回值（仅触发 md 写入）
- `index.ts:1772`: 同上，调用但不使用返回值
- `tribunal.ts:87`: 读取 `retrospective-data.md` 文件内容（新增的 "Tribunal Crashes" 段落会被自动包含）
- 测试文件: `tribunal.test.ts`, `tdd-gate-integration.test.ts` 使用返回值做断言

**影响判定**: 新增 `tribunalCrashes` 字段为 optional，不影响现有消费方。`renderRetrospectiveDataMarkdown()` 需要同步修改以渲染新字段（设计已覆盖）。`tribunal.ts:87` 读取 md 内容时新段落会自然包含在读取结果中（增益，非破坏）。测试文件需要更新以覆盖新字段。

**2. `isCheckpointDuplicate()` 的调用方:**
- `index.ts:623`: `if (await sm.isCheckpointDuplicate(phase, task, status, summary))`
- `e2e-integration.test.ts:114,722`: 测试用例

**影响判定**: 方法签名不变，返回值语义不变（尾部读取与全文读取在逻辑上等价），调用方无需修改。

**3. `getProjectLessons()` / `getCrossProjectLessons()` 的调用方:**
- `index.ts:1263`: `getGlobalLessons(10)` -> 委托到 `getProjectLessons(10)`
- `index.ts:1278`: `injectGlobalLessons()` -> 委托到 `getCrossProjectLessons()`
- `lessons-manager.ts:261-262`: `getGlobalLessons()` 委托到 `getProjectLessons()`
- `lessons-manager.ts:347-348`: `injectGlobalLessons()` 委托到 `getCrossProjectLessons()`
- 多个测试文件直接调用

**影响判定**: 公共方法签名和返回类型不变，调用方无需修改。

**4. `addToProject()` / `addToCrossProject()` 的调用方:**
- `lessons-manager.ts:61`: `await this.addToProject(entry)` (来自 `add()` 方法)
- `lessons-manager.ts:177`: `await this.addToProject(ensureDefaults({ ...e, topic }))` (来自 `promoteToProject()`)
- `lessons-manager.ts:265-266`: `addToGlobal()` 委托到 `addToProject()`
- `lessons-manager.ts:340`: `await this.addToCrossProject(globalEntry)` (来自 `promoteToGlobal()`)
- 测试文件

**影响判定**: 方法签名不变，返回值不变。增强去重逻辑（前缀匹配）可能导致之前能添加成功的 lesson 被拒绝（`added: false`）。这是**预期行为**（去重增强的目的就是拒绝近似重复），但调用方 `add()` 在 line 61 标注了 "result intentionally ignored"，`promoteToProject()` 在 line 177 检查了 `result.added`。**无兼容性问题**。

### 步骤 C: 影响记录

| 调用方 | 受影响 | 需同步修改 | 设计已覆盖 |
|--------|--------|-----------|-----------|
| `renderRetrospectiveDataMarkdown()` | 是 | 是（渲染新字段） | 是（4.1.1） |
| `tribunal.ts:194` (调用 generateRetrospectiveData) | 否 | 否 | N/A |
| `index.ts:1772` (调用 generateRetrospectiveData) | 否 | 否 | N/A |
| `tribunal.ts:87` (读取 retrospective-data.md) | 正面影响 | 否 | N/A |
| `index.ts:623` (调用 isCheckpointDuplicate) | 否 | 否 | N/A |
| `add()` -> `addToProject()` | 行为微变（更严格去重） | 否 | 是（4.3.2） |
| `promoteToProject()` -> `addToProject()` | 行为微变（更严格去重） | 否 | 是（4.3.2） |
| `promoteToGlobal()` -> `addToCrossProject()` | 行为微变（更严格去重） | 否 | 是（4.3.2） |
| 现有测试文件 | 需验证通过 | 可能需更新 | 是（AC-11） |

### 步骤 D: 其他影响

- [x] **API 兼容性**: 无 breaking change。所有公共方法签名不变，新增字段为 optional。
- [x] **共享状态**: `lessons-global.json` 的读写路径不变（`~/.auto-dev/lessons-global.json`），文件格式不变。`retrospective-data.md` 输出新增段落但不影响现有段落。

**结论**: 跨组件影响分析完整，所有调用方已验证，设计已覆盖所有需要同步修改的地方。PASS

---

## 5. 代码对齐

- [x] **方法位置/行号与实际代码一致**: 所有引用的行号经 grep 验证均匹配
- [x] **类名、包名正确**: `LessonsManager`, `StateManager`, `RetrospectiveAutoData` 均存在且正确
- [x] **执行流程与代码吻合**:
  - `generateRetrospectiveData()` 确实按设计描述的流程工作：读取 progress-log -> 调用各 extract 函数 -> 构造 data -> 渲染 markdown -> 写文件
  - `isCheckpointDuplicate()` 确实是全文读取 + 正则遍历，与设计 2.2 节描述一致
  - `getProjectLessons()` 和 `getCrossProjectLessons()` 确实结构平行，差异仅在 filePath 和常量，与设计 2.3 节描述一致
  - `addToProject()` 和 `addToCrossProject()` 确实是 copy-paste，与设计描述一致

**结论**: PASS

---

## 6. 路径激活风险评估（规则 2）

| 代码路径 | 生产验证状态 | 风险 |
|---------|------------|------|
| `extractPhaseTimings()` | 已验证（每次 Phase 7 都会执行） | 低 |
| `renderRetrospectiveDataMarkdown()` | 已验证（同上） | 低 |
| `isCheckpointDuplicate()` | 已验证（每次 checkpoint 调用） | 低 |
| `getProjectLessons()` | 已验证（每次 auto_dev_next 调用） | 低 |
| `addToProject()` | 已验证（每次 lessons_add 调用） | 低 |
| `getCrossProjectLessons()` | 已验证（通过 injectGlobalLessons） | 低 |
| `addToCrossProject()` | 已验证（通过 promoteToGlobal） | 低 |

所有被修改的代码路径均已在生产中验证过，不存在"首次激活"风险。

---

## 7. 问题汇总

| 级别 | 位置 | 问题 | 修复建议 |
|------|------|------|---------|
| P1 | 4.3.2 前缀去重 | 未定义 lesson text 长度 < 60 字符时的行为 | 补充算法伪代码：当 `min(len(a), len(b)) < 60` 时，使用 shorter 全文作为前缀进行匹配 |
| P2 | 4.2.1 尾部读取 | 4KB 截断可能落在 UTF-8 多字节字符中间 | 实现时从截断点向前扫描到最近的 `<!--` 标记开始解析，或使用 `Buffer.toString("utf-8")` 自动处理不完整字符 |
| P2 | 4.1.2 正则加固 | "具体的正则实现留给实现阶段"表述模糊 | 可接受（实现阶段确定），但建议在 AC 中增加一条负面测试：summary 包含 `status=FAKE` 子串时不应被错误匹配 |

---

## 8. 总结

**结论: PASS**

设计文档质量良好。三个改进项的问题分析准确、方案选型有据、代码引用均经验证。跨组件影响分析完整，所有调用方已确认不受破坏性影响。唯一的 P1 项（前缀去重边界行为）不阻塞设计审批，但需在实现计划阶段明确算法细节。
