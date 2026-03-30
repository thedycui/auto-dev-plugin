# Code Review: tribunal Implementation

> Reviewer: Phase 4 Independent Code Reviewer
> Date: 2026-03-26
> Files reviewed: 9 (4 new, 5 modified)

---

## P0: Blocking Issues

### P0-1: Submit counter silently dropped by Zod schema validation

**File**: `/Users/admin/.claude/plugins/auto-dev-plugin/mcp/src/index.ts` lines 1221-1233

The submit handler writes `tribunalSubmits_phase${phase}` into state.json via `sm.atomicUpdate()`. However, `StateJsonSchema` in `types.ts` is a `z.object({...})` with a fixed set of known keys. Zod v4's `safeParse` strips unknown keys from the output `result.data`.

**Evidence**: Verified with Node.js test:
```
z.object({ name: z.string() }).safeParse({ name: 'test', extraKey: 123 })
// => success: true, data keys: ['name']  -- extraKey is stripped
```

**Impact**: The counter at line 1222 `(state as Record<string, unknown>)[counterKey]` will **always be 0** because the key never persists. The 3-submit escalation limit (line 1223) is completely ineffective -- the main agent can submit unlimited times.

**Fix**: Add `tribunalSubmits` as a proper field in `StateJsonSchema`:
```typescript
// In types.ts StateJsonSchema:
tribunalSubmits: z.record(z.string(), z.number()).optional(),
```
Then use `state.tribunalSubmits?.[`phase${phase}`]` instead of dynamic key access with `as Record<string, unknown>`.

---

### P0-2: `git diff HEAD` produces empty diff for committed changes

**File**: `/Users/admin/.claude/plugins/auto-dev-plugin/mcp/src/tribunal.ts` line 135

```typescript
execFile("git", ["diff", "HEAD"], { cwd: projectRoot, ... })
```

Phase 3 commits code with `git commit`. Phase 4 tribunal then runs `git diff HEAD` which compares working tree to HEAD -- this returns an **empty string** when everything is committed. The tribunal agent receives an empty `.patch` file and has no code to review.

**Impact**: The tribunal agent for Phase 4/5/6 will have no diff to review, making the entire code review meaningless.

**Fix**: Use `state.startCommit` (stored during init at index.ts line 169) as the base:
```typescript
const baseCommit = state.startCommit ?? "HEAD~20";
execFile("git", ["diff", baseCommit, "HEAD"], { cwd: projectRoot, ... })
```
This requires passing `state` into `prepareTribunalInput` or extracting `startCommit` from progress-log.

---

## P1: Important Issues

### P1-1: `crossValidate` and `runQuickPreCheck` use hardcoded `HEAD~20` instead of `startCommit`

**File**: `/Users/admin/.claude/plugins/auto-dev-plugin/mcp/src/tribunal.ts` lines 375, 518

Both functions use `HEAD~20` as a heuristic for the diff base. This is fragile:
- If the project has fewer than 20 commits, `HEAD~20` does not exist and `git diff` silently returns all files
- If the auto-dev session produced more than 20 commits, older changes are missed
- The correct base commit is `state.startCommit`, already stored during init

**Fix**: Pass `startCommit` through to these functions, falling back to `HEAD~20` only if unavailable. Note that `executeTribunal` already receives `state` which contains `startCommit`.

---

### P1-2: `extractTribunalResults` issue count is always 0

**File**: `/Users/admin/.claude/plugins/auto-dev-plugin/mcp/src/retrospective-data.ts` lines 104-108

`extractTribunalResults` counts issues by matching `ISSUE:\s*` in `tribunal-phase{N}.md`. But `buildTribunalLog` (tribunal.ts line 582) writes issues as:
```
- [P0] description text
```
There is no `ISSUE:` prefix anywhere in the output. The regex `/ISSUE:\s*/gi` will never match.

**Impact**: `RetrospectiveAutoData.tribunalResults[].issueCount` will always be 0, making Phase 7 retrospective data inaccurate. The tribunal agent comparing agent claims vs framework data will see 0 issues for all phases.

**Fix**: Either change `buildTribunalLog` to emit `ISSUE: [P0] description` format, or change `extractTribunalResults` to match the actual format:
```typescript
const issueMatches = content.match(/^- \[(P0|P1|P2)\]/gm);
```

---

### P1-3: `extractTribunalResults` verdict parsing is fragile

**File**: `/Users/admin/.claude/plugins/auto-dev-plugin/mcp/src/retrospective-data.ts` line 104

The regex `/VERDICT:\s*(PASS|FAIL)/i` looks for `VERDICT: PASS`. But `buildTribunalLog` writes:
```
## Verdict: PASS
```

The regex would match `Verdict: PASS` inside the `## Verdict:` heading because `/i` makes it case-insensitive. However, if a future change modifies the heading format (e.g., to `**Verdict**: PASS`), it would break silently. More importantly, the word "Verdict" could also appear in issue descriptions or raw output, causing false matches.

**Fix**: Use a more specific regex that anchors to the heading format:
```typescript
const verdictMatch = content.match(/^## Verdict:\s*(PASS|FAIL)/mi);
```

---

### P1-4: Phase 4 pre-check is missing

**File**: `/Users/admin/.claude/plugins/auto-dev-plugin/mcp/src/tribunal.ts` lines 510-571

`runQuickPreCheck` has checks for phases 5, 6, and 7, but **no check for phase 4**. Phase 4 should at minimum verify that `code-review.md` exists (the main agent's self-review that the tribunal will cross-check).

**Fix**: Add phase 4 pre-check:
```typescript
if (phase === 4) {
  try {
    await readFile(join(outputDir, "code-review.md"), "utf-8");
  } catch {
    return "code-review.md 不存在。Phase 4 裁决需要主 Agent 先完成代码审查。";
  }
}
```

---

### P1-5: `generateRetrospectiveData` signature mismatch between caller and implementation

**File**: `/Users/admin/.claude/plugins/auto-dev-plugin/mcp/src/tribunal.ts` line 181 vs `/Users/admin/.claude/plugins/auto-dev-plugin/mcp/src/retrospective-data.ts` line 21

The plan (Task 4) specifies `generateRetrospectiveData(progressLog: string, outputDir: string)` with two parameters. The implementation has `generateRetrospectiveData(outputDir: string)` with one parameter (reads progress-log internally). The caller at tribunal.ts line 181 calls `generateRetrospectiveData(outputDir)` which matches the implementation. This is consistent but diverges from the plan. Not a bug, but worth noting.

**No action needed** -- the implementation is internally consistent.

---

### P1-6: Dormant Path Risk -- `crossValidate` has never been executed in production

**File**: `/Users/admin/.claude/plugins/auto-dev-plugin/mcp/src/tribunal.ts` lines 356-398

`crossValidate` is entirely new code that will only execute when Phase 5 tribunal returns PASS. The `git diff` command at line 375, the file ratio logic, and the exit code check at line 363 are all first-time paths.

**Specific risks**:
- Line 367: `parseInt(exitCodeStr.trim(), 10)` -- if the file contains extra whitespace or newlines, parsing may produce unexpected results
- Line 379: `diffOutput.trim().split("\n").filter(f => f.length > 0)` -- if git diff fails (line 377 catches error and returns ""), this produces `[""]` which passes the `f.length > 0` filter, yielding an array with one empty string. This won't cause a crash but `implCount` and `testCount` will both be 0.

**Required**: Add integration tests for `crossValidate` covering: exit code non-zero, empty git diff, normal operation.

---

## P2: Suggestions (Non-blocking)

### P2-1: `exec("command -v claude")` is not fully POSIX-safe in all shells

**File**: `/Users/admin/.claude/plugins/auto-dev-plugin/mcp/src/tribunal.ts` line 53

`exec` spawns a shell (default `/bin/sh`), so `command -v` should work. However, on some systems `/bin/sh` is linked to dash or other minimal shells that may behave differently. The current implementation is acceptable but could add a fallback.

---

### P2-2: `resolveClaudePath` caching does not account for environment changes

**File**: `/Users/admin/.claude/plugins/auto-dev-plugin/mcp/src/tribunal.ts` lines 35, 81-86

`cachedClaudePath` is a module-level variable. If `TRIBUNAL_CLAUDE_PATH` is set after the first call, the cached value will be stale. This is unlikely in practice since the MCP server process typically has a stable environment.

---

### P2-3: Tribunal timeout (120s) may be too short for complex Phase 4 reviews

**File**: `/Users/admin/.claude/plugins/auto-dev-plugin/mcp/src/tribunal.ts` line 232

`timeout: 120_000` (2 minutes) for the claude process. With `max-turns: 10` for Phase 4, the tribunal agent needs to read multiple files (design.md, plan.md, design-review.md, plan-review.md, code-review.md, plus the diff). If the project is large, 2 minutes may not suffice.

**Suggestion**: Consider 180-240 seconds for Phase 4, or make it configurable per-phase alongside `TRIBUNAL_MAX_TURNS`.

---

### P2-4: `SubmitInputSchema` not defined in `types.ts`

**File**: `/Users/admin/.claude/plugins/auto-dev-plugin/mcp/src/types.ts`

The plan (Task 1) specifies creating `SubmitInputSchema` as a Zod schema, but `index.ts` line 1194-1198 defines the schema inline using `z.string()`, `z.number()`, `z.string()`. This works but is inconsistent with the pattern used for other tools (e.g., `CheckpointInputSchema`, `InitInputSchema`).

---

### P2-5: `auto_dev_complete` still imports and references `runRetrospective`

**File**: `/Users/admin/.claude/plugins/auto-dev-plugin/mcp/src/index.ts` line 21

```typescript
import { runRetrospective } from "./retrospective.js";
```

The plan (Task 7) says to remove the Phase 7 auto-trigger from `auto_dev_complete`. The import is still present. If `runRetrospective` is no longer called from `auto_dev_complete`, this is dead code.

---

### P2-6: Shell injection risk in npx path (low severity)

**File**: `/Users/admin/.claude/plugins/auto-dev-plugin/mcp/src/tribunal.ts` line 287

```typescript
const fullCmd = `${resolved} ${args.map(a => `'${a.replace(/'/g, "'\\''")}'`).join(" ")}`;
```

The single-quote escaping for `args` is correct (standard POSIX escaping). However, the `inputFile` path (embedded in the `-p` prompt text) comes from `join(outputDir, ...)` which is framework-controlled. If a user creates a topic name with shell metacharacters, this could be problematic. The current escaping handles this correctly for args, and `inputFile` is within the prompt string which is single-quoted, so this is safe.

---

## Architecture Review

### Caller-Side Analysis

**Who calls `executeTribunal`?** Only `auto_dev_submit` handler (index.ts line 1237).

**Argument passing verification**:
- `projectRoot`: from tool input `projectRoot` -- correct
- `outputDir`: from `sm.outputDir` -- correct, derived from projectRoot + topic
- `phase`: from tool input `phase` -- validated at line 1202 against `TRIBUNAL_PHASES`
- `topic`: from tool input `topic` -- correct
- `summary`: from tool input `summary` -- correct
- `sm`: freshly constructed `StateManager` -- correct
- `state`: from `sm.loadAndValidate()` -- correct, fresh state

**Return value consumption**: `tribunalResult` (a `ToolResult` with `content` array) is returned directly at line 1239. The `content` field is an array of `{type: "text", text: string}`. The MCP framework expects this exact shape. Correct.

### Security Analysis

**Can the main agent bypass the tribunal?**
- `checkpoint(phase=4/5/6/7, status=PASS)` is blocked at line 355. PASS only.
- The main agent can still call `checkpoint(phase=4, status=IN_PROGRESS)` or `checkpoint(phase=4, status=NEEDS_REVISION)` -- this is by design.
- **Gap (P0-1)**: The submit counter bypass means the agent can submit unlimited times without escalation.

**Can the main agent manipulate tribunal input files?**
- The main agent could write to `tribunal-input-phase{N}.md` before the tribunal runs, but `prepareTribunalInput` overwrites the file (line 188). Safe.
- The main agent could modify `design.md`, `code-review.md` etc. before submit. This is expected -- those are the agent's deliverables being judged.
- Framework-generated files (`framework-test-log.txt`, `framework-test-exitcode.txt`, `retrospective-data.md`) are written by the framework during `prepareTribunalInput`, after the agent calls submit. The agent cannot predict when these will be written and overwrite them (they're written synchronously in the same execution). Safe.

### `internalCheckpoint` Extraction Review

**File**: `/Users/admin/.claude/plugins/auto-dev-plugin/mcp/src/state-manager.ts` lines 518-629

The extraction preserves all guards:
- Idempotency: dedup is handled by the caller (index.ts line 308-315 checks `isCheckpointDuplicate`). The tribunal path (via `executeTribunal`) does NOT check idempotency before calling `internalCheckpoint`. This is acceptable because `executeTribunal` is called from `auto_dev_submit` which has its own submit counter.
- Predecessor validation: NOT in `internalCheckpoint` -- stays in the checkpoint handler (index.ts line 340-351). The tribunal path skips this check. This is intentional: the tribunal itself validates prerequisites via `runQuickPreCheck`.
- Progress-log write + state.json update: preserved with correct error handling (dirty flag on state.json write failure).
- Phase timings: preserved.
- Token usage: preserved (though tribunal doesn't pass `tokenEstimate`, which is fine).

**Safe refactoring**: Yes, the extraction is correct. All pre-validation guards remain in the caller.

---

## Dormant Path Analysis

| Path | Status | Risk |
|------|--------|------|
| `resolveClaudePath` (4-tier fallback) | **First activation** | Medium -- Tier 2/3/4 paths untested |
| `prepareTribunalInput` | **First activation** | Medium -- file writing + git diff |
| `runTribunal` (claude CLI invocation) | **First activation** | High -- depends on external process |
| `runTribunalWithRetry` | **First activation** | Medium -- retry logic untested |
| `crossValidate` | **First activation** | High -- git commands + file parsing |
| `executeTribunal` (full pipeline) | **First activation** | High -- orchestrates all above |
| `internalCheckpoint` | **Refactored from working code** | Low -- logic preserved from tested path |
| `generateRetrospectiveData` | **First activation** | Medium -- regex parsing of progress-log |

All tribunal paths are first-activation. Integration tests are strongly recommended before production use.

---

## Summary

| Severity | Count | Items |
|----------|-------|-------|
| P0 | 2 | Submit counter stripped by Zod (P0-1), Empty git diff (P0-2) |
| P1 | 5 | HEAD~20 heuristic (P1-1), Issue count always 0 (P1-2), Verdict regex fragile (P1-3), Missing Phase 4 pre-check (P1-4), crossValidate dormant (P1-6) |
| P2 | 6 | POSIX shell (P2-1), Cache staleness (P2-2), Timeout (P2-3), Missing SubmitInputSchema (P2-4), Dead import (P2-5), Shell injection (P2-6) |

## Verdict: NEEDS_FIX

P0-1 (submit counter) and P0-2 (empty diff) must be fixed before this code can serve its purpose. P0-1 means the tribunal escalation mechanism is completely non-functional. P0-2 means the tribunal agent receives no code diff to review, which defeats the entire design rationale.
