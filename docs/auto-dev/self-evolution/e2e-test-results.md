# E2E Test Results: self-evolution

## Test File

`mcp/src/__tests__/self-evolution-e2e.test.ts`

## Results

| # | Test | Status |
|---|------|--------|
| 1 | Full pipeline: add → promoteToProject → promoteToGlobal → getCrossProjectLessons | PASS |
| 2 | Cross-project injection: lessons from project A visible in project B | PASS |
| 3 | Backward compat: old method names still work end-to-end | PASS |
| 4 | Retrospective integration: promoteToGlobal called during retrospective | PASS |
| 5 | Data compatibility: old-format entries survive full pipeline | PASS |

## Full Suite

- **21 test files**, **490 tests**, **0 failures**
- tsc --noEmit: clean (0 errors)

## Coverage Summary

- 3-layer promotion pipeline (Local → Project → Global): covered
- Cross-project injection via `injectGlobalLessons()`: covered
- Backward-compatible aliases: covered
- Retrospective → promoteToGlobal integration: covered
- Old-format data compatibility through promotion: covered
