# Plan Review: tribunal

**Reviewer**: Plan Review Expert (Phase 2)
**Date**: 2026-03-26
**Plan Doc**: `docs/auto-dev/tribunal/plan.md`
**Design Doc**: `docs/auto-dev/tribunal/design.md` (including section 十三 revisions)
**Design Review**: `docs/auto-dev/tribunal/design-review.md`

---

## 1. File Coverage (Design Section 十三 vs Plan)

Design section 十三 updated file list:

| File (Design) | Plan Task | Status |
|---|---|---|
| `mcp/src/types.ts` | Task 1 | Covered |
| `mcp/src/tribunal-schema.ts` (new) | Task 2 | Covered |
| `mcp/src/tribunal-checklists.ts` (new) | Task 3 | Covered |
| `mcp/src/retrospective-data.ts` (new) | Task 4 | Covered |
| `mcp/src/state-manager.ts` | Task 5 | Covered |
| `mcp/src/tribunal.ts` (new) | Task 6 | Covered |
| `mcp/src/index.ts` | Task 7, Task 8 | Covered |
| `skills/auto-dev/SKILL.md` | Task 9 | Covered |
| `mcp/src/phase-enforcer.ts` | **MISSING** | See P1-1 below |
| `skills/auto-dev/prompts/phase7-retrospective.md` | **MISSING** | See P1-2 below |

---

## 2. Issues

### P1-1: `phase-enforcer.ts` modification not covered by any task

Design section 十三, Revision 10 (line 1088) explicitly lists `mcp/src/phase-enforcer.ts` as "modify -- keep as quick pre-check". The mapping table (Revision 10, lines 1043-1052) states:

- `validatePhase5Artifacts()` -> retained as quick pre-check
- `validatePhase6Artifacts()` -> retained as quick pre-check
- `validatePhase7Artifacts()` -> retained as quick pre-check
- Phase 5 testCmd execution -> moved to tribunal
- Phase 5/6/7 checkpoint PASS logic -> moved to tribunal

Task 6 mentions "reuse existing validatePhase5/6/7Artifacts as pre-filters" in `executeTribunal`, but no task covers actually modifying `phase-enforcer.ts` to simplify these functions (removing the deep validation that moves to tribunal, keeping only the quick pre-check).

If `phase-enforcer.ts` is not modified, the existing functions may still perform heavyweight checks that are now redundant with the tribunal, or they may still write checkpoints directly, bypassing the tribunal.

**Fix suggestion**: Add explicit sub-steps to Task 6 or create a small Task 6b to:
1. Review `validatePhase5Artifacts`, `validatePhase6Artifacts`, `validatePhase7Artifacts` current implementations.
2. Simplify them to quick pre-checks only (file existence, basic sanity).
3. Remove any checkpoint-writing logic from these functions (that responsibility moves to `executeTribunal` via `internalCheckpoint`).

### P1-2: `skills/auto-dev/prompts/phase7-retrospective.md` not covered by any task

Design section 十三 (line 1091) lists `skills/auto-dev/prompts/phase7-retrospective.md` as "modify -- Phase 7 is no longer driven by the main Agent". No plan task addresses this file.

Since Phase 7 now requires `auto_dev_submit` instead of the main Agent directly writing and checkpointing, the Phase 7 prompt may need updates to reflect that the agent should call `auto_dev_submit` after writing the retrospective, rather than calling `checkpoint(phase=7, PASS)`.

**Fix suggestion**: Add this file to Task 9 (SKILL.md update) as a second file, or create a sub-task. The change is small (likely a few lines directing the agent to use `auto_dev_submit` instead of `checkpoint`).

### P2-1: Task 5 (internalCheckpoint) signature differs from design

Task 5 defines `internalCheckpoint` with signature:
```
(sm: StateManager, state: StateJson, phase: number, status: string, summary?: string, task?: number, tokenEstimate?: number)
```

Design Revision 7 (line 1001) defines:
```
(outputDir: string, phase: number, status: string, summary: string)
```

The plan's signature is more detailed and likely closer to what the actual implementation needs (passing `sm` and `state` explicitly rather than relying on closure). This is an acceptable deviation -- the plan improves on the design's sketch. No action needed, just noting for traceability.

### P2-2: Task 7 checkpoint PASS block placement could use more precision

Task 7 says "Place this after the existing COMPLETED status guard (line ~316) and before Phase 1 review validation (line ~388)." These line numbers are approximate and may drift. The task description is clear enough about the logical placement, but the implementer should verify actual line numbers at implementation time.

---

## 3. Dependency Validation

| Dependency | Correct? |
|---|---|
| Task 4 depends on Task 1 (RetrospectiveAutoData type) | Yes |
| Task 6 depends on Tasks 1, 2, 3, 4, 5 | Yes |
| Task 7 depends on Tasks 5, 6 | Yes |
| Task 8 depends on Task 6 (getClaudePath) | Yes |
| Task 9 depends on Task 7 | Yes (needs to know final tool shape) |
| Task 10 depends on Tasks 1-9 | Yes |
| Tasks 1, 2, 3 can run in parallel | Yes, no inter-dependencies |

Dependencies are correct. The dependency graph accurately reflects the data flow.

---

## 4. Task Duration Assessment

| Task | Estimate | Reasonable? |
|---|---|---|
| Task 1 (types) | 3 min | Yes, small additions to existing file |
| Task 2 (schema) | 3 min | Yes, static data |
| Task 3 (checklists) | 5 min | Yes, text-heavy but straightforward |
| Task 4 (retro-data) | 8 min | Yes, moderate parsing logic |
| Task 5 (internalCheckpoint) | 10 min | At the upper bound -- extracting and refactoring from index.ts requires care |
| Task 6 (tribunal.ts) | 10 min | **Underestimated** -- see P2-3 below |
| Task 7 (index.ts integration) | 10 min | At the upper bound -- three distinct changes to a large file |
| Task 8 (health check) | 5 min | Yes |
| Task 9 (SKILL.md) | 5 min | Yes |
| Task 10 (build) | 5 min | Yes, may need iteration |

**P2-3**: Task 6 at 10 minutes is ambitious. It is the largest new file with 6 functions including process spawning, file I/O, retry logic, cross-validation, and full orchestration. Realistic estimate is 12-15 minutes. Still within the 2-10 minute guidance if we consider it as "up to 15 min for the most complex task". Not blocking.

---

## 5. AC Coverage

| AC | Covered By | Status |
|----|-----------|--------|
| AC-1 (checkpoint PASS blocked for Phase 4/5/6/7) | Task 7 (TRIBUNAL_PHASES guard) | Covered |
| AC-2 (submit triggers tribunal) | Task 7 (auto_dev_submit handler) | Covered |
| AC-3 (session isolation) | Task 6 (--bare, --no-session-persistence, separate process) | Covered |
| AC-4 (FAIL returns issue list) | Task 6 (executeTribunal FAIL path) | Covered |
| AC-5 (PASS auto-writes checkpoint) | Task 6 (executeTribunal calls internalCheckpoint) | Covered |
| AC-6 (tribunal log written) | Task 6 (writes tribunal-phase{N}.md) | Covered |
| AC-7 (process failure = FAIL) | Task 6 (runTribunal error handling) | Covered |
| AC-8 (Phase 1/2/3 unaffected) | Task 7 (TRIBUNAL_PHASES only includes 4/5/6/7) | Covered |
| AC-9 (3-submit escalation) | Task 7 (submit counter logic) | Covered |
| AC-10 (Phase 4 includes design-review + plan-review) | Task 6 (prepareTribunalInput phase 4 branch) | Covered |
| AC-11 (P0 unfixed -> Phase 4 FAIL) | Task 3 (Phase 4 checklist includes backward traceability) | Covered |
| AC-12 (retrospective-data.md auto-generated) | Task 4 (retrospective-data.ts) | Covered |
| AC-13 (auto data includes 4 categories) | Task 4 (extractRejectionCount, extractPhaseTimings, etc.) | Covered |
| AC-14 (data inconsistency -> FAIL) | Task 3 (Phase 7 checklist: data consistency check) | Covered |
| AC-15 (omitted FAIL in retrospective -> FAIL) | Task 3 (Phase 7 checklist: omission check) | Covered |
| AC-16 (init health check for claude CLI) | Task 8 | Covered |

All 16 ACs are covered by the plan tasks.

---

## 6. Design Review P2 Items

| P2 Item | Addressed in Plan? |
|---|---|
| R2-1: `return result!` -> `throw new Error("unreachable")` | Yes, Task 6 explicitly mentions this |
| R2-2: Validate `--json-schema` during AC-16 health check | Yes, Task 8 mentions this |
| R2-3: Document submit counter reset | Yes, plan overview notes this as TODO comment |
| R2-4: `command -v` instead of `which` | Yes, Task 6 explicitly mentions this |

All 4 P2 items from the design review are tracked in the plan.

---

## Summary

| Severity | Count | Issues |
|----------|-------|--------|
| P0 | 0 | -- |
| P1 | 2 | `phase-enforcer.ts` not covered by any task; `phase7-retrospective.md` not covered by any task |
| P2 | 3 | internalCheckpoint signature deviation (acceptable); line number approximations; Task 6 duration slightly underestimated |

## Verdict: NEEDS_REVISION

The plan is well-structured with correct dependencies, good task granularity, and complete AC coverage. However, 2 files from the design's updated file change list (section 十三) have no corresponding plan task:

1. **P1-1**: `mcp/src/phase-enforcer.ts` -- needs a task or sub-task to simplify existing validation functions to quick pre-checks only.
2. **P1-2**: `skills/auto-dev/prompts/phase7-retrospective.md` -- needs to be updated to reflect the new `auto_dev_submit` flow for Phase 7.

Both are small changes that can be folded into existing tasks (P1-1 into Task 6, P1-2 into Task 9), but they must be explicitly listed so the implementer does not miss them.
