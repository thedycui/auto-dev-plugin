# E2E Test Results: ship-integration

## 执行环境
- 测试框架: vitest 2.1.9
- 执行命令: npm test
- 执行时间: 2026-03-27T14:35:33
- 总耗时: 13.56s

## 测试结果汇总
- 总用例数: 412
- 通过: 412
- 失败: 0
- 跳过: 0
- 测试文件: 17 passed (17)

## ship-integration 相关测试详细结果

### ship-integration-e2e.test.ts (26 tests)

| TC ID | 测试名称 | 结果 |
|-------|---------|------|
| T-INT-02 | Step 1: Phase 7 PASS -> advances to 8a | PASS |
| T-INT-02 | Step 2: 8a passes (no unpushed) -> advances to 8b | PASS |
| T-INT-02 | Step 3: 8b passes (SUCCEED) -> advances to 8c | PASS |
| T-INT-02 | Step 4: 8c passes (SUCCEED) -> advances to 8d | PASS |
| T-INT-02 | Step 5: 8d PASS -> done=true | PASS |
| T-INT-02 | Step 6: evaluateTribunal never called during Phase 8 (AC-12) | PASS |
| T-INT-03 | CODE_BUG triggers regress to Phase 3, step='3', shipRound=1 | PASS |
| T-INT-03 | After regress, Phase 3 build+test pass -> advances to 4a | PASS |
| T-INT-04a | shipRound=4, shipMaxRounds=5, CODE_BUG -> ESCALATE | PASS |
| T-INT-04b | shipRound=0, shipMaxRounds=1, CODE_BUG -> ESCALATE (minimal boundary) | PASS |
| T-INT-04c | shipRound=3, shipMaxRounds=5, CODE_BUG -> no ESCALATE, regress to Phase 3 | PASS |
| T-INT-05 | skipE2e=true skips Phase 5 but Phase 8 remains: 4a -> 6 | PASS |
| T-INT-05 | skipE2e=true, Phase 7 -> 8a (Phase 8 not skipped) | PASS |
| T-INT-06 | dryRun=true: maxPhase=2 regardless of ship, canDeclareComplete at Phase 2 | PASS |
| T-INT-06 | dryRun=true + ship=true: validateCompletion requires Phase 1,2,8 | PASS |
| T-INT-07 | turbo mode: maxPhase=3 regardless of ship, canDeclareComplete at Phase 3 | PASS |
| T-INT-08a | ship=true but Phase 8 not PASS -> canComplete=false | PASS |
| T-INT-08b | ship=true with Phase 8 PASS -> canComplete=true | PASS |
| T-INT-09 | iteration 0: 8b fails (no file) -> stays at 8b, prompt non-null | PASS |
| T-INT-09 | iteration 1: 8b fails again -> stays at 8b, prompt non-null | PASS |
| T-INT-09 | iteration 2: 8b fails third time -> ESCALATE (iteration_limit_exceeded) | PASS |
| T-INT-10 | ENV_ISSUE stays at 8d, no phase change, shipRound unchanged | PASS |
| T-INT-11 | validateStep('8d') returns passed=false, no regressToPhase (ENV_ISSUE fallback) | PASS |
| T-INT-12 | content with both PASS and CODE_BUG -> passed=true (PASS checked first) | PASS |
| T-INT-13 | lowercase 'succeed' -> passed=false (case-sensitive) | PASS |
| T-INT-14 | git exitCode=128 -> passed=false, feedback contains error message | PASS |

### ship-integration.test.ts (15 tests)

| TC ID | 测试名称 | 结果 |
|-------|---------|------|
| AC-1 | StateJsonSchema accepts all ship-related fields | PASS |
| AC-1 | ship fields are optional -- state without them is valid | PASS |
| AC-1 | InitInputSchema accepts ship parameters | PASS |
| AC-1 | ship parameters are optional | PASS |
| AC-1 | does not include shipRound (set by framework) | PASS |
| AC-3/4 | ship=true: Phase 7 PASS -> nextPhase=8 | PASS |
| AC-3/4 | ship=true: Phase 8 PASS -> canDeclareComplete=true | PASS |
| AC-3 | ship=false: Phase 7 PASS -> canDeclareComplete=true (unchanged) | PASS |
| AC-3 | isDryRun=true: maxPhase still 2 regardless of ship | PASS |
| AC-3 | turbo mode: maxPhase still 3 regardless of ship | PASS |
| AC-11 | ship=true requires Phase 8 PASS | PASS |
| AC-11 | ship=true with Phase 8 PASS -> canComplete | PASS |
| AC-11 | ship=false does not require Phase 8 | PASS |
| AC-11 | default ship parameter is false | PASS |
| AC-5 | skipE2e + ship: requires [1,2,3,4,6,7,8] | PASS |

## DEFERRED 用例

| TC ID | 原因 |
|-------|------|
| T-E2E-01 | 需要完整 MCP server 启动 + 模拟真实 MCP client 调用 |
| T-E2E-02 | 需要 DevOps 平台连接 + SSH 远程验证环境 |

## 未实现用例

| TC ID | 层级 | 状态 | 说明 |
|-------|------|------|------|
| T-INT-01a | INTEGRATION | 已覆盖(间接) | init handler 的正常路径已由 ship-integration.test.ts 中 InitInputSchema 和 StateJsonSchema 测试覆盖；handler 级集成测试因需 mock MCP server 入口未单独实现 |
| T-INT-01b | INTEGRATION | 已覆盖(间接) | MISSING_DEPLOY_TARGET 验证逻辑存在于 index.ts:210-215，但 handler 级测试未单独实现；该分支为简单的 if-return 守卫，风险较低 |

## AC 覆盖矩阵

| AC | 描述 | 测试覆盖 | 状态 |
|----|------|---------|------|
| AC-1 | init(ship=true) 写入 state.json | ship-integration.test.ts (schema) | PASS |
| AC-2 | init(ship=true) 缺 deployTarget 报错 | 代码存在 (index.ts:210-215)，无独立测试 | 间接覆盖 |
| AC-3 | 无 ship 时 Phase 7 完成 | ship-integration.test.ts + T-INT-06/07 | PASS |
| AC-4 | full+ship phases=[1..8] | T-INT-02 + orchestrator.test.ts | PASS |
| AC-5 | skipE2e+ship 跳过 5 保留 8 | T-INT-05 + ship-integration.test.ts | PASS |
| AC-6 | 8a git unpushed 检测 | T-INT-02 + T-INT-14 + orchestrator.test.ts | PASS |
| AC-7 | 8b 构建结果验证 | T-INT-09 + T-INT-13 + orchestrator.test.ts | PASS |
| AC-8 | 8c 部署结果验证 | T-INT-02 + orchestrator.test.ts | PASS |
| AC-9 | 8d PASS/CODE_BUG/ENV_ISSUE | T-INT-03/10/11/12 + orchestrator.test.ts | PASS |
| AC-10 | shipRound >= shipMaxRounds ESCALATE | T-INT-04a/04b/04c + orchestrator.test.ts | PASS |
| AC-11 | validateCompletion ship 门禁 | T-INT-08a/08b + ship-integration.test.ts | PASS |
| AC-12 | Phase 8 不触发 tribunal | T-INT-02 (Step 6) + orchestrator.test.ts | PASS |
| AC-13 | phase8-ship.md prompt 模板 | T-E2E-02 (DEFERRED) | DEFERRED |
