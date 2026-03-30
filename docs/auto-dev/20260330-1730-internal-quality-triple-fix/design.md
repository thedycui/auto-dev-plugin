# 设计文档: internal-quality-triple-fix

> Topic: 20260330-1730-internal-quality-triple-fix
> 日期: 2026-03-30
> 状态: DRAFT

## 1. 背景与目标

### 背景

auto-dev MCP 框架在多轮自举迭代中积累了三类内部质量问题：

1. **IMP-009 (P0)**: `retrospective-data.ts` 的正则仅匹配 `CHECKPOINT` 格式的事件，但 IMP-002 引入的 `TRIBUNAL_CRASH` 事件使用了不同的 HTML 注释格式（`<!-- TRIBUNAL_CRASH phase=N ... -->`），导致 Phase 7 回顾数据中完全缺失 tribunal 崩溃统计。此外，checkpoint 正则虽然当前可以匹配已有的 CHECKPOINT 格式，但缺乏对边界情况（summary 含双引号、极长 summary）的健壮性测试。

2. **IMP-007 (P1)**: `lessons-manager.ts` 中 `index.ts:1248-1278` 的调用链在同一次请求中构造了两个 `LessonsManager` 实例并串行调用 `get()`、`getGlobalLessons()`、`injectGlobalLessons()`，其中 `getGlobalLessons()` 和 `injectGlobalLessons()` 内部都会读取并回写 JSON 文件。`state-manager.ts:isCheckpointDuplicate()` 每次调用都完整读取 progress-log.md 并遍历所有 CHECKPOINT 行，对于长期运行的 session（progress-log 可能达到数百行）存在不必要的 I/O 开销。

3. **IMP-004 (P1)**: `lessons-manager.ts` 中 `getProjectLessons()`（行 135-170）与 `getCrossProjectLessons()`（行 285-320）逻辑几乎完全相同（retirement pass + filter + sort + select + update appliedCount + write），仅文件路径和池大小常量不同。`addToProject()`（行 188-236）与 `addToCrossProject()`（行 351-399）同样是 copy-paste。数据层面，`lessons-global.json` 中存在 1 组确认重复的 lesson（dual-file-write 相关，2 条）。

### 目标

- 修复 P0 bug：`retrospective-data.ts` 能正确解析 progress-log 中的所有事件类型（CHECKPOINT + TRIBUNAL_CRASH）
- 优化文件读取：减少不必要的重复 I/O，`isCheckpointDuplicate` 只读取文件尾部
- 消除代码重复：`LessonsManager` 中 Project 和 CrossProject 层合并为通用函数
- 添加 lesson 数据去重检查

### Non-Goals

- 不改变 checkpoint 或 TRIBUNAL_CRASH 的写入格式（向后兼容）
- 不引入外部缓存库（如 lru-cache），使用内置 Map 即可
- 不做 `index.ts` 中调用方的重构（调用方逻辑属于 IMP-001 God Function 拆分的范围）
- 不修复 IMP-006 中涉及的静默 catch 问题（属于独立改进项）

## 2. 现状分析

### 2.1 retrospective-data.ts 事件解析

当前文件有 4 个提取函数，全部基于 `<!-- CHECKPOINT ...-->` 格式的正则：

| 函数 | 正则 | 提取内容 |
|------|------|---------|
| `countRejections` | `/REJECTED\|BLOCKED\|被拒绝/g` | 拒绝次数 |
| `extractPhaseTimings` | `/<!-- CHECKPOINT phase=(\d+).*?status=(\S+).*?timestamp=(\S+)\s*-->/g` | 阶段耗时 |
| `extractSubmitRetries` | `/<!-- CHECKPOINT phase=(\d+).*?status=PASS/g` | 重试次数 |
| `extractTddGateStats` | `/TDD_RED_REJECTED\|auto_dev_task_red.*REJECTED/g` | TDD 统计 |

**问题 1**: 无任何代码解析 `TRIBUNAL_CRASH` 事件，这意味着 tribunal 崩溃的次数、错误分类、可重试性等信息在回顾中完全缺失。

**问题 2**: `extractPhaseTimings` 的正则 `.*?status=(\S+).*?timestamp=(\S+)\s*-->` 虽然当前能匹配所有已知 checkpoint，但如果 summary 中包含 `status=` 或 `timestamp=` 子串（理论上可能），非贪婪匹配会提前终止导致错误捕获。

### 2.2 state-manager.ts 文件读取

`isCheckpointDuplicate()` 的工作流：
1. `readFile(progressLogPath, "utf-8")` -- 完整读取
2. 用正则 `/<!-- CHECKPOINT (.+?) -->/g` 遍历全文找到最后一个匹配
3. 解析最后一个 CHECKPOINT 的属性，比较是否与参数相同

对于 30+ checkpoint 的 session，每次 checkpoint 调用都要读取和遍历整个文件。

### 2.3 lessons-manager.ts 代码重复

两对函数的结构完全平行：

| Project 层 | CrossProject 层 | 差异点 |
|------------|-----------------|--------|
| `getProjectLessons(limit)` | `getCrossProjectLessons(limit)` | 文件路径、默认 limit 常量 |
| `addToProject(entry)` | `addToCrossProject(entry)` | 文件路径、池大小常量 |
| `readProjectEntries()` | `readCrossProjectEntries()` | 文件路径 |
| `projectFilePath()` | `crossProjectFilePath()` | 路径计算方式 |

总计约 120 行近乎相同的代码。

### 2.4 lessons-global.json 数据重复

确认存在 1 组重复 lesson（2 条），lesson text 前 40 字符完全相同：
- `[5502ccea-36a]` "For dual-file write operations (local + global), use independent writeAtomic cal..."
- `[ff943cde-388]` "For dual-file write operations (local + global), use independent writeAtomic + ..."

现有去重逻辑（`addToProject` 行 192-194）仅做精确匹配（`e.lesson === entry.lesson`），无法检测这类语义相似但文本略有差异的重复。

## 3. 方案设计

### 方案 A: 最小修复（针对性补丁）

**思路**: 在现有代码结构上做最小改动，不改变函数签名和模块结构。

1. **IMP-009**: 在 `RetrospectiveAutoData` 类型中新增 `tribunalCrashes` 字段，在 `generateRetrospectiveData` 中新增 `extractTribunalCrashes()` 提取函数，渲染到 markdown 中。同时加固 `extractPhaseTimings` 正则使其对 summary 中的特殊内容更健壮。
2. **IMP-007**: `isCheckpointDuplicate` 改为只读取文件最后 4KB（`read(fd, buffer, fileSize - 4096, 4096)`），在 4KB 中查找最后一个 CHECKPOINT。不引入缓存。
3. **IMP-004**: 不重构函数结构，仅在 `addToProject` 和 `addToCrossProject` 中增强去重逻辑（前缀匹配 + Jaccard 相似度阈值）。

| 维度 | 评分 |
|------|------|
| 改动量 | 小（约 80 行新增，20 行修改） |
| 风险 | 低（不改变公共 API） |
| 代码质量提升 | 中等（重复代码仍然存在） |
| 可维护性 | 未改善（下次新增层级仍需 copy-paste） |

### 方案 B: 结构化重构（推荐）

**思路**: 在修复 bug 的同时消除代码重复，为后续扩展打好基础。

1. **IMP-009**: 同方案 A，新增 `extractTribunalCrashes()` 函数和类型字段。加固正则。
2. **IMP-007**: `isCheckpointDuplicate` 改为尾部读取（只读最后 N 字节）。不引入全局缓存，因为 MCP 工具调用是无状态的（每次调用重新构造 StateManager），缓存生命周期极短，收益不大。
3. **IMP-004**: 抽取 `getLessonsFromPool(filePath, limit, poolMax)` 和 `addToPool(filePath, entry, poolMax)` 两个通用私有方法。`getProjectLessons` / `getCrossProjectLessons` 和 `addToProject` / `addToCrossProject` 变成单行委托调用。同时增强去重逻辑。

| 维度 | 评分 |
|------|------|
| 改动量 | 中等（约 120 行新增/修改，但净减少约 60 行） |
| 风险 | 低-中（重构有回归风险，但函数行为不变，可通过现有测试覆盖） |
| 代码质量提升 | 高（消除 120 行重复） |
| 可维护性 | 显著改善（新增层级只需一行调用） |

### 方案对比

| 对比维度 | 方案 A（最小修复） | 方案 B（结构化重构） |
|---------|-------------------|---------------------|
| 净改动行数 | +80 行 | +120/-60 = 净+60 行 |
| IMP-009 修复效果 | 完整 | 完整 |
| IMP-007 优化效果 | 完整 | 完整 |
| IMP-004 消除重复 | 不消除 | 完全消除 |
| 回归风险 | 极低 | 低（现有测试 490/490 覆盖） |
| 后续维护成本 | 高（重复代码持续存在） | 低 |

### 选型结论

**选择方案 B**。理由：
1. IMP-009 和 IMP-007 两个方案实现方式一致，区别仅在 IMP-004
2. IMP-004 的重构是纯内部重构（私有方法抽取），公共 API 不变，现有 `lessons-manager.test.ts` 可完整覆盖回归
3. 代码重复是改进候选列表中明确要求消除的问题，方案 A 不解决此问题属于不完整交付

## 4. 详细设计

### 4.1 IMP-009: Retrospective-data 正则修复

#### 4.1.1 新增 TRIBUNAL_CRASH 解析

在 `types.ts` 的 `RetrospectiveAutoData` 接口中新增字段：

```
tribunalCrashes: Array<{
  phase: number;
  category?: string;
  exitCode?: string;
  retryable?: boolean;
  timestamp?: string;
}>
```

新增 `extractTribunalCrashes(progressLog: string)` 函数，解析两种 TRIBUNAL_CRASH 格式：
- 简单格式：`<!-- TRIBUNAL_CRASH phase=N -->`
- 完整格式：`<!-- TRIBUNAL_CRASH phase=N category="..." exitCode="..." retryable="..." timestamp="..." -->`

在 `renderRetrospectiveDataMarkdown()` 中新增 "Tribunal Crashes" 表格段落。

#### 4.1.2 加固 extractPhaseTimings 正则

当前正则：`/<!-- CHECKPOINT phase=(\d+).*?status=(\S+).*?timestamp=(\S+)\s*-->/g`

问题：`.*?` 非贪婪匹配在 summary 包含 `status=` 字符串时可能提前匹配到错误位置。

改进方向：利用属性的已知顺序（phase -> task? -> status -> summary? -> timestamp）和 summary 的双引号边界来写更精确的正则。具体的正则实现留给实现阶段根据实际的 checkpoint 格式确定。

#### 4.1.3 单元测试

为 `extractPhaseTimings`、`extractSubmitRetries`、`extractTribunalCrashes` 分别添加测试用例，覆盖：
- 标准 CHECKPOINT（有/无 task、有/无 summary）
- summary 包含特殊字符（双引号、中文、括号）
- TRIBUNAL_CRASH 简单格式和完整格式
- 空 progress-log
- 混合事件的 progress-log

### 4.2 IMP-007: State Manager 文件读取优化

#### 4.2.1 isCheckpointDuplicate 尾部读取

将 `isCheckpointDuplicate` 从"读取全文件 + 正则遍历"改为"只读文件尾部 N 字节"。

实现策略：
1. 用 `stat()` 获取文件大小
2. 用 `open()` + `read(fd, buffer, offset, length)` 只读取最后 4KB（足够包含最后一个 CHECKPOINT，即使 summary 很长）
3. 在 4KB 内容中查找最后一个 `<!-- CHECKPOINT ... -->` 并解析

边界处理：如果文件小于 4KB，回退到读取全文件。

#### 4.2.2 关于缓存的决策

**不引入文件读取缓存**。理由：
- MCP 工具调用模型是无状态的：每次 `auto_dev_next` / `auto_dev_checkpoint` 调用都是独立的，`StateManager` 在每次调用中重新构造
- 缓存需要跨调用共享（模块级 Map），但 MCP Server 是长驻进程，缓存失效（mtime 检查）本身也需要 `stat()` 调用
- `index.ts:1248-1278` 中的串行调用问题本质是调用方重复构造 `LessonsManager`，这属于 IMP-001（God Function 拆分）的范围
- 引入模块级缓存会增加状态管理复杂度，与 YAGNI 原则冲突

### 4.3 IMP-004: Lessons Manager 去重

#### 4.3.1 代码去重：抽取通用方法

抽取两个私有通用方法：

**`getLessonsFromPool(filePath, limit, poolMax?)`**:
- 读取 JSON 文件 -> lazy retirement pass -> filter active -> sort by decayed score -> select top N -> update appliedCount/lastAppliedAt -> write back
- `getProjectLessons()` 和 `getCrossProjectLessons()` 委托调用此方法，只传不同的 filePath 和 limit

**`addToPool(filePath, entry, poolMax)`**:
- 读取 JSON -> dedup check -> 若池未满直接 push，若池满则 displacement 逻辑 -> write back
- `addToProject()` 和 `addToCrossProject()` 委托调用此方法

同时将 `readProjectEntries()` 和 `readCrossProjectEntries()` 合并为 `readEntriesFrom(filePath)` 一个通用读取方法（`readProjectEntries()` 保留为公共方法，内部委托）。

#### 4.3.2 数据去重：增强去重检查

当前去重逻辑：精确匹配 `e.lesson === entry.lesson`。

增强为：精确匹配 **或** 前缀匹配（取两者 lesson text 中较短的一条，如果较长的以较短的前 N 个字符开头，则视为重复）。阈值 N 建议为 60 个字符。

不引入复杂的相似度算法（如 Jaccard、编辑距离），因为：
- lesson 数据量很小（<50 条），误报的成本远高于漏报
- 前缀匹配足以覆盖当前已知的重复模式（dual-file-write 的 2 条）
- 更复杂的算法需要引入外部依赖或大量代码

#### 4.3.3 向后兼容

- `getProjectLessons()` / `getCrossProjectLessons()` / `addToProject()` / `addToCrossProject()` 的公共方法签名和返回类型不变
- `readProjectEntries()` 保持为公共方法
- 已废弃的别名方法（`getGlobalLessons` 等）继续保留

## 5. 影响分析

### 改动范围

| 文件 | 改动类型 | 改动量 |
|------|---------|--------|
| `mcp/src/retrospective-data.ts` | 新增函数 + 加固正则 | +40 行 |
| `mcp/src/types.ts` | 扩展 `RetrospectiveAutoData` 类型 | +5 行 |
| `mcp/src/state-manager.ts` | 重写 `isCheckpointDuplicate` | ~30 行改动 |
| `mcp/src/lessons-manager.ts` | 抽取通用方法 + 增强去重 | ~80 行改动，净减少约 60 行 |
| `mcp/src/__tests__/` 新增测试文件 | IMP-009 测试 | +60 行 |
| `mcp/src/__tests__/lessons-manager.test.ts` | 补充去重测试 | +20 行 |

### 兼容性

- **公共 API**: 不变。所有改动均为内部实现重构或新增字段（新增字段为 optional）
- **数据格式**: `retrospective-data.md` 输出新增 "Tribunal Crashes" 段落，不影响现有段落
- **state.json**: 不变
- **progress-log.md**: 只读不写，不影响格式

### 迁移路径

无需迁移。所有改动向后兼容：
- 旧版 progress-log（没有 TRIBUNAL_CRASH 事件）仍然可以正常解析，`tribunalCrashes` 返回空数组
- `isCheckpointDuplicate` 的尾部读取行为与全文读取在逻辑上等价
- `getLessonsFromPool` 是纯内部重构，外部行为不变

### 回滚方案

三个改进项相互独立，可以分别回滚：
- IMP-009: 回退 `retrospective-data.ts` 和 `types.ts` 的改动
- IMP-007: 回退 `state-manager.ts` 的 `isCheckpointDuplicate` 方法
- IMP-004: 回退 `lessons-manager.ts`（通用方法拆回 copy-paste 版本）

建议实现时按 IMP-009 -> IMP-007 -> IMP-004 顺序提交，每个改进项一个 commit，方便逐个回滚。

## 6. 风险与缓解

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|---------|
| IMP-009 新正则未覆盖未来新增的事件格式 | 中 | 低（同类 bug 再次出现） | 在正则旁添加注释说明已知事件格式，新增事件时需同步更新 |
| IMP-007 尾部读取的 4KB 不足以包含最后一个 CHECKPOINT | 低 | 低（回退到全文读取） | 实现时加上回退逻辑：若 4KB 内未找到 CHECKPOINT，则读取全文件 |
| IMP-004 通用方法重构引入行为差异 | 低 | 中 | 现有 `lessons-manager.test.ts` 有完整的 scoring/eviction/feedback 测试覆盖，重构后所有测试必须通过 |
| IMP-004 前缀去重误判不同含义的 lesson | 低 | 低（误判只会阻止添加） | 阈值设为 60 字符，降低误判概率；去重结果在函数返回值中体现（`added: false`），调用方可感知 |

## 7. 验收标准

| AC | 描述 | 验证方式 |
|----|------|---------|
| AC-1 | `extractTribunalCrashes()` 能正确解析简单格式 `<!-- TRIBUNAL_CRASH phase=N -->` 并返回 `{ phase: N }` | 单元测试 |
| AC-2 | `extractTribunalCrashes()` 能正确解析完整格式 `<!-- TRIBUNAL_CRASH phase=N category="..." exitCode="..." retryable="..." timestamp="..." -->`，返回所有字段 | 单元测试 |
| AC-3 | `extractPhaseTimings()` 能正确解析包含 `task=N` 属性的 CHECKPOINT（如 `phase=3 task=11 status=PASS summary="..." timestamp=...`） | 单元测试 |
| AC-4 | `extractPhaseTimings()` 能正确解析 summary 包含中文、括号、斜杠等特殊字符的 CHECKPOINT | 单元测试 |
| AC-5 | `generateRetrospectiveData()` 输出的 markdown 包含 "Tribunal Crashes" 段落（当存在 TRIBUNAL_CRASH 事件时） | 单元测试 |
| AC-6 | `isCheckpointDuplicate()` 在 progress-log 大于 4KB 时仅读取文件尾部而非全文件 | 单元测试（mock fs.open/fs.read 验证读取偏移量） |
| AC-7 | `isCheckpointDuplicate()` 在 progress-log 小于 4KB 时行为与改动前一致（仍能正确判断重复） | 单元测试 |
| AC-8 | `getProjectLessons()` 和 `getCrossProjectLessons()` 返回结果与重构前完全一致（现有测试全部通过） | 现有单元测试回归 |
| AC-9 | `addToProject()` 对 lesson text 前 60 字符相同的条目视为重复，返回 `{ added: false }` | 单元测试 |
| AC-10 | `addToProject()` 对 lesson text 前 60 字符不同的条目正常添加，返回 `{ added: true }` | 单元测试 |
| AC-11 | 所有现有测试（490/490）在改动后继续通过 | 运行 `npm test` 验证 |
| AC-12 | 当 progress-log 为空或不存在时，`generateRetrospectiveData()` 返回 `tribunalCrashes: []` 而非抛出异常 | 单元测试 |
