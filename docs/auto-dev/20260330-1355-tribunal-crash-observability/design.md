# Tribunal 崩溃可观测性改进 — 设计文档

**Topic**: tribunal-crash-observability
**日期**: 2026-03-30
**改动类型**: bugfix / refactor

---

## 1. 背景与目标

### 1.1 为什么做

在 tdd-gate、tribunal-resilience、tribunal 三个 retrospective 中反复出现 tribunal 进程崩溃（Phase 4 三连崩溃耗时 29 分钟，占总时间 48%）。当前 catch 块（`tribunal.ts:334` 的 `_stderr` 参数被忽略、`tribunal.ts:486-488` 的 `catch {}` 静默返回 null）丢弃了 stderr 内容和 exit code，导致：

1. **无法区分故障模式**：ENOENT（路径错误）、EPERM（权限问题）、E2BIG（prompt 过长/arg list too long）、SIGKILL（OOM）、超时等全部表现为同一个 "裁决进程执行失败" 错误信息。
2. **retry 策略盲目**：对于 E2BIG（参数过长）这类确定性故障，重试不会成功，但当前代码仍会消耗一次重试机会。
3. **progress-log 无审计痕迹**：tribunal 崩溃事件不会写入 progress-log，导致 retrospective 无法量化 tribunal 的可靠性。

### 1.2 做什么

1. 在 `runTribunal` 的 callback 中捕获并记录 stderr 和 exit code。
2. 引入错误分类函数，按 exit code / error.code / stderr 内容识别故障模式。
3. 在 `evaluateTribunal` 中，当 tribunal 崩溃时将故障摘要写入 progress-log。

### 1.3 Non-Goals（不做）

- 不改变 tribunal 的三级执行策略（Hub > Subagent > CLI）。
- 不引入新的外部依赖（如 winston、pino 等日志库）。
- 不改变 `TribunalVerdict` 的类型定义（保持向后兼容）。
- 不修改 Hub 路径的错误处理（Hub 路径有自己的 null-return 降级语义）。
- 不实现自动修复策略（如 prompt 过长时自动切换 file mode）——留给后续迭代。

---

## 2. 现状分析

### 2.1 涉及模块

| 文件 | 职责 | 问题点 |
|------|------|--------|
| `tribunal.ts:299-395` (`runTribunal`) | CLI spawn 裁决进程 | L334 callback 签名用 `_stderr` 忽略 stderr；L336-341 的 error path 不记录 stderr 和 exit code |
| `tribunal.ts:440-489` (`tryRunViaHub`) | Hub 模式执行 | L486-488 的 `catch {}` 静默返回 null，丢失异常信息 |
| `tribunal.ts:495-542` (`runTribunalWithRetryCli`) | CLI 重试逻辑 | L528-536 崩溃结果不含 stderr，retry 无法区分可重试 vs 不可重试故障 |
| `tribunal.ts:712-808` (`evaluateTribunal`) | 完整裁决流程 | 崩溃时不写 progress-log，retrospective 无法统计 tribunal 故障 |

### 2.2 当前错误信息流

```
exec/execFile callback
  -> err: Error | null, stdout: string, stderr: string
    -> 当前: err.message 仅包含 "Error: spawn ENOENT" 等简单字符串
    -> 丢失: stderr 内容、exit code、Node.js err.code
```

### 2.3 已知的故障模式

| 故障模式 | error.code | stderr 特征 | exit code | 当前表现 |
|---------|------------|------------|-----------|---------|
| Claude CLI 未安装 | `ENOENT` | 可能为空 | - | "spawn ENOENT" |
| 权限不足 | `EPERM` / `EACCES` | "Permission denied" | 126 | "spawn EACCES" |
| Prompt 过长（shell arg limit） | - | "arg list too long" | 127 (sh) | "Error: ... arg list too long" |
| 超时 | - | 可能为空 | null (Node) | "spawn ETIMEDOUT" 或空 |
| OOM / SIGKILL | `null` | "Killed" | 137 | "signal SIGKILL" |
| Claude CLI 内部错误 | - | 错误栈 | 1 | "Command failed: ..." |
| JSON 输出损坏 | - | 正常 | 0 | "JSON 解析失败" |

### 2.4 进度日志格式

progress-log 使用 HTML 注释格式记录事件：

```
<!-- CHECKPOINT phase=4 status=PASS summary="..." timestamp=... -->
<!-- MODE_UPGRADE turbo→quick reason="..." -->
```

自定义事件使用类似格式即可融入现有风格。

---

## 3. 方案设计

### 方案 A：分类函数 + enrich 错误信息 + progress-log 事件（推荐）

**核心思路**：新增一个纯函数 `classifyTribunalError`，将 `err / stdout / stderr / exitCode` 映射为结构化的 `TribunalCrashInfo`。在 `runTribunal` callback 中调用该函数，将分类结果写入 `TribunalVerdict.raw` 字段。在 `evaluateTribunal` 崩溃分支中，用 `appendToProgressLog` 记录故障摘要。

**数据模型**：

```typescript
interface TribunalCrashInfo {
  errorCategory: "cli_not_found" | "permission_denied" | "prompt_too_long"
               | "timeout" | "oom_killed" | "cli_internal_error"
               | "unknown";
  exitCode: number | null;
  errorCode: string | null;   // Node.js err.code (ENOENT, EPERM, etc.)
  stderrSnippet: string;      // stderr 前 500 字符
  isRetryable: boolean;       // 是否值得重试
}
```

**改动范围**：

| 文件 | 改动 |
|------|------|
| `tribunal.ts` | 新增 `classifyTribunalError()`；修改 `runTribunal` callback 使用 stderr；修改 `runTribunalWithRetryCli` 读取 `isRetryable`；修改 `evaluateTribunal` 崩溃分支写 progress-log |
| `tribunal.test.ts` | 新增 classifyTribunalError 测试、stderr 捕获测试、progress-log 写入测试 |

**优点**：
- 纯函数分类逻辑易于单元测试
- 不改变 `TribunalVerdict` 类型，向后兼容
- progress-log 事件可被 retrospective 统计
- `isRetryable` 标志让重试策略更智能（prompt 过长不重试）

**缺点**：
- 新增约 40 行分类函数 + 15 行类型定义
- `raw` 字段承载的信息变多，但本身是 string 类型，没有 schema 约束

### 方案 B：最小改动 — 仅 enrich raw 字段

**核心思路**：不新增类型定义和分类函数，直接在 `runTribunal` 的 error callback 中拼接 stderr 和 exit code 到 `raw` 字段。不改变重试逻辑，不写 progress-log。

**改动范围**：

| 文件 | 改动 |
|------|------|
| `tribunal.ts` | 修改 `runTribunal` callback：将 `_stderr` 改为 `stderr`，拼接到 `raw` 和 `issues[0].description` |

**优点**：
- 改动极小（约 5 行）
- 零风险，不引入新逻辑

**缺点**：
- 不解决问题 2（retry 盲目）和问题 3（无 audit trail）
- raw 字段变成大段 stderr，可读性差
- 无法按错误类型统计

### 方案对比

| 维度 | 方案 A（分类 + enrich + log） | 方案 B（最小改动） |
|------|------|------|
| 新增代码行数 | ~60 行 | ~5 行 |
| 故障可区分性 | 7 种故障模式清晰分类 | 仅记录 stderr 原文 |
| 重试策略优化 | 是（`isRetryable`） | 否 |
| progress-log 审计 | 是 | 否 |
| 向后兼容 | 完全兼容 | 完全兼容 |
| 测试覆盖 | 可单元测试分类函数 | 仅集成测试 |
| 风险等级 | 低（纯增量，不修改现有逻辑） | 极低 |

**选择方案 A**。理由：方案 B 不解决核心问题（retrospective 不可观测、retry 盲目），只是把 stderr 从丢弃变成了拼接到 raw，诊断价值有限。方案 A 的额外 55 行代码换来完整的可观测性，符合"不过度设计但解决实际问题"的原则。

---

## 4. 详细设计

### 4.1 classifyTribunalError 函数

新增导出函数，纯函数，无副作用。

**输入**：`err: Error | null`、`stderr: string`、`exitCode: number | null`

**输出**：`TribunalCrashInfo`

**分类规则**（按优先级）：

| 优先级 | 条件 | errorCategory | isRetryable |
|--------|------|---------------|-------------|
| 1 | `err.code === 'ENOENT'` | `cli_not_found` | false |
| 2 | `err.code === 'EPERM'` 或 `err.code === 'EACCES'` | `permission_denied` | false |
| 3 | stderr 包含 "arg list too long" 或 error.message 包含 "E2BIG" | `prompt_too_long` | false |
| 4 | error.message 包含 "ETIMEDOUT" 或 error.killed（Node timeout） | `timeout` | true |
| 5 | error.message 包含 "SIGKILL" 或 exitCode === 137 | `oom_killed` | true |
| 6 | exitCode !== 0 且 exitCode !== null | `cli_internal_error` | true |
| 7 | 以上都不匹配 | `unknown` | true |

stderr 截取前 500 字符存入 `stderrSnippet`。

### 4.2 runTribunal callback 修改

将 `_stderr` 改为 `stderr`，在 error 分支中：

1. 调用 `classifyTribunalError(err, stderr, exitCode)` 获取 `crashInfo`。
2. 将 `crashInfo` 序列化后写入 `raw` 字段（JSON 格式，便于下游解析）。
3. `issues[0].description` 中追加错误类别和 exit code。

具体变更：

- callback 签名：`(err, stdout, stderr)` （去掉下划线前缀）
- error path 的 `resolve()` 调用中，description 从 `裁决进程执行失败: ${err.message}` 改为 `裁决进程执行失败: [${crashInfo.errorCategory}] exit=${crashInfo.exitCode} ${err.message}`
- raw 字段从 `err.message` 改为 `JSON.stringify({ crashInfo, stderrSnippet: stderr.slice(0, 500), errMessage: err.message })`

### 4.3 runTribunalWithRetryCli 修改

在重试循环中，检查 `crashInfo.isRetryable`：

- 若 `isRetryable === false`，立即返回崩溃结果，不消耗重试次数。
- 若 `isRetryable === true`，保持现有重试逻辑。

crashInfo 从 `result.raw` 中解析（JSON.parse）。若解析失败，默认 `isRetryable = true`（保持现有行为）。

### 4.4 tryRunViaHub catch 块修改

`catch {}` 改为 `catch (err)`，将 `err.message` 追加到返回的 null 前打印一条 console.warn（MCP server 的 stderr 会显示在宿主进程日志中）。

不改返回值（仍返回 null 触发降级），仅增加 stderr 输出用于运维诊断。

### 4.5 evaluateTribunal 崩溃分支 — 写入 progress-log

在 `evaluateTribunal` 的 `crashed === true` 分支中（L766-768），调用 `appendToProgressLog` 写入 tribunal 故障事件：

```
<!-- TRIBUNAL_CRASH phase=4 category="cli_not_found" exitCode=1 retryable=false timestamp=... -->
Tribunal 崩溃: cli_not_found (exit=1). stderr: ...
```

此事件可被 retrospective 的 `generateRetrospectiveData` 函数（`retrospective-data.ts`）通过正则匹配 `TRIBUNAL_CRASH` 统计。

### 4.6 数据流图

```
exec/execFile callback (err, stdout, stderr)
  |
  +--> classifyTribunalError(err, stderr, exitCode)
  |      |
  |      +--> TribunalCrashInfo { errorCategory, exitCode, errorCode, stderrSnippet, isRetryable }
  |
  +--> runTribunal 返回 TribunalVerdict (raw 含 crashInfo JSON)
         |
         +--> runTribunalWithRetryCli
         |      |
         |      +--> 解析 crashInfo.isRetryable
         |      +--> false → 立即返回（不重试）
         |      +--> true  → 重试（现有逻辑）
         |
         +--> evaluateTribunal
                |
                +--> crashed === true
                |      +--> appendToProgressLog("<!-- TRIBUNAL_CRASH ... -->")
                +--> 返回 EvalTribunalResult
```

---

## 5. 影响分析

### 5.1 改动范围

| 文件 | 改动类型 | 预估行数 |
|------|---------|---------|
| `tribunal.ts` | 修改 + 新增 | +55 行 |
| `tribunal.test.ts` | 新增测试 | +80 行 |
| **总计** | | **~135 行** |

### 5.2 兼容性

- `TribunalVerdict` 类型不变，所有下游消费者（orchestrator.ts、index.ts）无需修改。
- `EvalTribunalResult` 类型不变。
- `runTribunalWithRetry` 返回类型不变（`{ verdict, crashed, rawParseFailure, subagentRequested }`）。
- progress-log 新增 `TRIBUNAL_CRASH` 注释行，现有 CHECKPOINT 正则不受影响（`retrospective-data.ts` 用的是 `CHECKPOINT phase=` 前缀）。

### 5.3 迁移路径

无需迁移。改动是纯增量的：
1. 新增 `classifyTribunalError` 函数和 `TribunalCrashInfo` 类型。
2. 修改已有函数内部实现（不改变签名和返回类型）。

### 5.4 回滚方案

所有改动在 `tribunal.ts` 中。回滚只需 git revert 对应 commit。不涉及数据库、配置文件或外部依赖变更。

---

## 6. 风险与缓解

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| `classifyTribunalError` 分类规则不完整，某些故障无法识别 | 中 | 低 — 未识别的归入 `unknown`，isRetryable=true（保守策略，保持现有行为） | 分类函数独立、易扩展，后续可按 retrospective 中积累的 unknown 样本迭代 |
| `JSON.parse(raw)` 在 `runTribunalWithRetryCli` 中解析失败 | 低 | 低 — fallback 到 isRetryable=true | 用 try-catch 包裹 JSON.parse，解析失败时保守重试 |
| progress-log 膨胀（每次崩溃追加 1-2 行） | 低 | 低 — tribunal 崩溃频率本身不高（否则应修复根因） | stderrSnippet 限制 500 字符 |
| stderr 内容可能包含敏感信息（文件路径、API key） | 低 | 中 — 仅写入本地 progress-log.md，不上传 | stderrSnippet 截取 500 字符，且 progress-log 本身就在项目 .gitignore 中（docs/auto-dev/ 通常 gitignored） |

---

## 7. 验收标准

| AC | 描述 | 验证方式 |
|----|------|---------|
| AC-1 | `classifyTribunalError` 对 `err.code === 'ENOENT'` 返回 `errorCategory: "cli_not_found"`, `isRetryable: false` | 单元测试 |
| AC-2 | `classifyTribunalError` 对 stderr 含 "arg list too long" 返回 `errorCategory: "prompt_too_long"`, `isRetryable: false` | 单元测试 |
| AC-3 | `classifyTribunalError` 对 `err.message` 含 "SIGKILL" 返回 `errorCategory: "oom_killed"`, `isRetryable: true` | 单元测试 |
| AC-4 | `classifyTribunalError` 对无法识别的错误返回 `errorCategory: "unknown"`, `isRetryable: true` | 单元测试 |
| AC-5 | `runTribunal` 在进程错误时，返回的 `issues[0].description` 包含错误类别（如 `[cli_not_found]`）和 exit code | 单元测试（mock execFile 返回 ENOENT 错误） |
| AC-6 | `runTribunal` 在进程错误时，返回的 `raw` 字段是合法 JSON，包含 `crashInfo` 和 `stderrSnippet` | 单元测试 |
| AC-7 | `runTribunalWithRetryCli` 在遇到 `isRetryable: false` 的错误时，不执行重试（仅调用一次 `runTribunal`） | 单元测试（mock execFile 返回 ENOENT，验证 mock 只被调用 1 次） |
| AC-8 | `runTribunalWithRetryCli` 在遇到 `isRetryable: true` 的错误时，执行重试（调用 2 次 `runTribunal`） | 单元测试（mock execFile 返回 SIGKILL，验证 mock 被调用 2 次） |
| AC-9 | `evaluateTribunal` 在 tribunal 崩溃时，向 progress-log.md 追加包含 `<!-- TRIBUNAL_CRASH` 的注释行 | 集成测试（临时目录 + mock runTribunalWithRetry 返回 crashed=true，读取 progress-log 验证内容） |
| AC-10 | `tryRunViaHub` 在 catch 到异常时，不抛出错误，仍返回 null 触发降级 | 单元测试（mock hubClient 抛出异常，验证返回 null 且无 unhandled rejection） |
| AC-11 | 已有测试全部通过（`classifyTribunalError` 的引入不破坏任何现有测试） | `npm test` |
