# E2E Test Results: lessons-evolution

> Date: 2026-03-25
> Test framework: vitest 3.2.4
> Command: `cd mcp && npm test`

## Test Run Summary

```
 Test Files  7 passed (7)
      Tests  92 passed (92)
   Duration  6.89s
```

## Lessons-Manager Tests (35 tests — ALL PASS)

| # | Test | AC | Result |
|---|------|----|--------|
| 1 | critical severity gets score 10 | AC-7 | PASS |
| 2 | important severity gets score 6 | AC-7 | PASS |
| 3 | minor severity gets score 3 | AC-7 | PASS |
| 4 | undefined severity defaults to minor | AC-7 | PASS |
| 5 | legacy entry gets default score | AC-7 | PASS |
| 6 | existing score preserved | AC-7 | PASS |
| 7 | 60 days decay = 2 | AC-6 | PASS |
| 8 | 90 days decay = 3 | AC-6 | PASS |
| 9 | 15 days: no decay | AC-6 | PASS |
| 10 | decay floor at 0 | AC-6 | PASS |
| 11 | uses timestamp fallback | AC-6 | PASS |
| 12 | helpful: +3, lastPositiveAt updated | AC-3,4 | PASS |
| 13 | not_applicable: -1 | AC-4 | PASS |
| 14 | incorrect: -5 | AC-4 | PASS |
| 15 | score floor at 0 | AC-3 | PASS |
| 16 | feedbackHistory capped at 20 | AC-3 | PASS |
| 17 | global-only feedback works | AC-8 | PASS |
| 18 | dual-file feedback | AC-3,8 | PASS |
| 19 | pool under limit: add | AC-5 | PASS |
| 20 | displacement with margin | AC-5 | PASS |
| 21 | below margin: rejected | AC-5 | PASS |
| 22 | dedup: rejected | AC-5 | PASS |
| 23 | retired don't count | AC-5 | PASS |
| 24 | sorted by score desc | AC-6 | PASS |
| 25 | lazy retirement persisted | AC-6 | PASS |
| 26 | retired filtered out | AC-6 | PASS |
| 27 | appliedCount updated | AC-6 | PASS |
| 28 | limit respected | AC-6 | PASS |
| 29 | promote reusable only | AC-10 | PASS |
| 30 | dedup prevents double promote | AC-10 | PASS |
| 31 | injectedLessonIds persist | AC-1 | PASS |
| 32 | pending IDs block PASS | AC-2,9 | PASS |
| 33 | empty IDs allow PASS | AC-9 | PASS |
| 34 | non-PASS not blocked | AC-9 | PASS |
| 35 | feedback clears IDs | AC-1 | PASS |

## AC Coverage

| AC | Covered | Tests |
|----|---------|-------|
| AC-1 | YES | #31, #35 |
| AC-2 | YES | #32 |
| AC-3 | YES | #12-16, #18 |
| AC-4 | YES | #12-14 |
| AC-5 | YES | #19-23 |
| AC-6 | YES | #7-11, #24-28 |
| AC-7 | YES | #1-6 |
| AC-8 | YES | #17-18 |
| AC-9 | YES | #32-34 |
| AC-10 | YES | #29-30 |

**All 10/10 ACs covered and passing.**
