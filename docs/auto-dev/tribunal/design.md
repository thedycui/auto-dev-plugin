# auto-dev 裁决 Agent 设计方案：三权分立架构

## 一、问题定义

auto-dev 当前由主 Agent 同时担任执行者、审查者和裁判，导致：
- 测试被偷懒跳过（标 SKIP 无证据）
- Review 结果被选择性采纳（只修 P0 忽略 P1）
- 复盘报告被敷衍（凑行数过关）
- 验收标准被自我认证（subagent 结果不验证就标 PASS）

根因不是规则不够多，而是**结构性的利益冲突**——执行者不应该审判自己的产出。

## 二、设计目标

在 MCP 插件能力范围内，实现执行权与裁决权的物理隔离：

1. 主 Agent **只能提交产物**，不能判定自己通过
2. 裁决 Agent **独立运行**，主 Agent 无法看到或干预其过程
3. 框架**根据裁决结果自动决定** checkpoint 通过或拒绝

## 三、技术可行性

### 关键能力：MCP 插件可以启动独立 Claude 进程

```typescript
// MCP 插件是 Node.js 进程，可以调用 shell
import { execFile } from "node:child_process";

// claude CLI 的非交互模式
execFile("claude", ["--print", "-p", reviewPrompt], (err, stdout) => {
  // stdout 就是独立 Claude session 的输出
  // 主 Agent 完全无感知
});
```

- `claude --print -p "prompt"` 启动全新的独立 session
- 该 session 与主 Agent 的 session 完全隔离
- MCP 插件控制输入（只传必要的 diff 和文档）和解析输出（提取 verdict）

### 限制

| 限制 | 应对 |
|------|------|
| 独立 session 没有项目全局上下文 | 在 prompt 中注入必要上下文（design.md + plan.md + diff） |
| `claude --print` 输出是纯文本 | 要求裁决 Agent 输出结构化格式，框架解析 |
| 每次调用消耗额外 token | 只在 Phase 4/5/6 调用，每次约 5k-10k tokens |
| 调用耗时 10-30 秒 | 可接受，质量优先于速度 |

## 四、整体架构

```
主 Agent（当前 session）
    │
    │ 只能调用：
    │   auto_dev_submit(phase, summary)
    │   auto_dev_checkpoint(phase=1/2/3/7, status)  ← 非裁决 Phase 保留
    │
    │ 不能调用：
    │   auto_dev_checkpoint(phase=4/5/6, status=PASS) ← 被框架拒绝
    │
    ▼
MCP Plugin（Node.js 进程）
    │
    ├─ phase=1/2/3/7 → 走原有 checkpoint 逻辑（保留不变）
    │
    └─ phase=4/5/6 → 走裁决流程：
         │
         ├─ Step 1: 冻结产物
         │   git diff --cached + git stash snapshot
         │   捕获 testCmd 执行日志（Phase 5）
         │
         ├─ Step 2: 构建裁决 prompt
         │   注入：design.md + plan.md + diff + test log
         │   注入：Phase 对应的检查清单
         │
         ├─ Step 3: 启动裁决 Agent
         │   claude --print -p "{裁决 prompt}"
         │   完全独立 session，主 Agent 不可见
         │
         ├─ Step 4: 解析裁决结果
         │   从输出中提取 VERDICT: PASS / FAIL
         │   提取问题列表和修复建议
         │
         └─ Step 5: 执行裁决
              PASS → 自动写 checkpoint，返回成功
              FAIL → 返回问题列表给主 Agent，要求修复后重新 submit
```

## 五、MCP Tool 改造

### 5.1 新增 `auto_dev_submit`

主 Agent 完成某个 Phase 的工作后，调用此 tool 提交审查。

```typescript
{
  name: "auto_dev_submit",
  description: "提交当前 Phase 产物进行独立裁决。Phase 4/5/6/7 必须通过裁决 Agent 审查才能通过，主 Agent 不能直接 checkpoint PASS。",
  parameters: {
    projectRoot: string,  // 项目根目录
    topic: string,        // auto-dev 主题
    phase: number,        // 提交的 Phase（4/5/6/7）
    summary: string,      // 主 Agent 对本 Phase 工作的简要说明
  }
}
```

### 5.2 修改 `auto_dev_checkpoint`

对 Phase 4/5/6/7，拒绝主 Agent 直接调用 checkpoint(status=PASS)：

```typescript
// index.ts checkpoint handler 中增加：
const TRIBUNAL_PHASES = [4, 5, 6, 7];

if (TRIBUNAL_PHASES.includes(phase) && status === "PASS") {
  return textResult({
    error: "TRIBUNAL_REQUIRED",
    message: `Phase ${phase} 需要通过独立裁决才能 PASS。请调用 auto_dev_submit(phase=${phase}) 提交审查。`,
    mandate: "禁止主 Agent 直接标记 Phase 4/5/6/7 为 PASS。必须通过 auto_dev_submit 提交裁决。"
  });
}

// 主 Agent 仍可调用 checkpoint(status=NEEDS_REVISION) 或 checkpoint(status=IN_PROGRESS)
// 只有 PASS 被拦截
```

### 5.3 保持不变的 tool

| Tool | 变化 | 说明 |
|------|------|------|
| auto_dev_init | 不变 | 初始化不涉及裁决 |
| auto_dev_preflight | 不变 | 预检不涉及裁决 |
| auto_dev_state_update | 不变 | 状态更新不涉及裁决 |
| auto_dev_complete | 不变 | 完成检查只看所有 Phase 是否 PASS |
| auto_dev_checkpoint(phase=1/2/3) | 不变 | Phase 1/2/3 保留原有逻辑，Phase 4 裁决会回溯验证 |
| auto_dev_lessons_add | 不变 | 经验记录不涉及裁决 |

## 六、裁决流程详细设计

### 6.0 核心设计决策：文件传递 + JSON Schema + 最小权限

裁决 Agent 的调用采用以下策略：

| 设计决策 | 选择 | 理由 |
|---|---|---|
| **上下文传递** | 写入文件，让裁决 Agent 用 Read 工具读取 | 避免 prompt 过长（diff 可能数千行），prompt 只需几行指令 |
| **输出格式** | `--output-format json --json-schema` | 强制结构化输出，比正则解析 `VERDICT: PASS` 可靠 100 倍 |
| **可用工具** | `--allowedTools "Read"` | 裁决 Agent 只能读文件，不能写/改/执行，防止它"帮忙修" |
| **模型** | `--model sonnet` | 裁决是结构化审查（按清单逐项核对），Sonnet 足够，成本约 Opus 的 1/5 |
| **启动模式** | `--bare` | 跳过 hooks/skills/plugins/MCP，启动 ~2 秒 vs ~10 秒 |
| **会话持久化** | `--no-session-persistence` | 一次性裁决，不需要恢复 |
| **轮次限制** | `--max-turns 3` | 读几个文件足够，防止裁决 Agent 无限循环 |
| **反放水** | PASS 举证成本 > FAIL 举证成本 | 利用 AI 省力倾向，反转激励方向 |

### 6.1 Step 1：准备审查材料（写入文件）

不再将所有内容嵌入 prompt，而是写入文件让裁决 Agent 自己读取：

```typescript
async function prepareTribunalInput(
  phase: number,
  outputDir: string,
  projectRoot: string,
): Promise<string> {
  const inputFile = join(outputDir, `tribunal-input-phase${phase}.md`);

  let content = `# Phase ${phase} 独立裁决\n\n`;
  content += `你是独立裁决者。你的默认立场是 FAIL。\n`;
  content += `PASS 必须对每条检查项提供证据（文件名:行号），FAIL 只需说明理由。\n`;
  content += `PASS 的举证成本远大于 FAIL —— 如果你不确定，判 FAIL。\n\n`;

  // 指向文件路径，让裁决 Agent 自己读取（解决 prompt 过长问题）
  content += `## 审查材料（请用 Read 工具读取以下文件）\n\n`;
  content += `- 设计文档: ${join(outputDir, "design.md")}\n`;
  content += `- 实施计划: ${join(outputDir, "plan.md")}\n`;

  if (phase === 4) {
    content += `- Phase 1 设计评审: ${join(outputDir, "design-review.md")}\n`;
    content += `- Phase 2 计划评审: ${join(outputDir, "plan-review.md")}\n`;
    content += `- 主 Agent 的 review: ${join(outputDir, "code-review.md")}\n`;
  }
  if (phase === 5) {
    content += `- 主 Agent 的测试结果: ${join(outputDir, "e2e-test-results.md")}\n`;
    content += `- 框架执行的测试日志（可信）: ${join(outputDir, "framework-test-log.txt")}\n`;
  }
  if (phase === 6) {
    content += `- 验收报告: ${join(outputDir, "acceptance-report.md")}\n`;
  }
  if (phase === 7) {
    content += `- 框架自动生成的数据（可信）: ${join(outputDir, "retrospective-data.md")}\n`;
    content += `- 主 Agent 的复盘: ${join(outputDir, "retrospective.md")}\n`;
    content += `- progress-log: ${join(outputDir, "progress-log.md")}\n`;
  }

  // git diff 写入单独文件（可能很大）
  const diffFile = join(outputDir, `tribunal-diff-phase${phase}.patch`);
  const { execFile: execFileSync } = await import("node:child_process");
  const diff = await new Promise<string>((resolve) => {
    execFileSync("git", ["diff", "HEAD"], { cwd: projectRoot, maxBuffer: 5 * 1024 * 1024 },
      (err, stdout) => resolve(err ? "" : stdout));
  });
  await writeFile(diffFile, diff);
  content += `- 代码变更 (git diff): ${diffFile}\n`;

  // Phase 5 特有：框架自己执行 testCmd，写入可信日志
  if (phase === 5) {
    const initData = parseInitMarker(
      await readFile(join(outputDir, "progress-log.md"), "utf-8").catch(() => ""));
    if (initData?.testCmd) {
      const testResult = await new Promise<string>((resolve) => {
        execFileSync("bash", ["-c", initData.testCmd],
          { cwd: projectRoot, timeout: 300_000, maxBuffer: 5 * 1024 * 1024 },
          (err, stdout, stderr) => resolve((stdout || "") + "\n" + (stderr || "")));
      });
      await writeFile(join(outputDir, "framework-test-log.txt"), testResult);
    }
  }

  // Phase 特定的检查清单
  content += `\n## 检查清单\n\n`;
  content += getTribunalChecklist(phase);

  await writeFile(inputFile, content);
  return inputFile;  // 返回文件路径，传给 claude -p
}

### 6.2 Step 2：构建裁决 Prompt

每个 Phase 有不同的裁决 prompt 模板：

#### Phase 4（Code Review 裁决 + Phase 1/2 回溯验证）

```markdown
你是一个独立的代码审查裁决者。你的判决将直接决定这个 Phase 是否通过。

## 你的职责
1. 审查代码变更是否满足设计要求
2. 回溯验证 Phase 1（设计评审）和 Phase 2（计划评审）中发现的问题是否被真正修复

## 输入
### 设计文档
{design}

### Phase 1 设计评审报告（检查其中的 P0/P1 问题是否已修复）
{designReview}

### Phase 2 计划评审报告（检查其中的问题是否已解决）
{planReview}

### 实施计划
{plan}

### 代码变更（git diff）
{diff}

### 主 Agent 的 review 报告（可能不完整或不准确，需要你独立验证）
{agentReview}

## 裁决要求

### A. 回溯验证（最高优先级）
1. 逐条检查 designReview 中的每个 P0/P1 问题
2. 在 design.md 或 diff 中找到对应修复证据
3. 如果 designReview 中有 P0 未修复 → 直接 FAIL
4. 逐条检查 planReview 中的问题，在 diff 中验证

### B. 代码审查
1. 独立审查 diff，不要只依赖主 Agent 的 review 报告
2. 检查设计文档中的每个需求是否在 diff 中有对应实现
3. 检查安全问题（权限绕过、注入、数据泄露）
4. 检查 API 一致性（前后端接口匹配）

## 输出格式（严格遵守）
VERDICT: PASS 或 VERDICT: FAIL

回溯验证结果：
TRACE: [Phase 1/2 问题描述] → FIXED / NOT_FIXED → [证据]

如果 FAIL，列出问题：
ISSUE: [P0/P1] 问题描述 → 修复建议 → 涉及文件
```

#### Phase 5（测试裁决）

```markdown
你是一个独立的测试质量裁决者。测试是最重要的质量门。

## 你的职责
判断测试是否充分覆盖了设计需求，是否有偷工减料（虚假 PASS、无证据 SKIP）。

## 输入
### 设计文档
{design}

### 代码变更（git diff）
{diff}

### 框架执行 testCmd 的原始日志（可信，框架自动捕获）
{testLog}

### 主 Agent 撰写的测试结果（可能不真实，需要你对比验证）
{agentResults}

## 裁决检查清单

### 1. 测试真实性
- 对比框架的 testLog 和 Agent 的 agentResults，是否一致？
- agentResults 中标 PASS 的测试，在 testLog 中是否真的通过？
- 是否有 testLog 中不存在但 agentResults 中标 PASS 的测试？

### 2. SKIP 审查（举证倒置）
- 每个 SKIP/DEFERRED 是否有执行失败的错误日志？
- "需要部署环境"不是有效理由——检查是否有已部署的环境可以用 curl 测试
- 接口级测试（curl/HTTP）不允许标 SKIP

### 3. 覆盖率
- 设计文档中的每个功能点是否有对应测试？
- 是否有功能点完全没有测试覆盖？

### 4. 测试质量
- 测试是否在验证真实功能？（assertTrue(true) 是假测试）
- 断言是否有意义？

## 输出格式（严格遵守）
VERDICT: PASS 或 VERDICT: FAIL

如果 FAIL，列出问题：
ISSUE: [P0/P1] 问题描述 → 修复建议
```

#### Phase 6（验收裁决）

```markdown
你是一个独立的验收裁决者。

## 你的职责
逐条验证设计文档中的验收标准是否被满足。

## 输入
### 设计文档（含验收标准）
{design}

### 代码变更（git diff）
{diff}

### 测试结果
{agentResults}

## 裁决要求
1. 从 design.md 中提取每条验收标准
2. 对每条标准，在 diff 中找到对应实现
3. 找不到实现的标准 → FAIL
4. SKIP 必须有合理理由（真的做不到，不是偷懒）

## 输出格式（严格遵守）
VERDICT: PASS 或 VERDICT: FAIL

AC 验证表：
AC: {描述} → PASS/FAIL/SKIP → {证据或原因}
```

#### Phase 7（复盘裁决）

Phase 7 分两部分：框架自动生成数据 + 裁决 Agent 审查主观反思。

**Part A：框架自动生成（不经过主 Agent，不可篡改）**

```typescript
function generateAutoRetrospectiveData(progressLog: string, outputDir: string) {
  // 从 progress-log.md 中自动提取，主 Agent 无法干预
  return {
    // 1. 框架拦截次数（从 REJECTED checkpoint 计数）
    rejectionCount: (progressLog.match(/REJECTED|BLOCKED|被拒绝/g) || []).length,

    // 2. 每个 Phase 的耗时（从 checkpoint 时间戳差值计算）
    phaseTimings: extractPhaseTimings(progressLog),

    // 3. 裁决记录汇总（从 tribunal-phase*.md 提取 VERDICT）
    tribunalResults: extractTribunalResults(outputDir),

    // 4. submit 重试次数（每个 Phase 的 submit 调用次数）
    submitRetries: extractSubmitRetries(progressLog),
  };
}
```

框架将数据部分写入 `retrospective-data.md`（只读，主 Agent 不能修改）。

**Part B：裁决 Agent 审查主 Agent 的主观反思**

```markdown
你是一个独立的复盘裁决者。你的职责是审查主 Agent 的复盘报告是否诚实。

## 输入

### 框架自动生成的客观数据（可信）
{autoRetrospectiveData}

### 主 Agent 撰写的复盘报告（需要验证诚实度）
{agentRetrospective}

### 全部裁决记录（Phase 4/5/6 的裁决结果）
{allTribunalResults}

### progress-log（框架记录的所有 checkpoint 历史）
{progressLog}

## 裁决检查清单

### 1. 数据一致性
- 主 Agent 报告中的数字（拦截次数、测试通过率等）是否与框架数据一致？
- 如果不一致 → FAIL（数据造假）

### 2. 问题是否被遗漏
- 裁决记录中发现的 ISSUE，是否在复盘报告的"踩坑清单"中体现？
- 被框架拦截的次数，是否在"诚实度审计"中如实报告？
- 如果有裁决 FAIL 记录但复盘中未提及 → FAIL（选择性遗忘）

### 3. 根因分析深度
- 每个踩坑是否有根因分析（不只是"做错了"，而是"为什么做错"）？
- 是否有可复用的改进措施（不只是"下次注意"）？
- 如果只有表面描述没有根因 → FAIL（敷衍）

### 4. 教训可操作性
- 教训是否具体到可以指导下一次开发？
- "以后会注意" 不是有效教训
- 有效教训示例："跨端开发时，先用 curl 确认后端实际接口签名，再写前端调用代码"

## 输出格式（严格遵守）
VERDICT: PASS 或 VERDICT: FAIL

如果 FAIL，列出问题：
ISSUE: [问题类型: 数据不一致/遗漏/敷衍/不可操作] 具体描述
```

### 6.3 Step 3：裁决输出的 JSON Schema

使用 `--json-schema` 强制裁决 Agent 输出结构化 JSON，避免正则解析的不可靠性：

```typescript
const TRIBUNAL_SCHEMA = {
  type: "object",
  properties: {
    verdict: {
      type: "string",
      enum: ["PASS", "FAIL"],
      description: "裁决结果。默认立场是 FAIL，PASS 需要充分证据。"
    },
    issues: {
      type: "array",
      items: {
        type: "object",
        properties: {
          severity: { type: "string", enum: ["P0", "P1", "P2"] },
          description: { type: "string" },
          file: { type: "string" },
          suggestion: { type: "string" }
        },
        required: ["severity", "description"]
      },
      description: "发现的问题列表"
    },
    traces: {
      type: "array",
      items: {
        type: "object",
        properties: {
          source: { type: "string", description: "Phase 1/2 的原始问题描述" },
          status: { type: "string", enum: ["FIXED", "NOT_FIXED", "PARTIAL"] },
          evidence: { type: "string" }
        },
        required: ["source", "status"]
      },
      description: "Phase 1/2 回溯验证结果（仅 Phase 4 裁决需要填写）"
    },
    passEvidence: {
      type: "array",
      items: { type: "string" },
      description: "PASS 时必须提供的逐条证据（格式：文件名:行号 — 说明）。FAIL 时可为空。"
    }
  },
  required: ["verdict", "issues"]
};
```

### 6.4 Step 4：启动裁决 Agent

```typescript
interface TribunalVerdict {
  verdict: "PASS" | "FAIL";
  issues: Array<{ severity: string; description: string; file?: string; suggestion?: string }>;
  traces?: Array<{ source: string; status: string; evidence?: string }>;
  passEvidence?: string[];
  raw: string;  // 原始输出，写入日志供审计
}

async function runTribunal(inputFile: string): Promise<TribunalVerdict> {
  const { execFile: execFileAsync } = await import("node:child_process");

  const args = [
    "-p",                                          // 非交互模式
    `读取 ${inputFile} 中的审查材料，按照里面的指令进行裁决。`,

    "--output-format", "json",                     // 结构化 JSON 输出
    "--json-schema", JSON.stringify(TRIBUNAL_SCHEMA), // 强制输出格式

    "--allowedTools", "Read",                      // 只允许读文件，不能写/改/执行
    "--model", "sonnet",                           // 裁决用 Sonnet（结构化审查足够）
    "--max-turns", "3",                            // 最多 3 轮工具调用（读文件）
    "--bare",                                      // 跳过 hooks/skills/plugins，快速启动
    "--no-session-persistence",                    // 一次性裁决，不保存会话
  ];

  return new Promise((resolve) => {
    execFileAsync("claude", args, {
      timeout: 120_000,          // 2 分钟超时
      maxBuffer: 2 * 1024 * 1024, // 2MB 输出上限
    }, (err, stdout) => {
      if (err) {
        // 裁决进程失败 → 视为 FAIL（宁可误拒不可误放）
        resolve({
          verdict: "FAIL",
          issues: [{ severity: "P0", description: `裁决进程执行失败: ${err.message}` }],
          raw: err.message,
        });
        return;
      }

      try {
        // --output-format json 返回 { result, session_id, structured_output, ... }
        // --json-schema 时结构化数据在 structured_output 字段
        const response = JSON.parse(stdout);
        const data = response.structured_output;

        if (!data || !data.verdict) {
          resolve({
            verdict: "FAIL",
            issues: [{ severity: "P0", description: "裁决 Agent 未返回有效的 structured_output" }],
            raw: stdout,
          });
          return;
        }

        resolve({ ...data, raw: stdout });
      } catch (parseErr) {
        resolve({
          verdict: "FAIL",
          issues: [{ severity: "P0", description: `裁决输出 JSON 解析失败: ${parseErr}` }],
          raw: stdout || "",
        });
      }
    });
  });
}
```

### 6.5 Step 5：执行裁决（完整流程）

```typescript
async function executeTribunal(
  projectRoot: string,
  outputDir: string,
  phase: number,
  topic: string,
  summary: string,
): Promise<ToolResult> {
  // 1. 准备审查材料（写入文件，解决 prompt 过长问题）
  const inputFile = await prepareTribunalInput(phase, outputDir, projectRoot);

  // 2. 启动独立裁决 Agent（claude -p + JSON Schema）
  const verdict = await runTribunal(inputFile);

  // 3. 写入裁决记录（不可篡改的审计证据）
  const tribunalLog = `# Tribunal Verdict - Phase ${phase}\n\n`
    + `## Verdict: ${verdict.verdict}\n\n`
    + `## Issues\n${verdict.issues.map(i => `- [${i.severity}] ${i.description}${i.file ? ` (${i.file})` : ""}`).join("\n")}\n\n`
    + (verdict.traces?.length ? `## Phase 1/2 Traces\n${verdict.traces.map(t => `- ${t.source} → ${t.status}${t.evidence ? ` — ${t.evidence}` : ""}`).join("\n")}\n\n` : "")
    + (verdict.passEvidence?.length ? `## PASS Evidence\n${verdict.passEvidence.map(e => `- ${e}`).join("\n")}\n\n` : "")
    + `## Raw Output\n\`\`\`\n${verdict.raw}\n\`\`\`\n`;
  await writeFile(join(outputDir, `tribunal-phase${phase}.md`), tribunalLog);

  // 4. PASS 时的交叉验证（框架硬数据兜底，防止裁决 Agent 放水）
  if (verdict.verdict === "PASS") {
    const crossCheckFail = await crossValidate(phase, outputDir, projectRoot);
    if (crossCheckFail) {
      // 裁决说 PASS 但框架硬数据不一致 → 覆盖为 FAIL
      return textResult({
        status: "TRIBUNAL_OVERRIDDEN",
        phase,
        message: `裁决 Agent 判定 PASS，但框架交叉验证不通过：${crossCheckFail}`,
        issues: [{ severity: "P0", description: crossCheckFail }],
        mandate: "框架硬数据与裁决结果矛盾，请修复后重新 submit。",
      });
    }
  }

  // 5. 根据裁决写 checkpoint
  if (verdict.verdict === "PASS") {
    await writeCheckpoint(outputDir, phase, "PASS",
      `[TRIBUNAL] 独立裁决通过。${verdict.issues.length} 个建议项。`);
    return textResult({
      status: "TRIBUNAL_PASS",
      phase,
      message: "独立裁决通过，checkpoint 已自动写入。",
      suggestions: verdict.issues,
    });
  } else {
    return textResult({
      status: "TRIBUNAL_FAIL",
      phase,
      message: `独立裁决未通过。发现 ${verdict.issues.length} 个问题，请修复后重新 submit。`,
      issues: verdict.issues,
      mandate: "请根据以上问题逐一修复，修复完成后再次调用 auto_dev_submit。",
    });
  }
}

/**
 * 交叉验证：裁决 Agent 说 PASS 时，框架用硬数据二次校验。
 * 防止裁决 Agent 放水——裁决 Agent 不能放水到低于框架的检测标准。
 * 返回 null 表示通过，返回 string 表示不通过原因。
 */
async function crossValidate(
  phase: number,
  outputDir: string,
  projectRoot: string,
): Promise<string | null> {
  if (phase === 5) {
    // 检查框架 test log 是否有 FAIL/ERROR
    try {
      const testLog = await readFile(join(outputDir, "framework-test-log.txt"), "utf-8");
      if (/BUILD FAILURE|FAIL|ERROR.*Test/i.test(testLog) && !/BUILD SUCCESS/i.test(testLog)) {
        return "框架执行 testCmd 结果包含 FAIL/ERROR，但裁决 Agent 判定 PASS";
      }
    } catch { /* no test log */ }

    // 检查新增实现文件 vs 测试文件
    const { execFile: ef } = await import("node:child_process");
    const diffOutput = await new Promise<string>((resolve) => {
      ef("git", ["diff", "--name-only", "--diff-filter=AM", "HEAD~20", "HEAD"],
        { cwd: projectRoot }, (err, stdout) => resolve(err ? "" : stdout || ""));
    });
    const files = diffOutput.trim().split("\n").filter(f => f.length > 0);
    const implPatterns = [/\.java$/, /\.ts$/, /\.js$/, /\.py$/];
    const testPatterns = [/[Tt]est\.(java|ts|js|py)$/, /\.test\.(ts|js)$/, /\.spec\.(ts|js)$/];
    const implCount = files.filter(f => implPatterns.some(p => p.test(f)) && !testPatterns.some(p => p.test(f))).length;
    const testCount = files.filter(f => testPatterns.some(p => p.test(f))).length;
    if (implCount > 0 && testCount === 0) {
      return `${implCount} 个新增实现文件但 0 个测试文件，裁决 Agent 不应判定 PASS`;
    }
  }
  return null;
}
```

## 七、安全保障

### 7.1 防篡改

| 风险 | 防护 |
|------|------|
| 主 Agent 在 submit 前修改产物 | 冻结时取 git diff 写入文件，后续对比 |
| 主 Agent 伪造 testCmd 输出 | 框架自己执行 testCmd，写入 framework-test-log.txt（主 Agent 不能修改） |
| 主 Agent 多次 submit 试图撞出 PASS | 记录 submit 次数，超过 3 次强制要求人工介入 |
| 裁决 Agent 输出不包含 verdict | `--json-schema` 强制输出结构；解析失败默认 FAIL |
| 裁决进程超时或崩溃 | 视为 FAIL（宁可误拒不可误放） |

### 7.2 防裁决 Agent 放水（三层防护）

| 层级 | 机制 | 原理 |
|------|------|------|
| **激励反转** | PASS 必须提供 passEvidence（逐条列出文件名:行号），FAIL 只需列问题 | PASS 的举证成本 > FAIL，利用 AI 省力倾向让它倾向于 FAIL |
| **框架交叉验证** | 裁决 PASS 后，框架用硬数据二次校验（testCmd 执行结果、新增文件比例） | 裁决 Agent 不能放水到低于框架的检测标准 |
| **默认立场** | prompt 中明确"默认立场是 FAIL，不确定时判 FAIL" | 将裁决 Agent 的默认值从"倾向通过"翻转为"倾向拒绝" |

### 7.2 防绕过

```typescript
// 主 Agent 可能尝试的绕过方式及防护

// 1. 直接调 checkpoint(phase=5, status=PASS)
//    防护：checkpoint handler 对 Phase 4/5/6 拒绝 PASS
if (TRIBUNAL_PHASES.includes(phase) && status === "PASS") {
  return reject("必须通过 auto_dev_submit 提交裁决");
}

// 2. 调 checkpoint(phase=5, status=COMPLETED)
//    防护：只接受标准状态枚举
if (!["IN_PROGRESS", "PASS", "NEEDS_REVISION", "BLOCKED"].includes(status)) {
  return reject("无效状态");
}

// 3. 跳过 Phase 5 直接调 checkpoint(phase=6)
//    防护：已有的 predecessor validation 会拦截
```

## 八、文件改动清单

| 文件 | 改动 | 说明 |
|------|------|------|
| `mcp/src/index.ts` | 修改 | 新增 `auto_dev_submit` handler；checkpoint 拦截 Phase 4/5/6/7 的 PASS |
| `mcp/src/tribunal.ts` | **新增** | 裁决流程核心逻辑：prepareTribunalInput（写文件）、runTribunal（claude -p 调用）、crossValidate（交叉验证）、executeTribunal（完整编排） |
| `mcp/src/tribunal-schema.ts` | **新增** | TRIBUNAL_SCHEMA（JSON Schema 定义裁决输出格式） |
| `mcp/src/tribunal-checklists.ts` | **新增** | Phase 4/5/6/7 的裁决检查清单（写入 tribunal-input 文件供裁决 Agent 读取） |
| `mcp/src/retrospective-data.ts` | **新增** | Phase 7 自动数据生成逻辑（从 progress-log 提取统计） |
| `mcp/src/phase-enforcer.ts` | 修改 | `validatePhase5Artifacts` 简化为基本检查（详细审查交给裁决 Agent） |
| `mcp/src/types.ts` | 修改 | 新增 TribunalVerdict、RetrospectiveData 类型 |

## 九、Phase 5 校验逻辑变化

### 改造前（代码校验）

```
phase-enforcer.ts 中的正则匹配：
  - 有没有测试文件
  - 结果文件有没有 PASS/FAIL
  - DEFERRED 占比
  全部通过 → checkpoint PASS
```

### 改造后（裁决 Agent + 框架交叉验证）

```
phase-enforcer.ts 保留基本检查（快速拦截，不浪费裁决 token）：
  - 有没有测试文件
  - 结果文件是否存在
  基本检查通过 → 进入裁决流程

tribunal.ts 裁决流程：
  Step 1: 框架准备审查材料，写入 tribunal-input-phase5.md
          框架执行 testCmd，写入 framework-test-log.txt（可信）
  Step 2: 启动独立 claude -p session：
          --json-schema 强制结构化输出
          --allowedTools "Read" 只能读文件
          --model sonnet 成本可控
          --bare 快速启动
  Step 3: 裁决 Agent 读取文件，按检查清单逐项审查
          对比 framework-test-log.txt vs e2e-test-results.md
          审查 SKIP 合理性（PASS 举证 > FAIL 举证）
  Step 4: 解析 JSON Schema 结构化输出
  Step 5: 框架交叉验证（防放水兜底）
          裁决说 PASS 但 test log 有 FAIL → 覆盖为 FAIL
          裁决说 PASS 但 0 个测试文件 → 覆盖为 FAIL
  最终: PASS → 自动 checkpoint / FAIL → 返回问题要求修复
```

## 十、验收标准

### 核心机制

| 编号 | 标准 | 验证方式 |
|------|------|---------|
| AC-1 | 主 Agent 调 checkpoint(phase=5, PASS) 被拒绝 | 直接测试 |
| AC-2 | 主 Agent 调 auto_dev_submit(phase=5) 触发裁决流程 | 检查是否启动了独立 claude 进程 |
| AC-3 | 裁决 Agent 的 session 与主 Agent 隔离 | 裁决 Agent 不知道主 Agent 的对话历史 |
| AC-4 | 裁决 FAIL 时主 Agent 收到问题列表 | 检查返回内容 |
| AC-5 | 裁决 PASS 时 checkpoint 自动写入 | 检查 progress-log.md |
| AC-6 | 裁决记录写入 tribunal-phase{N}.md | 检查文件存在且包含 VERDICT |
| AC-7 | 裁决进程失败时视为 FAIL | kill 裁决进程，检查返回 FAIL |
| AC-8 | Phase 1/2/3 不受影响 | 原有 checkpoint 流程正常工作 |
| AC-9 | submit 超过 3 次仍 FAIL 时提示人工介入 | 连续 submit 3 次 FAIL |

### Phase 4 回溯验证

| 编号 | 标准 | 验证方式 |
|------|------|---------|
| AC-10 | Phase 4 裁决 prompt 包含 design-review.md 和 plan-review.md 内容 | 检查构建的 prompt |
| AC-11 | Phase 1 评审中的 P0 未修复时，Phase 4 裁决 FAIL | 构造未修复场景测试 |

### Phase 7 复盘

| 编号 | 标准 | 验证方式 |
|------|------|---------|
| AC-12 | retrospective-data.md 由框架自动生成，主 Agent 不能修改 | 检查生成流程不经过主 Agent |
| AC-13 | 自动数据包含：拦截次数、Phase 耗时、裁决结果、submit 重试次数 | 检查文件内容 |
| AC-14 | 主 Agent 复盘中的数字与框架数据不一致时，裁决 FAIL | 构造数据不一致场景 |
| AC-15 | 裁决记录中有 FAIL 但复盘未提及时，裁决 FAIL | 构造遗漏场景 |

## 十一、监督链路全景

```
Phase 1 设计评审 ──► design-review.md ──────────────┐
                                                    │
Phase 2 计划评审 ──► plan-review.md ───────────────┐│
                                                   ││
Phase 3 代码实施 ──► git diff ────────────────────┐││
                                                  │││
                                                  ▼▼▼
Phase 4 裁决 ◄── 回溯验证 Phase 1/2 的结论是否落地 ──► tribunal-phase4.md
    │                   + 独立代码审查
    ▼
Phase 5 裁决 ◄── 对比框架 test log vs Agent 声称结果 ──► tribunal-phase5.md
    │                   + SKIP 合理性审查
    ▼
Phase 6 裁决 ◄── 逐条验证设计验收标准 ──────────────► tribunal-phase6.md
    │
    ▼
Phase 7 裁决 ◄── 框架自动生成数据（不可篡改）─────────► retrospective-data.md
                 + 审查主 Agent 复盘的诚实度 ─────────► tribunal-phase7.md
```

每个裁决 Phase 的产出（tribunal-phase*.md）都是不可篡改的证据，
为后续 Phase 的裁决提供输入，形成闭环监督。

## 十二、成本估算

| 场景 | 裁决次数 | 额外 Token | 额外时间 |
|------|---------|-----------|---------|
| 一次顺利通过 | 4 次（Phase 4/5/6/7 各 1 次） | ~40k tokens | ~80 秒 |
| 有修复的情况 | 6-8 次 | ~70k tokens | ~3 分钟 |
| 极端情况 | 12 次（每个 Phase 重试 3 次） | ~120k tokens | ~4 分钟 |

相比于漏掉一个安全漏洞（如本次 context-path 绕过），这个成本完全值得。

**注**：Token 估算已上调——实际每次裁决约 20k-40k input tokens（需读取多个文件），总计约 100k-180k tokens。

---

## 十三、设计修订（基于 Phase 1 评审反馈）

以下修订基于 design-review.md 中的 2 P0 + 9 P1 发现。

### 修订 1：`claude` CLI 路径解析（P0-1）

**问题**：`claude` 在多数环境是 nvm/npx 别名，不是 PATH 中的二进制文件。`execFile("claude", [...])` 会失败。

**修订方案**：

```typescript
// tribunal.ts 新增：启动时解析 claude 路径
async function resolveClaudePath(): Promise<string> {
  // 1. 环境变量覆盖（最高优先级）
  if (process.env.TRIBUNAL_CLAUDE_PATH) {
    return process.env.TRIBUNAL_CLAUDE_PATH;
  }

  // 2. 尝试 which claude（全局安装）
  try {
    const { stdout } = await execPromise("which claude");
    if (stdout.trim()) return stdout.trim();
  } catch {}

  // 3. 尝试常见路径
  const candidates = [
    "/usr/local/bin/claude",
    `${process.env.HOME}/.npm-global/bin/claude`,
    `${process.env.HOME}/.claude/local/claude`,
  ];
  for (const p of candidates) {
    try { await stat(p); return p; } catch {}
  }

  // 4. 回退到 npx（shell: true 以解析 nvm）
  return "npx --yes @anthropic-ai/claude-code";
}

// init 时调用并缓存
let claudePath: string | null = null;
async function getClaudePath(): Promise<string> {
  if (!claudePath) claudePath = await resolveClaudePath();
  return claudePath;
}
```

`runTribunal` 改用解析后的路径：
```typescript
const resolved = await getClaudePath();
const useShell = resolved.startsWith("npx");
const child = useShell
  ? exec(`${resolved} -p "${escapedPrompt}" --output-format json ...`, { shell: true, ... })
  : execFile(resolved, ["-p", prompt, "--output-format", "json", ...], { ... });
```

**新增 AC**：`AC-16: auto_dev_init 时验证 claude CLI 可达，不可达时返回警告`

### 修订 2：裁决进程瞬态失败重试（P0-2）

**问题**：超时/网络错误/npx 卡住时直接视为 FAIL，主 Agent 白白修复不存在的问题。

**修订方案**：

```typescript
async function runTribunalWithRetry(inputFile: string): Promise<TribunalVerdict> {
  const MAX_RETRIES = 1;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const result = await runTribunal(inputFile);

    // 区分"裁决 Agent 判定 FAIL"和"进程崩溃"
    const isCrash = result.issues.some(i =>
      i.description.includes("裁决进程执行失败") ||
      i.description.includes("JSON 解析失败") ||
      i.description.includes("未返回有效的 structured_output")
    );

    if (!isCrash) return result;  // 正常裁决（无论 PASS/FAIL），直接返回

    if (attempt < MAX_RETRIES) {
      // 瞬态失败，等 3 秒重试
      await new Promise(r => setTimeout(r, 3000));
      continue;
    }

    // 重试也失败了，标记为 CRASH_FAIL
    return {
      verdict: "FAIL",
      issues: [{
        severity: "P0",
        description: `裁决进程连续 ${MAX_RETRIES + 1} 次崩溃（非裁决结果），请检查 claude CLI 是否可用后重新 submit`
      }],
      raw: result.raw,
    };
  }
  return result!; // unreachable
}
```

`executeTribunal` 中 `runTribunal` → `runTribunalWithRetry`。

### 修订 3：`--max-turns` 调整（P1）

**问题**：Phase 4 需要读 7+ 文件，`--max-turns 3` 不够。

**修订**：所有审查材料在 `prepareTribunalInput` 中已拼接到单个 `tribunal-input-phase{N}.md` 文件，文件中只列出路径让 Agent 读。但 diff 单独一个文件。

```typescript
// 按 Phase 调整 max-turns
const maxTurns: Record<number, number> = {
  4: 10,  // 需读 input + diff + 可能的源文件
  5: 8,   // 需读 input + diff + test log + test files
  6: 6,   // 需读 input + diff + acceptance report
  7: 6,   // 需读 input + retrospective + progress-log
};
```

### 修订 4：PASS 无证据时强制 FAIL（P1）

**问题**：`passEvidence` 是 optional，裁决 Agent 可以返回空证据的 PASS。

**修订**：在 `executeTribunal` 中 verdict 解析后加校验：

```typescript
if (data.verdict === "PASS" && (!data.passEvidence || data.passEvidence.length === 0)) {
  resolve({
    verdict: "FAIL",
    issues: [{ severity: "P0", description: "裁决判定 PASS 但未提供任何证据（passEvidence 为空）。PASS 必须逐条举证。" }],
    raw: stdout,
  });
  return;
}
```

### 修订 5：SKILL.md 加入文件改动清单（P1）

**问题**：主 Agent 不知道 Phase 4/5/6/7 要调 `auto_dev_submit` 而不是 `checkpoint`。

**修订**：SKILL.md 文件加入改动清单。驱动循环改为：

```markdown
# SKILL.md 修订

## 驱动循环
if phase in [1, 2, 3]:
    checkpoint_result = checkpoint(phase, status, tokenEstimate=tokens)
elif phase in [4, 5, 6, 7]:
    submit_result = auto_dev_submit(phase, summary)
    # submit 内部触发独立裁决 → 自动写 checkpoint
    # 主 Agent 只收到 TRIBUNAL_PASS 或 TRIBUNAL_FAIL
```

### 修订 6：使用进程退出码替代日志正则（P1）

**问题**：`crossValidate` 中用正则匹配 test log 有误报风险。

**修订**：`prepareTribunalInput` 中记录 testCmd 退出码：

```typescript
// 记录退出码
const exitCode = err ? (err as any).code || 1 : 0;
await writeFile(join(outputDir, "framework-test-exitcode.txt"), String(exitCode));
```

`crossValidate` 改为检查退出码：

```typescript
const exitCode = parseInt(await readFile(join(outputDir, "framework-test-exitcode.txt"), "utf-8"), 10);
if (exitCode !== 0) {
  return "框架执行 testCmd 退出码非零，但裁决 Agent 判定 PASS";
}
```

### 修订 7：`writeCheckpoint` 复用现有逻辑（P1）

**问题**：设计中的 `writeCheckpoint()` 不存在，直接写 progress-log 会绕过现有 guards。

**修订**：从 checkpoint handler 中提取共享的内部函数：

```typescript
// state-manager.ts 新增
export async function internalCheckpoint(
  outputDir: string,
  phase: number,
  status: string,
  summary: string,
): Promise<void> {
  // 复用现有 checkpoint 逻辑：
  // 1. 幂等检查
  // 2. 前序 Phase 验证
  // 3. 写 progress-log
  // 4. 更新 state.json
  // 5. 更新 phaseTimings
}
```

tribunal 和 MCP tool handler 都调用 `internalCheckpoint`。

### 修订 8：submit 重试计数（P1 - AC-9）

```typescript
// auto_dev_submit handler 中
const state = await sm.readState();
const submitKey = `tribunalSubmits_phase${phase}`;
const currentCount = (state as any)[submitKey] || 0;

if (currentCount >= 3) {
  return textResult({
    status: "TRIBUNAL_ESCALATE",
    message: `Phase ${phase} 已连续 submit ${currentCount} 次仍未通过裁决。需要人工介入。`,
    mandate: "请人工检查裁决记录（tribunal-phase*.md）并决定是否强制通过。",
  });
}

// 递增计数
await sm.atomicUpdate({ [submitKey]: currentCount + 1 });
```

### 修订 9：`auto_dev_complete` 与 Phase 7 tribunal 的交互（P1）

**修订**：`auto_dev_complete` 不再自动触发 Phase 7。Phase 7 由主 Agent 显式 submit。`complete` 只做验证（所有 Phase 包括 7 已 PASS）。

### 修订 10：现有验证函数命运映射表（P1）

| 现有函数 | 命运 | 说明 |
|---|---|---|
| `validatePhase5Artifacts()` | **保留为快速预检** | 在 submit 中先调用，测试文件数=0 直接拒绝（不浪费裁决 token） |
| `validatePhase6Artifacts()` | **保留为快速预检** | acceptance-report.md 不存在直接拒绝 |
| `validatePhase7Artifacts()` | **保留为快速预检** | retrospective.md 不存在直接拒绝 |
| Phase 5 testCmd 执行 | **移至 tribunal** | `prepareTribunalInput` 中执行，日志写入文件供裁决 Agent 读 |
| Phase 5/6/7 checkpoint PASS 逻辑 | **移至 tribunal** | `executeTribunal` 中调用 `internalCheckpoint` |
| `countTestFiles()` | **保留** | submit 预检 + crossValidate 都用 |
| `parseInitMarker()` | **保留** | tribunal 读 testCmd 用 |

### 修订 11：submit 返回值规范（P1）

```typescript
// TRIBUNAL_PASS 返回
{
  status: "TRIBUNAL_PASS",
  phase: number,
  nextPhase: number,         // 新增：告诉主 Agent 下一个 Phase
  mandate: string,           // 新增：与 checkpoint 一致的强制指令
  message: string,
  suggestions: Issue[],      // PASS 时的建议项
}

// TRIBUNAL_FAIL 返回
{
  status: "TRIBUNAL_FAIL",
  phase: number,
  message: string,
  issues: Issue[],
  mandate: "请根据以上问题逐一修复，修复完成后再次调用 auto_dev_submit。",
  remainingSubmits: number,  // 新增：剩余 submit 次数
}
```

### 更新后的文件改动清单

| 文件 | 改动 | 说明 |
|---|---|---|
| `mcp/src/index.ts` | 修改 | 新增 `auto_dev_submit` handler；checkpoint 拦截 Phase 4/5/6/7 的 PASS |
| `mcp/src/tribunal.ts` | **新增** | 裁决流程：resolveClaudePath、prepareTribunalInput、runTribunal、runTribunalWithRetry、crossValidate、executeTribunal |
| `mcp/src/tribunal-schema.ts` | **新增** | TRIBUNAL_SCHEMA JSON Schema + maxTurns 配置 |
| `mcp/src/tribunal-checklists.ts` | **新增** | Phase 4/5/6/7 检查清单（写入 tribunal-input 文件） |
| `mcp/src/retrospective-data.ts` | **新增** | Phase 7 自动数据生成 |
| `mcp/src/state-manager.ts` | 修改 | 提取 `internalCheckpoint` 共享函数 |
| `mcp/src/phase-enforcer.ts` | 修改 | 保留为快速预检 |
| `mcp/src/types.ts` | 修改 | 新增 TribunalVerdict 类型 |
| `skills/auto-dev/SKILL.md` | **修改** | 驱动循环改为 Phase 4/5/6/7 用 submit |
| `skills/auto-dev/prompts/phase7-retrospective.md` | 修改 | Phase 7 不再由主 Agent 驱动 |

### 更新后的验收标准（新增 AC-16）

| AC-16 | auto_dev_init 时验证 claude CLI 可达，不可达时返回警告 | startup health check |
