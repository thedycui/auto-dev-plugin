# 计划审查报告: test-file-regex

**审查时间**: 2026-03-27
**审查对象**: plan.md (7 个 Task)
**对照**: design.md (方案 A, 12 个 AC)

---

## A. 覆盖度（设计 -> 计划追溯）

| 设计章节 | 计划任务 | 覆盖 |
|---------|---------|------|
| 4.1 统一 TEST_PATTERNS 正则 | Task 1 | OK |
| 4.2 countTestFiles 改造 | Task 3 | OK |
| 4.3 tribunal.ts runQuickPreCheck | Task 4 | OK |
| 4.3 tribunal.ts crossValidate | Task 5 | OK |
| 4.4 index.ts checkpoint | Task 6 | OK |
| 7. AC-2~AC-8 测试用例 | Task 2 | OK |
| 7. AC-9 countTestFiles 测试 | Task 2/7 | 见 P1-1 |
| 7. AC-10/AC-11 代码审查 | Task 7 grep | OK |
| 7. AC-12 无 regression | Task 7 | OK |

## B. 任务粒度（INVEST）

整体粒度合理。Task 4 和 Task 5 都是改同一个文件 tribunal.ts，拆分为两个 Task 有利于分步验证，可接受。

## C. 依赖关系

```
Task 1 (tdd-gate 正则)
  |--- Task 2 (测试用例)
  |--- Task 3 (phase-enforcer)
  |--- Task 4 (tribunal runQuickPreCheck)
  |      |--- Task 5 (tribunal crossValidate)
  |--- Task 6 (index.ts)
  |
  +--> Task 7 (全量验证, 依赖 2/3/5/6)
```

无循环依赖。关键路径: 1 -> 4 -> 5 -> 7。依赖标注清晰。

## D. 任务描述质量

所有任务均包含文件路径、改动描述、完成标准。文件路径使用绝对路径，便于执行。

---

## 问题清单

### P1-1: Task 2 未明确覆盖 AC-9（countTestFiles 集成测试）

**问题**: 设计文档 AC-9 要求 `countTestFiles(["foo.test.tsx", "bar.ts"])` 返回 1，验证 countTestFiles 通过 isTestFile 实现后的行为正确性。Task 2 的描述只提到"覆盖 AC-2 ~ AC-8"，未包含 AC-9。Task 7 的完成标准也只有 grep 检查和全量测试通过，没有明确要求新增 AC-9 的测试用例。

**风险**: countTestFiles 改造后（Task 3）虽然逻辑简单，但作为 index.ts 和 tribunal.ts 的共用函数，行为变化（移除了 tests?/ 目录匹配）应该有对应的测试用例验证。

**修复建议**: 在 Task 2 的描述中将覆盖范围从"AC-2 ~ AC-8"扩展为"AC-2 ~ AC-9"，或在 Task 3 中新增一条完成标准："为 countTestFiles 新增测试用例验证 AC-9"。

### P2-1: Task 5 对 Task 4 的依赖可放宽为对 Task 1 的依赖

**问题**: Task 5 标注依赖 Task 4，但实际上 Task 5 只需要 Task 4 中新增的 import 语句。由于两者改的是同一个文件，sequential 执行是合理的，但严格来说 Task 5 的实质依赖是 Task 1（正则定义）。

**影响**: 不影响执行，当前排列顺序已经正确。仅为准确性建议。

### P2-2: index.ts 中 isTestFile 是否已被 import 未在 Task 6 中说明

**问题**: 设计文档 4.4 节指出 index.ts 当前已 import isTestFile。但经源码验证，index.ts:20 的 import 是 `validateRedPhase, buildTestCommand, TDD_TIMEOUTS`，并未 import isTestFile 或 isImplFile。设计文档此处描述有误。Task 6 的描述中说"新增 isImplFile"到现有 tdd-gate import 语句，也隐含假设 isTestFile 已存在。

**修复建议**: Task 6 描述应明确为："在 index.ts 第 20 行的 tdd-gate import 中新增 isImplFile（若 isTestFile 也未被 import，则一并新增）"。实际上 index.ts 的 implFileCount 计算逻辑只需要 isImplFile（因为 isImplFile 内部已排除测试文件），所以只新增 isImplFile 即可满足需求。这不是 blocker，但描述应更准确。

---

## E. 路径激活风险评估（规则 2）

本次变更是纯重构，所有调用方（tribunal.ts runQuickPreCheck/crossValidate、index.ts checkpoint、phase-enforcer.ts countTestFiles）均为生产在用的代码路径。tdd-gate.ts 的 isTestFile/isImplFile 也已有单元测试和集成测试覆盖。**无未验证的休眠路径**。

## F. 调用方审查（规则 1）

isTestFile/isImplFile 函数签名不变（string -> boolean），返回值语义不变。正则扩展是超集（只会让更多文件被识别为测试文件），不会导致原来被识别的文件失去匹配。唯一的行为收窄点是 countTestFiles 移除 tests?/ 目录匹配，这是设计文档中明确标注的"行为改进"。**调用方兼容性无风险**。

---

## 总结

| 级别 | 数量 | 详情 |
|------|------|------|
| P0 | 0 | - |
| P1 | 1 | AC-9 测试覆盖遗漏 |
| P2 | 2 | 依赖精确性、import 描述准确性 |

**结论: PASS**

P1-1 问题不构成阻塞，在实现阶段补充 AC-9 测试用例即可。计划整体结构清晰、覆盖度完整、依赖关系正确、任务粒度合理。
