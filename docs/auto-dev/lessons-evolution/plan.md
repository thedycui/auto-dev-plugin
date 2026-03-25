# Implementation Plan: lessons-evolution (经验优胜劣汰)

> Date: 2026-03-25
> Design doc: `docs/auto-dev/lessons-evolution/design.md` (v2, reviewed PASS)
> Total tasks: 7 ordered tasks (P0 through P6)

---

## Task 1: Type extensions + constants + ensureDefaults

**Files**:
- MODIFY `mcp/src/types.ts`
- CREATE `mcp/src/lessons-constants.ts`

**Depends on**: None

**Description**:

1. In `types.ts`, extend `LessonEntrySchema` with 6 new optional fields:
   - `score: z.number().optional()`
   - `lastPositiveAt: z.string().optional()`
   - `feedbackHistory: z.array(z.object({ verdict: z.enum(['helpful', 'not_applicable', 'incorrect']), phase: z.number(), topic: z.string(), timestamp: z.string() })).optional()`
   - `retired: z.boolean().optional()`
   - `retiredAt: z.string().optional()`
   - `retiredReason: z.enum(['displaced_by_new', 'score_decayed', 'manually_removed']).optional()`

2. In `types.ts`, extend `StateJsonSchema` with:
   - `injectedLessonIds: z.array(z.string()).optional()`

3. Create `mcp/src/lessons-constants.ts` with all centralized constants (P2-3 fix):
   ```typescript
   export const SCORE_INITIAL = { critical: 10, important: 6, minor: 3 } as const;
   export const SCORE_DELTA = { helpful: 3, not_applicable: -1, incorrect: -5 } as const;
   export const DECAY_PERIOD_DAYS = 30;
   export const MAX_GLOBAL_POOL = 50;
   export const MAX_GLOBAL_INJECT = 10;
   export const MAX_FEEDBACK_HISTORY = 20;
   export const MIN_DISPLACEMENT_MARGIN = 2;
   ```

4. In the same file, export `ensureDefaults(entry)` and `initialScore(severity)` helper functions. These must handle legacy entries that have no `score`, `feedbackHistory`, or `retired` fields (AC-7 backward compatibility).

**Acceptance**: AC-7 (backward compatibility, missing fields get defaults)

**Verify**:
```bash
cd mcp && npm run build
```
Build must pass with no type errors. Existing code continues to compile since all new fields are optional.

---

## Task 2: Scoring model -- applyDecay + add() initializes score

**Files**:
- MODIFY `mcp/src/lessons-manager.ts`

**Depends on**: Task 1

**Description**:

1. Import constants and helpers from `lessons-constants.ts`.

2. Add the `applyDecay(entry, now)` function (can be a private method or module-level function):
   - Reference date = `entry.lastPositiveAt ?? entry.timestamp`
   - `decayPenalty = Math.floor(daysSince / DECAY_PERIOD_DAYS)`
   - Returns `Math.max(0, (entry.score ?? initialScore(entry.severity)) - decayPenalty)`

3. Modify `add()` method: when constructing the new `LessonEntry`, include `score: initialScore(options?.severity)`. This ensures newly created entries start with a proper score based on severity.

4. Remove the existing `STALE_DAYS` and `MAX_GLOBAL_INJECT` constants at the top of `lessons-manager.ts` (replaced by centralized constants in `lessons-constants.ts`).

5. **[Plan review P1-1 fix]** Extract `readGlobalEntries()` as a private method from the existing `getGlobalLessons()` boilerplate. This is needed by Tasks 3, 5, and 6 which are parallel — extracting it here (their common ancestor) avoids conflicts.

**Acceptance**: AC-4 (score model foundations), AC-6 (time decay)

**Verify**:
```bash
cd mcp && npm run build
```

---

## Task 3: feedback() method + auto_dev_lessons_feedback MCP tool

**Files**:
- MODIFY `mcp/src/lessons-manager.ts`
- MODIFY `mcp/src/index.ts`

**Depends on**: Task 2

**Description**:

### 3a. LessonsManager.feedback() method

Add a new public method to `LessonsManager`:

```typescript
async feedback(
  feedbacks: Array<{ id: string; verdict: 'helpful' | 'not_applicable' | 'incorrect' }>,
  meta: { phase: number; topic: string }
): Promise<{ localUpdated: string[]; globalUpdated: string[] }>
```

Implementation details per design Section 3.4:
- Read both local entries (`this.readEntries()`) and global entries (`this.readGlobalEntries()`) — already extracted in Task 2.
- For each feedback item, apply `SCORE_DELTA[verdict]` to score, push to `feedbackHistory` (capped at `MAX_FEEDBACK_HISTORY` via `.slice(-MAX_FEEDBACK_HISTORY)`) (P2-1 fix).
- If verdict is `'helpful'`, update `lastPositiveAt`.
- Score floor is 0: `Math.max(0, ...)`.
- Write local and global files independently with error isolation (`.catch(() => {})`) (P0-2 fix, P1-3 fix: no separate syncFeedbackToGlobal).
- Return which IDs were updated in each file (addresses P2-NEW-2 partial failure reporting).

### 3b. auto_dev_lessons_feedback MCP tool in index.ts

Register a new tool `auto_dev_lessons_feedback` (tool #12) with schema:
- `projectRoot: z.string()`
- `topic: z.string()`
- `feedbacks: z.array(z.object({ id: z.string(), verdict: z.enum(['helpful', 'not_applicable', 'incorrect']) }))`

Implementation:
1. Load state via `StateManager`.
2. Call `lessons.feedback(feedbacks, { phase: state.phase, topic: state.topic })`.
3. Clear `injectedLessonIds` via `sm.atomicUpdate({ injectedLessonIds: [] })`.
4. Return success result with updated counts.

**Acceptance**: AC-3 (feedback tool updates score + feedbackHistory), AC-4 (correct deltas), AC-8 (global-only lessons correctly updated)

**Verify**:
```bash
cd mcp && npm run build
```

---

## Task 4: preflight injection tracking + checkpoint enforcement

**Files**:
- MODIFY `mcp/src/index.ts`

**Depends on**: Task 3

**Description**:

### 4a. preflight: record injectedLessonIds in state.json

In the `auto_dev_preflight` tool handler, after global lessons are retrieved and injected into `extraContext` (around line 716-724):

1. Change the lesson injection format to include IDs:
   ```
   - [id:e2c94c80] [pitfall/critical] 经验内容 (来自: topic)
   ```
2. Collect all injected lesson IDs (both local `lessons` and `globalLessons`).
3. After building `extraContext`, write `injectedLessonIds` to state.json:
   ```typescript
   const injectedIds = [...localLessonIds, ...globalLessonIds];
   if (injectedIds.length > 0) {
     await sm.atomicUpdate({ injectedLessonIds: injectedIds });
   }
   ```
4. Add a footer hint to the injected lessons section:
   ```
   > Phase 完成后请对以上经验逐条反馈（helpful / not_applicable / incorrect）
   ```

### 4b. checkpoint: hard-reject PASS when feedback pending (AC-9)

In the `auto_dev_checkpoint` tool handler, add a new guard **after** the predecessor check but **before** any state mutation (fits the existing PRE-VALIDATION PHASE pattern at line 350):

```typescript
// Guard: lesson feedback must be submitted before PASS
if (status === "PASS") {
  const pendingIds = state.injectedLessonIds ?? [];
  if (pendingIds.length > 0) {
    return textResult({
      error: "LESSON_FEEDBACK_REQUIRED",
      lessonFeedbackRequired: true,
      injectedLessonIds: pendingIds,
      feedbackInstruction: "必须先调用 auto_dev_lessons_feedback 对注入的经验逐条反馈，然后再 checkpoint PASS。",
      note: "Checkpoint rejected BEFORE writing state. No state pollution.",
    });
  }
}
```

Key: use `feedbackInstruction` not `mandate` to avoid collision with `computeNextDirective` (P1-4 fix). Return early before any writes (P1-1 fix).

**Acceptance**: AC-1 (injectedLessonIds recorded), AC-2 (checkpoint detects pending feedback), AC-9 (hard rejection, not hint)

**Verify**:
```bash
cd mcp && npm run build
```

---

## Task 5: Eviction mechanism -- addToGlobal() + promoteReusableLessons()

**Files**:
- MODIFY `mcp/src/lessons-manager.ts`

**Depends on**: Task 2

**Description**:

### 5a. Rewrite addToGlobal()

Change signature from `private async addToGlobal(entry): Promise<void>` to:

```typescript
async addToGlobal(entry: LessonEntry): Promise<{ added: boolean; displaced?: LessonEntry }>
```

Implementation per design Section 4.2:
1. Read global entries.
2. Dedup check: if `entries.some(e => e.lesson === entry.lesson && !e.retired)` return `{ added: false }`.
3. Count active (non-retired) entries.
4. If active count < `MAX_GLOBAL_POOL`, push and write. Return `{ added: true }`.
5. If pool is full, compute `effectiveScore` via `applyDecay()` for all active entries, find the lowest.
6. Apply `MIN_DISPLACEMENT_MARGIN` (P1-2 fix): new entry score must exceed `lowest.effectiveScore + MIN_DISPLACEMENT_MARGIN`.
7. If displaced: mark old entry `retired: true`, `retiredAt`, `retiredReason: 'displaced_by_new'`. Push new entry. Write. Return `{ added: true, displaced: lowestEntry }`.
8. If not displaced: return `{ added: false }`.

### 5b. Update add() caller

The existing `add()` method calls `this.addToGlobal(entry)` on line 47. Update to use the new return type (the call site can ignore the result or log it).

### 5c. Rewrite promoteReusableLessons() (P1-5, AC-10)

Replace the current direct-push logic with a loop calling `this.addToGlobal(ensureDefaults(e))`:

```typescript
async promoteReusableLessons(topic: string): Promise<number> {
  const entries = await this.readEntries();
  let promoted = 0;
  for (const e of entries) {
    if (e.reusable && !e.retired) {
      const result = await this.addToGlobal(ensureDefaults({ ...e, topic }));
      if (result.added) promoted++;
    }
  }
  return promoted;
}
```

This ensures all promotions go through the eviction/dedup logic.

**Acceptance**: AC-5 (pool > 50 triggers eviction), AC-10 (promoteReusableLessons uses addToGlobal)

**Verify**:
```bash
cd mcp && npm run build
```

---

## Task 6: getGlobalLessons() rewrite (retired filtering + decay sorting)

**Files**:
- MODIFY `mcp/src/lessons-manager.ts`

**Depends on**: Task 2

**Description**:

Rewrite `getGlobalLessons()` per design Section 4.3:

1. Read all global entries.
2. **Lazy retirement pass** (P0-1 fix): iterate all non-retired entries. If `applyDecay(e, now) <= 0`, mark `retired: true`, `retiredAt`, `retiredReason: 'score_decayed'`. This prevents "phantom slots" where a zero-score entry occupies the pool but never gets cleaned up.
3. Filter out retired entries.
4. Map remaining entries: set `score = applyDecay(e, now)` (effective score with decay applied).
5. Sort by score descending (replaces old severity-based sort).
6. Slice top `limit` (default `MAX_GLOBAL_INJECT`).
7. Update `appliedCount` and `lastAppliedAt` for selected entries.
8. Persist the full entries array (including retirement marks + appliedCount updates).
9. Return selected entries.

Remove the old stale-days filter (`STALE_DAYS * 24 * 60 * 60 * 1000` logic) -- it is replaced by the decay + retirement mechanism.

**Acceptance**: AC-6 (decay applied on read, retired filtered out)

**Verify**:
```bash
cd mcp && npm run build
```

---

## Task 7: Test suite + SKILL.md update

**Files**:
- CREATE `mcp/src/__tests__/lessons-manager.test.ts`
- MODIFY `mcp/package.json` (add vitest devDependency + test script)
- MODIFY `skills/auto-dev/SKILL.md`

**Depends on**: Tasks 3, 4, 5, 6

**Description**:

### 7a. Set up vitest

In `mcp/package.json`:
- Add `vitest` to `devDependencies`
- Add script: `"test": "vitest run"`
- Add script: `"test:watch": "vitest"`

Note: `tsconfig.json` already excludes `src/__tests__` from compilation, so test files won't interfere with build.

### 7b. Test file: `mcp/src/__tests__/lessons-manager.test.ts`

Test cases organized by feature area:

**Group 1: ensureDefaults + initialScore**
- Legacy entry with no `score` field gets default based on severity
- `critical` -> 10, `important` -> 6, `minor`/undefined -> 3
- Missing `feedbackHistory` defaults to `[]`, `retired` defaults to `false`

**Group 2: applyDecay**
- Entry with `lastPositiveAt` 60 days ago: decay = 2
- Entry with no `lastPositiveAt`, `timestamp` 90 days ago: decay = 3
- Decay cannot reduce below 0
- Entry with `lastPositiveAt` 15 days ago: no decay (floor division)

**Group 3: feedback()**
- `helpful` verdict: score increases by 3, `lastPositiveAt` updated
- `not_applicable` verdict: score decreases by 1
- `incorrect` verdict: score decreases by 5
- Score floor at 0 (score cannot go negative)
- `feedbackHistory` capped at `MAX_FEEDBACK_HISTORY` (20) entries (P2-1)
- Feedback for global-only lesson updates global file (AC-8, P0-2)
- Feedback for lesson existing in both local and global updates both files

**Group 4: addToGlobal() eviction**
- Pool under limit: entry added directly
- Pool at limit, new entry score > lowest + margin: lowest displaced, `retired: true`, `retiredReason: 'displaced_by_new'`
- Pool at limit, new entry score <= lowest + margin: entry rejected (P1-2)
- Duplicate lesson text: entry rejected (dedup)
- Retired entries do not count toward pool limit

**Group 5: getGlobalLessons()**
- Returns entries sorted by effective score descending
- Entries with `applyDecay() <= 0` are marked `retired` and persisted (P0-1)
- Retired entries are not returned
- `appliedCount` and `lastAppliedAt` updated for selected entries
- Respects `limit` parameter

**Group 6: promoteReusableLessons()**
- Only promotes entries with `reusable: true` and `!retired`
- Routes through `addToGlobal()` (AC-10, P1-5)
- Dedup prevents double promotion

**Test approach**: Use `tmp` directories (via `node:fs/promises` + `mkdtemp`) to create isolated file-system fixtures. Each test gets its own directory with pre-seeded JSON files. Clean up after each test.

### 7c. SKILL.md update

Add to the Phase completion flow description:
- After each Phase execution, the agent must call `auto_dev_lessons_feedback` to provide verdict on each injected lesson before calling `checkpoint PASS`.
- Document the three verdict options: `helpful`, `not_applicable`, `incorrect`.
- Note that checkpoint will reject PASS if feedback is pending.

**Acceptance**: All ACs validated via tests. AC-9 tested via checkpoint rejection scenario.

**Verify**:
```bash
cd mcp && npm install && npm run build && npm test
```

---

## Dependency Graph

```
Task 1 (types + constants)
  |
  v
Task 2 (scoring: applyDecay + add() score init)
  |
  +------+------+
  |      |      |
  v      v      v
Task 3  Task 5  Task 6
(feedback (eviction) (getGlobalLessons
 method    |        rewrite)
 + tool)   |
  |        |
  v        |
Task 4     |
(preflight |
 + checkpoint)
  |        |
  +--------+
  |
  v
Task 7 (tests + SKILL.md)
```

## Summary of Review Fixes Covered

| Fix ID | Description | Task |
|--------|-------------|------|
| P0-1 | Lazy retirement persistence in getGlobalLessons | Task 6 |
| P0-2 | Dual-file search in feedback() for global-only lessons | Task 3 |
| P1-1 | Checkpoint hard-rejects PASS before any state write | Task 4 |
| P1-2 | MIN_DISPLACEMENT_MARGIN in addToGlobal | Task 5 |
| P1-3 | Delete syncFeedbackToGlobal, feedback() writes both files | Task 3 |
| P1-4 | Use feedbackInstruction field, not mandate | Task 4 |
| P1-5 | promoteReusableLessons routes through addToGlobal | Task 5 |
| P2-1 | feedbackHistory capped at 20 | Task 3 |
| P2-3 | All magic numbers centralized in lessons-constants.ts | Task 1 |
