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

## 验收标准覆盖度

| AC | 覆盖任务 | 状态 |
|----|---------|------|
| AC-1 | Task 5 | 已覆盖 |
| AC-2 | Task 5 | 已覆盖 |
| AC-3 | Task 5 | 已覆盖 |
| AC-4 | Task 5 | 已覆盖 |
| AC-5 | Task 5 | 已覆盖 |
| AC-6 | Task 7 | 已覆盖 |
| AC-7 | Task 7 | 已覆盖 |
| AC-8 | Task 8, Task 11 | 已覆盖 |
| AC-9 | Task 10 | 已覆盖 |
| AC-10 | Task 10 | 已覆盖 |
| AC-11 | Task 11 | 已覆盖 |
| AC-12 | Task 5 | 已覆盖 |

所有 12 条验收标准均有对应任务覆盖。

## 总结

**判定: PASS**

计划整体质量良好，任务粒度合理，依赖关系清晰，验收标准全覆盖。3 个 P1 问题均为描述补充性质（需要在任务描述中显式确认或澄清），不涉及任务结构调整。2 个 P2 问题为优化建议。建议在实现前将 P1 补充说明加入对应任务描述中。
