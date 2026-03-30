# Phase 4: Code Review -- TDD Gate (RED-GREEN)

**Reviewer**: auto-dev-reviewer (Phase 4 deep review)
**Date**: 2026-03-26
**Files reviewed**: 9 files (1 new, 8 modified)
**Design**: design.md (including Section 10 revisions)
**Plan**: plan.md (10 tasks)

---

## P0: Blocking Issues

### P0-1: `buildTestCommand` does not match actual stack language string for TypeScript

**File**: `mcp/src/tdd-gate.ts` lines 86-89
**Severity**: P0 -- RED/GREEN gate completely broken for all TypeScript/JavaScript projects

The `buildTestCommand` switch handles `"TypeScript"` and `"JavaScript"` as separate cases:
```typescript
case "TypeScript":
case "JavaScript": {
```

But the actual stack definition in `skills/auto-dev/stacks/node-npm.md` defines the language as `"TypeScript/JavaScript"` (a single compound string). This means for any project detected as a Node/npm project, `buildTestCommand` will fall through to the `default:` case and return `""`, which causes `auto_dev_task_red` (line 666-671 of index.ts) to return `NO_TEST_COMMAND` error, making TDD completely unusable for this project's own language.

**Fix**: Add `"TypeScript/JavaScript"` to the switch:
```typescript
case "TypeScript":
case "JavaScript":
case "TypeScript/JavaScript": {
```

**Caller-Side Impact**: The auto-dev plugin itself is a TypeScript project (`node-npm.md` stack). Any `tdd=true` session on this codebase will fail at the first `auto_dev_task_red` call.

---

## P1: Important Issues

### P1-1: `tddWarnings` field not cleaned up from schema (dead code)

**Files**: `mcp/src/types.ts` lines 112, 178
**Severity**: P1

The old `tddWarnings: z.array(z.string()).optional()` field remains in both `StateJsonSchema` (line 112) and `InitInputSchema` (line 178). The plan (Task 5) specified removing the old TDD Iron Law code, but the `tddWarnings` schema field was not deleted. While it is `.optional()` and does not break anything, it is confusing dead code that contradicts the new `tddTaskStates` approach.

**Fix**: Remove `tddWarnings` from both `StateJsonSchema` and `InitInputSchema`. The `tddWarning: null` parameter in `internalCheckpoint` (state-manager.ts line 527) should also have its type cleaned up.

### P1-2: No test files exist for any TDD gate code (first-activation risk)

**Severity**: P1 -- Dormant Path Detection

The plan specified TDD-required tests for Tasks 1-4, 6, 7 with specific test cases listed. However, zero test files were created:
- No `tdd-gate.test.ts` for `isTestFile`, `isImplFile`, `buildTestCommand`, `validateRedPhase`
- No tests for `isTddExemptTask` in phase-enforcer
- No tests for the RED/GREEN handlers in index.ts
- No tests for `extractTddGateStats` in retrospective-data.ts
- No tests for the Phase 4 tribunal checklist TDD additions

All new code is **first-activation** -- none of the following paths have ever been executed in production:
- `auto_dev_task_red` handler (index.ts lines 600-726)
- `auto_dev_task_green` handler (index.ts lines 733-834)
- `validateRedPhase` (tdd-gate.ts)
- `buildTestCommand` (tdd-gate.ts) -- and as P0-1 shows, it has a real bug
- `extractTddGateStats` (retrospective-data.ts)
- `isTddExemptTask` (phase-enforcer.ts)
- TDD checkpoint guard (index.ts lines 557-574)

This is exactly the "dormant path" risk described in the review rules. The plan listed 40+ specific test cases across 7 tasks, none were implemented.

**Fix**: Implement the test files specified in the plan before merging. At minimum, unit tests for `tdd-gate.ts` functions and `isTddExemptTask` are required to catch bugs like P0-1.

### P1-3: `execFile` error handling uses `err.code` which is not the exit code

**File**: `mcp/src/index.ts` lines 678-680, 793-795
**Severity**: P1

```typescript
const code = err ? (err as any).code ?? 1 : 0;
```

When `execFile` callback receives an error for a non-zero exit, the error object's `.code` property is the exit code, but only for `ChildProcess` errors. The `err.code` for other error types (e.g., `ENOENT` when `sh` is not found, or `ETIMEDOUT` on timeout) would be a string like `"ENOENT"` or `"ETIMEDOUT"`, not a number. Using `(err as any).code ?? 1` would then set `code` to the string `"ENOENT"`, and the check `exitCode === 0` would correctly be false (not a number), but `exitCode` being a string is semantically wrong and would be written to `tddTaskStates.redExitCode` (a `z.number()` field), potentially failing Zod validation on the subsequent `atomicUpdate`.

**Fix**: Use `err.status` or `err.code` with explicit numeric check:
```typescript
const code = err
  ? (typeof (err as any).code === "number" ? (err as any).code : 1)
  : 0;
```

Or better, use `child_process.exec` which gives `err.code` as a number for exit codes, or check `(err as any).status`.

### P1-4: RED gate can be bypassed by staging impl files before calling `auto_dev_task_red`

**File**: `mcp/src/index.ts` lines 637-652
**Severity**: P1

The RED handler gets changed files via:
```
git diff --name-only HEAD        (unstaged changes)
git ls-files --others --exclude-standard  (untracked files)
```

But this misses **staged** changes. If the agent runs `git add SomeImpl.java` before calling `auto_dev_task_red`, the staged impl file would NOT appear in `git diff --name-only HEAD` (which only shows unstaged diffs) or `ls-files --others` (which only shows untracked files). The impl file would be invisible to the validation.

**Fix**: Use `git diff --name-only HEAD --cached` to also capture staged changes, or use `git diff --name-only HEAD` combined with `--cached`:
```
git diff --name-only HEAD        // unstaged vs HEAD
git diff --name-only --cached    // staged vs HEAD
git ls-files --others --exclude-standard  // untracked
```

Alternatively, use `git status --porcelain` to get all changes in one call.

---

## P2: Optimization Suggestions

### P2-1: `isTestFile` false positive on `src/main/java/TestDataFactory.java`

**File**: `mcp/src/tdd-gate.ts` line 15

The pattern `/[Tt]est\.(java|ts|js|py)$/` matches any file ending in `Test.java`, including files in `src/main/java/` like `TestDataFactory.java` or `TestHelper.java`. The plan's test list even explicitly calls this out ("does NOT match `src/main/java/TestDataFactory.java`") but the implementation does not handle it.

**Fix**: Add a check that the file is in a test directory, or tighten the pattern to require the filename to END with `Test` (not just contain it before the extension):
```typescript
// Only match files where filename IS *Test.java, not *TestSomething.java
/(?:^|\/)[^/]*Test\.(java|ts|js|py)$/
```

However, `TestDataFactory.java` would still NOT match this (it ends with `Factory.java`). The real concern is files like `src/main/java/com/metrics/web/TestUtils.java` which ends with `Utils.java` and also would not match. The current pattern is acceptable for most cases. Noting as P2.

### P2-2: `extractTddGateStats` exempt task count is always 0

**File**: `mcp/src/retrospective-data.ts` line 233

```typescript
const exemptTasks = 0; // exempt tasks are not recorded in tddTaskStates
```

The comment acknowledges the limitation but does not attempt to count them. The plan (Task 7) specified counting exempt tasks. The retrospective data will always show 0 exempt tasks even when tasks were skipped via `**TDD**: skip`.

**Fix**: Read `plan.md` and count `## Task N` sections with `**TDD**: skip` markers, or derive from total plan tasks minus tddTaskStates entries.

### P2-3: `buildTestCommand` does not quote file paths

**File**: `mcp/src/tdd-gate.ts` lines 88, 94

Test file paths are joined with spaces without quoting. Paths with spaces would break the command.

**Fix**: Wrap each file in quotes: `testFiles.map(f => `"${f}"`).join(" ")`

---

## Focus Question Answers

### 1. Is the RED gate actually enforceable? Can the agent bypass it?

**Partially enforceable, with a gap (P1-4).** The checkpoint guard at lines 557-574 correctly blocks `checkpoint(phase=3, task=N, status=PASS)` unless `tddTaskStates[task].status === "GREEN_CONFIRMED"`. This is a hard gate -- the agent cannot pass Phase 3 without going through RED then GREEN. However, the RED file validation can be bypassed by staging impl files first (P1-4), meaning the agent could write test+impl simultaneously, stage the impl, call `auto_dev_task_red`, then `auto_dev_task_green`, defeating the purpose.

### 2. Is `buildTestCommand` correct for multi-module Maven?

**Yes, the multi-module logic is correct.** The path-to-module extraction (`/^([^/]+?)\/src\//`) and per-module `-pl` flag generation work correctly for the standard Maven multi-module layout. However, it is broken for TypeScript/JavaScript projects (P0-1).

### 3. Does the checkpoint `tddTaskStates` check use the enum correctly?

**Yes.** Line 562 checks `tddState?.status !== "GREEN_CONFIRMED"` which correctly uses the enum string value, not old booleans. The design revision 6 (enum migration) was properly implemented.

### 4. Was the old TDD Iron Law code fully removed?

**Partially.** The old Iron Law block in `index.ts` was removed and replaced with the new `tddTaskStates` check. However, `tddWarnings` fields remain in `types.ts` (P1-1) and the `tddWarning` parameter in `internalCheckpoint` is still accepted (though always passed as `null`). These are dead code remnants.

### 5. Dormant paths: all new code is first-activation

**Confirmed.** Every function in `tdd-gate.ts` and every handler in index.ts (RED/GREEN) is brand new, never executed. The `isTddExemptTask` in phase-enforcer is new. The `extractTddGateStats` in retrospective-data is new. Zero test files exist (P1-2). The P0-1 bug in `buildTestCommand` is a direct consequence of no test coverage on first-activation code.

---

## Summary

**Verdict: NEEDS_FIX**

| Grade | Count | Details |
|-------|-------|---------|
| P0 | 1 | buildTestCommand broken for TypeScript/JavaScript projects |
| P1 | 4 | Dead tddWarnings field, no tests, execFile error handling, RED bypass via staging |
| P2 | 3 | isTestFile false positive edge case, exempt count always 0, unquoted paths |

**Required before merge:**
1. Fix P0-1: Add `"TypeScript/JavaScript"` case to `buildTestCommand`
2. Fix P1-2: Write unit tests for `tdd-gate.ts` core functions (at minimum)
3. Fix P1-4: Include staged files in RED validation
4. Fix P1-1: Clean up dead `tddWarnings` fields
5. Fix P1-3: Harden `execFile` error code extraction
