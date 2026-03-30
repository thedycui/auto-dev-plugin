# 计划审查报告：Auto-Dev 自评改进 Round 2

**审查日期**: 2026-03-30
**审查对象**: `plan.md`
**对照文档**: `design.md`

---

## A. 覆盖度审查：设计功能点 vs 任务映射

| 设计功能点 | 对应任务 | 覆盖状态 |
|-----------|---------|---------|
| R2-1: tribunal verdict step 推进修复 | Task 1 (实现) + Task 2 (测试) | 完整覆盖 |
| R2-2: TDD 门禁全局校验 | Task 3 (实现) + Task 4 (测试) | 完整覆盖 |
| R2-3: Phase 5a 文件存在性检查 | Task 5 (实现) + Task 6 (测试) | 部分覆盖（见 P1-1） |
| R2-4: skipSteps lightweight 模式 | Task 7 (实现) + Task 8 (测试) | 完整覆盖 |
| 全量回归验证 | Task 9 | 完整覆盖 |
| AC-1 ~ AC-9 | 全部有对应任务 | 完整覆盖 |

**覆盖度评分**: 9/10 — 有一个功能点的实现与设计存在偏差（见下方 P1-1）。

---

## B. INVEST 原则检查

| 原则 | 评价 |
|------|------|
| **I**ndependent | 通过。Task 1/2、3/4、5/6、7/8 各组独立，组间无循环依赖。 |
| **N**egotiable | 通过。各 Task 描述了目标和约束，未过度规定实现细节。 |
| **V**aluable | 通过。每个 Task 对应一个独立的用户价值（P0 bug 修复、门禁增强、质量检查、效率提升）。 |
| **E**stimable | 通过。行数估算具体（+5、+25、+12 等），且与设计文档一致。 |
| **S**mall | 通过。单个 Task 最大改动 25 行（实现），测试最大 30 行。 |
| **T**estable | 通过。每个实现 Task 都有配对的测试 Task，且明确映射到 AC。 |

---

## C. 依赖关系检查

计划中的依赖图：

```
Task 1 → Task 2 → Task 3 → Task 4 → Task 5/7 → Task 6/8 → Task 9
```

**无循环依赖**。依赖方向单一、合理。

但有一个可优化点：Task 3 (R2-2) 标注为"依赖: 无"但在依赖图中画为 Task 2 之后。这是交付顺序而非代码依赖，计划已正确说明"可与 Task 1 并行开发，但按优先级串行交付"。

---

## D. 任务描述质量

### 文件路径准确性

经源码验证：

| 计划描述 | 实际代码 | 状态 |
|---------|---------|------|
| `index.ts` 约 1906-1923 行（tribunal PASS 分支） | 实际在 1907-1923 行 | 准确 |
| `orchestrator.ts` 约 306 行（computeNextStep） | 实际在 306 行 | 准确 |
| `orchestrator.ts` 约 730-733 行（case "5a"） | 实际在 730-732 行 | 准确 |
| `fileExists` 在 `orchestrator.ts:148` | 实际在 148 行 | 准确 |
| `isTddExemptTask` 在 `phase-enforcer.ts:576` | 实际在 576 行 | 准确 |
| `behaviorUpdates` 在 `index.ts` 约 410-427 行 | 实际在 410-427 行 | 准确 |

**文件路径和行号准确性优秀**。

### 改动描述清晰度

- Task 1: 给出了完整的代码片段（`atomicUpdate` 调用），条件分支（仅 PASS + ckptResult.ok）清晰。
- Task 3: 给出了完整的逻辑步骤（6 步），包括正则、循环、统计。
- Task 7: 拆分为 4 个子步骤（7a/7b/7c/7d），每步都有修改位置和代码示例。

**改动描述质量优秀**。

---

## E. 测试任务完整性

| 实现 Task | 测试 Task | 测试场景覆盖 |
|----------|----------|-------------|
| Task 1 (R2-1) | Task 2 | PASS 后 step=null 验证、step=null 时 computeNextTask 正确推进 |
| Task 3 (R2-2) | Task 4 | 空 tddTaskStates BLOCK、全 exempt 通过、满额 GREEN_CONFIRMED 通过 |
| Task 5 (R2-3) | Task 6 | 文件不存在 -> false、文件存在 -> true |
| Task 7 (R2-4) | Task 8 | 跳过 1b、跳过 2b、不跳 4a、init 设置 skipSteps |

**测试覆盖充分**，每个 AC 都有对应测试用例。

---

## 审查发现

### P1-1: R2-3 计划与设计不一致 — 设计要求"自举场景条件判断"，计划改为"无条件文件检查"

**问题描述**：

设计文档 4.3 节明确指出 Phase 5a 改动是**条件验证**：

> "若项目是自举场景（`projectRoot` 包含 auto-dev 相关路径或 `topic` 包含自举关键词），要求 `e2e-test-cases.md` 存在"

但计划 Task 5 的实现是**无条件**检查 `e2e-test-cases.md` 是否存在，不区分自举场景和普通场景。

**影响**：对于非自举项目，Phase 5a 从原来的 pass-through 变为强制要求 `e2e-test-cases.md` 存在，可能阻断正常使用流程（设计文档 5.2 节风险表也提到了这一点："Phase 5a 从 pass-through 变为有条件验证，可能导致旧任务在 5a 失败"）。

**修复建议**：二选一：
1. 按设计实现：增加自举场景判断条件，非自举场景保持 pass-through
2. 如果认为所有场景都应检查（即设计需要更新），则在 Task 5 描述中明确说明这是对设计的有意偏离，并更新设计文档

### P1-2: R2-2 路径激活风险 — `computeNextTask` 中 Phase 3->4 过渡的 TDD 检查位置需精确定位

**问题描述**：

Task 3 描述修改位置为"约 1074 行之后的 validation passed 分支"，但需要确认这个检查点的精确插入位置。当前 `computeNextTask` 的流程是：

1. `validateStep` 通过 -> `computeNextStep` 计算下一步 -> 返回下一步
2. TDD 全局门禁需要在 step 3 validation 通过、`computeNextStep` 返回 "4a" 之后、实际返回结果之前插入

`computeNextStep` 的调用在 orchestrator.ts:1374 行。计划需要确认：在 `computeNextStep` 返回 "4a" 后、向调用方返回结果前插入 BLOCK 逻辑，而不是在 `validateStep` 内部。

**修复建议**：在 Task 3 中精确标注插入点为 `orchestrator.ts:1374` 行（`computeNextStep` 调用）之后，增加条件判断：若 `currentStep` 属于 Phase 3 且 `nextStep` 属于 Phase 4+，则执行 TDD 全局门禁。

### P1-3: R2-4 skipSteps 与现有 skipE2e 的交互未说明

**问题描述**：

现有代码在 `computeNextTask` 中通过过滤 `phases` 数组来实现 `skipE2e`（orchestrator.ts:987-988）：

```typescript
if (state.skipE2e === true) {
  phases = phases.filter(p => p !== 5);
}
```

R2-4 的 `skipSteps` 是在 `computeNextStep` 层面过滤步骤，与 `skipE2e` 的 phase 层面过滤是两个不同机制。这本身没问题，但计划未说明：

1. `skipSteps` 和 `skipE2e` 同时设置时的行为（两层过滤叠加，无冲突，但应有测试覆盖）
2. `skipSteps` 是否也需要像 `skipE2e` 一样有防篡改机制（`parseInitMarker` 中的 integrity 校验）

**修复建议**：
- 在 Task 8 中补充一个测试用例：`skipSteps=["1b","2b"]` 且 `skipE2e=true` 时，验证 Phase 5 步骤也被跳过（两层过滤叠加无冲突）
- 评估是否需要将 `skipSteps` 纳入 init marker 的防篡改校验。鉴于 `skipSteps` 仅跳过审查步骤（1b/2b）而非实质性 phase，且 Phase 4 tribunal 保持不变，P2 优先级，可后续处理

### P2-1: Task 2 测试文件选择待确认

Task 2 描述"修改文件: `orchestrator.test.ts`（或 `tribunal.test.ts`，取决于现有测试结构）"。建议明确：
- AC-1（tribunal PASS 后 step 清空）属于 `index.ts` 的 tribunal_verdict handler 逻辑，应在 `tribunal.test.ts` 中测试
- AC-2（step=null 时 computeNextTask 正确推进）属于 orchestrator 逻辑，应在 `orchestrator.test.ts` 中测试

两个 AC 应分别放在对应的测试文件中。

### P2-2: 提交策略 commit 3 粒度偏大

commit 3 包含 Task 5+6+7+8（R2-3 + R2-4），混合了两个不相关的功能改进（Phase 5a 文件检查 + lightweight 审查模式）。根据 CLAUDE.md 原子提交原则，建议拆为两个 commit：
- commit 3a: Task 5+6 (R2-3: Phase 5a 文件检查)
- commit 3b: Task 7+8 (R2-4: lightweight 审查模式)

---

## 总结

| 分级 | 数量 | 详情 |
|------|------|------|
| P0 | 0 | — |
| P1 | 3 | R2-3 实现与设计不一致、R2-2 插入位置需精确化、R2-4 与 skipE2e 交互未覆盖 |
| P2 | 2 | 测试文件选择、commit 粒度 |

**裁定: NEEDS_REVISION**

P1 问题需要在实施前修正计划，主要是：
1. Task 5 (R2-3) 需要与设计对齐，决定是条件检查还是无条件检查
2. Task 3 (R2-2) 需要精确标注代码插入位置
3. Task 8 (R2-4) 需要补充 skipSteps + skipE2e 叠加场景的测试
