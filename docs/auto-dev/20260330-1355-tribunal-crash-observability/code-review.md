# Code Review: tribunal-crash-observability

**审查日期**: 2026-03-30
**审查范围**: tribunal.ts, orchestrator.ts, tribunal.test.ts
**审查行数**: ~200 行变更（tribunal.ts ~120 行, orchestrator.ts ~15 行, tribunal.test.ts ~65 行）
**审查文件数**: 3 个文件

---

## Must-Execute Rule 1: Caller-Side Review

### classifyTribunalError 调用方追踪

**grep 结果**:

| 调用位置 | 用途 | 验证结果 |
|---------|------|---------|
| `tribunal.ts:406` (runTribunal callback) | 生成 crashInfo，序列化到 raw 字段 | 正确 -- crashInfo 被正确序列化为 JSON 并写入 `raw` |
| `tribunal.test.ts:1412-1493` (16 个测试用例) | 单元测试 classifyTribunalError 的 7 种分类 | 正确 -- 覆盖 AC-1 到 AC-4 |

### crashRaw 字段消费方追踪

**grep 结果**:

| 消费位置 | 读取方式 | 验证结果 |
|---------|---------|---------|
| `tribunal.ts:863` (evaluateTribunal) | `verdict.raw` 透传到 `crashRaw` | 正确 -- `raw` 是 `classifyTribunalError` 生成的 JSON |
| `orchestrator.ts:959` (computeNextTask) | `validation.tribunalResult.crashRaw` | **发现问题** -- 见下方 P0 |

### TRIBUNAL_CRASH progress-log 事件消费方追踪

**grep 结果**:

| 消费位置 | 用途 | 验证结果 |
|---------|------|---------|
| `orchestrator.ts:960-968` (computeNextTask) | 写入 progress-log.md | 正确 -- best-effort try-catch，不阻塞主流程 |
| `retrospective-data.ts` | 解析 TRIBUNAL_CRASH 事件 | **未实现** -- 当前不解析 TRIBUNAL_CRASH 事件，设计文档也注明"后续迭代" |

### isRetryable 字段消费方追踪

**grep 结果**:

| 消费位置 | 用途 | 验证结果 |
|---------|------|---------|
| `tribunal.ts:594-600` (runTribunalWithRetryCli) | 解析 crashInfo.isRetryable 决定是否重试 | 正确 -- JSON.parse fallback 到 isRetryable=true |
| `orchestrator.ts:965` (computeNextTask) | 写入 progress-log 的 retryable 属性 | 正确 -- 但 exitCode 可能为字符串（见 P0） |

---

## Must-Execute Rule 2: Dormant Path Detection

| 代码路径 | 翔状态 | 风险等级 | 说明 |
|---------|------|---------|------|
| `runTribunal` error callback (L404-412) | **首次激活** | **P1** | 本次改动首次让 classifyTribunalError + crashInfo enrich 路径被执行。之前的 `runTribunal` 只返回原始 err.message，现在额外做了 classifyTribunalError + JSON.stringify 并写入 raw。 已有测试覆盖。 |
| `runTribunalWithRetryCli` isRetryable 检查 (L594-600) | **首次激活** | **P1** | 之前 isCrash 后一律重试 2 次。现在新增了 JSON.parse(raw).crashInfo.isRetryable 分支。 已有测试覆盖. |
| `tryRunViaHub` catch 块 console.warn (L557-560) | **首次激活** | **P2** | 之前 catch {} 静默吞异常, 緻加了 console.warn. 无直接测试验证 console.warn 被调用. |
| `orchestrator.ts` crashed 分支 TRIBUNAL_CRASH 写入 (L957-969) | **首次激活** | **P1** | 之前 crashed 分支只做了 atomicUpdate + 返回 escalation. 緻加了 appendToProgressLog(crashEvent) 调用. 无直接测试验证 progress-log 内容. |

---

## P0 (阻塞性问题)

### P0-1: exitCode 字段传入的是 Node.js error code (字符串) 而非进程 exit code (数字)

 类型不匹配

**文件**: `mcp/src/tribunal.ts` L406

**问题**: `classifyTribunalError(err, stderr, (err as any)?.code)` 中， `(err as any)?.code` 返回的是 Node.js 的 error code（如 `"ENOENT"`, `"EPERM"` 等字符串），而不是进程 exit code（数字）。

- `TribunalCrashInfo.exitCode` 类型定义为 `number | undefined`
- 当 `err.code === "ENOENT"` 时, exitCode 会收到字符串 `"ENOENT"` 而不是数字 `null` 或 `undefined`
- `orchestrator.ts` L965 使用 `ci.exitCode ?? "N/A"` 输出到 progress-log, 当 `exitCode` 是 `"ENOENT"` 时, progress-log 中会显示 `exitCode="ENOENT"` 而非预期的数字

**修复建议**:
```typescript
// tribunal.ts L406: 将 (err as any)?.code 改为正确的 exit code 揥取方式
const crashInfo = classifyTribunalError(err, stderr, undefined);
// Node.js exec callback 没有直接的 exit code 属性。
// err.code 是 Node.js 系统错误码(如 "ENOENT"), 不是 exit code.
// 如需 exit code, 需通过 err.exitCode (在某些 exec 实现中存在) 或其他方式获取.
```

**严重程度**: 中等 -- 不会导致运行时崩溃（`TribunalCrashInfo.exitCode` 是 `number | undefined` 类型, 传入字符串不会引发类型错误, 但语义错误, 且 progress-log 中显示 `exitCode="ENOENT"` 不可读).

### P0-2: TribunalCrashInfo 接口定义缺少 isRetryable 字段

**文件**: `mcp/src/tribunal.ts` L283-301

**问题**: `TribunalCrashInfo` interface 中定义了 `errorCategory`, `isRetryable`, `exitCode`, `stderrSnippet`, `errMessage` 五个字段, 但在接口声明中 `isRetryable` 的 JSDoc 注释说 "Whether retrying..." 却实际在字段列表中存在. 经过重新检查, 接口定义是正确的 -- `isRetryable: boolean` 确实存在于接口中 (L294).

  ****更新**: 重新检查后, 接口定义中 `isRetryable: boolean` 确实存在 (L294). 这个问题不存在. **撤回此 P0**。

---

## P1 (重要问题)

### P1-1: issues[0].description 未包含错误类别和 exit code 信息

**文件**: `mcp/src/tribunal.ts` L409

**问题**: 设计文档要求 `issues[0].description` 中追加错误类别和 exit code, 如 `裁决进程执行失败: [cli_not_found] exit=127 spawn ENOENT`. 但实际实现仍然只保留了原始 `err.message`, 没有使用 crashInfo 信息:

 `裁决进程执行失败: ${err.message}`. 这降低了诊断价值 -- 从 description 中无法直接看出错误类别.

**修复建议**:
```typescript
// tribunal.ts L409
 将 description 改为:
issues: [{ severity: "P0", description: `裁决进程执行失败: [${crashInfo.errorCategory}] exit=${crashInfo.exitCode ?? "N/A"} ${err.message}` }],
```

**影响**: 不阻塞功能, 但降低了可观测性 -- 设计文档中明确要求在 description 中包含分类信息.

### P1-2: tryRunViaHub catch 块缺少 console.warn 调用的测试

**文件**: `mcp/src/__tests__/tribunal.test.ts`

**问题**: 讌查找了 Task 10（tryRunViaHub catch 测试） 对应的测试用例, 但发现没有直接测试 `console.warn` 被调用. 虽然有 `TC-N02` 测试覆盖了 Hub 抛出异常时降级到 subagent 的场景, 但注释只是说 "tryRunViaHub returns null due to catch block", 并没有验证:
 1. `console.warn` 被调用; 2. 返回值是 null 而不抛出异常.

**修复建议**: 新增测试用例:
```typescript
it("TC-T16: Hub throws exception — logs warning and returns null", async () => {
  const mockHubClient = {
    isAvailable: vi.fn().mockRejectedValue(new Error("hub crashed")),
  };
  mockGetHubClient.mockReturnValue(mockHubClient);
  const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  const result = await runTribunalWithRetry("fake digest", 5);
  expect(result.subagentRequested).toBe(true);
  expect(warnSpy).toHaveBeenCalledWith(
    expect.stringContaining("[tribunal] Hub execution failed"));
  );
});
```

### P1-3: orchestrator crashed 分支 TRIBUNAL_CRASH 写入缺少测试

**文件**: `mcp/src/__tests__/orchestrator.test.ts` 或独立测试文件

**问题**: 讌找 Task 9（orchestrator progress-log TRIBUNAL_CRASH 写入测试) 对应的测试, 发现没有. `orchestrator.test.ts` 中 mock 了 `appendToProgressLog` 为空函数, 没有验证写入的内容是否包含 `TRIBUNAL_CRASH`.

**修复建议**: 在 `orchestrator.test.ts` 中扩展 crashed 分支的测试, 验证 `appendToProgressLog` 被调用且参数包含 `TRIBUNAL_CRASH`.

---

## P2 (优化建议)

### P2-1: classifyTribunalError 中 SIGKILL 貢归类为 cli-internal 而非 OOM

**文件**: `mcp/src/tribunal.ts` L338

**问题**: 设计文档中 SIGKILL 应归类为 `oom_killed`（exit code 137 通常表示 OOM kill）, 但实现中 SIGKILL 匹配了 `cli-internal` 的正则 `/internal|ECONNREFUSED|ECONNRESET|SIGKILL|SIGSEGV/`. 这是因为正则匹配顺序问题: SIGKILL 在 OOM 检查之后才被 cli-internal 匹配到, 但 OOM 的正则只检查 msg, 不检查 stderr. 所以当 error.message 是 "SIGKILL" 时, 不会命中 OOM 正则, 直接命中 cli-internal.  不过设计文档说 SIGKILL 应该是 OOM.

**建议**: 跻加 SIGKILL 到 OOM 检查的正则中, 或者在 cli-internal 之前添加独立的 SIGKILL 检查.

### P2-2: 设计文档 errorCategory 名称与实现不一致

**文件**: 设计文档 L90-97 vs 实现 L285-292

**问题**: 设计文档使用下划线命名（`cli_not_found`, `permission_denied` 等）, 实现使用大写/缩写命名（`ENOENT`, `EPERM` 等）. 这是一个风格选择, 不影响功能. 实际上实现的命名更简洁（与 Node.js error code 一致） 但如果后续有其他系统依赖设计文档中的命名, 会出现不匹配. 当前没有消费方依赖设计文档中的命名, 所以这不是问题.

### P2-3: classifyTribunalError 函数签名中 err 参数接受 string 但接口定义中未体现 stderr 对分类的影响

**文件**: `mcp/src/tribunal.ts` L316-343

**问题**: 函数在 OOM 和 cli-internal 分类中使用了 `stderr` 参数来辅助判断, 但函数签名的 JSDoc 注释没有说明 stderr 参数会影响分类结果. 对于调试者来说, 不知道 stderr 内容也会影响分类可能导致困惑.

---

## 审查 Checklist 结果

### A. 架构一致性

| 项目 | 结果 |
|------|------|
| 实现与设计文档一致 | **基本一致**. 核心架构（分类函数 + enrich + progress-log）按设计方案 A 实现. P1-1 的 `issues[0].description` 缺失分类信息是唯一偏离设计的地方. |
| 跨任务 API 接口匹配 | **匹配**. `classifyTribunalError` -> `runTribunal` -> `runTribunalWithRetryCli` -> `evaluateTribunal` -> `orchestrator.ts` 的调用链完整且类型匹配. |
| 额外功能 | **无**. 没有设计中未提到的功能. |

### B. 功能正确性

| 项目 | 结果 |
|------|------|
| 7 种分类逻辑 | **正确**. ENOENT、EPERM/EACCES、prompt-too-long、timeout、OOM、cli-internal、unknown 分类规则正确. |
| isRetryable 判断 | **正确**. 不可重试: ENOENT、EPERM、prompt-too-long; 可重试: timeout、OOM、cli-internal、unknown. |
| 重试跳过逻辑 | **正确**. `runTribunalWithRetryCli` 正确解析 raw 中的 crashInfo, isRetryable=false 时跳过重试. JSON.parse 失败时 fallback 到 isRetryable=true. |
| progress-log 写入 | **正确**. orchestrator.ts 在 crashed 分支正确解析 crashRaw 并写入结构化事件. best-effort try-catch 不阻塞主流程. |

### C. 代码质量

| 项目 | 结果 |
|------|------|
| 圈复杂度 | `classifyTribunalError` 有 7 个 if 分支, 圈复杂度约 7, 可接受. |
| 方法长度 | `classifyTribunalError` 约 25 行, `runTribunalWithRetryCli` 的 isRetryable 逻辑约 10 行, 合理. |
| 命名 | 分类名使用 Node.js error code 风格（ENOENT, EPERM 等）, 比 design doc 中的描述性命名更简洁. |
| 纯函数 | `classifyTribunalError` 是纯函数, 无副作用, 易测试. |

### D. 错误处理

| 项目 | 结果 |
|------|------|
| 具体异常捕获 | `tryRunViaHub` catch 块正确捕获 err 并记录 console.warn. |
| 不吞异常 | catch 不吞异常, 要么返回 null（tryRunViaHub）, 要么 best-effort（orchestrator progress-log）. |
| fallback 策略 | `runTribunalWithRetryCli` 中 JSON.parse 失败时 fallback 到 isRetryable=true, 保守策略, 保持现有行为. |

### E. 测试

| 项目 | 结果 |
|------|------|
| classifyTribunalError 测试 | **15 个测试用例**, 覆盖 7 种分类 + exitCode/stderrSnippet + string 输入. 覆盖 AC-1 到 AC-4. |
| runTribunal crash enrich 测试 | **1 个测试用例**, 验证 raw 包含 crashInfo JSON. 覆盖 AC-5, AC-6. |
| retry skip 测试 | **2 个测试用例**, 验证 ENOENT 不重试, timeout 重试. 覆盖 AC-7, AC-8. |
| tryRunViaHub catch 测试 | **缺失** (P1-2). |
| orchestrator TRIBUNAL_CRASH 测试 | **缺失** (P1-3). |
| 全量测试通过 | **92/92 通过**, 无 regression. |

---

## 结论

**NEEDS_FIX**

存在 1 个 P0 问题（exitCode 类型不匹配）和 3 个 P1 问题（description 缺失分类信息、tryRunViaHub 测试缺失、orchestrator TRIBUNAL_CRASH 测试缺失）。

P0-1 (exitCode 类型不匹配) 不会导致运行时崩溃, 但会导致 progress-log 中的 exitCode 字段显示为 "ENOENT" 而非数字, 与设计文档和类型定义不一致, 且影响后续 retrospective 统计的准确性. 建议在合并前修复.

3 个 P1 问题不影响核心功能正确性, 但影响测试覆盖的完整性. 建议在后续迭代中补充.
