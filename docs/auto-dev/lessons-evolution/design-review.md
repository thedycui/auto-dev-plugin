# Design Review v2: lessons-evolution (经验优胜劣汰)

> Reviewer: Phase 1 Architecture Review (Re-review)
> Date: 2026-03-25
> Design doc: `docs/auto-dev/lessons-evolution/design.md` (revised v2)
> Previous review: v1 (same file, overwritten)
> Codebase baseline: `mcp/src/types.ts`, `mcp/src/lessons-manager.ts`, `mcp/src/index.ts`, `mcp/src/retrospective.ts`

---

## Previous Issue Resolution Status

### P0 Issues (were blocking)

**P0-1: `score_decayed` retirement never persisted in `getGlobalLessons()`** -- RESOLVED

Section 4.3 now includes an explicit retirement pass before filtering:

```typescript
for (const e of entries) {
  if (!e.retired && applyDecay(e, now) <= 0) {
    e.retired = true;
    e.retiredAt = now.toISOString();
    e.retiredReason = 'score_decayed';
    retiredCount++;
  }
}
```

The full `entries` array (including newly retired entries) is persisted at the end of `getGlobalLessons()` via `writeAtomic(entries, this.globalFilePath())`. This closes the phantom-slot problem.

**P0-2: Feedback for global-only lessons silently fails** -- RESOLVED

Section 3.4 now searches both local and global files independently:

```typescript
const localEntries = await this.readEntries();
const globalEntries = await this.readGlobalEntries();
```

Both files are updated independently with error isolation (`.catch(() => {})`). A global-only lesson will be found in `globalEntries` and correctly updated even if absent from `localEntries`. AC-8 formally captures this requirement.

---

### P1 Issues (were important)

**P1-1: checkpoint now hard-rejects PASS when `injectedLessonIds` non-empty** -- RESOLVED

Section 3.2 now shows a hard rejection that returns an error object **without writing to progress-log or state.json**:

```typescript
if (status === "PASS") {
  const pendingIds = state.injectedLessonIds ?? [];
  if (pendingIds.length > 0) {
    return { error: "LESSON_FEEDBACK_REQUIRED", ... };
  }
}
```

The comment "Checkpoint rejected BEFORE writing state. No state pollution." confirms no side effects on rejection. This aligns with the existing checkpoint pattern in `index.ts` where other guards (predecessor check, Phase 5 test execution, etc.) also return early before writing. AC-9 formally captures this.

**P1-2: Displacement margin added** -- RESOLVED

Section 4.2 now includes `MIN_DISPLACEMENT_MARGIN = 2`:

```typescript
if (entry.score > lowest.effectiveScore + MIN_DISPLACEMENT_MARGIN) { ... }
```

The constant is also defined in Section 2.0's centralized constants block.

**P1-3: `syncFeedbackToGlobal` replaced by direct dual-file write** -- RESOLVED

Section 3.4 now operates on both files directly within `feedback()`. The change scope table (Section 6) explicitly notes "**删除** `syncFeedbackToGlobal()`". The dual-file approach with independent `writeAtomic` + `.catch(() => {})` provides proper error isolation.

**P1-4: `feedbackInstruction` field used instead of `mandate` collision** -- RESOLVED

Section 3.2 uses `feedbackInstruction` as the field name, with an explicit callout: "[P1-4 fix] 使用 `feedbackInstruction` 字段而非 `mandate`，避免与 `computeNextDirective` 的导航 mandate 冲突。"

Verified against source: `index.ts` uses `mandate` extensively in checkpoint returns from `computeNextDirective()`. Using a separate field name avoids collision.

**P1-5: `promoteReusableLessons` now uses `addToGlobal()`** -- RESOLVED

Section 4.5 provides explicit pseudocode showing `promoteReusableLessons()` calling `this.addToGlobal(ensureDefaults(e))` in a loop. AC-10 formally captures this. Verified against source: `retrospective.ts` line 92 calls `lessons.promoteReusableLessons(state.topic)` -- this caller will benefit from the displacement logic without changes.

---

### P2 Issues (were suggestions)

**P2-1: `feedbackHistory` cap** -- Addressed. `.slice(-20)` in Section 3.4, constant `MAX_FEEDBACK_HISTORY = 20` in Section 2.0.

**P2-3: Magic numbers centralized** -- Addressed. Section 2.0 defines all tunable constants in one block.

**P2-2, P2-4, P2-5** -- Not addressed, which is acceptable (they were non-blocking suggestions).

---

## New AC-8/9/10 Evaluation

| AC | Description | Covered in Design? | Testable? | Issues |
|----|-------------|-------------------|-----------|--------|
| AC-8 | Global-only lesson feedback updates global file | Yes (Section 3.4, dual-file search) | Yes | OK |
| AC-9 | Skipping feedback + checkpoint PASS is hard-rejected | Yes (Section 3.2, error return) | Yes | Minor: see P2-NEW-1 |
| AC-10 | `promoteReusableLessons()` uses `addToGlobal()` | Yes (Section 4.5) | Yes | OK |

---

## New Findings (v2 review)

### P1 -- None

No new P1 issues found.

### P2 -- Suggestions (Non-blocking)

**P2-NEW-1: Flow diagram in Section 3.6 is stale**

The flow diagram still says "同步到 global（如果 reusable）" on the feedback step. This references the old `syncFeedbackToGlobal()` pattern that was explicitly deleted. Should read something like "直接更新 local + global 两个文件" to match the actual `feedback()` implementation.

Not blocking -- the pseudocode in Section 3.4 is authoritative and correct.

**P2-NEW-2: `feedback()` swallows write errors silently**

Both `writeAtomic` calls use `.catch(() => {})`. While error isolation is correct, silently swallowing means the caller (`auto_dev_lessons_feedback` tool) cannot report partial failures to the agent. Consider returning a result indicating which files were successfully updated.

**P2-NEW-3: `getGlobalLessons()` writes on every read**

The method always calls `writeAtomic` at the end (to persist retirement marks and `appliedCount` updates). This means every `preflight` that reads global lessons also writes. Combined with P2-5 (pre-existing race condition on the global file), this increases write frequency. Acceptable for single-session usage but worth noting for future multi-session scenarios.

---

## Summary Table

| Grade | Count | Status |
|-------|-------|--------|
| P0 (v1) | 2 | Both resolved |
| P1 (v1) | 5 | All 5 resolved |
| P2 (v1) | 5 | 2 addressed, 3 accepted as-is |
| P1 (v2 new) | 0 | -- |
| P2 (v2 new) | 3 | Stale flow diagram; silent error swallowing; write-on-read frequency |

---

## Verdict: **PASS**

All P0 and P1 issues from the v1 review have been properly addressed in the revised design:

1. `score_decayed` retirement is now persisted in `getGlobalLessons()` (P0-1).
2. `feedback()` searches both local and global files with independent writes (P0-2).
3. `checkpoint` hard-rejects PASS when feedback is pending (P1-1).
4. Displacement margin prevents unfair eviction (P1-2).
5. `syncFeedbackToGlobal()` eliminated in favor of direct dual-file writes (P1-3).
6. `feedbackInstruction` avoids `mandate` field collision (P1-4).
7. `promoteReusableLessons()` routes through `addToGlobal()` (P1-5).
8. AC-8/9/10 are well-defined and testable.

The three new P2 items are non-blocking suggestions for implementation polish. Design is ready for implementation.

---

> Generated by auto-dev Phase 1 Architecture Re-Review (v2)
