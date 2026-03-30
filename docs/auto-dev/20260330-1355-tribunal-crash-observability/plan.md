# Implementation Plan: tribunal-crash-observability

**基于设计文档**: `design.md`
**审查修正**: `design-review.md`（P0-1: progress-log 写入移至 orchestrator.ts crashed 分支）
**改动总量**: ~135 行（tribunal.ts +55, orchestrator.ts +5, tribunal.test.ts +75）

---

## Task 1: 新增 TribunalCrashInfo 类型和 classifyTribunalError 纯函数

- **描述**: 在 `tribunal.ts` 中新增 `TribunalCrashInfo` 接口和 `classifyTribunalError` 纯函数。该函数接收 `err`、`stderr`、`exitCode`，返回分类后的 `TribunalCrashInfo` 对象（含 errorCategory、exitCode、errorCode、stderrSnippet、isRetryable）。按优先级匹配 7 种故障模式。
- **文件**:
  - `mcp/src/tribunal.ts` — 在 CRASH_INDICATORS 常量（L276-279）之后新增接口和函数
- **依赖**: 无
- **完成标准**: `classifyTribunalError` 函数已导出，对 ENOENT 返回 `cli_not_found`/`isRetryable: false`，对 SIGKILL 返回 `oom_killed`/`isRetryable: true`，对未知错误返回 `unknown`/`isRetryable: true`

## Task 2: 修改 runTribunal callback — 捕获 stderr 并调用分类函数

- **描述**: 将 `runTribunal` callback 签名中的 `_stderr` 改为 `stderr`。在 error 分支（L335-341）中调用 `classifyTribunalError` 获取 crashInfo，将错误类别和 exit code 追加到 `issues[0].description`，将 crashInfo 序列化为 JSON 写入 `raw` 字段。结构统一为 `{ crashInfo, errMessage }`，不冗余 stderrSnippet（P1-1 修复）。
- **文件**:
  - `mcp/src/tribunal.ts` — 修改 L334-341 的 callback 签名和 error 分支逻辑
- **依赖**: Task 1
- **完成标准**: 进程错误时 `issues[0].description` 包含 `[errorCategory]` 和 `exit=`；`raw` 字段是合法 JSON，包含 `crashInfo` 和 `errMessage`

## Task 3: 修改 runTribunalWithRetryCli — isRetryable 判断跳过不可重试故障

- **描述**: 在 `runTribunalWithRetryCli` 的重试循环中，当检测到 `isCrash === true` 时，尝试从 `result.raw` 中 JSON.parse 获取 crashInfo。若 crashInfo.isRetryable === false，立即返回崩溃结果，不消耗重试次数。JSON.parse 失败时 fallback 到 isRetryable=true（保持现有行为）。添加注释说明只在 isCrash 分支中执行此解析。
- **文件**:
  - `mcp/src/tribunal.ts` — 修改 L514-524 的 isCrash 分支，在 `attempt < MAX_RETRIES` 判断之前插入 isRetryable 检查
- **依赖**: Task 2
- **完成标准**: ENOENT 错误只调用一次 runTribunal（不重试）；SIGKILL 错误调用两次 runTribunal（重试一次）

## Task 4: 修改 tryRunViaHub catch 块 — 记录异常信息

- **描述**: 将 `tryRunViaHub` 的 `catch {}`（L486-488）改为 `catch (err)`，添加 `console.warn` 输出 hub 失败信息。不改返回值（仍返回 null 触发降级）。注意：console.warn 在 MCP server 环境中可能不可见（P1-3 已知限制），但作为最低成本的诊断手段仍然有价值。
- **文件**:
  - `mcp/src/tribunal.ts` — 修改 L486-488
- **依赖**: 无（独立于 Task 1-3）
- **完成标准**: hub 异常时 console.warn 输出 err.message，返回值仍为 null，无 unhandled rejection

## Task 5: 在 orchestrator.ts crashed 分支写入 TRIBUNAL_CRASH progress-log 事件

- **描述**: 在 orchestrator.ts 的 `validation.tribunalResult.crashed` 分支（L956-972）中，在 `sm.atomicUpdate` 调用之后，调用 `sm.appendToProgressLog` 写入 TRIBUNAL_CRASH 事件。事件格式：`<!-- TRIBUNAL_CRASH phase=N timestamp=ISO -->\nTribunal 崩溃，需要 fallback 裁决。\n`。这是 P0-1 的修正实现：progress-log 写入从 evaluateTribunal 上移到 orchestrator，保持 evaluateTribunal 的纯函数性质。
- **文件**:
  - `mcp/src/orchestrator.ts` — 在 L957-972 的 crashed 分支中，L957 atomicUpdate 之后插入 appendToProgressLog 调用
- **依赖**: Task 2（runTribunal 返回的 raw 中含 crashInfo）
- **完成标准**: tribunal 崩溃时 progress-log.md 中出现 `<!-- TRIBUNAL_CRASH phase=N timestamp=... -->` 注释行

## Task 6: classifyTribunalError 单元测试

- **描述**: 为 `classifyTribunalError` 编写单元测试覆盖所有 7 种分类规则：ENOENT -> cli_not_found、EPERM -> permission_denied、arg list too long -> prompt_too_long、ETIMEDOUT -> timeout、SIGKILL -> oom_killed、exitCode != 0 -> cli_internal_error、不匹配 -> unknown。同时测试 isRetryable 的正反向场景。
- **文件**:
  - `mcp/src/__tests__/tribunal.test.ts` — 在文件末尾新增 describe("classifyTribunalError") 块
  - `mcp/src/tribunal.ts` — 确保 classifyTribunalError 已导出
- **依赖**: Task 1
- **完成标准**: 7 种分类规则各有对应测试用例通过，覆盖 AC-1 到 AC-4

## Task 7: runTribunal stderr 捕获和 crashInfo enrich 测试

- **描述**: 编写测试验证 runTribunal 在进程错误时的行为：description 包含错误类别和 exit code（AC-5），raw 字段是合法 JSON 含 crashInfo（AC-6）。需要 mock execFile 返回带 code 属性的 Error 对象和 stderr 内容。
- **文件**:
  - `mcp/src/__tests__/tribunal.test.ts` — 在现有 "runTribunal — Output Parsing" describe 块中新增测试用例
- **依赖**: Task 2
- **完成标准**: mock execFile 返回 ENOENT 错误时，result.issues[0].description 包含 `[cli_not_found]`，result.raw 是合法 JSON

## Task 8: runTribunalWithRetryCli isRetryable 跳过重试测试

- **描述**: 编写测试验证 retry 行为：ENOENT（isRetryable=false）只调用一次 runTribunal（AC-7），SIGKILL（isRetryable=true）调用两次（AC-8）。验证 callCount。
- **文件**:
  - `mcp/src/__tests__/tribunal.test.ts` — 在现有 "runTribunalWithRetry — Crash Detection and Retry" describe 块中新增测试用例
- **依赖**: Task 3
- **完成标准**: ENOENT mock 验证 callCount=1，SIGKILL mock 验证 callCount=2

## Task 9: orchestrator progress-log TRIBUNAL_CRASH 写入测试

- **描述**: 编写测试验证 orchestrator 在 tribunal crashed 时写入 TRIBUNAL_CRASH 事件到 progress-log。需要 mock evaluateTribunal 返回 crashed=true，然后读取 progress-log 验证包含 `<!-- TRIBUNAL_CRASH` 注释。覆盖 AC-9。
- **文件**:
  - `mcp/src/__tests__/orchestrator.test.ts` — 新增或扩展 tribunal crashed 相关测试用例
- **依赖**: Task 5
- **完成标准**: progress-log.md 中包含 `<!-- TRIBUNAL_CRASH phase=N timestamp=... -->`

## Task 10: tryRunViaHub catch 块行为测试

- **描述**: 编写测试验证 tryRunViaHub 在 hub 抛出异常时仍返回 null（不抛出），且 console.warn 被调用。覆盖 AC-10。
- **文件**:
  - `mcp/src/__tests__/tribunal.test.ts` — 新增 tryRunViaHub 相关测试用例（需 mock hubClient）
- **依赖**: Task 4
- **完成标准**: mock hubClient 抛出异常时，返回 null，console.warn 被调用一次

## Task 11: 回归验证 — 全量测试通过

- **描述**: 运行 `npm test` 确认所有已有测试通过，新增代码不破坏现有功能。覆盖 AC-11。如果发现已有测试失败，分析原因并修复。
- **文件**: 无新增文件
- **依赖**: Task 1-10 全部完成
- **完成标准**: `npm test` 输出所有测试通过，无 regression

---

## 任务依赖关系

```
Task 1 (类型+分类函数) ──> Task 2 (runTribunal callback) ──> Task 3 (retry isRetryable) ──> Task 8 (retry 测试)
                  |                    |                                               |
                  +--> Task 6 (分类函数测试)   +--> Task 5 (orchestrator progress-log) ──> Task 9 (progress-log 测试)
                                       |                              ^
                                       |                              |
                                       +-------------------------------+
                                       (Task 5 也依赖 Task 2 的 raw 格式)
Task 4 (tryRunViaHub catch) ──> Task 7 (stderr 捕获测试)    Task 10 (tryRunViaHub 测试)

Task 11 (回归验证) 依赖 Task 1-10 全部完成
```

## 关键路径

**Task 1 -> Task 2 -> Task 3 -> Task 8**（分类函数 -> callback enrich -> retry 逻辑 -> retry 测试）是关键路径，串联了核心功能的实现和验证。

## 审查修正落实

| 审查问题 | 处理方式 | 落实任务 |
|---------|---------|---------|
| P0-1: evaluateTribunal 纯函数不能写 progress-log | progress-log 写入移至 orchestrator.ts L956-972 crashed 分支 | Task 5 |
| P1-1: raw JSON 结构冗余 | 统一为 `{ crashInfo, errMessage }`，不冗余 stderrSnippet | Task 2 |
| P1-2: executeTribunal deprecated 路径 | 不在本次改进范围内，在设计中注明 | 不新增任务 |
| P1-3: console.warn 可能不可见 | 作为最低成本诊断手段仍实施，已知限制 | Task 4 |

## Non-Goals 确认

- 不修改 executeTribunal（deprecated 路径，P1-2 明确排除）
- 不修改 retrospective-data.ts 的 TRIBUNAL_CRASH 解析（后续迭代）
- 不改变 TribunalVerdict 类型定义
- 不引入新外部依赖
