# 端到端测试用例：ship-integration (Phase 8)

## 测试可行性分类

| 层级 | 范围 | 可执行性 |
|------|------|---------|
| UNIT | 单个函数/模块，mock 外部依赖 | 本地 vitest 可跑 |
| INTEGRATION | 多模块协作（orchestrator + phase-enforcer + state-manager），使用真实临时文件系统 | 本地 vitest 可跑 |
| E2E-DEFERRED | 需要完整 MCP server 启动 + DevOps 平台连接 | 标记为 DEFERRED，不在 CI 中执行 |

## 已有测试覆盖（不需要重复）

以下 AC 已在 `ship-integration.test.ts` 和 `orchestrator.test.ts` 中覆盖：

| AC | 已有测试文件 | 测试描述 |
|----|------------|---------|
| AC-1 | ship-integration.test.ts | StateJsonSchema 接受 ship 字段；InitInputSchema 接受 ship 参数 |
| AC-3 | ship-integration.test.ts + orchestrator.test.ts | 无 ship 时 Phase 7 完成后返回 null；computeNextDirective canDeclareComplete=true |
| AC-4 | orchestrator.test.ts | full+ship phases=[1..8]；Phase 7 PASS 后推进到 8a |
| AC-5 | ship-integration.test.ts + orchestrator.test.ts | skipE2e+ship phases=[1,2,3,4,6,7,8] |
| AC-6 | orchestrator.test.ts | 8a 有 unpushed commit 时 passed=false；无 unpushed 时 passed=true |
| AC-7 | orchestrator.test.ts | 8b ship-build-result.md 缺失/含 SUCCEED 的场景 |
| AC-8 | orchestrator.test.ts | 8c ship-deploy-result.md 含 SUCCEED 的场景 |
| AC-9 | orchestrator.test.ts | 8d PASS/CODE_BUG/ENV_ISSUE 三种场景 |
| AC-10 | orchestrator.test.ts | shipRound >= shipMaxRounds 时 ESCALATE + BLOCKED |
| AC-11 | ship-integration.test.ts | validateCompletion ship=true 需要 Phase 8 PASS；ship=false 不需要 |
| AC-12 | orchestrator.test.ts | Phase 8 步骤不调用 evaluateTribunal |

## 需要补充的测试用例

以下测试关注**集成入口**和**跨模块协作**，不能仅靠单元测试覆盖。

---

### T-INT-01: auto_dev_init(ship=true) 完整初始化路径

**层级**: INTEGRATION
**覆盖 AC**: AC-1, AC-2
**入口**: `auto_dev_init` handler（index.ts）
**前置条件**: 空的临时项目目录，包含 package.json

**子用例 T-INT-01a: 正常初始化**

| 步骤 | 操作 | 预期结果 |
|------|------|---------|
| 1 | 调用 `auto_dev_init({ projectRoot, topic: "ship-test", mode: "full", ship: true, deployTarget: "my-app", deployBranch: "main", deployEnv: "green", verifyMethod: "api", verifyConfig: { endpoint: "http://x/health" }, shipMaxRounds: 3 })` | 返回成功，无 error 字段 |
| 2 | 读取 `state.json` | `ship === true`, `deployTarget === "my-app"`, `deployBranch === "main"`, `deployEnv === "green"`, `verifyMethod === "api"`, `shipRound === 0`, `shipMaxRounds === 3` |
| 3 | 读取 `progress-log.md` | 包含 INIT marker，含 `ship=true` |

**子用例 T-INT-01b: ship=true 但缺少 deployTarget**

| 步骤 | 操作 | 预期结果 |
|------|------|---------|
| 1 | 调用 `auto_dev_init({ projectRoot, topic: "ship-test", mode: "full", ship: true })` | 返回包含 `error: "MISSING_DEPLOY_TARGET"` 的结果 |
| 2 | 检查 outputDir | 目录不存在（session 未创建） |

---

### T-INT-02: computeNextTask 完整 Phase 8 推进路径（从 Phase 7 到 8d PASS）

**层级**: INTEGRATION
**覆盖 AC**: AC-4, AC-6, AC-7, AC-8, AC-9, AC-12
**入口**: `computeNextTask(projectRoot, topic)`
**前置条件**: 已初始化 session，state.json 中 ship=true, mode="full"

**描述**: 从 step=7（retrospective 已完成）开始，逐步模拟 Phase 8 的 4 个子步骤全部通过的完整路径。每次调用 computeNextTask 后，手动写入对应的产出物文件，再调用下一步。

| 步骤 | 操作 | 预期结果 |
|------|------|---------|
| 1 | state: step="7", stepIteration=0；写入 retrospective.md（>30行） | - |
| 2 | 调用 `computeNextTask(projectRoot, topic)` | `step === "8a"`, `agent === "auto-dev-developer"`, `done === false` |
| 3 | mock git log 返回空（无 unpushed commit） | - |
| 4 | 调用 `computeNextTask(projectRoot, topic)` | `step === "8b"`, message 包含 "8a" 和 "passed" |
| 5 | 写入 `ship-build-result.md`，内容含 "SUCCEED" | - |
| 6 | 调用 `computeNextTask(projectRoot, topic)` | `step === "8c"`, message 包含 "8b" 和 "passed" |
| 7 | 写入 `ship-deploy-result.md`，内容含 "SUCCEED" | - |
| 8 | 调用 `computeNextTask(projectRoot, topic)` | `step === "8d"`, message 包含 "8c" 和 "passed" |
| 9 | 写入 `ship-verify-result.md`，内容含 "PASS" | - |
| 10 | 调用 `computeNextTask(projectRoot, topic)` | `done === true`, `step === null` |
| 11 | 全程验证 `evaluateTribunal` 未被调用（AC-12） | mockEvaluateTribunal.toHaveBeenCalledTimes(0) |

---

### T-INT-03: Phase 8 CODE_BUG 回退到 Phase 3 再重新走到 Phase 8 的完整路径

**层级**: INTEGRATION
**覆盖 AC**: AC-9, AC-10
**入口**: `computeNextTask(projectRoot, topic)`
**前置条件**: state.json 中 ship=true, step="8d", shipRound=0, shipMaxRounds=5
**风险标记**: design review 标记的高风险休眠路径 -- regressToPhase 首次激活

**描述**: 这是最关键的集成测试。验证 8d CODE_BUG -> 回退到 Phase 3 -> 重新编译测试 -> 重新走 Phase 8 的完整循环。

| 步骤 | 操作 | 预期结果 |
|------|------|---------|
| 1 | state: step="8d", phase=8, shipRound=0；写入 `ship-verify-result.md` 含 "CODE_BUG" | - |
| 2 | 调用 `computeNextTask(projectRoot, topic)` | `step === "3"`, `agent === "auto-dev-developer"`, message 包含 "CODE_BUG" 和 "round 1" |
| 3 | 读取 state.json | `phase === 3`, `step === "3"`, `stepIteration === 0`, `shipRound === 1`, `lastValidation === "SHIP_REGRESS"`, `approachState === null` |
| 4 | mock build+test 通过 | - |
| 5 | 调用 `computeNextTask(projectRoot, topic)` | step 推进到 "4a"（Phase 4 验证） |
| 6 | 模拟 Phase 4-7 全部通过（逐步推进） | 最终到达 step "8a" |
| 7 | 模拟 Phase 8 全部通过（8a-8d） | `done === true` |
| 8 | 读取 state.json | `shipRound === 1`（未变，只有再次 CODE_BUG 才递增） |

---

### T-INT-04: shipRound 边界值 -- 达到 shipMaxRounds 时 ESCALATE

**层级**: INTEGRATION
**覆盖 AC**: AC-10
**入口**: `computeNextTask(projectRoot, topic)`

**子用例 T-INT-04a: shipRound = shipMaxRounds - 1，CODE_BUG 触发 ESCALATE**

| 步骤 | 操作 | 预期结果 |
|------|------|---------|
| 1 | state: step="8d", shipRound=4, shipMaxRounds=5；写入 `ship-verify-result.md` 含 "CODE_BUG" | - |
| 2 | 调用 `computeNextTask(projectRoot, topic)` | `escalation.reason === "ship_max_rounds"`, `prompt === null`, `done === false` |
| 3 | 读取 state.json | `status === "BLOCKED"` |

**子用例 T-INT-04b: shipRound = 0, shipMaxRounds = 1（最小值边界）**

| 步骤 | 操作 | 预期结果 |
|------|------|---------|
| 1 | state: step="8d", shipRound=0, shipMaxRounds=1；写入 `ship-verify-result.md` 含 "CODE_BUG" | - |
| 2 | 调用 `computeNextTask(projectRoot, topic)` | `escalation.reason === "ship_max_rounds"`（因为 0+1 >= 1） |

**子用例 T-INT-04c: shipRound = shipMaxRounds - 2，CODE_BUG 不触发 ESCALATE**

| 步骤 | 操作 | 预期结果 |
|------|------|---------|
| 1 | state: step="8d", shipRound=3, shipMaxRounds=5；写入 `ship-verify-result.md` 含 "CODE_BUG" | - |
| 2 | 调用 `computeNextTask(projectRoot, topic)` | `step === "3"`, 无 escalation，message 包含 "round 4" |

---

### T-INT-05: 组合条件 -- skipE2e + ship

**层级**: INTEGRATION
**覆盖 AC**: AC-5
**入口**: `computeNextTask(projectRoot, topic)`

| 步骤 | 操作 | 预期结果 |
|------|------|---------|
| 1 | state: mode="full", ship=true, skipE2e=true, step=null | - |
| 2 | 调用 `computeNextTask(projectRoot, topic)` | `step === "1a"`（正常开始） |
| 3 | 推进到 step="4a"，mock 验证通过 | - |
| 4 | 调用 `computeNextTask(projectRoot, topic)` | `step === "6"`（跳过 5a/5b/5c），确认 Phase 5 被跳过 |
| 5 | 推进到 step="7"，mock 通过 | - |
| 6 | 调用 `computeNextTask(projectRoot, topic)` | `step === "8a"`（Phase 8 未被跳过） |

---

### T-INT-06: 组合条件 -- dryRun + ship

**层级**: INTEGRATION
**覆盖 AC**: AC-3（边界条件）
**入口**: `computeNextTask(projectRoot, topic)` + `computeNextDirective`

**描述**: dryRun 模式只执行 Phase 1-2，ship 参数应被忽略。

| 步骤 | 操作 | 预期结果 |
|------|------|---------|
| 1 | state: mode="full", dryRun=true, ship=true, phase=2 | - |
| 2 | 调用 `computeNextDirective(2, "PASS", state)` | `canDeclareComplete === true`（dryRun 优先，maxPhase=2） |
| 3 | 调用 `validateCompletion(log([1,2]), "full", true, false, true)` | `canComplete === true`（dryRun 只需 Phase 1,2） |

---

### T-INT-07: 组合条件 -- turbo + ship

**层级**: INTEGRATION
**覆盖 AC**: AC-3（边界条件）
**入口**: `computeNextDirective`

**描述**: turbo 模式只有 Phase 3，ship 参数应被忽略（turbo 不跑完整流程）。

| 步骤 | 操作 | 预期结果 |
|------|------|---------|
| 1 | state: mode="turbo", ship=true, phase=3 | - |
| 2 | 调用 `computeNextDirective(3, "PASS", state)` | `canDeclareComplete === true`（turbo 优先，maxPhase=3） |

---

### T-INT-08: validateCompletion 完整门禁路径（从 auto_dev_complete 入口）

**层级**: INTEGRATION
**覆盖 AC**: AC-11
**入口**: `auto_dev_complete` handler（index.ts）
**前置条件**: 真实临时文件系统，已有 state.json 和 progress-log.md

**子用例 T-INT-08a: ship=true 但 Phase 8 未 PASS**

| 步骤 | 操作 | 预期结果 |
|------|------|---------|
| 1 | state.json: ship=true, mode="full", phase=8 | - |
| 2 | progress-log.md: Phase 1-7 全部 PASS，Phase 8 无记录 | - |
| 3 | 调用 `auto_dev_complete({ projectRoot, topic })` | 返回 `error: "INCOMPLETE"`, `missingPhases` 包含 8 |

**子用例 T-INT-08b: ship=true 且 Phase 8 已 PASS**

| 步骤 | 操作 | 预期结果 |
|------|------|---------|
| 1 | state.json: ship=true, mode="full", phase=8 | - |
| 2 | progress-log.md: Phase 1-8 全部 PASS | - |
| 3 | 调用 `auto_dev_complete({ projectRoot, topic })` | 不返回 INCOMPLETE 错误（进入后续的 build+test 验证） |

---

### T-INT-09: Phase 8 step 验证失败后的 iteration 递增和熔断

**层级**: INTEGRATION
**覆盖 AC**: AC-7（负面路径）
**入口**: `computeNextTask(projectRoot, topic)`

**描述**: 8b 验证失败（ship-build-result.md 不含 SUCCEED）连续 3 次后触发 iteration limit ESCALATE。

| 步骤 | 操作 | 预期结果 |
|------|------|---------|
| 1 | state: step="8b", stepIteration=0；不写 ship-build-result.md | - |
| 2 | 调用 `computeNextTask` | `step === "8b"`, prompt 非 null（修订指令） |
| 3 | 读取 state.json | `stepIteration === 1` |
| 4 | 再调用 `computeNextTask`（仍未写文件） | `step === "8b"`, prompt 非 null |
| 5 | 读取 state.json | `stepIteration === 2` |
| 6 | 再调用 `computeNextTask`（仍未写文件） | `escalation` 非 undefined, `escalation.reason === "iteration_limit_exceeded"` |

---

### T-INT-10: Phase 8d ENV_ISSUE 不触发回退

**层级**: INTEGRATION
**覆盖 AC**: AC-9（负面路径，ENV_ISSUE 分支）
**入口**: `computeNextTask(projectRoot, topic)`

| 步骤 | 操作 | 预期结果 |
|------|------|---------|
| 1 | state: step="8d", shipRound=0；写入 `ship-verify-result.md` 含 "ENV_ISSUE" | - |
| 2 | 调用 `computeNextTask(projectRoot, topic)` | `step === "8d"`（留在原步骤，不回退） |
| 3 | 读取 state.json | `phase === 8`（未变），`shipRound === 0`（未递增） |
| 4 | prompt 包含环境问题相关的修订指令 | prompt 非 null |

---

### T-INT-11: ship-verify-result.md 内容既不含 PASS 也不含 CODE_BUG 也不含 ENV_ISSUE

**层级**: UNIT
**覆盖 AC**: AC-9（边界条件）
**入口**: `validateStep("8d", ...)`

| 步骤 | 操作 | 预期结果 |
|------|------|---------|
| 1 | 写入 `ship-verify-result.md` 内容为 "Verification FAILED: unknown error" | - |
| 2 | 调用 `validateStep("8d", ...)` | `passed === false`, 无 `regressToPhase` 字段（走 ENV_ISSUE 兜底分支） |

---

### T-INT-12: ship-verify-result.md 同时包含 PASS 和 CODE_BUG

**层级**: UNIT
**覆盖 AC**: AC-9（边界条件 -- 优先级测试）
**入口**: `validateStep("8d", ...)`

**描述**: 验证 PASS 关键词检查在 CODE_BUG 之前（代码中 `if (content.includes("PASS"))` 在前）。

| 步骤 | 操作 | 预期结果 |
|------|------|---------|
| 1 | 写入 `ship-verify-result.md` 内容为 "Overall PASS but had CODE_BUG in one test" | - |
| 2 | 调用 `validateStep("8d", ...)` | `passed === true`（PASS 优先匹配） |

---

### T-INT-13: ship-build-result.md 含 "SUCCEED" 但大小写不同

**层级**: UNIT
**覆盖 AC**: AC-7（边界条件）
**入口**: `validateStep("8b", ...)`

| 步骤 | 操作 | 预期结果 |
|------|------|---------|
| 1 | 写入 `ship-build-result.md` 内容为 "Build succeed at ..." （小写） | - |
| 2 | 调用 `validateStep("8b", ...)` | `passed === false`（`includes("SUCCEED")` 区分大小写） |

---

### T-INT-14: 8a git 命令执行异常（非正常退出码）

**层级**: UNIT
**覆盖 AC**: AC-6（负面路径）
**入口**: `validateStep("8a", ...)`

| 步骤 | 操作 | 预期结果 |
|------|------|---------|
| 1 | mock `shell()` 返回 exitCode=128, stderr="fatal: not a git repository" | - |
| 2 | 调用 `validateStep("8a", ...)` | `passed === false`, feedback 包含 "git 命令执行失败" |

---

### T-E2E-01: auto_dev_init(ship=true) -> orchestrator Phase 8 -> auto_dev_complete 全链路

**层级**: E2E-DEFERRED
**覆盖 AC**: AC-1, AC-4, AC-11
**入口**: MCP tool 调用链

**描述**: 需要完整 MCP server 启动，模拟真实 MCP client 调用。标记为 DEFERRED。

| 步骤 | 操作 | 预期结果 |
|------|------|---------|
| 1 | MCP client 调用 `auto_dev_init(ship=true, deployTarget="app")` | 返回成功 |
| 2 | 反复调用 `auto_dev_next` 推进到 Phase 8 | 各步骤正常推进 |
| 3 | Phase 8 步骤产出物就绪后推进到完成 | done=true |
| 4 | 调用 `auto_dev_complete` | canComplete=true |

---

### T-E2E-02: Phase 8 + DevOps 真实构建部署

**层级**: E2E-DEFERRED
**覆盖 AC**: AC-7, AC-8, AC-13
**入口**: MCP tool 调用 + DevOps MCP

**描述**: 需要 DevOps 平台可用。标记为 DEFERRED。

| 步骤 | 操作 | 预期结果 |
|------|------|---------|
| 1 | Phase 8a: agent 执行 git push | 代码推送成功 |
| 2 | Phase 8b: agent 调用 DevOps 构建 | ship-build-result.md 写入含 SUCCEED |
| 3 | Phase 8c: agent 调用 DevOps 部署 | ship-deploy-result.md 写入含 SUCCEED |
| 4 | Phase 8d: agent 执行远程验证 | ship-verify-result.md 写入含 PASS |

---

## 覆盖矩阵

| AC | 描述 | 已有测试 | 补充测试 |
|----|------|---------|---------|
| AC-1 | init(ship=true) 写入 state.json | ship-integration.test.ts | T-INT-01a |
| AC-2 | init(ship=true) 缺 deployTarget 报错 | -- | T-INT-01b |
| AC-3 | 无 ship 时 Phase 7 完成 | ship-integration.test.ts + orchestrator.test.ts | T-INT-06, T-INT-07 |
| AC-4 | full+ship phases=[1..8]，Phase 7 PASS -> 8a | orchestrator.test.ts | T-INT-02, T-INT-05 |
| AC-5 | skipE2e+ship 跳过 5 保留 8 | ship-integration.test.ts + orchestrator.test.ts | T-INT-05 |
| AC-6 | 8a git unpushed 检测 | orchestrator.test.ts | T-INT-14 |
| AC-7 | 8b 构建结果验证 | orchestrator.test.ts | T-INT-09, T-INT-13 |
| AC-8 | 8c 部署结果验证 | orchestrator.test.ts | T-INT-02 (完整链路覆盖) |
| AC-9 | 8d PASS/CODE_BUG/ENV_ISSUE | orchestrator.test.ts | T-INT-03, T-INT-10, T-INT-11, T-INT-12 |
| AC-10 | shipRound >= shipMaxRounds ESCALATE | orchestrator.test.ts | T-INT-04a, T-INT-04b, T-INT-04c |
| AC-11 | validateCompletion ship 门禁 | ship-integration.test.ts | T-INT-08a, T-INT-08b |
| AC-12 | Phase 8 不触发 tribunal | orchestrator.test.ts | T-INT-02 (验证全链路无 tribunal) |
| AC-13 | phase8-ship.md prompt 模板 | -- | T-E2E-02 (DEFERRED) |

## 高风险路径标记

| 路径 | 风险等级 | 对应测试 | 原因 |
|------|---------|---------|------|
| regressToPhase 首次激活（8d CODE_BUG -> Phase 3） | **高** | T-INT-03 | design review 标记的休眠路径，之前仅在代码中存在，从未被 Phase 1-7 调用 |
| Phase 3->4->5->6->7->8 回退后重跑完整链路 | **高** | T-INT-03 (步骤 4-7) | 回退后 stepIteration 和 approachState 需正确重置 |
| shipMaxRounds 边界值（=1 时首次 CODE_BUG 即 ESCALATE） | **中** | T-INT-04b | 最小边界容易遗漏 |
| 关键词大小写敏感性 | **低** | T-INT-13 | `includes("SUCCEED")` 是精确匹配，agent 产出物大小写不一致时会误判 |
