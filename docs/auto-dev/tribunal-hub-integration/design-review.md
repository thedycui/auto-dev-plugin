# Design Review

## P0 (阻塞性问题)

### P0-1: 设计引用了不存在的函数 `runStepValidation()`

设计文档 4.6 节和 AC-8 中多次引用 `runStepValidation()`，但代码中不存在该函数。实际执行 tribunal 结果处理的函数是 `validateStep()`（orchestrator.ts:464），由 `computeNextTask()` 在 orchestrator.ts:900 调用。

**修复建议**：将设计中所有 `runStepValidation()` 替换为 `validateStep()` + `computeNextTask()` 中的 tribunal 结果处理逻辑（orchestrator.ts:906-998）。AC-8 的描述也需同步修正。

### P0-2: `subagentRequested` 的消费路径未设计完整

设计提出在 `validateStep()` 返回的 `tribunalResult` 中新增 `subagentRequested` 字段，但未说明 `validateStep()` 自身如何产生这个字段。当前 `validateStep()` 的 case "4a"/"5b"/"6" 调用 `evaluateTribunal()` 后直接检查 `verdict === "PASS"`。如果 `evaluateTribunal()` 返回 `subagentRequested: true`，`verdict` 实际上会是什么值？

当前代码路径：
- `evaluateTribunal()` -> `runTribunalWithRetry()` -> `runTribunal()`
- 设计说 Level 2 时 `runTribunal()` 返回带 `_subagentMode: true` 标记的 TribunalVerdict
- `runTribunalWithRetry()` 检测到后返回 `{ verdict, crashed: false, subagentRequested: true }`
- 但 `evaluateTribunal()` 内部在 step 5b（641 行）只解构了 `{ verdict, crashed, rawParseFailure }`，不会识别 `subagentRequested`

**修复建议**：
1. 明确 `runTribunalWithRetry()` 返回类型新增 `subagentRequested?: boolean`
2. 明确 `evaluateTribunal()` 内部需要解构并传递 `subagentRequested`
3. 明确 `EvalTribunalResult` 新增 `subagentRequested?: boolean` 和 `digestPath?: string`
4. 明确 `validateStep()` 中 case "4a"/"5b"/"6" 如何将 `subagentRequested` 传递给 `computeNextTask()`（通过 `tribunalResult` 字段）
5. 补充完整数据流：`runTribunal` -> `runTribunalWithRetry` -> `evaluateTribunal` -> `validateStep` -> `computeNextTask` 每一层的字段传递

## P1 (重要问题)

### P1-1: `_subagentMode: true` 魔法标记破坏类型契约

设计提出 `runTribunal()` 在 Level 2 时返回"带 `_subagentMode: true` 内部标记的 TribunalVerdict"。这本质上是在类型系统之外传递信号，违反 TypeScript 类型安全原则。`TribunalVerdict` 类型定义中没有 `_subagentMode` 字段，下游代码（如 `crossValidate()`）可能对返回值做不符合预期的处理。

**修复建议**：`runTribunal()` 应返回扩展后的联合类型，例如 `TribunalVerdict | { subagentRequested: true }`，或者更简单地在 `runTribunal()` 返回值类型中显式新增 `subagentRequested` 字段，避免用 `_` 前缀的魔法属性。

### P1-2: escalation 接口缺少 `digestPath` 字段

设计 4.5 节 Subagent 模式数据流中，escalation 携带 `digestPath`。但当前 `NextTaskResult.escalation` 类型（orchestrator.ts:78-83）只有 `reason`、`lastFeedback`、`digest`、`digestHash`，没有 `digestPath`。

**修复建议**：在设计的改动范围表中明确：需要扩展 `NextTaskResult.escalation` 接口，新增 `digestPath?: string` 字段。同时需要确认 SKILL.md 中 escalation 处理逻辑需同步更新——当前 SKILL.md 对 escalation 的处理是"告知用户并 break"，而非自动启动 subagent。

### P1-3: SKILL.md 消费者端未适配 `tribunal_subagent` escalation

设计提出新增 `tribunal_subagent` escalation reason，但当前 SKILL.md（skills/auto-dev/SKILL.md:36-38）对所有 escalation 的处理都是"告知用户 + break"。如果不更新 SKILL.md，`tribunal_subagent` escalation 会导致流程中断而非自动启动 subagent 裁决。

旧的 SKILL.legacy.md 有 `TRIBUNAL_PENDING` 的自动 subagent 处理逻辑，但新的 SKILL.md 没有。

**修复建议**：
1. 在改动范围表中新增 `skills/auto-dev/SKILL.md` 的修改
2. SKILL.md 需要区分 `tribunal_subagent` escalation（自动启动 subagent）和其他 escalation（告知用户）
3. 或者在设计中明确：`tribunal_subagent` 不走 escalation 路径，而是由框架内部自动处理（类似 `tribunal_crashed` 在 `computeNextTask` 中自动产生 escalation）

### P1-4: Hub 模式下 `GET /commands/:id` 的授权约束未说明

Hub 的 `GET /commands/:id`（commands.ts:152-172）要求请求方必须是命令的 sender 或 receiver，否则返回 403。设计中 `executePrompt()` 方法负责发送命令并轮询，这意味着 hub-client 必须先通过 `ensureConnected()` 注册为 agent，才能作为 sender 轮询命令状态。

虽然设计流程中 `ensureConnected()` 在 `findTribunalWorker()` 之前调用（数据流图中已体现），但 `executePrompt()` 方法的设计中未明确说明"使用注册时获得的 token 进行后续 API 调用"的认证机制。

**修复建议**：在 HubClient 设计中明确 token 管理策略——注册时 Hub 返回 token（或使用 `TRIBUNAL_HUB_TOKEN` 预配置 token），后续所有 API 调用需要携带此 token 进行身份验证。

### P1-5: 默认行为从 CLI 变为 Subagent 是 breaking change，需要显式说明迁移风险

设计声称"完全向后兼容"，但默认行为从 CLI spawn（独立进程裁决）变为 Subagent（主 agent 上下文内裁决）。虽然 Subagent 更稳定，但两者有本质区别：
- CLI spawn 使用独立的 API key 额度
- Subagent 与主 agent 共享 API key 额度和上下文窗口
- Subagent 裁决在主 agent 上下文中执行，独立性弱于 CLI

这不是"向后兼容"，而是"向更好方向的 breaking change"。

**修复建议**：将兼容性描述从"完全向后兼容"修正为"默认行为变更（更稳定），可通过 `TRIBUNAL_MODE=cli` 恢复旧行为"。

## P2 (优化建议)

### P2-1: Hub 轮询间隔建议优化

设计的轮询间隔为 `1s, 2s, 3s, 5s, 5s, ...`，但裁决通常需要 2-5 分钟。建议前 10 次用 `2s, 3s, 5s, 5s, ...` 后稳定在 10s，减少无效轮询。

### P2-2: 预估改动量偏低

设计预估 `tribunal.ts` 改动 ~50 行，但需要修改 `runTribunal()`（三级策略选择）、`runTribunalWithRetry()`（新增 subagentRequested 传递）、`evaluateTribunal()`（新增 subagentRequested/digestPath 传递），再加上导入 hub-client 等，实际改动可能在 80-100 行。`orchestrator.ts` 需新增 `subagentRequested` 处理分支（类似 `crashed` 和 `rawParseFailure` 分支），实际改动也可能超过 20 行。

### P2-3: Worker 名称发现策略可增强

`findTribunalWorker()` 通过 `GET /agents?name=tribunal-worker` 精确匹配查找 worker。Hub 的 `GET /agents` 使用 `a.name === name` 做精确匹配。建议在设计中明确 worker 注册时必须使用的 name 值，或考虑支持 capability 过滤（Hub 已支持 `capability` 参数）。

## 跨组件影响分析

### 变更清单

| 序号 | 变更项 | 类型 |
|------|--------|------|
| 1 | `hub-client.ts` (新增) | 类/模块 |
| 2 | `runTribunal()` — 新增三级策略分支 | 函数 |
| 3 | `runTribunalWithRetry()` — 返回值新增 `subagentRequested` | 接口 |
| 4 | `EvalTribunalResult` — 新增 `subagentRequested`, `digestPath` 字段 | 接口 |
| 5 | `validateStep()` — 需传递 subagentRequested | 函数 |
| 6 | `computeNextTask()` — 新增 tribunal_subagent escalation 分支 | 函数 |
| 7 | `NextTaskResult.escalation` — 新增 `digestPath` 字段 | 接口 |
| 8 | 环境变量 `TRIBUNAL_HUB_URL`, `TRIBUNAL_HUB_TOKEN`, `TRIBUNAL_HUB_WORKER`, `TRIBUNAL_MODE` | 配置 |

### 调用方影响

| 调用方 | 所在位置 | 影响类型 | 需同步修改 | 设计已覆盖 |
|--------|----------|----------|-----------|-----------|
| `evaluateTribunal()` 调用 `runTribunalWithRetry()` | tribunal.ts:641 | 返回值扩展（新增 subagentRequested） | 是 — 需解构新字段并传递 | 部分覆盖（提及但未写清完整传递链路） |
| `validateStep()` case "4a" 调用 `evaluateTribunal()` | orchestrator.ts:542 | EvalTribunalResult 新增字段 | 是 — 需将 subagentRequested 传递到 tribunalResult | 未覆盖 |
| `validateStep()` case "5b" 调用 `evaluateTribunal()` | orchestrator.ts:566 | 同上 | 是 | 未覆盖 |
| `validateStep()` case "6" 调用 `evaluateTribunal()` | orchestrator.ts:577 | 同上 | 是 | 未覆盖 |
| `computeNextTask()` 处理 `tribunalResult.crashed` | orchestrator.ts:933 | 新增 subagentRequested 分支 | 是 — 新增 tribunal_subagent escalation | 部分覆盖（4.6 节提及但函数名错误） |
| `SKILL.md` 处理 escalation | skills/auto-dev/SKILL.md:36-38 | 新 escalation reason | 是 — 需区分 tribunal_subagent | 未覆盖 |
| `runTribunalVerdict()` (deprecated) | tribunal.ts:712+ | 使用 runTribunalWithRetry | 可能需要 — 取决于是否仍有调用方 | 未覆盖 |
| `auto_dev_tribunal_verdict` MCP tool | index.ts:1793 | 接收 subagent 裁决结果 | 无需修改（已有） | N/A |
| `tribunal.test.ts` 测试 | mcp/src/__tests__/tribunal.test.ts | 需新增测试用例 | 是 | 已覆盖 |
| `orchestrator.test.ts` 测试 | mcp/src/__tests__/orchestrator.test.ts | 需新增测试用例 | 是 | 已覆盖（AC-8） |
| `ship-integration-e2e.test.ts` mock | mcp/src/__tests__/ship-integration-e2e.test.ts:22 | mock evaluateTribunal | 可能需要 — 如果返回类型变化影响 mock | 未覆盖 |

### 无法验证的外部依赖

- `session-proxy` worker 注册名称 — 需确认 worker 注册时使用的 name 是否为 `tribunal-worker`，或需要新增专门的 tribunal worker 配置
- Hub 的 `PATCH /commands/:id` 响应格式 — 设计依赖 worker 通过此端点回传结果，需确认 result 字段格式是否与 TribunalVerdict 兼容

## 结论

**NEEDS_REVISION**

设计的整体方向正确（三级策略、Subagent 升级为默认），但存在以下阻塞性和重要问题需要修正：

1. **P0-1**: 引用了不存在的函数名 `runStepValidation()`，需修正为 `validateStep()` + `computeNextTask()`
2. **P0-2**: `subagentRequested` 从 `runTribunal()` 到 escalation 的完整数据传递链路未写清，每一层的变更都需要明确
3. **P1-3**: SKILL.md 作为 escalation 的最终消费者，未纳入改动范围——如果不修改 SKILL.md，`tribunal_subagent` escalation 会导致流程中断
