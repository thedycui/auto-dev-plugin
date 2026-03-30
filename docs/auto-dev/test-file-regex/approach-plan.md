# Approach Plan: TEST_PATTERNS regex unification

## Goal
Consolidate scattered test/impl file regexes into tdd-gate.ts, eliminate duplication.

## Steps
1. tdd-gate.ts: Expand TEST_PATTERNS to 5 regexes
2. tdd-gate.test.ts: Add new test cases + countTestFiles describe
3. phase-enforcer.ts: Rewrite countTestFiles to use isTestFile
4. tribunal.ts runQuickPreCheck: Replace inline regex with isImplFile/isTestFile
5. tribunal.ts crossValidate: Same replacement
6. index.ts checkpoint: Replace inline regex with isImplFile
7. Full test run + grep for residual patterns
