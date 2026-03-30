# Phase 2 Plan Review: TDD Gate (RED-GREEN)

**Reviewer**: Plan Review Expert
**Date**: 2026-03-26
**Plan**: `plan.md`
**Design**: `design.md` (Section 十 revisions)
**Design Review**: `design-review.md` (PASS, 1 remaining P1-NEW-1)

---

## Check 1: All files from design revision 十 covered?

Design Section 十 updated file change list:

| Design File | Plan Task | Covered? |
|-------------|-----------|----------|
| `mcp/src/index.ts` -- new handlers + delete Iron Law + checkpoint replace | Task 4 (handlers) + Task 5 (delete Iron Law + new check) | YES |
| `mcp/src/tdd-gate.ts` -- new file | Task 2 | YES |
| `mcp/src/types.ts` -- tddTaskStates + RetrospectiveAutoData extension | Task 1 (both schema and interface) | YES |
| `mcp/src/phase-enforcer.ts` -- isTddExemptTask | Task 3 | YES |
| `mcp/src/tribunal-checklists.ts` -- Phase 4 TDD checklist | Task 6 | YES |
| `mcp/src/retrospective-data.ts` -- TDD gate stats | Task 7 | YES |
| `skills/auto-dev/SKILL.md` -- Phase 3 RED-GREEN flow | Task 8 | YES |
| `skills/auto-dev/prompts/phase3-developer.md` -- RED/GREEN prompts | Task 9 | YES |

**Verdict**: All 8 files from design are covered. No files missing.

---

## Check 2: Dependencies correct?

Plan dependency graph:
```
Task 1 -> Task 2, 3, 6, 7 (parallel)
Task 2 + 3 -> Task 4
Task 4 -> Task 5
Task 4 + 5 -> Task 8
Task 9 -> independent (no code deps)
All -> Task 10
```

Verified against source code:
- Task 2 (`tdd-gate.ts`) imports types from Task 1 (`types.ts`) -- correct dependency
- Task 3 (`phase-enforcer.ts`) reads plan.md, does not depend on types.ts schema changes -- **could run parallel with Task 1**, but the plan conservatively lists Task 1 as dependency. Acceptable but unnecessary.
- Task 4 (`index.ts` handlers) imports from `tdd-gate.ts` (Task 2) and `phase-enforcer.ts` (Task 3) -- correct
- Task 5 (delete Iron Law in `index.ts`) depends on Task 4 to avoid merge conflicts -- correct
- Task 6 (`tribunal-checklists.ts`) depends on Task 1 only for understanding the schema, no code import -- loose dependency, acceptable
- Task 7 (`retrospective-data.ts`) depends on Task 1 for `RetrospectiveAutoData` type -- correct
- Task 8 (SKILL.md) depends on Task 4/5 (needs to know tool names) -- correct
- Task 9 (prompts) listed as "no dependencies" -- correct, it is a prompt template
- Task 10 (build verify) depends on all -- correct

**Verdict**: Dependencies are correct. No missing or incorrect edges.

---

## Check 3: Each task 2-10 min?

| Task | Estimated | Assessment |
|------|-----------|------------|
| Task 1: types.ts schema | 5 min | OK -- small schema additions |
| Task 2: tdd-gate.ts core module | 10 min | Borderline -- 5 exports with 15 test cases. The TDD RED step (writing tests for all 15 cases) will take ~10 min alone, GREEN step another ~8 min. **Actual: ~18 min with TDD RED-GREEN flow.** |
| Task 3: isTddExemptTask | 5 min | OK -- single function, 5 tests |
| Task 4: index.ts handlers | 10 min | Borderline -- two handler registrations with exec logic, marked TDD:skip. Feasible at 10 min. |
| Task 5: delete Iron Law | 5 min | OK -- delete + insert, marked TDD:skip |
| Task 6: tribunal checklist | 3 min | OK -- small text addition, 2 tests |
| Task 7: retrospective stats | 5 min | OK -- one function + render update, 3 tests |
| Task 8: SKILL.md update | 5 min | OK -- documentation |
| Task 9: prompt update | 5 min | OK -- documentation |
| Task 10: build verify | 3 min | OK -- run commands |

**Verdict**: Task 2 is the only concern -- see P1-1 below.

---

## Check 4: All 12 ACs satisfiable?

| AC | Covered by Task | Satisfiable? |
|----|-----------------|--------------|
| AC-1: task_red returns RED_CONFIRMED for test-only changes | Task 4 handler + Task 2 validateRedPhase | YES |
| AC-2: task_red REJECTED for impl file changes | Task 2 validateRedPhase + Task 4 handler | YES |
| AC-3: task_red REJECTED when all tests pass | Task 4 handler (exitCode === 0 check) | YES |
| AC-4: task_green REJECTED when RED not done | Task 4 handler (status check) | YES |
| AC-5: task_green GREEN_CONFIRMED when tests pass | Task 4 handler | YES |
| AC-6: task_green REJECTED when tests fail | Task 4 handler | YES |
| AC-7: checkpoint requires RED+GREEN when tdd=true | Task 5 | YES |
| AC-8: TDD:skip exemption | Task 3 isTddExemptTask + Task 5 checkpoint logic | YES |
| AC-9: Java mvn test command generation | Task 2 buildTestCommand | YES |
| AC-10: TypeScript vitest command generation | Task 2 buildTestCommand | YES |
| AC-11: tdd=false skips gate | Task 4 handler (checks state.tdd) + Task 5 (checks state.tdd) | YES |
| AC-12: SKILL.md describes RED-GREEN | Task 8 | YES |

**Verdict**: All 12 ACs are satisfiable by the planned tasks.

---

## Check 5: Design review P0/P1 fixes incorporated?

| Review Issue | Status in Plan |
|-------------|----------------|
| P0-1: buildTestCommand multi-module Maven | Task 2 explicitly includes module derivation and multi-module test cases | INCORPORATED |
| P0-2: RED accepts compilation failure | Task 4 handler step (g): exitCode !== 0 accepted as RED | INCORPORATED |
| P1-1: tddTaskStates consumed downstream | Task 6 (tribunal) + Task 7 (retrospective) | INCORPORATED |
| P1-2: File classification dual-filter | Task 2 isTestFile/isImplFile with test resources | INCORPORATED |
| P1-3: Remove old TDD Iron Law | Task 5 explicitly deletes lines 556-619 | INCORPORATED |
| P1-NEW-1: Checkpoint uses enum not booleans | Task 5 implements `status === "GREEN_CONFIRMED"` check | INCORPORATED (plan Risk Mitigation table explicitly notes this) |

**Verdict**: All P0 and P1 fixes from both review iterations are incorporated.

---

## Issues Found

### P1-1: Task 2 is too large for a single TDD task

**Location**: Task 2

Task 2 has 5 exported functions and 15 test cases. Under TDD RED-GREEN flow, the developer agent must:
- RED step: write 15 test cases for 5 functions
- GREEN step: implement 5 functions to pass all 15 tests

This exceeds the 10-minute estimate significantly. More importantly, a single RED step covering 15 tests for 5 unrelated functions is not granular TDD -- it is "write all tests first, then all implementations", which is closer to design's rejected "Method B: Two-Pass".

**Fix**: Split Task 2 into two sub-tasks:
- Task 2a: `isTestFile`, `isImplFile`, `validateRedPhase`, `TDD_TIMEOUTS` (8 test cases, ~8 min)
- Task 2b: `buildTestCommand` (7 test cases, ~8 min)

Both can be in the same file. Task 2b depends on Task 2a only if `buildTestCommand` uses `isTestFile` internally -- it does not, so they are independent and can run in parallel.

Alternatively, if splitting is not desired, the task should acknowledge ~18 min estimated time and the TDD RED step should be scoped to test one function group at a time (file classification functions, then command generation).

### P1-2: Task 4 and Task 5 both modify `index.ts` but Task 4 is TDD:skip without sufficient justification

**Location**: Task 4 and Task 5

Task 4 registers two new MCP tool handlers with significant logic (exec child process, read/write state, build commands). It is marked `TDD: skip` with reason "integration-level wiring, handler logic delegates to tdd-gate.ts; tested via Task 6 integration tests".

However:
- Task 6 is `tribunal-checklists.ts`, NOT integration tests for Task 4. The plan text says "tested via Task 6 integration tests" but Task 6 adds a checklist string, not integration tests.
- The handlers contain non-trivial logic: state validation (phase=3, tdd=true), child_process exec with timeout, exit code interpretation, state mutation. These are not pure delegation.
- AC-1 through AC-6 are listed as "unit test" verification in the design, but the plan has no task writing unit tests for these ACs. Task 2 tests cover `validateRedPhase` and `buildTestCommand`, but not the handler orchestration (state check, exec, exit code branching, state write).

**Fix**: Either:
1. Add unit tests for the handler logic in Task 4 (mock execFile, mock state read/write, verify AC-1 through AC-6 at the handler level). Change `TDD: skip` to `TDD: required`.
2. Or add a dedicated Task 6.5 for integration tests that cover AC-1 through AC-6 end-to-end via the MCP tool interface. Update AC table to reference this task.

### P1-3: Task 5 `tddWarning` cleanup is incomplete

**Location**: Task 5 step 2

Task 5 says to delete the `tddWarning` variable and replace with `tddWarning: null` in the `internalCheckpoint` call. But `internalCheckpoint` in `state-manager.ts` (line 527) declares `tddWarning` as an optional parameter and at line 582-584 it writes to `state.tddWarnings` array.

After Task 5:
- `tddWarning` is always `null` passed to `internalCheckpoint`
- The `tddWarnings` state field and its write logic in `state-manager.ts` become dead code
- The `opts?.tddWarning` parameter in `internalCheckpoint` signature becomes unused

The plan does not mention cleaning up `state-manager.ts`. This leaves dead code that will confuse future readers.

**Fix**: Add to Task 5: "Remove the `tddWarning` handling from `internalCheckpoint` in `state-manager.ts` (lines 527, 537, 582-585). Alternatively, repurpose this mechanism for TDD gate warnings (e.g., exempt task advisory messages)." Update file list to include `mcp/src/state-manager.ts`.

### P2-1: Task 7 `extractTddGateStats` rejection counting is vague

**Location**: Task 7 description, step 1

The plan says: "Count RED/GREEN rejections from progress-log (search for `TDD_GATE` or `RED_CONFIRMED` rejection markers)". But the RED/GREEN rejection messages are returned by the handler as tool responses, not written to progress-log. Only `internalCheckpoint` writes to progress-log, and RED/GREEN rejections happen BEFORE checkpoint.

The plan should clarify how rejection counts are tracked. Options:
1. The RED/GREEN handlers write rejection events to progress-log (add this to Task 4)
2. Count rejections from state.json (requires Task 4 to record rejection count in tddTaskStates)
3. Accept that rejection counts may be approximate (search progress-log for "REJECTED" strings)

### P2-2: Task 6 renames "C. Output requirements" to "D." but existing tests may assert on section letters

**Location**: Task 6

The existing tribunal test at line 498 checks `getTribunalChecklist(4)` content. If tests assert on specific section letters or exact string matches, renaming "C." to "D." could break them. The plan should verify existing test assertions before renaming.

---

## Summary

| ID | Priority | Issue | Fix |
|----|----------|-------|-----|
| P1-1 | P1 | Task 2 too large for single TDD task (15 tests, 5 functions, ~18 min) | Split into Task 2a (file classification) and Task 2b (command generation), or adjust estimate |
| P1-2 | P1 | Task 4 marked TDD:skip but contains non-trivial untested logic; AC-1~AC-6 have no unit test task | Add handler-level unit tests or a dedicated integration test task |
| P1-3 | P1 | Task 5 leaves dead `tddWarning` code in state-manager.ts | Add state-manager.ts cleanup to Task 5 file list |
| P2-1 | P2 | Task 7 rejection counting mechanism unclear (rejections not in progress-log) | Clarify tracking source or add rejection logging to Task 4 |
| P2-2 | P2 | Task 6 section renaming may break existing tribunal tests | Verify existing test assertions before renaming |

**Verdict: NEEDS_REVISION** -- 3 P1 issues require plan adjustments before implementation. The most critical is P1-2: six acceptance criteria (AC-1 through AC-6) currently have no task responsible for writing their unit tests.
