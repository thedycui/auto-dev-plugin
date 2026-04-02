# IMP-001: orchestrator.ts computeNextTask God Function 拆分

## 背景与目标

### 为什么做

`orchestrator.ts` 是 auto-dev MCP Server 的核心编排引擎，其中 `computeNextTask()` 函数（Line 1003-1515，约 512 行）承担了以下职责：

1. **状态加载与配置解析** — 加载 state.json、解析 mode/phases/skipSteps 等配置
2. **首次启动路由** — 无 step 时判断首个 phase/step，含 design doc 合规跳过逻辑
3. **PASS 状态推进** — tribunal_verdict 通过后的 phase 推进
4. **步骤验证** — 调用 validateStep 判断当前步骤是否通过
5. **Tribunal 失败处理** — subagent 委托、parse failure、crash fallback、escalation regress 等 4 种分支
6. **非 Tribunal 失败处理** — circuit breaker、iteration limit、revision step 映射
7. **Phase 回退** — regressToPhase（Phase 8 CODE_BUG -> Phase 3）
8. **TDD 全局门控** — Phase 3 -> Phase 4 的 GREEN_CONFIRMED 检查
9. **步骤推进** — 验证通过后 advance to next step

这些职责混杂在一个函数中，导致：
- 嵌套深度达 4-5 层，难以阅读
- 已有提取函数（`handleTribunalCrash`、`handleTribunalSubagent` 等，Line 476-605）**未被使用**，`computeNextTask` 中存在与之重复的内联代码（Line 1207-1253 vs Line 485-514）
- `state.approachState` 使用 `z.any()` 类型（types.ts:168），绕过了 Zod 验证，存在运行时崩溃风险
- 无法对单个决策路径进行独立单元测试

### 做什么

- 将 `computeNextTask` 拆分为职责单一的子函数，每个函数不超过 100 行
- 消除已有提取函数与内联代码的重复
- 为 `approachState` 创建 Zod schema，替换 `z.any()`
- 保持 `computeNextTask` 的公开 API 签名不变（纯内部重构）

### 不做什么（Non-Goals）

- 不改变 `computeNextTask` 的入参/出参类型
- 不改变 `validateStep`、`buildTaskForStep` 的公开接口（但 5 个已有 tribunal 处理函数的签名将统一改为接收 `OrchestratorContext`，属于内部重构范围）
- 不新增 Phase 或 Step
- 不引入新的外部依赖
- 不做跨文件大规模迁移（保持在 orchestrator.ts + types.ts 范围内）

---

## 现状分析

### 文件结构

| 文件 | 行数 | 职责 |
|------|------|------|
| `orchestrator.ts` | 1515 | 编排核心：computeNextTask + validateStep + buildTaskForStep + helpers |
| `orchestrator-prompts.ts` | 215 | revision prompt 构建、failure 翻译 |
| `phase-enforcer.ts` | 591 | Phase 1/2 review artifact 验证 |
| `state-manager.ts` | 742 | state.json 读写、atomicUpdate |
| `types.ts` | 379 | Zod schema + TypeScript 类型 |
| `tribunal.ts` | 1086 | Tribunal 裁决执行 |

### computeNextTask 内部结构（当前）

```
computeNextTask(projectRoot, topic)
├── [1] 状态加载 + 配置解析 (Line 1007-1048, ~40行)
├── [2] 读取 step state (Line 1051)
├── [3] 无 step 时：首次启动路由 (Line 1054-1146, ~90行)
│   ├── PASS 状态 → advance past completed phase
│   ├── design doc 合规跳过 1a
│   └── 正常首次启动
├── [4] 有 step 时：验证 + 分发 (Line 1148-1515, ~370行)
│   ├── validateStep 调用
│   ├── 验证失败
│   │   ├── Tribunal 失败 (Line 1158-1303, ~145行)
│   │   │   ├── subagent 委托 (内联，与 handleTribunalSubagent 重复)
│   │   │   ├── parse failure (内联，与 handleTribunalParseFailure 重复)
│   │   │   ├── crash (内联，与 handleTribunalCrashEscalation 重复)
│   │   │   ├── count >= 3 → escalation regress (内联，与 handleTribunalEscalation 重复)
│   │   │   └── count < 3 → revision
│   │   ├── regressToPhase (Line 1306-1342, ~36行)
│   │   ├── circuit breaker (Line 1345-1378, ~33行)
│   │   └── iteration limit + revision (Line 1380-1430, ~50行)
│   └── 验证通过
│       ├── TDD 全局门控 (Line 1451-1477, ~26行)
│       └── advance to next step (Line 1479-1514, ~35行)
```

### 已有但未使用的提取函数

以下函数在 Line 476-605 已经提取，但 `computeNextTask` 中的代码**并未调用它们**：

| 函数 | 行 | 状态 |
|------|-----|------|
| `handleTribunalCrash` | 485-514 | 已提取，未使用 |
| `handleTribunalSubagent` | 520-545 | 已提取，未使用 |
| `handleTribunalParseFailure` | 550-574 | 已提取，未使用 |
| `handleTribunalCrashEscalation` | 579-605 | 已提取，未使用 |
| `handleTribunalEscalation` | 610-650 | 已提取，未使用 |

这意味着上一轮重构仅提取了函数但忘记了替换调用点，导致维护两份逻辑。

### approachState 类型问题

`types.ts:168`:
```typescript
approachState: z.any().nullable().optional(),
```

而 `orchestrator.ts:253` 已定义了具体接口：
```typescript
export interface ApproachState {
  stepId: string;
  approaches: ApproachEntry[];
  currentIndex: number;
  failedApproaches: FailedApproach[];
}
```

两者脱节：Zod schema 用 `any`，TypeScript 接口独立存在但未关联到 schema。

---

## 方案设计

### 方案 A：三层分发架构（resolvePhaseTransition → resolveStepDirective → buildDirective）

将 `computeNextTask` 拆分为三个层级：

1. **resolvePhaseTransition** — 处理"无 step"场景：首次启动路由、PASS 推进、design doc 跳过
2. **resolveStepDirective** — 处理"有 step"场景的验证结果分发：根据 `validateStep` 结果分发到 tribunal 处理、circuit breaker、revision、advance
3. **buildDirective** — 负责构建最终的 `NextTaskResult` 返回值

**优点**：
- 层次清晰，每层职责单一
- 与原始需求描述一致

**缺点**：
- 引入了 `buildDirective` 中间层，但实际上 `NextTaskResult` 构造逻辑很简单（直接 return 对象字面量），抽象收益低
- 三层之间需要传递大量上下文参数（state, sm, outputDir, phases 等），增加参数传递开销
- 过度抽象：`buildDirective` 层做的事情太薄，不值得独立层

### 方案 B：职责域拆分 + 消除重复（推荐）

保持 `computeNextTask` 作为顶层协调器（thin orchestrator），将其内部逻辑按职责域提取为独立函数：

1. **复用已有函数** — 将 `computeNextTask` 中的内联 tribunal 处理代码替换为已提取的 `handleTribunalSubagent`/`handleTribunalParseFailure`/`handleTribunalCrashEscalation`/`handleTribunalEscalation` 函数调用
2. **提取 resolveInitialStep** — 处理"无 step"时的首次启动路由（约 90 行 -> 独立函数）
3. **提取 handleValidationFailure** — 统一处理验证失败的全部分支（tribunal + non-tribunal），约 280 行 -> 独立函数
4. **提取 advanceToNextStep** — 处理验证通过后的 TDD 门控 + 步骤推进，约 60 行 -> 独立函数
5. **ApproachState Zod schema** — 在 types.ts 中创建 `ApproachStateSchema`，替换 `z.any()`

**优点**：
- 改动最小化：大部分 tribunal 处理函数已经提取，只需替换调用点
- 不引入新的抽象层，函数之间是平级关系，降低理解成本
- 每个提取函数可以独立单测
- `computeNextTask` 缩减到 ~80 行，仅包含"加载状态 → 初始化路由 or 验证分发 → 返回"的骨架

**缺点**：
- 提取函数的参数列表可能较长（需要传递 sm, state, outputDir 等上下文）

### 方案对比

| 维度 | 方案 A：三层分发 | 方案 B：职责域拆分（推荐） |
|------|-----------------|--------------------------|
| 改动量 | 中等（需要创建新的层级结构） | 较小（复用已有提取函数 + 新提取 3 个函数） |
| computeNextTask 最终行数 | ~60 行 | ~80 行 |
| 新增函数数 | 3 个（resolve/resolve/build） | 3 个（resolveInitialStep/handleValidationFailure/advanceToNextStep） |
| 参数传递复杂度 | 高（三层都需要完整上下文） | 中（平级函数，各取所需） |
| 测试友好度 | 高 | 高 |
| 消除代码重复 | 需要额外处理 | 自然消除（复用已有函数） |
| 过度设计风险 | 中（buildDirective 层过薄） | 低 |
| 回滚难度 | 中 | 低（增量替换，可逐步回退） |

### 选型理由

选择**方案 B**，理由：

1. **已有函数复用**：Line 476-605 已提取 5 个 tribunal 处理函数，方案 B 直接复用，方案 A 需要重新组织
2. **YAGNI 原则**：三层架构的 `buildDirective` 层实际价值低，`NextTaskResult` 构建逻辑简单到不值得抽象
3. **渐进式迁移**：方案 B 可以分步完成（先替换 tribunal 调用点 -> 再提取新函数 -> 再加 Zod schema），每步都可独立验证和回滚

---

## 详细设计

### 4.1 函数拆分策略

#### computeNextTask 最终骨架

`computeNextTask` 重构后将仅包含以下逻辑流：

1. 加载状态 + 配置解析（保持不变，~40 行）
2. 读取 step state
3. 无 step → 调用 `resolveInitialStep(...)` 返回
4. 有 step → 调用 `validateStep(...)` 获取验证结果
5. 验证失败 → 调用 `handleValidationFailure(...)` 返回
6. 验证通过 → 调用 `advanceToNextStep(...)` 返回

#### 新增提取函数

**resolveInitialStep**
- 输入：`ctx: OrchestratorContext`, `stepState: StepState`
- 输出：`NextTaskResult`
- 职责：处理 `stepState.step === null` 的全部场景（PASS 推进、design doc 合规跳过、正常首次启动）
- `stepState` 说明：需要读取 `stepState.step`（判断是否为 null）和 `stepState.status`（判断是否为 PASS）
- 来源：当前 Line 1054-1146

**handleValidationFailure**
- 输入：`ctx: OrchestratorContext`, `stepState: StepState`, `validation: ValidationResult`
- 输出：`NextTaskResult`
- 职责：统一处理验证失败的全部分支
- `stepState` 说明：需要读取 `stepState.approachState`（circuit breaker 方案切换，Line 1345-1346）和 `stepState.stepIteration`（iteration limit 判断，Line 1386-1387）。`stepState` 在 `computeNextTask` 入口处通过 `readStepState()` 获取，作为独立参数传入而非放入 `OrchestratorContext`，因为它是每次调用的瞬时状态，与 context 中的长期配置性质不同。
  - Tribunal 失败 → 委托给已有的 `handleTribunalSubagent`/`handleTribunalParseFailure`/`handleTribunalCrashEscalation`/`handleTribunalEscalation`
  - regressToPhase → Phase 回退
  - circuit breaker → 方案切换
  - iteration limit → escalation
  - normal revision → 修订 prompt
- 来源：当前 Line 1156-1431

**advanceToNextStep**
- 输入：`ctx: OrchestratorContext`, `currentStep: string`, `validation: ValidationResult`
- 输出：`NextTaskResult`
- 职责：验证通过后的 progress log、TDD 门控、步骤推进或完成
- 说明：不需要 `stepState`，仅使用 `currentStep`（已从 `stepState.step` 提取）和 `validation` 结果
- 来源：当前 Line 1433-1514

#### 消除重复：替换 Tribunal 内联代码

将 `computeNextTask` Line 1165-1303 的内联 tribunal 处理代码替换为已有函数调用：

| 内联代码 (Line) | 替换为 |
|----------------|--------|
| 1165-1183 (subagent) | `handleTribunalSubagent(ctx, phaseKey, count, currentStep, validation.tribunalResult)` |
| 1187-1203 (parse failure) | `handleTribunalParseFailure(ctx, phaseKey, count, currentStep, validation.tribunalResult)` |
| 1207-1253 (crash) | `handleTribunalCrashEscalation(ctx, phaseKey, count, currentStep, validation.tribunalResult)` |
| 1256-1284 (escalation) | `handleTribunalEscalation(ctx, phaseKey, currentStep, validation.feedback)` |

> **注意**：上述调用签名反映了 P1-2 修订 -- 5 个已有 tribunal 函数的签名统一改为 `ctx: OrchestratorContext` + 少量额外参数，原来的 `sm, state, outputDir, projectRoot, topic, buildCmd, testCmd` 等参数全部从 `ctx` 中获取。

### 4.2 ApproachState Zod Schema

在 `types.ts` 中新增 `ApproachStateSchema`，替换 `z.any()`：

**新增 Schema**：
- `ApproachEntrySchema` — 单个方案条目（id, summary, failCount）
- `FailedApproachSchema` — 失败方案记录（id, summary, failReason）
- `ApproachStateSchema` — 方案追踪状态（stepId, approaches, currentIndex, failedApproaches）

**修改**：
- `StateJsonSchema.approachState` 从 `z.any().nullable().optional()` 改为 `ApproachStateSchema.nullable().optional()`
- 删除 `orchestrator.ts` 中的 `ApproachState` 接口，改为从 `types.ts` 导入

### 4.3 参数传递优化

为避免提取函数参数过多，引入 `OrchestratorContext` 接口聚合共享上下文：

```typescript
interface OrchestratorContext {
  sm: StateManager;
  state: StateJson;
  outputDir: string;
  projectRoot: string;
  effectiveCodeRoot: string; // state.codeRoot ?? projectRoot，skill 项目场景下与 projectRoot 不同
  topic: string;
  buildCmd: string;
  testCmd: string;
  phases: number[];
  skipSteps: string[];
  getExtraVars: (step: string) => Record<string, string> | undefined;
}
```

> **构建说明**：`effectiveCodeRoot` 在 `computeNextTask` 入口处计算（`state.codeRoot ?? projectRoot`），注入 context 后，所有下游函数（特别是 `validateStep` 调用）统一使用 `ctx.effectiveCodeRoot`，不再单独引用 `projectRoot` 作为代码根目录。原始 `projectRoot` 保留在 context 中供 state 路径等非代码目录场景使用。

所有提取函数（包括 3 个新提取函数和 5 个已有 tribunal 处理函数）统一接收 `ctx: OrchestratorContext` 作为第一个参数，减少参数列表长度。

**已有 tribunal 函数签名统一改造**：5 个已提取函数（`handleTribunalCrash`、`handleTribunalSubagent`、`handleTribunalParseFailure`、`handleTribunalCrashEscalation`、`handleTribunalEscalation`）当前使用散装参数列表，需要统一改为接收 `ctx: OrchestratorContext` + 必要的额外参数（如 `phaseKey`、`count`、`tribunalResult`）。这样新旧函数的参数风格一致，且已有函数自然获得 `getExtraVars`、`effectiveCodeRoot` 等字段的访问权，避免后续需要逐个补参数。

### 4.4 数据流

```
auto_dev_next (index.ts)
  └── computeNextTask(projectRoot, topic)
        ├── StateManager.create() → sm, state
        ├── readStepState() → stepState
        ├── 构建 OrchestratorContext { sm, state, outputDir, projectRoot, effectiveCodeRoot, ... }
        │
        ├── [无 step] → resolveInitialStep(ctx, stepState)
        │     ├── PASS 推进 → computeNextStep → buildTaskForStep → NextTaskResult
        │     ├── design doc 合规 → skip 1a → NextTaskResult
        │     └── 正常启动 → buildTaskForStep → NextTaskResult
        │
        └── [有 step] → validateStep(currentStep, ctx.effectiveCodeRoot, ...)
              ├── [失败] → handleValidationFailure(ctx, stepState, validation)
              │     ├── tribunal → handleTribunalSubagent/ParseFailure/CrashEscalation/Escalation(ctx, ...)
              │     ├── regressToPhase → buildTaskForStep → NextTaskResult
              │     ├── circuit breaker (reads stepState.approachState) → handleApproachFailure → NextTaskResult
              │     └── revision (reads stepState.stepIteration) → buildTaskForStep → NextTaskResult
              │
              └── [通过] → advanceToNextStep(ctx, currentStep, validation)
                    ├── TDD 门控检查
                    ├── computeNextStep
                    └── buildTaskForStep → NextTaskResult
```

---

## 影响分析

### 改动范围

| 文件 | 改动类型 | 估算行数 |
|------|---------|---------|
| `orchestrator.ts` | 重构（拆分 + 替换调用点 + 删除重复内联代码） | ~300 行变动 |
| `types.ts` | 新增 ApproachState 相关 Schema | ~30 行新增 |
| `orchestrator.test.ts` | 新增提取函数的独立单元测试 | ~100 行新增 |

### 兼容性

- **公开 API 不变**：`computeNextTask` 签名和返回类型完全不变
- **state.json 兼容**：`ApproachStateSchema` 的字段与现有 `ApproachState` 接口完全一致，已有 state.json 文件的 `approachState` 字段仍然有效
- **导出兼容**：`ApproachState` 类型的导出位置从 `orchestrator.ts` 迁移到 `types.ts`，使用 re-export 保持向后兼容

### 迁移路径

1. **Step 1**：在 types.ts 中新增 `ApproachStateSchema`，暂不修改 StateJsonSchema
2. **Step 2**：引入 `OrchestratorContext` 接口（含 `effectiveCodeRoot` 字段），同时将 5 个已有 tribunal 处理函数的签名统一改为 `(ctx: OrchestratorContext, ...extraParams)`
3. **Step 3**：在 orchestrator.ts 中替换 tribunal 内联代码为已有函数调用（使用新签名）
4. **Step 4**：提取 `resolveInitialStep(ctx, stepState)`、`handleValidationFailure(ctx, stepState, validation)`、`advanceToNextStep(ctx, currentStep, validation)`
5. **Step 5**：将 `StateJsonSchema.approachState` 从 `z.any()` 改为 `ApproachStateSchema.nullable().optional().catch(undefined)`，并在 fallback 触发时输出 console.error 日志
6. **Step 6**：删除 orchestrator.ts 中旧的 `ApproachState` 接口，改为从 types.ts 导入

每个 Step 完成后运行测试，确保无回归。

### 回滚方案

- 每个 Step 对应一个独立 commit
- 如果某个 Step 引入问题，可 `git revert` 单个 commit
- Step 5（schema 替换）风险最高：如果现有 state.json 中有不符合 schema 的 approachState 数据，Zod 验证会失败。缓解方案如下：

  **approachState fallback 策略（P1-4 修订）**：
  - 不使用简单的 `.catch(null)`，因为这会在 schema 解析失败时将进行中的 circuit breaker 状态（`approachState.currentIndex > 0`）重置为 null，导致方案切换从头开始。
  - 改用 Zod 的 `.preprocess()` + `.safeParse()` 组合策略：
    1. `StateJsonSchema` 中 `approachState` 字段定义为 `ApproachStateSchema.nullable().optional().catch(undefined)`，使用 `catch(undefined)` 而非 `catch(null)`，这样 fallback 触发时 `approachState` 变为 `undefined`（等同于"字段不存在"），与 `handleApproachFailure` 中 `if (!approachState)` 的初始化逻辑一致。
    2. 实际上，`approachState` 的写入方就是 orchestrator 自己（通过 `sm.atomicUpdate`），数据结构天然符合 `ApproachState` 接口，`.catch()` 只会在极端场景（手动编辑 state.json 导致结构损坏）下触发。
    3. 在迁移步骤中增加防御性日志：当 `.safeParse()` 失败时，输出 `console.error("[state-manager] approachState schema validation failed, falling back to undefined", parseError)`，便于排查。

---

## 风险与缓解

| 风险 | 可能性 | 影响 | 缓解措施 |
|------|--------|------|---------|
| 替换 tribunal 内联代码时引入逻辑差异 | 中 | 高 — tribunal 路径是关键决策路径 | 逐个替换 + 对比内联代码与已有函数的差异，确保行为一致；现有 2266 行测试覆盖 |
| ApproachState schema 导致现有 state.json 加载失败 | 低 | 中 — 会中断进行中的 auto-dev session | 使用 `.safeParse()` + 条件 fallback（见下方详细说明）；Step 5 独立 commit 可快速回滚 |
| OrchestratorContext 引入增加理解成本 | 低 | 低 | context 接口字段都是现有变量，命名保持一致 |
| 提取函数参数过多导致调用方难以理解 | 低 | 低 | 使用 OrchestratorContext 聚合；提取函数不超过 3 个额外参数 |

---

## 验收标准

| AC | 描述 | 验证方式 |
|----|------|---------|
| AC-1 | `computeNextTask` 函数体不超过 100 行（不含空行和注释） | 代码审查：`grep -c` 统计函数体行数 |
| AC-2 | orchestrator.ts 中不存在与 `handleTribunalSubagent`/`handleTribunalParseFailure`/`handleTribunalCrashEscalation`/`handleTribunalEscalation` 重复的内联代码 | 代码审查：搜索 `tribunal_subagent`/`tribunal_parse_failure`/`tribunal_crashed` 字符串，确认仅出现在提取函数中 |
| AC-3 | `types.ts` 中 `StateJsonSchema.approachState` 字段使用具体 Zod schema（`ApproachStateSchema`），不再使用 `z.any()` | 代码审查 + 单元测试：构造不合法的 approachState 对象，验证 Zod parse 报错 |
| AC-4 | 所有现有 orchestrator.test.ts 测试用例通过（无回归） | 单元测试：`npm test -- orchestrator.test.ts` 全部 PASS |
| AC-5 | 新增 `resolveInitialStep` 独立单元测试，覆盖：(a) 首次启动正常路由 (b) PASS 状态推进 (c) design doc 合规跳过 1a | 单元测试 |
| AC-6 | 新增 `handleValidationFailure` 独立单元测试，覆盖：(a) tribunal subagent 委托 (b) tribunal crash escalation (c) circuit breaker 触发 (d) iteration limit 超限 | 单元测试 |
| AC-7 | 新增 `advanceToNextStep` 独立单元测试，覆盖：(a) 正常推进到下一步 (b) 所有步骤完成返回 done=true (c) TDD 门控阻断 | 单元测试 |
| AC-8 | `ApproachState` 类型从 `orchestrator.ts` 迁移到 `types.ts` 后，`orchestrator.ts` 中通过 import 引用，不存在重复定义 | 代码审查 |
| AC-9 | 现有 state.json 文件中 `approachState` 字段为 null 或符合旧格式时，`loadAndValidate` 不抛异常（向后兼容） | 单元测试：构造 `approachState: null` 和 `approachState: { stepId: "3", ... }` 的 state.json，验证加载成功 |
| AC-10 | 关键决策路径（tribunal failure、circuit breaker、phase regress）有 console.error 级别日志，包含 step 和 phase 信息 | 代码审查 |
