# Tribunal Crash Observability — 方案计划

## 背景

当前 tribunal 进程崩溃时，仅记录一个笼统的 "裁决进程执行失败" 错误信息，缺乏可观测性：
- 无法区分 ENOENT（CLI 未安装）、EPERM（权限不足）、OOM 等不同故障模式
- 不可重试的故障（如 CLI 不存在）仍触发重试，浪费资源
- orchestrator 的 crashed 分支未写入 progress-log，审计链断裂
- `evaluateTribunal` 是纯函数，不应调用 `appendToProgressLog`（P0 修正）

## 方案对比

| 维度 | 方案 A: crashInfo 内嵌 verdict.raw | 方案 B: 独立 crashInfo 字段 |
|------|----------------------------------|---------------------------|
| 数据流 | crashInfo JSON 序列化到 verdict.raw | EvalTribunalResult 新增 crashRaw 字段透传 |
| 纯函数边界 | 纯函数内完成分类，不涉及 IO | 同 A |
| orchestrator 改动 | 从 verdict.raw 解析 | 从 crashRaw 解析 |
| 向后兼容 | raw 字段已有，格式变更 | 新增可选字段，完全兼容 |
| 侵入性 | 低（只改 raw 格式） | 中（改接口 + 两处透传） |

**选择方案 B**：虽然多一个字段，但数据流更清晰——raw 给 tribunal 日志，crashRaw 专门给 orchestrator 的 progress-log 写入。避免 raw 字段语义混淆。

## 主方案实现细节

### 1. TribunalCrashInfo 接口 + classifyTribunalError 纯函数

```typescript
export interface TribunalCrashInfo {
  errorCategory: "ENOENT" | "EPERM" | "prompt-too-long" | "timeout" | "OOM" | "cli-internal" | "unknown";
  isRetryable: boolean;
  exitCode: number | null;
  stderrSnippet: string;
  errMessage: string;
}

export function classifyTribunalError(err: Error, stderr: string, exitCode: number | null): TribunalCrashInfo
```

7 种故障模式分类：
| errorCategory | 匹配规则 | isRetryable |
|---|---|---|
| ENOENT | err.message 包含 "ENOENT" 或 "not found" | false |
| EPERM | err.message 包含 "EPERM" 或 "permission denied" | false |
| prompt-too-long | err.message 包含 "E2BIG" 或 stderr 包含 "argument list too long" | false |
| timeout | exitCode === null 或 err.message 包含 "ETIMEDOUT" 或 "SIGKILL" | true |
| OOM | exitCode === 137 或 stderr 包含 "out of memory" 或 "OOM" | true |
| cli-internal | exitCode === 1 或 2 且 stderr 非空 | true |
| unknown | 以上均不匹配 | true |

### 2. runTribunal callback 改造

在 err 分支中：
1. 捕获完整 `_stderr` 和从 `err` 推断 exitCode
2. 调用 `classifyTribunalError(err, stderr, exitCode)`
3. 将 crashInfo 写入 `verdict.raw`（JSON 格式 `{ crashInfo, errMessage }`）

### 3. runTribunalWithRetryCli isRetryable 判断

从 `result.raw` 解析 crashInfo：
- 如果 `crashInfo.isRetryable === false`：跳过重试，直接返回 crashed 结果
- 否则：保持现有重试逻辑

### 4. tryRunViaHub catch 块

从 `catch {}` 改为 `catch (err)`，添加 `console.warn("[tryRunViaHub] Hub 执行失败，降级到 subagent:", err)`

### 5. EvalTribunalResult 新增 crashRaw 字段

在 evaluateTribunal 的 crashed 分支（L766-768），将 `verdict.raw` 透传为 `crashRaw`。

### 6. orchestrator progress-log 写入

在 orchestrator.ts 的 crashed 分支（约 L956-973），从 `tribunalResult.crashRaw` 解析 crashInfo，调用 `sm.appendToProgressLog` 写入：
```
<!-- TRIBUNAL_CRASH phase=N category="..." exitCode=N retryable=... -->
```

## 备选方案

方案 C: 使用 Event Emitter 解耦
- tribunal 模块 emit crash 事件，orchestrator 监听
- 优点：完全解耦
- 缺点：引入事件系统复杂度，纯函数约束难以维护
- 结论：过度设计，不采用

## 验收标准

1. classifyTribunalError 覆盖全部 7 种故障模式 + unknown fallback
2. 不可重试故障（ENOENT/EPERM/prompt-too-long）不触发重试
3. tribunal 崩溃时 progress-log 包含 TRIBUNAL_CRASH 注释行
4. evaluateTribunal 保持纯函数，不调用 StateManager
5. tryRunViaHub catch 不再静默，有 console.warn
6. 全量测试通过，0 失败
