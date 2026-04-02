# Design Review（第二轮）

> 日期：2026-04-02
> 审查对象：`docs/auto-dev/20260402-0902-orchestrator-ux-improvements/design.md`
> 审查人：Auto-Dev Reviewer（Phase 1 架构评审）

---

## P0 (阻塞性问题)

无。

---

## P1 (重要问题)

### P1-1：`buildTaskForStep` 签名问题 — 已修复

设计文档第 4.3 节明确说明：

> `buildTaskForStep` 当前签名为 `Promise<string>`，共有 7 个调用方直接使用其返回值作为字符串。**不修改 `buildTaskForStep` 的返回类型**。

并给出了具体实现约束：`parseTaskList` 在 `computeNextTask` 内 step "3" 的上层调用点独立调用，`tasks` 字段单独组装进 `NextTaskResult`。伪代码示例清晰展示了调用顺序（先 `buildTaskForStep`，再 `parseTaskList`，两者结果分别赋值）。AC-12 也将此作为可验证的验收标准。

代码验证：`buildTaskForStep` 当前签名（第 1015 行）为 `Promise<string>`，8 个调用点（第 679、1172、1200、1220、1268、1383、1441、1554 行）均直接使用返回字符串，设计保持签名不变的承诺是可实现的。

**结论：P1-1 已修复。**

---

### P1-2：`auto_dev_reset` 重置字段 — 已修复

设计文档第 4.1 节第 5 步明确补充：

**`parseInt` 字符串 key 处理**：`tribunalSubmits` 和 `phaseEscalateCount` 均使用 `parseInt(k) >= targetPhase` 进行数值比较，并给出了完整代码片段：

```typescript
const filteredSubmits = Object.fromEntries(
  Object.entries(submits).filter(([k]) => parseInt(k) < targetPhase)
);
const filteredEscalateCount = Object.fromEntries(
  Object.entries(phaseEscalateCount).filter(([k]) => parseInt(k) < targetPhase)
);
```

**`phaseEscalateCount` 清除逻辑**：设计文档明确说明"若不清除，回退后可能因历史 escalate 计数（`escCount >= 2`）导致立即 BLOCKED，因此**必须清除 `>= targetPhase` 的条目**"，并配套 AC-13 进行验证。

代码验证：`phaseEscalateCount` 当前在 `StateJsonSchema`（第 207 行）和 orchestrator（第 657、676 行）中均以字符串 key 存储（如 `phaseKey = String(phaseForStep(currentStep))`），`parseInt` 处理是必要的。

**结论：P1-2 已修复。**

---

### P1-3：`handleValidationFailure` 5 条 return 路径 — 已修复

设计文档第 4.2 节提供了完整的 5 条路径覆盖表格，并对每条路径的处理方式有明确说明：

| return 路径 | 是否填充 `lastFailureDetail` |
|------------|---------------------------|
| Tribunal FAIL under limit（约第 1383 行） | 是，填充 `validation.feedback` |
| `regressToPhase` 路径（`handlePhaseRegress`） | 是，且在 `atomicUpdate` 时补充该字段 |
| `ALL_APPROACHES_EXHAUSTED`（`handleCircuitBreaker` 内） | 是，`status: "BLOCKED"` 时仍填充 |
| `CIRCUIT_BREAK` 路径 | 是，切换方案时保留失败原因 |
| Iteration limit exceeded | 不另填（`escalation.lastFeedback` 已携带，语义等价） |

设计文档还明确指出："`regressToPhase` 和 `ALL_APPROACHES_EXHAUSTED` 两条路径在原代码中未持久化 `lastFailureDetail`，本次需要在各路径的 `atomicUpdate()` 调用处补充该字段。"配套 AC-14、AC-15 分别验证这两条路径。

代码验证：
- `handlePhaseRegress`（第 1258-1266 行）当前 `atomicUpdate` 中无 `lastFailureDetail`，需在实现时补充。
- `handleCircuitBreaker` 中 `ALL_EXHAUSTED` 分支（第 1316-1318 行）当前 `atomicUpdate` 中无 `lastFailureDetail`，需在实现时补充。

设计文档已正确识别这两个缺失位置，并提供了明确修复指令。

**结论：P1-3 已修复。**

---

## P2 (优化建议)

### P2-1：`step = String(targetPhase)` 的潜在歧义

设计文档第 4.1 节第 4 步中：`step = String(targetPhase)`（注释：回到该 phase 的第一个 step）。

但实际上 `firstStepForPhase(targetPhase)` 才是正确调用（已在 `handlePhaseRegress` 第 1257 行使用）。例如 Phase 1 的第一个 step 是 `"1a"` 而非 `"1"`，若直接 `String(targetPhase)` 会得到错误的 step 字符串。

AC-1 的验证条件 `step="3"` 恰好对应 `firstStepForPhase(3) === "3"`，掩盖了其他 phase 的潜在问题。建议实现时改为 `step = firstStepForPhase(targetPhase)`，与 `handlePhaseRegress` 保持一致。

### P2-2：`getKeyDiff` budget 升级的消费方确认

设计文档第 4.4 节提出 HIGH 时将 diff budget 从 300 提升到 500 行。`getKeyDiff` 当前在 `prepareTribunalInput` 第 225 行硬编码 `300`。两个外部调用点（第 784、900 行）传入 `startCommit` 而非 budget，budget 的动态化属于 `prepareTribunalInput` 内部修改，无需变更外部调用方，设计意图是正确的，仅建议实现时显式确认此点以免误改外部调用。

---

## 跨组件影响分析

### 变更清单

| 文件 | 变更类型 | 关键符号 |
|------|---------|---------|
| `mcp/src/index.ts` | 新增 handler | `auto_dev_reset` 工具注册（约 50 行） |
| `mcp/src/orchestrator.ts` | 接口扩展 + 函数修改 | `NextTaskResult`（+2 可选字段）、`handleValidationFailure`（3 个路径新增持久化）、`handlePhaseRegress`（新增 `lastFailureDetail` 到 `atomicUpdate`）、`handleCircuitBreaker`（ALL_EXHAUSTED 路径新增 `lastFailureDetail`）、新增 `parseTaskList`、`TaskInfo` |
| `mcp/src/tribunal.ts` | 函数扩展 | `prepareTribunalInput`（注入规模信号）、新增 `parseDiffSummary` |
| `mcp/src/types.ts` | schema 扩展 | `StateJsonSchema`（+`lastFailureDetail` optional 字段） |

### 调用方影响

| 符号 | 调用方（行号） | 影响分析 |
|------|-------------|---------|
| `buildTaskForStep` | 8 个调用点（679、1172、1200、1220、1268、1383、1441、1554） | 签名不变，无影响 |
| `handleValidationFailure` | `computeNextTask`（第 1640 行）唯一调用方 | 返回类型 `NextTaskResult` 新增可选字段，调用方透传结果，无破坏性影响 |
| `prepareTribunalInput` | tribunal.ts 第 784、900 行两处调用 | 函数签名不变，内部追加 digest 内容；返回类型 `{ digestPath, digestContent }` 不变；调用方只透传 digestContent，无影响 |
| `StateJsonSchema` | 全局类型推断（第 230 行 `StateJson`） | 新增 `optional` 字段，现有 state.json 无需迁移；`z.infer` 类型自动更新，无破坏性 |

### 未验证路径风险（路径激活风险评估）

`handlePhaseRegress`（CODE_BUG 回退）和 `handleCircuitBreaker` 的 `ALL_EXHAUSTED` 分支是首次需要写入 `lastFailureDetail` 的位置。这两条路径在实际运行中属于偶发分支，历史上其 `atomicUpdate` 逻辑从未携带 `lastFailureDetail`。设计文档已识别此风险，并通过 AC-14（`regressToPhase` 路径）和 AC-15（`ALL_EXHAUSTED` 路径）专项单元测试覆盖，风险可接受。

---

## 结论

**PASS**

上轮审查发现的 3 个 P1 问题均已在设计文档中得到明确修复：

- **P1-1**：`buildTaskForStep` 签名保持 `Promise<string>` 不变，`parseTaskList` 在上层独立调用，有代码示例和 AC-12 支撑。
- **P1-2**：`parseInt(k)` 字符串 key 处理和 `phaseEscalateCount` 清除逻辑均已补充，有代码片段和 AC-13 支撑。
- **P1-3**：全部 5 条 return 路径已覆盖，`regressToPhase` 和 `ALL_APPROACHES_EXHAUSTED` 两条路径有 AC-14、AC-15 专项验证。

遗留 2 个 P2 优化建议，不阻塞实现推进。建议实现时重点注意 P2-1：`auto_dev_reset` 中 `step` 字段应使用 `firstStepForPhase(targetPhase)` 而非 `String(targetPhase)`。
