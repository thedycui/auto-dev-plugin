# Code Review: auto-dev improvements

## Verdict: NEEDS_REVISION

## AC Coverage

| AC | Status | Notes |
|----|--------|-------|
| AC-1 | PASS | `state_update` schema no longer has `phase`/`status`; guard code removed. Zod will reject unknown fields. |
| AC-2 | PASS | `init` records `startCommit` via `gitManager.getHeadCommit()`; Phase 5 checkpoint uses `state.startCommit ?? "HEAD~20"` as fallback. |
| AC-3 | PASS | `preflight` renders `suggestedPrompt` + `suggestedAgent` via `buildVariablesFromState()` when `ready=true`. |
| AC-4 | PASS | Resume branch parses progress-log for last Phase 3 task checkpoint, returns `resumeTask` / `resumeTaskStatus`. |
| AC-5 | PASS | Checkpoint records `phaseTimings` on IN_PROGRESS/PASS/BLOCKED/COMPLETED; `complete` returns `timingSummary`. |
| AC-6 | ISSUE | `skipE2e` works for `full` mode but has a bug when combined with `quick` mode (see P0 finding below). |
| AC-7 | PASS | Checkpoint accumulates `tokenEstimate` into `state.tokenUsage`; `complete` returns it. |
| AC-8 | UNVERIFIED | Build was not verified in this review. Recommend running `npm run build`. |

## Findings

### [ISSUE] skipE2e + quick mode produces wrong required phases in validateCompletion

- **Severity**: P0 (blocking)
- **File**: `/Users/admin/.claude/plugins/auto-dev-plugin/mcp/src/phase-enforcer.ts` lines 111-117
- **Detail**: The `requiredPhases` ternary checks `skipE2e` before `mode === "quick"`. When `skipE2e=true` and `mode="quick"`, the result is `[1, 2, 3, 4, 6]` -- requiring phases 1, 2, and 6, which quick mode never executes. This means `auto_dev_complete` will always reject a `quick + skipE2e` session. The design doc says quick mode requires `[3, 4, 5]`; with skipE2e it should be `[3, 4]`.
- **Fix**: Restructure the ternary to account for the mode/skipE2e combination:
  ```ts
  const requiredPhases = isDryRun
    ? [1, 2]
    : mode === "quick"
      ? (skipE2e ? [3, 4] : REQUIRED_PHASES_QUICK)
      : (skipE2e ? [1, 2, 3, 4, 6] : REQUIRED_PHASES_FULL);
  ```

### [ISSUE] InitInputSchema in types.ts missing skipE2e field

- **Severity**: P1 (major -- schema drift)
- **File**: `/Users/admin/.claude/plugins/auto-dev-plugin/mcp/src/types.ts` lines 122-130
- **Detail**: `InitInputSchema` does not include `skipE2e`, but `index.ts` defines it inline in the tool registration schema (line 86). The types.ts schema is the canonical schema definition. While the inline schema is what actually runs (MCP SDK uses it directly), having two divergent schema definitions is a maintenance risk and violates the pattern established in types.ts for all other tools.
- **Fix**: Add `skipE2e: z.boolean().optional()` to `InitInputSchema` in types.ts.

### [ISSUE] CheckpointInputSchema in types.ts missing tokenEstimate field

- **Severity**: P1 (major -- schema drift, same pattern as above)
- **File**: `/Users/admin/.claude/plugins/auto-dev-plugin/mcp/src/types.ts` lines 168-173
- **Detail**: `CheckpointInputSchema` does not include `tokenEstimate`, but `index.ts` defines it inline in the checkpoint tool schema (line 224). Same schema drift concern.
- **Fix**: Add `tokenEstimate: z.number().optional()` to `CheckpointInputSchema` in types.ts.

### [PASS] state_update lockdown (2.1)

- **Severity**: N/A
- **Detail**: `phase` and `status` fields cleanly removed from schema. Guard code removed. Description updated. The handler is now a clean pass-through to `sm.atomicUpdate()`. Backward compatible -- old callers passing `phase`/`status` will get a Zod validation error with a clear message.

### [PASS] startCommit recording and usage (2.2)

- **Severity**: N/A
- **Detail**: `getHeadCommit()` in git-manager.ts correctly calls `git rev-parse HEAD` and trims the output. In `init`, `startCommit` is persisted via `atomicUpdate` alongside other behavior flags. In checkpoint Phase 5, the fallback `"HEAD~20"` preserves backward compatibility with old state.json files that lack `startCommit`. Correct implementation.

### [PASS] preflight suggestedPrompt (2.3)

- **Severity**: N/A
- **Detail**: `buildVariablesFromState()` correctly maps all required template variables. The preflight handler creates a separate `GitManager` instance to get the branch name (line 437). The try/catch silently skips render errors, which is acceptable -- prompt rendering is best-effort and should not block preflight. The `phasePromptMap` covers all 6 phases.

### [PASS] Resume task-level info (2.4)

- **Severity**: N/A
- **Detail**: The regex `/CHECKPOINT phase=3 task=(\d+) status=(\w+)/g` correctly matches the format produced by `getCheckpointLine()`: `<!-- CHECKPOINT phase=3 task=N status=WORD ... -->`. The loop correctly keeps only the last match (latest task). The try/catch handles missing progress-log gracefully.

### [PASS] Phase timing tracking (2.5)

- **Severity**: N/A
- **Detail**: Timing logic correctly handles IN_PROGRESS (record start), PASS/BLOCKED/COMPLETED (record end + compute duration). Shallow copy of `timings` object prevents mutation of loaded state. `formatDuration()` helper handles hours/minutes/seconds correctly. The `complete` handler includes `timingSummary` in the return value.

### [PASS] Token usage tracking (2.7)

- **Severity**: N/A
- **Detail**: Token accumulation correctly handles first-use initialization (`{ total: 0, byPhase: {} }`), and creates a shallow copy of `byPhase` before mutation (line 263). The `complete` handler returns `tokenUsage` with a sensible default when absent.

### [PASS] skipE2e in computeNextDirective (2.6 -- partial)

- **Severity**: N/A
- **Detail**: `computeNextDirective` correctly checks `state.skipE2e === true` and jumps nextPhase from 5 to 6. This works regardless of mode because the function already uses `maxPhase` (from dryRun) as the upper bound.

### [PASS] Backward compatibility

- **Severity**: N/A
- **Detail**: All new fields in `StateJsonSchema` are `.optional()`, so existing state.json files without them will parse correctly. All consumers use nullish coalescing (`??`) for safe defaults: `state.startCommit ?? "HEAD~20"`, `state.phaseTimings ?? {}`, `state.tokenUsage ?? { total: 0, byPhase: {} }`, `state.skipE2e !== true`.

### [PASS] Error handling in checkpoint

- **Severity**: N/A
- **Detail**: The checkpoint handler preserves the crash-safe pattern: progress-log is written first, then state.json is updated atomically. If state.json update fails, the handler marks state as dirty via a direct write fallback. Phase 5/6 artifact validation occurs after state update, which is correct -- the checkpoint is recorded even if validation fails.

## Summary

One P0 blocking issue: `skipE2e` combined with `quick` mode produces incorrect required phases in `validateCompletion`, making it impossible to complete a quick+skipE2e session. Two P1 schema drift issues where types.ts canonical schemas diverge from inline tool schemas in index.ts (missing `skipE2e` on InitInput, missing `tokenEstimate` on CheckpointInput). All other implementations are correct and match the design/plan.
