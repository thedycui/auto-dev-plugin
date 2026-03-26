# E2E / Integration Test Cases: TDD Gate (RED-GREEN)

**Date**: 2026-03-26
**Scope**: 验证 TDD Gate 在 MCP handler 层面的完整工作流
**Test Runner**: vitest
**Test File**: `mcp/src/__tests__/tdd-gate-integration.test.ts`

---

## 测试策略

### 为什么需要集成测试

已有 45 个单元测试覆盖了 `tdd-gate.ts`、`phase-enforcer.ts`、`types.ts` 的纯函数逻辑。但根据**集成入口测试规则**，组件正确不等于集成正确。以下路径只有从 handler 入口调用才能验证：

1. `auto_dev_task_red` handler 中 StateManager.loadAndValidate() -> git diff -> validateRedPhase -> execFile -> atomicUpdate 的完整链路
2. `auto_dev_task_green` handler 中 tddTaskStates 状态前置检查 -> execFile -> atomicUpdate 的完整链路
3. `auto_dev_checkpoint` handler 中 tddTaskStates 门禁拦截逻辑
4. `extractTddGateStats` 从真实 state.json 文件读取并统计

### Mock 策略

| 依赖 | Mock 方式 | 原因 |
|------|-----------|------|
| `StateManager` | 使用真实临时目录 + 真实 state.json 文件 | 验证 atomicUpdate 持久化 |
| `child_process.execFile` (git) | vi.mock，返回预设的 git diff 输出 | 不依赖真实 git 仓库 |
| `child_process.execFile` (test runner) | vi.mock，模拟测试通过/失败的 exit code | 不实际运行 mvn/vitest |
| `fs` (plan.md) | 使用真实临时目录写入 plan.md | 验证 isTddExemptTask 的文件读取 |

---

## 测试用例

### INT-1: auto_dev_task_red 完整 Happy Path (RED_CONFIRMED)

- **类型**: INTEGRATION
- **覆盖 AC**: AC-1
- **入口**: `auto_dev_task_red` handler

**前置条件**:
1. 临时目录下存在 state.json: `{ phase: 3, status: "IN_PROGRESS", tdd: true, stack: { language: "TypeScript/JavaScript", ... } }`
2. Mock `execFile("git", ["diff", ...])` 返回 `"src/__tests__/foo.test.ts\n"`
3. Mock `execFile("git", ["diff", "--name-only", "--cached"])` 返回 `""`
4. Mock `execFile("git", ["ls-files", ...])` 返回 `""`
5. Mock `execFile("sh", ["-c", "npx vitest run ..."])` 以 exit code 1 结束，stderr 包含 `"Cannot find module"`

**测试步骤**:
1. 调用 handler: `auto_dev_task_red({ projectRoot, topic, task: 1, testFiles: ["src/__tests__/foo.test.ts"] })`

**预期结果**:
1. 返回 JSON 包含 `{ status: "RED_CONFIRMED", task: 1, failType: "compilation_error" }`
2. 读取 state.json，验证 `tddTaskStates["1"].status === "RED_CONFIRMED"`
3. 验证 `tddTaskStates["1"].redTestFiles` 包含 `"src/__tests__/foo.test.ts"`
4. 验证 `tddTaskStates["1"].redExitCode === 1`
5. 验证 `tddTaskStates["1"].redFailType === "compilation_error"`

**验证方式**: 解析 handler 返回的 `content[0].text` (JSON.parse) + 读取磁盘上的 state.json

---

### INT-2: auto_dev_task_red REJECTED -- 包含实现文件

- **类型**: INTEGRATION
- **覆盖 AC**: AC-2
- **入口**: `auto_dev_task_red` handler

**前置条件**:
1. state.json: `{ phase: 3, status: "IN_PROGRESS", tdd: true, stack: { language: "Java", ... } }`
2. Mock git diff 返回 `"src/test/java/FooTest.java\nsrc/main/java/Foo.java\n"`（包含实现文件）
3. Mock git staged diff 返回 `""`
4. Mock git untracked 返回 `""`

**测试步骤**:
1. 调用 handler: `auto_dev_task_red({ projectRoot, topic, task: 1, testFiles: ["src/test/java/FooTest.java"] })`

**预期结果**:
1. 返回 JSON 包含 `{ status: "REJECTED", error: "RED_VALIDATION_FAILED" }`
2. 返回 message 包含 `"Foo.java"`
3. state.json 中 **不存在** `tddTaskStates["1"]`（状态未被污染）

**验证方式**: 解析返回 JSON + 确认 state.json 未变更

---

### INT-3: auto_dev_task_red REJECTED -- 测试全部通过（非有效 RED）

- **类型**: INTEGRATION
- **覆盖 AC**: AC-3
- **入口**: `auto_dev_task_red` handler

**前置条件**:
1. state.json: `{ phase: 3, status: "IN_PROGRESS", tdd: true, stack: { language: "TypeScript/JavaScript", ... } }`
2. Mock git diff 返回 `"src/__tests__/foo.test.ts\n"`
3. Mock test execution 以 exit code 0 结束（测试全通过）

**测试步骤**:
1. 调用 handler: `auto_dev_task_red({ projectRoot, topic, task: 1, testFiles: ["src/__tests__/foo.test.ts"] })`

**预期结果**:
1. 返回 JSON 包含 `{ status: "REJECTED", error: "TESTS_PASS_NOT_RED" }`
2. 返回 message 包含 "测试全部通过"
3. state.json 中 **不存在** `tddTaskStates["1"]`

---

### INT-4: auto_dev_task_red REJECTED -- 非 Phase 3

- **类型**: INTEGRATION
- **入口**: `auto_dev_task_red` handler

**前置条件**:
1. state.json: `{ phase: 2, status: "IN_PROGRESS", tdd: true, ... }`

**测试步骤**:
1. 调用 handler: `auto_dev_task_red({ projectRoot, topic, task: 1, testFiles: ["test.ts"] })`

**预期结果**:
1. 返回 `{ error: "INVALID_PHASE" }`
2. message 包含 "phase=2"

---

### INT-5: auto_dev_task_red REJECTED -- tdd 未启用

- **类型**: INTEGRATION
- **入口**: `auto_dev_task_red` handler

**前置条件**:
1. state.json: `{ phase: 3, status: "IN_PROGRESS", tdd: false, ... }`

**测试步骤**:
1. 调用 handler: `auto_dev_task_red({ projectRoot, topic, task: 1, testFiles: ["test.ts"] })`

**预期结果**:
1. 返回 `{ error: "TDD_NOT_ENABLED" }`

---

### INT-6: auto_dev_task_red REJECTED -- task 已 RED_CONFIRMED（重复调用）

- **类型**: INTEGRATION
- **入口**: `auto_dev_task_red` handler

**前置条件**:
1. state.json: `{ phase: 3, status: "IN_PROGRESS", tdd: true, tddTaskStates: { "1": { status: "RED_CONFIRMED", redTestFiles: ["t.ts"] } }, ... }`

**测试步骤**:
1. 调用 handler: `auto_dev_task_red({ projectRoot, topic, task: 1, testFiles: ["t.ts"] })`

**预期结果**:
1. 返回 `{ error: "TASK_ALREADY_CONFIRMED" }`
2. message 包含 "RED_CONFIRMED"

---

### INT-7: auto_dev_task_red -- staged 实现文件被检测到（P1-4 修复验证）

- **类型**: INTEGRATION
- **入口**: `auto_dev_task_red` handler

**前置条件**:
1. state.json: `{ phase: 3, status: "IN_PROGRESS", tdd: true, stack: { language: "TypeScript/JavaScript", ... } }`
2. Mock git diff (unstaged) 返回 `"src/__tests__/foo.test.ts\n"`
3. Mock git diff --cached (staged) 返回 `"src/impl.ts\n"`（实现文件在 staged 中）
4. Mock git untracked 返回 `""`

**测试步骤**:
1. 调用 handler: `auto_dev_task_red({ projectRoot, topic, task: 1, testFiles: ["src/__tests__/foo.test.ts"] })`

**预期结果**:
1. 返回 `{ status: "REJECTED", error: "RED_VALIDATION_FAILED" }`
2. message 包含 `"impl.ts"`
3. 验证 staged 文件检测逻辑生效（P1-4 修复的关键验证点）

---

### INT-8: auto_dev_task_red -- NO_TEST_COMMAND（语言不支持）

- **类型**: INTEGRATION
- **入口**: `auto_dev_task_red` handler

**前置条件**:
1. state.json: `{ phase: 3, status: "IN_PROGRESS", tdd: true, stack: { language: "Rust", ... } }`
2. Mock git diff 返回 `"src/foo_test.rs\n"`

**测试步骤**:
1. 调用 handler: `auto_dev_task_red({ projectRoot, topic, task: 1, testFiles: ["src/foo_test.rs"] })`

**预期结果**:
1. 返回 `{ error: "NO_TEST_COMMAND" }`
2. message 包含 "Rust"

---

### INT-9: auto_dev_task_green 完整 Happy Path (GREEN_CONFIRMED)

- **类型**: INTEGRATION
- **覆盖 AC**: AC-5
- **入口**: `auto_dev_task_green` handler

**前置条件**:
1. state.json: `{ phase: 3, status: "IN_PROGRESS", tdd: true, stack: { language: "TypeScript/JavaScript", ... }, tddTaskStates: { "1": { status: "RED_CONFIRMED", redTestFiles: ["src/__tests__/foo.test.ts"], redExitCode: 1, redFailType: "test_failure" } } }`
2. Mock test execution 以 exit code 0 结束

**测试步骤**:
1. 调用 handler: `auto_dev_task_green({ projectRoot, topic, task: 1 })`

**预期结果**:
1. 返回 JSON 包含 `{ status: "GREEN_CONFIRMED", task: 1 }`
2. 读取 state.json，验证 `tddTaskStates["1"].status === "GREEN_CONFIRMED"`
3. 验证 `tddTaskStates["1"].redTestFiles` 保留（spread 合并没丢字段）

**验证方式**: 解析返回 JSON + 读取磁盘 state.json

---

### INT-10: auto_dev_task_green REJECTED -- RED 未完成

- **类型**: INTEGRATION
- **覆盖 AC**: AC-4
- **入口**: `auto_dev_task_green` handler

**前置条件**:
1. state.json: `{ phase: 3, status: "IN_PROGRESS", tdd: true, ... }`（无 tddTaskStates）

**测试步骤**:
1. 调用 handler: `auto_dev_task_green({ projectRoot, topic, task: 1 })`

**预期结果**:
1. 返回 `{ status: "REJECTED", error: "NOT_RED_CONFIRMED" }`
2. message 包含 "auto_dev_task_red"

---

### INT-11: auto_dev_task_green REJECTED -- 测试仍然失败

- **类型**: INTEGRATION
- **覆盖 AC**: AC-6
- **入口**: `auto_dev_task_green` handler

**前置条件**:
1. state.json: `{ ..., tddTaskStates: { "1": { status: "RED_CONFIRMED", redTestFiles: ["t.test.ts"], redExitCode: 1 } } }`
2. Mock test execution 以 exit code 1 结束

**测试步骤**:
1. 调用 handler: `auto_dev_task_green({ projectRoot, topic, task: 1 })`

**预期结果**:
1. 返回 `{ status: "REJECTED", error: "TESTS_STILL_FAILING" }`
2. state.json 中 `tddTaskStates["1"].status` 仍然是 `"RED_CONFIRMED"`（未被改为 GREEN）

---

### INT-12: auto_dev_task_green REJECTED -- tdd 未启用

- **类型**: INTEGRATION
- **入口**: `auto_dev_task_green` handler

**前置条件**:
1. state.json: `{ phase: 3, status: "IN_PROGRESS", tdd: false, ... }`

**测试步骤**:
1. 调用 handler: `auto_dev_task_green({ projectRoot, topic, task: 1 })`

**预期结果**:
1. 返回 `{ error: "TDD_NOT_ENABLED" }`

---

### INT-13: auto_dev_task_green -- NO_TEST_FILES（RED 阶段未记录 testFiles）

- **类型**: INTEGRATION
- **入口**: `auto_dev_task_green` handler

**前置条件**:
1. state.json: `{ ..., tddTaskStates: { "1": { status: "RED_CONFIRMED" } } }`（redTestFiles 缺失）

**测试步骤**:
1. 调用 handler: `auto_dev_task_green({ projectRoot, topic, task: 1 })`

**预期结果**:
1. 返回 `{ error: "NO_TEST_FILES" }`

---

### INT-14: RED -> GREEN 全链路（状态跨步骤持久化）

- **类型**: INTEGRATION (end-to-end flow)
- **覆盖 AC**: AC-1, AC-5
- **入口**: `auto_dev_task_red` -> `auto_dev_task_green` (顺序调用)

**前置条件**:
1. state.json: `{ phase: 3, status: "IN_PROGRESS", tdd: true, stack: { language: "TypeScript/JavaScript", ... } }`
2. Mock git diff 返回 `"src/__tests__/bar.test.ts\n"`
3. Mock test execution: 第一次（RED）exit code 1，第二次（GREEN）exit code 0

**测试步骤**:
1. 调用 `auto_dev_task_red({ projectRoot, topic, task: 2, testFiles: ["src/__tests__/bar.test.ts"] })`
2. 验证返回 `RED_CONFIRMED`
3. 调用 `auto_dev_task_green({ projectRoot, topic, task: 2 })`
4. 验证返回 `GREEN_CONFIRMED`

**预期结果**:
1. step 1 返回 `status: "RED_CONFIRMED"`
2. step 3 返回 `status: "GREEN_CONFIRMED"`
3. 最终 state.json 中 `tddTaskStates["2"].status === "GREEN_CONFIRMED"`
4. `tddTaskStates["2"].redTestFiles` 包含 `"src/__tests__/bar.test.ts"`（RED 阶段记录被保留）

**验证方式**: 两次 handler 调用之间通过真实 state.json 文件传递状态（不是内存 mock）

---

### INT-15: Checkpoint TDD Gate -- 阻止未完成 RED+GREEN 的 task

- **类型**: INTEGRATION
- **覆盖 AC**: AC-7
- **入口**: `auto_dev_checkpoint` handler

**前置条件**:
1. state.json: `{ phase: 3, status: "IN_PROGRESS", tdd: true, ... }`（无 tddTaskStates）
2. plan.md 中 Task 1 标记为 `**TDD**: required`

**测试步骤**:
1. 调用 `auto_dev_checkpoint({ projectRoot, topic, phase: 3, task: 1, status: "PASS", summary: "done" })`

**预期结果**:
1. 返回 `{ error: "TDD_GATE_INCOMPLETE" }`
2. message 包含 "RED 尚未完成"
3. message 包含 "auto_dev_task_red"
4. state.json 的 phase 仍为 3（checkpoint 未写入，状态无污染）

---

### INT-16: Checkpoint TDD Gate -- 仅 RED_CONFIRMED 时阻止

- **类型**: INTEGRATION
- **覆盖 AC**: AC-7
- **入口**: `auto_dev_checkpoint` handler

**前置条件**:
1. state.json: `{ phase: 3, status: "IN_PROGRESS", tdd: true, tddTaskStates: { "1": { status: "RED_CONFIRMED", redTestFiles: ["t.ts"] } } }`

**测试步骤**:
1. 调用 `auto_dev_checkpoint({ projectRoot, topic, phase: 3, task: 1, status: "PASS", summary: "done" })`

**预期结果**:
1. 返回 `{ error: "TDD_GATE_INCOMPLETE" }`
2. message 包含 "RED 已确认" 和 "GREEN 尚未完成"
3. message 包含 "auto_dev_task_green"

---

### INT-17: Checkpoint TDD Gate -- GREEN_CONFIRMED 时放行

- **类型**: INTEGRATION
- **覆盖 AC**: AC-7
- **入口**: `auto_dev_checkpoint` handler

**前置条件**:
1. state.json: `{ phase: 3, status: "IN_PROGRESS", tdd: true, tddTaskStates: { "1": { status: "GREEN_CONFIRMED", redTestFiles: ["t.ts"] } } }`

**测试步骤**:
1. 调用 `auto_dev_checkpoint({ projectRoot, topic, phase: 3, task: 1, status: "PASS", summary: "done" })`

**预期结果**:
1. 返回 `{ ok: true }` (checkpoint 成功，不含 TDD_GATE_INCOMPLETE 错误)
2. state.json 写入成功

---

### INT-18: Checkpoint TDD Gate -- TDD exempt task 放行

- **类型**: INTEGRATION
- **覆盖 AC**: AC-8
- **入口**: `auto_dev_checkpoint` handler

**前置条件**:
1. state.json: `{ phase: 3, status: "IN_PROGRESS", tdd: true, ... }`（无 tddTaskStates）
2. plan.md 内容：
   ```
   ## Task 9: Update SKILL.md
   **TDD**: skip
   ```

**测试步骤**:
1. 调用 `auto_dev_checkpoint({ projectRoot, topic, phase: 3, task: 9, status: "PASS", summary: "docs updated" })`

**预期结果**:
1. 返回 `{ ok: true }`（不含 TDD_GATE_INCOMPLETE）
2. TDD exempt 判断正确读取了 plan.md

---

### INT-19: Checkpoint TDD Gate -- tdd=false 时不启用门禁

- **类型**: INTEGRATION
- **覆盖 AC**: AC-11
- **入口**: `auto_dev_checkpoint` handler

**前置条件**:
1. state.json: `{ phase: 3, status: "IN_PROGRESS", tdd: false, ... }`（无 tddTaskStates）

**测试步骤**:
1. 调用 `auto_dev_checkpoint({ projectRoot, topic, phase: 3, task: 1, status: "PASS", summary: "done" })`

**预期结果**:
1. 返回 `{ ok: true }`（TDD gate 不生效）

---

### INT-20: Phase 4 tribunal checklist 包含 TDD Gate Verification

- **类型**: INTEGRATION
- **入口**: `getTribunalChecklist(4)` 或 tribunal checklist 渲染

**前置条件**: 无

**测试步骤**:
1. 调用 `getTribunalChecklist(4)` 获取 Phase 4 checklist 文本

**预期结果**:
1. 返回文本包含 `"TDD Gate Verification"`
2. 返回文本包含 `"tddTaskStates"`
3. 返回文本包含 `"GREEN_CONFIRMED"`

---

### INT-21: extractTddGateStats 统计正确

- **类型**: INTEGRATION
- **入口**: `generateRetrospectiveData()` (从文件系统读取)

**前置条件**:
1. 临时目录下写入 state.json:
   ```json
   {
     "tddTaskStates": {
       "1": { "status": "GREEN_CONFIRMED" },
       "2": { "status": "GREEN_CONFIRMED" },
       "3": { "status": "RED_CONFIRMED" }
     }
   }
   ```
2. 临时目录下写入 progress-log.md，包含:
   ```
   auto_dev_task_red: REJECTED (TESTS_PASS_NOT_RED)
   auto_dev_task_green: REJECTED (TESTS_STILL_FAILING)
   auto_dev_task_green: REJECTED (TESTS_STILL_FAILING)
   ```

**测试步骤**:
1. 调用 `extractTddGateStats(tmpDir, progressLogContent)`

**预期结果**:
1. `totalTasks === 3`
2. `tddTasks === 2` (GREEN_CONFIRMED 的数量)
3. `exemptTasks === 0` (P2-2 已知限制)
4. `redRejections === 1`
5. `greenRejections === 2`

---

### INT-22: extractTddGateStats 无 tddTaskStates 时返回全零

- **类型**: INTEGRATION
- **入口**: `extractTddGateStats()`

**前置条件**:
1. state.json 不包含 tddTaskStates 字段

**测试步骤**:
1. 调用 `extractTddGateStats(tmpDir, "")`

**预期结果**:
1. `totalTasks === 0, tddTasks === 0, exemptTasks === 0, redRejections === 0, greenRejections === 0`

---

### INT-23: Retrospective markdown 渲染包含 TDD Gate Stats

- **类型**: INTEGRATION
- **入口**: `renderRetrospectiveDataMarkdown()`

**前置条件**:
1. 构造 `RetrospectiveAutoData` 对象，包含 `tddGateStats: { totalTasks: 5, tddTasks: 3, exemptTasks: 2, redRejections: 1, greenRejections: 0 }`

**测试步骤**:
1. 调用 `renderRetrospectiveDataMarkdown(data)`

**预期结果**:
1. 返回 markdown 包含 `"## TDD Gate Stats"`
2. 包含 `"| Total Tasks | 5 |"`
3. 包含 `"| TDD Tasks (RED+GREEN) | 3 |"`
4. 包含 `"| Exempt Tasks (TDD: skip) | 2 |"`

---

### INT-24: auto_dev_task_red -- RED failType 检测（test_failure vs compilation_error）

- **类型**: INTEGRATION
- **入口**: `auto_dev_task_red` handler

**前置条件 (case A -- compilation_error)**:
1. state.json, git diff 与 INT-1 相同
2. Mock test execution exit code 1, stderr: `"Error: Cannot find module './not-yet-implemented'"`

**前置条件 (case B -- test_failure)**:
1. state.json, git diff 与 INT-1 相同
2. Mock test execution exit code 1, stderr: `"AssertionError: expected 0 to equal 42"`

**测试步骤**: 分别调用 handler

**预期结果**:
1. Case A: `failType === "compilation_error"`
2. Case B: `failType === "test_failure"`

---

### INT-25: RED -> GREEN -> Checkpoint 三步全链路

- **类型**: INTEGRATION (end-to-end flow)
- **覆盖 AC**: AC-1, AC-5, AC-7
- **入口**: `auto_dev_task_red` -> `auto_dev_task_green` -> `auto_dev_checkpoint`

**前置条件**:
1. state.json: `{ phase: 3, status: "IN_PROGRESS", tdd: true, stack: { language: "TypeScript/JavaScript", ... } }`
2. plan.md: Task 1 标记为 `**TDD**: required`
3. Mock git diff 返回测试文件
4. Mock test execution: RED 时 exit code 1, GREEN 时 exit code 0

**测试步骤**:
1. 调用 `auto_dev_task_red({ task: 1, testFiles: ["src/__tests__/foo.test.ts"], ... })`
2. 验证 `RED_CONFIRMED`
3. 调用 `auto_dev_task_green({ task: 1, ... })`
4. 验证 `GREEN_CONFIRMED`
5. 调用 `auto_dev_checkpoint({ phase: 3, task: 1, status: "PASS", summary: "task 1 done" })`
6. 验证 checkpoint 成功

**预期结果**:
1. step 1 返回 `status: "RED_CONFIRMED"`
2. step 3 返回 `status: "GREEN_CONFIRMED"`
3. step 5 返回 `{ ok: true }`（不含 TDD_GATE_INCOMPLETE）
4. state.json 最终记录 task 1 完成

**意义**: 这是最关键的全链路测试。单独测 RED、GREEN、checkpoint 都可能通过，但三者串联时可能出现：atomicUpdate 写入格式与 checkpoint 读取不兼容、状态 key 不一致（String(task) vs task）、loadAndValidate 缓存问题等。

---

## 覆盖矩阵

| AC | 描述 | 单元测试 (已有) | 集成测试 (本文) |
|----|------|----------------|----------------|
| AC-1 | RED_CONFIRMED 在只有测试文件变更时 | isTestFile, validateRedPhase | INT-1, INT-14, INT-25 |
| AC-2 | RED REJECTED 在有实现文件变更时 | validateRedPhase rejects | INT-2, INT-7 |
| AC-3 | RED REJECTED 在测试全通过时 | - | INT-3 |
| AC-4 | GREEN REJECTED 在 RED 未完成时 | - | INT-10 |
| AC-5 | GREEN_CONFIRMED 在测试通过时 | - | INT-9, INT-14, INT-25 |
| AC-6 | GREEN REJECTED 在测试失败时 | - | INT-11 |
| AC-7 | Checkpoint 要求 RED+GREEN confirmed | - | INT-15, INT-16, INT-17, INT-25 |
| AC-8 | TDD: skip 豁免 | isTddExemptTask tests | INT-18 |
| AC-9 | Java buildTestCommand 正确 | buildTestCommand Java tests | (由单元测试充分覆盖) |
| AC-10 | TypeScript buildTestCommand 正确 | buildTestCommand TS tests | INT-1 (间接验证) |
| AC-11 | tdd=false 不启用 gate | - | INT-5, INT-12, INT-19 |

### Code Review 问题覆盖

| Issue | 集成测试覆盖 |
|-------|-------------|
| P0-1: buildTestCommand 不识别 "TypeScript/JavaScript" | INT-1 (语言设为 "TypeScript/JavaScript" 验证命令生成成功) |
| P1-3: execFile err.code 不一定是数字 | INT-24 (验证不同 stderr 下 failType 正确) |
| P1-4: staged 文件绕过 RED 验证 | INT-7 (staged 实现文件被检测到) |
| P2-2: exempt count 始终为 0 | INT-21 (验证 exemptTasks === 0 作为已知限制) |

### Dormant Path 覆盖

| 代码路径 | 首次激活 | 集成测试 |
|----------|---------|---------|
| `auto_dev_task_red` handler (index.ts 600-733) | 是 | INT-1 ~ INT-8, INT-14, INT-25 |
| `auto_dev_task_green` handler (index.ts 740-842) | 是 | INT-9 ~ INT-14, INT-25 |
| TDD checkpoint guard (index.ts 557-574) | 是 | INT-15 ~ INT-19, INT-25 |
| `extractTddGateStats` (retrospective-data.ts 210-240) | 是 | INT-21, INT-22 |
| Phase 4 TDD checklist (tribunal-checklists.ts) | 是 | INT-20 |
| `renderRetrospectiveDataMarkdown` TDD section (retrospective-data.ts 190-201) | 是 | INT-23 |

---

## 负面测试汇总

| 测试 ID | 负面场景 | 预期拒绝原因 |
|---------|---------|-------------|
| INT-2 | RED 阶段包含实现文件 | RED_VALIDATION_FAILED |
| INT-3 | RED 阶段测试全通过 | TESTS_PASS_NOT_RED |
| INT-4 | 非 Phase 3 调用 RED | INVALID_PHASE |
| INT-5 | tdd=false 调用 RED | TDD_NOT_ENABLED |
| INT-6 | 重复调用 RED | TASK_ALREADY_CONFIRMED |
| INT-7 | staged 实现文件绕过 | RED_VALIDATION_FAILED |
| INT-8 | 不支持的语言 | NO_TEST_COMMAND |
| INT-10 | GREEN 在 RED 之前 | NOT_RED_CONFIRMED |
| INT-11 | GREEN 时测试仍失败 | TESTS_STILL_FAILING |
| INT-12 | tdd=false 调用 GREEN | TDD_NOT_ENABLED |
| INT-13 | RED 未记录 testFiles | NO_TEST_FILES |
| INT-15 | Checkpoint 无 RED+GREEN | TDD_GATE_INCOMPLETE |
| INT-16 | Checkpoint 仅 RED | TDD_GATE_INCOMPLETE |

---

## 实现注意事项

### handler 调用方式

MCP server.tool 注册的 handler 不能直接 import 调用。需要以下策略之一：

**方案 A（推荐）**: 将 handler 核心逻辑提取为可测试函数，handler 仅作薄壳。但改动量大。

**方案 B**: 通过 MCP Client 发起 tool call。需要启动 server 进程。

**方案 C（务实选择）**: 直接 mock StateManager 和 child_process，重新组装 handler 内部逻辑做集成验证。由于 handler 逻辑已经写在 index.ts 中，可以：
1. 创建真实临时目录 + state.json
2. Mock `child_process.execFile` 控制 git/test 输出
3. Import StateManager 直接调用 loadAndValidate / atomicUpdate
4. 在测试中复现 handler 的判断链路

**方案 D（最佳实践）**: 使用 `@modelcontextprotocol/sdk` 的 in-process Client 连接 server，通过 `client.callTool()` 发起真实 tool call。这是最接近真实调用的方式。

### 临时目录管理

每个测试用例使用 `mkdtemp` 创建独立临时目录，`afterEach` 中 `rm -rf` 清理，确保测试隔离。
