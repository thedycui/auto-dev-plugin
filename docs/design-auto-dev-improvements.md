# auto-dev 插件综合优化 — 详细设计文档

## 1. 背景

基于实际使用 auto-dev 走完完整流程后发现的问题和改进需求，共 7 项优化。

## 2. 改动清单

### 2.1 P0: state_update 降级 — 禁止通过 state_update 修改 phase/status

**问题**：主 agent 可以用 `state_update` 直接设 phase 和 status，绕过 `checkpoint` 的 artifact 验证和 phase-enforcer。刚才加的 guard 只是限制了跳转规则，但仍然允许合法的 phase 推进（如 1→2），只要当前是 PASS。

**方案**：从 `state_update` 的 schema 中移除 `phase` 和 `status` 字段。Phase/status 变更只能通过 `checkpoint`。`state_update` 只保留辅助字段：`task`、`iteration`、`dirty`、`interactive`、`dryRun`。

**文件**：`mcp/src/index.ts` — `auto_dev_state_update` tool

```ts
// 修改前 schema
updates: z.object({
  phase: z.number().optional(),       // ← 移除
  task: z.number().optional(),
  iteration: z.number().optional(),
  status: z.enum([...]).optional(),    // ← 移除
  dirty: z.boolean().optional(),
  interactive: z.boolean().optional(),
  dryRun: z.boolean().optional(),
}),

// 修改后 schema
updates: z.object({
  task: z.number().optional(),
  iteration: z.number().optional(),
  dirty: z.boolean().optional(),
  interactive: z.boolean().optional(),
  dryRun: z.boolean().optional(),
}),
```

同时更新 description：
```
"Update auxiliary state fields (task, iteration, flags). Phase/status changes MUST go through auto_dev_checkpoint."
```

移除之前加的 guard 代码（不再需要，因为 phase/status 已从 schema 中移除）。

### 2.2 P0: 修复 Phase 5 测试文件检测 — 用 startCommit 替代 HEAD~20

**问题**：`HEAD~20` 是硬编码假设，auto-dev 过程中 commit 超过 20 个就检测不到测试文件。

**方案**：
1. 在 `auto_dev_init` 时记录 `startCommit = git rev-parse HEAD` 到 state.json
2. Phase 5 checkpoint 验证时用 `git diff --name-only --diff-filter=A {startCommit} HEAD`

**文件**：
- `mcp/src/types.ts` — StateJsonSchema 增加 `startCommit: z.string().optional()`
- `mcp/src/index.ts` — `auto_dev_init` 中记录 startCommit
- `mcp/src/index.ts` — `auto_dev_checkpoint` Phase 5 验证用 startCommit

```ts
// types.ts — StateJsonSchema 增加
startCommit: z.string().optional(),

// index.ts — init 中
const gitManager = new GitManager(projectRoot);
const git = await gitManager.getStatus();
const startCommit = await gitManager.getHeadCommit(); // git rev-parse HEAD
await sm.init(mode, stack, startPhase);
await sm.atomicUpdate({ startCommit });

// index.ts — checkpoint Phase 5 中替换 HEAD~20
const state = await sm.loadAndValidate();
const baseCommit = state.startCommit ?? "HEAD~20"; // 兼容旧 state
execFileAsync("git", ["diff", "--name-only", "--diff-filter=A", baseCommit, "HEAD"], ...)
```

- `mcp/src/git-manager.ts` — 新增 `getHeadCommit()` 方法

```ts
async getHeadCommit(): Promise<string> {
  return (await this.exec("git", ["rev-parse", "HEAD"])).trim();
}
```

### 2.3 P1: preflight 返回渲染好的 prompt

**问题**：主 agent 不知道/不用 render 获取 prompt，直接手写 prompt 给 agent，导致质量不稳定。

**方案**：在 `preflight` 返回值中增加 `suggestedPrompt` 和 `suggestedAgent` 字段。preflight 根据当前 phase 自动渲染对应的 prompt template。

**文件**：`mcp/src/index.ts` — `auto_dev_preflight` tool

```ts
// 在 preflight handler 末尾，如果 ready=true，自动渲染 prompt
if (ready) {
  const phasePromptMap: Record<number, { promptFile: string; agent: string }> = {
    1: { promptFile: "phase1-architect", agent: "auto-dev-architect" },
    2: { promptFile: "phase2-planner", agent: "auto-dev-architect" },
    3: { promptFile: "phase3-developer", agent: "auto-dev-developer" },
    4: { promptFile: "phase4-full-reviewer", agent: "auto-dev-reviewer" },
    5: { promptFile: "phase5-test-architect", agent: "auto-dev-test-architect" },
    6: { promptFile: "phase6-acceptance", agent: "auto-dev-acceptance-validator" },
  };
  const mapping = phasePromptMap[phase];
  if (mapping) {
    const renderer = new TemplateRenderer(defaultSkillsDir());
    const state = await sm.loadAndValidate();
    const variables = buildVariablesFromState(state);
    try {
      const rendered = await renderer.render(mapping.promptFile, variables);
      result.suggestedPrompt = rendered.renderedPrompt;
      result.suggestedAgent = mapping.agent;
    } catch { /* prompt file not found, skip */ }
  }
}
```

需要新增辅助函数 `buildVariablesFromState(state, branch?)` 将 StateJson 转为 render variables：

```ts
function buildVariablesFromState(state: StateJson, branch?: string): Record<string, string> {
  return {
    topic: state.topic,
    language: state.stack.language,
    build_cmd: state.stack.buildCmd,
    test_cmd: state.stack.testCmd,
    lang_checklist: state.stack.langChecklist,
    output_dir: state.outputDir,
    project_root: state.projectRoot,
    branch: branch ?? "unknown",
  };
}
```

注意：`branch` 不在 StateJson 中，需从 `GitManager.getStatus()` 获取后传入。

### 2.4 P1: 断点续传增强 — task 级恢复

**问题**：resume 后只知道当前 phase，不知道 Phase 3 内部执行到哪个 task。

**方案**：在 `auto_dev_init` 的 resume 逻辑中，解析 progress-log 中最后一个 Phase 3 task checkpoint，返回 `resumeTask` 信息。

**文件**：`mcp/src/index.ts` — `auto_dev_init` resume 分支

```ts
if (onConflict === "resume") {
  const state = await sm.loadAndValidate();

  // 解析 progress-log 获取最后执行的 task
  let lastTask: number | undefined;
  let lastTaskStatus: string | undefined;
  try {
    const log = await readFile(sm.progressLogPath, "utf-8");
    const taskRegex = /CHECKPOINT phase=3 task=(\d+) status=(\w+)/g;
    let match;
    while ((match = taskRegex.exec(log)) !== null) {
      lastTask = parseInt(match[1], 10);
      lastTaskStatus = match[2];
    }
  } catch { /* no progress log */ }

  return textResult({
    ...existingFields,
    resumeTask: lastTask,
    resumeTaskStatus: lastTaskStatus,
  });
}
```

### 2.5 P2: Phase 级耗时统计

**问题**：无法知道每个 phase 花了多长时间。

**方案**：
1. 在 state.json 中增加 `phaseTimings` 字段记录每个 phase 的开始和结束时间
2. `checkpoint(status=IN_PROGRESS)` 时记录 phase 开始时间
3. `checkpoint(status=PASS/BLOCKED)` 时记录 phase 结束时间并计算 duration
4. `auto_dev_complete` 返回总耗时汇总

**文件**：
- `mcp/src/types.ts` — StateJsonSchema 增加 `phaseTimings`

```ts
phaseTimings: z.record(
  z.string(),  // phase number as string key
  z.object({
    startedAt: z.string(),
    completedAt: z.string().optional(),
    durationMs: z.number().optional(),
  })
).optional(),
```

- `mcp/src/index.ts` — `auto_dev_checkpoint` 中记录时间

```ts
// checkpoint handler 中，在 atomicUpdate 之前
const timings = { ...(state.phaseTimings ?? {}) };
const phaseKey = String(phase);

if (status === "IN_PROGRESS") {
  timings[phaseKey] = { startedAt: new Date().toISOString() };
} else if (status === "PASS" || status === "BLOCKED" || status === "COMPLETED") {
  const existing = timings[phaseKey];
  if (existing?.startedAt) {
    const now = new Date();
    existing.completedAt = now.toISOString();
    existing.durationMs = now.getTime() - new Date(existing.startedAt).getTime();
  }
}

stateUpdates["phaseTimings"] = timings;
```

- `mcp/src/index.ts` — `auto_dev_complete` 返回耗时汇总

```ts
// complete handler 中，在返回成功时附加 timings
const timingSummary = Object.entries(state.phaseTimings ?? {}).map(([p, t]) => ({
  phase: parseInt(p),
  durationMs: t.durationMs,
  durationStr: t.durationMs ? formatDuration(t.durationMs) : "unknown",
}));

// 在成功返回值中包含 timingSummary
return textResult({
  canComplete: true,
  passedPhases: validation.passedPhases,
  message: validation.message,
  status: "COMPLETED",
  timingSummary,
});
```

### 2.6 P2: --skip-e2e 模式

**问题**：小改动不需要新增测试文件，但 Phase 5 强制要求。

**方案**：增加 `skipE2e` flag，跳过 Phase 5 但保留其他所有 Phase（1,2,3,4,6）。

**文件**：
- `mcp/src/types.ts` — StateJsonSchema 增加 `skipE2e: z.boolean().optional()`
- `mcp/src/index.ts` — init tool schema 增加 `skipE2e` 参数
- `mcp/src/phase-enforcer.ts` — `computeNextDirective` 中，如果 `skipE2e=true` 且 currentPhase=4 且 status=PASS，nextPhase 直接跳到 6
- `mcp/src/phase-enforcer.ts` — `validateCompletion` 签名增加 `skipE2e` 参数
- `mcp/src/index.ts` — `auto_dev_complete` 调用 `validateCompletion` 时传入 `skipE2e`
- `mcp/src/index.ts` — checkpoint Phase 5 artifact 验证跳过

```ts
// phase-enforcer.ts — computeNextDirective（state 中已有 skipE2e）
const skipE2e = state.skipE2e === true;
let nextPhase = currentPhase + 1;
if (skipE2e && nextPhase === 5) {
  nextPhase = 6; // 跳过 Phase 5
}

// phase-enforcer.ts — validateCompletion 签名变更
export function validateCompletion(
  progressLogContent: string,
  mode: "full" | "quick",
  isDryRun: boolean,
  skipE2e: boolean = false,  // NEW
): CompletionValidation

// phase-enforcer.ts — validateCompletion 内部
const requiredPhases = isDryRun
  ? [1, 2]
  : skipE2e
    ? [1, 2, 3, 4, 6]  // 跳过 5
    : mode === "quick"
      ? REQUIRED_PHASES_QUICK
      : REQUIRED_PHASES_FULL;
```

### 2.7 P3: token 估算追踪

**问题**：auto-dev 是 token 消耗大户，但无成本可见性。

**方案**：在 checkpoint 中增加可选的 `tokenEstimate` 参数，由主 agent 上报本阶段的估算 token 用量。累计到 state.json 中。`auto_dev_complete` 时汇总输出。

**文件**：
- `mcp/src/types.ts` — StateJsonSchema 增加 `tokenUsage`

```ts
tokenUsage: z.object({
  total: z.number(),
  byPhase: z.record(z.string(), z.number()),
}).optional(),
```

- `mcp/src/index.ts` — checkpoint schema 增加 `tokenEstimate: z.number().optional()`
- `mcp/src/index.ts` — checkpoint handler 中累计

```ts
if (tokenEstimate !== undefined) {
  const usage = { ...(state.tokenUsage ?? { total: 0, byPhase: {} }) };
  usage.total += tokenEstimate;
  usage.byPhase[String(phase)] = (usage.byPhase[String(phase)] ?? 0) + tokenEstimate;
  stateUpdates["tokenUsage"] = usage;
}
```

## 3. 修改文件清单

| 文件 | 改动项 | 预估行数 |
|---|---|---|
| `mcp/src/index.ts` | 2.1 state_update 降级 | -35 (移除 guard, 简化 schema) |
| `mcp/src/index.ts` | 2.2 init 记录 startCommit, checkpoint 用 startCommit | ~10 |
| `mcp/src/index.ts` | 2.3 preflight 返回 suggestedPrompt | ~30 |
| `mcp/src/index.ts` | 2.4 resume task 级恢复 | ~15 |
| `mcp/src/index.ts` | 2.5 checkpoint 耗时统计 | ~20 |
| `mcp/src/index.ts` | 2.6 init skipE2e, checkpoint 跳过验证 | ~5 |
| `mcp/src/index.ts` | 2.7 checkpoint token 估算 | ~10 |
| `mcp/src/index.ts` | 2.5+2.7 complete 返回汇总 | ~15 |
| `mcp/src/types.ts` | 2.2+2.5+2.6+2.7 schema 扩展 | ~20 |
| `mcp/src/phase-enforcer.ts` | 2.6 skipE2e 支持 | ~10 |
| `mcp/src/git-manager.ts` | 2.2 getHeadCommit 方法 | ~5 |
| `skills/auto-dev/SKILL.md` | 文档更新 | ~15 |
| **合计** | | **~175** |

## 4. 验收标准

- AC-1: `state_update` schema 中不再有 `phase` 和 `status` 字段，尝试传入被 Zod 拒绝
- AC-2: init 返回 `startCommit`，Phase 5 checkpoint 使用它代替 `HEAD~20`
- AC-3: preflight 返回 `suggestedPrompt` 和 `suggestedAgent`
- AC-4: resume 返回 `resumeTask` 和 `resumeTaskStatus`
- AC-5: checkpoint 记录 phaseTimings，complete 返回耗时汇总
- AC-6: `skipE2e=true` 时 Phase 4 PASS 后直接进 Phase 6，complete 不要求 Phase 5
- AC-7: checkpoint 传入 tokenEstimate 时累计到 state.json
- AC-8: build 通过
