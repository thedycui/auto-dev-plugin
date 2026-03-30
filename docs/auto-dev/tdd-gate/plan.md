# Implementation Plan: TDD Gate (RED-GREEN)

**Design**: [design.md](./design.md) (including Section 十 revisions)
**Review**: [design-review.md](./design-review.md) (PASS, 1 remaining P1 noted)
**Language**: TypeScript/JavaScript
**Project Root**: `/Users/admin/.claude/plugins/auto-dev-plugin`
**Test Runner**: vitest
**Build Command**: `cd mcp && npm run build`
**Test Command**: `cd mcp && npx vitest run`

---

## Task 1: Add `tddTaskStates` field to StateJsonSchema

**Files**: `mcp/src/types.ts`
**TDD**: required
**Estimated time**: 5 min
**Dependencies**: none

**What to do**:
1. Add `TddTaskStatusSchema` enum: `z.enum(["PENDING", "RED_CONFIRMED", "GREEN_CONFIRMED"])`
2. Add `TddTaskStateSchema` object:
   ```typescript
   z.object({
     status: TddTaskStatusSchema,
     redTestFiles: z.array(z.string()).optional(),
     redExitCode: z.number().optional(),
     redFailType: z.enum(["compilation_error", "test_failure"]).optional(),
   })
   ```
3. Add `tddTaskStates: z.record(z.string(), TddTaskStateSchema).optional()` to `StateJsonSchema`
4. Export `TddTaskState` type
5. Extend `RetrospectiveAutoData` interface with:
   ```typescript
   tddGateStats?: {
     totalTasks: number;
     tddTasks: number;
     exemptTasks: number;
     redRejections: number;
     greenRejections: number;
   };
   ```

**Tests** (RED first):
- `tddTaskStates` field accepted by schema with valid enum status
- Schema rejects invalid status values (e.g., `"INVALID"`)
- Backward compat: state without `tddTaskStates` is valid
- `GREEN_CONFIRMED` state with `redTestFiles` parses correctly

---

## Task 2: Create `tdd-gate.ts` core module

**Files**: `mcp/src/tdd-gate.ts` (new)
**TDD**: required
**Estimated time**: 10 min
**Dependencies**: Task 1

**What to do**:
Create the core module with these exports:

1. `isTestFile(filePath: string): boolean` -- positive pattern matching for test files
   - Patterns: `/[Tt]est\.(java|ts|js|py)$/`, `/\.test\.(ts|js|tsx|jsx)$/`, `/\.spec\.(ts|js)$/`, `/_test\.(go|py)$/`
   - Test resource allowance: `.json/.yml/.yaml/.xml/.sql/.txt/.csv` files in `tests?/|__tests__|spec/|fixtures/` directories

2. `isImplFile(filePath: string): boolean` -- inverse of test file check for source files
   - Returns false for test files and non-source files
   - Returns true for `.java/.ts/.js/.py/.go/.rs/.kt` files that are NOT test files

3. `buildTestCommand(language: string, testFiles: string[], projectRoot: string): string`
   - Java/Java 8: extract class name + module from path, group by module, generate `mvn test -Dtest="..." -pl module` per module, join with `&&`
   - TypeScript/JavaScript: `npx vitest run <files> --reporter=verbose`
   - Python: `pytest <files> -v`
   - Default: return empty string (caller falls back to full testCmd)

4. `validateRedPhase(changedFiles: string[], testFiles: string[]): { valid: boolean; error?: string }`
   - Check that no `isImplFile()` file exists in changedFiles
   - Check that at least one file in testFiles exists in changedFiles
   - Return descriptive error on failure

5. `TDD_TIMEOUTS = { red: 60_000, green: 120_000 }`

**Tests** (RED first):
- `isTestFile`: matches `FooTest.java`, `foo.test.ts`, `foo.spec.js`, `foo_test.go`
- `isTestFile`: matches test resource `tests/fixtures/data.json`
- `isTestFile`: does NOT match `src/main/java/TestDataFactory.java` (ends with `Factory.java`)
- `isImplFile`: matches `src/main/java/Foo.java`, `src/utils.ts`
- `isImplFile`: does NOT match `FooTest.java`, `foo.test.ts`
- `isImplFile`: does NOT match `README.md`, `config.yml`
- `buildTestCommand` Java: single module -- `mvn test -Dtest="BarTest" -pl service-mod -DfailIfNoTests=false`
- `buildTestCommand` Java: root-level (no module) -- no `-pl` flag
- `buildTestCommand` Java: multi-module -- two commands joined with `&&`
- `buildTestCommand` TypeScript -- `npx vitest run path/to/test.ts --reporter=verbose`
- `buildTestCommand` Python -- `pytest path/to/test.py -v`
- `buildTestCommand` unknown language -- returns empty string
- `validateRedPhase`: rejects when impl file in changedFiles
- `validateRedPhase`: passes when only test files in changedFiles
- `validateRedPhase`: allows test resource files alongside test files

---

## Task 3: Add `isTddExemptTask` to phase-enforcer

**Files**: `mcp/src/phase-enforcer.ts`
**TDD**: required
**Estimated time**: 5 min
**Dependencies**: none

**What to do**:
1. Add exported function `isTddExemptTask(outputDir: string, task: number): Promise<boolean>`
2. Logic: read `plan.md` from outputDir, split into per-task sections (split on `## Task \d+`), find the section for the target task, check for `**TDD**: skip` (case-insensitive) within that section only
3. Import `readFile` from `node:fs/promises` and `join` from `node:path` (already available in file via types import -- add fs import)

**Tests** (RED first):
- Returns `true` when task section contains `**TDD**: skip`
- Returns `false` when task section does not contain skip marker
- Returns `false` when plan.md does not exist
- Correctly isolates task sections (skip in Task 2 does not affect Task 3)
- Case insensitive: `**TDD**: SKIP` also works

---

## Task 4: Add `auto_dev_task_red` and `auto_dev_task_green` tool handlers in index.ts

**Files**: `mcp/src/index.ts`
**TDD**: required (handler contains non-trivial state validation, child_process exec, exit code interpretation — AC-1 through AC-6 depend on this)

**Estimated time**: 10 min
**Dependencies**: Task 1, Task 2, Task 3

**What to do**:

1. Add imports at top of file:
   ```typescript
   import { isTestFile, isImplFile, buildTestCommand, validateRedPhase, TDD_TIMEOUTS } from "./tdd-gate.js";
   import { isTddExemptTask } from "./phase-enforcer.js";
   ```

2. Register `auto_dev_task_red` tool (insert before `auto_dev_render` section, after checkpoint):
   - Parameters: `projectRoot: z.string()`, `topic: z.string()`, `task: z.number()`, `testFiles: z.array(z.string())`
   - Handler logic:
     a. Load state, verify phase=3, status=IN_PROGRESS, tdd=true
     b. Check task not already RED_CONFIRMED or GREEN_CONFIRMED in tddTaskStates
     c. Get changed files via `git diff --name-only HEAD` (unstaged + staged)
     d. Call `validateRedPhase(changedFiles, testFiles)`
     e. Build test command via `buildTestCommand(state.stack.language, testFiles, projectRoot)`
     f. Execute test command with `TDD_TIMEOUTS.red` timeout via `child_process.execFile`
     g. If exitCode === 0 -> REJECTED (all tests pass, not a valid RED)
     h. If exitCode !== 0 -> RED_CONFIRMED; detect failType from stderr
     i. Write tddTaskStates[task] = { status: "RED_CONFIRMED", redTestFiles, redExitCode, redFailType } to state.json
     j. Return result

3. Register `auto_dev_task_green` tool (right after red):
   - Parameters: `projectRoot: z.string()`, `topic: z.string()`, `task: z.number()`
   - Handler logic:
     a. Load state, verify phase=3, status=IN_PROGRESS, tdd=true
     b. Verify tddTaskStates[task].status === "RED_CONFIRMED" -> else REJECTED
     c. Get redTestFiles from tddTaskStates[task]
     d. Build test command via `buildTestCommand(state.stack.language, redTestFiles, projectRoot)`
     e. Execute test command with `TDD_TIMEOUTS.green` timeout
     f. If exitCode === 0 -> GREEN_CONFIRMED; update tddTaskStates[task].status
     g. If exitCode !== 0 -> REJECTED (tests still failing)
     h. Return result

---

## Task 5: Replace TDD Iron Law code block with tddTaskStates check in index.ts

**Files**: `mcp/src/index.ts`, `mcp/src/state-manager.ts` (clean up dead `tddWarning` handling at lines ~527, 537, 582-585)
**TDD**: skip (refactoring existing code, behavior verified by existing 138 tests + Task 4 new tests)

**Estimated time**: 5 min
**Dependencies**: Task 1, Task 3, Task 4

**What to do**:

1. **DELETE** the existing TDD Iron Law block (lines ~556-619): from `// TDD Iron Law -- HARD BLOCK when tdd=true` through the closing `catch { /* git command failed, skip TDD check */ }` brace

2. **DELETE** the `tddWarning` variable declaration and its usage in `internalCheckpoint` call (line ~626-627). Replace with:
   ```typescript
   tddWarning: null,
   ```

3. **INSERT** new tddTaskStates check in its place:
   ```typescript
   // TDD Gate: verify RED+GREEN for each task (replaces old Iron Law)
   if (phase === 3 && status === "PASS" && state.tdd === true && task != null) {
     const isExempt = await isTddExemptTask(sm.outputDir, task);
     if (!isExempt) {
       const tddState = state.tddTaskStates?.[String(task)];
       if (tddState?.status !== "GREEN_CONFIRMED") {
         return textResult({
           error: "TDD_GATE_INCOMPLETE",
           message: `Task ${task} 未完成 TDD RED-GREEN 流程。` +
             (tddState?.status === "RED_CONFIRMED"
               ? "RED 已确认，但 GREEN 尚未完成。请先调用 auto_dev_task_green。"
               : "RED 尚未完成。请先调用 auto_dev_task_red。"),
           mandate: "[BLOCKED] TDD 模式下，checkpoint PASS 要求 RED+GREEN 均已确认。",
           note: "Checkpoint rejected BEFORE writing state. No state pollution.",
         });
       }
     }
   }
   ```

4. Note: the `tddWarning` field passed to `internalCheckpoint` can be set to `null` since the old advisory mechanism is removed. If `internalCheckpoint` requires it, keep the parameter but always pass `null`.

---

## Task 6: Add Phase 4 tribunal TDD checklist item

**Files**: `mcp/src/tribunal-checklists.ts`
**TDD**: required
**Estimated time**: 3 min
**Dependencies**: Task 1

**What to do**:

1. Add a new subsection to `PHASE_4_CHECKLIST` after the "B. Code Review" section:
   ```markdown
   ### C. TDD Gate Verification (if tdd=true)
   - [ ] Check state.json tddTaskStates: every non-exempt task should have status=GREEN_CONFIRMED
   - [ ] If any task has status=RED_CONFIRMED or PENDING, TDD flow was not completed -> FAIL
   - [ ] Cross-check: test files in diff should align with redTestFiles recorded in tddTaskStates
   ```

2. Rename existing "C. Output requirements" to "D. Output requirements"

**Tests** (RED first):
- `getTribunalChecklist(4)` contains "TDD Gate Verification"
- `getTribunalChecklist(4)` contains "tddTaskStates"

---

## Task 7: Add TDD gate stats to retrospective-data

**Files**: `mcp/src/retrospective-data.ts`, `mcp/src/types.ts`
**TDD**: required
**Estimated time**: 5 min
**Dependencies**: Task 1

**What to do**:

1. In `retrospective-data.ts`, add function `extractTddGateStats(outputDir: string)`:
   - Read `state.json` from outputDir
   - Parse tddTaskStates
   - Count: totalTasks (keys), tddTasks (non-exempt with GREEN_CONFIRMED), exemptTasks (not in tddTaskStates or no entry)
   - Count RED/GREEN rejections from progress-log (search for `TDD_GATE` or `RED_CONFIRMED` rejection markers)
   - Return `tddGateStats` object

2. In `generateRetrospectiveData`, call `extractTddGateStats` and add result to `data`

3. In `renderRetrospectiveDataMarkdown`, add "TDD Gate Stats" section:
   ```markdown
   ## TDD Gate Stats
   | Metric | Value |
   |--------|-------|
   | Total Tasks | N |
   | TDD Tasks (RED+GREEN) | N |
   | Exempt Tasks (TDD: skip) | N |
   | RED Rejections | N |
   | GREEN Rejections | N |
   ```

**Tests** (RED first):
- `extractTddGateStats` returns correct counts from a state.json with tddTaskStates
- Handles missing tddTaskStates gracefully (all zeros)
- Rendered markdown contains "TDD Gate Stats" section

---

## Task 8: Update SKILL.md Phase 3 section

**Files**: `skills/auto-dev/SKILL.md`
**TDD**: skip (documentation, no executable logic)

**Estimated time**: 5 min
**Dependencies**: Task 4, Task 5

**What to do**:

1. Replace Phase 3 section (lines ~159-175) with RED-GREEN gate flow:
   ```markdown
   ## Phase 3: EXECUTE (串行，每任务 max 2 fix)

   对 plan.md 中每个任务：
   1. 记录 `task_start_commit = git rev-parse HEAD`
   2. 检查 plan.md 中是否标注 `**TDD**: skip`
   3. **[TDD task (默认)]**:
      - **Step 1 (RED)**: 调用 developer agent: "只写 Task N 的测试，不写实现代码"
        - `auto_dev_task_red(task=N, testFiles=[...])`
        - RED_CONFIRMED -> 进入 Step 2
        - REJECTED -> 修改测试后重试
      - **Step 2 (GREEN)**: 调用 developer agent: "写 Task N 的最小实现，让测试通过"
        - `auto_dev_task_green(task=N)`
        - GREEN_CONFIRMED -> task 完成
        - REJECTED -> 修改实现后重试
   4. **[TDD: skip task]**: 原流程（developer agent 一次性实现）
   5. `git add <files> && git commit`
   6. `auto_dev_diff_check(expectedFiles, task_start_commit)`
   7. `auto_dev_render("phase3-quick-reviewer", variables)` -> 调用 reviewer Agent
   8. `auto_dev_checkpoint(phase=3, task=N, status=result)`
   9. 如果 NEEDS_FIX -> 修复 -> 再审查一次
   10. 如果仍 NEEDS_FIX -> `auto_dev_git_rollback(task_start_commit)` -> 标记 BLOCKED

   **TDD Gate（默认生效，tdd=false 关闭）：框架级 RED-GREEN 门禁，auto_dev_task_red 和 auto_dev_task_green 物理隔离测试和实现。**
   ```

2. Update TDD Mode section (~279-283) to reference RED-GREEN gate instead of Iron Law

---

## Task 9: Update phase3-developer.md prompt for RED/GREEN modes

**Files**: `skills/auto-dev/prompts/phase3-developer.md`
**TDD**: skip (prompt template, no executable logic)

**Estimated time**: 5 min
**Dependencies**: none

**What to do**:

1. Replace the existing TDD section (lines ~39-71) with two clearly separated prompt blocks:

   **RED prompt block** (used when calling developer for RED step):
   ```markdown
   ## TDD RED Mode (当 {tdd_step} = "red" 时激活)

   > 你正在执行 TDD RED 阶段。只写测试，不写实现。

   ### 规则
   1. 只创建/修改测试文件 (*Test.java, *.test.ts, *.spec.ts, _test.go)
   2. 禁止创建或修改任何实现文件
   3. 测试必须引用尚不存在的类/函数/方法（确保 RED）
   4. 测试要验证真实业务逻辑，不要写 assertTrue(true)
   5. 可以创建测试辅助文件（fixtures、mock data）放在 test 目录

   ### 输出
   - 列出所有创建/修改的测试文件路径（用于 auto_dev_task_red 的 testFiles 参数）
   ```

   **GREEN prompt block** (used when calling developer for GREEN step):
   ```markdown
   ## TDD GREEN Mode (当 {tdd_step} = "green" 时激活)

   > 你正在执行 TDD GREEN 阶段。写最小实现让测试通过。

   ### 规则
   1. 只写让测试通过的最少代码
   2. 不做额外优化、不加测试未要求的功能
   3. 可以修改测试辅助文件（如需 import 调整）
   4. 运行测试确认全部 PASS

   ### 输出
   - 列出所有创建/修改的文件路径
   ```

2. Keep the existing non-TDD section as-is for when `tdd_step` is not set

---

## Task 10: Build verification

**TDD**: skip (verification task, no code output)

**Estimated time**: 3 min
**Dependencies**: All previous tasks

**What to do**:
1. Run `cd /Users/admin/.claude/plugins/auto-dev-plugin/mcp && npm run build` -- must succeed with 0 errors
2. Run `cd /Users/admin/.claude/plugins/auto-dev-plugin/mcp && npx vitest run` -- all tests must pass
3. Verify the new `tdd-gate.ts` file is compiled to `dist/tdd-gate.js`

---

## Dependency Graph

```
Task 1 (types)
  |
  +---> Task 2 (tdd-gate.ts) --+
  |                             |
  +---> Task 3 (phase-enforcer) +---> Task 4 (index.ts handlers) ---> Task 5 (delete Iron Law)
  |                             |
  +---> Task 6 (tribunal)       |
  |                             |
  +---> Task 7 (retrospective)  |
                                |
                                +---> Task 8 (SKILL.md) \
                                                         +---> Task 10 (build verify)
                                      Task 9 (prompts)  /
```

**Parallelizable groups**:
- Group A: Task 1 (must be first)
- Group B: Task 2, Task 3, Task 6, Task 7 (all depend only on Task 1, can be parallel)
- Group C: Task 4 (depends on Task 2 + Task 3)
- Group D: Task 5 (depends on Task 4)
- Group E: Task 8, Task 9 (can be parallel, depend on Task 4/5)
- Group F: Task 10 (final verification)

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| P1-NEW-1 from review: checkpoint uses old boolean fields | Task 5 implements the corrected `status === "GREEN_CONFIRMED"` check per review recommendation |
| `execFile` in handler may fail on missing git | Wrap in try/catch, return descriptive error |
| Existing tests break after schema change | tddTaskStates is `.optional()`, backward compat guaranteed (verified in Task 1 tests) |
| SKILL.md cache in agent context | Phase 3 checkpoint gate (Task 5) catches missed RED/GREEN calls -- fail-safe |

---

## Rollback Plan

If critical issues are found after implementation:
1. Revert all changes via `git revert` on the feature branch
2. The old TDD Iron Law code block is the fallback mechanism
3. `tddTaskStates.optional()` means reverting types.ts does not break existing state.json files
4. SKILL.md and prompt changes are stateless and can be reverted independently
