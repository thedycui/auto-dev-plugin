# 设计文档：auto-dev + ship-loop 交付集成（Phase 8）

## 1. 背景与目标

### 1.1 背景

auto-dev 的产出是**本地通过编译和测试的代码**，而代码要真正交付到测试环境还需要经过 commit、push、构建、部署、远程验证等步骤。目前这两段流程之间存在断裂，用户需要先执行 `/auto-dev` 完成本地开发，再手动调用 `/ship-loop` 完成交付验证。

### 1.2 目标

- 一条命令 `auto_dev_init(ship=true)` 即可从需求到测试环境验证通过，全程自动
- Phase 8 作为可选阶段，不影响现有 Phase 1-7 的行为
- 交付验证失败且判定为代码问题时，能自动回退到 Phase 3 修复

### 1.3 Non-Goals

- **不改造 ship-loop skill 本身**：ship-loop 仍可独立使用，Phase 8 是 auto-dev 框架内的原生实现，复用 ship-loop 的验证思路但不依赖其代码
- **不支持生产环境部署**：Phase 8 仅面向测试/预发环境
- **不做双向联动**：Phase 8 验证失败回退到 Phase 3 是单向的，不做 ship-loop 自动创建 auto-dev 修复任务的反向闭环

## 2. 现状分析

### 2.1 orchestrator 步骤编排

当前 orchestrator（`mcp/src/orchestrator.ts`）管理 Phase 1-7，通过以下核心数据结构驱动：

- `PHASE_SEQUENCE`：按 mode（full/quick/turbo）定义阶段序列，如 full = `[1,2,3,4,5,6,7]`
- `STEP_ORDER`：定义步骤的线性推进顺序 `["1a","1b","2a","2b","3","4a","5a","5b","6","7"]`
- `STEP_AGENTS`：每个步骤分配给哪个 agent（如 "1a" -> "auto-dev-architect"）
- `firstStepForPhase()`：phase 到首个 step 的映射（如 `1 -> "1a"`）
- `computeNextStep()`：根据当前 step 和 phases 列表计算下一步
- `validateStep()`：每个 step 的产出物验证逻辑（switch-case 分支）

`computeNextTask()` 是主循环入口，每次调用：加载 state -> 验证当前步骤 -> 推进到下一步或返回修订指令。

### 2.2 state.json 与行为标志

state.json 通过 `StateJsonSchema`（Zod v4）定义（`mcp/src/types.ts`），已有的行为标志包括 `interactive`、`dryRun`、`skipE2e`、`tdd`、`brainstorm`、`costMode` 等。所有标志均为 optional，通过 `auto_dev_init` 的 `behaviorUpdates` 机制写入 state.json。

### 2.3 完成门禁

- `validateCompletion()`（`mcp/src/phase-enforcer.ts`）根据 progress-log 中的 CHECKPOINT 记录判断所有必需 Phase 是否已 PASS
- `auto_dev_complete`（`mcp/src/index.ts`）调用 `validateCompletion` 做最终门禁
- 当前 `validateCompletion` 签名为 `(progressLogContent, mode, isDryRun, skipE2e)`，不感知 ship

### 2.4 tribunal 机制

Phase 4/5/6 使用 tribunal（独立 LLM 裁决）验证。Phase 7 不走 tribunal，仅检查 `retrospective.md` 产出物。Phase 8 的验证是硬数据驱动的（构建结果、部署状态、远程验证返回），不需要 LLM 裁决。

### 2.5 已有的 ship-loop skill

`~/.claude/skills/ship-loop/SKILL.md` 定义了独立的交付闭环流程（改代码->commit->push->构建->部署->验证->看日志），但它是无状态的 skill prompt，不与 auto-dev 的 state.json 和 orchestrator 集成。

## 3. 方案设计

### 方案 A：Phase 8 内嵌（推荐）

在 orchestrator 中新增 Phase 8，包含 4 个 step（8a-8d），作为 Phase 7 之后的可选阶段。Phase 8 的步骤由 orchestrator 原生管理，验证逻辑写在 `validateStep` 的 switch-case 中。

| 维度 | 评分 |
|------|------|
| 架构一致性 | 高 -- 与 Phase 1-7 共享同一套推进/验证/回退机制 |
| 审计完整性 | 高 -- progress-log 全覆盖所有 ship 步骤 |
| 回退能力 | 原生支持 -- orchestrator 已有 `regressToPhase` 模式 |
| 用户体验 | 最优 -- 一条命令全自动 |
| 改动量 | ~580 行（源码 300 + 测试 200 + prompt 80） |
| 维护成本 | 中 -- 与现有代码风格一致，后续可扩展 8e/8f |

### 方案 B：Phase 7.5 外挂钩子

Phase 7 完成后，通过 `auto_dev_complete` 中的钩子检测 `ship=true`，如果为 true 则不返回 COMPLETED，而是返回一段 ship-loop 调用指令让主 Agent 去执行 ship-loop skill。

| 维度 | 评分 |
|------|------|
| 架构一致性 | 低 -- 两套独立的状态体系需要协调 |
| 审计完整性 | 低 -- ship-loop 执行不在 auto-dev progress-log 中 |
| 回退能力 | 差 -- 需要重新 init auto-dev 才能回到 Phase 3 |
| 用户体验 | 中 -- 失败回退体验差，流程断裂 |
| 改动量 | ~120 行 |
| 维护成本 | 低（但跨系统调试成本高） |

### 方案对比总结

| 维度 | 方案 A（Phase 8 内嵌） | 方案 B（外挂钩子） |
|------|----------------------|-------------------|
| 改动量 | ~580 行 | ~120 行 |
| 架构一致性 | 完全一致 | 两套状态体系 |
| 审计完整性 | progress-log 全覆盖 | ship 部分无审计 |
| 回退能力 | 原生 regressToPhase | 需额外协调，体验差 |
| 用户体验 | 一条命令全自动 | 失败回退不连贯 |
| 可扩展性 | 高（可加 8e/8f） | 低（依赖 ship-loop 接口） |

### 选型结论

**选择方案 A（Phase 8 内嵌）**。核心理由：

1. 架构一致性是 auto-dev 框架的核心价值，Phase 8 作为原生阶段与 Phase 1-7 共享同一套步骤推进、验证、回退机制
2. 审计完整性对于自治开发至关重要，断裂的审计链会导致 retrospective 阶段无法覆盖交付环节
3. 回退到 Phase 3 是核心场景（远程验证发现代码 bug），方案 A 天然支持
4. 改动量差异（580 vs 120）在可接受范围内，且方案 A 的代码更易维护

## 4. 详细设计

### 4.1 数据模型变更

#### state.json 新增字段（types.ts / StateJsonSchema）

| 字段 | 类型 | 说明 | 默认值 |
|------|------|------|--------|
| `ship` | `z.boolean().optional()` | 是否启用 Phase 8 | undefined (等价 false) |
| `deployTarget` | `z.string().optional()` | DevOps 组件名 | - |
| `deployBranch` | `z.string().optional()` | 部署分支 | 当前 git 分支 |
| `deployEnv` | `z.string().optional()` | 目标环境 | "green" |
| `verifyMethod` | `z.enum(["api","log","test","combined"]).optional()` | 验证方式 | - |
| `verifyConfig` | 嵌套 object (optional) | 验证配置 | - |
| `shipRound` | `z.number().int().optional()` | 当前交付轮次 | 0 |
| `shipMaxRounds` | `z.number().int().optional()` | 最大交付轮次 | 5 |

`verifyConfig` 结构：`{ endpoint?, expectedPattern?, logPath?, logKeyword?, sshHost? }`，均为 optional string。

所有新字段均为 optional，未传 `ship=true` 的 session 中这些字段不存在，Zod 校验自动忽略。

#### auto_dev_init 新增参数

在 `index.ts` 的 init tool schema 中新增以上同名参数。`ship=true` 时 `deployTarget` 为必填（init 时校验，缺失返回错误）。

### 4.2 orchestrator 变更

#### 步骤定义扩展

| 常量/函数 | 变更内容 |
|-----------|---------|
| `STEP_ORDER` | 末尾追加 `"8a", "8b", "8c", "8d"` |
| `STEP_AGENTS` | 新增 `"8a"-"8d"` 全部映射到 `"auto-dev-developer"` |
| `firstStepForPhase()` | 新增 `8: "8a"` |
| `PHASE_SEQUENCE` | **不改** -- Phase 8 在运行时动态追加 |

#### 阶段序列动态追加

在 `computeNextTask` 中，现有逻辑：
```
let phases = PHASE_SEQUENCE[mode] ?? [3];
if (state.skipE2e === true) phases = phases.filter(p => p !== 5);
```
新增一行：
```
if (state.ship === true) phases = [...phases, 8];
```

这样 `computeNextStep()` 自然能找到 Phase 8 的步骤（因为 8 在 phases 中，8a-8d 在 STEP_ORDER 中）。

#### validateStep 新增 case 分支

| Step | 验证逻辑 | 失败时行为 |
|------|---------|-----------|
| 8a | `git log --oneline --branches --not --remotes` 输出为空 | feedback 提示 push |
| 8b | `ship-build-result.md` 存在且含 "SUCCEED" | feedback 提示查构建日志 |
| 8c | `ship-deploy-result.md` 存在且含 "SUCCEED" | feedback 提示查部署日志 |
| 8d | `ship-verify-result.md` 存在且含 "PASS" | 含 "CODE_BUG" 时返回 `regressToPhase: 3`；含 "ENV_ISSUE" 时返回普通失败 + ESCALATE 提示 |

#### Phase 8 回退处理

`computeNextTask` 中处理 `validation.regressToPhase` 的逻辑：

1. 检查 `shipRound + 1 >= shipMaxRounds`，是则 ESCALATE 并 BLOCKED
2. 否则：`atomicUpdate({ phase: 3, step: "3", stepIteration: 0, shipRound: shipRound + 1, lastValidation: "SHIP_REGRESS", approachState: null })`
3. 返回 Phase 3 的修复 prompt（包含 ship-verify-result.md 中的失败分析作为 feedback）

### 4.3 phase-enforcer 变更

| 函数 | 变更内容 |
|------|---------|
| `PHASE_META` | 新增 `8: { name: "SHIP", description: "交付验证" }` |
| `validateCompletion()` | 新增 `ship: boolean` 参数；当 `ship=true` 时将 8 追加到 requiredPhases |
| `computeNextDirective()` | maxPhase 计算需感知 ship：`ship=true` 时 maxPhase 为 8 |

注意：`validateCompletion` 目前签名为 `(progressLogContent, mode, isDryRun, skipE2e)`，需新增第 5 个参数 `ship`。调用方（`auto_dev_complete`）需传入 `state.ship === true`。

### 4.4 index.ts 变更

#### auto_dev_init

- tool schema 新增 ship 相关参数
- `behaviorUpdates` 中：当 `ship=true` 时写入所有 ship 字段，校验 `deployTarget` 必填
- INIT marker 新增 `ship=true/false` 字段

#### auto_dev_complete

- 调用 `validateCompletion` 时传入 `state.ship === true`

### 4.5 prompt 模板

新建 `skills/auto-dev/prompts/phase8-ship.md`，包含：
- Step 8a-8d 的分步指令
- 使用模板变量 `{{deployTarget}}`、`{{deployBranch}}`、`{{deployEnv}}`、`{{verifyMethod}}`
- 根据 verifyMethod 条件渲染 API 验证或日志验证的具体命令
- 明确的产出物文件写入规范（文件名、必须包含的关键词）
- CODE_BUG vs ENV_ISSUE 的判定指引

`buildTaskForStep` 需新增对 step "8a"-"8d" 的处理，渲染 phase8-ship 模板。变量来源为 state 中的 ship 相关字段。

### 4.6 不改动的部分

- Phase 1-7 全部不改
- 现有测试全部不改（Phase 8 步骤在 STEP_ORDER 末尾，phases 不含 8 时自动跳过）
- ship-loop skill 本身不改（仍可独立使用）
- tribunal 机制不改（Phase 8 不走 tribunal）

## 5. 影响分析

### 5.1 改动文件清单

| 文件 | 改动类型 | 改动概述 |
|------|---------|---------|
| `mcp/src/types.ts` | 修改 | StateJsonSchema + InitInputSchema 新增 ship 字段 |
| `mcp/src/orchestrator.ts` | 修改 | STEP_ORDER、STEP_AGENTS、firstStepForPhase 扩展；validateStep 新增 8a-8d case；computeNextTask 动态追加 Phase 8 + 回退逻辑 |
| `mcp/src/index.ts` | 修改 | init 参数处理 + behaviorUpdates；complete 传 ship 参数 |
| `mcp/src/phase-enforcer.ts` | 修改 | PHASE_META 新增；validateCompletion + computeNextDirective 扩展 |
| `skills/auto-dev/prompts/phase8-ship.md` | 新建 | Phase 8 prompt 模板 |
| `skills/auto-dev/SKILL.md` | 修改 | 新增 ship 参数说明 |
| `mcp/src/__tests__/orchestrator.test.ts` | 修改 | Phase 8 步骤推进、回退、ESCALATE 测试 |
| `mcp/src/__tests__/improvements.test.ts` | 修改 | validateCompletion ship 参数测试 |

### 5.2 兼容性

- **向后兼容**：所有新字段 optional，未传 `ship=true` 的 session 行为不变
- **现有测试**：不受影响（Phase 8 在 STEP_ORDER 末尾，未启用时被 phases 过滤跳过）
- **STEP_ORDER 扩展安全性**：`computeNextStep` 按 phases 列表过滤 candidate，Phase 8 不在 phases 中时 8a-8d 自动跳过

### 5.3 迁移路径

无需迁移。新功能通过 init 参数激活，不改变任何默认行为。已有的 auto-dev session（state.json 中无 ship 字段）等价于 `ship=false`。

### 5.4 预估改动量

- 源代码：~300 行
- 测试代码：~200 行
- prompt 模板：~80 行
- 总计：~580 行

不属于小任务快捷模式范围，需要走 auto-dev 全流程。

## 6. 风险与缓解

| 风险 | 严重度 | 缓解措施 |
|------|--------|---------|
| Phase 8 回退到 Phase 3 后死循环 | 高 | `shipMaxRounds` 限制（默认 5），超过 ESCALATE + BLOCKED |
| DevOps MCP 不可用或超时 | 中 | 构建/部署超时后 ESCALATE，不阻塞整个 session |
| 远程验证误判 CODE_BUG vs ENV_ISSUE | 中 | prompt 引导 agent 区分；ENV_ISSUE 直接 ESCALATE 不回退，避免无效循环 |
| 分支冲突（push 失败） | 中 | Step 8a agent 负责处理 merge conflict；多次失败触发 iteration limit -> ESCALATE |
| Phase 8 新增字段污染现有 state | 低 | 所有新字段 optional，Zod 校验保证类型安全 |
| STEP_ORDER 扩展影响 computeNextStep | 低 | 8a-8d 追加在末尾，phases 过滤机制确保不含 Phase 8 时跳过 |

### 回滚方案

1. **用户级**：不传 `ship=true` 即可，Phase 8 完全不激活，零影响
2. **代码级**：新增代码集中在明确的 case 分支和条件判断（`if (state.ship === true)`）中，可独立移除而不影响 Phase 1-7

## 7. 验收标准

| AC | 描述 | 验证方式 |
|----|------|---------|
| AC-1 | `auto_dev_init(ship=true, deployTarget="app")` 成功初始化，state.json 中包含 `ship: true`、`deployTarget: "app"`、`shipRound: 0`、`shipMaxRounds: 5` | 单元测试 |
| AC-2 | `auto_dev_init(ship=true)` 不传 `deployTarget` 时返回 `MISSING_DEPLOY_TARGET` 错误，不创建 session | 单元测试 |
| AC-3 | `auto_dev_init()` 不传 `ship` 时，state.json 中无 ship 相关字段，Phase 7 完成后 `computeNextStep` 返回 null（COMPLETED） | 单元测试 |
| AC-4 | full 模式 + `ship=true` 时，`computeNextTask` 的 phases 列表为 `[1,2,3,4,5,6,7,8]`；Phase 7 PASS 后下一步为 "8a" | 单元测试 |
| AC-5 | `skipE2e=true` + `ship=true` 时，phases 为 `[1,2,3,4,6,7,8]`（跳过 5 但保留 8） | 单元测试 |
| AC-6 | Step 8a 验证：git 有 unpushed commit 时返回 `passed: false`；无 unpushed 时返回 `passed: true` | 单元测试 |
| AC-7 | Step 8b 验证：`ship-build-result.md` 不存在或不含 "SUCCEED" 时返回 `passed: false`；存在且含 "SUCCEED" 时返回 `passed: true` | 单元测试 |
| AC-8 | Step 8c 验证：`ship-deploy-result.md` 不存在或不含 "SUCCEED" 时返回 `passed: false`；存在且含 "SUCCEED" 时返回 `passed: true` | 单元测试 |
| AC-9 | Step 8d 验证：`ship-verify-result.md` 含 "PASS" 时返回 `passed: true`；含 "CODE_BUG" 时返回 `passed: false` 且 `regressToPhase: 3`；含 "ENV_ISSUE" 时返回 `passed: false` 且无 `regressToPhase` | 单元测试 |
| AC-10 | Step 8d CODE_BUG 回退后 `shipRound` 递增为 1；当 `shipRound >= shipMaxRounds` 时返回 ESCALATE（`escalation.reason = "ship_max_rounds"`）而非继续回退 | 单元测试 |
| AC-11 | `validateCompletion(ship=true)` 要求 Phase 8 在 progress-log 中有 PASS 记录才能完成；`ship=false` 时不要求 Phase 8 | 单元测试 |
| AC-12 | Phase 8 步骤不触发 tribunal（validateStep 中 8a-8d 不调用 `evaluateTribunal`） | 代码审查 |
| AC-13 | `phase8-ship.md` prompt 模板存在且包含 Step 8a-8d 的分步指令，能通过 TemplateRenderer 正确渲染 `{{deployTarget}}` 等变量 | 运行验证 |
