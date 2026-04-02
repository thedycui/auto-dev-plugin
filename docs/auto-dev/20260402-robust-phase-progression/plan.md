# Implementation Plan: robust-phase-progression

> 基于设计文档：`docs/auto-dev/20260402-robust-phase-progression/design.md`
> 策略：先修复编排缺陷（P0/P1），后引入 Git Worktree 隔离

---

## Task 1: 扩展 types.ts 数据模型

- **描述**: 在 `types.ts` 中新增以下字段定义，为后续所有任务提供类型基础：
  - `StepEffortSchema`（`totalAttempts`、`revisionCycles`、`tribunalAttempts`）
  - `StateJsonSchema` 新增可选字段：`stepEffort`、`lastArtifactHashes`、`worktreeRoot`、`worktreeBranch`、`sourceBranch`
  - 导出 `StepEffort` 类型
  - 新增 `EFFORT_LIMITS` 常量（`maxTotalAttempts: 6`、`maxRevisionCycles: 2`、`maxTribunalAttempts: 3`）
  - 新增 `REVISION_TO_REVIEW` 映射（`{ "1c": "1b", "2c": "2b", "5c": "5b" }`）
- **文件**:
  - `mcp/src/types.ts`
- **依赖**: 无
- **完成标准**: `StateJsonSchema.parse({})` 不报错；`StepEffortSchema.parse({})` 返回默认值 `{ totalAttempts: 0, revisionCycles: 0, tribunalAttempts: 0 }`；TypeScript 编译无报错

---

## Task 2: state-manager.ts — StepEffort 合并与工具函数

- **描述**: 在 `state-manager.ts` 中：
  - 在 `atomicUpdate` 中支持 `stepEffort` 字段的深度合并（按 key 合并，而非整体覆盖）
  - 新增 `effortKeyForStep(step: string): string` 工具函数（revision→parent 映射）
  - 新增 `hashContent(content: string | null): string` 工具函数（SHA-256 前16字符）
  - 验证 `worktreeRoot` 等新增字段在 `atomicUpdate` 中可正常持久化
- **文件**:
  - `mcp/src/state-manager.ts`
- **依赖**: Task 1
- **完成标准**: `effortKeyForStep("1c")` 返回 `"1b"`；`effortKeyForStep("3")` 返回 `"3"`；`hashContent(null)` 返回 `""`；`hashContent("abc")` 返回16位十六进制字符串；`atomicUpdate({ stepEffort: { "1b": { totalAttempts: 2, ... } } })` 正确合并到 state 文件

---

## Task 3: orchestrator.ts — StepEffort 预算检查与更新

- **描述**: 在 `orchestrator.ts` 的 `handleValidationFailure` 函数中：
  - 函数开头加入 `effortKeyForStep` 调用，获取当前 step 的 effort key
  - 从 `state.stepEffort` 读取当前 effort，缺失时使用默认值
  - 在现有逻辑之前新增 effort budget 前置检查（`totalAttempts >= EFFORT_LIMITS.maxTotalAttempts`），超出时返回 `EFFORT_EXHAUSTED` escalation
  - 在验证失败路径（retry/revision）上递增 `effort.totalAttempts`，并通过 `atomicUpdate` 持久化
  - 在 tribunal 失败路径上同时递增 `effort.tribunalAttempts`
- **文件**:
  - `mcp/src/orchestrator.ts`
- **依赖**: Task 1、Task 2
- **完成标准**: TypeScript 编译无报错；在 `state.stepEffort["1b"].totalAttempts = 6` 时调用 `handleValidationFailure`，返回 `escalation.reason === "effort_exhausted"`

---

## Task 4: orchestrator.ts — 修复 advanceToNextStep 的 revision→parent 逻辑（P0-1）

- **描述**: 修改 `advanceToNextStep` 函数中 revision step 回到 parent step 的逻辑（当前在 orchestrator.ts:1608 附近）：
  - 移除无条件 `stepIteration: 0` 重置（这是无限循环根因）
  - 改为从 `state.stepEffort` 读取 parent step 的 effort，递增 `revisionCycles` 和 `totalAttempts`
  - 若 `revisionCycles >= EFFORT_LIMITS.maxRevisionCycles`，返回 `REVISION_CYCLES_EXHAUSTED` escalation（状态设为 BLOCKED）
  - 否则更新 `stepEffort` 并回到 parent（保留 `stepIteration: 0`，但 effort 已记录轮次）
  - 在 progress-log 中追加修订循环记录行
- **文件**:
  - `mcp/src/orchestrator.ts`
- **依赖**: Task 1、Task 2、Task 3
- **完成标准**: TypeScript 编译无报错；模拟 1b→1c→1b→1c→1b（2轮修订）场景，第2轮 1c→1b 时返回 `escalation.reason === "revision_cycles_exhausted"`，不再继续循环

---

## Task 5: orchestrator.ts — 新增 validateStep case "1c"/"2c"/"5c"（P0-2）

- **描述**: 在 `validateStep` 的 switch/case 中新增以下 case（修复当前走 default pass 的问题）：
  - `"1c"`：检查 `design.md` 存在且长度 ≥ 100，并与 `state.lastArtifactHashes["design.md"]` 对比 hash，未变更返回 `passed=false`
  - `"2c"`：检查 `plan.md` 存在，并与 `state.lastArtifactHashes["plan.md"]` 对比 hash，未变更返回 `passed=false`
  - `"5c"`：扫描测试文件列表、计算聚合 hash，与 `state.lastArtifactHashes["test-files"]` 对比；delta 检查通过后运行 `testCmd`，失败返回 `passed=false`
  - 新增 artifact hash 记录时机：
    - step "1a" 通过后：记录 `design.md` hash 到 `atomicUpdate`
    - step "1b" 失败 dispatch 1c 时：记录当前 `design.md` hash（在 `atomicUpdate(step="1c")` 中）
    - step "2a" 通过后：记录 `plan.md` hash
    - step "2b" 失败 dispatch 2c 时：记录当前 `plan.md` hash
    - step "5b" 失败 dispatch 5c 时：扫描测试文件并记录聚合 hash 到 `lastArtifactHashes["test-files"]`
- **文件**:
  - `mcp/src/orchestrator.ts`
- **依赖**: Task 1、Task 2
- **完成标准**: TypeScript 编译无报错；`validateStep("1c", ...)` 在 `design.md` hash 与记录值相同时返回 `{ passed: false }`；修改内容后返回 `{ passed: true }`

---

## Task 6: orchestrator.ts — Phase 3 空转检测 + 前置守卫（P1-1 + P1-3）

- **描述**:
  - **Phase 3 空转检测（P1-1）**：在 `validateStep("3", ...)` 开头，当 `state.startCommit` 存在时执行 `git diff --stat {startCommit} -- . ':!docs/'`，如果输出为空则返回 `passed=false`（附带明确 feedback）
  - **前置守卫（P1-3）**：新增 `STEP_PREREQUISITES` 常量（按设计文档 4.6 节定义）和 `checkPrerequisites(step, outputDir)` 函数；在 `computeNextTask` 的 `validateStep` 调用**之前**插入前置守卫检查，失败时返回 `prerequisite_missing` escalation
- **文件**:
  - `mcp/src/orchestrator.ts`
- **依赖**: Task 1
- **完成标准**: TypeScript 编译无报错；`git diff` 输出为空时 `validateStep("3")` 返回 `passed=false`；`design.md` 不存在时 `checkPrerequisites("2a")` 返回 `{ ok: false, missing: [...] }`；`computeNextTask` 在前置守卫失败时返回 `escalation.reason === "prerequisite_missing"`

---

## Task 7: orchestrator-prompts.ts — buildRevisionPrompt 格式重写 + previousAttemptSummary

- **描述**:
  - 将 `buildRevisionPrompt` 从 `lines.join("\n")` 方式改为 markdown 标题格式（`## 修订任务`、`## 历史尝试`、`## 审查反馈（必须逐条回应）`、`## 待修改文件`）
  - 新增 `previousAttemptSummary?: string` 参数，有值时输出 `## 历史尝试` 段落
  - 新增 `buildPreviousAttemptSummary(stepId, effort, currentFeedback)` 函数
  - 在 `handleValidationFailure` 中构建 revision prompt 时调用 `buildPreviousAttemptSummary` 并传入
  - **同步更新 `orchestrator-prompts.test.ts`**：修改所有对旧格式的断言以匹配新 markdown 格式（在同一 task 中完成，避免测试失败）
- **文件**:
  - `mcp/src/orchestrator-prompts.ts`
  - `mcp/src/orchestrator.ts`（调用侧传入 `previousAttemptSummary`）
  - `mcp/src/__tests__/orchestrator-prompts.test.ts`
- **依赖**: Task 3
- **完成标准**: `buildRevisionPrompt({ originalTask: "x", feedback: "y", artifacts: [] })` 的返回值包含 `## 审查反馈（必须逐条回应）`；传入 `previousAttemptSummary` 时包含 `## 历史尝试`；`npm test -- orchestrator-prompts` 全部通过

---

## Task 8: orchestrator.ts — Token 优化（Phase 4a 空 dispatch + Phase 3 嵌入上下文）

- **描述**:
  - **Phase 4a 空 dispatch（AC-13）**：`buildTaskForStep("4a", ...)` 在 `feedback` 为空时返回 `null`；`computeNextTask` 检测到 `prompt === null` 时返回 `{ agent: null, prompt: null }` 并附带提示信息
  - **Phase 3 嵌入上下文（AC-15）**：在 `buildTaskForStep("3", ...)` 中读取 `plan.md` 全文和 `design.md` 的背景目标段落（正则提取 `## 1. 背景与目标` 段），将其直接嵌入 prompt，并标注"不需要再读 plan.md"
- **文件**:
  - `mcp/src/orchestrator.ts`
- **依赖**: Task 1、Task 6
- **完成标准**: TypeScript 编译无报错；`buildTaskForStep("4a", ..., "")` 返回 `null`；`buildTaskForStep("3", ...)` 的返回字符串包含"不需要再读 plan.md"和 design 目标摘要

---

## Task 9: 单元测试 — 编排逻辑修复（Tasks 3-8）

- **描述**: 在 `mcp/src/__tests__/orchestrator.test.ts` 中新增/修改测试用例，覆盖：
  - **AC-5**：模拟 1b 持续 NEEDS_REVISION，验证第 `maxRevisionCycles` 轮后返回 `revision_cycles_exhausted` escalation
  - **AC-6**：构造未修改的 design.md（hash 一致），调用 `validateStep("1c")`，验证返回 `passed=false`；修改后验证 `passed=true`
  - **AC-7**：mock `git diff` 返回空字符串，验证 `validateStep("3")` 返回 `passed=false`；mock 返回非空时验证 `passed=true`
  - **AC-8**：设置 `stepEffort["1b"].totalAttempts = 6`，调用 `handleValidationFailure`，验证返回 `effort_exhausted`
  - **AC-9**：删除 `design.md`，调用 `checkPrerequisites("2a")`，验证返回 `ok=false`
  - **AC-13**：`step="4a"` 且 `feedback` 为空时，验证 `buildTaskForStep` 返回 `null`，`computeNextTask` 返回 `agent=null`
  - **AC-14**：验证新 revision prompt 格式包含 `## 审查反馈` 标题；`stepEffort.totalAttempts=2` 时 prompt 包含"第 3 次尝试"
  - **AC-15**：验证 `buildTaskForStep("3")` 返回值包含"不需要再读 plan.md"
  - **AC-17**：构造 `lastArtifactHashes["test-files"]` 与当前 hash 相同，验证 `validateStep("5c")` 返回 `passed=false`
- **文件**:
  - `mcp/src/__tests__/orchestrator.test.ts`
- **依赖**: Tasks 3、4、5、6、7、8
- **完成标准**: `npm test -- orchestrator.test` 全部通过；新增测试覆盖 AC-5/6/7/8/9/13/14/15/17

---

## Task 10: index.ts — auto_dev_init worktree 创建与 resume 恢复

- **描述**: 在 `auto_dev_init` MCP tool handler 中：
  - 新增 `useWorktree: z.boolean().optional().default(true)` 参数
  - 新增 `getWorktreeDir(projectRoot, topic)` 和 `getWorktreeBranch(topic)` 工具函数（topic sanitize 逻辑按设计文档 4.1.3）
  - `useWorktree=true` 且 `onConflict !== "resume"` 时：执行 `git worktree add -b {branchName} {wtDir} HEAD`，记录 `worktreeRoot`、`worktreeBranch`、`sourceBranch`（当前分支名）到 `state.json`
  - `onConflict="resume"` 且 `state.worktreeRoot` 存在时：按设计文档 4.1.7 检查 worktree 是否仍存在，存在则复用，不存在则从分支重建，分支也不存在则返回错误
  - `useWorktree=false` 时：跳过 worktree 创建，行为与当前完全一致
  - 依赖安装（`npm install`/`mvn dependency:resolve`）的检测与执行逻辑放置到 worktree 目录中
- **文件**:
  - `mcp/src/index.ts`
- **依赖**: Task 1、Task 2
- **完成标准**: TypeScript 编译无报错；`useWorktree=true` 时 `state.json` 包含 `worktreeRoot`、`worktreeBranch`、`sourceBranch` 字段；`useWorktree=false` 时 state 中无这三个字段；`onConflict="resume"` + worktree 已删除时可从分支重建

---

## Task 11: index.ts — auto_dev_complete worktree 合并与清理

- **描述**: 在 `auto_dev_complete` MCP tool handler 中，在现有完成验证逻辑**之后**（但在 canComplete=true 的路径上）：
  - 检查 `state.worktreeRoot`：若非空，执行以下步骤：
    1. 在 worktree 中执行 `git add -A && git commit -m "auto-dev: {topic}"`（有未提交变更时）
    2. 切回 `state.sourceBranch`（在 `projectRoot` 执行）
    3. `git merge {state.worktreeBranch} --no-ff -m "auto-dev: {topic}"`；若冲突则报告冲突让用户手动处理，不自动解决
    4. `git worktree remove "{state.worktreeRoot}"`
    5. 更新 state：`worktreeRoot = null`（或删除该字段），`sourceBranch` 保留
  - 若 `state.worktreeRoot` 为空（`--no-worktree` 模式），跳过上述步骤
- **文件**:
  - `mcp/src/index.ts`
- **依赖**: Task 10
- **完成标准**: TypeScript 编译无报错；complete 后 `state.json` 中 `worktreeRoot` 为 null；`git worktree list` 不再包含该 worktree；主 working tree 包含 worktree 分支的 commit

---

## Task 12: orchestrator.ts + tribunal.ts — effectiveRoot 透传与 checkBuildWithBaseline 重构

- **描述**:
  - **effectiveRoot 计算**：在 `computeNextTask` 顶部，依据设计文档 4.1.4 计算：
    ```
    effectiveRoot = state.worktreeRoot ?? projectRoot
    effectiveCodeRoot = state.worktreeRoot
      ? (state.codeRoot ? path.join(state.worktreeRoot, path.relative(projectRoot, state.codeRoot)) : state.worktreeRoot)
      : (state.codeRoot ?? projectRoot)
    ```
  - 将现有所有使用 `projectRoot` 做 git 操作（`git diff`、tribunal 调用）的地方替换为 `effectiveRoot`
  - 将现有所有使用 `projectRoot`/`effectiveCodeRoot` 做 build/test 操作的地方替换为新 `effectiveCodeRoot`
  - **checkBuildWithBaseline 重构（worktree 路径）**：当 `state.worktreeRoot` 存在时，用临时 worktree（`git worktree add --detach {baselineDir} {startCommit}`）做 baseline，完成后 `git worktree remove --force`；当 `state.worktreeRoot` 不存在时保留现有 stash 逻辑不变
  - **tribunal.ts**：将接受 `projectRoot` 的位置改为接受 `effectiveRoot` 参数，确保 `git diff startCommit` 在 worktree 路径下执行
  - **Phase 8 守卫（AC-16）**：在 `validateStep("8a", ...)` 开头检查 `state.worktreeRoot`：若非空则返回 `{ passed: false, feedback: "请先调用 auto_dev_complete 完成合并，再执行 Phase 8" }`
- **文件**:
  - `mcp/src/orchestrator.ts`
  - `mcp/src/tribunal.ts`
- **依赖**: Tasks 1、10、11
- **完成标准**: TypeScript 编译无报错；`state.worktreeRoot` 有值时 `checkBuildWithBaseline` 不调用 `git stash`；`validateStep("8a")` 在 `worktreeRoot` 非空时返回 `passed=false`；tribunal 调用使用 `effectiveRoot`；`checkBuildWithBaseline` 在 baseline worktree 中调用依赖安装（`installDepsIfNeeded(baselineDir)`），且在 finally 块中执行 `git worktree remove --force`；在 `skills/auto-dev/SKILL.md` 的 Phase 7 完成节点后添加说明："**必须先调用 `auto_dev_complete` 再推进 Phase 8**"

---

## Task 13: 集成测试 — Worktree 全流程（AC-1/2/3/4/10/11/12）

- **描述**: 在 `mcp/src/__tests__/` 中新增 `worktree-integration.test.ts`（或在 `orchestrator.test.ts` 中新增 worktree describe block），覆盖：
  - **AC-1**：init + `useWorktree=true` 后，主 working tree 创建脏文件，验证 worktree 中不存在；在 worktree 中修改代码，验证主 working tree 不受影响
  - **AC-2**：complete 后验证 `sourceBranch` 包含 worktree 的 commit，worktree 目录不存在
  - **AC-3**：主 working tree 有脏文件时，验证 tribunal 的 diff 不包含该文件（通过检查 `effectiveRoot` 指向 worktree）
  - **AC-4**：`state.worktreeRoot` 有值时，mock shell 验证 `checkBuildWithBaseline` 不调用 `git stash`，验证创建/删除临时 worktree 的 shell 调用
  - **AC-10**：`useWorktree=false` 模式下，跑通一个最小化的 step 循环（resolveInitialStep → validateStep → advance），验证功能正常
  - **AC-11**：用不含 `worktreeRoot`/`stepEffort` 字段的旧格式 state.json 调用 `computeNextTask`，验证正常推进不 crash
  - **AC-12**：模拟中断→删除 worktree 目录→ resume，验证从 `worktreeBranch` 重建 worktree 成功
- **文件**:
  - `mcp/src/__tests__/worktree-integration.test.ts`（新建）
- **依赖**: Tasks 10、11、12
- **完成标准**: `npm test -- worktree-integration` 全部通过；AC-1/2/3/4/10/11/12 均有对应测试用例

---

## 提交策略（与 500 行限制对齐）

| 提交点 | 包含 Tasks | 约估行数 |
|--------|-----------|---------|
| Commit 1 | Task 1、2（基础类型与工具函数） | ~60行 |
| Commit 2 | Task 3、4（努力预算 + revision 循环修复） | ~80行 |
| Commit 3 | Task 5、6（验证增强 + Phase 3 + 前置守卫） | ~100行 |
| Commit 4 | Task 7、8（prompt 重写 + token 优化）含同步测试更新 | ~100行 |
| Commit 5 | Task 9（单元测试补全） | ~200行 |
| Commit 6 | Task 10、11（worktree 生命周期） | ~150行 |
| Commit 7 | Task 12（effectiveRoot 透传 + baseline 重构） | ~150行 |
| Commit 8 | Task 13（集成测试） | ~200行 |

---

## 关键路径

```
Task 1 (types)
  └─ Task 2 (state-manager)
       ├─ Task 3 (effort budget)
       │    ├─ Task 4 (advanceToNextStep fix)  ← P0-1 核心修复
       │    └─ Task 7 (revision prompt)
       ├─ Task 5 (validateStep 1c/2c/5c)       ← P0-2 核心修复
       └─ Task 6 (Phase 3 + prerequisites)     ← P1-1/P1-3 修复
            └─ Task 8 (token 优化)
                 └─ Task 9 (单元测试)          ← 单元测试闸门
                      └─ Task 10 (init worktree)
                           └─ Task 11 (complete worktree)
                                └─ Task 12 (effectiveRoot 透传)
                                     └─ Task 13 (集成测试)   ← 最终验证
```

**关键路径长度**：13 个 Task，估计总工时 2~3 小时。
**最小可交付集**（P0 优先）：Tasks 1~6 + Task 9 可独立交付，修复两个 P0 问题和三个 P1 编排问题，无需 worktree 即可上线。
