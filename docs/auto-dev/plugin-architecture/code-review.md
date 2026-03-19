# Code Review: auto-dev MCP Server Plugin (Phase 4 Cross-Module)

> Reviewer: Claude Opus 4.6 (code-review expert persona)
> Date: 2026-03-19
> Scope: MCP Server core (6 TS files) + plugin manifest + hooks + skill + agents
> Methodology: Checklists code-review-common.md + code-review-typescript.md applied

---

## Summary

The auto-dev MCP Server plugin is well-structured overall. The separation into StateManager, TemplateRenderer, GitManager, and LessonsManager is clean, with each module having a single clear responsibility. Zod schemas in types.ts are used consistently for state validation. Error messages are descriptive and actionable.

The review found **2 P0**, **7 P1**, and **6 P2** issues, primarily around security (command injection surface in git-manager), state consistency (progress-log vs state.json sync), an unused import, and a few cross-module interface gaps.

**Verdict: NEEDS_REVISION** (fix P0s, address P1s)

---

## P0: Blocking Issues (Must Fix)

### P0-1. `baseCommit` is passed unsanitized to git commands (git-manager.ts)

**File**: `mcp/src/git-manager.ts`, lines 49-53 and 88-100

The `baseCommit` parameter is interpolated into git arguments without validation. While `execFile` (not `exec`) is used -- which avoids shell injection -- a malicious or malformed `baseCommit` value like `--output=/etc/passwd` could still be interpreted as a git flag rather than a commit ref. The `files` parameter in `rollback()` has the same risk: a filename starting with `--` would be misinterpreted as a flag.

```typescript
// Current — no validation
async diffCheck(expectedFiles: string[], baseCommit: string): Promise<DiffCheckOutput> {
  const nameOnlyOutput = await this.execGit("diff", "--name-only", `${baseCommit}..HEAD`);
```

**Fix**: Validate `baseCommit` against a strict regex (hex SHA or branch-name pattern) before use. For file paths, ensure `--` separator is always used before file arguments (already done in `rollback` line 118 but not in `diffCheck`).

```typescript
private static COMMIT_REF_RE = /^[a-zA-Z0-9_\-./~^@{}]+$/;

private validateRef(ref: string): void {
  if (!GitManager.COMMIT_REF_RE.test(ref) || ref.startsWith("-")) {
    throw new Error(`Invalid git ref: ${ref}`);
  }
}
```

### P0-2. `auto_dev_checkpoint` dirty-flag recovery is logically broken (index.ts)

**File**: `mcp/src/index.ts`, lines 174-179

When `atomicUpdate(stateUpdates)` fails at line 175, the catch block attempts `atomicUpdate({ ...stateUpdates, dirty: true })`. But `atomicUpdate` internally calls `loadAndValidate()` which reads from disk. If the first `atomicUpdate` failed during the rename step, the on-disk state.json is stale (pre-update). So the second call will re-read the stale state and attempt to merge + write again. If the underlying I/O issue persists (e.g., disk full), this second write will also fail and be silently swallowed by the inner `catch {}`.

Worse, if the first `atomicUpdate` failed *after* writing the `.tmp` file but *before* rename, the second call will overwrite that `.tmp` with a different file, destroying the recovery artifact.

**Fix**: Instead of calling `atomicUpdate` again, write the dirty flag via a direct `atomicWrite` to a separate sentinel file, or read the existing state once, set dirty, and call `atomicWrite` directly (bypassing `loadAndValidate`):

```typescript
} catch (err) {
  // Direct write to mark dirty — do not go through atomicUpdate
  try {
    const current = JSON.parse(await readFile(sm.stateFilePath, "utf-8"));
    current.dirty = true;
    current.updatedAt = new Date().toISOString();
    await writeFile(sm.stateFilePath, JSON.stringify(current, null, 2), "utf-8");
  } catch {
    // Last resort: state.json.tmp preserved for manual recovery
  }
  // ... return error
}
```

---

## P1: Important Issues (Should Fix)

### P1-1. Unused import: `readdir` in state-manager.ts

**File**: `mcp/src/state-manager.ts`, line 11

`readdir` is imported but never used anywhere in the file. With `verbatimModuleSyntax: true` in tsconfig, this will likely still compile (it is a value import, not a type-only import), but it is dead code.

**Fix**: Remove `readdir` from the import statement.

### P1-2. `appendToProgressLog` is not atomic (state-manager.ts)

**File**: `mcp/src/state-manager.ts`, lines 409-427

The `appendToProgressLog` method reads the file, concatenates, then writes back with `writeFile` -- not via `atomicWrite`. This means a crash between the truncating `writeFile` open and the write completion would lose the entire progress-log. This is inconsistent with the class's stated design of "atomic writes via write-to-temp-then-rename."

**Fix**: Use `atomicWrite` for the append path as well:

```typescript
async appendToProgressLog(content: string): Promise<void> {
  const existing = await readFile(this.progressLogPath, "utf-8");
  await this.atomicWrite(this.progressLogPath, existing + content);
}
```

### P1-3. `auto_dev_init` resume path returns untyped object (index.ts)

**File**: `mcp/src/index.ts`, lines 72-74

When `onConflict === "resume"`, the handler returns `{ ...state, resumed: true }` which is a spread of `StateJson` plus `resumed`. This has a different shape from the normal init output (which returns `InitOutput`-like structure with `outputDir`, `stateFile`, `stack`, `git`, `variables`). The caller (SKILL.md orchestrator) receives structurally different responses for the same tool depending on the code path, which could cause downstream parsing issues.

**Fix**: Return a consistent shape for both resume and fresh-init paths. At minimum, include `outputDir`, `stateFile`, `stack`, and `variables` in the resume response. Consider re-detecting git status on resume as well.

### P1-4. `import.meta.url` path resolution is fragile on Windows/encoded paths (state-manager.ts, index.ts)

**File**: `mcp/src/state-manager.ts`, line 37; `mcp/src/index.ts`, line 23

Both files use `import.meta.url.replace("file://", "")` to derive the file path. This is incorrect for paths containing spaces or special characters (which get percent-encoded in URLs), and on Windows where the URL is `file:///C:/...` (the leading slash before drive letter remains). Node.js provides `fileURLToPath` from `node:url` for this purpose.

**Fix**:
```typescript
import { fileURLToPath } from "node:url";
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
```

### P1-5. `tryReadState` skips Zod validation (state-manager.ts)

**File**: `mcp/src/state-manager.ts`, lines 114-121

`tryReadState` parses JSON and casts with `as StateJson` without running `StateJsonSchema.safeParse`. This means a corrupt or tampered state.json would pass silently through `tryReadState`, returning an object that TypeScript believes is `StateJson` but may have wrong field types at runtime.

This method is called by `auto_dev_init` (line 69 of index.ts) to show `existingState` to the user when `OUTPUT_DIR_EXISTS` is returned, so a corrupt file would propagate bad data into the response.

**Fix**: Run `safeParse` and return `null` on failure, or return the raw parsed object typed as `unknown`.

### P1-6. `auto_dev_state_update` accepts arbitrary keys (index.ts)

**File**: `mcp/src/index.ts`, lines 128-141

The `updates` parameter is typed as `z.record(z.string(), z.unknown())` which allows the caller to inject any key-value pair. While `atomicUpdate` does validate the merged result against `StateJsonSchema`, Zod's `z.object` by default strips unknown keys (passthrough is not enabled), so extra keys would be silently dropped. However, a caller could overwrite critical fields like `projectRoot`, `outputDir`, or `startedAt` which should be immutable after init.

**Fix**: Define an explicit `StateUpdatableFields` schema that only allows mutable fields (`phase`, `task`, `iteration`, `status`, `dirty`), and use that as the input schema instead of an open record.

### P1-7. `BLOCKED.md` write is not atomic and uses dynamic imports (index.ts)

**File**: `mcp/src/index.ts`, lines 190-194

The BLOCKED.md write uses a dynamic `await import("node:fs/promises")` inside the tool handler, even though `writeFile` is already available (used elsewhere). This is unnecessary overhead. Additionally, the write is not atomic and could leave a partial file on crash.

**Fix**: Use the StateManager's `atomicWrite` method, or at minimum use a top-level import.

---

## P2: Suggestions (Nice to Have)

### P2-1. Duplicate `pluginRoot()` logic in state-manager.ts and index.ts

Both `state-manager.ts` (line 37, `stackSearchPaths`) and `index.ts` (line 22, `pluginRoot()`) compute the plugin root directory using the same `import.meta.url` approach. This is duplicated logic that could drift. Consider extracting a shared utility.

### P2-2. `LessonEntry` array is not validated on read (lessons-manager.ts)

**File**: `mcp/src/lessons-manager.ts`, line 43

`readEntries` casts `JSON.parse(raw) as LessonEntry[]` without Zod validation. If the file is hand-edited or corrupted, the returned array could contain malformed entries. Consider using `z.array(LessonEntrySchema).safeParse()`.

### P2-3. `isCheckpointDuplicate` iterates all matches instead of reading from the end (state-manager.ts)

**File**: `mcp/src/state-manager.ts`, lines 379-385

The method uses a `while` loop with `exec` to find the last CHECKPOINT match. For a long-running session with many checkpoints, this scans the entire file. A more efficient approach would be to search backward from the end of the string.

### P2-4. No timeout on git operations (git-manager.ts)

`execFile` is called without a `timeout` option. A git operation on a very large repo or a hung process would block the MCP server indefinitely. Consider adding a reasonable timeout (e.g., 30 seconds).

### P2-5. `auto_dev_preflight` calls `outputDirExists()` twice (index.ts)

**File**: `mcp/src/index.ts`, lines 249-252

The `progress_log_writable` check calls `sm.outputDirExists()` twice (once for the `passed` value, once for the `message` ternary). Each call performs a `stat` syscall. Cache the result in a variable.

### P2-6. Hook script relies on stderr convention (hooks/post-agent.sh)

The hook script outputs a reminder to stderr, expecting Claude to see it. This is a fragile coupling -- if the hook runner changes how it handles stderr, the reminder would be silently lost. Consider documenting this assumption or using a structured output format if the plugin hook system supports one.

---

## Cross-Module Consistency Analysis

### Interface Consistency (types.ts usage)

| Module | Uses types.ts schemas | Uses types.ts interfaces | Verdict |
|---|---|---|---|
| state-manager.ts | `StateJsonSchema` for validation | `StateJson`, `StackInfo` via `type` import | OK |
| template-renderer.ts | None (doesn't need schemas) | `RenderOutput` via `type` import | OK |
| git-manager.ts | None (doesn't need schemas) | `GitInfo`, `DiffCheckOutput` via `type` import | OK |
| lessons-manager.ts | None (should use `LessonEntrySchema`) | `LessonEntry` via `type` import | P2-2 gap |
| index.ts | Inline Zod schemas (not from types.ts) | None imported | **Gap** |

**Key finding**: `index.ts` re-defines all tool input schemas inline using `z.string()`, `z.number()`, etc. rather than importing `InitInputSchema`, `CheckpointInputSchema`, `DiffCheckInputSchema`, etc. from `types.ts`. This means the schemas in types.ts and the actual MCP tool schemas could drift. For example, `types.ts` defines `phase: z.number().int()` but `index.ts` uses `phase: z.number()` (missing `.int()`) in the checkpoint and preflight tools.

**Recommendation (P1 severity)**: This is partially addressed by the fact that MCP SDK may require inline schemas. If so, consider at minimum importing the enum schemas (`ModeSchema`, `PhaseStatusSchema`) from types.ts to avoid duplication. Alternatively, use the types.ts schemas directly if the MCP SDK supports pre-defined Zod schemas.

### Import Correctness (verbatimModuleSyntax)

All type-only imports correctly use `import type { ... }`:
- `state-manager.ts`: `import type { StateJson, StackInfo } from "./types.js";` -- correct
- `template-renderer.ts`: `import type { RenderOutput } from "./types.js";` -- correct
- `git-manager.ts`: `import type { GitInfo, DiffCheckOutput } from "./types.js";` -- correct
- `lessons-manager.ts`: `import type { LessonEntry } from "./types.js";` -- correct

Value imports (`StateJsonSchema` in state-manager.ts, `z` in index.ts) are regular imports -- correct.

**Verdict**: verbatimModuleSyntax compliance is good across all modules.

### State Consistency (state.json vs progress-log)

The design intends progress-log to be written *before* state.json, so that on failure the state.json lags behind (recoverable) rather than the reverse. This is correctly implemented in `auto_dev_checkpoint`. However:

1. The dirty-flag recovery mechanism has a logic bug (see P0-2).
2. `appendToProgressLog` is not atomic (see P1-2), so a crash during the progress-log write could truncate the file, losing all history -- which is worse than losing just the latest entry.
3. There is no mechanism to reconcile a dirty state automatically; it requires manual intervention.

---

## Checklist Results

### Common Checklist

| Item | Status | Notes |
|---|---|---|
| A. Architecture consistency | PASS | Clean module separation, single responsibility |
| B. Functional correctness | NEEDS_REVISION | P0-2 dirty-flag logic; P1-3 inconsistent return shape |
| C. Code quality | PASS | Methods under 30 lines, clear naming, no magic numbers |
| D. Error handling | NEEDS_REVISION | P0-2 swallowed catch; P1-2 non-atomic append |
| E. Security (OWASP) | NEEDS_REVISION | P0-1 unsanitized git ref input |
| F. Performance | PASS | No N+1, no blocking hot paths |
| G. Logging | N/A | MCP server uses structured responses, no logging framework |
| H. Testing | NOT CHECKED | No test files present (Task 16 pending) |

### TypeScript Checklist

| Item | Status | Notes |
|---|---|---|
| A. Type safety | NEEDS_REVISION | P1-5 `as` cast without validation; P1-6 open record type |
| B. Async handling | PASS | All async/await correct, no forgotten awaits |
| C. Memory & resources | PASS | No listeners, no timers, no subscriptions |
| D. Security | NEEDS_REVISION | P0-1 input validation gap |
| E. Modules & imports | NEEDS_REVISION | P1-1 unused import; inline schema duplication |
| F. Error handling | PASS | Errors have context, granular try/catch |

---

## Files Reviewed

| File | Lines | Issues |
|---|---|---|
| `mcp/src/types.ts` | 197 | 0 |
| `mcp/src/state-manager.ts` | 428 | P1-1, P1-2, P1-4, P1-5, P2-3 |
| `mcp/src/template-renderer.ts` | 100 | 0 |
| `mcp/src/git-manager.ts` | 158 | P0-1, P2-4 |
| `mcp/src/lessons-manager.ts` | 56 | P2-2 |
| `mcp/src/index.ts` | 369 | P0-2, P1-3, P1-4, P1-6, P1-7, P2-5 |
| `.claude-plugin/plugin.json` | 21 | 0 |
| `hooks/hooks.json` | 14 | 0 |
| `hooks/post-agent.sh` | 4 | P2-6 |
| `skills/auto-dev/SKILL.md` | 69 | 0 |
| `commands/auto-dev.md` | 14 | 0 |
| `agents/*.md` | 4 files | 0 |

---

## Recommended Fix Order

1. **P0-1** (git ref validation) -- security, straightforward fix
2. **P0-2** (dirty-flag recovery) -- correctness, needs redesign of the catch block
3. **P1-2** (atomic append) -- data safety, one-line change
4. **P1-4** (`fileURLToPath`) -- correctness on edge-case paths, simple fix
5. **P1-1** (unused import) -- trivial cleanup
6. **P1-3** (resume return shape) -- API consistency
7. **P1-5** (tryReadState validation) -- defense in depth
8. **P1-6** (restrict updatable fields) -- API hardening
9. **P1-7** (BLOCKED.md cleanup) -- minor code quality
