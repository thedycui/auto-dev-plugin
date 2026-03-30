# Phase 1 Design Review: TDD Gate (RED-GREEN)

**Reviewer**: Architecture Review Expert
**Date**: 2026-03-26
**Design**: `/docs/auto-dev/tdd-gate/design.md`

---

## Summary

The design proposes splitting each Phase 3 task into two framework-gated steps (RED: write tests only, GREEN: write implementation only) to mechanically enforce TDD. Two new MCP tools (`auto_dev_task_red`, `auto_dev_task_green`) are introduced, and the existing Phase 3 checkpoint gains a TDD state check.

**Verdict: NEEDS_REVISION** -- 2 P0, 3 P1, 3 P2

---

## P0: Blocking Issues

### P0-1: `buildTestCommand` for Java ignores multi-module projects (missing `-pl`)

**Location**: Section 4.4, `buildTestCommand`, Java case

The generated command is:
```
mvn test -Dtest="BarTest" -DfailIfNoTests=false
```

In metrics-web (and most real multi-module Maven projects), test classes live in specific modules (`service-tifenbao-metrics`, `api-tifenbao-metrics`). Running `mvn test` from project root without `-pl <module>` will scan ALL modules, either failing to find the test class or running the wrong one.

The design's own Section 4.1 mentions `-pl module` in the example comment but the `buildTestCommand` implementation does not accept or derive the module path.

**Fix**: `buildTestCommand` must accept a `projectRoot`-relative path for each test file and derive the module from it:
```typescript
// src/test/java/com/foo/BarTest.java in module service-tifenbao-metrics
// → testFile = "service-tifenbao-metrics/src/test/java/com/foo/BarTest.java"
// → module = "service-tifenbao-metrics"
// → class = "BarTest"
// → mvn test -Dtest="BarTest" -pl service-tifenbao-metrics -DfailIfNoTests=false
```

### P0-2: RED validation runs tests before implementation exists -- compilation will fail, not "test fail"

**Location**: Section 4.1, `auto_dev_task_red` step 4

The design requires: "run the test files, at least 1 FAIL". But in Java (and compiled TypeScript), RED-phase tests reference classes/methods that don't exist yet. The build will fail with **compilation errors**, not test failures. `mvn test` exits with code 1 on compilation failure -- but the exit code alone cannot distinguish "test failed" from "compilation failed".

For vitest/pytest this is less critical (dynamic languages can import non-existent modules at runtime and get ImportError which counts as failure), but for Java this is a fundamental issue.

**Fix**: Two options:
1. **Accept compilation failure as valid RED** -- check exit code != 0, don't require "test FAIL" specifically. Document that RED means "tests cannot pass", not "tests run and fail". This is the pragmatic choice.
2. **Require stub implementation files in RED** -- but this contradicts "only test files in RED".

Recommend option 1. The handler should treat any non-zero exit code from the test command as RED confirmation, with a distinction logged (compilation error vs test failure) for diagnostics.

---

## P1: Important Issues

### P1-1: Dormant Path -- `tddTaskStates` added to state but never consumed by downstream phases

**Location**: Section 4.2 (state schema) + Section 6 (relationship table)

The design adds `tddTaskStates` to `state.json` and Phase 3 checkpoint reads it. But:
- Phase 4 tribunal (code review) does NOT read `tddTaskStates` to verify TDD compliance evidence
- Phase 5 tribunal (test review) does NOT read it to cross-check test coverage against RED records
- Phase 7 retrospective does NOT include TDD gate metrics (how many RED rejections, how many GREEN rejections)

The `tddTaskStates` data is **write-only** beyond Phase 3. This is wasted signal.

**Fix**: Add to design:
- Phase 4 tribunal checklist should receive `tddTaskStates` as evidence (e.g., "Task 3 RED confirmed with 2 failing tests")
- Phase 7 retrospective auto-data should include TDD gate stats
- At minimum, the Phase 3 completion summary should aggregate TDD gate results

### P1-2: File classification has false positives for "helper" test files

**Location**: Section 4.1 step 3 (file classification)

Test file patterns: `*Test.*`, `*.test.*`, `*.spec.*`, `_test.*`, `tests/` directory.

Edge cases that will cause incorrect classification:
- `src/main/java/com/metrics/TestDataFactory.java` -- matches `Test` but is a production helper
- `src/utils/contest.ts` -- contains "test" substring (though the regex uses patterns like `\.test\.` so this specific one is OK)
- `tests/fixtures/sample-data.json` -- matches `tests/` directory but is not a test file
- `src/test/resources/application-test.yml` -- matches `tests?/` directory, is a test resource not a test

The bigger risk: in RED phase, the agent writes a test **and** a test helper/fixture file. The fixture file (e.g., `tests/fixtures/mock-data.ts`) matches `tests/` directory pattern and passes, but if the agent sneaks implementation logic into a "test helper", the gate is bypassed.

**Fix**:
- Use a stricter definition: files that can be *executed* as tests (match runner patterns) vs files in test directories
- For the RED gate "only test files" check, also allow resource files in test directories (`.json`, `.yml`, `.xml`, `.sql`) -- these are test fixtures, not implementation
- Consider a negative list: explicitly reject files matching `src/main/`, `src/` (non-test), `lib/`, `dist/`

### P1-3: Existing TDD Iron Law check will conflict with new TDD gate

**Location**: `index.ts` lines 556-619 (existing TDD check) vs design Section 4.3

The existing code at checkpoint time does a `git diff --name-only startCommit..HEAD` to check for test files. The new design adds `tddTaskStates` checking at the same location. The design says the new gate "replaces" the old check (Section 6 table), but the implementation plan (Section 5) only says "Phase 3 checkpoint increases TDD state check" -- it does not explicitly say to **remove** the old Iron Law code.

If both checks coexist:
- The old check looks at `startCommit..HEAD` (all files since session start), which spans multiple tasks
- The new check is per-task via `tddTaskStates`
- They could contradict: task 1 has tests (old check passes), task 2 has no tests but `tddTaskStates` says RED+GREEN confirmed (new check passes) -- or vice versa

**Fix**: The design must explicitly state: "Remove the existing TDD Iron Law block (lines 556-619 of index.ts) and replace it entirely with the tddTaskStates check." The old advisory `tddWarning` mechanism should also be removed or migrated.

---

## P2: Optimization Suggestions

### P2-1: `isTddExemptTask` regex is fragile

The regex `## Task ${task}[\\s\\S]*?\\*\\*TDD\\*\\*:\\s*skip` uses non-greedy `[\\s\\S]*?` which will match the FIRST `**TDD**: skip` after `## Task N` -- but if the plan has nested sections or the TDD marker is in a code block, it could match incorrectly. A more robust approach: parse per-task sections first (split on `## Task \d+`), then check within the section.

### P2-2: Consider timeout for RED/GREEN test execution

The design does not specify execution timeouts for `buildTestCommand`. The Phase 5 checkpoint uses `timeout: 300_000` (5 minutes). RED/GREEN tests should be faster (single test file). Suggest 60-second timeout for RED, 120-second for GREEN.

### P2-3: State schema should use an enum for RED/GREEN status instead of booleans

Currently:
```typescript
tddTaskStates: z.record(z.string(), z.object({
  redConfirmed: z.boolean(),
  greenConfirmed: z.boolean(),
}))
```

A state machine enum would be clearer and prevent invalid states (e.g., `greenConfirmed=true` but `redConfirmed=false`):
```typescript
tddTaskStates: z.record(z.string(), z.object({
  status: z.enum(["PENDING", "RED_CONFIRMED", "GREEN_CONFIRMED"]),
  redTestFiles: z.array(z.string()).optional(),
  redFailedTests: z.array(z.string()).optional(),
}))
```

---

## Verification Against Review Rules

### Rule 1: Caller-Side Review

**Consumers of `tddTaskStates`**:
- `auto_dev_task_red` handler -- writes `redConfirmed: true` (producer)
- `auto_dev_task_green` handler -- reads `redConfirmed`, writes `greenConfirmed: true` (consumer + producer)
- Phase 3 checkpoint -- reads both flags (consumer)
- Phase 4/5/7 -- do NOT consume (flagged as P1-1)

The checkpoint consumer path is verified. The gap is downstream phases (P1-1).

### Rule 2: Dormant Path Detection

| Path | Status |
|------|--------|
| `buildTestCommand` Java branch | **UNVERIFIED** -- no existing caller, first activation will be this feature |
| `buildTestCommand` TypeScript branch | **UNVERIFIED** -- same |
| `isTddExemptTask` plan.md parser | **UNVERIFIED** -- new code |
| Phase 3 checkpoint `tddTaskStates` check | **UNVERIFIED** -- new code replacing existing Iron Law check |
| Existing Phase 3 checkpoint (non-TDD path) | VERIFIED -- production in use |
| `auto_dev_submit` tribunal flow | VERIFIED -- Phase 4/5/6/7 in use |

All new paths are first-activation. The test plan must cover each path explicitly, especially `buildTestCommand` for multi-module Java projects (P0-1).

---

## Cross-Component Impact Assessment

### Will the new tools break existing flows?

**No** -- `auto_dev_task_red` and `auto_dev_task_green` are additive tools. Existing Phase 3 flow (without TDD) is unchanged when `tdd=false`.

### Tribunal interaction?

**None directly**. Phase 3 does not use tribunal (TRIBUNAL_PHASES = [4, 5, 6, 7]). The TDD gate is Phase 3 internal. However, tribunal in Phase 4/5 could benefit from TDD gate data (see P1-1).

### State schema backward compatibility?

`tddTaskStates` is marked `.optional()` in the schema -- existing state.json files without this field will work. **No breaking change.**

### SKILL.md change risk?

The SKILL.md update (Section 4.7) changes the Phase 3 driver loop. If the main agent reads an older cached SKILL.md, it won't call `auto_dev_task_red/green`. The checkpoint gate (Section 4.3) catches this -- it will reject `checkpoint(phase=3, task=N, PASS)` if RED+GREEN are not confirmed. This is the correct fail-safe.

---

## Action Items

| ID | Priority | Action |
|----|----------|--------|
| P0-1 | P0 | Fix `buildTestCommand` to derive Maven module from test file path |
| P0-2 | P0 | Redefine RED validation: accept compilation failure (exit code != 0) as valid RED, not just "test FAIL" |
| P1-1 | P1 | Add `tddTaskStates` consumption in Phase 4 tribunal checklist and Phase 7 retrospective |
| P1-2 | P1 | Tighten file classification: add negative patterns for production paths, allow test resource files |
| P1-3 | P1 | Explicitly state removal of existing TDD Iron Law code block (index.ts lines 556-619) |
| P2-1 | P2 | Harden `isTddExemptTask` regex or switch to section-based parsing |
| P2-2 | P2 | Add execution timeouts (60s RED, 120s GREEN) |
| P2-3 | P2 | Consider enum-based status instead of dual booleans |

---

# Re-Review (Iteration 2): Design Section 十 Revisions

**Reviewer**: Architecture Review Expert
**Date**: 2026-03-26
**Scope**: Section 十 (revisions 1-7) of `design.md`, addressing 2 P0 + 3 P1 + 2 P2 from Iteration 1

---

## Per-Issue Verification

### P0-1: `buildTestCommand` multi-module Maven -- RESOLVED

**Revision 1** adds module derivation from test file paths via regex `^([^/]+?)\/src\/`. The approach:
- Correctly extracts module name from `service-tifenbao-metrics/src/test/java/com/foo/BarTest.java`
- Groups test classes by module and generates per-module commands joined with `&&`
- Falls back to `__root__` (no `-pl` flag) when path has no module prefix (single-module projects)

**Verdict**: Adequate. One minor note: the `&&` chaining means if module A's tests fail, module B's tests won't run. For RED phase this is fine (we only need one failure). For GREEN phase, all must pass, so a single failure short-circuiting is also correct behavior (fail fast). No issue.

### P0-2: RED validation accepts compilation failure -- RESOLVED

**Revision 2** changes RED validation to accept any `exitCode !== 0` as valid RED. Key details:
- `exitCode === 0` (all tests pass) is the only REJECTED case
- Compilation errors detected via `stderr.includes("COMPILATION ERROR")` for diagnostics
- `failType` field (`compilation_error` | `test_failure`) recorded for observability but does not affect the gate decision

**Verdict**: Adequate. This is exactly the recommended option 1 from the original review.

### P1-1: `tddTaskStates` consumed by downstream phases -- RESOLVED

**Revision 4** adds:
- Phase 4 tribunal checklist: "verify each non-exempt task has RED_CONFIRMED record"
- Phase 7 retrospective-data: auto-extract TDD gate stats (RED rejections, GREEN rejections, exempt count)
- Updated file change list includes `tribunal-checklists.ts` and `retrospective-data.ts`

**Verified against source code**:
- `tribunal-checklists.ts` exists and defines `PHASE_4_CHECKLIST` as a markdown string -- adding a TDD checklist item is straightforward.
- `retrospective-data.ts` exists with `generateRetrospectiveData()` returning `RetrospectiveAutoData` -- adding TDD stats requires extending the type and extraction logic.

**Verdict**: Adequate. The design describes what to add and where. The implementation plan (updated file change list) correctly identifies both files. One gap remains: the design does not specify how `tddTaskStates` data reaches the tribunal agent. Currently, tribunal receives `diff`, `testLog`, and checklist text. The Phase 4 checklist text mentioning "check tddTaskStates" is useful as a prompt instruction, but the tribunal agent also needs the actual `tddTaskStates` data passed as input context. This is a **P2-level gap** (the checklist instruction alone may be sufficient for the tribunal to look up state.json, which it already has access to via the diff/project context).

### P1-2: File classification dual-filter -- RESOLVED

**Revision 5** introduces `isTestFile()` and `isImplFile()` with:
- **Positive patterns**: `/[Tt]est\.(java|ts|js|py)$/`, `\.test\.`, `\.spec\.`, `_test\.` for test files
- **Test resource allowance**: `.json`, `.yml`, `.yaml`, `.xml`, `.sql`, `.txt`, `.csv` in `tests?/|__tests__|spec/|fixtures/` directories
- **Impl file detection**: any source code file (`.java`, `.ts`, `.js`, `.py`, etc.) that is NOT a test file
- RED gate: rejects if any `isImplFile()` returns true

**Verification of original edge cases**:
- `src/main/java/com/metrics/TestDataFactory.java`: `isTestFile` regex `[Tt]est\.(java|...)$` checks end-of-string -- `TestDataFactory.java` ends with `Factory.java`, so it does NOT match. `isImplFile` returns true. Correctly blocked in RED. Good.
- `tests/fixtures/sample-data.json`: Matches `isTestResource` (`.json` in `fixtures/`). Allowed in RED. Good.
- `src/test/resources/application-test.yml`: Matches `isTestResource` (`.yml` in path containing `test/`). Allowed in RED. Good.
- `tests/fixtures/mock-data.ts`: Does NOT match `isTestResource` (`.ts` is not in the resource extension list). Does match `isImplFile` (`.ts` extension, not a test file by name pattern). **Correctly blocked in RED.** This addresses the original concern about sneaking implementation into test helpers.

**Remaining gap**: A file like `src/test/java/com/foo/TestHelper.java` (a legitimate test utility class) would not match `isTestFile` patterns (it does not end with `Test.java` -- it starts with `Test`) and would be flagged by `isImplFile`. This could cause false RED rejections for valid test helper files. However, this is a conservative error (false reject, not false accept) and the agent can work around it by naming helpers `*Test.java` or placing logic in the test file itself. **P2-level, not blocking.**

**Verdict**: Adequate. The dual-filter approach is sound. Conservative bias is correct for a security gate.

### P1-3: Explicit removal of TDD Iron Law code -- RESOLVED

**Revision 3** explicitly states in the file change table:
> `mcp/src/index.ts` -- **DELETE** existing TDD Iron Law code block (~lines 556-619), **REPLACE WITH** tddTaskStates check

**Verified against source**: Lines 556-619 contain the `tddWarning` logic, the `git diff --name-only` check, and the `TDD_VIOLATION` hard block. The `tddWarning` variable is also passed to `internalCheckpoint` at line 627. The revision correctly identifies the removal scope.

**Verdict**: Adequate. The removal scope is clear and the replacement mechanism (tddTaskStates) is well-defined.

---

## Bonus Revisions (P2 adopted)

### P2-2 (Timeouts) -- Adopted in Revision 7
60s RED, 120s GREEN. Reasonable values. No issue.

### P2-3 (Enum status) -- Adopted in Revision 6
State changed from dual booleans to `status: z.enum(["PENDING", "RED_CONFIRMED", "GREEN_CONFIRMED"])`. Also adds `redExitCode` and `redFailType` for diagnostics. Clean design, prevents invalid states.

**Note**: The checkpoint code in Section 4.3 still references `tddState?.redConfirmed` and `tddState?.greenConfirmed` (boolean checks), which no longer exist in the revised schema. The checkpoint logic must be updated to check `tddState?.status === "GREEN_CONFIRMED"` instead. This is an internal inconsistency introduced by the revision.

---

## New Issues Introduced by Revisions

### P1-NEW-1: Section 4.3 checkpoint logic inconsistent with revised schema (Revision 6)

**Location**: Section 4.3 vs Section 十 Revision 6

Section 4.3 still reads:
```typescript
if (!tddState?.redConfirmed) { ... }
if (!tddState?.greenConfirmed) { ... }
```

But Revision 6 changed the schema to use `status: z.enum(["PENDING", "RED_CONFIRMED", "GREEN_CONFIRMED"])`. The checkpoint should now check:
```typescript
if (tddState?.status !== "GREEN_CONFIRMED") {
  // Task has not completed both RED and GREEN
}
```

**Fix**: Update Section 4.3 to align with the revised schema. Since `GREEN_CONFIRMED` implies RED was completed (state machine: PENDING -> RED_CONFIRMED -> GREEN_CONFIRMED), a single check `status === "GREEN_CONFIRMED"` is sufficient.

### P2-NEW-1: `buildTestCommand` return type mismatch when multiple modules

**Location**: Section 十 Revision 1

When tests span multiple modules, the function returns `commands.join(" && ")` -- a single string with chained commands. But when there is only one module, it returns a single command string. The caller should handle both cases uniformly. This is fine as-is (both are valid shell strings), but worth noting that the `&&` chain could be long for projects with many modules. Not blocking.

---

## Updated Caller-Side Review (Rule 1)

With Revision 4, the consumer chain for `tddTaskStates` is now:
- **Producer**: `auto_dev_task_red` (writes status=RED_CONFIRMED), `auto_dev_task_green` (writes status=GREEN_CONFIRMED)
- **Consumer 1**: Phase 3 checkpoint (reads status to gate task completion) -- needs schema alignment fix (P1-NEW-1)
- **Consumer 2**: Phase 4 tribunal checklist (reads as evidence)
- **Consumer 3**: Phase 7 retrospective (reads for stats)

All consumer paths now have defined behavior. The schema alignment issue (P1-NEW-1) is the only gap.

---

## Summary

| Original Issue | Status | Notes |
|----------------|--------|-------|
| P0-1 (multi-module Maven) | RESOLVED | Module derived from path, grouped commands |
| P0-2 (compilation failure) | RESOLVED | Any non-zero exit code accepted as RED |
| P1-1 (tddTaskStates unused) | RESOLVED | Phase 4 checklist + Phase 7 retrospective added |
| P1-2 (file classification) | RESOLVED | Dual-filter with conservative bias |
| P1-3 (old TDD code conflict) | RESOLVED | Explicit removal documented |
| P2-2 (timeouts) | ADOPTED | 60s/120s |
| P2-3 (enum status) | ADOPTED | But introduced P1-NEW-1 inconsistency |

| New Issue | Priority | Action |
|-----------|----------|--------|
| P1-NEW-1 | P1 | Update Section 4.3 checkpoint logic to use `status === "GREEN_CONFIRMED"` instead of removed boolean fields |
| P2-NEW-1 | P2 | Noted: multi-module command chaining is valid but worth a comment in implementation |

**Verdict: PASS** -- All original P0s are resolved. The single new P1 (schema inconsistency) is a documentation-level fix that does not require architectural changes and can be corrected during implementation planning (Phase 2). No blocking issues remain.
