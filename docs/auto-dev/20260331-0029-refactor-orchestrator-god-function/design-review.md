# Design Review

**Topic**: refactor-orchestrator-god-function (IMP-001)
**Reviewer**: Auto-Dev Design Reviewer
**Date**: 2026-03-31

---

## P0 (阻塞性问题)

无。

## P1 (重要问题)

### P1-1: OrchestratorContext 缺少 `effectiveCodeRoot` 字段

设计文档 4.3 节定义的 `OrchestratorContext` 接口包含 `projectRoot` 但缺少 `effectiveCodeRoot`（`state.codeRoot ?? projectRoot`）。而当前代码中 `validateStep` 调用（Line 1153）使用的是 `effectiveCodeRoot` 而非 `projectRoot`。如果 `handleValidationFailure` 内部需要调用 `validateStep` 或传递代码根目录给下游，使用 `projectRoot` 会导致 skill 项目（codeRoot != projectRoot）场景下路径错误。

**修复建议**: 在 `OrchestratorContext` 中增加 `effectiveCodeRoot: string` 字段，或将 `projectRoot` 在构建 context 时直接替换为 `effectiveCodeRoot`（因为原始 `projectRoot` 在 context 构建后不再被单独使用）。

### P1-2: `handleTribunalEscalation` 已有函数的 `buildTaskForStep` 调用缺少 `getExtraVars` 参数

已提取的 `handleTribunalEscalation`（Line 642）调用 `buildTaskForStep("3", ...)` 时没有传递 `getExtraVars`。这与内联代码（Line 1282）行为一致——两者都缺少 `getExtraVars`。但设计文档说要引入 `OrchestratorContext`（包含 `getExtraVars`），如果后续 Phase 3 的某些 step（如 "3" 本身）需要 extraVars，回退时会丢失。当前实际上 `getExtraVars` 仅对 Phase 8 step 生效（Line 1043-1048），Phase 3 step 不需要，所以**目前无运行时影响**。但设计应明确说明：在替换调用点时，已提取函数也需要更新签名以接收 `ctx: OrchestratorContext`，从而自然获得 `getExtraVars` 的访问权，即使当前不使用。

**修复建议**: 设计文档 4.1 节 "消除重复：替换 Tribunal 内联代码" 表格中应补充说明：5 个已提取函数的签名需要统一改为接收 `OrchestratorContext`，而非保持当前的散装参数列表。否则会出现"新提取函数用 context，旧提取函数用散装参数"的不一致。

### P1-3: `stepState` 未包含在 `OrchestratorContext` 中，但被多个提取函数需要

设计 4.1 节描述 `handleValidationFailure` 的输入包含 `stepState`，而 `advanceToNextStep` 不包含。但 `OrchestratorContext` 中没有 `stepState`，这意味着 `stepState` 需要作为额外参数传递。而 `stepState` 中包含 `approachState` 和 `stepIteration`，在 `handleValidationFailure` 的 circuit breaker（Line 1345-1346）和 iteration limit（Line 1386-1387）逻辑中被使用。设计应明确 `stepState` 的传递方式。

**修复建议**: 要么将 `stepState` 加入 `OrchestratorContext`（它在 `computeNextTask` 入口处就已确定），要么在设计中明确说明 `stepState` 作为 `handleValidationFailure` 的第二个参数传入（当前设计 4.1 节的函数签名描述已含 stepState，但与 context 模式不一致，建议统一）。

### P1-4: ApproachState Schema 的 `.catch(null)` fallback 风险说明不足

设计在风险表中提到对 `approachState` 字段加 `.catch(null)` fallback。但 `approachState` 为 null 会导致进行中的 circuit breaker 状态丢失——如果某个 session 正在方案切换中途（`approachState.currentIndex > 0`），schema 升级后 `.catch(null)` 会将其重置为 null，导致方案切换逻辑从头开始（`handleApproachFailure` Line 357 会重新初始化 approaches）。

**修复建议**: 设计应补充说明 `.catch(null)` 的触发条件应仅限于 schema 解析失败的场景（即 `approachState` 数据结构不符合新 schema），而非所有场景。建议使用 `.catch(undefined)` 或更精细的 `.safeParse()` + fallback 策略，并在迁移步骤中说明：如果现有 `approachState` 数据已经符合 `ApproachState` 接口（实际上应该都符合，因为写入方就是 orchestrator 自己），则不会触发 fallback。

## P2 (优化建议)

### P2-1: 设计未提及 `validation` 对象的传递

`handleValidationFailure` 需要 `validation` 结果对象（包含 `passed`, `feedback`, `tribunalResult`, `regressToPhase` 等字段），设计 4.1 节列出了 "validation result" 作为输入但未明确其类型。建议在设计中显式引用 `validateStep` 的返回类型（当前是内联的匿名类型），考虑是否需要先将其提取为命名类型。

### P2-2: 已提取函数中 `handleTribunalCrash` 的 catch 块为空（best-effort）

Line 514 `catch { /* best-effort */ }` 与上一轮 IMP-006 的修复方向（替换 silent catch 为 console.error）不一致。既然本次重构会触碰这些函数的调用方式，建议顺手将 `handleTribunalCrash` 的空 catch 改为 `catch (e) { console.error("[orchestrator] handleTribunalCrash error:", e); }`。

### P2-3: 测试策略可以更具体

AC-5/6/7 描述了新增单测的覆盖场景，但未说明如何 mock `StateManager` 和 `validateStep`。当前 `orchestrator.test.ts` 使用 `jest.unstable_mockModule` 来 mock 整个模块。建议设计中说明新提取函数是否导出（仅测试用 export），还是通过继续调用 `computeNextTask` 间接测试。

---

## 跨组件影响分析

### 变更清单

| 序号 | 变更项 | 类型 |
|------|--------|------|
| 1 | `computeNextTask` 函数内部重构（签名不变） | 函数（内部） |
| 2 | `ApproachState` 接口从 orchestrator.ts 迁移到 types.ts | 接口/类型 |
| 3 | `ApproachStateSchema` 新增 Zod schema | 类型 |
| 4 | `StateJsonSchema.approachState` 从 `z.any()` 改为 `ApproachStateSchema` | Schema 字段 |
| 5 | `OrchestratorContext` 新增接口 | 接口（内部） |
| 6 | `resolveInitialStep` / `handleValidationFailure` / `advanceToNextStep` 新增函数 | 函数（内部） |

### 调用方影响

| 调用方 | 所在位置 | 影响类型 | 需同步修改 | 设计已覆盖 |
|--------|----------|----------|-----------|-----------|
| `auto_dev_next` handler | `mcp/src/index.ts:1958` | 调用 `computeNextTask`，签名不变 | 否 | 是（Non-Goals 明确声明） |
| `orchestrator.test.ts` | `mcp/src/__tests__/orchestrator.test.ts:88-89` | import `computeNextTask`, `ApproachState` | 是 — `ApproachState` 导入路径变更 | 部分覆盖（AC-8 提到 re-export 向后兼容，但测试文件可能需要更新 import） |
| `ship-integration-e2e.test.ts` | `mcp/src/__tests__/ship-integration-e2e.test.ts:83` | import `computeNextTask`, `validateStep` | 否（签名不变） | 是 |
| `state-manager.ts` `loadAndValidate` | `mcp/src/state-manager.ts:223` | 使用 `StateJsonSchema` 解析 state.json | 是 — schema 变更影响解析行为 | 是（设计 4.2 + 风险表 Row 2 覆盖） |

**搜索证据**:
- `computeNextTask` 调用方: `index.ts:1958`, `orchestrator.test.ts`, `ship-integration-e2e.test.ts` (grep 验证)
- `ApproachState` 引用方: `orchestrator.ts` 内部 + `orchestrator.test.ts:89` (grep 验证)
- `StateJsonSchema` 消费方: `state-manager.ts:loadAndValidate` 中 `StateJsonSchema.parse()` (grep 验证)
- `NextTaskResult` 不变，无影响

### 其他影响维度

- **API 兼容性**: 无 breaking change。`computeNextTask` 签名和 `NextTaskResult` 返回类型均不变。`ApproachState` 通过 re-export 保持向后兼容。
- **共享状态**: `state.json` 的 `approachState` 字段 schema 变更（`z.any()` -> `ApproachStateSchema`）。设计已覆盖向后兼容（AC-9）。
- **部署顺序**: 纯内部重构，无部署顺序要求。单一 npm package，编译即生效。

---

## 结论

**NEEDS_REVISION**

核心设计思路正确，方案 B 的选型合理，问题陈述清晰，验收标准充分。但有 4 个 P1 问题需要在实现前修正：

1. `OrchestratorContext` 缺少 `effectiveCodeRoot`，可能导致 skill 项目场景路径错误
2. 已提取函数签名需要统一改为接收 `OrchestratorContext`，避免新旧函数参数风格不一致
3. `stepState` 的传递方式需要在设计中明确
4. `.catch(null)` fallback 对进行中 session 的影响需要更精细的说明

建议修正上述 P1 问题后即可进入实现计划阶段。
