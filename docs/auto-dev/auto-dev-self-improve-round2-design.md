# Auto-Dev 自评改进方案（Round 2）

**日期**: 2026-03-30
**来源**: internal-quality-triple-fix 任务自评
**改动类型**: bugfix + enhancement

---

## 1. 背景与目标

### 1.1 为什么做

在 `internal-quality-triple-fix` 任务执行中暴露了 4 个框架层面的问题：

1. **Phase 4 tribunal 卡死**（P0）：tribunal 裁决提交 3 次但 step 不推进，需手动编辑 state.json
2. **TDD 门禁空状态绕过**（P1）：`tdd=true` 但 `tddTaskStates` 为空时，Phase 3 checkpoint 可正常通过
3. **Phase 5 对框架类项目覆盖不足**（P2）：Phase 5 有完整的测试执行+独立验证机制，但 5a（测试设计）是 pass-through，对框架类项目未利用自举验证能力
4. **小改进项设计审查成本过高**（P2）：S 级改进仍需走完整 Phase 1 设计+审查，占总时间 42%

### 1.2 做什么

| # | 改进项 | 优先级 | 预估改动 |
|---|--------|--------|---------|
| R2-1 | 修复 tribunal verdict 后 step 推进缺失 | P0 | ~15 行 |
| R2-2 | TDD 门禁增加 tddTaskStates 非空校验 | P1 | ~20 行 |
| R2-3 | Phase 5a 对自举项目增加 smoke test 要求 | P2 | ~10 行 |
| R2-4 | 小改进项支持跳过设计审查的 lightweight 模式 | P2 | ~25 行 |

### 1.3 Non-Goals

- 不重构 Phase 4 的三级执行策略（Hub > Subagent > CLI）
- 不改变 Phase 5b 的独立测试验证机制（已经够好）
- 不引入新的 auto-dev 模式（复用现有 full/quick/turbo 体系）

---

## 2. 现状分析

### 2.1 R2-1: Tribunal Step 推进 Bug

**根因分析**：

调用链：`auto_dev_next()` → `computeNextTask()` → `validateStep("4a")` → tribunal 返回 `subagentRequested=true` → 返回 escalation

```
orchestrator.ts:1091-1108  // step 保持 "4a"，返回 escalation
  ↓
index.ts:1906-1923  // auto_dev_tribunal_verdict 收到 PASS
  → internalCheckpoint(sm, state, phase=4, "PASS", ...)
    → state-manager.ts:627-656  // 只更新 phase, status
    → 不更新 step, stepIteration, lastValidation
  ↓
auto_dev_next() 再次被调用
  → state: {phase: 4, status: "PASS", step: "4a"}  // step 未推进！
  → validateStep("4a") 再次触发 tribunal
  → 死循环
```

**缺失逻辑**：`auto_dev_tribunal_verdict` 在 PASS 分支中，仅调用了 `internalCheckpoint` 更新 phase/status，但没有：
1. 调用 `computeNextStep()` 计算下一步
2. 更新 `step`、`stepIteration`、`lastValidation`、`approachState`

### 2.2 R2-2: TDD 门禁空状态绕过

**当前门禁逻辑**（`index.ts:835-851`）：

```
if (phase === 3 && status === "PASS" && state.tdd === true && task != null) {
  if (!isTddExemptTask(...)) {
    if (state.tddTaskStates?.[String(task)].status !== "GREEN_CONFIRMED") {
      → BLOCK: TDD_GATE_INCOMPLETE
    }
  }
}
```

**绕过场景**：
- Agent 不调用 `auto_dev_task_red` / `auto_dev_task_green`，`tddTaskStates` 始终为空/undefined
- Phase 3 checkpoint 时如果 task 为 exempt 或 developer agent 以整体完成（不按 task 逐个 checkpoint），门禁不触发
- Phase 4 tribunal checklist 有 TDD 检查项（Section C），但依赖 reviewer agent 手动检查 state.json，不是硬性阻断

**已有测试确认**（`tdd-gate-integration.test.ts:220-228`）：空 tddTaskStates 在特定 task 上会被阻断，但在不传 task 参数或全部 exempt 时可绕过。

### 2.3 R2-3: Phase 5a Pass-Through

**当前行为**（`orchestrator.ts:730-733`）：

```typescript
case "5a": {
  return { passed: true, feedback: "" };  // 直接通过，无验证
}
```

Phase 5a 的 prompt 模板（`phase5-test-architect.md`）要求 agent 输出 `e2e-test-cases.md`，但 orchestrator 不检查该文件是否存在或质量。5b 有完整的测试执行+独立验证，但 5a 是纯 pass-through。

对框架类项目（如 auto-dev 自身），5a 可以增加一条自举验证要求：用修改后的代码执行一次简单的 `auto_dev_init → auto_dev_state_get` 循环，验证基本功能不 broken。

### 2.4 R2-4: 设计审查成本

**当前**：所有 full 模式任务都走 Phase 1a（设计）→ 1b（设计审查）→ 2a（计划）→ 2b（计划审查），共 4 个 agent 调用。

**问题**：S 级改进（<30 行，1-2 文件）花 12 分钟做设计+审查，占总时间 42%。

**quick 模式已存在**：跳过 Phase 1 和 2，直接从 Phase 3 开始。但 quick 模式也跳过了 Phase 4 的 tribunal 审查，丧失了质量保障。

**需要的是**：一种 "lightweight" 路径——跳过设计审查（1b）和计划审查（2b），但保留设计（1a）、计划（2a）和 tribunal 审查（4a）。

---

## 3. 方案设计

### 方案 A：最小修复 + 增量增强（推荐）

逐个修复，每个改进独立可交付、可回滚。

| 改进 | 方案 |
|------|------|
| R2-1 | 在 `auto_dev_tribunal_verdict` PASS 分支中，增加 step 推进逻辑：读取 orchestrator 的 `computeNextStep()`，更新 `step`/`stepIteration`/`lastValidation` |
| R2-2 | 在 Phase 3 → Phase 4 过渡时（`computeNextTask` 中 phase 3 完成后），增加全局 TDD 校验：若 `tdd=true`，检查 plan.md 中非 exempt task 数量 vs tddTaskStates 中 GREEN_CONFIRMED 数量，不匹配则 BLOCK |
| R2-3 | Phase 5a `validateStep` 中增加条件：若项目是自举场景（`projectRoot` 包含 auto-dev 相关路径或 `topic` 包含自举关键词），要求 `e2e-test-cases.md` 存在 |
| R2-4 | 新增 `reviewLevel` 状态字段（`"full"` / `"lightweight"`），当 `estimatedLines <= 50 && estimatedFiles <= 3` 时自动设为 lightweight，跳过 1b 和 2b 步骤 |

**优点**：
- 每个修复独立，可逐个交付和验证
- R2-1 直接修复 P0 根因
- R2-4 复用现有 step 跳过机制（orchestrator 已支持 `shouldSkipStep()`）

**缺点**：
- R2-4 引入新状态字段，增加 state schema 复杂度
- R2-2 需要解析 plan.md 统计 task 数量，有文本解析风险

### 方案 B：Phase 4 完全重构 + 集成修复

重构 Phase 4 的 tribunal 执行模式，将 subagent fallback 从 "委托+轮询" 改为 "同步等待+自动推进"，在重构过程中一并修复 R2-1～R2-4。

**优点**：
- 从根本上消除 step/tribunal 的状态不一致问题
- 统一代码路径，减少 escalation 复杂度

**缺点**：
- 改动范围大（~200 行），风险高
- Phase 4 tribunal 的三级策略是经过多轮迭代稳定下来的，重构可能引入新问题
- R2-2/R2-3/R2-4 被捆绑在一个大改动中，无法独立回滚

### 方案对比

| 维度 | 方案 A（增量修复） | 方案 B（重构） |
|------|-------------------|---------------|
| 改动行数 | ~70 行（分 4 个 commit） | ~200 行（1-2 个 commit） |
| 风险 | 低（每个修复独立） | 中高（Phase 4 核心逻辑重构） |
| 可回滚性 | 逐个 revert | 整体 revert |
| R2-1 根治程度 | 治标（补充 step 推进）| 治本（消除 step/tribunal 状态分离） |
| 交付节奏 | R2-1 立即修复，其他可排期 | 全部一起交付 |

**选择方案 A**。理由：R2-1 是 P0 需要立即修复，方案 A 可以在 15 分钟内修复并验证；方案 B 的 Phase 4 重构风险太高，且三级执行策略是经过 5 轮迭代才稳定的，不值得为了一个 step 推进 bug 而重构。

---

## 4. 详细设计

### 4.1 R2-1: 修复 tribunal verdict step 推进

**修改文件**：`mcp/src/index.ts`

**修改位置**：`auto_dev_tribunal_verdict` 的 PASS 分支（约 1906-1923 行）

**修改内容**：在 `internalCheckpoint` 调用成功后，增加 step 推进：

1. 从 orchestrator 导入 `computeNextStep(phase, step)` 函数（当前未导出，需导出）
2. 调用 `computeNextStep(phase, currentStep)` 获取下一步
3. 调用 `sm.atomicUpdate({ step: nextStep, stepIteration: 0, lastValidation: null, approachState: null })`

**需要从 orchestrator 导出的函数**：

- `computeNextStep(phase: number, currentStep: string): string | null` — 计算当前 step 的下一步。当前是 orchestrator 内部的 `advanceStep()` 逻辑（约 1393-1399 行），需要提取为独立导出函数。

**边界处理**：
- 若 `computeNextStep` 返回 `null`（当前 phase 的最后一步），说明应该推进到下一 phase — 这已由 `internalCheckpoint` 处理，step 设为新 phase 的起始步骤即可
- 若 verdict 是 FAIL，不推进 step（保持现有行为）

### 4.2 R2-2: TDD 门禁全局校验

**修改文件**：`mcp/src/orchestrator.ts`

**修改位置**：`computeNextTask()` 中 Phase 3 完成后推进到 Phase 4 的逻辑

**修改内容**：

在 Phase 3 status=PASS 且 `state.tdd === true` 时，增加全局校验：

1. 读取 `plan.md`，统计非 exempt task 数量（匹配 `## Task N` 但不包含 `**TDD**: skip`）
2. 统计 `state.tddTaskStates` 中 `status === "GREEN_CONFIRMED"` 的数量
3. 若 GREEN_CONFIRMED 数量 < 非 exempt task 数量，返回 BLOCK

**复用现有能力**：
- `isTddExemptTask(taskNum, planPath)` 函数已存在于 `index.ts`，需要导出供 orchestrator 使用
- 或者直接在 orchestrator 中实现简化版本：检查 `tddTaskStates` 是否为空（当有非 exempt task 时）

**简化方案**（推荐）：不解析 plan.md，仅检查 `tddTaskStates` 是否为空。如果 `tdd=true` 且 `tddTaskStates` 为空或 undefined，在进入 Phase 4 前发出 WARNING（写入 progress-log），不硬性阻断（因为可能所有 task 都是 exempt）。在 Phase 4 tribunal checklist 中已有硬性检查。

### 4.3 R2-3: Phase 5a 自举验证

**修改文件**：`mcp/src/orchestrator.ts`

**修改位置**：`validateStep("5a")` 的 case 分支（约 730-733 行）

**修改内容**：

将 pass-through 改为条件验证：

```
case "5a": {
  const hasTestCases = await fileExists(join(outputDir, "e2e-test-cases.md"));
  if (!hasTestCases) {
    return { passed: false, feedback: "e2e-test-cases.md 不存在" };
  }
  return { passed: true, feedback: "" };
}
```

仅增加文件存在性检查，不做内容质量判断（内容由 5b 的 tribunal 审查）。

### 4.4 R2-4: Lightweight 审查模式

**修改文件**：`mcp/src/orchestrator.ts`

**修改位置**：
1. `shouldSkipStep()` 函数（已存在，控制步骤跳过逻辑）
2. `auto_dev_init` 中 `reviewLevel` 自动判定

**修改内容**：

1. 在 `auto_dev_init` 中，当 `estimatedLines <= 50 && estimatedFiles <= 3` 时，设置 `state.reviewLevel = "lightweight"`
2. 在 `shouldSkipStep()` 中，当 `reviewLevel === "lightweight"` 时，跳过 `"1b"` 和 `"2b"` 步骤
3. Phase 4 tribunal 审查保持不变（不跳过）

**State Schema 变更**：新增 optional 字段 `reviewLevel?: "full" | "lightweight"`，默认 `"full"`。

---

## 5. 影响分析

### 5.1 改动范围

| 改进 | 文件 | 改动类型 | 行数 |
|------|------|---------|------|
| R2-1 | `index.ts` | 修改 tribunal_verdict PASS 分支 | +10 |
| R2-1 | `orchestrator.ts` | 导出 computeNextStep 函数 | +5 |
| R2-2 | `orchestrator.ts` | Phase 3→4 过渡增加 TDD WARNING | +15 |
| R2-3 | `orchestrator.ts` | 5a validateStep 增加文件检查 | +5 |
| R2-4 | `orchestrator.ts` | shouldSkipStep 增加 lightweight 逻辑 | +10 |
| R2-4 | `index.ts` | auto_dev_init 增加 reviewLevel 判定 | +5 |
| 测试 | `orchestrator.test.ts` | R2-1/R2-3 测试 | +40 |
| 测试 | `index.test.ts` 或新文件 | R2-2/R2-4 测试 | +30 |
| **总计** | | | **~120 行** |

### 5.2 兼容性

- `state.json` 新增 optional 字段 `reviewLevel`，向后兼容（旧 state 无此字段时默认 `"full"`）
- `computeNextStep` 从 orchestrator 导出为新的 named export，不影响现有调用方
- Phase 5a 从 pass-through 变为有条件验证，可能导致旧任务在 5a 失败（需要确保 prompt 模板要求输出 `e2e-test-cases.md`）

### 5.3 回滚方案

每个改进独立 commit，可逐个 `git revert`。R2-1 是纯 bug 修复，回滚后回到"手动编辑 state.json"的 workaround。

---

## 6. 风险与缓解

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| R2-1 `computeNextStep` 导出后被错误调用 | 低 | 中 | 函数名加 `_internal` 后缀或 JSDoc 标注 internal |
| R2-2 TDD WARNING 误报（所有 task 都 exempt） | 中 | 低 | 仅 WARNING 不 BLOCK，不影响流程 |
| R2-3 Phase 5a 文件检查导致旧任务失败 | 低 | 中 | 检查 prompt 模板已要求输出该文件 |
| R2-4 lightweight 模式跳过审查后质量下降 | 中 | 中 | Phase 4 tribunal 审查保持不变，作为最后防线 |

---

## 7. 验收标准

| AC | 描述 | 验证方式 |
|----|------|---------|
| AC-1 | `auto_dev_tribunal_verdict` PASS 后，state.json 的 `step` 从 `"4a"` 推进到下一步（`"5a"` 或 `null`），不再卡死 | 单元测试：mock tribunal PASS → 验证 state.step !== "4a" |
| AC-2 | `auto_dev_next` 在 tribunal PASS 后立即返回下一 phase 的任务，不再重复返回 tribunal escalation | 单元测试：连续调用 auto_dev_next，验证第二次不返回 escalation |
| AC-3 | `tdd=true` 且 `tddTaskStates` 为空时，Phase 3→4 过渡写入 `<!-- TDD_WARNING -->` 到 progress-log | 单元测试：构造空 tddTaskStates → 验证 progress-log 包含 WARNING |
| AC-4 | Phase 5a 当 `e2e-test-cases.md` 不存在时返回 `passed: false` | 单元测试 |
| AC-5 | Phase 5a 当 `e2e-test-cases.md` 存在时返回 `passed: true` | 单元测试 |
| AC-6 | `estimatedLines <= 50 && estimatedFiles <= 3` 时，`auto_dev_init` 设置 `reviewLevel: "lightweight"` | 单元测试 |
| AC-7 | `reviewLevel === "lightweight"` 时，`auto_dev_next` 跳过步骤 `"1b"` 和 `"2b"` | 单元测试：验证 shouldSkipStep 返回 true |
| AC-8 | `reviewLevel === "lightweight"` 时，Phase 4 tribunal 审查不被跳过 | 单元测试：验证步骤 `"4a"` 不被跳过 |
| AC-9 | 已有测试全部通过（不破坏任何现有功能） | `npm test` |

---

## 8. 实施顺序

```
R2-1 (P0, 15行) → commit → 验证
  ↓
R2-2 (P1, 15行) → commit → 验证
  ↓
R2-3 (P2, 5行) → R2-4 (P2, 15行) → commit → 验证
```

R2-1 立即修复。R2-2 跟随。R2-3 和 R2-4 可合并为一个 commit（都是 orchestrator 增强）。
