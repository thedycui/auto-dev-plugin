# E2E Test Cases: test-file-regex

All test cases are implemented as unit tests in mcp/src/__tests__/tdd-gate.test.ts.

## TC-1: tsx test file recognition (AC-2) - UNIT/positive
## TC-2: jsx spec file recognition (AC-3) - UNIT/positive
## TC-3: Rust test file recognition (AC-4) - UNIT/positive
## TC-4: Kotlin test file recognition (AC-5) - UNIT/positive
## TC-5: pytest naming recognition (AC-6) - UNIT/positive
## TC-6: pytest naming in subdirectory (AC-6) - UNIT/boundary
## TC-7: TestDataFactory.java false positive prevention (AC-7) - UNIT/negative
## TC-8: FooTest.java excluded from impl files (AC-8) - UNIT/negative
## TC-9: countTestFiles integration via isTestFile (AC-9) - UNIT/positive
## TC-10: countTestFiles empty list (AC-9) - UNIT/boundary
## TC-11: grep verification no residual regex copies (AC-1,10,11) - INTEGRATION/positive
## TC-12: full regression test suite (AC-12) - INTEGRATION/positive
