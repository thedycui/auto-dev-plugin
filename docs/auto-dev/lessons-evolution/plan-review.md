# Plan Review: lessons-evolution (经验优胜劣汰)

> Reviewer: Phase 2 Plan Review
> Date: 2026-03-25
> Design doc: `design.md` (v2, reviewed PASS)
> Plan doc: `plan.md` (7 tasks, P0-P6)
> Codebase baseline: `mcp/src/lessons-manager.ts`, `mcp/src/index.ts`, `mcp/src/types.ts`, `mcp/src/retrospective.ts`

---

## 1. AC Coverage Matrix

| AC | Description | Covered by Task | Verified |
|----|-------------|-----------------|----------|
| AC-1 | preflight records `injectedLessonIds` in state.json | Task 4a | OK |
| AC-2 | checkpoint detects pending feedback, returns `lessonFeedbackRequired: true` | Task 4b | OK |
| AC-3 | `auto_dev_lessons_feedback` tool updates score + feedbackHistory | Task 3b | OK |
| AC-4 | Correct score deltas (+3 / -1 / -5) | Task 2 (foundations) + Task 3a (application) | OK |
| AC-5 | Pool > 50 triggers eviction on new write | Task 5a | OK |
| AC-6 | Time decay applied on read, retired filtered out | Task 6 | OK |
| AC-7 | Backward compatibility -- missing fields get defaults | Task 1 | OK |
| AC-8 | Global-only lesson feedback correctly updates global file | Task 3a | OK |
| AC-9 | checkpoint hard-rejects PASS when feedback pending | Task 4b | OK |
| AC-10 | `promoteReusableLessons()` uses `addToGlobal()` | Task 5c | OK |

**Result: All 10 ACs are mapped to specific tasks. No gaps.**

---

## 2. Review Fix Coverage

| Fix ID | Description | Task | Status |
|--------|-------------|------|--------|
| P0-1 | Lazy retirement persistence in getGlobalLessons | Task 6 | OK |
| P0-2 | Dual-file search in feedback() | Task 3a | OK |
| P1-1 | checkpoint hard-rejects before state write | Task 4b | OK |
| P1-2 | MIN_DISPLACEMENT_MARGIN in addToGlobal | Task 5a | OK |
| P1-3 | Delete syncFeedbackToGlobal, feedback() writes both | Task 3a | OK |
| P1-4 | feedbackInstruction field, not mandate | Task 4b | OK |
| P1-5 | promoteReusableLessons routes through addToGlobal | Task 5c | OK |
| P2-1 | feedbackHistory capped at 20 | Task 3a | OK |
| P2-3 | Constants centralized | Task 1 | OK |
| P2-NEW-2 | Partial failure reporting from feedback() | Task 3a (return type) | OK |

**Result: All P0/P1 fixes mapped. P2 fixes addressed where plan chose to.**

---

## 3. Dependency Analysis

### 3.1 Dependency graph correctness

```
Task 1 (types + constants)      -- depends: none
Task 2 (scoring model)          -- depends: Task 1       OK
Task 3 (feedback method + tool) -- depends: Task 2       OK
Task 4 (preflight + checkpoint) -- depends: Task 3       OK
Task 5 (eviction + promote)     -- depends: Task 2       OK
Task 6 (getGlobalLessons)       -- depends: Task 2       OK
Task 7 (tests + SKILL.md)       -- depends: 3, 4, 5, 6  OK
```

Tasks 3, 5, 6 are all parallel after Task 2. This is correct -- they modify different methods in `lessons-manager.ts` and do not conflict:
- Task 3: adds new `feedback()` method + `readGlobalEntries()` extraction
- Task 5: rewrites `addToGlobal()` + `promoteReusableLessons()`
- Task 6: rewrites `getGlobalLessons()`

Task 4 correctly depends on Task 3 (the MCP tool calls `feedback()` which must exist first).

### 3.2 Ordering feasibility

The foundation-first principle is respected:
1. Types and constants (Task 1) before anything
2. Core scoring functions (Task 2) before consumers
3. All feature tasks (3/5/6) can run in parallel
4. Integration task (4) after its dependency (3)
5. Tests (7) last, after all implementation

**Result: Dependencies are correct and ordering is feasible.**

---

## 4. Findings

### P1 Issues (should fix before implementation)

**P1-1: Task 3a introduces `readGlobalEntries()` as new private method but does not specify extraction from existing code**

Task 3a says: "Note: `readGlobalEntries()` is a new private method -- extract from existing `getGlobalLessons()` boilerplate." However, Task 6 also rewrites `getGlobalLessons()` and would need to use this same extracted method. Since Tasks 3 and 6 are parallel (both depend only on Task 2), whoever implements second will face a merge conflict or duplication.

**Fix**: Add an explicit sub-step to Task 2 (the common ancestor) to extract `readGlobalEntries()` as a private method from the existing `getGlobalLessons()` boilerplate. Both Task 3 and Task 6 then import/use it without conflict.

Alternatively, make Task 6 depend on Task 3 (sequential instead of parallel), but this loses parallelism unnecessarily.

**P1-2: Task 5a changes `addToGlobal()` from `private` to public (implicit), but Task 5c relies on calling it from `promoteReusableLessons()` which is already in the same class**

The design shows `addToGlobal()` is currently `private`. Task 5a's new signature drops the `private` modifier: `async addToGlobal(entry: LessonEntry): Promise<...>`. The plan does not explicitly state whether this should become `public` or remain `private`. Since `promoteReusableLessons()` is in the same class, it can access `private` -- but the plan's code block omits the visibility modifier, which could lead to accidental public exposure.

**Fix**: Explicitly state in Task 5a: "Keep `addToGlobal()` as a private method (or internal). The `promoteReusableLessons()` caller is within the same class and has access."

### P2 Issues (suggestions, non-blocking)

**P2-1: Task 4a references line numbers that may drift**

Task 4a says "around line 716-724" for the preflight injection point. These line numbers match the current source, but Tasks 1-3 will have already modified `index.ts` (Task 3 adds the new MCP tool). By the time Task 4 runs, line numbers will have shifted.

**Suggestion**: Reference the code by semantic anchor ("after the `globalLessons` injection loop in `auto_dev_preflight`") rather than by line number. This is already partially done in the text but the line numbers create false precision.

**P2-2: Task 7 test for AC-9 (checkpoint rejection) is described narratively but not specified as a concrete test case**

The test groups in Task 7b cover `ensureDefaults`, `applyDecay`, `feedback()`, `addToGlobal()`, `getGlobalLessons()`, and `promoteReusableLessons()`. However, the checkpoint rejection behavior (AC-9) would require testing the checkpoint tool handler in `index.ts`, which is an MCP server handler -- not a unit-testable method. The plan says "AC-9 tested via checkpoint rejection scenario" but does not specify how (integration test? mock server?).

**Suggestion**: Either (a) extract the feedback-pending guard into a testable pure function (e.g., `checkLessonFeedbackPending(state): Error | null`) and unit test that, or (b) explicitly note that AC-9 is verified by manual/integration testing and not by the unit test suite.

**P2-3: No explicit mention of deleting `syncFeedbackToGlobal` (P1-3 fix)**

The design-review explicitly notes that `syncFeedbackToGlobal()` should be deleted (design Section 6 says "删除 `syncFeedbackToGlobal()`"). However, no task in the plan has a concrete step for this deletion. Checking the current source, `syncFeedbackToGlobal` does not exist yet (it was a design v1 concept that was replaced before implementation). So this is a documentation mismatch rather than a real gap -- but the plan's Fix ID table row for P1-3 could be clearer that there is nothing to delete.

**P2-4: Dormant path risk -- `writeAtomic` under concurrent feedback**

`feedback()` reads both files, modifies in-memory, then writes back. If two sessions provide feedback concurrently on overlapping entries, last-write-wins will lose one update. This is the same risk noted in design-review P2-NEW-3 / P2-5 and is acceptable for single-session usage. No plan action needed, but worth flagging for the test suite -- do not write tests that assume atomicity across processes.

---

## 5. Caller-Side Review (Rule 1)

Checked all consumers of the methods being modified:

| Method | Callers | Impact Assessment |
|--------|---------|-------------------|
| `addToGlobal()` | `add()` (line 47), `promoteReusableLessons()` (line 114) | Both callers addressed: `add()` in Task 5b, `promoteReusableLessons()` in Task 5c. OK. |
| `getGlobalLessons()` | `index.ts` preflight (line 716) | Task 4a modifies this call site to also extract IDs. OK. |
| `promoteReusableLessons()` | `retrospective.ts` (line 92) | Caller passes `state.topic`. Task 5c preserves the same signature `(topic: string): Promise<number>`. Return type unchanged. OK. |
| `add()` | `index.ts` `auto_dev_lessons_add` tool | Task 2 adds `score` to the constructed entry. Existing callers unaffected (score was not in the input params). OK. |

**No caller-side gaps found.**

---

## 6. Dormant Path Risk (Rule 2)

| Path | Status | Risk |
|------|--------|------|
| `addToGlobal()` displacement branch (pool full) | NEVER EXECUTED -- current `addToGlobal()` has no pool limit | P1 risk, covered by Task 7 test Group 4 |
| `getGlobalLessons()` retirement pass | NEVER EXECUTED -- new code | P1 risk, covered by Task 7 test Group 5 |
| `feedback()` method | NEVER EXECUTED -- entirely new | P1 risk, covered by Task 7 test Group 3 |
| `checkpoint` feedback guard | NEVER EXECUTED -- new guard | P1 risk, partially covered (see P2-2 above) |
| `writeAtomic()` | PRODUCTION VERIFIED -- used by all current write paths | Low risk |
| `readEntries()` | PRODUCTION VERIFIED | Low risk |

All first-activation paths are covered by test cases in Task 7, except the checkpoint guard (see P2-2).

---

## 7. Summary

| Grade | Count | Details |
|-------|-------|---------|
| P0 | 0 | -- |
| P1 | 2 | readGlobalEntries() extraction timing; addToGlobal() visibility |
| P2 | 4 | Line number drift; AC-9 test strategy; stale P1-3 delete reference; concurrent write note |

---

## Verdict: **NEEDS_REVISION**

The plan comprehensively covers all 10 ACs, all P0/P1 review fixes, and has a correct dependency graph. The two P1 findings are straightforward to fix:

1. **P1-1**: Move `readGlobalEntries()` extraction into Task 2 so that parallel Tasks 3 and 6 both have it available. This is a one-line change to the plan.
2. **P1-2**: Add explicit `private` modifier note to Task 5a for `addToGlobal()`.

After these two adjustments, the plan is ready for implementation (PASS).

---

> Generated by Phase 2 Plan Review
