# E2E Test Cases: robust-phase-progression

> 日期：2026-04-02
> 语言：TypeScript/Vitest
> 测试类型：全部为 UNIT（vitest 单元测试）
> 集成入口规则：至少一个测试从 `computeNextTask()` 入口调用，以满足"组件正确 != 集成正确"约束

## 重要说明：AC 编号差异

`acceptance-criteria.json` 中的 AC 编号（AC-1 ~ AC-17）与 `orchestrator.test.ts` 中的测试函数标签所用的 AC 编号**不一致**。测试文件使用了自身迭代历史中的内部编号（如测试函数 `"AC-5"` 对应的是 effort_exhausted 逻辑，而 acceptance-criteria.json 的 AC-5 描述的是 revision 循环上限）。

本文档所有绑定关系**按功能行为映射**，而非按标签匹配。阅读时请以本文档的 TC-N↔AC-N 对应表为准，不要直接用 acceptance-criteria.json 的 AC 编号去搜索测试文件中的函数名。

---

## TC-1: [AC-1] worktree 模式下 git diff 使用 worktreeRoot 作为 cwd

- **类型**: UNIT
- **测试文件**: `mcp/src/__tests__/worktree-integration.test.ts`
- **测试函数**: `"AC-1: with worktreeRoot set, git diff runs with worktreeRoot as cwd"`
- **所属 describe**: `"AC-1: worktree isolation — effectiveRoot routing in computeNextTask"`
- **集成入口**: `computeNextTask("/tmp/test-project", "test-topic")` (满足入口规则)
- **前置条件**:
  - state.json 中设置 `worktreeRoot = "/tmp/.auto-dev-wt-test-topic"`
  - step = "3", stepIteration = 0
  - `mockExecFile` 配置：git diff 返回 "some changes\n"，其余 shell 调用成功
- **测试步骤**:
  1. 构造带 `worktreeRoot` 的 state
  2. 调用 `computeNextTask("/tmp/test-project", "test-topic")`
  3. 捕获所有 `execFile("sh", ["-c", cmd], { cwd })` 的调用记录
- **预期结果**: 包含 `git diff` 的 shell 调用，其 `cwd` 字段等于 `"/tmp/.auto-dev-wt-test-topic"`
- **验证方式**:
  ```typescript
  const diffCall = shellCalls.find(c => c.cmd.includes("git diff"));
  expect(diffCall?.cwd).toBe(worktreeRoot);
  ```

---

## TC-2: [AC-2] auto_dev_complete 将 worktree 分支合并并清理目录

- **类型**: UNIT
- **测试文件**: `mcp/src/__tests__/worktree-integration.test.ts`
- **测试函数**: `"AC-2: auto_dev_complete calls git merge then git worktree remove"`
- **所属 describe**: `"AC-2: auto_dev_complete worktree merge and cleanup"`
- **集成入口**: `computeNextTask` 推进到 step 完成 + 验证 `auto_dev_complete` 内的 shell 调用序列
- **前置条件**:
  - state.json 中设置 `worktreeRoot`, `worktreeBranch = "auto-dev/test-topic"`, `sourceBranch = "main"`
  - `mockExecFile` 配置：所有 git 命令（add, commit, merge, worktree remove）成功
- **测试步骤**:
  1. 构造带 worktree 字段的 state
  2. 调用 `auto_dev_complete` handler（或调用 `computeNextTask` 并验证 complete 触发的 shell 序列）
  3. 捕获所有 shell 调用记录
- **预期结果**:
  1. 存在 `git add -A && git commit` 调用（在 worktreeRoot cwd 中）
  2. 存在 `git merge auto-dev/test-topic` 调用（在 projectRoot cwd 中）
  3. 存在 `git worktree remove` 调用（清理 worktreeRoot）
  4. 调用顺序：commit → merge → remove
- **验证方式**:
  ```typescript
  const commitCall = shellCalls.find(c => c.cmd.includes("git add") && c.cwd === worktreeRoot);
  const mergeCall = shellCalls.find(c => c.cmd.includes("git merge") && c.cwd === projectRoot);
  const removeCall = shellCalls.find(c => c.cmd.includes("git worktree remove"));
  expect(commitCall).toBeDefined();
  expect(mergeCall).toBeDefined();
  expect(removeCall).toBeDefined();
  const commitIdx = shellCalls.indexOf(commitCall!);
  const mergeIdx = shellCalls.indexOf(mergeCall!);
  const removeIdx = shellCalls.indexOf(removeCall!);
  expect(commitIdx).toBeLessThan(mergeIdx);
  expect(mergeIdx).toBeLessThan(removeIdx);
  ```
- **注意**: AC-2 测试 `auto_dev_complete` 在 `index.ts` 中的 handler，当前 `worktree-integration.test.ts` 未覆盖此 handler，需要新增 describe 块

---

## TC-3: [AC-3] tribunal 的 evaluateTribunal 接收 worktreeRoot 作为 projectRoot

- **类型**: UNIT
- **测试文件**: `mcp/src/__tests__/worktree-integration.test.ts`
- **测试函数**: `"AC-3: evaluateTribunal is called with worktreeRoot as projectRoot when worktree active"`
- **所属 describe**: `"AC-3: tribunal uses effectiveRoot (worktreeRoot)"`
- **集成入口**: `validateStep("4a", ..., worktreeRoot, ...)` 直接调用
- **前置条件**:
  - `worktreeRoot = "/tmp/.auto-dev-wt-test-topic"`
  - state 设置 `phase: 4, step: "4a"`
  - `mockEvaluateTribunal` 返回 `{ verdict: "PASS", issues: [] }`
  - build/test mock 返回成功
- **测试步骤**:
  1. 以 `worktreeRoot` 作为 `projectRoot` 参数调用 `validateStep("4a", ...)`
  2. 捕获 `evaluateTribunal` 的调用参数
- **预期结果**: `evaluateTribunal` 的第一个参数为 `worktreeRoot`（不是 `projectRoot`）
- **验证方式**:
  ```typescript
  expect(mockEvaluateTribunal).toHaveBeenCalledWith(
    worktreeRoot,
    expect.any(String),
    expect.any(Number),
    expect.any(String),
    expect.any(String),
    expect.anything(),
  );
  ```

---

## TC-4: [AC-4] worktree 模式下 baseline 检查用 git worktree add --detach，不用 git stash

- **类型**: UNIT
- **测试文件**: `mcp/src/__tests__/worktree-integration.test.ts`
- **测试函数**: `"AC-4: when worktreeRoot set and build fails, calls 'git worktree add --detach' not 'git stash'"`
- **所属 describe**: `"AC-4: checkBuildWithBaseline uses worktree baseline, not git stash"`
- **集成入口**: `validateStep("3", ...)` 直接调用
- **前置条件**:
  - `worktreeRoot = "/tmp/.auto-dev-wt-test-topic"`, `startCommit = "abc123"`
  - build 命令失败（触发 baseline 检查）
  - `git worktree add/remove` 成功
- **测试步骤**:
  1. 以 worktreeRoot 调用 `validateStep("3", ..., worktreeRoot, "npm run build", ...)`
  2. 捕获所有 shell 调用
- **预期结果**:
  1. 存在 `git worktree add --detach` 调用
  2. 不存在 `git stash` 调用
- **验证方式**:
  ```typescript
  const worktreeAddCall = shellCalls.find(c => c.cmd.includes("git worktree add") && c.cmd.includes("--detach"));
  const stashCall = shellCalls.find(c => c.cmd.includes("git stash"));
  expect(worktreeAddCall).toBeDefined();
  expect(stashCall).toBeUndefined();
  ```
- **负面测试**: TC-4b — 无 worktreeRoot 时使用 git stash（已有测试验证）

---

## TC-5: [AC-5] Revision 循环超过 maxRevisionCycles 后返回 BLOCKED

- **类型**: UNIT
- **测试文件**: `mcp/src/__tests__/orchestrator.test.ts`
- **测试函数**: `"AC-6: returns revision_cycles_exhausted when revisionCycles >= 2 on 1c→1b transition"`
- **所属 describe**: `"AC-6: revision_cycles_exhausted escalation (advanceToNextStep)"`
- **集成入口**: `computeNextTask("/tmp/test-project", "test-topic")` (满足入口规则)
- **前置条件**:
  - mode: "full", step: "1c", stepIteration: 0
  - `stepEffort["1b"] = { totalAttempts: 2, revisionCycles: 1, tribunalAttempts: 0 }`（即将进入第 2 轮，达到上限）
  - design.md 返回有效内容（使 1c validateStep 通过，触发 advanceToNextStep 1c→1b 路径）
- **测试步骤**:
  1. 构造上述 state，调用 `computeNextTask`
  2. validateStep("1c") 通过（design.md 内容哈希不同于记录值）
  3. advanceToNextStep 发现 revisionCycles 达到上限
- **预期结果**:
  - `result.escalation.reason === "revision_cycles_exhausted"`
  - `result.prompt === null`
  - `result.done === false`
- **验证方式**:
  ```typescript
  expect(result.escalation!.reason).toBe("revision_cycles_exhausted");
  expect(result.prompt).toBeNull();
  ```

---

## TC-6: [AC-6] Revision step 1c 在产物无变化时返回 passed=false

- **类型**: UNIT
- **测试文件**: `mcp/src/__tests__/orchestrator.test.ts`
- **测试函数**: `"AC-7: validateStep('1c') returns passed=false when design.md hash unchanged"`
- **所属 describe**: `"AC-7: validateStep hash-based change detection"`
- **集成入口**: `validateStep("1c", ...)` 直接调用（组件级）
- **前置条件**:
  - `state.lastArtifactHashes["design.md"]` 与 design.md 当前内容哈希相同
- **测试步骤**:
  1. 设置 `lastArtifactHashes["design.md"]` 为已知哈希值
  2. mockReadFile 返回对应哈希的 design.md 内容
  3. 调用 `validateStep("1c", ...)`
- **预期结果**: `result.passed === false`，feedback 包含"没有变化"
- **验证方式**:
  ```typescript
  expect(result.passed).toBe(false);
  // feedback should mention no changes
  ```
- **负面测试**: TC-6b — 2c 的 plan.md 缺失时也返回 passed=false

---

## TC-7: [AC-6] Revision step 5c 使用进入 5c 前记录的测试文件聚合 hash 进行比对

- **类型**: UNIT
- **测试文件**: `mcp/src/__tests__/orchestrator.test.ts`
- **测试函数**: `"AC-7: validateStep('5c') fails when tests fail"`
- **所属 describe**: `"AC-7: validateStep hash-based change detection"`
- **集成入口**: `validateStep("5c", ...)` 直接调用（组件级）
- **前置条件**:
  - `state.lastArtifactHashes["test-files"]` 设置为某个 hash 值
  - `git ls-files` 返回测试文件列表（使计算的当前 hash 与存储值不同）
  - npm test 失败
- **测试步骤**:
  1. 配置 state 的 `lastArtifactHashes["test-files"]` 为 "differenthash1234"
  2. mockExecFile: git ls-files 返回测试文件名，npm test 失败
  3. 调用 `validateStep("5c", ...)`
- **预期结果**: `result.passed === false`（hash 不同则进入测试阶段，测试失败导致 passed=false）
- **验证方式**:
  ```typescript
  expect(result.passed).toBe(false);
  ```
- **针对 AC-17 的补充**：专门测试 hash 不变时（"test-files" hash 与当前相同）应返回 passed=false + feedback="测试文件没有变化"

---

## TC-8: [AC-7] Phase 3 在 git diff 为空时返回 passed=false

- **类型**: UNIT
- **测试文件**: `mcp/src/__tests__/orchestrator.test.ts`
- **测试函数**: `"AC-8: validateStep('3') returns passed=false when git diff is empty (no changes)"`
- **所属 describe**: `"AC-8: Phase 3 idling detection"`
- **集成入口**: `validateStep("3", ...)` 直接调用（组件级）
- **前置条件**:
  - `state.startCommit = "abc123"`
  - `git diff --stat {startCommit} -- . ':!docs/'` 返回空 stdout（exitCode=0）
- **测试步骤**:
  1. mockExecFile: git diff 命令返回空字符串
  2. 调用 `validateStep("3", ..., state, ...)`
- **预期结果**: `result.passed === false`，feedback 包含"未检测到代码变更"或"git diff 为空"
- **验证方式**:
  ```typescript
  expect(result.passed).toBe(false);
  expect(result.feedback).toContain("git diff");
  ```
- **负面测试**: TC-8b — git diff 有输出时 validateStep("3") 继续 build/test 流程（不返回早期 false）

---

## TC-9: [AC-8] totalAttempts >= 6 时返回 effort_exhausted escalation

- **类型**: UNIT
- **测试文件**: `mcp/src/__tests__/orchestrator.test.ts`
- **测试函数**: `"AC-5: returns effort_exhausted escalation when totalAttempts >= 6"`
- **所属 describe**: `"AC-5: effort_exhausted escalation (handleValidationFailure)"`
- **集成入口**: `computeNextTask("/tmp/test-project", "test-topic")` (满足入口规则)
- **前置条件**:
  - mode: "turbo", step: "3", stepIteration: 0
  - `stepEffort["3"] = { totalAttempts: 6, revisionCycles: 0, tribunalAttempts: 0 }`
  - build 失败（触发 handleValidationFailure）
- **测试步骤**:
  1. 构造 state 并调用 `computeNextTask`
  2. validateStep("3") 因 build 失败返回 passed=false
  3. handleValidationFailure 检查 totalAttempts >= 6
- **预期结果**:
  - `result.escalation.reason === "effort_exhausted"`
  - `result.prompt === null`
  - atomicUpdate 中 status 变为 "BLOCKED"
- **验证方式**:
  ```typescript
  expect(result.escalation!.reason).toBe("effort_exhausted");
  expect(result.prompt).toBeNull();
  ```
- **负面测试**: TC-9b — totalAttempts=5 时不触发 effort_exhausted

---

## TC-10: [AC-9] design.md 缺失时阻止 step 2a 执行，返回 prerequisite_missing

- **类型**: UNIT
- **测试文件**: `mcp/src/__tests__/orchestrator.test.ts`
- **测试函数**: `"AC-9: computeNextTask returns prerequisite_missing escalation when design.md missing for step 2a"`
- **所属 describe**: `"AC-9: prerequisite_missing escalation (checkPrerequisites)"`
- **集成入口**: `computeNextTask("/tmp/test-project", "test-topic")` (满足入口规则)
- **前置条件**:
  - mode: "full", step: "2a", stepIteration: 0
  - `stat` 对 design.md 路径抛出 ENOENT（文件不存在）
- **测试步骤**:
  1. 构造 state，mockStat 返回 ENOENT
  2. 调用 `computeNextTask`
  3. checkPrerequisites("2a") 发现 design.md 缺失
- **预期结果**:
  - `result.escalation.reason === "prerequisite_missing"`
  - `result.prompt === null`
  - escalation.lastFeedback 包含"design.md"或"前置产物缺失"
- **验证方式**:
  ```typescript
  expect(result.escalation!.reason).toBe("prerequisite_missing");
  expect(result.prompt).toBeNull();
  ```
- **组件级补充**: TC-10b — 直接调用 `checkPrerequisites("2a", "/tmp/output")`，验证 `{ ok: false, missing: ["design.md"] }`

---

## TC-11: [AC-10] useWorktree=false 模式下 computeNextTask 正常运行

- **类型**: UNIT
- **测试文件**: `mcp/src/__tests__/worktree-integration.test.ts`
- **测试函数**: `"AC-10: computeNextTask with no worktreeRoot resolves initial step without error"`
- **所属 describe**: `"AC-10: useWorktree=false mode — step loop works normally"`
- **集成入口**: `computeNextTask("/tmp/test-project", "test-topic")` (满足入口规则)
- **前置条件**:
  - state 中**没有** `worktreeRoot` 字段（模拟 --no-worktree 模式）
  - step: null, phase: 3
- **测试步骤**:
  1. 构造不含 worktreeRoot 的 state
  2. 调用 `computeNextTask`
- **预期结果**:
  - `result.done === false`
  - `result.step !== null`（正常返回了下一个 step）
  - 无异常抛出
- **验证方式**:
  ```typescript
  expect(result.done).toBe(false);
  expect(result.step).not.toBeNull();
  ```

---

## TC-12: [AC-11] 旧 state.json（不含 worktreeRoot/stepEffort）不 crash，正常推进

- **类型**: UNIT
- **测试文件**: `mcp/src/__tests__/worktree-integration.test.ts`
- **测试函数**: `"AC-11: computeNextTask with legacy state (no worktreeRoot/stepEffort) does not crash"`
- **所属 describe**: `"AC-11: backward compatibility — old state.json without worktreeRoot/stepEffort"`
- **集成入口**: `computeNextTask("/tmp/test-project", "test-topic")` (满足入口规则)
- **前置条件**:
  - legacyState 不含 `worktreeRoot`、`worktreeBranch`、`sourceBranch`、`stepEffort`、`lastArtifactHashes` 字段
  - step: null, phase: 3
- **测试步骤**:
  1. 构造 legacyState 并调用 `computeNextTask`
- **预期结果**:
  - 无 TypeError/undefined 异常抛出
  - `result.done === false`
  - 使用 `projectRoot` 作为 effectiveRoot（fallback 行为）
- **验证方式**:
  ```typescript
  const result = await computeNextTask("/tmp/test-project", "test-topic");
  expect(result).toBeDefined();
  expect(result.done).toBe(false);
  ```

---

## TC-13: [AC-12] 会话中断后 resume，worktree 仍存在时直接复用

- **类型**: UNIT
- **测试文件**: `mcp/src/__tests__/worktree-integration.test.ts`
- **测试函数**: `"AC-12: resume reuses existing worktree when worktreeRoot dir still exists"`
- **所属 describe**: `"AC-12: worktree resume — reuse or rebuild"`
- **集成入口**: 调用 `auto_dev_init` handler（onConflict="resume" 路径）
- **前置条件**:
  - state.json 已有 `worktreeRoot = "/tmp/.auto-dev-wt-test-topic"`
  - `stat(worktreeRoot)` 成功（目录存在）
  - `git branch --show-current` 返回正确分支名
- **测试步骤**:
  1. 模拟 resume 路径（state 已存在，onConflict="resume"）
  2. 调用 `auto_dev_init` handler
  3. 捕获 shell 调用记录
- **预期结果**:
  - 不调用 `git worktree add`（不重建）
  - state.worktreeRoot 保持不变
- **验证方式**:
  ```typescript
  const addCall = shellCalls.find(c => c.cmd.includes("git worktree add") && !c.cmd.includes("--detach"));
  expect(addCall).toBeUndefined();
  ```
- **注意**: 此测试需要新增（当前 worktree-integration.test.ts 未覆盖 AC-12）

---

## TC-14: [AC-12] 会话中断后 resume，worktree 被删时从分支重建

- **类型**: UNIT
- **测试文件**: `mcp/src/__tests__/worktree-integration.test.ts`
- **测试函数**: `"AC-12: resume rebuilds worktree from branch when worktreeRoot dir deleted"`
- **所属 describe**: `"AC-12: worktree resume — reuse or rebuild"`
- **集成入口**: 调用 `auto_dev_init` handler（onConflict="resume" 路径）
- **前置条件**:
  - state.json 已有 `worktreeRoot`，但 `stat(worktreeRoot)` 抛出 ENOENT（目录不存在）
  - `git branch --list auto-dev/test-topic` 返回分支名（分支还在）
  - `git worktree add {worktreeRoot} auto-dev/test-topic` 成功
- **测试步骤**:
  1. `stat` mock 返回 ENOENT（worktree 被删）
  2. 调用 auto_dev_init（resume 路径）
  3. 捕获 shell 调用
- **预期结果**:
  - 调用了 `git worktree add` 重建 worktree
  - 重建后 state.worktreeRoot 未被清空
- **验证方式**:
  ```typescript
  const addCall = shellCalls.find(c => c.cmd.includes("git worktree add") && c.cmd.includes("auto-dev/test-topic"));
  expect(addCall).toBeDefined();
  ```
- **注意**: 此测试需要新增

---

## TC-15: [AC-13] Phase 4a 首次执行无 feedback 时返回 agent=null、prompt=null

- **类型**: UNIT
- **测试文件**: `mcp/src/__tests__/orchestrator.test.ts`
- **测试函数**: `"AC-13: computeNextTask advances to 4a with null prompt when step=3 passes in quick mode"`
- **所属 describe**: `"AC-13: buildTaskForStep 4a returns null when feedback is empty"`
- **集成入口**: `computeNextTask("/tmp/test-project", "test-topic")` (满足入口规则)
- **前置条件**:
  - mode: "quick", step: "3", stepIteration: 0
  - build + test 通过（step 3 验证 passed）
  - 无 lastValidation（无 feedback 传入 4a）
- **测试步骤**:
  1. step 3 验证通过 → advanceToNextStep → step 变为 "4a"
  2. buildTaskForStep("4a", ..., feedback="") 被调用
- **预期结果**:
  - `result.step === "4a"`
  - `result.prompt === null`
  - `result.agent === null`
- **验证方式**:
  ```typescript
  expect(result.step).toBe("4a");
  expect(result.prompt).toBeNull();
  expect(result.agent).toBeNull();
  ```
- **组件级补充**: TC-15b — 直接调用 `buildTaskForStep("4a", ..., undefined)` 返回 null

---

## TC-16: [AC-14] Revision prompt 使用 markdown 标题格式，包含"## 修订任务"和"## 审查反馈"

- **类型**: UNIT
- **测试文件**: `mcp/src/__tests__/orchestrator.test.ts` + `mcp/src/__tests__/orchestrator-prompts.test.ts`
- **测试函数**:
  - `"AC-17: buildTaskForStep('1c') revision prompt contains ## 审查反馈（必须逐条回应）"` (orchestrator.test.ts)
  - `"uses markdown section headers in new format"` (orchestrator-prompts.test.ts)
- **所属 describe**:
  - `"AC-17: buildRevisionPrompt markdown section format"` (orchestrator.test.ts)
  - `"buildRevisionPrompt"` (orchestrator-prompts.test.ts)
- **集成入口**: `buildTaskForStep("1c", ...)` 直接调用（组件级）
- **前置条件**:
  - feedback = "缺少输入校验逻辑"（非空）
  - mockStat 成功
- **测试步骤**:
  1. 调用 `buildTaskForStep("1c", "/tmp/output", ..., feedback="缺少输入校验逻辑")`
  2. 检查返回字符串内容
- **预期结果**:
  - 包含 `"## 修订任务"`
  - 包含 `"## 审查反馈（必须逐条回应）"`
  - 包含 feedback 内容 "缺少输入校验逻辑"
- **验证方式**:
  ```typescript
  expect(result).toContain("## 审查反馈（必须逐条回应）");
  expect(result).toContain("缺少输入校验逻辑");
  ```

---

## TC-17: [AC-14] stepEffort.totalAttempts=2 时 revision prompt 包含"第 3 次尝试"和失败原因摘要

- **类型**: UNIT
- **测试文件**: `mcp/src/__tests__/orchestrator-prompts.test.ts`
- **测试函数**: `"includes step id and attempt count"` + 新增专项测试
- **所属 describe**: `"buildPreviousAttemptSummary"`
- **集成入口**: `buildPreviousAttemptSummary` 直接调用（组件级）
- **前置条件**:
  - stepId = "1b"
  - effort = `{ totalAttempts: 2, revisionCycles: 1, tribunalAttempts: 0 }`
  - currentFeedback = "编译失败：找不到模块 X"
- **测试步骤**:
  1. 调用 `buildPreviousAttemptSummary("1b", effort, "编译失败：找不到模块 X")`
  2. 检查返回字符串
- **预期结果**:
  - 包含"第 3 次尝试"（totalAttempts+1=3）
  - 包含失败原因摘要（"编译失败"）
  - 包含"不要重复之前失败的方向"之类提示
- **验证方式**:
  ```typescript
  expect(result).toContain("3");
  expect(result).toContain("编译失败");
  ```

---

## TC-18: [AC-15] Phase 3 的 scoped_prompt 包含完整 task 描述和设计目标摘要，标注"不需要再读 plan.md"

- **类型**: UNIT
- **测试文件**: `mcp/src/__tests__/orchestrator.test.ts`
- **测试函数**: `"AC-15: buildTaskForStep('3') prompt contains '不需要再读 plan.md' when design.md exists"`
- **所属 describe**: `"AC-15: Phase 3 prompt embeds design.md context"`
- **集成入口**: `buildTaskForStep("3", ...)` 直接调用（组件级）
- **前置条件**:
  - plan.md 内容：包含 Task 描述
  - design.md 内容：包含 "## 概述" 段落（用于提取设计目标摘要）
- **测试步骤**:
  1. mockReadFile 返回 plan.md 和 design.md
  2. 调用 `buildTaskForStep("3", "/tmp/output", ...)`
- **预期结果**:
  - 返回的 prompt 包含 `"不需要再读 plan.md"`
  - 包含 design.md 中的摘要内容（"这是设计摘要"）
- **验证方式**:
  ```typescript
  expect(result).toContain("不需要再读 plan.md");
  expect(result).toContain("这是设计摘要");
  ```

---

## TC-19: [AC-16] worktree 仍存在时 validateStep("8a") 返回 passed=false，feedback 含"auto_dev_complete"

- **类型**: UNIT
- **测试文件**: `mcp/src/__tests__/worktree-integration.test.ts`
- **测试函数**: `"AC-16: validateStep('8a') returns passed=false when worktreeRoot is non-null"`
- **所属 describe**: `"AC-16: validateStep('8a') blocked when worktreeRoot is set"`
- **集成入口**: `validateStep("8a", ...)` 直接调用（组件级）
- **前置条件**:
  - `worktreeRoot = "/tmp/.auto-dev-wt-test-topic"`（非 null）
  - state 中 `worktreeRoot` 已设置
- **测试步骤**:
  1. 调用 `validateStep("8a", ..., worktreeRoot, ..., state_with_worktreeRoot, ...)`
- **预期结果**:
  - `result.passed === false`
  - `result.feedback` 包含关键词 `"auto_dev_complete"`
- **验证方式**:
  ```typescript
  expect(result.passed).toBe(false);
  expect(result.feedback).toContain("auto_dev_complete");
  ```
- **负面测试**: TC-19b — worktreeRoot 为 null 时 validateStep("8a") 正常验证 git push 状态

---

## TC-20: [AC-17] 5c 的 delta check 使用 lastArtifactHashes["test-files"]，未修改时返回 passed=false

- **类型**: UNIT
- **测试文件**: `mcp/src/__tests__/orchestrator.test.ts`
- **测试函数**: `"AC-7: validateStep('5c') fails when tests fail"` + 新增 hash 不变专项
- **所属 describe**: `"AC-7: validateStep hash-based change detection"`
- **集成入口**: `validateStep("5c", ...)` 直接调用（组件级）

**子用例 20a：测试文件 hash 未变化 → passed=false**

- **前置条件**:
  - `state.lastArtifactHashes["test-files"] = "aabbccdd11223344"`
  - `git ls-files` 返回测试文件列表，当前聚合 hash 计算结果等于 "aabbccdd11223344"
- **测试步骤**:
  1. 配置 mockExecFile：git ls-files 返回固定文件列表，readFile 对各测试文件返回固定内容
  2. 调用 `validateStep("5c", ..., state, ...)`
- **预期结果**: `result.passed === false`，feedback 包含"测试文件没有变化"
- **验证方式**:
  ```typescript
  expect(result.passed).toBe(false);
  expect(result.feedback).toContain("没有变化");
  ```

**子用例 20b：测试文件 hash 已变化，但 npm test 失败 → passed=false**

- **前置条件**: 旧 hash 与当前不同，npm test 返回非零退出码
- **预期结果**: `result.passed === false`（测试未通过）

**子用例 20c：测试文件 hash 已变化，npm test 通过 → passed=true**

- **前置条件**: 旧 hash 与当前不同，npm test 返回零退出码
- **预期结果**: `result.passed === true`

---

## 集成入口验证

按"组件正确 != 集成正确"原则，以下测试用例通过 `computeNextTask()` 入口进行集成级验证：

| TC | 集成入口 | 覆盖的关键路径 |
|----|---------|--------------|
| TC-1 | computeNextTask | effectiveRoot → git diff cwd |
| TC-5 | computeNextTask | advanceToNextStep → revision_cycles_exhausted |
| TC-9 | computeNextTask | handleValidationFailure → effort_exhausted |
| TC-10 | computeNextTask | checkPrerequisites → prerequisite_missing escalation |
| TC-11 | computeNextTask | no worktreeRoot → 正常推进（不 crash） |
| TC-12 | computeNextTask | legacyState → fallback 行为 |
| TC-15 | computeNextTask | step 3 pass → 4a with null prompt/agent |

---

## AC 绑定矩阵

| AC | 描述（摘要） | 绑定测试 | 测试文件 |
|----|-------------|---------|---------|
| AC-1 | worktree 隔离：git diff 在 worktreeRoot 执行 | TC-1 | worktree-integration.test.ts |
| AC-2 | auto_dev_complete 合并分支并清理 worktree | TC-2 | worktree-integration.test.ts（需新增） |
| AC-3 | tribunal git diff 只包含 worktree 的修改 | TC-3 | worktree-integration.test.ts |
| AC-4 | checkBuildWithBaseline 用临时 worktree，不用 git stash | TC-4 | worktree-integration.test.ts |
| AC-5 | Revision 循环最多 maxRevisionCycles(2) 轮后 BLOCKED | TC-5 | orchestrator.test.ts |
| AC-6 | 1c/2c hash delta 检查；5c 用 test-files 聚合 hash | TC-6, TC-7 | orchestrator.test.ts |
| AC-7 | Phase 3 无代码变更时 passed=false | TC-8 | orchestrator.test.ts |
| AC-8 | totalAttempts >= 6 返回 effort_exhausted BLOCKED | TC-9 | orchestrator.test.ts |
| AC-9 | design.md 缺失时 step 2a 返回 prerequisite_missing | TC-10 | orchestrator.test.ts |
| AC-10 | --no-worktree 模式功能正常（向后兼容） | TC-11 | worktree-integration.test.ts |
| AC-11 | 旧 state.json 不 crash，fallback 正常 | TC-12 | worktree-integration.test.ts |
| AC-12 | resume 时 worktree 仍存在则复用，被删则重建 | TC-13, TC-14 | worktree-integration.test.ts（需新增） |
| AC-13 | Phase 4a 首次无 feedback 时 agent=null、prompt=null | TC-15 | orchestrator.test.ts |
| AC-14 | Revision prompt 含 markdown 标题 + previousAttemptSummary | TC-16, TC-17 | orchestrator.test.ts + orchestrator-prompts.test.ts |
| AC-15 | Phase 3 scoped_prompt 内嵌 task 上下文，标注"不需要再读 plan.md" | TC-18 | orchestrator.test.ts |
| AC-16 | Phase 8 validateStep 检查 worktreeRoot 是否已清空 | TC-19 | worktree-integration.test.ts |
| AC-17 | 5c delta check 用进入 5c 前的 test-files hash | TC-20 | orchestrator.test.ts |

---

## 覆盖缺口说明

以下 AC 对应的测试需要新增（当前实现代码已完成，但 worktree-integration.test.ts 中尚无对应测试）：

| AC | 缺口描述 | 建议新增位置 |
|----|---------|------------|
| AC-2 | auto_dev_complete handler 的 merge+cleanup 序列 | worktree-integration.test.ts，新增 describe "AC-2" |
| AC-12 | resume 路径的 worktree 复用和重建 | worktree-integration.test.ts，新增 describe "AC-12" |

AC-2 和 AC-12 测试需要 mock `index.ts` 中的 `auto_dev_init`/`auto_dev_complete` handler，或通过 shell call 拦截验证 git 命令序列。

---

## 测试隔离保证

所有测试用例：
1. 使用 `vi.clearAllMocks()` 在 `beforeEach` 中重置所有 mock
2. 不依赖文件系统（通过 `mockReadFile`/`mockStat`/`mockWriteFile` mock 所有 fs 操作）
3. 不依赖真实 git 仓库（通过 `mockExecFile` mock 所有 shell 调用）
4. 每个测试用例独立构造 state，不共享可变状态
