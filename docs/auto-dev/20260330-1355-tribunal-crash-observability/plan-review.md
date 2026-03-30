# Plan Review: tribunal-crash-observability

**审查对象**: `plan.md`
**对照文档**: `design.md`
**日期**: 2026-03-30

---

## P0 (阻塞性问题)

### P0-1: Task 5 数据源缺失 -- evaluateTribunal crashed 分支未传递 crashInfo

**问题**: Task 5 计划在 `orchestrator.ts` 的 crashed 分支（L956-972）写入包含 `category`、`exitCode`、`retryable` 的 TRIBUNAL_CRASH progress-log 事件。但追踪完整数据流后发现，这些字段在到达 orchestrator 之前就已经丢失了。

**数据流追踪**:
1. `runTribunal` callback (Task 2) 将 crashInfo 写入 `verdict.raw`（JSON 格式） -- 正确
2. `runTribunalWithRetryCli` L527-537 在 crashed 分支返回 `{ verdict: {..., raw: result.raw}, crashed: true }` -- raw 保留
3. `evaluateTribunal` L766-768 在 crashed 分支返回 `{ verdict: "FAIL", issues: [], crashed: true, digest, digestHash }` -- **raw 字段被丢弃**
4. `EvalTribunalResult` 接口没有 `raw` 字段 -- 无法传递
5. orchestrator 通过 `validation.tribunalResult` 只能拿到 `crashed: true` + `digest` + `digestHash`

**结果**: Task 5 无法从 `validation.tribunalResult` 获取 crashInfo，写出的 TRIBUNAL_CRASH 事件只能包含 `phase` 和 `timestamp`，不包含 `category`、`exitCode`、`retryable`，直接违反设计文档 4.5 节的事件格式和 AC-9。

**修复建议**:
- 方案 A（推荐）: 在 `evaluateTribunal` L768 的 crashed 分支中，将 `verdict.raw`（含 crashInfo JSON）透传到 `EvalTribunalResult`。具体做法：在 `EvalTribunalResult` 接口中新增可选字段 `crashRaw?: string`，在 crashed 分支赋值为 `verdict.raw`。对应新增一个 Task（或合并到 Task 5），修改 `tribunal.ts` L768 和接口定义。
- 方案 B: 不修改 `EvalTribunalResult`，在 Task 5 中让 orchestrator 直接解析 `validation.tribunalResult.digest` 中是否包含 crashInfo。但 digest 是 tribunal 的输入材料，不是输出，不可行。

**影响范围**: `tribunal.ts` EvalTribunalResult 接口 + evaluateTribunal L768 + orchestrator.ts Task 5

---

## P1 (重要问题)

### P1-1: 依赖关系图 Task 4 -> Task 7 连线错误

**问题**: 依赖关系图中 `Task 4 (tryRunViaHub catch) ──> Task 7 (stderr 捕获测试)` 的连线是错误的。Task 7 描述的是测试 `runTribunal` 的 stderr 捕获和 crashInfo enrich（AC-5, AC-6），这属于 Task 2 的测试，不是 Task 4 的测试。Task 7 自身的依赖字段也明确标注为 "依赖: Task 2"。

**修复建议**: 将依赖关系图中的 `Task 4 ──> Task 7` 改为 `Task 2 ──> Task 7`（与 Task 7 的描述一致）。Task 4 只连接到 Task 10（tryRunViaHub 测试）。

### P1-2: Task 3 行号引用偏差

**问题**: Task 3 描述中引用 "修改 L514-524 的 isCrash 分支"，但根据源码，isCrash 检测在 L514-516，retry 判断在 L520-524。插入 isRetryable 检查的位置应在 L516 之后、L520 之前（即 `if (!isCrash)` 判断之后、`if (attempt < MAX_RETRIES)` 之前），而非 Task 描述的 "在 `attempt < MAX_RETRIES` 判断之前"。描述中的位置虽然与实际意图一致，但引用的行号范围不够精确，可能导致实现者误判插入点。

**修复建议**: 将 Task 3 的行号引用更新为更精确的 "L518-520 之间（isCrash 为 true 时、进入 retry 之前）"。

### P1-3: Task 7 描述与依赖图不一致

**问题**: Task 7 描述中写 "依赖: Task 2"，但依赖关系图画的是 `Task 4 ──> Task 7`。虽然 Task 7 实际确实依赖 Task 2（测试的是 Task 2 的 runTribunal stderr 捕获功能），但文字和图表的不一致会在执行时造成困惑。

**修复建议**: 这是 P1-1 的同一个问题的不同表现，修正 P1-1 即可消除此不一致。

---

## P2 (优化建议)

### P2-1: Task 5 的事件格式建议增加 crashInfo 可选字段

设计文档 4.5 节的事件格式为:
```
<!-- TRIBUNAL_CRASH phase=4 category="cli_not_found" exitCode=1 retryable=false timestamp=... -->
```

但 Task 5 的描述简化为:
```
<!-- TRIBUNAL_CRASH phase=N timestamp=ISO -->
```

在 P0-1 修复后，建议 Task 5 的描述恢复完整的事件格式，使 progress-log 事件包含 category、exitCode、retryable 字段，与设计文档一致。

### P2-2: 建议增加 integration/smoke test 任务

当前计划中 Task 11（回归验证）仅运行 `npm test`。考虑到 `classifyTribunalError` 和 retry isRetryable 逻辑对 tribunal 崩溃恢复的正确性至关重要，建议在 Task 11 中明确包含一个端到端验证步骤：设置 `TRIBUNAL_MODE=cli` 并 mock 一个不存在的 CLI 路径，验证 `isRetryable=false` 时不会产生 3 秒等待和不必要的重试。

### P2-3: Task 2 的 raw 字段序列化格式应在 Task 中明确

Task 2 描述中提到 "将 crashInfo 序列化后写入 raw 字段（JSON 格式）"，且 P1-1 修正为 `{ crashInfo, errMessage }`。但 Task 3 中解析 raw 的代码需要与 Task 2 的写入格式完全一致。建议在 Task 2 或 Task 3 中用代码注释标明 JSON 的 key 名称（如 `crashInfo` 和 `errMessage`），确保写入和解析两侧对齐。

---

## Coverage Matrix

| 设计章节/功能点 | 对应任务 | 覆盖状态 |
|----------------|---------|---------|
| 4.1 classifyTribunalError 函数 | Task 1 (实现) + Task 6 (测试) | 完整覆盖 |
| 4.2 runTribunal callback 修改 | Task 2 (实现) + Task 7 (测试) | 完整覆盖 |
| 4.3 runTribunalWithRetryCli isRetryable | Task 3 (实现) + Task 8 (测试) | 完整覆盖 |
| 4.4 tryRunViaHub catch 块修改 | Task 4 (实现) + Task 10 (测试) | 完整覆盖 |
| 4.5 evaluateTribunal 崩溃分支 -- progress-log | Task 5 (实现) + Task 9 (测试) | **不完整** (P0-1) |
| 4.6 数据流图 (crashInfo 传递链) | Task 1-5 串联 | **断裂** (P0-1) |
| AC-1 ENOENT 分类 | Task 6 | 覆盖 |
| AC-2 prompt_too_long 分类 | Task 6 | 覆盖 |
| AC-3 oom_killed 分类 | Task 6 | 覆盖 |
| AC-4 unknown 分类 | Task 6 | 覆盖 |
| AC-5 description 含错误类别 | Task 7 | 覆盖 |
| AC-6 raw 是合法 JSON | Task 7 | 覆盖 |
| AC-7 isRetryable=false 不重试 | Task 8 | 覆盖 |
| AC-8 isRetryable=true 重试 | Task 8 | 覆盖 |
| AC-9 progress-log 含 TRIBUNAL_CRASH | Task 9 | **部分覆盖** (P0-1: 缺少 category/exitCode/retryable) |
| AC-10 tryRunViaHub 返回 null | Task 10 | 覆盖 |
| AC-11 全量测试通过 | Task 11 | 覆盖 |
| 非功能需求: 不引入外部依赖 | 所有 Task | 覆盖 |
| 非功能需求: 不改变 TribunalVerdict 类型 | 所有 Task | 覆盖 |
| 非功能需求: 不改变执行策略 | 所有 Task | 覆盖 |

---

## 结论

**NEEDS_REVISION**

存在 1 个 P0 阻塞问题：Task 5 的 progress-log 写入缺少 crashInfo 数据源，`evaluateTribunal` 的 crashed 分支丢弃了 `verdict.raw`，导致 orchestrator 无法获取分类信息。需要新增或修改 Task 来修复 evaluateTribunal 到 orchestrator 之间的数据传递。

P0-1 修复后，需同步更新 Task 5 的事件格式描述和 Task 9 的测试验证内容。

P1 问题（依赖图连线错误）不阻塞实施，但建议在执行前修正以避免执行者困惑。
