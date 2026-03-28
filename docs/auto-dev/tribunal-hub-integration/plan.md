# Implementation Plan: tribunal-hub-integration

## 概述

基于设计文档的方案 B（Hub > Subagent > CLI opt-in），将裁决执行从"CLI 默认 + subagent fallback"改为"Hub 优先 > Subagent 默认 > CLI opt-in"三级策略。同时修复设计审查中发现的 P0/P1 问题。

**关键路径**: Task 1 -> Task 2 -> Task 3 -> Task 4 -> Task 5 -> Task 6 -> Task 7 -> Task 8 -> Task 9 -> Task 10

---

## Task 1: 扩展 EvalTribunalResult 和 runTribunalWithRetry 返回类型

- **描述**: 在 `EvalTribunalResult` 接口中新增 `subagentRequested?: boolean` 和 `digestPath?: string` 两个可选字段。在 `runTribunalWithRetry()` 返回类型中新增 `subagentRequested?: boolean`。这是所有后续任务的类型基础。（修复 P0-2）
- **文件**:
  - `mcp/src/tribunal.ts` -- `EvalTribunalResult` 接口（595 行）和 `runTribunalWithRetry()` 返回类型声明（408 行）
- **依赖**: 无
- **完成标准**:
  1. `EvalTribunalResult` 包含 `subagentRequested?: boolean` 和 `digestPath?: string`
  2. `runTribunalWithRetry()` 返回类型包含 `subagentRequested?: boolean`
  3. TypeScript 编译通过（`npx tsc --noEmit`）

## Task 2: 扩展 NextTaskResult.escalation 接口

- **描述**: 在 `NextTaskResult.escalation` 中新增 `digestPath?: string` 字段，供 subagent 读取 digest 文件。（修复 P1-2）
- **文件**:
  - `mcp/src/orchestrator.ts` -- `NextTaskResult` 接口（78-83 行）
- **依赖**: 无
- **完成标准**:
  1. `NextTaskResult.escalation` 包含 `digestPath?: string`
  2. TypeScript 编译通过

## Task 3: 实现 HubClient 模块

- **描述**: 新建 `hub-client.ts`，封装与 Agent Hub 的 HTTP 通信。包含 4 个方法：`isAvailable()`（1s 超时快速检测）、`ensureConnected()`（幂等注册）、`findTribunalWorker()`（按名称查找在线 worker）、`executePrompt()`（发送命令 + 轮询等待结果）。使用 `TRIBUNAL_HUB_URL` 和 `TRIBUNAL_HUB_TOKEN` 环境变量。轮询策略：2s, 3s, 5s, 5s, ...（采纳 P2-1 建议），总超时 600s。Token 管理：使用 `TRIBUNAL_HUB_TOKEN` 预配置 token 进行所有 API 调用的身份验证（修复 P1-4）。
- **文件**:
  - `mcp/src/hub-client.ts` -- **新增**
- **依赖**: 无
- **完成标准**:
  1. `HubClient` 类导出 `isAvailable()`, `ensureConnected()`, `findTribunalWorker()`, `executePrompt()` 四个方法
  2. `ensureConnected()` 幂等（内部维护 `_registered` 标记，只调一次 POST /agents/register）
  3. `isAvailable()` 使用 1s 超时，失败返回 false 不抛异常
  4. `executePrompt()` 使用指数退避轮询 `GET /commands/:id`
  5. 所有 HTTP 请求携带 `Authorization: Bearer ${TRIBUNAL_HUB_TOKEN}` header
  6. TypeScript 编译通过

## Task 4: 改造 runTribunal() 为三级策略

- **描述**: 修改 `runTribunal()` 函数，实现三级执行策略。根据环境变量决定执行路径：(1) `TRIBUNAL_HUB_URL` 已设置则尝试 Hub 模式，失败降级；(2) 默认返回 `subagentRequested: true` 标记（不再调用 CLI spawn）；(3) `TRIBUNAL_MODE=cli` 时走现有 CLI spawn 逻辑。注意：不使用 `_subagentMode` 魔法标记，而是直接在 `runTribunal()` 和 `runTribunalWithRetry()` 层面用显式的 `subagentRequested` 字段传递信号（修复 P1-1）。
- **文件**:
  - `mcp/src/tribunal.ts` -- `runTribunal()` 函数（298 行），`runTribunalWithRetry()` 函数（408 行）
- **依赖**: Task 1, Task 3
- **完成标准**:
  1. 不设任何环境变量时，`runTribunal()` 不调用 `execFile`/`exec`，`runTribunalWithRetry()` 返回 `{ subagentRequested: true }`
  2. `TRIBUNAL_HUB_URL` 已设置时，尝试通过 HubClient 执行，成功返回正常 verdict
  3. Hub 失败（不可达/worker 离线/超时）时，降级返回 `{ subagentRequested: true }`
  4. `TRIBUNAL_MODE=cli` 时，走原有 CLI spawn 逻辑
  5. 不存在 `_subagentMode` 魔法属性

## Task 5: 改造 evaluateTribunal() 传递 subagentRequested

- **描述**: 修改 `evaluateTribunal()` 函数，解构 `runTribunalWithRetry()` 返回值中的 `subagentRequested` 字段。当 `subagentRequested=true` 时，跳过后续的 cross-validation 等逻辑，直接返回 `{ verdict: "FAIL", issues: [], subagentRequested: true, digestPath }`。这确保完整的数据传递链路：`runTribunal` -> `runTribunalWithRetry` -> `evaluateTribunal`。（修复 P0-2 完整传递链路）
- **文件**:
  - `mcp/src/tribunal.ts` -- `evaluateTribunal()` 函数（623 行，特别是 641 行的解构）
- **依赖**: Task 1, Task 4
- **完成标准**:
  1. `evaluateTribunal()` 在 641 行解构新增 `subagentRequested`
  2. `subagentRequested=true` 时返回 `EvalTribunalResult` 包含 `subagentRequested: true` 和 `digestPath`
  3. `subagentRequested=true` 时不执行 cross-validation、auto-override 等后续逻辑
  4. 正常路径（Hub 成功 / CLI 模式）行为不受影响

## Task 6: 改造 orchestrator computeNextTask() 新增 tribunal_subagent 分支

- **描述**: 在 `computeNextTask()` 中处理 `validation.tribunalResult` 时，新增 `subagentRequested` 分支（在 `rawParseFailure` 和 `crashed` 分支之前插入）。返回 escalation `{ reason: "tribunal_subagent", digestPath, digest, digestHash }`。不增加 crash 计数，但正常增加 tribunalSubmits 计数。同时确保 `validateStep()` 的 case "4a"/"5b"/"6" 正确传递 tribunalResult（当前已在 548/572/583 行传递，无需额外改动）。（修复 P0-1 和 P0-2）
- **文件**:
  - `mcp/src/orchestrator.ts` -- `computeNextTask()` 中 tribunal 结果处理部分（906-998 行）
- **依赖**: Task 1, Task 2, Task 5
- **完成标准**:
  1. `validation.tribunalResult.subagentRequested === true` 时返回 escalation `{ reason: "tribunal_subagent", digestPath, digest, digestHash }`
  2. 不增加 crash 计数（与 `tribunal_crashed` 区分）
  3. 正常增加 `tribunalSubmits` 计数
  4. escalation 包含 `digestPath` 字段

## Task 7: 更新 SKILL.md 处理 tribunal_subagent escalation

- **描述**: 修改 `SKILL.md` 的循环执行部分，区分 `tribunal_subagent` escalation 和其他 escalation。当 `reason === "tribunal_subagent"` 时，主 agent 自动启动 subagent 读取 `digestPath` 文件执行裁决，裁决完成后调用 `auto_dev_tribunal_verdict` 提交结果。其他 escalation 保持现有行为（告知用户 + break）。（修复 P1-3）
- **文件**:
  - `skills/auto-dev/SKILL.md` -- 循环执行部分（36-38 行附近）
- **依赖**: Task 6
- **完成标准**:
  1. SKILL.md 包含 `tribunal_subagent` escalation 的自动处理逻辑
  2. 描述了 subagent 执行裁决的步骤：读取 digestPath -> 裁决 -> auto_dev_tribunal_verdict
  3. 其他 escalation reason 仍走"告知用户 + break"路径
  4. `tribunal_crashed` 和 `tribunal_parse_failure` escalation 的处理不受影响

## Task 8: HubClient 单元测试

- **描述**: 为 `HubClient` 编写单元测试，覆盖：(1) `isAvailable()` 成功/超时/网络错误场景；(2) `ensureConnected()` 幂等性（连续调用 2 次只发 1 次 register）；(3) `findTribunalWorker()` 找到/未找到 worker；(4) `executePrompt()` 正常完成/超时/rejected 场景。使用 `vi.mock` mock fetch。
- **文件**:
  - `mcp/src/__tests__/hub-client.test.ts` -- **新增**
- **依赖**: Task 3
- **完成标准**:
  1. 覆盖 AC-2（Hub 执行成功）、AC-3（Hub 不可用降级）、AC-4（worker 离线降级）、AC-6（轮询超时降级）、AC-7（ensureConnected 幂等）
  2. 所有测试通过（`npx vitest run hub-client`）

## Task 9: tribunal 三级策略单元测试

- **描述**: 在 `tribunal.test.ts` 中新增测试用例，覆盖三级策略的核心场景：(1) 默认模式（无环境变量）返回 `subagentRequested: true` 且不调用 `execFile`（AC-1）；(2) `TRIBUNAL_MODE=cli` 走 CLI spawn（AC-5）；(3) Hub 模式成功返回 verdict（AC-2，mock HubClient）；(4) Hub 降级到 Subagent（AC-3/AC-4/AC-6）。
- **文件**:
  - `mcp/src/__tests__/tribunal.test.ts` -- 新增测试用例
- **依赖**: Task 4, Task 5
- **完成标准**:
  1. 覆盖 AC-1（默认 subagent）、AC-5（CLI opt-in）、AC-2（Hub 成功）、AC-3（Hub 降级）
  2. 现有测试用例不被破坏（可能需要调整现有 mock，因为默认不再走 CLI）
  3. 所有测试通过（`npx vitest run tribunal`）

## Task 10: orchestrator subagentRequested 分支单元测试

- **描述**: 在 `orchestrator.test.ts` 中新增测试用例，覆盖 `computeNextTask()` 收到 `subagentRequested: true` 的 tribunalResult 时：(1) 返回 escalation `{ reason: "tribunal_subagent" }`；(2) escalation 包含 `digestPath`；(3) 不增加 crash 计数；(4) 正常增加 `tribunalSubmits` 计数（AC-8）。
- **文件**:
  - `mcp/src/__tests__/orchestrator.test.ts` -- 新增测试用例
- **依赖**: Task 6
- **完成标准**:
  1. 覆盖 AC-8 所有要点
  2. 验证 escalation reason 为 `"tribunal_subagent"` 而非 `"tribunal_crashed"`
  3. 所有测试通过（`npx vitest run orchestrator`）

## Task 11: 修复现有测试兼容性

- **描述**: 默认行为从 CLI spawn 变为 Subagent 后，现有测试中 mock `execFile` 并期望其被调用的用例需要适配。检查 `tribunal.test.ts` 和 `ship-integration-e2e.test.ts` 中的 mock，确保：(1) 测试 CLI 路径的用例设置 `TRIBUNAL_MODE=cli`；(2) 测试默认路径的用例不再期望 `execFile` 被调用；(3) `ship-integration-e2e.test.ts` 中 mock `evaluateTribunal` 的用例如果返回类型变化需同步更新。
- **文件**:
  - `mcp/src/__tests__/tribunal.test.ts` -- 修改现有测试
  - `mcp/src/__tests__/ship-integration-e2e.test.ts` -- 检查并按需修改
- **依赖**: Task 4, Task 5, Task 9
- **完成标准**:
  1. `npx vitest run` 全量测试通过
  2. 无 skip 或 todo 的遗留测试

## Task 12: 接口签名不变性验证

- **描述**: 验证 `evaluateTribunal()` 的对外接口签名保持不变（AC-9）。检查所有调用方（orchestrator.ts 的 542/566/577 行）调用参数未变，新增字段均为 optional。确保 TypeScript 编译通过且无类型错误。
- **文件**:
  - `mcp/src/tribunal.ts` -- 检查 `evaluateTribunal` 签名
  - `mcp/src/orchestrator.ts` -- 检查调用点
- **依赖**: Task 5, Task 6
- **完成标准**:
  1. `evaluateTribunal()` 参数列表与改动前完全一致
  2. `EvalTribunalResult` 新增字段均为 `?:` optional
  3. `npx tsc --noEmit` 零错误
  4. 所有调用方无需修改调用参数

---

## 任务依赖图

```
Task 1 (类型扩展) ──┬──> Task 4 (runTribunal 三级策略) ──> Task 5 (evaluateTribunal) ──> Task 6 (orchestrator) ──> Task 7 (SKILL.md)
                    │                                                                      │
Task 2 (escalation) ┘                                                                      ├──> Task 10 (orchestrator 测试)
                                                                                           │
Task 3 (HubClient) ──> Task 4                                                             └──> Task 12 (签名验证)
         │
         └──> Task 8 (HubClient 测试)

Task 4 + Task 5 ──> Task 9 (tribunal 测试) ──> Task 11 (现有测试兼容)
```

## 风险提示

1. **现有测试大规模适配**：默认行为从 CLI 变为 Subagent，tribunal.test.ts 有 1081 行，其中大量用例 mock `execFile` 并期望其被调用。Task 11 可能比预估耗时更长。
2. **SKILL.md 修改影响面大**：SKILL.md 是主 agent 的核心指令，措辞需精确，避免引入歧义。
