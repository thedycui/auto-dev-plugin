# Tribunal 韧性改进设计文档

## 背景与目标

### 为什么做

Tribunal（独立裁决 Agent）在 Phase 4/5/6/7 中频繁崩溃，导致 auto-dev 无法完成。崩溃原因有三：

1. **patch 文件过大**：`tribunal-diff-phaseN.patch` 包含 startCommit 以来所有变更（可达 279KB / 3618 行），tribunal agent 无法在有限 turns 内读完
2. **claude -p 权限受限**：`--allowedTools "Read,Grep,Glob"` 中 Grep/Glob 在非交互模式下需要用户确认权限 → permission denied → 只有 Read 可用
3. **max_turns 不足**：需要读 5-8 个文件（design.md, plan.md, code-review.md, diff patch 等）+ 分析 → 10 turns 不够 → `error_max_turns`

此外，代码中使用的 `--max-turns` 参数实际不是 claude CLI 的有效 flag，被静默忽略。

### 做什么

1. **预消化输入**：框架预处理所有审查材料为一个 digest 文件，tribunal 只需 1 次 Read
2. **修复 CLI 参数**：`--dangerously-skip-permissions` 解决权限问题，移除无效的 `--max-turns`，增加 timeout
3. **Fallback 机制**：claude -p 崩溃后，返回 `TRIBUNAL_PENDING` 让主 Agent 用 subagent 执行裁决

### 不做什么（Non-Goals）

- 不迁移到 Anthropic API 直接调用（复杂度高，引入新依赖）
- 不改变 tribunal 的审查标准和 checklist
- 不改变 Phase 4/5/6/7 必须经过 tribunal 审查的规则

## 现状分析

### 当前 Tribunal 执行流程

```
auto_dev_submit(phase=N)
  → prepareTribunalInput()
    → 写 tribunal-input-phaseN.md（引用多个文件路径）
    → 写 tribunal-diff-phaseN.patch（完整 git diff，可能很大）
  → runTribunal()
    → claude -p prompt --allowedTools "Read,Grep,Glob" --max-turns N --model sonnet
    → tribunal agent 自己 Read 每个文件 → 分析 → 输出 JSON verdict
  → crossValidate() → internalCheckpoint()
```

### 关键代码位置

- `mcp/src/tribunal.ts`：tribunal 核心逻辑（prepareTribunalInput, runTribunal, executeTribunal）
- `mcp/src/tribunal-schema.ts`：JSON schema + TRIBUNAL_MAX_TURNS
- `mcp/src/tribunal-checklists.ts`：审查清单
- `mcp/src/index.ts`：auto_dev_submit 工具注册

### 当前问题量化

| 指标 | 值 |
|------|---|
| patch 大小（典型） | 100-300 KB |
| tribunal 需读文件数 | 5-8 个 |
| 每文件平均大小 | 2-10 KB |
| max_turns（Phase 4） | 10（实际被忽略） |
| timeout | 120 秒 |
| 崩溃率（近期观察） | >50% |

## 方案设计

### 方案一：预消化 + 权限修复 + Fallback（推荐）

**核心思路**：减轻 tribunal 负担 + 解锁工具权限 + 崩溃时有退路。

三层防线：
1. 预消化 → 把 5-8 个文件 + 大 patch 压缩为 1 个 digest（<30KB）
2. `--dangerously-skip-permissions` → 解锁 Grep/Glob/Read 全部权限
3. claude -p 崩溃 → 返回 `TRIBUNAL_PENDING` → 主 Agent 用 subagent 裁决

### 方案二：完全替换为 Anthropic API

**核心思路**：不用 claude -p，直接调 Messages API。

优势：无权限问题、无 max_turns、延迟低。
劣势：需要 ANTHROPIC_API_KEY（非 OAuth 用户）、新增 SDK 依赖、tribunal 无法主动读文件（所有材料必须内联到 prompt）。

### 对比

| 维度 | 方案一 | 方案二 |
|------|--------|--------|
| 可靠性 | 高（三层防线） | 最高（无 CLI 依赖） |
| 实现复杂度 | 低（~200 行） | 中（~300 行 + SDK 集成） |
| 外部依赖 | 无新增 | @anthropic-ai/sdk |
| 认证要求 | 复用 claude CLI 认证 | 需要 ANTHROPIC_API_KEY |
| tribunal 灵活性 | 可主动读文件 | 只能读内联内容 |
| 回退能力 | 有（subagent fallback） | 无（API 失败就失败） |

**选择方案一**：实现简单、无新依赖、fallback 机制更强健。

## 详细设计

### 4.1 预消化输入（改造 prepareTribunalInput）

**核心变化**：不再让 tribunal 自己读文件，而是框架把所有材料内联到一个 digest 文件。

```typescript
// tribunal.ts - prepareTribunalInput 改造

async function prepareTribunalInput(phase, outputDir, projectRoot, startCommit) {
  const digestFile = join(outputDir, `tribunal-digest-phase${phase}.md`);

  let content = `# Phase ${phase} 独立裁决\n\n`;
  content += `你是独立裁决者。默认立场是 FAIL。PASS 必须逐条举证。\n\n`;

  // 1. 框架统计（硬数据）
  const diffStat = await gitDiffStat(projectRoot, startCommit);
  content += `## 框架统计（可信数据）\n\`\`\`\n${diffStat}\n\`\`\`\n\n`;

  // 2. 内联审查材料（截断到合理长度）
  const filesToInline = getPhaseFiles(phase, outputDir);
  for (const { label, path, maxLines } of filesToInline) {
    const text = await safeRead(path, maxLines);
    if (text) content += `## ${label}\n\`\`\`\n${text}\n\`\`\`\n\n`;
  }

  // 3. 关键代码变更（排除测试/配置/dist，截断）
  const keyDiff = await getKeyDiff(projectRoot, startCommit, 300);
  content += `## 关键代码变更\n\`\`\`diff\n${keyDiff}\n\`\`\`\n\n`;

  // 4. checklist
  content += `## 检查清单\n\n${getTribunalChecklist(phase)}\n`;

  await writeFile(digestFile, content, "utf-8");
  return digestFile;
}
```

**各阶段内联文件清单**：

| Phase | 内联文件 | 最大行数 |
|-------|---------|---------|
| 4 | design-review.md, plan-review.md, code-review.md | 各 100 行 |
| 5 | e2e-test-results.md, framework-test-log.txt, framework-test-exitcode.txt | 各 80 行 |
| 6 | acceptance-report.md | 100 行 |
| 7 | retrospective.md, retrospective-data.md, progress-log.md | 各 80 行 |

**diff 处理**：
- `git diff --stat` 始终完整内联（概览）
- `git diff` 的实际内容：只含 `src/` 下非测试文件
- 排除：`dist/`, `*.map`, `*.lock`, `node_modules/`, `__tests__/`
- **截断策略**：按文件均匀分配行数。总预算 300 行，每文件 max = 300 / fileCount（最少 20 行/文件），确保每个文件至少有 hunk header + 前几行变更可见。避免前 2-3 个大文件吃掉全部配额。

**digest 大小目标**：< 50KB（含所有内联材料 + diff）

### 4.2 修复 CLI 参数（改造 runTribunal）

```typescript
const args = [
  "-p", prompt,
  "--output-format", "json",
  "--json-schema", schemaStr,
  "--dangerously-skip-permissions",  // 解决权限问题
  "--model", "sonnet",
  "--no-session-persistence",
];
// 移除无效的 --max-turns 和 --allowedTools
// --dangerously-skip-permissions 已包含所有工具权限
```

**timeout 调整**：120s → 180s（预消化后 tribunal 负担小，180s 足够）。

### 4.3 崩溃检测（改造 runTribunalWithRetry）

当前 `runTribunalWithRetry` 崩溃耗尽重试后返回 `verdict: "FAIL"`，与正常裁决 FAIL 无法区分。需要新增 `crashed` 标志：

```typescript
// runTribunalWithRetry 返回值扩展
interface TribunalResult {
  verdict: TribunalVerdict;
  crashed: boolean;  // true = 进程崩溃，非裁决结果
}
```

`executeTribunal` 改造：

```typescript
async function executeTribunal(...) {
  // ... pre-check ...
  const inputFile = await prepareTribunalInput(...);
  const { verdict, crashed } = await runTribunalWithRetry(inputFile, phase);

  // 写 tribunal log（无论崩溃与否）
  await writeFile(tribunalLogPath, buildTribunalLog(phase, verdict));

  if (crashed) {
    // 读取 digest 内容，返回 TRIBUNAL_PENDING
    const digestContent = await readFile(inputFile, "utf-8");
    return textResult({
      status: "TRIBUNAL_PENDING",
      phase,
      message: "裁决进程崩溃，请使用 subagent 执行 fallback 裁决。",
      digest: digestContent,
      digestHash: sha256(digestContent).slice(0, 16),  // 防篡改校验
      mandate: "[FALLBACK] 请调用 auto-dev-reviewer subagent 审查上述材料，然后提交 auto_dev_tribunal_verdict。",
    });
  }

  if (verdict.verdict === "PASS") {
    const crossCheckFail = await crossValidate(...);
    // ... 现有逻辑 ...
  }
  // ... 现有逻辑 ...
}
```

### 4.4 Fallback 机制（新增 TRIBUNAL_PENDING + tribunal_verdict 工具）

**流程**：

```
executeTribunal()
  → runTribunalWithRetry() → crashed=true
  → 返回 TRIBUNAL_PENDING + digest + digestHash
  → 主 Agent 收到 TRIBUNAL_PENDING
  → 调用 Agent tool(subagent_type="auto-dev:auto-dev-reviewer", prompt=digest)
  → reviewer 分析后产出 verdict
  → 主 Agent 调用 auto_dev_tribunal_verdict(phase, verdict, digestHash)
  → 框架校验 digestHash 一致 + crossValidate → 写 checkpoint
```

**防篡改机制**：

1. **digestHash 校验**：`auto_dev_tribunal_verdict` 要求传入 `digestHash`，框架重新读取 digest 文件计算 hash 比对。主 Agent 不能跳过 subagent 直接提交（因为 hash 来自 submit 返回值，无法伪造）
2. **crossValidate 增强**：为 Phase 4/6/7 补充最低限度的硬数据校验：
   - Phase 4：检查 diff 非空（至少有代码变更）
   - Phase 6：检查 acceptance-report.md 存在且有 PASS/FAIL 结果
   - Phase 7：检查 retrospective.md 存在且行数 ≥ 50
3. **审计标记**：tribunal log 中标记 `source: "fallback-subagent"`，与 `source: "claude-p"` 区分

**新增 MCP 工具 `auto_dev_tribunal_verdict`**：

```typescript
server.tool(
  "auto_dev_tribunal_verdict",
  "Submit tribunal verdict from fallback subagent review. Only valid after TRIBUNAL_PENDING.",
  {
    projectRoot: z.string(),
    topic: z.string(),
    phase: z.number(),
    verdict: z.enum(["PASS", "FAIL"]),
    issues: z.array(z.object({
      severity: z.enum(["P0", "P1", "P2"]),
      description: z.string(),
      file: z.string().optional(),
    })),
    passEvidence: z.array(z.string()).optional(),
    summary: z.string().optional(),
    digestHash: z.string(),  // 必须与 TRIBUNAL_PENDING 返回的一致
  },
  async ({ projectRoot, topic, phase, verdict, issues, passEvidence, summary, digestHash }) => {
    // 1. 校验 phase 是 tribunal phase
    // 2. 校验 digestHash 与 digest 文件一致（防篡改）
    // 3. 校验 PASS 必须有 passEvidence
    // 4. crossValidate（硬数据交叉验证，Phase 4/6/7 已增强）
    // 5. 写 tribunal log（标记 source: "fallback-subagent"）
    // 6. 写 checkpoint
    // 7. 返回 TRIBUNAL_PASS / TRIBUNAL_FAIL / TRIBUNAL_OVERRIDDEN
  }
);
```

### 4.5 SKILL.md 流程更新

```
elif phase in [4, 5, 6, 7]:
    submit_result = auto_dev_submit(phase, summary)
    if submit_result.status == "TRIBUNAL_PENDING":
        # claude -p 崩溃，fallback 到 subagent
        digest = submit_result.digest
        digestHash = submit_result.digestHash
        agent_result = Agent(subagent_type="auto-dev:auto-dev-reviewer",
                            prompt=f"作为独立裁决者审查以下材料，按检查清单逐条判定:\n{digest}")
        # 从 agent 输出中提取 verdict（JSON 格式）
        auto_dev_tribunal_verdict(projectRoot, topic, phase, verdict, issues, passEvidence, digestHash)
        # 返回 TRIBUNAL_PASS / TRIBUNAL_FAIL / TRIBUNAL_OVERRIDDEN
    elif submit_result.status == "TRIBUNAL_PASS":
        phase = submit_result.nextPhase
    elif submit_result.status == "TRIBUNAL_FAIL":
        # 修复问题后重新 submit
```

## 影响分析

### 改动范围

| 文件 | 改动类型 | 改动量 |
|------|---------|--------|
| `mcp/src/tribunal.ts` | 修改 | ~100 行（prepareTribunalInput 重写 + runTribunal 参数修改 + fallback 逻辑） |
| `mcp/src/tribunal-schema.ts` | 修改 | ~5 行（移除 TRIBUNAL_MAX_TURNS） |
| `mcp/src/index.ts` | 修改 | ~60 行（新增 auto_dev_tribunal_verdict 工具） |
| `skills/auto-dev/SKILL.md` | 修改 | ~15 行（更新驱动循环，增加 TRIBUNAL_PENDING 分支） |
| `mcp/src/types.ts` | 无改动 | — |

### 兼容性

- `auto_dev_submit` 返回值新增 `TRIBUNAL_PENDING` 状态 → 旧版 SKILL.md 不识别会当作 FAIL 处理 → 安全降级
- `auto_dev_tribunal_verdict` 是新增工具 → 不影响现有工具
- tribunal-input-phaseN.md 改名为 tribunal-digest-phaseN.md → 仅影响输出文件命名
- tribunal-diff-phaseN.patch 不再生成 → 减少磁盘占用

### 回滚方案

恢复以下 4 个文件到改动前版本，重新 `npm run build` 即可：
1. `mcp/src/tribunal.ts`
2. `mcp/src/tribunal-schema.ts`
3. `mcp/src/index.ts`
4. `skills/auto-dev/SKILL.md`

所有改动向后兼容，回滚不影响已产出的 state.json / progress-log.md。

## 风险与缓解

| 风险 | 概率 | 缓解 |
|------|------|------|
| `--dangerously-skip-permissions` 在某些 claude 版本不可用 | 低 | 已验证当前 CLI 支持该 flag |
| 预消化后 diff 截断丢失关键信息 | 中 | 保留 `--stat` 完整概览 + 只截断实际 diff 内容；tribunal 仍可用 Read/Grep 补充读取 |
| fallback subagent 的独立性不如 claude -p | 中 | 保留 crossValidate 硬数据验证；PASS 仍要求 passEvidence |
| 主 Agent 篡改 fallback verdict | 低 | auto_dev_tribunal_verdict 内置 crossValidate + passEvidence 校验 |
| MCP server 内 execFile 路径解析失败 | 中 | 保留现有 4-tier fallback（env → command -v → hardcoded → npx） |

## 验收标准

| AC | 描述 | 验证方式 |
|----|------|---------|
| AC-1 | prepareTribunalInput 产出单个 digest 文件（不再要求 tribunal 自己读多个文件），digest 大小 < 50KB | 单元测试：mock 文件内容，验证输出文件大小和内容结构 |
| AC-2 | runTribunal 使用 `--dangerously-skip-permissions` 且不包含 `--max-turns` 参数 | 代码审查：检查 args 数组内容 |
| AC-3 | tribunal 超时或崩溃时返回 TRIBUNAL_PENDING（而非 TRIBUNAL_FAIL），包含 digest 内容 | 单元测试：mock execFile 返回错误，验证返回值 |
| AC-4 | 新增 auto_dev_tribunal_verdict 工具，接受 verdict JSON 并执行 crossValidate | 代码审查 + 单元测试 |
| AC-5 | auto_dev_tribunal_verdict 对 PASS verdict 要求 passEvidence 非空，否则拒绝 | 单元测试 |
| AC-6 | SKILL.md 包含 TRIBUNAL_PENDING fallback 分支说明 | 代码审查 |
| AC-7 | 预消化 diff 排除 dist/、*.map、*.lock、node_modules/、__tests__/ | 单元测试：验证 git diff 排除路径 |
| AC-8 | timeout 从 120s 增加到 180s | 代码审查 |
| AC-9 | crossValidate 为 Phase 4/6/7 增加最低限度硬数据校验（Phase 4: diff 非空；Phase 6: acceptance-report.md 有结果；Phase 7: retrospective.md ≥ 50 行） | 单元测试 |
| AC-10 | auto_dev_tribunal_verdict 校验 digestHash 与 digest 文件一致，不一致则拒绝 | 单元测试 |
| AC-11 | fallback verdict 提交 PASS 但 crossValidate 不通过时，返回 TRIBUNAL_OVERRIDDEN | 单元测试 |
