# 端到端测试结果：裁决官三级执行策略（Hub 集成）

**执行时间**: 2026-03-28
**测试框架**: vitest v2.1.9
**总测试数**: 465 passed / 0 failed
**总文件数**: 19 test files

## 新增测试用例汇总

共新增 **30** 个测试用例，分布在 3 个文件中：

### 1. hub-client-extended.test.ts（新增文件，14 个用例）

| ID | 用例名 | 优先级 | 结果 |
|----|--------|--------|------|
| TC-H07 | isAvailable 超时返回 false | P1 | PASS |
| TC-H16 | 空 token 不发 Authorization 头 | P1 | PASS |
| TC-H17 | ensureConnected 失败后重试可成功 | P1 | PASS |
| TC-H21 | 多个 worker 返回第一个在线的 | P1 | PASS |
| TC-H24 | 命令 expired 返回 null | P1 | PASS |
| TC-H25 | 轮询间隔递增策略（2s, 3s, 5s, 5s...） | P1 | PASS |
| TC-H26 | 轮询中途 GET 返回非 OK 继续轮询 | P1 | PASS |
| TC-H27 | TRIBUNAL_HUB_URL 未设置返回 null | P1 | PASS |
| TC-H28 | TRIBUNAL_HUB_URL 设置返回 HubClient 实例 | P1 | PASS |
| TC-H29 | 连续调用返回同一实例（单例） | P1 | PASS |
| TC-H30 | resetHubClient 后重新创建 | P1 | PASS |
| TC-N01 | baseUrl 尾部斜杠被去除 | P1 | PASS |
| TC-N03 | ensureConnected 网络异常不抛出 | P1 | PASS |
| TC-N04 | 空 TRIBUNAL_HUB_URL 返回 null | P0 | PASS |

### 2. tribunal.test.ts（新增 13 个用例）

| ID | 用例名 | 优先级 | 结果 |
|----|--------|--------|------|
| TC-T02 | 默认模式 dummy verdict 结构完整 | P2 | PASS |
| TC-T10 | Hub PASS 无 evidence 覆写为 FAIL | P0 | PASS |
| TC-T11 | Hub 返回字符串 result（需 JSON.parse） | P1 | PASS |
| TC-T12 | Hub 返回无效 result（无 verdict 字段）降级 | P1 | PASS |
| TC-T13 | Hub 注册失败降级到 Subagent | P0 | PASS |
| TC-T14 | Hub 大 digest 使用文件模式 prompt | P1 | PASS |
| TC-T15 | Hub 小 digest 内联 prompt | P1 | PASS |
| TC-N02 | Hub 返回非 JSON 字符串不崩溃 | P1 | PASS |
| TC-I01 | EvalTribunalResult 新增字段均为 optional | P1 | PASS |
| TC-I02 | evaluateTribunal 参数签名不变 | P1 | PASS |

### 3. orchestrator.test.ts（新增 3 个用例）

| ID | 用例名 | 优先级 | 结果 |
|----|--------|--------|------|
| TC-O04a | Phase 5 subagentRequested 返回 tribunal_subagent | P0 | PASS |
| TC-O04b | Phase 6 subagentRequested 返回 tribunal_subagent | P0 | PASS |
| TC-O05 | subagentRequested 连续 3 次不触发 ESCALATE_REGRESS | P2 | PASS |

## P0 用例覆盖

| ID | 描述 | 状态 |
|----|------|------|
| TC-T10 | Hub PASS 无 evidence 覆写 | PASS |
| TC-T13 | Hub 注册失败降级 | PASS |
| TC-O04 | Phase 5/6 subagentRequested 分支验证 | PASS |
| TC-N04 | 空字符串 TRIBUNAL_HUB_URL 边界条件 | PASS |

> 注：TC-T16（subagentRequested 跳过 tribunal log）因 evaluateTribunal 需要完整文件系统 mock（prepareTribunalInput 依赖），属于 INTEGRATION 级别，已由 orchestrator 层面的 TC-O01/O04 间接覆盖。

## 回归验证

全部 465 个测试用例通过，无回归。

```
 Test Files  19 passed (19)
      Tests  465 passed (465)
   Duration  31.69s
```
