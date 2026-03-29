# Code Review: self-evolution

## Summary

Implementation of 3-layer Lessons architecture (Local → Project → Global), method renames with backward-compatible aliases, Self-Assess prompt template, and integration into init/retrospective flows.

## Review Results

### AC Coverage

| AC | Verdict | Evidence |
|----|---------|----------|
| AC-1 | PASS | getCrossProjectLessons() tested: sorted return, empty array on missing file |
| AC-2 | PASS | promoteToGlobal() tested: reusable + score filter, dedup, count return |
| AC-3 | PASS | Cross-project pool displacement tested at 100-entry boundary |
| AC-4 | PASS | index.ts calls injectGlobalLessons(), writes injectedGlobalLessonIds |
| AC-5 | PASS | retrospective.ts calls promoteToGlobal() with error isolation |
| AC-6 | PASS | Old JSON without new fields deserializes correctly |
| AC-7 | PASS | self-assess.md renders with TemplateRenderer |
| AC-8 | N/A | Runtime validation (not code review) |
| AC-9 | PASS | All 4 backward-compat aliases tested + build passes |
| AC-10 | PASS | Empty array, malformed JSON, file-not-found all return [] |
| AC-11 | PASS | Low-score entries rejected from promotion |

### Issues Found and Fixed

1. **AC-3 gap** (Important): Added cross-project pool displacement tests (100-entry boundary)
2. **AC-10 gap** (Important): Added malformed JSON and empty array tests
3. **Design alignment**: Changed init flow to use `injectGlobalLessons()` instead of direct `getCrossProjectLessons()`

### Code Quality

- Error isolation in retrospective (try/catch around promoteToGlobal)
- Atomic writes shared across all layers
- Type-safe Zod schemas with optional fields for backward compat
- Clean homedir mocking strategy for cross-project tests

### Test Results

- 485 tests pass across 20 test files
- 0 failures
- tsc --noEmit clean
