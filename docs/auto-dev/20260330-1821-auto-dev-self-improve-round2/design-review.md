# 设计审查报告（第二轮）

**文档**: `design.md` (Auto-Dev 自评改进方案 Round 2)
**审查人**: Architecture Reviewer
**日期**: 2026-03-30
**结论**: **PASS**

---

## 1. 第一轮问题修复验证

### P0-1: tribunal verdict 后 step 推进（R2-1）

**状态**: 已修复

设计第 4.1 节明确改为在 `auto_dev_tribunal_verdict` PASS 分支中执行 `sm.atomicUpdate({ step: null, stepIteration: 0, lastValidation: null, approachState: null })`，让 orchestrator 在下次 `auto_dev_next` 时走 `if (!stepState.step)` 分支（`orchestrator.ts:1024`）重新接管。

代码验证：
- `internalCheckpoint`（`state-manager.ts:627-674`）确认只更新 `phase`、`status`、`iteration`、`phaseTimings`、`tokenUsage`，不触碰 `step` 相关字段，与设计描述一致
- `orchestrator.ts:1024` 的 `if (!stepState.step)` 分支确实存在且功能正确
- 不再在 `index.ts` 中调用 `computeNextStep`，保持 step 管理的单一职责在 orchestrator

### P1-3: TDD 门禁全局 BLOCK（R2-2）

**状态**: 已修复

设计第 4.2 节改为硬性 BLOCK（`TDD_GATE_GLOBAL_INCOMPLETE`）：
1. 统计 plan.md 中非 exempt task 数量 N
2. N > 0 且 GREEN_CONFIRMED 不足时阻断
3. N === 0（全部 exempt）时正常通过

代码验证：
- `isTddExemptTask` 函数存在于 `phase-enforcer.ts:576`，签名为 `(outputDir: string, task: number): Promise<boolean>`，可复用
- AC-3 和 AC-3b 分别覆盖了阻断和全 exempt 放行场景

### P1-5: skipSteps 替代 shouldSkipStep（R2-4）

**状态**: 已修复

设计第 4.4 节明确使用 `skipSteps: string[]` 状态字段，在 `computeNextStep` 中增加第三个 optional 参数进行过滤。

代码验证：
- `shouldSkipStep` 在整个 `mcp/src/` 中不存在（grep 确认），设计不再引用不存在的函数
- `computeNextStep`（`orchestrator.ts:306`）当前签名为 `(currentStep: string, phases: number[]): string | null`，增加第三个 optional 参数技术可行
- 调用方在 `orchestrator.ts:1374`，需同步传入 `skipSteps` 参数

### P1-4: mode === "full" 前提条件（R2-4）

**状态**: 已修复

设计第 4.4 节明确写了 `mode === "full" && estimatedLines <= 50 && estimatedFiles <= 3`，仅 full 模式有意义。

### P1-1: 不在 index.ts 中调用 computeNextStep（R2-1）

**状态**: 已修复

设计第 4.1 节末尾明确声明"不修改 orchestrator.ts"和"本方案不需要在 index.ts 中调用它"。

---

## 2. 新方案技术可行性

### R2-1: step 清空方案 -- 无问题

`sm.atomicUpdate` 在 `index.ts` 中已有 20+ 处调用（grep 确认），接受任意 `Record<string, unknown>`，写入 `{ step: null }` 完全可行。orchestrator 的 `readStepState` 在 step 为 null 时走首次初始化逻辑，路径成熟。

### R2-2: TDD 全局 BLOCK -- P2 建议

**P2**: 设计提到"读取 plan.md，匹配 `## Task N` 提取 task 编号列表"，这是文本解析。建议在实现时复用已有的 `extractTaskList`（`state-manager.ts` 导出）而非自行正则匹配，减少解析逻辑重复。设计第 4.2 节未提及此函数，但实际可用。

### R2-3: Phase 5a 文件检查 -- P2 建议

**P2**: 设计使用 `fileExists(join(outputDir, "e2e-test-cases.md"))`，但 `fileExists` 未在现有代码中发现通用实现。建议使用已有的 `readFileSafe`（orchestrator.ts 中有使用）做空值检查代替，或在实现时确认引入方式。这是实现细节，不影响设计正确性。

### R2-4: computeNextStep skipSteps 过滤 -- 无问题

在 `computeNextStep` 的 for 循环中增加 `if (skipSteps?.includes(candidate)) continue` 即可，改动约 2 行，技术可行。调用方（`orchestrator.ts:1374`）需从 state 中读取 `skipSteps` 并传入。

---

## 3. 跨组件影响分析（规则 1: 调用方审查）

### R2-1 消费方追踪

`auto_dev_tribunal_verdict` PASS 后返回的 JSON 包含 `nextPhase` 和 `mandate` 字段，由调用方（agent）消费。step 清空不影响返回值结构，因为 `nextDirective` 仍由 `computeNextDirective` 或 `internalCheckpoint` 返回值计算。agent 下一步调用 `auto_dev_next`，此时 orchestrator 从 null step 重新计算——这正是设计意图。无消费方兼容性问题。

### R2-4 消费方追踪

`skipSteps` 字段由 `auto_dev_init` 写入 state，由 `computeNextStep` 消费。`computeNextStep` 的唯一调用方在 `orchestrator.ts:1374`，需在此处从 state 读取 `skipSteps` 并传入。设计已覆盖此改动点。

---

## 4. 路径激活风险评估（规则 2: 休眠路径检测）

| 路径 | 状态 | 风险 |
|------|------|------|
| `orchestrator.ts:1024` `if (!stepState.step)` 首次初始化分支 | **已验证**（每次任务首次 `auto_dev_next` 调用时执行） | 低 |
| `internalCheckpoint` PASS 分支 | **已验证**（生产在用） | 低 |
| `isTddExemptTask` 函数 | **已验证**（现有 TDD 门禁在用） | 低 |
| `computeNextStep` 跳过逻辑（新增 skipSteps） | **未验证**（新代码） | 低（逻辑简单，AC-7/AC-8 覆盖） |
| Phase 3 -> Phase 4 全局 TDD BLOCK（R2-2 新增） | **未验证**（新代码路径） | 中，需 AC-3/AC-3b 测试覆盖 |

无首次激活的高风险休眠路径。R2-1 依赖的 `if (!stepState.step)` 分支是每次任务启动时的必经路径，已充分验证。

---

## 5. AC 覆盖度

| 改进 | AC 覆盖 | 评价 |
|------|---------|------|
| R2-1 | AC-1（step 清空）+ AC-2（orchestrator 重新计算）+ AC-9（回归） | 充分 |
| R2-2 | AC-3（BLOCK）+ AC-3b（全 exempt 放行）+ AC-9 | 充分 |
| R2-3 | AC-4（不存在时 fail）+ AC-5（存在时 pass）+ AC-9 | 充分 |
| R2-4 | AC-6（init 设置）+ AC-7（跳过 1b）+ AC-8（不跳过 4a）+ AC-9 | 充分 |

---

## 6. 问题汇总

| 级别 | 编号 | 描述 | 建议 |
|------|------|------|------|
| P2 | NEW-1 | R2-2 plan.md 解析建议复用 `extractTaskList` | 实现时检查 `extractTaskList` 返回值是否包含 task 编号信息，如可用则复用 |
| P2 | NEW-2 | R2-3 `fileExists` 无通用实现 | 使用 `stat` + try/catch 或 `readFileSafe` 做空值检查 |

---

## 7. 总结

**PASS**

第一轮提出的 5 个问题（1 个 P0 + 4 个 P1）全部在修订版中得到正确修复。核心修复（R2-1 step 清空让 orchestrator 重新接管）的设计原理清晰，代码验证确认根因分析准确。R2-4 的 `skipSteps` 方案比第一轮的 `shouldSkipStep()` 引用更务实，技术可行。AC 覆盖 9 条，覆盖了所有改进项的正向和边界场景。仅有 2 个 P2 级实现建议，不阻塞进入实施阶段。
