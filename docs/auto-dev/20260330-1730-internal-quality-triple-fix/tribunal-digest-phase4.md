# Phase 4 独立裁决

你是独立裁决者。你的默认立场是 FAIL。
PASS 必须对每条检查项提供证据（文件名:行号），FAIL 只需说明理由。
PASS 的举证成本远大于 FAIL —— 如果你不确定，判 FAIL。

## 范围限制

- 你只能审查本次 diff 涉及的变更，不得对 diff 之外的代码提出阻塞性问题（P0/P1）。
- P0/P1 问题必须提供 acRef（关联验收标准编号），否则将被降级为 advisory。
- 不在本次任务范围内的改进建议请放入 advisory 字段。

## 框架统计（可信数据）
```
 mcp/dist/lessons-manager.d.ts                      |     13 +
 mcp/dist/lessons-manager.js                        |    204 +-
 mcp/dist/lessons-manager.js.map                    |      2 +-
 mcp/dist/retrospective-data.js                     |     53 +-
 mcp/dist/retrospective-data.js.map                 |      2 +-
 mcp/dist/state-manager.d.ts                        |      4 +
 mcp/dist/state-manager.js                          |     32 +-
 mcp/dist/state-manager.js.map                      |      2 +-
 mcp/dist/types.d.ts                                |      7 +
 mcp/node_modules/typescript/README.md              |     50 -
 mcp/node_modules/typescript/SECURITY.md            |     41 -
 mcp/node_modules/typescript/bin/tsc                |      2 -
 mcp/node_modules/typescript/bin/tsserver           |      2 -
 mcp/node_modules/typescript/lib/_tsc.js            | 133818 ------------
 mcp/node_modules/typescript/lib/_tsserver.js       |    659 -
 .../typescript/lib/_typingsInstaller.js            |    222 -
 .../lib/cs/diagnosticMessages.generated.json       |   2122 -
 .../lib/de/diagnosticMessages.generated.json       |   2122 -
 .../lib/es/diagnosticMessages.generated.json       |   2122 -
 .../lib/fr/diagnosticMessages.generated.json       |   2122 -
 .../lib/it/diagnosticMessages.generated.json       |   2122 -
 .../lib/ja/diagnosticMessages.generated.json       |   2122 -
 .../lib/ko/diagnosticMessages.generated.json       |   2122 -
 mcp/node_modules/typescript/lib/lib.d.ts           |     22 -
 .../typescript/lib/lib.decorators.d.ts             |    384 -
 .../typescript/lib/lib.decorators.legacy.d.ts      |     22 -
 .../typescript/lib/lib.dom.asynciterable.d.ts      |     41 -
 mcp/node_modules/typescript/lib/lib.dom.d.ts       |  31451 ---
 .../lib/pl/diagnosticMessages.generated.json       |   2122 -
 .../lib/pt-br/diagnosticMessages.generated.json    |   2122 -
 .../lib/ru/diagnosticMessages.generated.json       |   2122 -
 .../lib/tr/diagnosticMessages.generated.json       |   2122 -
 mcp/node_modules/typescript/lib/tsc.js             |      8 -
 mcp/node_modules/typescript/lib/tsserver.js        |      8 -
 mcp/node_modules/typescript/lib/tsserverlibrary.js |     21 -
 mcp/node_modules/typescript/lib/typesMap.json      |    497 -
 mcp/node_modules/typescript/lib/typescript.js      | 200276 ------------------
 .../typescript/lib/typingsInstaller.js             |      8 -
 mcp/node_modules/typescript/lib/watchGuard.js      |     53 -
 .../lib/zh-cn/diagnosticMessages.generated.json    |   2122 -
 .../lib/zh-tw/diagnosticMessages.generated.json    |   2122 -
 mcp/node_modules/typescript/package.json           |    120 -
 mcp/src/__tests__/lessons-manager.test.ts          |     81 +
 mcp/src/lessons-manager.ts                         |    235 +-
 mcp/src/retrospective-data.ts                      |     58 +-
 mcp/src/state-manager.ts                           |     33 +-
 mcp/src/types.ts                                   |      7 +
 47 files changed, 459 insertions(+), 395565 deletions(-)

Untracked new files:
 docs/auto-dev/20260330-1730-internal-quality-triple-fix/approach-plan.md (new file)
 docs/auto-dev/20260330-1730-internal-quality-triple-fix/design-review.md (new file)
 docs/auto-dev/20260330-1730-internal-quality-triple-fix/design.md (new file)
 docs/auto-dev/20260330-1730-internal-quality-triple-fix/plan-review.md (new file)
 docs/auto-dev/20260330-1730-internal-quality-triple-fix/plan.md (new file)
 docs/auto-dev/20260330-1730-internal-quality-triple-fix/progress-log.md (new file)
 docs/auto-dev/20260330-1730-internal-quality-triple-fix/state.json (new file)
 docs/auto-dev/20260330-1730-internal-quality-triple-fix/tribunal-digest-phase4.md (new file)
 docs/auto-dev/20260330-1730-internal-quality-triple-fix/tribunal-phase4.md (new file)
 docs/auto-dev/tribunal-crash-observability (new file)
 docs/design-review-enhancement.md (new file)
 docs/docs/auto-dev/_global/lessons-global.json (new file)
 mcp/npm (new file)
 mcp/src/__tests__/retrospective-data.test.ts (new file)
 mcp/src/__tests__/state-manager-checkpoint.test.ts (new file)

```

## Phase 1 设计评审
```
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
... (truncated, 106 lines omitted)
```

## Phase 2 计划评审
```
# 计划审查报告: 20260330-1730-internal-quality-triple-fix

> 审查日期: 2026-03-30
> 审查角色: 计划审查专家

## A. 覆盖度（设计 -> 计划追溯）

| 设计文档功能点 | 对应计划任务 | 状态 |
|--------------|------------|------|
| 4.1.1 新增 TRIBUNAL_CRASH 解析 + 类型字段 | Task 1 (类型), Task 2 (函数), Task 3 (集成) | 已覆盖 |
| 4.1.2 加固 extractPhaseTimings 正则 | Task 4 | 已覆盖 |
| 4.1.3 单元测试 | Task 5 | 已覆盖 |
| 4.2.1 isCheckpointDuplicate 尾部读取 | Task 6 | 已覆盖 |
| 4.2.2 关于缓存的决策（不引入） | N/A（不实现，正确） | 已覆盖 |
| 4.3.1 抽取 getLessonsFromPool / addToPool | Task 8, Task 9 | 已覆盖 |
| 4.3.2 增强去重（前缀匹配） | Task 9 | 已覆盖 |
| 4.3.3 向后兼容（公共方法签名不变） | Task 8, Task 9 完成标准中提及 | 已覆盖 |
| 影响分析 - 全量回归 | Task 11 | 已覆盖 |

**结论**: 设计文档所有功能点均有对应任务，无遗漏。

## B. 任务粒度（INVEST 原则）

- **Independent**: Task 1-5 (IMP-009)、Task 6-7 (IMP-007)、Task 8-10 (IMP-004) 三组相互独立，组内依赖合理。PASS
- **Negotiable**: 各任务描述了"做什么"而非过度规定"怎么做"。PASS
- **Valuable**: 每个任务都有明确的业务价值或技术价值。PASS
- **Estimable**: 任务描述足够具体，可估算工作量。PASS
- **Small**: 每个任务粒度适中（单函数或单文件级别）。PASS
- **Testable**: 每个功能任务都有对应的测试任务。PASS

## C. 依赖关系

```
Task 1 (类型) -> Task 2 (函数) -> Task 3 (集成) \
                                    Task 4 (正则) -> Task 5 (测试) -> Task 11 (回归)
                                    Task 6 (尾部读取) -> Task 7 (测试) /
                    Task 8 (getLessonsFromPool) -> Task 9 (addToPool) -> Task 10 (测试) /
```

- 无循环依赖。
- Task 4 标注无依赖，Task 6 标注无依赖，Task 8 标注无依赖 -- 三条主线可并行执行，关键路径正确。
- **P2**: Task 8 和 Task 9 的依赖标注为顺序依赖，但设计文档 4.3.1 中 `readEntriesFrom` 是两者共用的基础方法，这个隐含依赖已在 Task 8 中涵盖，没有问题。

## D. 任务描述质量

逐项检查：

| 任务 | 文件路径 | 改动描述 | 完成标准 | 判定 |
|------|---------|---------|---------|------|
| Task 1 | 有 | 清晰 | 有 | PASS |
| Task 2 | 有 | 清晰 | 有 | PASS |
| Task 3 | 有 | 清晰 | 有 | PASS |
| Task 4 | 有 | 清晰 | 有 | PASS |
| Task 5 | 有 | 详细场景列表 | 有 AC 映射 | PASS |
| Task 6 | 有 | 含实现细节 | 有 | PASS |
| Task 7 | 有 | 含场景列表 | 有 AC 映射 | PASS |
| Task 8 | 有 | 清晰 | 有 | PASS |
| Task 9 | 有 | 含去重算法细节 | 有 | PASS |
| Task 10 | 有 | 含场景列表 | 有 AC 映射 | PASS |
| Task 11 | 有 | 清晰 | 有 AC 映射 | PASS |

## E. 完整性

- [x] 包含测试任务（Task 5, 7, 10, 11）
- [x] 测试任务依赖功能任务，顺序合理
- [x] 最后有全量回归任务（Task 11）

## 问题清单

### P1: Task 3 未提及消费方 `generateRetrospectiveData` 的调用链更新

**问题**: 设计文档 4.1.1 新增 `tribunalCrashes` 字段为 optional，`generateRetrospectiveData()` 函数在 `tribunal.ts:194` 和 `index.ts:1772` 两处被调用。Task 3 只提到修改 `retrospective-data.ts`，但需要确认 `generateRetrospectiveData` 的返回值在这两个调用方中是否被进一步处理（如写入文件、传递给其他函数）。如果调用方解构了返回值或做了字段检查，新增字段可能需要在调用方同步处理。

**修复建议**: 在 Task 3 描述中补充一条："确认 `tribunal.ts` 和 `index.ts` 中调用 `generateRetrospectiveData()` 的代码不需要因新增 `tribunalCrashes` 字段做额外修改（字段为 optional，渲染在函数内部完成）"。这是一个验证步骤，不一定需要改代码，但必须显式确认。

**严重性说明**: 此问题为 P1 而非 P0，因为从设计文档来看 `renderRetrospectiveDataMarkdown` 在 `generateRetrospectiveData` 内部调用，新增字段的消费逻辑封装在同一个模块中，调用方大概率无需改动。但根据审查规则 1（调用方审查），必须显式验证而非假设。

### P1: Task 6 缺少 4KB 边界截断 CHECKPOINT 的处理说明

**问题**: Task 6 描述中提到"若尾部 4KB 未找到 CHECKPOINT，则读取全文件"作为回退逻辑。但存在另一种边界情况：最后一个 CHECKPOINT 恰好跨越 4KB 边界（前半部分在 4KB 之外，后半部分在 4KB 之内），此时正则匹配会失败（因为只看到了 CHECKPOINT 的后半段），但"未找到 CHECKPOINT"的回退逻辑会触发全文读取，从而正确处理。这个推导是正确的，但应在任务描述中显式说明这个边界场景的处理策略，避免实现者遗漏回退逻辑或使用错误的"部分匹配"策略。

**修复建议**: 在 Task 6 描述中补充："边界情况：CHECKPOINT 可能跨越 4KB 边界导致尾部内容中正则匹配失败，此时回退到全文读取即可正确处理，无需特殊的部分匹配逻辑"。

### P1: Task 5 测试策略未说明内部函数导出方式

**问题**: Task 5 描述中提到"导出需要测试的函数（或通过 generateRetrospectiveData 间接测试）"，但 `extractTribunalCrashes`、`extractPhaseTimings`、`extractSubmitRetries` 当前是否为 export 函数未确认。如果当前未导出，需要决定是 (a) export 这些函数供测试直接调用，还是 (b) 全部通过 `generateRetrospectiveData` 间接测试。两种方式的测试粒度和维护成本差异较大。

**修复建议**: 在 Task 5 中明确策略："将 `extractTribunalCrashes`、`extractPhaseTimings`、`extractSubmitRetries` 导出（作为 named export），供测试直接调用。这些函数是纯函数，直接测试比间接测试更精确且更易维护"。

### P2: 缺少 lessons-global.json 已知重复数据清理任务

**问题**: 设计文档 2.4 节明确提到 `lessons-global.json` 中存在 1 组已确认重复（2 条 dual-file-write 相关）。计划中 Task 9 增强了去重逻辑（防止未来新增重复），但没有任务清理已有的重复数据。

**修复建议**: 可在 Task 9 或 Task 10 中补充一步："验证增强去重逻辑后，对 `lessons-global.json` 中的已知重复条目进行清理（保留 appliedCount 较高的一条，删除另一条）"。或单独新增一个小任务。此为优化项，不影响功能正确性。

### P2: Task 4 与 Task 2 可并行但描述中未体现

**问题**: Task 4（加固正则）标注无依赖，Task 2（新增函数）依赖 Task 1。两者修改同一个文件 `retrospective-data.ts` 的不同函数，理论上可以并行开发但合并时需注意冲突。

**修复建议**: 在计划中标注 Task 2 和 Task 4 可并行，但提醒实现时注意同文件编辑的合并。
... (truncated, 26 lines omitted)
```

## 关键代码变更
```diff
diff --git a/mcp/src/lessons-manager.ts b/mcp/src/lessons-manager.ts
index 2813575..78d3709 100644
--- a/mcp/src/lessons-manager.ts
+++ b/mcp/src/lessons-manager.ts
@@ -133,40 +133,7 @@ export class LessonsManager {
   }
 
   async getProjectLessons(limit: number = MAX_GLOBAL_INJECT): Promise<LessonEntry[]> {
-    const allEntries = await this.readProjectEntries();
-    if (allEntries.length === 0) return [];
-
-    const now = new Date();
-    const nowStr = now.toISOString();
-
-    // Lazy retirement pass (P0-1): retire non-retired entries whose decayed score <= 0
-    for (const e of allEntries) {
-      if (!e.retired && applyDecay(e, now) <= 0) {
-        e.retired = true;
-        e.retiredAt = nowStr;
-        e.retiredReason = "score_decayed";
-      }
-    }
-
-    // Filter out retired, compute effective score, sort by score desc
-    const active = allEntries
-      .filter((e) => !e.retired)
-      .map((e) => ({ ...e, score: applyDecay(e, now) }))
-      .sort((a, b) => b.score - a.score);
-
-    const selected = active.slice(0, limit);
-    const selectedIds = new Set(selected.map((e) => e.id));
-
-    // Update appliedCount and lastAppliedAt on the full array for persistence
-    for (const e of allEntries) {
-      if (selectedIds.has(e.id)) {
-        e.appliedCount = (e.appliedCount ?? 0) + 1;
-        e.lastAppliedAt = nowStr;
-      }
-    }
-
-    await this.writeAtomic(allEntries, this.projectFilePath());
-    return selected;
+    return this.getLessonsFromPool(this.projectFilePath(), limit);
   }
 
   async promoteToProject(topic: string): Promise<number> {
@@ -186,53 +153,7 @@ export class LessonsManager {
   }
 
   async addToProject(entry: LessonEntry): Promise<{ added: boolean; displaced?: LessonEntry }> {
-    const entries = await this.readProjectEntries();
-
-    // Dedup: same lesson text and not retired
-    if (entries.some((e) => e.lesson === entry.lesson && !e.retired)) {
-      return { added: false };
-    }
-
-    const now = new Date();
-    const active = entries.filter((e) => !e.retired);
-
-    if (active.length < MAX_GLOBAL_POOL) {
-      entries.push(entry);
-      await this.writeAtomic(entries, this.projectFilePath());
-      return { added: true };
-    }
-
-    // Pool full -- find lowest effective-score active entry
-    let lowestIdx = -1;
-    let lowestScore = Infinity;
-    for (let i = 0; i < entries.length; i++) {
-      const e = entries[i];
-      if (e.retired) continue;
-      const es = applyDecay(e, now);
-      if (es < lowestScore) {
-        lowestScore = es;
... (truncated, 232 lines omitted)
diff --git a/mcp/src/retrospective-data.ts b/mcp/src/retrospective-data.ts
index 0946128..7b4d324 100644
--- a/mcp/src/retrospective-data.ts
+++ b/mcp/src/retrospective-data.ts
@@ -26,6 +26,7 @@ export async function generateRetrospectiveData(
     rejectionCount: countRejections(progressLog),
     phaseTimings: extractPhaseTimings(progressLog),
     tribunalResults: await extractTribunalResults(outputDir),
+    tribunalCrashes: extractTribunalCrashes(progressLog),
     submitRetries: extractSubmitRetries(progressLog),
     tddGateStats: await extractTddGateStats(outputDir, progressLog),
   };
@@ -58,12 +59,15 @@ function countRejections(progressLog: string): number {
  * The first checkpoint per phase is treated as startedAt,
  * and the last PASS checkpoint per phase is treated as completedAt.
  */
-function extractPhaseTimings(
+export function extractPhaseTimings(
   progressLog: string,
 ): Record<number, { startedAt: string; completedAt?: string; durationMs?: number }> {
   const timings: Record<number, { startedAt: string; completedAt?: string; durationMs?: number }> = {};
 
-  const regex = /<!-- CHECKPOINT phase=(\d+).*?status=(\S+).*?timestamp=(\S+)\s*-->/g;
+  // Hardened regex: uses known attribute order (phase -> task? -> status -> summary? -> timestamp)
+  // summary is bounded by double quotes, so we skip it precisely to avoid mis-matching
+  // status= or timestamp= substrings inside summary text.
+  const regex = /<!-- CHECKPOINT phase=(\d+)(?:\s+task=\d+)?\s+status=(\S+)(?:\s+summary="[^"]*")?\s+timestamp=(\S+)\s*-->/g;
   let match;
   while ((match = regex.exec(progressLog)) !== null) {
     const phase = parseInt(match[1]!, 10);
@@ -114,14 +118,47 @@ async function extractTribunalResults(
   return results;
 }
 
+/**
+ * Extract tribunal crash events from progress-log.
+ *
+ * Two formats are supported:
+ *   - Simple:  <!-- TRIBUNAL_CRASH phase=N -->
+ *   - Full:    <!-- TRIBUNAL_CRASH phase=N category="..." exitCode="..." retryable="..." timestamp="..." -->
+ */
+export function extractTribunalCrashes(
+  progressLog: string,
+): Array<{ phase: number; category?: string; exitCode?: string; retryable?: boolean; timestamp?: string }> {
+  const results: Array<{ phase: number; category?: string; exitCode?: string; retryable?: boolean; timestamp?: string }> = [];
+  const regex = /<!-- TRIBUNAL_CRASH\s+phase=(\d+)(.*?)-->/g;
+  let match;
+  while ((match = regex.exec(progressLog)) !== null) {
+    const phase = parseInt(match[1]!, 10);
+    const rest = match[2] ?? "";
+
+    const categoryMatch = rest.match(/category="([^"]*)"/);
+    const exitCodeMatch = rest.match(/exitCode="([^"]*)"/);
+    const retryableMatch = rest.match(/retryable="([^"]*)"/);
+    const timestampMatch = rest.match(/timestamp="([^"]*)"/);
+
+    results.push({
+      phase,
+      ...(categoryMatch ? { category: categoryMatch[1] } : {}),
+      ...(exitCodeMatch ? { exitCode: exitCodeMatch[1] } : {}),
+      ...(retryableMatch ? { retryable: retryableMatch[1] === "true" } : {}),
+      ...(timestampMatch ? { timestamp: timestampMatch[1] } : {}),
+    });
+  }
+  return results;
+}
+
 /**
  * Extract submit (checkpoint PASS) retry counts per phase from progress-log.
  * Counts the number of CHECKPOINT calls with status=PASS for each phase.
  * A count > 1 means the phase was retried.
  */
-function extractSubmitRetries(progressLog: string): Record<number, number> {
+export function extractSubmitRetries(progressLog: string): Record<number, number> {
   const retries: Record<number, number> = {};
... (truncated, 26 lines omitted)
diff --git a/mcp/src/state-manager.ts b/mcp/src/state-manager.ts
index e2b5c8f..703a102 100644
--- a/mcp/src/state-manager.ts
+++ b/mcp/src/state-manager.ts
@@ -8,7 +8,7 @@
  *  - Manage progress-log.md (append, checkpoint dedup)
  */
 
-import { readFile, writeFile, rename, mkdir, stat, readdir } from "node:fs/promises";
+import { readFile, writeFile, rename, mkdir, stat, readdir, open } from "node:fs/promises";
 import { join, dirname, resolve } from "node:path";
 import { lstatSync } from "node:fs";
 import { fileURLToPath } from "node:url";
@@ -505,6 +505,10 @@ export class StateManager {
   /**
    * Check whether the last CHECKPOINT in progress-log.md has identical parameters.
    * Used for idempotency: if same → caller should skip the append.
+   *
+   * Optimization: for files larger than 4KB, only reads the last 4KB to find
+   * the last CHECKPOINT. Falls back to full-file read if no CHECKPOINT found
+   * in the tail (e.g. very long non-checkpoint content at the end).
    */
   async isCheckpointDuplicate(
     phase: number,
@@ -512,9 +516,34 @@ export class StateManager {
     status: string,
     summary?: string,
   ): Promise<boolean> {
+    const TAIL_SIZE = 4096;
+
     let content: string;
     try {
-      content = await readFile(this.progressLogPath, "utf-8");
+      const fh = await open(this.progressLogPath, "r");
+      try {
+        const fileStat = await fh.stat();
+        const fileSize = fileStat.size;
+
+        if (fileSize > TAIL_SIZE) {
+          // Read only the last 4KB
+          const buffer = Buffer.alloc(TAIL_SIZE);
+          await fh.read(buffer, 0, TAIL_SIZE, fileSize - TAIL_SIZE);
+          content = buffer.toString("utf-8");
+
+          // If tail doesn't contain a CHECKPOINT, fall back to full read
+          if (!content.includes("<!-- CHECKPOINT ")) {
+            content = await readFile(this.progressLogPath, "utf-8");
+          }
+        } else {
+          // Small file: read all
+          const buffer = Buffer.alloc(fileSize);
+          await fh.read(buffer, 0, fileSize, 0);
+          content = buffer.toString("utf-8");
+        }
+      } finally {
+        await fh.close();
+      }
     } catch {
       return false; // file doesn't exist → not a duplicate
     }

diff --git a/mcp/src/types.ts b/mcp/src/types.ts
index 15f491c..8dd9d1c 100644
--- a/mcp/src/types.ts
+++ b/mcp/src/types.ts
@@ -359,6 +359,13 @@ export interface RetrospectiveAutoData {
   rejectionCount: number;
   phaseTimings: Record<number, { startedAt: string; completedAt?: string; durationMs?: number }>;
   tribunalResults: Array<{ phase: number; verdict: string; issueCount: number }>;
+  tribunalCrashes: Array<{
+    phase: number;
+    category?: string;
+    exitCode?: string;
+    retryable?: boolean;
+    timestamp?: string;
+  }>;
   submitRetries: Record<number, number>;
   tddGateStats?: {
     totalTasks: number;

```

## 检查清单

## 裁决检查清单（Phase 4: Code Review + Phase 1/2 回溯验证）

> 默认立场是 FAIL。PASS 必须逐条举证。

> **审查范围约束**: 只审查本次 diff 涉及的文件和变更。不得对 diff 之外的代码、架构或历史遗留问题提出 P0/P1。P0/P1 必须关联具体的验收标准（acRef）。

### A. 回溯验证（最高优先级）
- [ ] 逐条检查 designReview 中的每个 P0/P1 问题
- [ ] 在 design.md 或 diff 中找到对应修复证据
- [ ] 如果 designReview 中有 P0 未修复 → 直接 FAIL
- [ ] 逐条检查 planReview 中的问题，在 diff 中验证

### B. 代码审查
- [ ] 独立审查 diff，不要只依赖主 Agent 的 review 报告
- [ ] 检查设计文档中的每个需求是否在 diff 中有对应实现
- [ ] 检查安全问题（权限绕过、注入、数据泄露）
- [ ] 检查 API 一致性（前后端接口匹配）

### C. TDD Gate Verification (if tdd=true)
- [ ] Check state.json tddTaskStates: every non-exempt task should have status=GREEN_CONFIRMED
- [ ] If any task has status=RED_CONFIRMED or PENDING, TDD flow was not completed -> FAIL
- [ ] Cross-check: test files in diff should align with redTestFiles recorded in tddTaskStates

### D. 输出要求
- 回溯验证结果：TRACE: [Phase 1/2 问题描述] → FIXED / NOT_FIXED → [证据]
- 如果 FAIL，列出问题：ISSUE: [P0/P1] 问题描述 → 修复建议 → 涉及文件

