# Tribunal Feature — E2E Test Cases

> Generated: 2026-03-26
> Framework: vitest
> Strategy: Unit tests with mocks (execFile, fs, StateManager)

---

## TC-1: Checkpoint PASS Block for Tribunal Phases (AC-1)

**Precondition**: Server registered with checkpoint handler; phase=5, status="PASS"
**Input**: `auto_dev_checkpoint({ phase: 5, status: "PASS" })`
**Expected**:
- Returns `error: "TRIBUNAL_REQUIRED"`
- Message contains "auto_dev_submit"
- No state mutation occurs (no checkpoint written)

### TC-1.1: Phase 4 PASS blocked
**Input**: phase=4, status="PASS"
**Expected**: Same as TC-1

### TC-1.2: Phase 6 PASS blocked
**Input**: phase=6, status="PASS"
**Expected**: Same as TC-1

### TC-1.3: Phase 7 PASS blocked
**Input**: phase=7, status="PASS"
**Expected**: Same as TC-1

### TC-1.4: Phase 3 PASS NOT blocked (AC-8)
**Input**: phase=3, status="PASS"
**Expected**: Checkpoint proceeds normally (no TRIBUNAL_REQUIRED error)

### TC-1.5: Phase 5 NEEDS_REVISION NOT blocked
**Input**: phase=5, status="NEEDS_REVISION"
**Expected**: Checkpoint proceeds normally (only PASS is blocked)

---

## TC-2: auto_dev_submit — Invalid Phase (AC-2 negative)

**Precondition**: Submit tool registered
**Input**: `auto_dev_submit({ phase: 2, ... })`
**Expected**: Returns `error: "INVALID_PHASE"`, message mentions Phase 4/5/6/7

---

## TC-3: auto_dev_submit — Phase Mismatch

**Precondition**: State has phase=4
**Input**: `auto_dev_submit({ phase: 5, ... })`
**Expected**: Returns `error: "PHASE_MISMATCH"`, message shows current phase vs submitted phase

---

## TC-4: auto_dev_submit — Submit Counter Escalation (AC-9)

**Precondition**: `state.tribunalSubmits["5"] = 3` (already at max)
**Input**: `auto_dev_submit({ phase: 5, ... })`
**Expected**:
- Returns `status: "TRIBUNAL_ESCALATE"`
- Message mentions human intervention required
- No tribunal process is spawned

### TC-4.1: Submit counter at 2 (below max) proceeds to tribunal
**Precondition**: `state.tribunalSubmits["5"] = 2`
**Expected**: Tribunal process is invoked (not escalated)

---

## TC-5: runTribunal — PASS with Evidence (AC-5)

**Precondition**: Mock execFile to return structured JSON with verdict=PASS, passEvidence=["file.ts:42"]
**Input**: `runTribunal(inputFile, 5)`
**Expected**: Returns `{ verdict: "PASS", passEvidence: ["file.ts:42"] }`

---

## TC-6: runTribunal — PASS without Evidence Override (Revision 4)

**Precondition**: Mock execFile returns verdict=PASS, passEvidence=[]
**Input**: `runTribunal(inputFile, 5)`
**Expected**:
- Returns `verdict: "FAIL"`
- issues[0].description contains "passEvidence 为空"

---

## TC-7: runTribunal — FAIL returns issues list (AC-4)

**Precondition**: Mock execFile returns verdict=FAIL, issues=[{severity:"P0", description:"Missing tests"}]
**Input**: `runTribunal(inputFile, 5)`
**Expected**: Returns issues array with the P0 item

---

## TC-8: runTribunal — Process Error (AC-7)

**Precondition**: Mock execFile calls back with Error("spawn failed")
**Input**: `runTribunal(inputFile, 5)`
**Expected**:
- Returns `verdict: "FAIL"`
- issues[0].description contains "裁决进程执行失败"

---

## TC-9: runTribunal — Invalid JSON Output

**Precondition**: Mock execFile returns non-JSON string
**Input**: `runTribunal(inputFile, 5)`
**Expected**:
- Returns `verdict: "FAIL"`
- issues[0].description contains "JSON 解析失败"

---

## TC-10: runTribunal — Missing structured_output

**Precondition**: Mock execFile returns valid JSON `{ result: "something" }` (no structured_output)
**Input**: `runTribunal(inputFile, 5)`
**Expected**:
- Returns `verdict: "FAIL"`
- issues[0].description contains "未返回有效的 structured_output"

---

## TC-11: runTribunalWithRetry — Crash then Success

**Precondition**: First call returns crash indicator ("裁决进程执行失败"), second returns legitimate FAIL
**Input**: `runTribunalWithRetry(inputFile, 5)`
**Expected**: Returns the legitimate FAIL (retried successfully)

---

## TC-12: runTribunalWithRetry — Two Crashes

**Precondition**: Both calls return crash indicators
**Input**: `runTribunalWithRetry(inputFile, 5)`
**Expected**:
- Returns `verdict: "FAIL"`
- issues[0].description contains "连续" and "崩溃"

---

## TC-13: crossValidate — Phase 5 Test Exit Code Non-Zero

**Precondition**: `framework-test-exitcode.txt` contains "1"
**Input**: `crossValidate(5, outputDir, projectRoot)`
**Expected**: Returns string containing "退出码非零"

---

## TC-14: crossValidate — Phase 5 Impl Files Without Test Files

**Precondition**: git diff returns 3 .ts impl files, 0 test files
**Input**: `crossValidate(5, outputDir, projectRoot)`
**Expected**: Returns string containing "0 个测试文件"

---

## TC-15: crossValidate — Phase 5 All Good

**Precondition**: exit code=0, has test files
**Input**: `crossValidate(5, outputDir, projectRoot)`
**Expected**: Returns null

---

## TC-16: crossValidate — Phase 4 (no checks defined)

**Input**: `crossValidate(4, outputDir, projectRoot)`
**Expected**: Returns null (Phase 4 has no cross-validation)

---

## TC-17: resolveClaudePath — Env Variable Override

**Precondition**: `process.env.TRIBUNAL_CLAUDE_PATH = "/custom/claude"`
**Expected**: Returns "/custom/claude"

---

## TC-18: resolveClaudePath — Fallback to npx

**Precondition**: No env var, `command -v claude` fails, no hardcoded paths exist
**Expected**: Returns string starting with "npx"

---

## TC-19: getTribunalChecklist — Valid Phase

**Input**: `getTribunalChecklist(4)`
**Expected**: Returns markdown string containing "Phase 4"

### TC-19.1: Invalid Phase
**Input**: `getTribunalChecklist(3)`
**Expected**: Throws Error containing "No tribunal checklist"

---

## TC-20: init Health Check — tribunalReady (AC-16)

**Precondition**: Mock `getClaudePath()` to resolve successfully
**Expected**: Init response contains `tribunalReady: true`

### TC-20.1: Claude CLI not available
**Precondition**: Mock `getClaudePath()` to throw
**Expected**: Init response contains `tribunalReady: false` and `tribunalWarning`

---

## TC-21: Integration Entry Point — Submit via index.ts Handler (AC-2)

**Precondition**: State at phase=5, tribunalSubmits={"5": 0}
**Action**: Call the auto_dev_submit handler with valid params
**Expected**:
- Submit counter incremented to 1 in state
- executeTribunal is called with correct arguments
- Return contains TRIBUNAL_PASS or TRIBUNAL_FAIL status

---

## TC-22: Negative — TRIBUNAL_SCHEMA Enforces Required Fields

**Input**: Verdict JSON missing `issues` array
**Expected**: runTribunal returns FAIL (structured_output invalid)

---

## TC-23: retrospective-data — generateRetrospectiveData

**Precondition**: progress-log.md with CHECKPOINT lines, tribunal-phase files
**Expected**:
- `rejectionCount` matches REJECTED/BLOCKED count in progress-log
- `phaseTimings` extracted correctly
- `retrospective-data.md` file is written
