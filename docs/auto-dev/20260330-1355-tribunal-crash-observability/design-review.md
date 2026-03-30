# Design Review

**Topic**: tribunal-crash-observability
**审查日期**: 2026-03-30
**审查文档**: `docs/auto-dev/tribunal-crash-observability/design.md`

---

## P0 (阻塞性问题)

### P0-1: evaluateTribunal 中无法调用 appendToProgressLog — 违反纯函数契约

**问题**: 设计文档第 4.5 节提出在 `evaluateTribunal` 的 `crashed === true` 分支（L766-768）中调用 `appendToProgressLog` 写入 progress-log。但 `evaluateTribunal` 是一个**纯函数**（代码注释 L677 `Pure Tribunal Evaluation (no state side effects)`、L707 `runs tribunal and returns verdict WITHOUT writing any state`），它不接受 `StateManager` 参数，无法访问 `appendToProgressLog` 方法。

`appendToProgressLog` 是 `StateManager` 类的实例方法（`state-manager.ts:553`），需要 `StateManager` 实例才能调用。`evaluateTribunal` 的签名是 `(projectRoot, outputDir, phase, topic, summary, startCommit?)`，不包含 `StateManager` 参数。

**grep 证据**:
- `tribunal.ts:677` 注释: `Pure Tribunal Evaluation (no state side effects)`
- `tribunal.ts:707` 注释: `runs tribunal and returns verdict WITHOUT writing any state`
- `state-manager.ts:553` 签名: `async appendToProgressLog(content: string): Promise<void>` — 属于 StateManager 类
- `tribunal.ts:712-718` evaluateTribunal 参数列表中无 StateManager

**修复建议**: 有两个可行方案:

- **方案 1（推荐）: 在 evaluateTribunal 中直接用 writeFile 追加 progress-log**。tribunal.ts 已经 import 了 `writeFile`（L15），且 evaluateTribunal 已经在使用 `writeFile` 写 `tribunal-phase{N}.md`（L748）。可以用 `readFile` + `writeFile` 模拟 append 行为，不引入 StateManager 依赖，也不改变纯函数性质（写 progress-log 是审计日志，不是状态变更）。但需注意与 StateManager 的 `atomicWrite`（temp-rename 模式）的一致性问题。

- **方案 2: 将 progress-log 写入移到 orchestrator.ts 的 crashed 处理分支中**。orchestrator.ts L956-972 已经处理了 `validation.tribunalResult.crashed`，且 orchestrator 持有 `sm: StateManager` 实例，可以直接调用 `sm.appendToProgressLog`。这样 evaluateTribunal 保持纯函数不变，将 audit 写入的职责上移到 orchestrator。这更符合当前的架构分层。

---

## P1 (重要问题)

### P1-1: runTribunalWithRetryCli 中解析 raw 字段获取 crashInfo 存在数据流断裂

**问题**: 设计文档第 4.3 节提出在 `runTribunalWithRetryCli` 中从 `result.raw` 解析 `crashInfo.isRetryable`。但 `runTribunalWithRetryCli` 调用的是 `runTribunal`（L503），`runTribunal` 返回的是 `TribunalVerdict`。而 `TribunalVerdict.raw` 字段类型是 `string`（`types.ts:350`），设计要求在 error path 中将 `raw` 设为 `JSON.stringify({ crashInfo, stderrSnippet, errMessage })`（第 4.2 节）。

问题是：在非 error path（成功解析 JSON 或 JSON 解析失败）中，`raw` 会被设置为 `stdout`（原始 LLM 输出）。因此 `runTribunalWithRetryCli` 在读取 `result.raw` 做 `JSON.parse` 时，需要先确认这是 crash path 的 raw 还是正常 path 的 raw。

但 `runTribunalWithRetryCli` 当前用 `CRASH_INDICATORS`（L278, 包含 `"裁决进程执行失败"`）来判断是否 crash，这个判断发生在 raw 解析之前（L514-516）。所以在 `isCrash === true` 的分支中，`result.raw` 确实是 error path 设置的 JSON。然而，设计要求 crashInfo 中的 `stderrSnippet` 字段同时存在于 `crashInfo` 对象内和顶层 `stderrSnippet` 字段（第 4.2 节: `JSON.stringify({ crashInfo, stderrSnippet, errMessage })`），这是冗余的，且顶层 `stderrSnippet` 会被 `crashInfo.stderrSnippet` 覆盖。

**修复建议**: 统一 `raw` 中的 JSON 结构为 `{ crashInfo, errMessage }`，不要在顶层再加 `stderrSnippet`（因为 `crashInfo` 内已含 `stderrSnippet`）。在 `runTribunalWithRetryCli` 中用 try-catch 包裹 `JSON.parse(result.raw)` 时，添加注释说明只在 `isCrash === true` 分支中执行此解析。

### P1-2: 设计未覆盖 executeTribunal（deprecated 路径）的同类改进

**问题**: 设计文档只修改了 `evaluateTribunal` 的 crashed 分支写 progress-log，但 `executeTribunal`（L819-930，deprecated 但仍在使用）也有同样的 crashed 分支（L853-863），且此路径不会经过 orchestrator。`executeTribunal` 被 `index.ts:1811` 直接调用（legacy 路径），如果只改 evaluateTribunal 不改 executeTribunal，legacy 用户看不到任何改进。

**grep 证据**:
- `index.ts:1811`: `const tribunalResult = await executeTribunal(...)` — legacy 路径仍在使用
- `tribunal.ts:853-863`: executeTribunal 的 crashed 分支直接返回 TRIBUNAL_PENDING

**修复建议**: 设计应明确说明 executeTribunal 的处理策略：
- 如果认为 legacy 路径不再重要，在设计中注明 "executeTribunal 为 deprecated，不在本次改进范围内"
- 如果认为应该覆盖，则需要在 executeTribunal 的 crashed 分支中也写入 TRIBUNAL_CRASH 事件

### P1-3: tryRunViaHub catch 块的 console.warn 在 MCP server 环境中可能不可见

**问题**: 设计文档第 4.4 节提出在 `tryRunViaHub` 的 catch 块中添加 `console.warn`。但 auto-dev 以 MCP server 方式运行时，`console.warn/stderr` 的输出目标取决于宿主进程（Claude Code、Cursor 等）。设计声称 "MCP server 的 stderr 会显示在宿主进程日志中"，但这一点未经验证。如果宿主进程不捕获 MCP server 的 stderr，这些诊断信息仍然会丢失。

**修复建议**: 除了 `console.warn` 外，建议同时将 hub 失败信息写入一个独立的 audit 文件（如 `tribunal-hub-failures.log`），或在 `TribunalVerdict.raw` 中追加 hub 错误信息。这样即使 stderr 不可见，信息也不会丢失。

---

## P2 (优化建议)

### P2-1: TribunalCrashInfo 可考虑扩展 errorCategory 联合类型

当前 `errorCategory` 是 7 个字符串字面量组成的联合类型。考虑到后续迭代可能新增分类，建议使用 `string` 基础类型或定义常量枚举，避免每次新增分类时都需修改类型定义。不过这不是阻塞性问题，当前设计已足够。

### P2-2: stderrSnippet 截取 500 字符的边界处理

设计中提到截取前 500 字符，但没有说明如何处理 UTF-8 多字节字符截断问题（在字符中间截断可能导致乱码）。建议使用 `stderr.slice(0, 500)` 替代 `stderr.substring(0, 500)`，或在截取后验证 UTF-8 完整性。由于实际场景中 stderr 内容多为 ASCII，此问题概率极低。

### P2-3: design.md 中行号偏移需更新

设计文档引用的行号与实际代码存在轻微偏差：

| 设计引用 | 实际位置 | 偏差 |
|---------|---------|------|
| `tribunal.ts:299-395` (`runTribunal`) | 实际 L299-395 | 正确 |
| `tribunal.ts:334` (`_stderr` 参数) | 实际 L334 | 正确 |
| `tribunal.ts:440-489` (`tryRunViaHub`) | 实际 L440-489 | 正确 |
| `tribunal.ts:486-488` (`catch {}`) | 实际 L486-488 | 正确 |
| `tribunal.ts:495-542` (`runTribunalWithRetryCli`) | 实际 L495-542 | 正确 |
| `tribunal.ts:528-536` (崩溃结果) | 实际 L527-537 | 偏移 1 行 |
| `tribunal.ts:712-808` (`evaluateTribunal`) | 实际 L712-808 | 正确 |
| `L766-768` (crashed 分支) | 实际 L766-768 | 正确 |

大部分行号准确，L528 偏差极小，不影响理解。

---

## 跨组件影响分析

### 步骤 A: 变更清单

| 序号 | 变更项 | 类型 |
|------|--------|------|
| 1 | `TribunalCrashInfo` 接口（新增） | 接口 |
| 2 | `classifyTribunalError()` 函数（新增） | 函数 |
| 3 | `runTribunal` callback 签名：`_stderr` -> `stderr` | 函数修改 |
| 4 | `runTribunal` error path：返回值 raw/description 格式变更 | 函数修改 |
| 5 | `runTribunalWithRetryCli`：新增 isRetryable 判断逻辑 | 函数修改 |
| 6 | `tryRunViaHub` catch 块：`catch {}` -> `catch (err) { console.warn }` | 函数修改 |
| 7 | `evaluateTribunal` crashed 分支：新增 progress-log 写入 | 函数修改 |
| 8 | progress-log 新增 `<!-- TRIBUNAL_CRASH ... -->` 事件格式 | 数据格式 |

### 步骤 B: 逐项搜索调用方

#### 1. TribunalCrashInfo（新接口）

无现有调用方，纯新增。

#### 2. classifyTribunalError（新函数）

无现有调用方，仅在新增代码内部调用。

#### 3-4. runTribunal 返回值格式变更

| 调用方 | 所在位置 | 影响类型 | 需同步修改 | 设计已覆盖 |
|--------|---------|---------|-----------|-----------|
| `runTribunalWithRetryCli` | tribunal.ts:503 | 消费 `result.raw` 做重试判断 | 是 | 是（4.3 节） |
| `buildTribunalLog` | tribunal.ts:747, 849 | 消费 `verdict.raw` 写入日志文件 | 否 | 未提及 |
| `executeTribunal` (deprecated) | tribunal.ts:846 | 消费 `runTribunalWithRetry` 返回的 verdict | 否 | 未提及 |

**重点: buildTribunalLog 的 raw 字段消费**

`buildTribunalLog`（tribunal.ts:1015-1045）在 L1043 将 `verdict.raw` 直接写入日志文件的 Raw Output section。修改后 crash path 的 `raw` 变为 JSON 字符串而非纯 error message，日志文件中会出现一大段 JSON，可读性下降。

**重点: retrospective-data.ts 的 tribunal 结果提取**

`retrospectiveData.ts:95-115` 中的 `extractTribunalResults` 函数从 `tribunal-phase{N}.md` 中提取 verdict 和 issue count，使用正则 `/VERDICT:\s*(PASS|FAIL)/i` 和 `/ISSUE:\s*/gi`。由于 `buildTribunalLog` 的格式（`## Verdict: PASS/FAIL` 和 `- [P0] description`）未被设计修改，此正则不受影响。

#### 5. runTribunalWithRetryCli 修改

| 调用方 | 所在位置 | 影响类型 | 需同步修改 | 设计已覆盖 |
|--------|---------|---------|-----------|-----------|
| `runTribunalWithRetry` | tribunal.ts:416 | 调用入口 | 否（内部修改，签名不变） | 是 |

#### 6. tryRunViaHub catch 块修改

| 调用方 | 所在位置 | 影响类型 | 需同步修改 | 设计已覆盖 |
|--------|---------|---------|-----------|-----------|
| `runTribunalWithRetry` | tribunal.ts:422 | 调用入口 | 否（返回值仍为 null） | 是 |

#### 7. evaluateTribunal crashed 分支修改

| 调用方 | 所在位置 | 影响类型 | 需同步修改 | 设计已覆盖 |
|--------|---------|---------|-----------|-----------|
| orchestrator.ts validateStep | orchestrator.ts:543, 567, 578 | 消费 `EvalTribunalResult` | **需确认** | 部分 |
| orchestrator.ts runStepLoop | orchestrator.ts:906-973 | 消费 `validation.tribunalResult.crashed` | 否 | 是（已在设计中分析） |

**重点: orchestrator.ts 的 EvalTribunalResult 消费**

orchestrator.ts:914-932 检查 `validation.tribunalResult.subagentRequested`，L936 检查 `rawParseFailure`，L956 检查 `crashed`。设计中的修改只影响 crashed 分支内部逻辑（新增 progress-log 写入），不影响返回值结构，因此 orchestrator 不需要修改。

但 **P0-1 修复后**，如果采用方案 2（将 progress-log 写入移到 orchestrator），则 orchestrator.ts 需要新增调用。

#### 8. progress-log 新增 TRIBUNAL_CRASH 事件

| 调用方 | 所在位置 | 影响类型 | 需同步修改 | 设计已覆盖 |
|--------|---------|---------|-----------|-----------|
| `retrospective-data.ts: generateRetrospectiveData` | retrospective-data.ts:20-37 | 读取 progress-log | 否（当前不解析 TRIBUNAL_CRASH） | 是（设计提到 "可被 retrospective 通过正则匹配统计"） |
| `phase-enforcer.ts: parseInitMarker` | phase-enforcer.ts:451-455 | 解析 progress-log 的 INIT marker | 否（INIT marker 在文件头部，不受尾部追加影响） | 是 |
| `e2e-integration.test.ts` | 测试文件 | 多个测试写入/读取 progress-log | 可能需要更新 | 未提及 |

**重点: retrospective-data.ts 不解析 TRIBUNAL_CRASH**

设计文档声称 "此事件可被 retrospective 的 `generateRetrospectiveData` 函数（`retrospective-data.ts`）通过正则匹配 `TRIBUNAL_CRASH` 统计"。但实际代码中 `retrospective-data.ts` 只使用 `CHECKPOINT phase=` 正则（L66, L124）、`REJECTED|BLOCKED|被拒绝` 正则（L48）、和 `TDD_RED_REJECTED|TDD_GREEN_REJECTED` 正则（L236-237），**没有任何代码会匹配 `TRIBUNAL_CRASH`**。

这意味着设计提到的 "可被 retrospective 统计" 是对未来的规划，当前不会生效。需要在设计中明确标注为 "后续迭代实现 retrospective 统计"，或同步在 `retrospective-data.ts` 中新增 `TRIBUNAL_CRASH` 解析逻辑。

### 步骤 C: 影响汇总

| 调用方 | 所在文件 | 影响类型 | 需同步修改 | 设计已覆盖 |
|--------|---------|---------|-----------|-----------|
| runTribunalWithRetryCli | tribunal.ts:503 | 消费 raw 字段新格式 | 是 | 是（4.3 节） |
| buildTribunalLog | tribunal.ts:747, 849 | raw 字段变为 JSON 格式 | 否（可接受） | 未提及 |
| executeTribunal (deprecated) | tribunal.ts:846 | 同样有 crash 处理逻辑 | 需明确策略 | 未提及 |
| orchestrator validateStep | orchestrator.ts:543,567,578 | 消费 EvalTribunalResult | 否 | 是 |
| orchestrator runStepLoop | orchestrator.ts:906-973 | 处理 crashed 分支 | 取决于 P0-1 修复方案 | 部分 |
| generateRetrospectiveData | retrospective-data.ts:20-37 | 读取 progress-log | 否（当前不解析 TRIBUNAL_CRASH） | 需修正描述 |
| e2e-integration.test.ts | 测试文件 | progress-log 格式变更 | 可能需更新断言 | 未提及 |
| tribunal.test.ts | 测试文件 | runTribunalWithRetry 和 runTribunal 的测试 | 需更新 mock | 是（设计列出了测试用例） |

### 步骤 D: Dormant Path Detection（休眠路径分析）

| 路径 | 是否已验证 | 风险级别 |
|------|-----------|---------|
| `runTribunal` error path (ENOENT/EPERM 等) | 未验证 — 只在 retrospective 报告中出现过崩溃，但具体错误类型未分类 | P1 |
| `runTribunalWithRetryCli` isRetryable 分支 | 未验证 — 全新逻辑路径 | P2（纯增量逻辑，不改变现有路径） |
| `tryRunViaHub` catch 分支 | 已验证 — Hub 路径在部分环境使用过 | P2 |
| progress-log TRIBUNAL_CRASH 写入 | 未验证 — 新路径 | P2（append-only 操作，风险低） |

---

## 结论

**NEEDS_REVISION**

P0-1（evaluateTribunal 纯函数契约违反）是阻塞性问题，必须在实现前解决。核心问题是设计要求在一个明确标注为"无状态副作用"的纯函数中写入 progress-log，这与当前架构分层矛盾。

建议修改方案：将 progress-log 的 TRIBUNAL_CRASH 写入职责从 `evaluateTribunal` 上移到 `orchestrator.ts` 的 crashed 分支（L956-972），orchestrator 持有 StateManager 实例，可以安全地调用 `sm.appendToProgressLog`。这样保持了 evaluateTribunal 的纯函数性质，也符合当前架构中 "evaluateTribunal 负责评估、orchestrator 负责状态变更" 的分层原则。

同时，P1-2（executeTurniture deprecated 路径）和 retrospective-data.ts 的 TRIBUNAL_CRASH 解析缺失也需要在设计文档中明确处理策略。
