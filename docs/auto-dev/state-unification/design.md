# 设计文档：状态管理统一重构

## 1. 问题诊断

### 现状：三个写入者竞争同一个 state.json

```
state.json 的写入者：
├── writeStepState()         — orchestrator 直接 JSON.parse + Object.assign + writeFile
├── sm.atomicUpdate()        — StateManager 的原子更新（read-modify-write）
└── internalCheckpoint()     — 调 sm.atomicUpdate() + sm.appendToProgressLog()
```

`writeStepState` 和 `sm.atomicUpdate` 是独立的 read-modify-write 循环，**互不知道对方的存在**。如果 orchestrator 先 `writeStepState`，然后 `internalCheckpoint` 读到的是 writeStepState 刚写的版本，追加更新——这一步没问题。但如果调用顺序或时序不对，一方的写入会覆盖另一方。

### 现状：三个 API 各自推进状态

```
auto_dev_next  →  computeNextTask()  →  validateStep() + 推进 step
auto_dev_submit  →  executeTribunal()  →  internalCheckpoint + 推进 phase（不推进 step）
auto_dev_checkpoint  →  internalCheckpoint  →  推进 phase（不推进 step）
```

Phase 和 Step 是同一件事的两个维度，但被三个 API 分别管理。agent 可以：
- 用 `auto_dev_next` 推进 step 但不推进 phase
- 用 `auto_dev_submit` 推进 phase 但不推进 step
- 用 `auto_dev_checkpoint` 推进 phase 但不推进 step

这就是所有状态不同步 bug 的根源。

## 2. 目标

**state.json 只有一个写入者，只有一个推进入口。**

| 原则 | 具体 |
|------|------|
| 单一推进入口 | `auto_dev_next` 是唯一的状态推进 API |
| 单一写入者 | 所有 state.json 修改都通过 `sm.atomicUpdate()` |
| Tribunal 无副作用 | tribunal 只返回判定结果，不写 checkpoint |
| Phase = Step 的派生 | phase 始终等于 `phaseForStep(currentStep)`，不独立维护 |

## 3. 架构变更

### 3.1 移除 `writeStepState`，统一用 `sm.atomicUpdate`

**之前：**
```typescript
// orchestrator.ts
await writeStepState(sm.stateFilePath, { step: "4a", stepIteration: 0, ... });
await sm.atomicUpdate({ phase: 4, status: "IN_PROGRESS" });  // 两次写入
```

**之后：**
```typescript
// orchestrator.ts
await sm.atomicUpdate({
  step: "4a", stepIteration: 0, lastValidation: null, approachState: null,
  phase: 4, status: "IN_PROGRESS",
});  // 一次写入
```

所有 orchestrator 中的 `writeStepState` 调用改为 `sm.atomicUpdate`，step 字段直接写入 state.json。

### 3.2 Tribunal 变为纯函数（无副作用）

新建 `evaluateTribunal()`，从 `executeTribunal()` 中提取核心逻辑：

```typescript
// tribunal.ts

/** 纯判定函数 — 不写任何状态 */
export async function evaluateTribunal(
  projectRoot: string,
  outputDir: string,
  phase: number,
  topic: string,
  summary: string,
  startCommit?: string,
): Promise<TribunalVerdict> {
  // 1. Quick pre-check
  const preCheckFail = await runQuickPreCheck(phase, outputDir, projectRoot, startCommit);
  if (preCheckFail) return { verdict: "FAIL", issues: [{ severity: "P0", description: preCheckFail }] };

  // 2. Prepare input + run tribunal agent
  const input = await prepareTribunalInput(phase, outputDir, projectRoot, topic, startCommit);
  const verdict = await runTribunalWithRetry(phase, input, outputDir);

  // 3. Auto-override (demote non-actionable P0/P1)
  applyAutoOverride(verdict);

  // 4. Cross-validate on PASS
  if (verdict.verdict === "PASS") {
    const crossCheckFail = await crossValidate(phase, outputDir, projectRoot, startCommit);
    if (crossCheckFail) {
      return { verdict: "FAIL", issues: [{ severity: "P0", description: crossCheckFail }], overridden: true };
    }
  }

  // 5. Write tribunal log (这是 verdict 记录，不是状态)
  await writeFile(join(outputDir, `tribunal-phase${phase}.md`), buildTribunalLog(phase, verdict));

  return verdict;
}
```

**关键变化：不调 `internalCheckpoint`，不写 state.json。**

旧的 `executeTribunal` 标记为 deprecated，内部调用 `evaluateTribunal` + `internalCheckpoint`（仅为向后兼容）。

### 3.3 Orchestrator 接管 tribunal 执行和计数器

`validateStep` 中的 tribunal 步骤改为调用 `evaluateTribunal`：

```typescript
case "4a": {
  // Build + test
  const buildResult = await shell(buildCmd, projectRoot);
  if (buildResult.exitCode !== 0) return { passed: false, feedback: ... };
  const testResult = await shell(testCmd, projectRoot);
  if (testResult.exitCode !== 0) return { passed: false, feedback: ... };

  // Tribunal (纯判定，无副作用)
  const verdict = await evaluateTribunal(projectRoot, outputDir, 4, topic, "Phase 4 verify", startCommit);
  return {
    passed: verdict.verdict === "PASS",
    feedback: verdict.verdict === "FAIL"
      ? verdict.issues.map(i => `[${i.severity}] ${i.description}`).join("\n")
      : "",
    tribunalVerdict: verdict,  // 透传给 orchestrator
  };
}
```

Orchestrator 的 `computeNextTask` 在验证通过后统一处理状态：

```typescript
// 验证通过
if (validation.passed) {
  // 重置 tribunal 计数器
  if (validation.tribunalVerdict) {
    await sm.atomicUpdate({
      tribunalSubmits: { ...(state.tribunalSubmits ?? {}), [String(currentPhase)]: 0 },
    });
  }

  // 统一推进：一次 atomicUpdate 搞定 step + phase
  const nextStep = computeNextStep(currentStep, phases);
  if (!nextStep) {
    await sm.atomicUpdate({
      step: null, stepIteration: 0, lastValidation: "DONE",
      status: "COMPLETED",
    });
    return { done: true, ... };
  }

  const nextPhase = phaseForStep(nextStep);
  // 写 progress-log（只做记录，不做状态推进）
  await sm.appendToProgressLog(sm.getCheckpointLine(currentPhase, undefined, "PASS", `Step ${currentStep} passed.`));
  // 一次性更新所有状态
  await sm.atomicUpdate({
    step: nextStep, stepIteration: 0, lastValidation: null, approachState: null,
    phase: nextPhase, status: "IN_PROGRESS",
  });
  return { done: false, step: nextStep, ... };
}

// 验证失败（含 tribunal FAIL）
if (!validation.passed) {
  // Tribunal 计数器递增
  if (validation.tribunalVerdict) {
    const phaseKey = String(currentPhase);
    const submits = state.tribunalSubmits ?? {};
    const count = (submits[phaseKey] ?? 0) + 1;

    if (count >= 3) {
      // ESCALATE_REGRESS
      await sm.atomicUpdate({
        phase: 3, status: "IN_PROGRESS",
        step: "3", stepIteration: 0, lastValidation: "ESCALATE_REGRESS", approachState: null,
        tribunalSubmits: {},  // 全量重置
        phaseEscalateCount: { ...(state.phaseEscalateCount ?? {}), [phaseKey]: (state.phaseEscalateCount?.[phaseKey] ?? 0) + 1 },
      });
      return { done: false, escalation: { reason: "tribunal_escalate", ... } };
    }

    await sm.atomicUpdate({
      tribunalSubmits: { ...submits, [phaseKey]: count },
    });
  }

  // 正常失败 → 返回修复指令
  await sm.atomicUpdate({
    stepIteration: newIteration, lastValidation: "FAILED",
  });
  return { done: false, step: currentStep, prompt: revisionPrompt, ... };
}
```

### 3.4 `auto_dev_submit` 降级为兼容 API

```typescript
server.tool("auto_dev_submit", ..., async ({ projectRoot, topic, phase, summary }) => {
  return textResult({
    status: "DEPRECATED",
    message: "auto_dev_submit 已弃用。请使用 auto_dev_next 推进流程，tribunal 由 orchestrator 自动执行。",
    mandate: "调用 auto_dev_next(projectRoot, topic) 代替 auto_dev_submit。",
  });
});
```

### 3.5 `auto_dev_checkpoint` 限制为非推进用途

保留 `auto_dev_checkpoint` 但限制其功能：
- **允许**：`status=IN_PROGRESS`（标记阶段开始，不推进）
- **允许**：`status=PASS` 仅限 Phase 1, 2, 3, 7（非 tribunal phases）——但实际上 orchestrator 也会自动做这些
- **禁止**：`status=PASS` 对 Phase 4, 5, 6（tribunal phases）
- **建议**：agent 不需要主动调用，orchestrator 自动处理

### 3.6 Progress-log 变为纯审计日志

Progress-log 不再作为状态源（`validateCompletion` 从中解析 PASS 的做法保留，但只作为审计验证）。State.json 是唯一状态源。

## 4. 数据流（重构后）

```
Main Agent:
  result = auto_dev_next(projectRoot, topic)     ← 唯一入口
    │
    ▼
computeNextTask():
  1. sm.loadAndValidate()                         ← 读 state.json（唯一状态源）
  2. 判断当前 step，执行 validateStep()
     ├── 非 tribunal step: 检查文件/运行 build+test
     └── tribunal step: build+test + evaluateTribunal() ← 纯函数，无副作用
  3. 根据验证结果：
     ├── PASS:
     │   sm.appendToProgressLog(checkpoint)        ← 审计记录
     │   sm.atomicUpdate({                         ← 唯一状态写入
     │     step, stepIteration, phase, status,
     │     tribunalSubmits, approachState, ...
     │   })
     └── FAIL:
         sm.atomicUpdate({                         ← 唯一状态写入
           stepIteration++, lastValidation,
           tribunalSubmits++, ...
         })
  4. 返回 { done, step, prompt, escalation }
    │
    ▼
Main Agent: dispatch subagent with prompt, then call auto_dev_next again
```

## 5. 改动文件清单

| 文件 | 改动类型 | 内容 |
|------|---------|------|
| `tribunal.ts` | 重构 | 新增 `evaluateTribunal`（纯函数）；`executeTribunal` 标记 deprecated |
| `orchestrator.ts` | 重构 | 移除 `writeStepState`，统一用 `sm.atomicUpdate`；`validateStep` 调用 `evaluateTribunal`；`computeNextTask` 接管 tribunal 计数器和 ESCALATE 逻辑 |
| `index.ts` | 修改 | `auto_dev_submit` 降级为 deprecated；`auto_dev_checkpoint` 限制功能；移除今天加的 3 个补丁（被 orchestrator 统一逻辑替代） |
| `state-manager.ts` | 小改 | `internalCheckpoint` 保留但不再由 tribunal 直接调用 |
| `phase-enforcer.ts` | 不改 | `computeNextDirective` 保留但仅作兼容 |
| `prompts/*.md` | 修改 | 移除 "调用 auto_dev_submit" 的指令，改为 "完成任务后直接返回" |
| `__tests__/*.ts` | 重写 | tribunal 相关测试改为测 `evaluateTribunal`；orchestrator 测试覆盖统一状态推进 |

## 6. 迁移策略

### 阶段 1：创建 `evaluateTribunal`（向后兼容）

- 从 `executeTribunal` 中提取纯逻辑到 `evaluateTribunal`
- `executeTribunal` 内部调用 `evaluateTribunal` + `internalCheckpoint`（行为不变）
- 测试：现有测试不改，全部应该继续通过

### 阶段 2：Orchestrator 接管 tribunal

- `validateStep` 改为调用 `evaluateTribunal`
- `computeNextTask` 接管 checkpoint 写入和计数器管理
- 移除 `writeStepState`，统一用 `sm.atomicUpdate`
- 测试：重写 orchestrator 测试覆盖新逻辑

### 阶段 3：降级旧 API

- `auto_dev_submit` 返回 DEPRECATED
- `auto_dev_checkpoint` 限制功能
- 更新 prompt 模板
- 移除今天加的补丁代码（已被统一逻辑替代）

### 阶段 4：清理

- 移除 `executeTribunal`（breaking change，等旧 session 自然过期）
- 移除 `computeNextDirective`（不再被 orchestrator 使用）
- 移除今天加的 `computeNextStep` / `phaseForStep` import 在 index.ts 里的使用

## 7. 预估改动量

| 类别 | 行数 |
|------|------|
| tribunal.ts 重构 | ~100 行（提取 evaluateTribunal） |
| orchestrator.ts 统一 | ~150 行（移除 writeStepState + 接管 tribunal） |
| index.ts 降级 API | ~50 行（submit deprecated + checkpoint 限制） |
| index.ts 移除补丁 | -80 行（今天加的 3 个补丁回退） |
| prompts 更新 | ~30 行 |
| 测试 | ~200 行 |
| **总计** | ~450 行净变更 |

## 8. 风险

| 风险 | 缓解 |
|------|------|
| 正在运行的 session 使用旧 API | `auto_dev_submit` 降级而非移除，返回清晰的迁移提示 |
| `evaluateTribunal` 逻辑提取遗漏 | 阶段 1 不改行为，用现有测试验证 |
| orchestrator 统一后状态写入遗漏 | 重构前后对比所有 `atomicUpdate` 调用点 |
| prompt 更新不完整导致 agent 仍调旧 API | 旧 API 返回 DEPRECATED + mandate 提示 |
