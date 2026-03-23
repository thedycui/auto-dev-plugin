# Implementation Plan: auto-dev improvements

## Overview

7 improvements (2.1-2.7) across 4 source files, ordered by dependency. Schema changes first, then consumers. All design review issues have been incorporated.

---

## Task List

### Task 1: Extend StateJsonSchema with new fields (types.ts)

- **File(s)**: `/Users/admin/.claude/plugins/auto-dev-plugin/mcp/src/types.ts`
- **What**: Add 4 new optional fields to `StateJsonSchema` (lines 69-94) to support improvements 2.2, 2.5, 2.6, and 2.7. All fields are optional to maintain backward compatibility with existing state.json files.
- **Code sketch**:
  At line 94 (before the closing `});` of `StateJsonSchema`), insert:
  ```ts
  // 2.2: init commit for accurate git diff in Phase 5
  startCommit: z.string().optional(),

  // 2.5: phase-level timing data
  phaseTimings: z.record(
    z.string(),
    z.object({
      startedAt: z.string(),
      completedAt: z.string().optional(),
      durationMs: z.number().optional(),
    })
  ).optional(),

  // 2.6: skip Phase 5 (e2e tests) for small changes
  skipE2e: z.boolean().optional(),

  // 2.7: token usage tracking
  tokenUsage: z.object({
    total: z.number(),
    byPhase: z.record(z.string(), z.number()),
  }).optional(),
  ```
- **Dependencies**: None (foundation for all other tasks)
- **AC**: AC-2 (startCommit), AC-5 (phaseTimings), AC-6 (skipE2e), AC-7 (tokenUsage), AC-8 (build)

---

### Task 2: Add `getHeadCommit()` to GitManager (git-manager.ts)

- **File(s)**: `/Users/admin/.claude/plugins/auto-dev-plugin/mcp/src/git-manager.ts`
- **What**: Add a new public method `getHeadCommit()` that returns the current HEAD commit SHA. Insert after `getStatus()` (line 48), before `diffCheck()` (line 53).
- **Code sketch**:
  After line 48 (closing brace of `getStatus()`), insert:
  ```ts
  /**
   * Return the full SHA of the current HEAD commit.
   */
  async getHeadCommit(): Promise<string> {
    return (await this.execGit("rev-parse", "HEAD")).trim();
  }
  ```
- **Dependencies**: None
- **AC**: AC-2

---

### Task 3: Update phase-enforcer for skipE2e support (phase-enforcer.ts)

- **File(s)**: `/Users/admin/.claude/plugins/auto-dev-plugin/mcp/src/phase-enforcer.ts`
- **What**: Two changes:
  1. In `computeNextDirective()` (line 42-85): After computing `nextPhase = currentPhase + 1` (line 62), add skipE2e logic to jump from phase 4 directly to phase 6. Read `skipE2e` from `state` parameter (already typed as `StateJson`, which will have `skipE2e` after Task 1).
  2. In `validateCompletion()` (line 102-142): Add a fourth parameter `skipE2e: boolean = false` and use it to determine `requiredPhases`. When `skipE2e` is true, use `[1, 2, 3, 4, 6]` instead of `REQUIRED_PHASES_FULL`.

- **Code sketch**:

  **Change 1** - `computeNextDirective` (around line 62):
  ```ts
  // Before:
  const nextPhase = currentPhase + 1;

  // After:
  let nextPhase = currentPhase + 1;
  if (state.skipE2e === true && nextPhase === 5) {
    nextPhase = 6;
  }
  ```

  **Change 2** - `validateCompletion` signature (line 102-106):
  ```ts
  // Before:
  export function validateCompletion(
    progressLogContent: string,
    mode: "full" | "quick",
    isDryRun: boolean,
  ): CompletionValidation {

  // After:
  export function validateCompletion(
    progressLogContent: string,
    mode: "full" | "quick",
    isDryRun: boolean,
    skipE2e: boolean = false,
  ): CompletionValidation {
  ```

  **Change 3** - `requiredPhases` logic (lines 107-111):
  ```ts
  // Before:
  const requiredPhases = isDryRun
    ? [1, 2]
    : mode === "quick"
      ? REQUIRED_PHASES_QUICK
      : REQUIRED_PHASES_FULL;

  // After:
  const requiredPhases = isDryRun
    ? [1, 2]
    : skipE2e
      ? [1, 2, 3, 4, 6]
      : mode === "quick"
        ? REQUIRED_PHASES_QUICK
        : REQUIRED_PHASES_FULL;
  ```

- **Dependencies**: Task 1 (StateJsonSchema must have `skipE2e`)
- **AC**: AC-6

---

### Task 4: state_update schema lockdown (index.ts - improvement 2.1)

- **File(s)**: `/Users/admin/.claude/plugins/auto-dev-plugin/mcp/src/index.ts`
- **What**: Remove `phase` and `status` from the `auto_dev_state_update` tool schema (lines 154-162) and remove all guard logic (lines 169-207). Update the tool description (line 150).

- **Code sketch**:

  **Change 1** - Update description (line 150):
  ```ts
  // Before:
  "Update state fields (phase, task, iteration, etc.) with atomic write.",

  // After:
  "Update auxiliary state fields (task, iteration, flags). Phase/status changes MUST go through auto_dev_checkpoint.",
  ```

  **Change 2** - Simplify schema (lines 154-162):
  ```ts
  // Before:
  updates: z.object({
    phase: z.number().optional(),
    task: z.number().optional(),
    iteration: z.number().optional(),
    status: z.enum(["IN_PROGRESS", "PASS", "NEEDS_REVISION", "BLOCKED", "COMPLETED"]).optional(),
    dirty: z.boolean().optional(),
    interactive: z.boolean().optional(),
    dryRun: z.boolean().optional(),
  }),

  // After:
  updates: z.object({
    task: z.number().optional(),
    iteration: z.number().optional(),
    dirty: z.boolean().optional(),
    interactive: z.boolean().optional(),
    dryRun: z.boolean().optional(),
  }),
  ```

  **Change 3** - Remove guards (delete lines 167-207, the 4 guard blocks and `warnings` array). Replace with:
  ```ts
  async ({ projectRoot, topic, updates }) => {
    const sm = new StateManager(projectRoot, topic);
    await sm.atomicUpdate(updates);
    return textResult({ ok: true, updated: Object.keys(updates) });
  },
  ```

- **Dependencies**: None
- **AC**: AC-1, AC-8

---

### Task 5: Record startCommit on init + use in Phase 5 checkpoint (index.ts - improvement 2.2)

- **File(s)**: `/Users/admin/.claude/plugins/auto-dev-plugin/mcp/src/index.ts`
- **What**: Two changes:
  1. In `auto_dev_init` handler (line 65-123): After `getStatus()` call (line 98), create a named `GitManager` instance, call `getHeadCommit()`, and persist to state via `atomicUpdate`.
  2. In `auto_dev_checkpoint` Phase 5 validation (lines 273-305): Replace hardcoded `HEAD~20` (line 284) with `state.startCommit` (with fallback).

- **Code sketch**:

  **Change 1** - init handler (around lines 97-107):
  ```ts
  // Before (line 98):
  const git = await new GitManager(projectRoot).getStatus();

  // After:
  const gitManager = new GitManager(projectRoot);
  const git = await gitManager.getStatus();
  const startCommit = await gitManager.getHeadCommit();

  // After sm.init() and behavior flags (before getFullState), add startCommit:
  // Merge into behaviorUpdates or do a separate atomicUpdate:
  await sm.atomicUpdate({ startCommit });
  ```

  **Change 2** - checkpoint Phase 5 (line 284):
  ```ts
  // Before:
  execFileAsync("git", ["diff", "--name-only", "--diff-filter=A", "HEAD~20", "HEAD"], ...)

  // After:
  const baseCommit = state.startCommit ?? "HEAD~20";
  execFileAsync("git", ["diff", "--name-only", "--diff-filter=A", baseCommit, "HEAD"], ...)
  ```

- **Dependencies**: Task 1 (startCommit in schema), Task 2 (getHeadCommit method)
- **AC**: AC-2, AC-8

---

### Task 6: Preflight returns suggestedPrompt (index.ts - improvement 2.3)

- **File(s)**: `/Users/admin/.claude/plugins/auto-dev-plugin/mcp/src/index.ts`
- **What**: At the end of the `auto_dev_preflight` handler (before line 399's `return`), when `ready=true`, auto-render the phase prompt template and include `suggestedPrompt` + `suggestedAgent` in the response. Add a helper function `buildVariablesFromState()`.

- **Code sketch**:

  **New helper function** (add near top of file, after `textResult` helper around line 38):
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
  Note: requires importing `StateJson` type from `./types.js` (add to existing import at line 19 area -- currently only `StateManager` is imported, not the type).

  **Preflight handler extension** (replace lines 398-399):
  ```ts
  const ready = checks.every((c) => c.passed);
  const result: Record<string, unknown> = { ready, checks };

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
      try {
        const state = await sm.loadAndValidate();
        const gitInfo = await gitManager.getStatus();
        const variables = buildVariablesFromState(state, gitInfo.currentBranch);
        const renderer = new TemplateRenderer(defaultSkillsDir());
        const rendered = await renderer.render(mapping.promptFile, variables);
        result.suggestedPrompt = rendered.renderedPrompt;
        result.suggestedAgent = mapping.agent;
      } catch { /* prompt file not found or render error, skip */ }
    }
  }

  return textResult(result);
  ```

- **Dependencies**: None (but benefits from Task 1 for type coherence)
- **AC**: AC-3, AC-8

---

### Task 7: Resume with task-level info (index.ts - improvement 2.4)

- **File(s)**: `/Users/admin/.claude/plugins/auto-dev-plugin/mcp/src/index.ts`
- **What**: In the `auto_dev_init` resume branch (lines 76-91), after loading the state, parse `progress-log.md` to find the last Phase 3 task checkpoint and include `resumeTask` / `resumeTaskStatus` in the return value.

- **Code sketch** (insert between lines 77 and 78, i.e., after `loadAndValidate()` and before `return textResult(...)`):
  ```ts
  // Parse progress-log for last Phase 3 task
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
  } catch { /* no progress log yet */ }

  return textResult({
    projectRoot: state.projectRoot,
    outputDir: sm.outputDir,
    resumed: true,
    topic: state.topic,
    mode: state.mode,
    phase: state.phase,
    status: state.status,
    language: state.stack.language,
    buildCmd: state.stack.buildCmd,
    testCmd: state.stack.testCmd,
    langChecklist: state.stack.langChecklist,
    resumeTask: lastTask,
    resumeTaskStatus: lastTaskStatus,
  });
  ```

- **Dependencies**: None
- **AC**: AC-4

---

### Task 8: Phase timing in checkpoint + complete (index.ts - improvement 2.5)

- **File(s)**: `/Users/admin/.claude/plugins/auto-dev-plugin/mcp/src/index.ts`
- **What**: Two changes:
  1. In `auto_dev_checkpoint` handler (after line 245 `const stateUpdates`): Record phase start time on `IN_PROGRESS`, and completion time + duration on `PASS`/`BLOCKED`/`COMPLETED`.
  2. In `auto_dev_complete` handler (lines 539-544): Include timing summary in the success return value.

- **Code sketch**:

  **Change 1** - checkpoint handler (insert after line 245):
  ```ts
  // Phase timing tracking
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

  **Change 2** - complete handler, add `formatDuration` helper near top of file:
  ```ts
  function formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  }
  ```

  **Change 3** - complete handler success return (replace lines 539-544):
  ```ts
  const timingSummary = Object.entries(state.phaseTimings ?? {}).map(([p, t]) => ({
    phase: parseInt(p),
    durationMs: t.durationMs,
    durationStr: t.durationMs ? formatDuration(t.durationMs) : "unknown",
  }));

  return textResult({
    canComplete: true,
    passedPhases: validation.passedPhases,
    message: validation.message,
    status: "COMPLETED",
    timingSummary,
  });
  ```

- **Dependencies**: Task 1 (phaseTimings in schema)
- **AC**: AC-5, AC-8

---

### Task 9: skipE2e flag in init + checkpoint + complete (index.ts - improvement 2.6)

- **File(s)**: `/Users/admin/.claude/plugins/auto-dev-plugin/mcp/src/index.ts`
- **What**: Three changes:
  1. Add `skipE2e` parameter to `auto_dev_init` tool schema (line 62 area) and persist it to state.
  2. In `auto_dev_checkpoint` Phase 5 validation (line 273), skip validation when `state.skipE2e === true`.
  3. In `auto_dev_complete` (line 514-518), pass `state.skipE2e === true` as fourth argument to `validateCompletion()`.

- **Code sketch**:

  **Change 1** - init schema (add after line 62):
  ```ts
  skipE2e: z.boolean().optional(),
  ```
  And in the handler, persist it alongside other behavior flags (around lines 102-107):
  ```ts
  if (skipE2e) behaviorUpdates["skipE2e"] = true;
  ```

  **Change 2** - checkpoint Phase 5 guard (line 273):
  ```ts
  // Before:
  if (phase === 5 && status === "PASS") {

  // After:
  if (phase === 5 && status === "PASS" && state.skipE2e !== true) {
  ```

  **Change 3** - complete handler (lines 514-518):
  ```ts
  // Before:
  const validation = validateCompletion(
    progressLogContent,
    state.mode,
    state.dryRun === true,
  );

  // After:
  const validation = validateCompletion(
    progressLogContent,
    state.mode,
    state.dryRun === true,
    state.skipE2e === true,
  );
  ```

- **Dependencies**: Task 1 (skipE2e in schema), Task 3 (phase-enforcer skipE2e support)
- **AC**: AC-6, AC-8

---

### Task 10: Token estimation tracking (index.ts - improvement 2.7)

- **File(s)**: `/Users/admin/.claude/plugins/auto-dev-plugin/mcp/src/index.ts`
- **What**: Two changes:
  1. Add `tokenEstimate` optional parameter to `auto_dev_checkpoint` schema (line 230 area).
  2. In the checkpoint handler, accumulate token usage into `state.tokenUsage` (after the timing code from Task 8).
  3. In `auto_dev_complete`, include `tokenUsage` in the success return.

- **Code sketch**:

  **Change 1** - checkpoint schema (add after `summary` parameter, around line 230):
  ```ts
  tokenEstimate: z.number().optional(),
  ```

  **Change 2** - checkpoint handler (add after timing code, before `atomicUpdate`):
  ```ts
  if (tokenEstimate !== undefined) {
    const usage = { ...(state.tokenUsage ?? { total: 0, byPhase: {} }) };
    usage.total += tokenEstimate;
    const pk = String(phase);
    usage.byPhase = { ...usage.byPhase };
    usage.byPhase[pk] = (usage.byPhase[pk] ?? 0) + tokenEstimate;
    stateUpdates["tokenUsage"] = usage;
  }
  ```

  **Change 3** - complete handler (add `tokenUsage` to success return, alongside `timingSummary`):
  ```ts
  tokenUsage: state.tokenUsage ?? { total: 0, byPhase: {} },
  ```

- **Dependencies**: Task 1 (tokenUsage in schema)
- **AC**: AC-7, AC-8

---

### Task 11: Build verification

- **File(s)**: All modified files
- **What**: Run `npm run build` (or the project's TypeScript compilation command) from `/Users/admin/.claude/plugins/auto-dev-plugin/mcp` to verify all changes compile without errors. Fix any type errors that arise from schema changes.
- **Code sketch**: N/A (verification step)
- **Dependencies**: Tasks 1-10
- **AC**: AC-8

---

## Dependency Graph

```
Task 1 (types.ts schema) ─────┬──> Task 3 (phase-enforcer) ──> Task 9 (skipE2e in index.ts)
                               ├──> Task 5 (startCommit in index.ts) <── Task 2 (git-manager)
                               ├──> Task 8 (timing in index.ts)
                               └──> Task 10 (token in index.ts)

Task 4 (state_update lockdown) ──> independent

Task 6 (preflight prompt) ──> independent

Task 7 (resume task info) ──> independent

Task 11 (build check) ──> all tasks
```

## AC Coverage Matrix

| AC | Description | Covered by Task(s) |
|----|-------------|---------------------|
| AC-1 | state_update rejects phase/status | Task 4 |
| AC-2 | init returns startCommit; Phase 5 uses it | Tasks 1, 2, 5 |
| AC-3 | preflight returns suggestedPrompt/suggestedAgent | Task 6 |
| AC-4 | resume returns resumeTask/resumeTaskStatus | Task 7 |
| AC-5 | checkpoint records phaseTimings; complete returns summary | Tasks 1, 8 |
| AC-6 | skipE2e skips Phase 5; complete accepts without Phase 5 | Tasks 1, 3, 9 |
| AC-7 | checkpoint accumulates tokenEstimate to state | Tasks 1, 10 |
| AC-8 | Build passes | Task 11 |
