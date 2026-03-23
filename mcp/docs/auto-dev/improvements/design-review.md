# Design Review: auto-dev improvements

## Verdict: NEEDS_REVISION

3 issues must be addressed before implementation; the rest is solid.

## Findings

### [ISSUE] 2.2: init records startCommit but calls undeclared `gitManager` variable

- **Severity**: critical
- **Detail**: The design snippet shows:
  ```ts
  const git = await new GitManager(projectRoot).getStatus();
  const startCommit = await gitManager.getHeadCommit();
  ```
  The variable `gitManager` does not exist in the current `auto_dev_init` handler. The existing code creates `new GitManager(projectRoot)` and assigns it to `git` (which is the returned `GitInfo` object, not the `GitManager` instance). So `gitManager.getHeadCommit()` would be a runtime error.
- **Recommendation**: Use a named `GitManager` instance:
  ```ts
  const gitManager = new GitManager(projectRoot);
  const git = await gitManager.getStatus();
  const startCommit = await gitManager.getHeadCommit();
  ```

### [ISSUE] 2.3: `render()` expects `Record<string, string>` but `buildVariablesFromState` is unspecified

- **Severity**: major
- **Detail**: The design says "need to add helper function `buildVariablesFromState(state)`" but provides no implementation. `TemplateRenderer.render()` requires `variables: Record<string, string>`, while `StateJson` fields are mixed types (numbers, booleans, nested objects). The mapping between init-returned fields and render variable names is non-trivial -- SKILL.md documents the mapping (e.g., `buildCmd` -> `build_cmd`, `langChecklist` -> `lang_checklist`). Getting this wrong means preflight would return prompts with unreplaced `{build_cmd}` placeholders, silently degrading agent quality.
- **Recommendation**: Define `buildVariablesFromState` explicitly in the design:
  ```ts
  function buildVariablesFromState(state: StateJson): Record<string, string> {
    return {
      topic: state.topic,
      language: state.stack.language,
      build_cmd: state.stack.buildCmd,
      test_cmd: state.stack.testCmd,
      lang_checklist: state.stack.langChecklist,
      output_dir: state.outputDir,
      project_root: state.projectRoot,
    };
  }
  ```
  Also note: `branch` is documented in SKILL.md's variable mapping table but is not stored in `StateJson`. It would need to be fetched from `GitManager.getStatus()` at preflight time or added to state.

### [ISSUE] 2.6: `validateCompletion` and `computeNextDirective` need `skipE2e` but have no access to it

- **Severity**: major
- **Detail**: The design shows `skipE2e` logic inside `computeNextDirective` and `validateCompletion` in `phase-enforcer.ts`, but the current function signatures are:
  - `computeNextDirective(currentPhase, status, state)` -- `state` is `StateJson`, so `state.skipE2e` would work only after the schema is updated.
  - `validateCompletion(progressLogContent, mode, isDryRun)` -- this function does NOT receive `state` or `skipE2e`. The design snippet shows `skipE2e` being used inside `validateCompletion` but does not show the signature change.

  Furthermore, the caller in `auto_dev_complete` (index.ts line 514-518) passes `(progressLogContent, state.mode, state.dryRun === true)`. A fourth parameter `state.skipE2e` must be added.
- **Recommendation**: Update the design to explicitly show the new `validateCompletion` signature:
  ```ts
  export function validateCompletion(
    progressLogContent: string,
    mode: "full" | "quick",
    isDryRun: boolean,
    skipE2e: boolean,  // NEW
  ): CompletionValidation
  ```
  And update the caller in `auto_dev_complete`.

### [PASS] 2.1: state_update schema lockdown

- **Severity**: n/a
- **Detail**: Clean and correct. Removing `phase` and `status` from the schema is the right approach -- it eliminates the bypass surface entirely without needing guard logic. The guard code removal is correctly identified as a consequence.

### [PASS] 2.2: startCommit approach (aside from the variable naming bug above)

- **Severity**: n/a
- **Detail**: Using `startCommit` from init time instead of `HEAD~20` is correct. The fallback `state.startCommit ?? "HEAD~20"` provides backward compatibility for existing sessions. The new `getHeadCommit()` method on `GitManager` is straightforward.

### [PASS] 2.4: Task-level resume from progress-log

- **Severity**: n/a
- **Detail**: The regex-based parsing of `CHECKPOINT phase=3 task=(\d+) status=(\w+)` against progress-log content is consistent with the checkpoint line format produced by `getCheckpointLine()` (which outputs `<!-- CHECKPOINT phase=N task=N status=X ... -->`). The regex will match correctly.

### [PASS] 2.5: Phase-level timing

- **Severity**: n/a
- **Detail**: Clean design. `phaseTimings` as `z.record(z.string(), ...)` is appropriate since Zod record keys are strings. The timing logic correctly handles the IN_PROGRESS -> PASS/BLOCKED lifecycle.

### [ISSUE] 2.5: `auto_dev_complete` does not receive `phaseTimings` -- dormant path risk

- **Severity**: minor
- **Detail**: The design shows timing summary code inside `auto_dev_complete`, but the current `auto_dev_complete` handler (index.ts line 530-544) returns a simple result object. The design does not show WHERE in the return value the `timingSummary` is included (just shows computation). This is a minor gap but could lead to the timing data being computed and discarded.
- **Recommendation**: Show the complete return statement:
  ```ts
  return textResult({
    canComplete: true,
    passedPhases: validation.passedPhases,
    message: validation.message,
    status: "COMPLETED",
    timingSummary,  // ADD THIS
  });
  ```

### [PASS] 2.7: Token estimation tracking

- **Severity**: n/a
- **Detail**: Simple accumulator pattern, correctly optional. The `byPhase` aggregation using `+=` handles multiple checkpoints per phase (e.g., Phase 3 with multiple tasks).

### [PASS] Acceptance criteria coverage

- **Severity**: n/a
- **Detail**: AC-1 through AC-8 are well-defined and directly testable. AC-8 (build passes) is critical since all changes are in TypeScript with Zod schemas.

## Summary

Three issues require design revision before implementation:

1. **P0 (2.2)**: Variable naming bug -- `gitManager` vs `git` -- will cause a compile error.
2. **P1 (2.3)**: `buildVariablesFromState` is referenced but never defined. The field-name mapping between `StateJson` and render variables is a known source of bugs (camelCase vs snake_case). Must be specified.
3. **P1 (2.6)**: `validateCompletion` signature change not shown. The caller in `auto_dev_complete` also needs updating. This is a caller-side review issue (Rule 1) -- the design only shows the producer-side change.

All three are straightforward to fix in the design document.
