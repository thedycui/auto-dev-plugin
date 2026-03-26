# E2E Test Results: circuit-breaker

## 执行环境

- 日期: 2026-03-26
- 分支: master
- 构建: `npm run build` PASS
- 测试框架: vitest 1.6.0

## 测试结果汇总

- 总测试文件: 14 passed (14)
- 总测试用例: 303 passed (303)
- 耗时: 11.57s
- 新增测试: 38 个（Task 7-9 写 20 个 + Phase 5 写 18 个）

## 新增断路器测试详情

### orchestrator-prompts.test.ts (新增 18 个)

| 用例 | 描述 | 结果 |
|------|------|------|
| TC-01 | parseApproachPlan 标准格式解析含目标段 | PASS |
| TC-02 | parseApproachPlan 缺少方法字段时 fallback summary | PASS |
| TC-10 | parseApproachPlan 无标题随机文本返回 null | PASS |
| TC-11 | buildCircuitBreakPrompt 多个 prohibited 无框架术语 | PASS |
| TC-23 | extractOneLineReason 超长截断到 123 字符 | PASS |
| TC-24 | extractOneLineReason 全空白返回"未知原因" | PASS |
| parseApproachPlan | 标准格式（主+2备选）返回正确数组 | PASS |
| parseApproachPlan | 仅主方案无备选返回 null | PASS |
| parseApproachPlan | 空字符串返回 null | PASS |
| parseApproachPlan | 格式变体（额外空行）正常解析 | PASS |
| extractOneLineReason | 多行提取首行 | PASS |
| extractOneLineReason | 短文本原样返回 | PASS |
| extractOneLineReason | 超长截断 | PASS |
| extractOneLineReason | 空字符串 | PASS |
| extractOneLineReason | 跳过前导空行 | PASS |
| buildCircuitBreakPrompt | 包含目标和方案 | PASS |
| buildCircuitBreakPrompt | 包含禁止列表 | PASS |
| buildCircuitBreakPrompt | 不含框架术语 | PASS |

### orchestrator.test.ts (新增 20 个)

| 用例 | AC | 描述 | 结果 |
|------|-----|------|------|
| TC-03 | AC-1 | 首次失败+approach-plan存在→创建approachState | PASS |
| TC-04/05 | AC-2,3 | 第二次失败触发CIRCUIT_BREAK，stepIteration重置，freshContext=true | PASS |
| TC-06 | AC-4 | 所有方案耗尽→escalation+BLOCKED | PASS |
| TC-07b | AC-5 | 无approach-plan.md→正常revision | PASS |
| TC-08 | AC-5 | 无approach-plan.md+超限→escalation | PASS |
| TC-09 | AC-6 | 只有主方案→planFeedback含"备选方案" | PASS |
| TC-15 | AC-8 | step 5b含方案计划指令 | PASS |
| TC-16 | AC-8 | step 1a不含方案计划指令 | PASS |
| TC-17 | AC-8 | step 7不含方案计划指令 | PASS |
| TC-18 | P1-1 | 步骤推进时approachState清零 | PASS |
| TC-19 | - | 有approachState时跳过MAX_STEP_ITERATIONS | PASS |
| TC-20 | - | 新方案首次失败走revision而非CIRCUIT_BREAK | PASS |
| TC-21 | - | 3个方案完整生命周期（6次调用） | PASS |
| TC-25 | - | plan.md缺失时使用fallback goal | PASS |
| TC-26 | AC-6 | 格式不规范返回planFeedback | PASS |
| 基础 | AC-5 | 无approach-plan返回CONTINUE | PASS |
| 基础 | - | 首次失败CONTINUE且持久化 | PASS |
| 基础 | AC-2,3 | 连续2次失败CIRCUIT_BREAK | PASS |
| 基础 | AC-4 | computeNextTask CIRCUIT_BREAK重置stepIteration | PASS |
| 基础 | AC-4 | 所有方案耗尽BLOCKED | PASS |

## AC 覆盖矩阵

| AC | 描述 | 测试用例 | 状态 |
|----|------|---------|------|
| AC-1 | approach-plan.md 解析正确 | TC-01, TC-02, TC-03, 基础x3 | PASS |
| AC-2 | 同一方案失败2次触发CIRCUIT_BREAK | TC-04/05, 基础 | PASS |
| AC-3 | CIRCUIT_BREAK时stepIteration重置为0 | TC-04/05, 基础 | PASS |
| AC-4 | 所有方案耗尽后BLOCKED | TC-06, 基础 | PASS |
| AC-5 | 无approach-plan.md时向后兼容 | TC-07b, TC-08, 基础 | PASS |
| AC-6 | 格式不规范时graceful fallback | TC-09, TC-10, TC-26 | PASS |
| AC-7 | 清零prompt不含框架术语 | TC-11, 基础 | PASS |
| AC-8 | 方案计划指令只注入step 3/4a/5b | TC-15, TC-16, TC-17 | PASS |
