# E2E Integration Test Cases -- v6.0 Robustness Enhancement

**Purpose**: Cover the checkpoint handler's integration logic that pure function tests miss. Each test operates on a real temporary directory with actual state.json and progress-log.md files.

**Test Strategy**: Simulate the checkpoint handler flow from `index.ts` by calling `StateManager` + `checkIterationLimit` + `computeNextDirective` in sequence, verifying state mutations propagate correctly through the full pipeline.

---

## Test Group 1: FORCE_PASS Status Propagation (P1-4 gap)

### TC-1.1: NEEDS_REVISION at iteration limit (non-interactive) triggers FORCE_PASS and writes PASS to state + progress-log

**Precondition**: State at phase=4, iteration=2, interactive=false (max iterations for phase 4 = 3)
**Input**: Simulate checkpoint with status=NEEDS_REVISION (newIteration = 3, hits limit)
**Steps**:
1. Create temp dir, init StateManager, write initial state with phase=4, iteration=2
2. Compute newIteration = (state.iteration ?? 0) + 1 = 3
3. Call checkIterationLimit(4, 3, false) -- expect FORCE_PASS
4. Override status to "PASS", prepend summary with "[FORCED_PASS: ...]"
5. Append checkpoint line to progress-log
6. Call atomicUpdate with status="PASS", iteration=0
7. Call computeNextDirective(4, "PASS", state)

**Expected Results**:
- checkIterationLimit returns action="FORCE_PASS"
- state.json has status="PASS", iteration=0
- progress-log contains "status=PASS" (not NEEDS_REVISION)
- progress-log summary contains "[FORCED_PASS:"
- computeNextDirective returns nextPhase=5, phaseCompleted=true

### TC-1.2: NEEDS_REVISION at iteration limit (interactive) triggers BLOCK and persists iteration (P1-2 fix)

**Precondition**: State at phase=1, iteration=2, interactive=true (max=3)
**Input**: Simulate checkpoint with status=NEEDS_REVISION (newIteration = 3)
**Steps**:
1. Init state with phase=1, iteration=2, interactive=true
2. Compute newIteration = 3
3. Call checkIterationLimit(1, 3, true) -- expect BLOCK
4. Call atomicUpdate({ iteration: 3 }) -- persist iteration even on BLOCK
5. Reload state, verify iteration=3

**Expected Results**:
- checkIterationLimit returns action="BLOCK"
- state.json has iteration=3 (sticky -- retry won't bypass)
- No checkpoint line appended to progress-log (BLOCK returns early)

### TC-1.3: NEEDS_REVISION below limit increments iteration normally

**Precondition**: State at phase=4, iteration=0
**Input**: Simulate checkpoint with status=NEEDS_REVISION (newIteration = 1)
**Steps**:
1. Init state with phase=4, iteration=0
2. newIteration = 1
3. checkIterationLimit(4, 1, false) -- CONTINUE
4. Append checkpoint, atomicUpdate with status=NEEDS_REVISION, iteration=1

**Expected Results**:
- state.json has status="NEEDS_REVISION", iteration=1
- progress-log has "status=NEEDS_REVISION"

---

## Test Group 2: REGRESS Flow Integration (P0-1, P1-3 fixes)

### TC-2.1: Valid REGRESS increments regressionCount, resets iteration, updates phase

**Precondition**: State at phase=4, regressionCount=0, iteration=2
**Input**: Simulate checkpoint with status=REGRESS, regressTo=1
**Steps**:
1. Init state with phase=4, regressionCount undefined, iteration=2
2. Validate REGRESS preconditions (regressTo < phase, count < 2)
3. Append checkpoint to progress-log
4. atomicUpdate with regressionCount=1, iteration=0, phase=4, status="REGRESS"
5. Call computeNextDirective with updated regressionCount in state copy

**Expected Results**:
- state.json has regressionCount=1, iteration=0, status="REGRESS"
- progress-log contains "status=REGRESS"
- computeNextDirective returns nextPhase=1, mandate contains "[REGRESS]"

### TC-2.2: Invalid REGRESS (regressTo >= currentPhase) returns error WITHOUT mutating state (P0-1 fix)

**Precondition**: State at phase=4, regressionCount=0
**Input**: status=REGRESS, regressTo=4
**Steps**:
1. Init state with phase=4
2. Early validation: regressTo(4) >= phase(4) -- return error immediately
3. Verify state.json is unchanged (regressionCount still 0 or undefined)
4. Verify progress-log has no new checkpoint

**Expected Results**:
- Error returned with message about regressTo
- state.json unchanged (no regressionCount increment)
- progress-log unchanged

### TC-2.3: REGRESS at max count (regressionCount=2) returns BLOCKED without mutation (P0-1 fix)

**Precondition**: State at phase=4, regressionCount=2
**Input**: status=REGRESS, regressTo=1
**Steps**:
1. Init state with phase=4, regressionCount=2
2. Early validation: regressionCount >= 2 -- return BLOCKED
3. Verify state.json unchanged

**Expected Results**:
- BLOCKED response with max regression message
- state.json regressionCount remains 2
- progress-log unchanged

### TC-2.4: Two successive regressions allowed, third blocked (P1-3 off-by-one fix)

**Precondition**: State at phase=4, regressionCount=0
**Input**: Three consecutive REGRESS requests
**Steps**:
1. First REGRESS: regressionCount 0->1, computeNextDirective with updated state sees 1 < 2, allows
2. Second REGRESS (from phase=4 again): regressionCount 1->2, computeNextDirective sees 2 >= 2, BLOCKED
3. Verify exactly 2 regressions succeed, the 2nd one's computeNextDirective returns BLOCKED

Wait -- the design says max 2 regressions. The early guard at checkpoint level checks `(state.regressionCount ?? 0) >= 2`. So:
- 1st call: count=0, passes guard, increments to 1. computeNextDirective sees count=1 (with P1-3 fix). 1 < 2, returns REGRESS.
- 2nd call: count=1, passes guard (1 < 2), increments to 2. computeNextDirective sees count=2 (with P1-3 fix). 2 >= 2, returns BLOCKED.

So 1st regression goes through, 2nd gets BLOCKED at computeNextDirective level (but state is already written). This is a design subtlety. The early guard only blocks at count >= 2. The computeNextDirective blocks at count >= 2 too. After 1st regression (count=1), 2nd regression passes early guard (1 < 2) but computeNextDirective sees count=2. State is already written with count=2.

Actually rethinking: the early guard uses the state BEFORE increment. The increment happens in stateUpdates. So:
- 1st call: state.regressionCount=0. Guard: 0 >= 2? No. Proceed. Write count=1. computeNextDirective gets state copy with count=1. 1 >= 2? No. Allows.
- 2nd call: state.regressionCount=1. Guard: 1 >= 2? No. Proceed. Write count=2. computeNextDirective gets state copy with count=2. 2 >= 2? BLOCKED.

So the 2nd call writes state but returns BLOCKED -- this is the correct behavior per the P1-3 fix integration (state is already mutated before computeNextDirective returns BLOCKED).

**Expected Results**:
- 1st REGRESS: succeeds, regressionCount=1, nextPhase=1
- 2nd REGRESS: state written with regressionCount=2, but computeNextDirective returns BLOCKED
- 3rd REGRESS: early guard blocks (2 >= 2), no state mutation

---

## Test Group 3: State Rebuild from Progress-Log (AC-2)

### TC-3.1: Resume with corrupted state.json triggers rebuild from progress-log

**Precondition**: Valid progress-log exists, state.json contains invalid JSON
**Steps**:
1. Create temp dir with valid progress-log (header + 2 checkpoints: phase=1 PASS, phase=2 IN_PROGRESS)
2. Write invalid JSON to state.json
3. Simulate resume: try loadAndValidate() -- catch error
4. Call rebuildStateFromProgressLog()
5. Verify rebuilt state

**Expected Results**:
- Rebuilt state has phase=2, status=IN_PROGRESS, mode=full
- state.json is valid and parseable

### TC-3.2: Resume with dirty state.json clears dirty flag first

**Precondition**: state.json exists with dirty=true but otherwise valid
**Steps**:
1. Write valid state.json with dirty=true
2. loadAndValidate() throws "dirty" error
3. Read raw state, set dirty=false, write back
4. Re-call loadAndValidate() -- succeeds

**Expected Results**:
- After dirty fix, loadAndValidate succeeds
- state.json has dirty=false or undefined

### TC-3.3: Resume with missing state.json + valid progress-log rebuilds correctly

**Precondition**: No state.json, progress-log exists with multiple checkpoints
**Steps**:
1. Create progress-log with header and checkpoints up to phase=3 PASS
2. Do NOT create state.json
3. loadAndValidate() throws "Failed to read"
4. rebuildStateFromProgressLog() succeeds

**Expected Results**:
- Rebuilt state has phase=3, status=PASS
- New state.json written to disk

---

## Test Group 4: Preflight Context Injection (AC-3)

### TC-4.1: Phase 3 preflight injects both design summary and task list

**Precondition**: design.md with ## 概述 section, plan.md with ### Task N lines
**Steps**:
1. Create design.md and plan.md in output dir
2. Call extractDocSummary and extractTaskList
3. Verify extraContext contains both

**Expected Results**:
- extraContext contains "设计摘要" section with overview content
- extraContext contains "任务列表" section with task lines

### TC-4.2: Phase 4 preflight injects design summary only (no task list)

**Precondition**: design.md and plan.md exist
**Steps**:
1. Same files as TC-4.1
2. For phase=4, only design summary is injected (plan task list is phase=3 only)

**Expected Results**:
- extraContext contains design summary
- extraContext does NOT contain task list

### TC-4.3: Missing design.md does not cause error

**Precondition**: No design.md, plan.md exists
**Steps**:
1. Only create plan.md, no design.md
2. Attempt to read design.md -- catch and skip
3. For phase=3, still inject task list

**Expected Results**:
- No error thrown
- extraContext contains only task list (for phase=3)
- extraContext is empty (for phase=4+)

---

## Test Group 5: End-to-End Checkpoint Pipeline

### TC-5.1: Full checkpoint pipeline -- PASS at phase 4 advances to phase 5

**Precondition**: Initialized state at phase=4, status=IN_PROGRESS
**Steps**:
1. Init StateManager, create state at phase=4
2. Write progress-log header
3. Simulate checkpoint: status=PASS
4. Append checkpoint, atomicUpdate, computeNextDirective

**Expected Results**:
- state.json: phase=4, status=PASS, iteration=0
- progress-log: contains PASS checkpoint
- nextDirective: nextPhase=5, phaseCompleted=true, mandate contains "Phase 5"

### TC-5.2: Idempotent checkpoint -- duplicate is detected and skipped

**Precondition**: State at phase=1, one checkpoint already in progress-log
**Steps**:
1. Append a checkpoint line to progress-log
2. Call isCheckpointDuplicate with same params -- returns true
3. Call isCheckpointDuplicate with different status -- returns false

**Expected Results**:
- Same params: isCheckpointDuplicate returns true
- Different params: returns false

### TC-5.3: COMPLETED status at phase 6 triggers completion gate

**Precondition**: Progress-log with all phases 1-6 PASS
**Steps**:
1. Build progress-log with PASS checkpoints for phases 1-6
2. Call validateCompletion -- returns canComplete=true
3. Append COMPLETED checkpoint, update state

**Expected Results**:
- validateCompletion returns canComplete=true
- state.json: status=COMPLETED

---

## Negative Test Cases

### TC-N1: REGRESS without regressTo parameter

**Input**: status=REGRESS, regressTo=undefined
**Expected**: Error message "REGRESS requires regressTo parameter", no state mutation

### TC-N2: Checkpoint with NEEDS_REVISION when iteration is already at max (BLOCK sticky)

**Input**: State has iteration=3 (already at max for phase 1), another NEEDS_REVISION
**Expected**: newIteration=4, exceeds limit, BLOCK returned, iteration persisted as 4

### TC-N3: State rebuild with empty progress-log content

**Input**: Progress-log file exists but contains only empty string
**Expected**: Rebuilt state defaults to phase=1, status=IN_PROGRESS, mode=full
