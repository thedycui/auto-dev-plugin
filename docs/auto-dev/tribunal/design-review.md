# Design Review: Tribunal (Independent Judge Agent)

**Reviewer**: Architecture Review Expert (Phase 1)
**Date**: 2026-03-26
**Design Doc**: `docs/auto-dev/tribunal/design.md`

---

## 1. Technical Feasibility

### 1.1 `claude` CLI Invocation from MCP Server Process

**P0: `claude` is not a binary in PATH -- it is a shell alias via nvm**

On this machine, `claude` is defined as:
```
claude: aliased to nvm exec 20 npx @anthropic-ai/claude-code
```

`execFile("claude", [...args])` will fail because:
1. `execFile` does not expand shell aliases (only `exec` with `shell: true` does).
2. Even with `shell: true`, nvm aliases require a full interactive shell profile to resolve.
3. `npx @anthropic-ai/claude-code` involves a package resolution step that can take seconds and may prompt for confirmation (`--yes` needed).

The design assumes `claude` is a first-class binary in PATH. This is not true for many installations (Homebrew global install is rare; nvm+npx alias is common).

**Fix suggestion**:
- Resolve the actual binary path at startup (e.g. `which claude || npx which @anthropic-ai/claude-code`).
- Allow a `TRIBUNAL_CLAUDE_PATH` environment variable override.
- Fall back to `npx --yes @anthropic-ai/claude-code` with `shell: true` if no binary found.
- Add a startup health check in `auto_dev_init` that verifies the claude binary is reachable and logs a warning if not.

### 1.2 `--json-schema` and `structured_output` Field

**P1: `--json-schema` flag and `structured_output` response field need verification**

The design states:
- `--output-format json --json-schema '...'` forces structured output
- The response contains a `structured_output` field

These are relatively new Claude CLI features. The design does not cite a documentation source or version requirement. If the CLI version does not support `--json-schema`, the entire tribunal output parsing will fail, and since parse failure defaults to FAIL, every tribunal invocation will FAIL unconditionally.

**Fix suggestion**:
- Pin the minimum Claude CLI version in design (e.g., `>= 1.0.17`).
- Add a version check at startup: `claude --version` >= minimum.
- Document the exact response JSON structure with a real example from testing.
- Add a fallback: if `--json-schema` is not supported, fall back to text parsing with `VERDICT: PASS/FAIL` regex (the original approach mentioned in the "limitations" table but discarded).

### 1.3 `--allowedTools "Read"` Syntax

**P2: Verify exact syntax for tool restriction**

The design uses `--allowedTools "Read"`. The actual flag may be `--allowed-tools` (kebab-case) or require a different value format. Minor but causes silent failure if wrong.

**Fix suggestion**: Test with actual CLI and document exact invocation.

### 1.4 `--bare` and `--no-session-persistence`

**P2: These flags are reasonable but undocumented in the design**

The design lists them but does not verify they exist in the installed CLI version. Same risk as 1.2 but lower severity since they are optional optimizations.

---

## 2. Design Completeness

### 2.1 Edge Cases

**P0: No retry/backoff for tribunal process failure**

The design says "tribunal process failure -> treat as FAIL" (section 6.4). However, transient failures (network timeout to Anthropic API, temporary rate limit, npx download stall) will cause false FAILs. The main agent will then need to fix nonexistent issues and re-submit, wasting significant tokens.

Current behavior: `timeout: 120_000` + failure = FAIL. No retry.

**Fix suggestion**:
- Add 1 automatic retry with exponential backoff for transient errors (process exit code != 0 AND no stdout).
- Distinguish between "tribunal ran and returned FAIL" (legitimate) vs "tribunal process crashed" (transient). Only retry the latter.
- For crash-FAIL, include the error message prominently so the main agent knows not to fix code but to re-submit.

**P1: `--max-turns 3` may be insufficient for large diffs**

Phase 4/5 tribunal needs to read: design.md + plan.md + design-review.md + plan-review.md + code-review.md + tribunal-input file + diff patch file. That is 7+ files. With `--max-turns 3`, the tribunal agent gets at most 3 Read tool calls. It physically cannot read all required files.

**Fix suggestion**: Set `--max-turns` to at least 8 for Phase 4, or batch multiple files into a single tribunal-input file that the agent reads once, with only the diff in a separate file.

### 2.2 Cross-Validation Logic

**P1: Cross-validation regex for test log is fragile**

```typescript
if (/BUILD FAILURE|FAIL|ERROR.*Test/i.test(testLog) && !/BUILD SUCCESS/i.test(testLog)) {
```

This regex has false positives: a test log containing "ErrorHandler test passed" would match `ERROR.*Test`. A Maven build that has warnings with "FAIL" in class names would trigger. The `/BUILD SUCCESS/i` negative check helps but is Maven-specific (Gradle says "BUILD SUCCESSFUL", npm says nothing).

**Fix suggestion**:
- Use process exit code from the framework test execution instead of log parsing. Exit code 0 = pass, non-zero = fail. This is universal across all build tools.
- The framework already captures exit code in `prepareTribunalInput` (line 211: `(err, stdout, stderr) => resolve(...)`). Use `err` (which is non-null for non-zero exit) as the source of truth.

### 2.3 Missing Edge Cases

**P1: No handling for tribunal agent that returns PASS with zero `passEvidence`**

The schema makes `passEvidence` optional (`required: ["verdict", "issues"]`). A tribunal agent could return `{ verdict: "PASS", issues: [], passEvidence: [] }` or omit `passEvidence` entirely, defeating the "PASS requires evidence" design goal.

**Fix suggestion**: Add post-parse validation: if `verdict === "PASS"` and `(!passEvidence || passEvidence.length === 0)`, override to FAIL with message "PASS without evidence is not accepted".

**P2: No handling for very large diffs**

If the git diff is 500KB+, writing it to a file is fine, but the tribunal agent (with `--max-turns 3`) may not be able to read it all. The design does not address diff truncation or summarization.

---

## 3. Cross-Component Impact

### 3.1 Checkpoint Handler Modification

**P0: Design says Phase 4/5/6/7 PASS blocked, but current code already has Phase 5/6/7 artifact validation that writes checkpoint on success**

Current `index.ts` checkpoint handler (lines 423-530) already validates Phase 5 artifacts, runs testCmd, validates Phase 6 report, and validates Phase 7 retrospective -- all as part of `auto_dev_checkpoint(status=PASS)`. If we now block `checkpoint(phase=4/5/6/7, status=PASS)`, these existing validations become dead code (they only trigger when `status === "PASS"`).

The design must explicitly state:
1. Which existing validations move into the tribunal flow (e.g., testCmd execution moves to `prepareTribunalInput`).
2. Which existing validations are removed vs kept as "quick pre-check before tribunal".
3. How the tribunal's `crossValidate` relates to the existing `validatePhase5Artifacts`, `validatePhase6Artifacts`, `validatePhase7Artifacts`.

Section 9 partially addresses this for Phase 5 but not for Phase 6/7.

**Fix suggestion**: Add a complete mapping table showing each existing validation function and its fate (kept/moved/removed/replaced).

### 3.2 SKILL.md Update Required

**P1: SKILL.md must be updated to teach the main agent about `auto_dev_submit`**

Current SKILL.md (line 16) describes the driving loop as:
```
checkpoint_result = checkpoint(phase, status, tokenEstimate=tokens)
```

After this change, the loop for Phase 4/5/6/7 becomes:
```
submit_result = auto_dev_submit(phase, summary)
```

The main agent will not know to call `auto_dev_submit` unless SKILL.md is updated. The design's file change list (section 8) does not include SKILL.md.

**Fix suggestion**: Add SKILL.md to the file change list. Document the new driving loop:
```
if phase in [4,5,6,7]:
    submit_result = auto_dev_submit(phase, summary)  # triggers tribunal
else:
    checkpoint_result = checkpoint(phase, PASS, tokenEstimate=tokens)
```

### 3.3 `auto_dev_complete` Interaction

**P1: `auto_dev_complete` calls `runRetrospective` which may conflict with Phase 7 tribunal**

Looking at `index.ts`, `auto_dev_complete` likely triggers Phase 7 retrospective. If Phase 7 now requires tribunal, the `complete` flow needs to either:
- Not auto-trigger Phase 7 (let main agent do submit), or
- Internally call the tribunal for Phase 7 as part of `complete`.

The design does not clarify this interaction.

**Fix suggestion**: Explicitly document how `auto_dev_complete` interacts with the Phase 7 tribunal requirement.

### 3.4 Predecessor Validation Still Works

**P2: Confirmed no breakage.** `validatePredecessor` checks progress-log for `CHECKPOINT phase=N status=PASS`. Since tribunal writes `writeCheckpoint(outputDir, phase, "PASS", ...)` on success, the predecessor chain remains intact.

---

## 4. Risks

### 4.1 `claude` CLI Not in PATH

**Covered by P0 in section 1.1.** Additionally:

**P1: MCP server runs in a restricted environment (stdio transport)**

The MCP server communicates via stdin/stdout with the host Claude process. Spawning a child `claude` process that also needs API access means:
- The child process needs its own Anthropic API key / OAuth session.
- The child process may inherit stdin/stdout and interfere with MCP transport.

**Fix suggestion**:
- Use `stdio: 'pipe'` (not `inherit`) for the child process to avoid stdin/stdout collision. The `execFile` call in the design already does this implicitly (callback mode captures stdout), so this is likely OK but should be explicitly documented.
- Verify that the child `claude` process can authenticate independently (it should use the same `~/.claude` session).

### 4.2 Tribunal Agent Reliability

**P1: Tribunal agent may be systematically biased toward FAIL**

The design deliberately biases toward FAIL ("default stance is FAIL", "PASS requires more evidence than FAIL"). Combined with a Sonnet model (less capable than Opus at nuanced judgment), the tribunal may produce excessive false FAILs, causing:
- Main agent wastes tokens on unnecessary fix iterations.
- 3-submit limit hit frequently, requiring human intervention for legitimate PASS cases.

**Fix suggestion**:
- Track tribunal FAIL-to-PASS ratio over time. If >80% of first-submit results are FAIL but second-submit (same code) results in PASS, the tribunal is too aggressive.
- Consider starting with `--model opus` for Phase 4 (code review requires deep reasoning) and `--model sonnet` only for Phase 5/6/7.
- Add a "confidence" field to the schema. If verdict=FAIL but confidence < 0.5, log a warning for human review instead of hard blocking.

### 4.3 Token Cost Estimation

**P2: Cost estimates seem reasonable but conservative.**

The design estimates 5k-10k tokens per tribunal call (section 3 table). With `--max-turns 3` and reading multiple files (design.md + plan.md + diff can be 20k+ tokens input), actual input token cost will be higher. A more realistic estimate: 20k-40k input + 2k-5k output per call = ~25k-45k total per call. For 4 calls, that's ~100k-180k tokens, not ~40k.

This does not block the design but should be corrected for accurate cost expectations.

---

## 5. Dormant Path Detection (Rule 2)

**P1: `prepareTribunalInput` code path for Phase 5 executes `testCmd` via `bash -c` -- this is a NEW execution path**

The framework already executes `testCmd` in the checkpoint handler (lines 466-494 of `index.ts`). The design adds a SECOND execution in `prepareTribunalInput` (design line 211). These are different code paths:
- Existing: `execFile("sh", ["-c", testCmd], ...)` in checkpoint handler
- New: `execFileSync("bash", ["-c", initData.testCmd], ...)` in tribunal preparation

Risk: `sh` vs `bash` may behave differently. The new path reads `testCmd` from `parseInitMarker` while the existing path reads from `state.stack.testCmd`. If these differ (e.g., after a state.json tampering attempt that the INIT marker catches), the test results may conflict.

**Fix suggestion**: Use a single shared function for test execution. Always read testCmd from the INIT marker (tamper-proof source). Use the same shell (`sh` or `bash`, pick one).

**P1: `writeCheckpoint` function referenced in `executeTribunal` does not exist in current codebase**

The design calls `writeCheckpoint(outputDir, phase, "PASS", ...)` but this function is not defined in the current `index.ts` or `phase-enforcer.ts`. The existing checkpoint flow goes through the MCP tool handler. Writing directly to progress-log from a utility function bypasses all the guards (idempotency check, predecessor validation, etc.).

**Fix suggestion**: Either:
1. Reuse the existing checkpoint tool handler internally (call it programmatically), or
2. Extract the checkpoint-writing logic into a shared internal function that includes all guards, and have both the tool handler and tribunal call it.

---

## 6. Caller-Side Review (Rule 1)

**P1: `auto_dev_submit` return value consumed by main agent -- format not specified**

The design shows `executeTribunal` returning `textResult({status: "TRIBUNAL_PASS", ...})` or `textResult({status: "TRIBUNAL_FAIL", issues: [...], ...})`. But SKILL.md's driving loop needs to know:
- On TRIBUNAL_PASS: what is `nextPhase`? The current checkpoint returns `nextDirective.mandate`. Does submit also return this?
- On TRIBUNAL_FAIL: should the main agent re-run the phase work and re-submit, or just fix specific issues?

The main agent (consumer) has no guidance on how to handle the return value.

**Fix suggestion**: Document the exact return schema for `auto_dev_submit` in both PASS and FAIL cases, including `mandate` field for driving the main agent to the next phase.

---

## 7. Acceptance Criteria Review

| AC | Testable? | Notes |
|----|-----------|-------|
| AC-1 | Yes | Direct unit test on checkpoint handler |
| AC-2 | Yes | Mock `execFile`, verify it was called with correct args |
| AC-3 | Partially | Session isolation is inherent to `claude -p` but hard to prove in automated test |
| AC-4 | Yes | Mock tribunal FAIL response, check return |
| AC-5 | Yes | Mock tribunal PASS, check progress-log |
| AC-6 | Yes | Check file write |
| AC-7 | Yes | Set timeout to 1ms, verify FAIL return |
| AC-8 | Yes | Call checkpoint(phase=1, PASS), verify it still works |
| AC-9 | Yes | Need submit counter logic (not fully designed -- see below) |
| AC-10 | Yes | Check prepareTribunalInput output |
| AC-11 | Yes | Requires tribunal mock that checks trace results |
| AC-12 | Partially | "Main agent cannot modify" is an assertion about file permissions, hard to test |
| AC-13 | Yes | Check generated file content |
| AC-14 | Yes | Requires tribunal mock with specific behavior |
| AC-15 | Yes | Requires tribunal mock with specific behavior |

**P1: AC-9 (submit retry limit) has no implementation in the design**

The design mentions "submit 超过 3 次仍 FAIL 时提示人工介入" in section 7.1 and AC-9, but there is no code showing how submit count is tracked or enforced. The `executeTribunal` function does not check or increment a counter.

**Fix suggestion**: Add submit count tracking to the design:
- Store `tribunalSubmitCount` in state.json per phase.
- Increment on each `auto_dev_submit` call.
- On count >= 3 and verdict still FAIL, return a special `TRIBUNAL_ESCALATE` status with human intervention instructions.

---

## Summary

| Severity | Count | Key Issues |
|----------|-------|------------|
| P0 | 2 | `claude` not in PATH (shell alias issue); No retry for transient tribunal failures |
| P1 | 9 | `--json-schema` unverified; `--max-turns 3` insufficient; cross-validation regex fragile; PASS without evidence not enforced; SKILL.md not in change list; `auto_dev_complete` vs Phase 7 conflict; `writeCheckpoint` not defined; submit return schema undefined; AC-9 not implemented |
| P2 | 4 | `--allowedTools` syntax; `--bare`/`--no-session-persistence` unverified; large diff handling; cost estimate too optimistic |

## Verdict: NEEDS_REVISION

The core architecture (three-way separation of powers: executor / tribunal / framework cross-validation) is sound and well-motivated. The "incentive inversion" approach (PASS costs more than FAIL) is clever.

However, the 2 P0 issues are blockers:
1. The `claude` CLI invocation mechanism will fail in common installation scenarios (nvm/npx alias).
2. Transient tribunal failures will cause cascading false FAILs with no recovery path.

The 9 P1 issues should be addressed before implementation, particularly: `--max-turns` being too low for the file count, SKILL.md missing from the change list, and the undefined `writeCheckpoint` function creating a bypass risk.

---

## Re-Review (Iteration 2)

**Reviewer**: Architecture Review Expert (Phase 1, Re-Review)
**Date**: 2026-03-26
**Scope**: Design revision section "十三、设计修订" addressing 2 P0 + 9 P1 from iteration 1.

### Issue-by-Issue Verification

#### P0-1: `claude` not in PATH (Revision 1) -- RESOLVED with minor note

`resolveClaudePath()` implements a 4-tier fallback: env override -> `which claude` -> hardcoded candidates -> `npx --yes` with `shell: true`. The `runTribunal` caller correctly switches between `execFile` (binary) and `exec` with `shell: true` (npx fallback). AC-16 adds a startup health check.

**Verdict**: Adequately addressed. The `which claude` step will find the binary if it exists in PATH; the npx fallback handles the nvm alias case. The env override provides an escape hatch.

**P2 (new, minor)**: The `which` command itself requires a shell on some platforms. Consider using `execPromise("command -v claude")` for POSIX portability, or just catch the error (already done). Not blocking.

#### P0-2: No retry for transient failures (Revision 2) -- RESOLVED

`runTribunalWithRetry()` distinguishes crash (process failure / JSON parse failure) from legitimate verdict by checking `issues[].description` for known crash markers. Crash triggers 1 retry with 3s backoff. After retry exhaustion, returns a descriptive CRASH_FAIL message telling the main agent the issue is infrastructure, not code.

**Verdict**: Adequately addressed. The crash detection via string matching on known error descriptions is acceptable since these strings are generated by our own code (not external). The retry count of 1 (total 2 attempts) is reasonable -- more retries would waste time on persistent failures.

**P2 (new, minor)**: Line 915 `return result!;` references `result` which is scoped inside the for-loop. This is a TypeScript scoping issue that will cause a compile error. Should be `throw new Error("unreachable")` instead. Not blocking for design doc, but must be fixed in implementation.

#### P1: `--json-schema` unverified (Revision: not explicitly addressed) -- PARTIALLY RESOLVED

The revision does not add a version check or pin a minimum CLI version. However, the retry mechanism (Revision 2) provides some resilience if `--json-schema` fails. The design still lacks a documented fallback for CLI versions that do not support `--json-schema`.

**Verdict**: Partially addressed. The retry helps, but if `--json-schema` is fundamentally unsupported in the installed CLI version, both attempts will fail identically. Recommend adding a comment in the design that the implementation should test `--json-schema` support during the AC-16 health check and log a clear error if unsupported. Downgraded from P1 to **P2** since the health check (AC-16) can catch this at startup.

#### P1: `--max-turns 3` too low (Revision 3) -- RESOLVED

New per-phase values: Phase 4=10, Phase 5=8, Phase 6=6, Phase 7=6. The design notes that most materials are pre-concatenated into a single `tribunal-input-phase{N}.md` file, so the agent primarily reads 2-3 files (input + diff + optional source files).

**Verdict**: Adequately addressed. Phase 4 at 10 turns is generous enough for reading input + diff + spot-checking source files. Phase 5-7 at 6-8 is reasonable given the smaller scope.

#### P1: PASS without evidence (Revision 4) -- RESOLVED

Post-parse validation checks `verdict === "PASS" && (!passEvidence || passEvidence.length === 0)` and overrides to FAIL with a clear message.

**Verdict**: Adequately addressed. Clean and straightforward.

#### P1: SKILL.md missing from file list (Revision 5) -- RESOLVED

SKILL.md is now in the updated file change list (line 1090). The driving loop is documented with clear branching: Phase 1/2/3 use checkpoint, Phase 4/5/6/7 use submit.

**Verdict**: Adequately addressed.

#### P1: `writeCheckpoint` not defined (Revision 7) -- RESOLVED

Replaced with `internalCheckpoint()` extracted into `state-manager.ts`, shared by both the MCP tool handler and tribunal. The function includes all guards: idempotency check, predecessor validation, progress-log write, state.json update, phaseTimings.

**Verdict**: Adequately addressed. This is the correct approach -- extracting shared logic rather than duplicating or bypassing.

#### P1: `auto_dev_complete` vs Phase 7 conflict (Revision 9) -- RESOLVED

`auto_dev_complete` no longer auto-triggers Phase 7. It only validates that all phases (including 7) are already PASS. Phase 7 is driven by the main agent via `auto_dev_submit`.

**Verdict**: Adequately addressed. Clean separation of concerns.

#### P1: AC-9 submit counter (Revision 8) -- RESOLVED with note

Submit counter stored in state.json via dynamic key `tribunalSubmits_phase${phase}`. On count >= 3, returns `TRIBUNAL_ESCALATE` with human intervention message.

**Verdict**: Adequately addressed.

**P2 (new, minor)**: The counter is never reset. If a human manually resolves the escalation and the agent needs to re-submit, the counter is still >= 3. Consider documenting a reset mechanism (e.g., `auto_dev_state_update` can reset the counter). Not blocking.

#### P1: Cross-validation regex (Revision 6) -- RESOLVED

Replaced log regex with process exit code check. `prepareTribunalInput` writes exit code to `framework-test-exitcode.txt`. `crossValidate` reads the exit code file and checks `!== 0`.

**Verdict**: Adequately addressed. Exit code is the universal, reliable approach.

#### P1: Submit return schema (Revision 11) -- RESOLVED

Both PASS and FAIL return schemas now include `nextPhase`, `mandate`, `remainingSubmits` (FAIL only), and `suggestions` (PASS only). This gives the main agent all the information it needs to proceed or fix.

**Verdict**: Adequately addressed.

### Existing validation mapping table (Revision 10)

The mapping table clearly documents the fate of each existing function. Quick pre-checks are retained (avoiding wasted tribunal tokens on obviously incomplete work), while deep validation moves to the tribunal. This is a sound layered approach.

**Verdict**: Adequately addressed.

### New Issues Introduced by Revisions

| ID | Severity | Issue | Location |
|----|----------|-------|----------|
| R2-1 | P2 | `return result!` on line 915 is unreachable but will cause compile error due to scoping -- use `throw new Error("unreachable")` | Revision 2 |
| R2-2 | P2 | `--json-schema` support should be validated during AC-16 health check, not just `claude` reachability | Revision 1 + original P1 |
| R2-3 | P2 | Submit counter has no reset mechanism after human escalation resolution | Revision 8 |
| R2-4 | P2 | `resolveClaudePath` could use `command -v` instead of `which` for better POSIX compatibility | Revision 1 |

No new P0 or P1 issues introduced.

### Summary

| Original Issue | Status | Notes |
|----------------|--------|-------|
| P0-1: `claude` not in PATH | RESOLVED | 4-tier fallback + env override |
| P0-2: No retry | RESOLVED | Crash vs verdict distinction + 1 retry |
| P1: `--json-schema` unverified | PARTIALLY RESOLVED (downgraded to P2) | Retry helps; recommend health check validation |
| P1: `--max-turns` too low | RESOLVED | Per-phase values 6-10 |
| P1: PASS without evidence | RESOLVED | Post-parse validation |
| P1: SKILL.md missing | RESOLVED | Added to file list |
| P1: `writeCheckpoint` undefined | RESOLVED | `internalCheckpoint` shared function |
| P1: `auto_dev_complete` conflict | RESOLVED | Complete no longer auto-triggers Phase 7 |
| P1: AC-9 submit counter | RESOLVED | State-based counter + escalation |
| P1: Cross-validation regex | RESOLVED | Exit code approach |
| P1: Submit return schema | RESOLVED | nextPhase + mandate + remainingSubmits |

| Severity | Count |
|----------|-------|
| New P0 | 0 |
| New P1 | 0 |
| New P2 | 4 (minor implementation notes) |
| Remaining from Iteration 1 | 0 P0, 0 P1, 4 P2 (unchanged) |

## Verdict: PASS

All 2 P0 and 9 P1 issues from iteration 1 have been adequately addressed. The 4 new P2 items are minor implementation details that do not require another design revision -- they should be tracked as implementation notes. The design is ready to proceed to Phase 2 (implementation planning).
