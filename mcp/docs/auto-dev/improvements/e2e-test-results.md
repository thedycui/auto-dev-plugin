# E2E Test Results: auto-dev improvements

## Test File: `src/__tests__/improvements.test.ts`

### Execution

```
vitest run src/__tests__/improvements.test.ts

 ✓ src/__tests__/improvements.test.ts (11 tests) 15ms

 Test Files  1 passed (1)
      Tests  11 passed (11)
```

### Results

| Test | Status |
|---|---|
| StateJsonSchema accepts startCommit | PASS |
| StateJsonSchema accepts phaseTimings | PASS |
| StateJsonSchema accepts skipE2e | PASS |
| StateJsonSchema accepts tokenUsage | PASS |
| backward compat: old state without new fields is valid | PASS |
| state_update schema rejects phase/status (structural) | PASS |
| computeNextDirective skips phase 5 when skipE2e=true | PASS |
| computeNextDirective does NOT skip phase 5 when skipE2e=false | PASS |
| validateCompletion accepts without phase 5 when skipE2e=true (full) | PASS |
| validateCompletion rejects without phase 5 when skipE2e=false (full) | PASS |
| validateCompletion works with quick+skipE2e (phases 3,4 only) | PASS |

### AC Coverage

- AC-1: Verified structurally (phase/status removed from state_update schema)
- AC-2: startCommit schema validated
- AC-5: phaseTimings schema validated
- AC-6: skipE2e logic tested in both computeNextDirective and validateCompletion (4 tests)
- AC-7: tokenUsage schema validated
- AC-8: Build passes
- AC-3 (suggestedPrompt), AC-4 (resumeTask): Require MCP runtime, verified via code review
