# Phase 4 深度代码审查报告 — tribunal-resilience

**审查范围**：tribunal.ts, tribunal-schema.ts, index.ts, SKILL.md, tribunal.test.ts
**审查日期**：2026-03-26

---

## P0：阻塞性问题

### P0-1：`tribunalTextResult` 导入但从未使用（Dead Import）

**文件**：`/Users/admin/.claude/plugins/auto-dev-plugin/mcp/src/index.ts:24`

```typescript
import { executeTribunal, crossValidate, buildTribunalLog, textResult as tribunalTextResult } from "./tribunal.js";
```

`tribunalTextResult` 在 index.ts 全文中仅出现在 import 语句中，从未被调用。index.ts 使用的是自己定义的 `textResult`（第 42 行）。这是一个 dead import，可能会导致 TypeScript 严格模式或 lint 规则报错。

**修复建议**：从 import 语句中移除 `textResult as tribunalTextResult`。

**严重程度修正**：此项实际影响取决于项目的 lint/tsconfig 配置。如果 `noUnusedLocals` 未开启，则降级为 P1。但鉴于它是 dead code，建议清理。

---

### P0-2：`getKeyDiff` 和 `crossValidate` Phase 4 的 `startCommit` 为 undefined 时 fallback 到 `"HEAD"` 可能导致误判

**文件**：`/Users/admin/.claude/plugins/auto-dev-plugin/mcp/src/tribunal.ts:152, 454`

当 `state.startCommit` 为 undefined 时：

- `getKeyDiff` 第 152 行：`const diffBase = startCommit ?? "HEAD"` → `git diff HEAD` 只显示**未提交的变更**
- `crossValidate` Phase 4 第 454 行：同样 fallback 到 `"HEAD"` → `git diff --stat HEAD` 只显示未提交变更

如果 Phase 3 的所有代码已经 commit（正常流程中 Phase 3 每个 task 结束都会 `git commit`），则 `git diff HEAD` 返回空 → `crossValidate` 会错误地将 PASS 覆写为 FAIL（"git diff 为空，没有任何代码变更"）。

**影响路径**：`executeTribunal` → `crossValidate(phase=4)` → 错误返回 TRIBUNAL_OVERRIDDEN

**修复建议**：
1. 确认 `state.startCommit` 在 `auto_dev_init` 时必定被设置（检查 init 逻辑）
2. 如果确实可能为 undefined，Phase 4 的 diff fallback 应改为 `"HEAD~20"` 或使用 `git log --oneline` 检查是否有提交记录，而非假设 `HEAD` 有未提交变更

**验证状态**：经查 index.ts 第 171 行，`auto_dev_init` 中通过 `gitManager.getHeadCommit()` 获取并在第 185 行持久化到 state。正常初始化的会话 `startCommit` 必定有值。但 types.ts 第 122 行定义为 `z.string().optional()`，意味着旧版/迁移的 state 可能为 undefined。风险可控但存在。**降级为 P1**——建议在 `crossValidate` Phase 4 中对 `startCommit` 为 undefined 的情况给出更明确的 warning 而非静默 fallback 到 `HEAD`。

---

## P1：重要问题

### P1-1：TRIBUNAL_PENDING 返回路径 — 全新路径，从未在生产环境验证

**路径**：`executeTribunal()` crashed=true → 返回 TRIBUNAL_PENDING → 主 Agent 收到后调用 subagent → `auto_dev_tribunal_verdict()`

**未验证环节**：
1. `executeTribunal` 第 592-602 行：TRIBUNAL_PENDING 返回的 `digest` 字段包含完整 digest 内容（可能很大，达 50KB），通过 JSON 序列化后作为 MCP tool response 返回。需确认 MCP 协议对 response 大小无限制
2. SKILL.md 第 49-56 行：主 Agent 需要从 `submit_result.digest` 中取出内容作为 prompt 传给 subagent，然后从 subagent 输出中"提取 verdict JSON"——这个提取过程完全依赖主 Agent 的解析能力，没有框架保障
3. `auto_dev_tribunal_verdict` 工具（index.ts 1452-1577）：整条路径从未被执行过

**缓解**：crossValidate 在 fallback 路径中同样会执行（index.ts 1514），提供了硬数据兜底。但 digestHash 校验路径（index.ts 1492-1499）也从未验证过。

**修复建议**：在测试中增加 `auto_dev_tribunal_verdict` 的完整路径测试，至少覆盖：
- digestHash 匹配成功 + PASS + crossValidate 通过 → TRIBUNAL_PASS
- digestHash 不匹配 → DIGEST_HASH_MISMATCH
- PASS 无 passEvidence → PASS_EVIDENCE_REQUIRED
- PASS + crossValidate 失败 → TRIBUNAL_OVERRIDDEN

---

### P1-2：`auto_dev_tribunal_verdict` 使用动态 import 而非静态 import

**文件**：`/Users/admin/.claude/plugins/auto-dev-plugin/mcp/src/index.ts:1549-1550`

```typescript
const { internalCheckpoint: ckpt } = await import("./state-manager.js");
const { computeNextDirective: computeND } = await import("./phase-enforcer.js");
```

这两个模块在文件顶部已有静态 import（第 7 行 `import { internalCheckpoint, StateManager }` 和第 15 行 `import { computeNextDirective }`）。在 `auto_dev_tribunal_verdict` 中使用动态 import 是冗余的，且可能导致混淆：如果静态 import 的版本和动态 import 的版本在 module resolution 上有差异（例如 ESM 缓存问题），可能产生微妙的 bug。

**修复建议**：直接使用已有的静态 import `internalCheckpoint` 和 `computeNextDirective`，移除动态 import。

---

### P1-3：`auto_dev_tribunal_verdict` 的 FAIL 路径不写 checkpoint

**文件**：`/Users/admin/.claude/plugins/auto-dev-plugin/mcp/src/index.ts:1568-1575`

当 fallback verdict 为 FAIL 时，只返回 TRIBUNAL_FAIL 状态和 issues，但**不写 checkpoint**。对比 `executeTribunal` 中的 FAIL 路径（tribunal.ts 639-645），同样不写 checkpoint。这意味着 FAIL 后 state.json 中的 phase/status 不更新。

这本身不是 bug（FAIL 后主 Agent 修复再重新 submit），但值得确认：tribunal submit counter 已在 `auto_dev_submit` 中递增（index.ts 1437），所以即使 FAIL 不写 checkpoint，counter 仍然正确追踪。

但注意：`auto_dev_tribunal_verdict` **不递增 submit counter**。这意味着如果 claude -p 崩溃 → TRIBUNAL_PENDING → fallback subagent 判 FAIL → 主 Agent 修复后重新 `auto_dev_submit` → submit counter 只计了第一次（auto_dev_submit 中递增），fallback 的这一轮不算在 counter 里。这可能导致 escalation 机制被绕过（理论上 3 次 submit 限制变成了"3 次 auto_dev_submit 调用"而非"3 次裁决尝试"）。

**修复建议**：评估是否需要在 `auto_dev_tribunal_verdict` FAIL 时也递增 submit counter，或者接受当前行为（因为 fallback 本身已经是一次额外的尝试机会）。

---

### P1-4：`crossValidate` Phase 5 的 `diffBase` 在 startCommit 为 undefined 时使用 `"HEAD~20"`

**文件**：`/Users/admin/.claude/plugins/auto-dev-plugin/mcp/src/tribunal.ts:478`

```typescript
const diffBase = startCommit ?? "HEAD~20";
```

`HEAD~20` 是一个硬编码的 magic number。如果项目提交历史少于 20 个 commit，`git diff HEAD~20` 会失败。同样的问题出现在 `runQuickPreCheck` 第 664 行。

**修复建议**：使用 `git rev-list --max-parents=0 HEAD` 获取仓库第一个 commit 作为 fallback，或者使用 `git diff --name-only HEAD~20 HEAD 2>/dev/null || git diff --name-only HEAD` 做错误处理。

---

### P1-5：`--dangerously-skip-permissions` 安全性评估

**文件**：`/Users/admin/.claude/plugins/auto-dev-plugin/mcp/src/tribunal.ts:309`

`--dangerously-skip-permissions` 允许 tribunal agent 执行**任何工具操作**（包括文件写入、命令执行等），而不仅仅是 Read/Grep/Glob。

**风险**：如果 tribunal agent 的 prompt injection 或 structured output 被篡改，它可能会：
- 修改项目文件（破坏代码）
- 执行任意命令
- 修改 state.json 或 progress-log.md（绕过框架检查）

**缓解因素**：
1. Tribunal agent 使用 `--json-schema` 约束输出格式为 PASS/FAIL verdict
2. Tribunal agent 使用 `--no-session-persistence` 不保留会话
3. 设计文档明确说明此 flag 是为了解决权限受限导致的崩溃问题
4. crossValidate 提供硬数据兜底

**评估**：风险可接受，因为 tribunal 是一个临时的独立进程，且输出通过 JSON schema 约束。但建议在文档中记录此决策的 trade-off。

---

## P2：优化建议

### P2-1：测试覆盖缺口 — `auto_dev_tribunal_verdict` 无直接测试

`tribunal.test.ts` 中的测试覆盖了 `runTribunal`、`runTribunalWithRetry`、`crossValidate`、`resolveClaudePath` 等函数，但 `auto_dev_tribunal_verdict` 工具的完整流程（digestHash 校验、crossValidate 调用、checkpoint 写入）没有测试。当前的 "Integration Entry Point" 测试（TC-21）只是模拟了 submit handler 的逻辑，而非真正调用。

**建议**：Phase 5 测试阶段补充 `auto_dev_tribunal_verdict` 的测试用例。

---

### P2-2：`executeTribunal` 和 `auto_dev_tribunal_verdict` 中的 PASS 逻辑重复

两处都实现了：
1. crossValidate on PASS → TRIBUNAL_OVERRIDDEN
2. internalCheckpoint → TRIBUNAL_PASS
3. computeNextDirective fallback

建议提取为共享函数 `handleTribunalPass(phase, verdict, sm, state, source)` 减少重复。

---

### P2-3：`safeRead` 对空文件的处理

**文件**：`/Users/admin/.claude/plugins/auto-dev-plugin/mcp/src/tribunal.ts:96-105`

`safeRead` 对空文件返回空字符串 `""`（因为 `readFile` 成功，`content.split("\n")` 得到 `[""]`，length=1 <= maxLines）。但 `prepareTribunalInput` 中的 `if (text)` 检查（第 265 行）会跳过空字符串。这是正确的行为——空文件不会被内联。但文档/注释中说"返回 null 如果文件不存在"，没有提到空文件返回空字符串的行为。

---

### P2-4：`buildTribunalLog` 的 source 参数默认值

**文件**：`/Users/admin/.claude/plugins/auto-dev-plugin/mcp/src/tribunal.ts:729`

`source` 参数有默认值 `"claude-p"`，但在 `executeTribunal` 中调用时显式传了 `"claude-p"`（第 588 行），这是好的实践。不过所有调用方都显式传了 source，默认值实际没有被使用。

---

## Caller-Side Review 总结

| 生产者 | 消费者 | 状态 |
|--------|--------|------|
| `runTribunalWithRetry` 返回 `{verdict, crashed}` | `executeTribunal` 解构 | OK — 第 585 行正确解构 |
| `executeTribunal` 返回 TRIBUNAL_PENDING | `auto_dev_submit` 透传 | OK — 第 1444 行 `return { content: tribunalResult.content }` 正确透传 |
| `crossValidate` 在 fallback 路径 | `auto_dev_tribunal_verdict` 第 1515 行 | OK — 使用 startCommit |
| `buildTribunalLog` source 参数 | `executeTribunal` 第 588 行传 `"claude-p"` | OK |
| `buildTribunalLog` source 参数 | `auto_dev_tribunal_verdict` 第 1524, 1544 行传 `"fallback-subagent"` | OK |
| `textResult` 从 tribunal.ts 导出 | index.ts import as `tribunalTextResult` | **P0-1** — 导入了但从未使用 |
| `ToolResult` 从 tribunal.ts 导出 | index.ts 第 25 行 `import type { ToolResult }` | 需确认是否实际使用 |

---

## Dormant Path Detection 总结

| 路径 | 状态 | 风险 |
|------|------|------|
| TRIBUNAL_PENDING 返回（tribunal.ts 592-602） | **未验证** — 全新路径 | P1 |
| `auto_dev_tribunal_verdict` 工具（index.ts 1452-1577） | **未验证** — 全新路径 | P1 |
| fallback digestHash 校验（index.ts 1492-1499） | **未验证** — 全新路径 | P1 |
| crossValidate Phase 4（tribunal.ts 453-463） | **未验证** — 新增逻辑，首次有适配器调用 | P1 |
| crossValidate Phase 6（tribunal.ts 503-511） | **未验证** — 新增逻辑 | P1 |
| crossValidate Phase 7（tribunal.ts 514-525） | **未验证** — 新增逻辑 | P1 |
| `safeRead`、`getPhaseFiles`、`getKeyDiff` | **未验证** — 全新辅助函数 | P1（但逻辑简单，风险较低） |
| `prepareTribunalInput` 预消化逻辑 | **未验证** — 重写后的全新实现 | P1 |

---

## 总结

**PASS（附条件）**

经验证，`startCommit` 在正常 init 流程中必定设置（index.ts:171），P0-2 降级为 P1。无阻塞性 P0 问题。

建议修复项（不阻塞，但应在后续迭代中处理）：
1. **P0-1→P1**：移除 `tribunalTextResult` dead import（影响取决于 lint 配置）
2. **P0-2→P1**：`crossValidate` Phase 4 对 `startCommit` 为 undefined 时应有明确处理（旧版 state 迁移场景）
3. **P1-1**：为 TRIBUNAL_PENDING 全路径补充测试（Phase 5 阶段，所有 dormant path 需覆盖）
4. **P1-2**：移除 `auto_dev_tribunal_verdict` 中的冗余动态 import
5. **P1-4**：处理 `HEAD~20` 在浅 clone / 少 commit 仓库中的失败场景
