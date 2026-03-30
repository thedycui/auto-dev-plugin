# Design Review

## P0 (阻塞性问题)

### P0-1: `regressToPhase` 机制在 `computeNextTask` 中不存在 -- 设计描述的消费方逻辑需要从零实现

设计 4.2 节说："`computeNextTask` 中处理 `validation.regressToPhase` 的逻辑"，暗示已有基础设施可以复用。但经代码验证：

- `validateStep` 的返回类型声明了 `regressToPhase?: number`（第 401 行），但 `computeNextTask` 中 **从未读取** `validation.regressToPhase`（grep 搜索 `validation\.regressToPhase` 零匹配）。
- 现有的回退机制是 tribunal ESCALATE_REGRESS（第 772 行），走的是固定回退到 Phase 3 + `phaseEscalateCount` 计数器，与设计中 `shipRound` + `shipMaxRounds` 是完全不同的计数体系。

**风险**：这是一个 **休眠路径**（Dormant Path），`regressToPhase` 从 `validateStep` 返回后在 `computeNextTask` 中无人消费。设计需要明确：Phase 8 的 CODE_BUG 回退是通过新增通用 `regressToPhase` 处理分支实现，还是走类似 tribunal ESCALATE_REGRESS 的专用分支。

**修复建议**：在设计 4.2 节明确 `computeNextTask` 中新增 `regressToPhase` 处理的代码位置和逻辑——应在 `validation.passed === false` 但无 `tribunalResult` 的分支中（约第 806 行之后），先检查 `validation.regressToPhase`，如果有值则走 ship 回退逻辑（shipRound 递增、ESCALATE 判断），否则走现有 circuit breaker 逻辑。

### P0-2: `computeNextDirective` maxPhase 硬编码为 7，未感知 ship

设计 4.3 节说 `computeNextDirective` 的 `maxPhase` 计算需感知 ship。但当前代码（phase-enforcer.ts 第 111 行）：

```
const maxPhase = isDryRun ? 2 : mode === "turbo" ? 3 : 7;
```

这里硬编码了 `7`，而 `computeNextDirective` 的签名 `(currentPhase, status, state, regressTo?)` 虽然接收 `state`，但函数内部并未读取 `state.ship`。

**影响**：`computeNextDirective` 不仅被 `auto_dev_checkpoint` 调用（第 445 行附近），还是 Phase 推进的强制指令源。如果 `ship=true` 时 maxPhase 仍为 7，Phase 7 完成后会返回 "所有 Phase 已完成"（第 165 行），导致 checkpoint 路径认为任务已结束，与 orchestrator 的 Phase 8 追加逻辑矛盾。

**修复建议**：设计中需补充 `computeNextDirective` 的具体修改：`const maxPhase = isDryRun ? 2 : mode === "turbo" ? 3 : state.ship ? 8 : 7;` 并在 `PHASE_META` 中新增 Phase 8 条目。

## P1 (重要问题)

### P1-1: `validateCompletion` 新增参数改变函数签名，现有调用方需同步修改

设计 4.3 节说 `validateCompletion` 需新增第 5 个参数 `ship: boolean`。当前签名（phase-enforcer.ts 第 197-201 行）：

```typescript
export function validateCompletion(
  progressLogContent: string,
  mode: "full" | "quick" | "turbo",
  isDryRun: boolean,
  skipE2e: boolean = false,
): CompletionValidation
```

调用方在 `index.ts` 第 1304 行：`validateCompletion(progressLogContent, state.mode, state.dryRun === true, state.skipE2e === true)`。

设计 4.4 节提到了 `auto_dev_complete` 需传入 `state.ship === true`，这是正确的。但建议改用 options 对象模式 `validateCompletion(content, { mode, isDryRun, skipE2e, ship })` 以避免 5 个位置参数的可读性问题，并便于未来扩展。

**修复建议**：P1 不阻塞，但建议在设计中标注参数传递方式（追加位置参数 vs options 对象）。如果选择追加位置参数，需确保 `ship` 有默认值 `false`，以保证现有调用方不报错。

### P1-2: `PHASE_SEQUENCE` 不改但运行时动态追加 Phase 8，可能与现有测试断言冲突

设计说 `PHASE_SEQUENCE` 不改，Phase 8 在 `computeNextTask` 中运行时动态追加。当前代码（第 68-72 行）：

```typescript
const PHASE_SEQUENCE: Record<string, number[]> = {
  full: [1, 2, 3, 4, 5, 6, 7],
  quick: [3, 4, 5, 7],
  turbo: [3],
};
```

动态追加的方式 `phases = [...phases, 8]` 在功能上可行，但存在隐患：
- 如果其他地方直接引用 `PHASE_SEQUENCE[mode]` 而非 `computeNextTask` 中的 `phases` 局部变量，就不会包含 Phase 8。需确认无其他消费方。

经 grep 搜索，`PHASE_SEQUENCE` 仅在 `computeNextTask` 内部使用（第 688 行），无其他引用处，此风险可控。

**修复建议**：设计中可明确注明 "PHASE_SEQUENCE 仅在 computeNextTask 内部解引用，动态追加安全"，避免实现时产生疑虑。

### P1-3: Phase 8 step 8a-8d 全部映射到 `auto-dev-developer`，但 Phase 8 涉及 DevOps 操作

设计 4.2 节将 8a-8d 全部映射到 `auto-dev-developer` agent。但 Phase 8 的操作性质（git push、DevOps 构建、部署、远程验证）与 Phase 3 的代码实现有本质区别。当前 agent 类型用于 prompt 路由和 cost mode 选择（`getModel` 第 104-108 行只看 phase 编号），但未来如果 agent 映射影响权限或工具集，Phase 8 用 developer agent 可能不合适。

**修复建议**：当前 agent 映射只影响 `getModel` 路由，暂无实际风险。建议在设计中说明选择 `auto-dev-developer` 的理由（Phase 8 不需要额外 agent 类型，且不走 tribunal），避免实现时疑惑。

### P1-4: Step 8d CODE_BUG 回退到 Phase 3 后，Phase 4-7 的 CHECKPOINT 记录仍在 progress-log 中

Phase 8d 回退到 Phase 3 后，agent 重新实现代码，然后需要再次通过 Phase 4-7。但 progress-log 中之前的 Phase 4-7 PASS 记录仍然存在。`validateCompletion` 通过 regex 匹配 `CHECKPOINT phase=N status=PASS` 来判断完成，因此旧记录会让门禁误认为 Phase 4-7 已通过。

不过 orchestrator 模式下，完成门禁是由 `computeNextTask` 的步骤序列驱动（第 910-927 行），不依赖 `validateCompletion`。但 `auto_dev_complete` 仍然调用 `validateCompletion`（第 1304 行），需要确认不会被旧记录欺骗。

**修复建议**：设计中应明确回退后 progress-log 的处理策略——是追加回退标记（让 `validateCompletion` 只认最后一次记录），还是依赖 orchestrator 步骤序列不走 `validateCompletion`。建议追加一行 `<!-- CHECKPOINT phase=3 status=REGRESS_FROM_SHIP round=1 -->` 作为审计记录。

## P2 (优化建议)

### P2-1: `shipRound` 和 `shipMaxRounds` 可以复用现有 `regressionCount` 概念

State.json 已有 `regressionCount`（第 126 行），用于 tribunal ESCALATE_REGRESS 的回退计数。Phase 8 新增 `shipRound` + `shipMaxRounds` 是独立的计数体系。虽然语义不同（tribunal 回退 vs ship 回退），但可以考虑统一为通用的 "回退计数器" 避免概念膨胀。当前设计的独立方案也合理，仅作参考。

### P2-2: Step 8a 的 git unpushed 检查命令可能在特定 git 配置下失败

设计中 Step 8a 用 `git log --oneline --branches --not --remotes` 检测未 push 的 commit。这在没有设置 remote tracking branch 的情况下可能返回空（false positive），建议在 prompt 中引导 agent 先确认 remote tracking 关系。

### P2-3: 验收标准中缺少 Phase 8 回退后重新走 Phase 4-7 的集成测试 AC

AC-10 覆盖了 shipRound 递增和 ESCALATE，但没有覆盖回退后 orchestrator 是否正确从 Phase 3 重新走到 Phase 8。建议增加 AC-14：Phase 8d CODE_BUG 回退后，orchestrator 能从 Phase 3 正确推进到 Phase 8d。

## 跨组件影响分析

### 变更清单

| 序号 | 变更项 | 类型 |
|---|---|---|
| 1 | `StateJsonSchema` 新增 ship/deployTarget/deployBranch/deployEnv/verifyMethod/verifyConfig/shipRound/shipMaxRounds 字段 | Schema (types.ts) |
| 2 | `InitInputSchema` 新增同名参数 | Schema (types.ts) |
| 3 | `STEP_ORDER` 追加 8a-8d | 常量 (orchestrator.ts) |
| 4 | `STEP_AGENTS` 新增 8a-8d 映射 | 常量 (orchestrator.ts) |
| 5 | `firstStepForPhase()` 新增 8:"8a" | 函数 (orchestrator.ts) |
| 6 | `validateStep()` 新增 8a-8d case | 函数 (orchestrator.ts) |
| 7 | `computeNextTask()` 动态追加 Phase 8 + regressToPhase 处理 | 函数 (orchestrator.ts) |
| 8 | `buildTaskForStep()` 新增 8a-8d 模板渲染 | 函数 (orchestrator.ts) |
| 9 | `PHASE_META` 新增 Phase 8 | 常量 (phase-enforcer.ts) |
| 10 | `validateCompletion()` 新增 ship 参数 | 函数 (phase-enforcer.ts) |
| 11 | `computeNextDirective()` maxPhase 感知 ship | 函数 (phase-enforcer.ts) |
| 12 | `auto_dev_init` tool schema 新增 ship 参数 | MCP Tool (index.ts) |
| 13 | `auto_dev_complete` 调用 validateCompletion 传 ship | MCP Tool (index.ts) |
| 14 | `phase8-ship.md` prompt 模板 | 新文件 |

### 调用方影响

| 调用方 | 所在位置 | 影响类型 | 需同步修改 | 设计已覆盖 |
|---|---|---|---|---|
| `computeNextTask` (消费 STEP_ORDER) | orchestrator.ts:273,276 | 步骤遍历扩展 | 否（追加末尾安全） | 是 |
| `computeNextTask` (消费 PHASE_SEQUENCE) | orchestrator.ts:688 | 动态追加 Phase 8 | 是（新增 ship 条件） | 是 |
| `computeNextTask` (消费 validateStep 返回值) | orchestrator.ts:726-893 | 需处理 regressToPhase | 是（新增分支） | 部分（见 P0-1） |
| `auto_dev_complete` (调用 validateCompletion) | index.ts:1304 | 签名变更 | 是（追加 ship 参数） | 是 |
| `auto_dev_checkpoint` (调用 computeNextDirective) | index.ts:~445 | maxPhase 逻辑变更 | 否（computeNextDirective 内部修改） | 是 |
| `getModel` (消费 phase 编号) | orchestrator.ts:104-108 | Phase 8 未在 critical phases 列表中 | 否（默认返回 sonnet，合理） | 否（建议补充说明） |
| `buildTaskForStep` (stepToTemplate 映射) | orchestrator.ts:623-632 | 需新增 8a-8d 模板映射 | 是 | 是 |
| `APPROACH_PLAN_STEPS` | orchestrator.ts:617 | Phase 8 步骤是否需要 approach plan | 否（不需要） | 否（建议补充说明） |
| `MAX_ITERATIONS_PER_PHASE` (phase-enforcer.ts:33) | phase-enforcer.ts | Phase 8 无条目 | 否（返回 Infinity，不限制迭代） | 否（建议补充说明） |
| 现有测试 (orchestrator.test.ts, improvements.test.ts) | __tests__/ | STEP_ORDER 长度断言可能需更新 | 需验证 | 部分 |

### 无法验证的外部依赖

- `ship-loop skill` (SKILL.md) -- 设计说修改 SKILL.md 新增 ship 参数说明，但 skill 文件不在 mcp/src 内，路径为 `skills/auto-dev/SKILL.md`，需确认实际存在
- DevOps MCP 工具 (`devops_build`, `devops_deploy` 等) -- Phase 8 prompt 将引导 agent 调用这些工具，但工具可用性取决于运行时 MCP server 配置，设计中已在风险表中覆盖

## 结论

**NEEDS_REVISION**

核心原因：
1. **P0-1**：设计中 Phase 8 回退机制依赖的 `regressToPhase` 在 `computeNextTask` 中是一个从未被消费的休眠接口，需要明确新增处理分支的位置和逻辑
2. **P0-2**：`computeNextDirective` 的 maxPhase 硬编码会导致 Phase 7 完成后 checkpoint 路径误认为任务结束，与 orchestrator 的 Phase 8 推进逻辑矛盾

建议修复 P0-1 和 P0-2 后重新审查。P1 问题可在实现阶段处理。
