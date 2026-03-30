# Implementation Plan: tribunal

## Overview

Implement the Tribunal (Independent Judge Agent) system for auto-dev Phases 4/5/6/7. The core change is separating execution authority from judgment authority: the main agent can only submit work products, and an independent Claude process decides whether they pass.

**Key design inputs**:
- Design doc: `docs/auto-dev/tribunal/design.md` (including revision section 十三)
- Design review: `docs/auto-dev/tribunal/design-review.md` (all P0/P1 resolved, 4 minor P2 notes)

**P2 implementation notes from design review to address during coding**:
- R2-1: Replace `return result!` with `throw new Error("unreachable")` in `runTribunalWithRetry`
- R2-2: Validate `--json-schema` support during AC-16 health check
- R2-3: Document submit counter reset (not blocking, tracked as TODO comment)
- R2-4: Use `command -v` instead of `which` for POSIX portability

---

## Task 1: Add TribunalVerdict type and SubmitInput schema to types.ts

- **Description**: Add the `TribunalVerdict` interface, `SubmitInputSchema` (Zod), and the `RetrospectiveAutoData` interface to `mcp/src/types.ts`. These are the foundational types that all other modules depend on.
- **Files**: `mcp/src/types.ts`
- **Dependencies**: None
- **Details**:
  - `TribunalVerdict`: `{ verdict: "PASS" | "FAIL"; issues: Array<{severity, description, file?, suggestion?}>; traces?: Array<{source, status, evidence?}>; passEvidence?: string[]; raw: string; }`
  - `SubmitInputSchema`: Zod object with `projectRoot: string, topic: string, phase: number, summary: string`
  - `RetrospectiveAutoData`: `{ rejectionCount: number; phaseTimings: Record<string, {startedAt, completedAt?, durationMs?}>; tribunalResults: Array<{phase, verdict, issueCount}>; submitRetries: Record<string, number>; }`
- **Completion Criteria**: `types.ts` compiles without errors; new types are importable from other modules

---

## Task 2: Create tribunal-schema.ts (JSON Schema + maxTurns config)

- **Description**: Create `mcp/src/tribunal-schema.ts` containing the `TRIBUNAL_SCHEMA` JSON Schema object that forces the tribunal agent's structured output format, and the `TRIBUNAL_MAX_TURNS` per-phase configuration.
- **Files**: `mcp/src/tribunal-schema.ts` (new)
- **Dependencies**: None
- **Details**:
  - `TRIBUNAL_SCHEMA`: JSON Schema object with properties `verdict` (enum PASS/FAIL), `issues` (array), `traces` (array), `passEvidence` (array). Required: `["verdict", "issues"]`
  - `TRIBUNAL_MAX_TURNS`: `Record<number, number>` = `{ 4: 10, 5: 8, 6: 6, 7: 6 }` (from design revision 3)
  - Export both as named exports
- **Completion Criteria**: File compiles; schema is a valid JSON Schema object; maxTurns covers phases 4-7

---

## Task 3: Create tribunal-checklists.ts (Phase 4/5/6/7 checklists)

- **Description**: Create `mcp/src/tribunal-checklists.ts` with the `getTribunalChecklist(phase: number): string` function that returns the markdown checklist text for each phase. These checklists are written into the tribunal-input file for the tribunal agent to follow.
- **Files**: `mcp/src/tribunal-checklists.ts` (new)
- **Dependencies**: None
- **Details**:
  - Phase 4 checklist: backward traceability (P0/P1 from design-review), independent code review, security, API consistency
  - Phase 5 checklist: test authenticity (cross-reference framework log vs agent claims), SKIP audit (burden of proof on agent), coverage, test quality
  - Phase 6 checklist: extract each AC from design.md, find implementation evidence in diff, validate SKIP reasons
  - Phase 7 checklist: data consistency (agent numbers vs framework data), omission check, root cause depth, actionable lessons
  - Each returns a multi-line markdown string
- **Completion Criteria**: `getTribunalChecklist(4)` through `getTribunalChecklist(7)` each return non-empty checklist strings

---

## Task 4: Create retrospective-data.ts (Phase 7 auto data generation)

- **Description**: Create `mcp/src/retrospective-data.ts` with functions to auto-generate tamper-proof retrospective data from progress-log and tribunal results. This data is framework-generated (main agent cannot modify it).
- **Files**: `mcp/src/retrospective-data.ts` (new)
- **Dependencies**: Task 1 (RetrospectiveAutoData type)
- **Details**:
  - `generateRetrospectiveData(progressLog: string, outputDir: string): Promise<RetrospectiveAutoData>` -- main entry
  - Internal helpers: `extractRejectionCount(log)`, `extractPhaseTimings(log)`, `extractTribunalResults(outputDir)`, `extractSubmitRetries(log)`
  - `writeRetrospectiveDataFile(outputDir: string, data: RetrospectiveAutoData): Promise<void>` -- writes `retrospective-data.md` as a formatted markdown file with tables
  - Parse CHECKPOINT comments from progress-log to get timestamps and statuses
  - Read `tribunal-phase{N}.md` files to get verdict summaries
- **Completion Criteria**: Given a sample progress-log string, `generateRetrospectiveData` returns a populated `RetrospectiveAutoData` object; the markdown file is correctly formatted

---

## Task 5: Extract internalCheckpoint to state-manager.ts

- **Description**: Extract the checkpoint-writing logic from the `auto_dev_checkpoint` handler in `index.ts` into a shared `internalCheckpoint()` function in `state-manager.ts`. Both the MCP tool handler and the tribunal will use this function. This ensures all guards (idempotency, predecessor validation, progress-log write, state.json update, phaseTimings) are applied uniformly.
- **Files**: `mcp/src/state-manager.ts`, `mcp/src/index.ts`
- **Dependencies**: None
- **Details**:
  - New export in `state-manager.ts`: `async function internalCheckpoint(sm: StateManager, state: StateJson, phase: number, status: string, summary?: string, task?: number, tokenEstimate?: number): Promise<{ok: boolean; nextDirective: NextDirective; stateUpdates: Record<string, unknown>}>`
  - The function performs: idempotency check, predecessor validation, progress-log append, state.json atomic update, phaseTimings computation
  - Refactor `index.ts` checkpoint handler's COMMIT PHASE section (lines ~598-686) to call `internalCheckpoint` instead of inline logic
  - The existing pre-validation checks (Phase 1/2 review artifacts, Phase 5/6/7 artifacts, TDD) stay in `index.ts` as they are tool-handler-specific guards
  - The COMMIT PHASE section (state updates, progress-log write, state.json write, next directive) moves to `internalCheckpoint`
- **Completion Criteria**: Existing checkpoint behavior is unchanged (regression-safe); `internalCheckpoint` is importable and usable from tribunal.ts; `index.ts` checkpoint handler delegates persistence to `internalCheckpoint`

---

## Task 6: Create tribunal.ts (core tribunal logic)

- **Description**: Create `mcp/src/tribunal.ts` with the full tribunal orchestration: CLI path resolution, input preparation, tribunal invocation, retry, cross-validation, and execution. This is the largest new file.
- **Files**: `mcp/src/tribunal.ts` (new), `mcp/src/phase-enforcer.ts` (modify — simplify existing validation functions to quick pre-checks per design revision 10)
- **Dependencies**: Task 1 (types), Task 2 (schema), Task 3 (checklists), Task 4 (retrospective-data), Task 5 (internalCheckpoint)
- **Details**:
  - `resolveClaudePath(): Promise<string>` -- 4-tier fallback: env `TRIBUNAL_CLAUDE_PATH` -> `command -v claude` (R2-4 fix) -> hardcoded candidates -> npx fallback with `shell: true`
  - `getClaudePath(): Promise<string>` -- cached wrapper
  - `prepareTribunalInput(phase, outputDir, projectRoot): Promise<string>` -- writes `tribunal-input-phase{N}.md` with file references and checklist; writes `tribunal-diff-phase{N}.patch` with git diff; for Phase 5: executes testCmd via `sh` (not `bash`, matching existing code), writes `framework-test-log.txt` and `framework-test-exitcode.txt`
  - `runTribunal(inputFile, phase): Promise<TribunalVerdict>` -- spawns `claude` process with args: `-p`, `--output-format json`, `--json-schema`, `--allowedTools "Read"`, `--model sonnet`, `--max-turns` (from TRIBUNAL_MAX_TURNS), `--bare`, `--no-session-persistence`; handles shell vs binary mode based on resolved path; parses `structured_output` from JSON response; post-parse validation: PASS without passEvidence -> override to FAIL (revision 4)
  - `runTribunalWithRetry(inputFile, phase): Promise<TribunalVerdict>` -- 1 retry for crash (not legitimate FAIL); crash detection via known error description strings; 3s backoff; on exhaustion returns CRASH_FAIL message; uses `throw new Error("unreachable")` instead of `return result!` (R2-1 fix)
  - `crossValidate(phase, outputDir, projectRoot): Promise<string | null>` -- Phase 5: check `framework-test-exitcode.txt` (exit code, not regex -- revision 6); check impl files vs test files ratio
  - `executeTribunal(projectRoot, outputDir, phase, topic, summary, sm, state): Promise<ToolResult>` -- full orchestration: quick pre-checks (reuse existing validatePhase5/6/7Artifacts as pre-filters), prepare input, run tribunal with retry, write tribunal log, cross-validate on PASS, call `internalCheckpoint` on PASS, compute nextDirective, return TRIBUNAL_PASS/TRIBUNAL_FAIL/TRIBUNAL_OVERRIDDEN with full return schema (revision 11)
- **Completion Criteria**: All functions compile; `executeTribunal` returns correct shape for PASS, FAIL, and OVERRIDDEN cases

---

## Task 7: Integrate tribunal into index.ts (submit handler + checkpoint block)

- **Description**: Add the `auto_dev_submit` MCP tool handler to `index.ts` and add the Phase 4/5/6/7 PASS block to the existing `auto_dev_checkpoint` handler. Also add submit counter tracking.
- **Files**: `mcp/src/index.ts`
- **Dependencies**: Task 5 (internalCheckpoint), Task 6 (tribunal.ts)
- **Details**:
  - **Checkpoint PASS block**: At the top of the checkpoint handler (after status validation, before any Phase-specific checks), add:
    ```
    const TRIBUNAL_PHASES = [4, 5, 6, 7];
    if (TRIBUNAL_PHASES.includes(phase) && status === "PASS") {
      return textResult({ error: "TRIBUNAL_REQUIRED", message: ..., mandate: ... });
    }
    ```
    Place this after the existing `COMPLETED` status guard (line ~316) and before Phase 1 review validation (line ~388).
  - **New `auto_dev_submit` tool**: Register with schema from `SubmitInputSchema`. Handler logic:
    1. Load state via StateManager
    2. Validate phase is in [4, 5, 6, 7]
    3. Check submit counter (`tribunalSubmits_phase${phase}` in state.json); if >= 3 return `TRIBUNAL_ESCALATE` (revision 8)
    4. Increment counter via `sm.atomicUpdate`
    5. Call `executeTribunal` from `tribunal.ts`
    6. Return result
  - **Modify `auto_dev_complete`**: Remove Phase 7 auto-trigger (if any). `complete` should only validate all phases are PASS, not trigger Phase 7 (revision 9). Check current code -- from reading, `auto_dev_complete` calls `runRetrospective`. This call should be removed or made conditional (only if Phase 7 already PASS).
  - **Import**: Add imports for `executeTribunal` from `./tribunal.js`
- **Completion Criteria**: `checkpoint(phase=5, status=PASS)` returns `TRIBUNAL_REQUIRED`; `auto_dev_submit(phase=5, summary="...")` triggers tribunal flow; `auto_dev_complete` does not auto-trigger Phase 7

---

## Task 8: Add health check for claude CLI in auto_dev_init (AC-16)

- **Description**: During `auto_dev_init`, verify that the `claude` CLI is reachable. If not, return a warning (not a hard block -- the user may not use tribunal phases). Also validate `--json-schema` support if possible (R2-2).
- **Files**: `mcp/src/index.ts` (init handler), `mcp/src/tribunal.ts` (resolveClaudePath is already there)
- **Dependencies**: Task 6 (tribunal.ts must exist for `getClaudePath`)
- **Details**:
  - After stack detection in `auto_dev_init`, call `getClaudePath()` in a try-catch
  - If resolution succeeds, add to init output: `tribunalReady: true, claudePath: resolved`
  - If resolution fails, add: `tribunalReady: false, tribunalWarning: "claude CLI not found. Tribunal-based phases (4/5/6/7) will not work. Set TRIBUNAL_CLAUDE_PATH env or install claude globally."`
  - Optionally: try running `claude --version` to verify version, log but don't block
- **Completion Criteria**: `auto_dev_init` output includes `tribunalReady` field; missing claude CLI produces a warning, not an error

---

## Task 9: Update SKILL.md driving loop

- **Description**: Update `skills/auto-dev/SKILL.md` to document the new `auto_dev_submit` tool and the changed driving loop for Phases 4/5/6/7.
- **Files**: `skills/auto-dev/SKILL.md`, `skills/auto-dev/prompts/phase7-retrospective.md` (update for new Phase 7 flow — main agent submits rather than drives)
- **Dependencies**: Task 7 (submit handler exists)
- **Details**:
  - Update the driving loop section (currently around line 30-41) to branch:
    - Phase 1/2/3: use `checkpoint(phase, status, tokenEstimate=tokens)` as before
    - Phase 4/5/6/7: use `auto_dev_submit(phase, summary)` which triggers tribunal internally
  - Update rule 1 (currently mentions Phase 7 triggered by auto_dev_complete) to clarify Phase 7 is submitted via `auto_dev_submit`
  - Add a note about TRIBUNAL_FAIL handling: main agent receives issue list, fixes, and re-submits
  - Add a note about TRIBUNAL_ESCALATE: after 3 failed submits, human intervention required
  - Update the `auto_dev_complete` description to remove mention of Phase 7 auto-trigger
- **Completion Criteria**: SKILL.md accurately describes the new flow; main agent reading SKILL.md knows to use `auto_dev_submit` for phases 4-7

---

## Task 10: Build verification

- **Description**: Run the TypeScript build to verify all new and modified files compile without errors. Fix any type mismatches, missing imports, or compilation issues.
- **Files**: All modified files
- **Dependencies**: Tasks 1-9
- **Details**:
  - Run `cd mcp && npm run build` (or `npx tsc --noEmit`)
  - Fix any compilation errors
  - Verify no circular imports between `tribunal.ts` <-> `state-manager.ts` <-> `index.ts`
  - Check that existing `__tests__` directory tests still pass (if any): `npm test`
- **Completion Criteria**: `tsc --noEmit` exits with code 0; no regression in existing tests

---

## Dependency Graph

```
Task 1 (types) ─────────┐
Task 2 (schema) ─────────┼─── Task 6 (tribunal.ts) ──── Task 7 (index.ts integration) ──── Task 10 (build)
Task 3 (checklists) ─────┤                                        │
Task 4 (retro-data) ─────┤                              Task 8 (health check) ────────────── Task 10
Task 5 (internalCkpt) ───┘                              Task 9 (SKILL.md) ────────────────── Task 10
```

Parallelizable: Tasks 1, 2, 3 can run in parallel. Task 4 depends on Task 1. Task 5 is independent. Tasks 8, 9 can run in parallel after Task 7.

## Estimated Total Time

| Task | Estimate |
|------|----------|
| Task 1 | 3 min |
| Task 2 | 3 min |
| Task 3 | 5 min |
| Task 4 | 8 min |
| Task 5 | 10 min |
| Task 6 | 10 min |
| Task 7 | 10 min |
| Task 8 | 5 min |
| Task 9 | 5 min |
| Task 10 | 5 min |
| **Total** | **~64 min** |
