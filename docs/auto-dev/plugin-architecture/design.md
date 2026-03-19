# auto-dev Plugin 架构设计 v2（修订版）

> 基于 Claude Code Plugin SDK 实际能力修订。
> 核心变化：Plugin 不是 TypeScript 编排器，而是 **MCP 工具 + Skill 指令 + Agent 定义 + Hook 自动化** 的组合。

## 1. 关键认知修正

### 原设计（v1）的错误假设

```
❌ Plugin 是一个 TypeScript 应用，有 main() 入口函数
❌ Plugin 可以主动调度 Claude（"dispatch subagent"）
❌ Plugin 控制流程，Claude 只是执行者
```

### 实际的 Plugin 架构

```
✅ Plugin 是一个资源包，包含 5 种组件
✅ Claude 调用 Plugin 提供的 MCP 工具（Claude 是主动方）
✅ Skill 告诉 Claude "怎么做"，MCP 工具负责"做的时候保证确定性"
✅ Agents 定义专用 subagent（替代 prompts/*.md）
✅ Hooks 在事件发生时自动触发脚本
```

### 控制流对比

```
原设计（不可行）：
  Plugin.run() --> 调度 Claude --> Claude 执行 --> Plugin 检查结果

修订设计（可行）：
  Claude 读 Skill 指令
    --> Claude 调用 MCP tool: auto_dev_init()
    --> Claude 调用 Agent tool: spawn architect subagent
    --> Claude 调用 MCP tool: auto_dev_checkpoint()
    --> Claude 调用 MCP tool: auto_dev_render_prompt()
    --> Claude 调用 Agent tool: spawn reviewer subagent
    --> ...
  Hook 在每次 tool use 后自动触发检查
```

## 2. 架构总览

```
┌─────────────────────────────────────────────────────────┐
│                    Claude (主控)                          │
│                                                         │
│  读 Skill 指令 → 决定下一步 → 调用 MCP 工具 / Agent     │
│                                                         │
└──────────┬──────────┬──────────┬──────────┬─────────────┘
           │          │          │          │
     ┌─────▼────┐ ┌──▼───┐ ┌───▼──┐ ┌────▼─────┐
     │ MCP      │ │Agent │ │Skill │ │ Hook     │
     │ Server   │ │定义  │ │指令  │ │ 自动化   │
     │          │ │      │ │      │ │          │
     │ 确定性   │ │专用  │ │流程  │ │ 事件     │
     │ 工具     │ │子代理│ │编排  │ │ 驱动     │
     └──────────┘ └──────┘ └──────┘ └──────────┘
```

### 四种组件各自的职责

| 组件 | 职责 | 解决什么问题 |
|------|------|-------------|
| **MCP Server** | 提供确定性工具（状态管理、模板渲染、精确回滚、元学习） | 变量替换靠谱、状态持久化精确、diff 校验自动化 |
| **Agents** | 定义专用 subagent（architect、reviewer、developer 等） | 替代 prompts/*.md，成为 Claude 原生的 agent 类型 |
| **Skill** | 告诉 Claude 流程编排逻辑（Phase 顺序、循环、重试） | 流程控制（仍靠自然语言，但大幅精简——确定性部分都交给 MCP） |
| **Hooks** | 事件驱动自动化（tool use 后、session 开始时） | 自动更新 progress-log、自动检测未调用 checkpoint |

## 3. MCP Server 设计

### 3.1 MCP 工具清单（精简版，共 10 个）

> **设计决策**：只封装"Claude 做不好或容易出错"的操作为 MCP 工具。git status/branch/commit/stash 等命令本身是确定性的，Claude 可以直接通过 bash 执行，无需封装。progress-log 追加和 summary 生成同理，Claude 用 Write/Edit 工具即可完成。

```
auto_dev_init          初始化：创建工作目录、检测技术栈、生成 state.json
auto_dev_state_get     读取当前状态（用于 --resume）
auto_dev_state_update  更新状态（phase、task、iteration 等）
auto_dev_checkpoint    写入结构化 CHECKPOINT 到 progress-log + 更新 state.json
auto_dev_render        读模板 + 替换变量 + 注入 checklist → 返回完整 prompt
auto_dev_preflight     Pre-flight 检查：前置文件存在？git 状态干净？
auto_dev_diff_check    比对 plan 中指定的文件 vs 实际变更文件，返回异常列表
auto_dev_git_rollback  回滚指定任务的变更（用 git diff --name-only 精确回滚）
auto_dev_lessons_add   记录一条经验教训
auto_dev_lessons_get   获取指定 Phase 的历史教训（注入到 prompt）
```

#### 移除的工具及替代方式

| 原 MCP 工具 | 替代方式 |
|-------------|---------|
| `auto_dev_git_status` | Skill 指令让 Claude 直接执行 `git status` / `git diff --stat` |
| `auto_dev_git_branch` | Skill 指令让 Claude 直接执行 `git checkout -b` / `git switch` |
| `auto_dev_git_commit` | Skill 指令让 Claude 直接执行 `git add` + `git commit -m "auto-dev: ..."` |
| `auto_dev_git_stash` | Skill 指令让 Claude 直接执行 `git stash` / `git stash pop` |
| `auto_dev_progress_log` | Skill 指令让 Claude 直接用 Write/Edit 工具追加内容到 progress-log.md |
| `auto_dev_summary` | Skill 指令让 Claude 读取 state.json + progress-log.md 自行汇总 |

### 3.2 核心工具详细设计

#### auto_dev_init

```typescript
// 输入
interface InitInput {
  projectRoot: string;
  topic: string;
  mode: 'full' | 'quick';
  startPhase?: number;
  noConfirm?: boolean;
  onConflict?: 'resume' | 'overwrite';  // 已存在目录时的处理策略
}

// 输出
interface InitOutput {
  outputDir: string;         // docs/auto-dev/{topic}
  stateFile: string;         // docs/auto-dev/{topic}/state.json
  resumed: boolean;          // 是否从已有状态恢复
  stack: {
    language: string;
    buildCmd: string;
    testCmd: string;
    langChecklist: string;
  };
  git: {
    currentBranch: string;
    isDirty: boolean;
    diffStat: string;        // 如果 dirty，返回 diff stat
  };
  variables: Record<string, string>;  // 所有运行时变量
}

// 实现逻辑
// 1. 检查 {outputDir} 是否已存在
//    - 如果已存在且 onConflict 未指定 → 返回错误，提示用户选择 resume 或 overwrite
//    - 如果 onConflict='resume' → 读取已有 state.json，校验完整性，设置 resumed=true
//    - 如果 onConflict='overwrite' → 备份已有目录为 {outputDir}.bak.{timestamp}，重新创建
// 2. 创建 {outputDir}（仅 overwrite 或新建时）
// 3. 检测技术栈（扫描 pom.xml/package.json/etc）
// 4. 读取对应 stacks/*.md 解析变量
// 5. 检查 git status
// 6. 初始化 state.json（使用 write-to-temp-then-rename 保证原子性）
// 7. 创建 progress-log.md 头部
// 8. 返回所有信息供 Claude 展示给用户
```

#### auto_dev_render

```typescript
// 输入
interface RenderInput {
  promptFile: string;        // 如 "phase1-architect"
  variables: Record<string, string>;
  extraContext?: string;      // 额外注入（如 lessons-learned）
}

// 输出
interface RenderOutput {
  renderedPrompt: string;    // 完整的、变量已替换、checklist 已注入的 prompt
  warnings: string[];        // 如果有未替换的变量
}

// 实现逻辑
// 1. 读取 skill 目录下的 prompts/{promptFile}.md
// 2. 解析 <!-- requires: ... --> 依赖声明
// 3. 读取并注入对应的 checklist 文件
// 4. 替换所有 {variable} 占位符
// 5. 检查是否有未替换的变量 → 加入 warnings
// 6. 如果有 extraContext，追加到 prompt 末尾
// 7. 返回完整 prompt
```

#### auto_dev_checkpoint

```typescript
// 输入
interface CheckpointInput {
  phase: number;
  task?: number;             // Phase 3 专用
  status: 'IN_PROGRESS' | 'PASS' | 'NEEDS_REVISION' | 'BLOCKED' | 'COMPLETED';
  summary?: string;          // 简短描述
}

// 实现逻辑
// 1. 生成 <!-- CHECKPOINT phase=X task=Y status=Z timestamp=T -->
// 2. 追加到 progress-log.md
// 3. 更新 state.json 中对应字段
// 4. 如果 status=BLOCKED，额外创建 BLOCKED.md
//
// === 原子性保证（D1 修复）===
// state.json 写入采用 write-to-temp-then-rename 模式：
//   a. 将新内容写入 state.json.tmp（同目录，保证同文件系统）
//   b. 调用 fs.rename(state.json.tmp, state.json)（POSIX rename 是原子的）
//   c. 如果 rename 失败，state.json.tmp 保留供人工恢复
//
// 写入顺序：先写 progress-log.md，再写 state.json
//   - 如果 progress-log 写入成功但 state.json 写入失败：
//     在 state.json 中标记 dirty=true（如果能写入），或保留 state.json.tmp
//     下次 auto_dev_state_get 读取时检测到 dirty 状态，提示用户
//   - 如果 progress-log 写入失败：直接抛错，不更新 state.json
//
// === 幂等性保证（D2 修复）===
// 在追加 progress-log 前，检查最后一条 CHECKPOINT 的 phase+task+status+summary：
//   - 如果与当前调用参数完全相同 → 跳过追加，直接返回（幂等）
//   - 如果 phase+task 相同但 status 不同 → 正常追加（状态变更）
// state.json 的更新天然幂等（相同值覆盖写入无副作用）

// state.json 校验：
// auto_dev_state_get 读取时做 schema validation，如果文件损坏或格式错误，
// 返回明确错误信息而非 crash，并提示用户可以删除 state.json 重新 init
```

#### auto_dev_diff_check

```typescript
// 输入
interface DiffCheckInput {
  expectedFiles: string[];   // plan 中指定的文件列表
  baseCommit: string;        // 任务开始前的 commit
}

// 输出
interface DiffCheckOutput {
  actualFiles: string[];     // 实际变更的文件
  expectedButMissing: string[];   // plan 中指定但未变更的
  unexpectedChanges: string[];    // 变更了但 plan 未提及的
  diffStat: string;               // git diff --stat
  isClean: boolean;               // 没有异常
}
```

### 3.3 MCP Server 实现

```typescript
// mcp/src/index.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { StateManager } from "./state-manager.js";
import { TemplateRenderer } from "./template-renderer.js";
import { GitManager } from "./git-manager.js";
import { LessonsManager } from "./lessons-manager.js";

const server = new McpServer({
  name: "auto-dev",
  version: "5.0.0",
});

// === auto_dev_init ===
server.tool(
  "auto_dev_init",
  "Initialize auto-dev session: create work dir, detect tech stack, init state. If directory exists, onConflict controls behavior (resume/overwrite).",
  {
    projectRoot: z.string(),
    topic: z.string(),
    mode: z.enum(["full", "quick"]),
    startPhase: z.number().optional(),
    onConflict: z.enum(["resume", "overwrite"]).optional(),
  },
  async ({ projectRoot, topic, mode, startPhase, onConflict }) => {
    const state = new StateManager(projectRoot, topic);

    // 已存在目录的处理逻辑（D2 修复）
    if (await state.outputDirExists()) {
      if (!onConflict) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              error: "OUTPUT_DIR_EXISTS",
              message: `Directory docs/auto-dev/${topic} already exists. Call again with onConflict='resume' to continue from last checkpoint, or onConflict='overwrite' to start fresh (existing dir will be backed up).`,
              existingState: await state.tryReadState(),
            }, null, 2),
          }],
        };
      }
      if (onConflict === "resume") {
        const existingState = await state.loadAndValidate();
        return {
          content: [{
            type: "text",
            text: JSON.stringify({ ...existingState, resumed: true }, null, 2),
          }],
        };
      }
      if (onConflict === "overwrite") {
        await state.backupExistingDir();
      }
    }

    const stack = await state.detectStack();
    const git = await new GitManager(projectRoot).getStatus();
    await state.init(mode, stack, startPhase);
    return {
      content: [{
        type: "text",
        text: JSON.stringify({ ...state.getFullState(), resumed: false }, null, 2),
      }],
    };
  }
);

// === auto_dev_state_get ===
server.tool(
  "auto_dev_state_get",
  "Read current auto-dev state with schema validation. Reports dirty/corrupted state clearly.",
  {
    projectRoot: z.string(),
    topic: z.string(),
  },
  async ({ projectRoot, topic }) => {
    const state = new StateManager(projectRoot, topic);
    const result = await state.loadAndValidate(); // schema validation + dirty check
    return {
      content: [{
        type: "text",
        text: JSON.stringify(result, null, 2),
      }],
    };
  }
);

// === auto_dev_state_update ===
server.tool(
  "auto_dev_state_update",
  "Update state fields (phase, task, iteration, etc.) with atomic write",
  {
    projectRoot: z.string(),
    topic: z.string(),
    updates: z.record(z.unknown()),
  },
  async ({ projectRoot, topic, updates }) => {
    const state = new StateManager(projectRoot, topic);
    await state.atomicUpdate(updates); // write-to-temp-then-rename
    return {
      content: [{
        type: "text",
        text: JSON.stringify(state.getFullState(), null, 2),
      }],
    };
  }
);

// === auto_dev_render ===
server.tool(
  "auto_dev_render",
  "Render a prompt template with variable substitution and checklist injection",
  {
    promptFile: z.string(),
    variables: z.record(z.string()),
    extraContext: z.string().optional(),
  },
  async ({ promptFile, variables, extraContext }) => {
    const renderer = new TemplateRenderer();
    const result = await renderer.render(promptFile, variables, extraContext);
    return {
      content: [{
        type: "text",
        text: result.renderedPrompt,
      }],
    };
  }
);

// === auto_dev_checkpoint ===
server.tool(
  "auto_dev_checkpoint",
  "Write structured checkpoint to progress-log and update state.json. Idempotent: same params won't duplicate entries. Atomic: uses write-to-temp-then-rename.",
  {
    phase: z.number(),
    task: z.number().optional(),
    status: z.enum(["IN_PROGRESS", "PASS", "NEEDS_REVISION", "BLOCKED", "COMPLETED"]),
    summary: z.string().optional(),
  },
  async ({ phase, task, status, summary }) => {
    // 1. 幂等检查：读取 progress-log 最后一条 CHECKPOINT
    //    如果 phase+task+status+summary 完全相同 → 跳过，返回 {idempotent: true}
    // 2. 追加 CHECKPOINT 到 progress-log.md
    // 3. 原子更新 state.json（write-to-temp-then-rename）
    // 4. 如果 state.json 更新失败 → 标记 dirty，返回错误
    // 5. 如果 status=BLOCKED → 创建 BLOCKED.md
  }
);

// === auto_dev_preflight ===
server.tool(
  "auto_dev_preflight",
  "Pre-flight check: verify prerequisites for a phase (files exist, git clean, etc.)",
  {
    projectRoot: z.string(),
    topic: z.string(),
    phase: z.number(),
  },
  async ({ projectRoot, topic, phase }) => {
    // ... 检查前置条件
  }
);

// === auto_dev_diff_check ===
server.tool(
  "auto_dev_diff_check",
  "Compare expected files from plan vs actual git changes, report discrepancies",
  {
    expectedFiles: z.array(z.string()),
    baseCommit: z.string(),
  },
  async ({ expectedFiles, baseCommit }) => {
    const git = new GitManager(process.cwd());
    const result = await git.diffCheck(expectedFiles, baseCommit);
    return {
      content: [{
        type: "text",
        text: JSON.stringify(result, null, 2),
      }],
    };
  }
);

// === auto_dev_git_rollback ===
server.tool(
  "auto_dev_git_rollback",
  "Rollback changes for a specific task using git diff --name-only for precise file-level rollback",
  {
    baseCommit: z.string(),
    files: z.array(z.string()).optional(),
  },
  async ({ baseCommit, files }) => {
    const git = new GitManager(process.cwd());
    const result = await git.rollback(baseCommit, files);
    return {
      content: [{
        type: "text",
        text: JSON.stringify(result, null, 2),
      }],
    };
  }
);

// === auto_dev_lessons_add ===
server.tool(
  "auto_dev_lessons_add",
  "Record a lesson learned from the current session",
  {
    phase: z.number(),
    category: z.string(),
    lesson: z.string(),
    context: z.string().optional(),
  },
  async ({ phase, category, lesson, context }) => {
    const lessons = new LessonsManager(process.cwd());
    await lessons.add(phase, category, lesson, context);
    return {
      content: [{
        type: "text",
        text: "Lesson recorded.",
      }],
    };
  }
);

// === auto_dev_lessons_get ===
server.tool(
  "auto_dev_lessons_get",
  "Get historical lessons for a specific phase to inject into prompts",
  {
    phase: z.number(),
    category: z.string().optional(),
  },
  async ({ phase, category }) => {
    const lessons = new LessonsManager(process.cwd());
    const result = await lessons.get(phase, category);
    return {
      content: [{
        type: "text",
        text: JSON.stringify(result, null, 2),
      }],
    };
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
```

## 4. Agent 定义（替代 prompts/*.md）

Plugin 的 `agents/` 目录定义专用 subagent，Claude 可以自动或手动调用。

### agents/auto-dev-architect.md

```markdown
---
description: Senior Software Architect for auto-dev design phase. Use when auto-dev Phase 1 needs an architecture design document.
capabilities: ["architecture-design", "codebase-exploration", "trade-off-analysis"]
---

# Auto-Dev Architect

你是一个资深架构师（Senior Software Architect）。
你拥有 15+ 年分布式系统经验。你不追求完美架构，而是在当前约束下找到最佳平衡点。
你总是考虑运维和可维护性。你见过太多过度设计的系统最终被推翻重来。

## 何时被调用

auto-dev 的 Phase 1 DESIGN 阶段，主 Agent 使用渲染后的 prompt 调用你。

## 工作方式

1. 探索代码库，理解现有架构
2. 按 prompt 中的产出要求撰写设计文档
3. 将设计文档写入指定路径
4. 返回核心决策摘要

## 约束

- 不过度设计（YAGNI）
- 至少评估 2 个方案
- 不忽略迁移路径和回滚方案
- 不选择团队不熟悉的技术栈
```

### agents/auto-dev-reviewer.md

```markdown
---
description: Architecture and code review expert for auto-dev review phases. Use when auto-dev needs design review, plan review, or full code review.
capabilities: ["design-review", "code-review", "plan-review", "security-audit"]
---

# Auto-Dev Reviewer

你是一个审查专家，根据被调用的阶段扮演不同角色：
- Phase 1: 架构评审专家
- Phase 2: 计划审查专家
- Phase 3: 代码审查员（快速）
- Phase 4: 高级代码审查专家（深度）
- Phase 5: 测试覆盖度分析师

## 审查输出格式

始终使用 P0/P1/P2 分级：
- P0：阻塞性问题，必须修复（附具体修复建议）
- P1：重要问题，应该修复（附具体修复建议）
- P2：优化建议，可选
- 总结：PASS / NEEDS_REVISION / NEEDS_FIX

## 约束

- 不 bikeshed（不在小问题上纠缠）
- P0/P1 必须给出具体修复建议
- 只检查与本次变更相关的 checklist 项
```

### agents/auto-dev-developer.md

```markdown
---
description: Senior developer for auto-dev task execution. Use when auto-dev Phase 3 needs to implement a specific task.
capabilities: ["code-implementation", "bug-fixing", "test-writing"]
---

# Auto-Dev Developer

你是一个高级开发者（Senior Developer）。你只做任务要求的事，不多不少。

## 约束

- 只做任务描述中要求的改动
- 不"顺手"重构或添加任务未要求的功能/注释/日志
- 外部 API 调用必须先确认参数签名，禁止猜测
- 确保代码可编译
- 遵循项目现有代码风格

## 输出

完成后简要说明：
1. 修改了哪些文件
2. 每个文件做了什么改动
```

### agents/auto-dev-test-architect.md

```markdown
---
description: Test design expert for auto-dev E2E test phase. Use when auto-dev Phase 5 needs test case design.
capabilities: ["test-design", "equivalence-partitioning", "boundary-analysis", "coverage-analysis"]
---

# Auto-Dev Test Architect

你是测试架构师，精通等价类划分、边界值分析、决策表、状态转换等测试技术。

## 约束

- 不写模糊步骤（不写"输入有效数据"）
- 预期结果必须可客观验证（不写"系统正常工作"）
- 每个测试用例必须可独立执行
- 包含负面测试
```

## 5. Skill 精简（只保留流程编排）

Plugin 化后，SKILL.md 大幅精简——确定性操作全交给 MCP 工具，agent prompt 全交给 agents/ 定义：

```markdown
---
name: auto-dev
description: "自治开发循环 ..."
---

# auto-dev (Plugin-Powered)

> 本 skill 由 auto-dev Plugin 的 MCP 工具和 Agent 定义驱动。

## 流程

### 初始化
1. 调用 `auto_dev_init(projectRoot, topic, mode)` → 获取技术栈和变量
   - 如果返回 `OUTPUT_DIR_EXISTS` 错误 → 展示已有状态，让用户选择 resume 或 overwrite，再次调用 init
2. 如果 git dirty → 展示 diff stat，让用户选择 a/b/c/d
3. 展示变量表和成本预估，等用户确认

### Phase 1: DESIGN
1. `auto_dev_preflight(phase=1)` 检查前置条件
2. `auto_dev_render("phase1-architect", variables)` 获取渲染后的 prompt
3. 用渲染后的 prompt 调用 auto-dev-architect Agent
4. `auto_dev_checkpoint(phase=1, status="IN_PROGRESS")`
5. `auto_dev_render("phase1-design-reviewer", variables)` + 调用 auto-dev-reviewer Agent
6. 读 review 结果判断 PASS/NEEDS_REVISION
7. `auto_dev_checkpoint(phase=1, status=result)`
8. 如果 PASS 且非 --no-confirm → 展示摘要等用户确认

### Phase 2-5: 类似模式
（每个 Phase: preflight → render → agent → checkpoint → 判断 → 循环/继续）

### Phase 3 特别处理
每个任务完成后：
1. Claude 直接执行 `git add <files> && git commit -m "auto-dev: <message>"`
2. `auto_dev_diff_check(expectedFiles, baseCommit)` → 如有异常文件，警告
3. `auto_dev_checkpoint(phase=3, task=N, status=result)`
如果任务 BLOCKED：
4. `auto_dev_git_rollback(baseCommit)`

### 完成后
1. Claude 读取 state.json + progress-log.md，汇总统计信息展示给用户
2. `auto_dev_checkpoint(status="COMPLETED")`
3. 如果有 stash → Claude 直接执行 `git stash pop`
```

**行数预估**：~80 行（从 v4 的 ~400 行降到 ~80 行）

## 6. Hooks 设计

### hooks/hooks.json

```json
{
  "hooks": {
    "SubagentStop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "${CLAUDE_PLUGIN_ROOT}/hooks/post-agent.sh"
          }
        ]
      }
    ]
  }
}
```

### hooks/post-agent.sh

```bash
#!/bin/bash
# SubagentStop 后自动提醒 Claude 更新 progress-log
# 通过向 stderr 输出提示信息（Claude 会看到 hook 输出）
echo "REMINDER: If this was an auto-dev subagent, call auto_dev_checkpoint() now." >&2
```

> Hook 不能强制 Claude 调用工具，但可以输出提醒。这比纯 Skill 指令多了一层"提醒网"。

## 7. 完整文件结构

```
~/.claude/plugins/auto-dev/              # Plugin 包
├── .claude-plugin/
│   ├── plugin.json                      # Plugin manifest
│   └── marketplace.json                 # 本地开发用
├── skills/
│   └── auto-dev/
│       ├── SKILL.md                     # 精简版流程编排（~80 行）
│       ├── checklists/                  # 审查清单（不变）
│       │   ├── design-review.md
│       │   ├── plan-review.md
│       │   ├── code-review-common.md
│       │   ├── code-review-java8.md
│       │   └── code-review-typescript.md
│       └── stacks/                      # 技术栈配置（不变）
│           ├── java-maven.md
│           ├── java-gradle.md
│           ├── node-npm.md
│           └── python.md
├── agents/                              # 专用 subagent 定义（替代 prompts/）
│   ├── auto-dev-architect.md
│   ├── auto-dev-reviewer.md
│   ├── auto-dev-developer.md
│   └── auto-dev-test-architect.md
├── commands/                            # Slash 命令
│   └── auto-dev.md                      # /auto-dev 入口
├── hooks/
│   ├── hooks.json
│   └── post-agent.sh
├── mcp/                                 # MCP Server
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts                     # MCP Server 入口 + 工具注册（10 个工具）
│       ├── state-manager.ts             # 状态管理（含原子写入）
│       ├── template-renderer.ts         # 模板渲染
│       ├── git-manager.ts              # Git 操作封装（仅 rollback + diff_check）
│       ├── lessons-manager.ts          # 元学习
│       └── types.ts                     # 类型定义
└── README.md
```

## 8. Skill v4 vs Plugin v5 能力对比（修订版）

| 能力 | Skill v4 | Plugin v5 | 谁负责 |
|------|----------|-----------|--------|
| 流程控制 | SKILL.md 自然语言 (~400行) | SKILL.md 自然语言 (**~80行**) | Skill（精简，确定性操作外移） |
| 变量替换 | Claude 手动 | `auto_dev_render()` 自动 | MCP |
| 状态持久化 | progress-log 自然语言 | `state.json` 结构化（原子写入） | MCP |
| 断点恢复 | grep CHECKPOINT | `auto_dev_state_get()` | MCP |
| Pre-flight | SKILL.md 表格 | `auto_dev_preflight()` 代码检查 | MCP |
| Git 常规操作 | Claude 跑 bash 命令 | Claude 跑 bash 命令（Skill 指令引导） | Skill |
| Git 精确回滚 | 无 | `auto_dev_git_rollback()` 封装 | MCP |
| diff 范围校验 | 无 | `auto_dev_diff_check()` | MCP |
| 元学习 | 无 | `auto_dev_lessons_*()` | MCP |
| Agent 定义 | prompts/*.md（Claude Read 后传给 Agent 工具） | agents/*.md（Claude 原生 agent 类型） | Plugin Agent |
| 进度提醒 | 纯靠 SKILL.md 指令 | Hook: SubagentStop 提醒 | Hook |
| Checklist | checklists/*.md（Claude Read） | checklists/*.md（MCP render 注入） | MCP + Skill 资产 |

## 9. 实施计划

| 阶段 | 工作 | 依赖 | 测试要求 |
|------|------|------|----------|
| **A: Plugin 骨架** | 创建目录结构、plugin.json、marketplace.json | 无 | 验证 Claude Code 能识别并加载 Plugin |
| **B: MCP Server 核心** | init + state_get/update + checkpoint + render | A | **单元测试**：state-manager（init/update/get/原子写入/dirty 恢复/schema 校验）、template-renderer（变量替换/缺失变量警告/checklist 注入） |
| **C: MCP Git + Diff 工具** | git_rollback + diff_check | B | **集成测试**：使用 git repo fixture 验证 rollback 精确性、diff_check 异常文件检测 |
| **D: Agent 迁移** | 将 prompts/*.md 转换为 agents/*.md | A | 验证 Claude 能正确识别和调用每个 Agent |
| **E: Skill 精简** | 重写 SKILL.md 为 ~80 行，调用 MCP 工具 | B, D | 人工走读：确认所有 MCP 工具调用点和 Agent 调用点正确 |
| **F: Hook 配置** | hooks.json + post-agent.sh | A | 验证 SubagentStop 事件触发 hook 输出 |
| **G: Lessons Manager** | lessons_add/get + 注入逻辑 | B | **单元测试**：lessons 的增删查、按 phase/category 过滤 |
| **H: 端到端测试** | 安装 Plugin，实际跑一次 auto-dev | A-G | 见下方 **阶段 H 测试场景** |
| **I: 迁移现有资产** | 将 checklists/ 和 stacks/ 移到 Plugin 内 | A | 验证 render 能正确读取迁移后的资产文件 |

**并行可能**：A -> (B, D, F, I 并行) -> (C, E, G 并行) -> H

### 阶段 H 端到端测试场景

| # | 测试场景 | 验证点 |
|---|---------|--------|
| H1 | **正常全流程** | 从 init 到 COMPLETED，所有 Phase 正常通过，state.json 最终状态正确 |
| H2 | **--resume 恢复** | Phase 2 中断后重新启动，`auto_dev_init(onConflict='resume')` 正确恢复状态，从断点继续 |
| H3 | **Git dirty 场景** | 工作区有未提交变更时 init，用户选择 stash 后正常继续 |
| H4 | **BLOCKED 场景** | 某任务标记 BLOCKED，验证 BLOCKED.md 创建、git_rollback 执行、后续任务跳过逻辑 |
| H5 | **checkpoint 幂等** | 连续两次调用相同参数的 checkpoint，验证 progress-log 不重复追加 |
| H6 | **state.json 损坏恢复** | 手动损坏 state.json 后调用 state_get，验证返回明确错误而非 crash |
| H7 | **NEEDS_REVISION 循环** | 设计审查返回 NEEDS_REVISION，验证修订->重审循环正常工作（最多 3 次） |
| H8 | **diff_check 异常检测** | 实现阶段故意修改 plan 之外的文件，验证 diff_check 正确报告 unexpectedChanges |

## 10. 风险 & 缓解

| 风险 | 缓解 |
|------|------|
| MCP 工具调用有延迟 | 合并工具（如 init 一次性返回所有信息，不拆成多个 tool） |
| Claude 仍然可能"忘记"调用 MCP 工具 | Hook 提醒 + Skill 中用粗体/大写强调 |
| agents/ 中的 agent 定义可能不如直接 prompt 灵活 | 保留 `auto_dev_render()` 作为 fallback，需要时 Claude 仍可用 Agent 工具 + 自定义 prompt |
| MCP Server 调试困难 | 增加 `auto_dev_debug()` 工具输出当前完整状态 |
| Plugin 安装/卸载流程对用户有门槛 | README 中提供一键安装命令 |
| 现有 Skill v4 用户迁移 | 参见 Section 12 迁移指南 |
| state.json 写入中断导致损坏 | write-to-temp-then-rename 原子写入 + schema 校验 + dirty 标记 |
| checkpoint 重复调用导致 progress-log 膨胀 | 幂等检查：相同参数不重复追加 |

### 10.5 技术假设

以下假设基于当前对 Claude Code Plugin SDK 的理解。如果 SDK 行为变更，这些假设是首先需要检查的点。

| # | 假设 | 影响范围 | 验证方式 |
|---|------|---------|---------|
| T1 | Plugin SDK 支持 `agents/` 目录下的 `.md` 文件自动注册为可调用的 subagent | Agent 定义（Section 4） | 阶段 D 验证：创建 agent 文件后 Claude 能通过 Agent 工具调用 |
| T2 | Hook 的 `SubagentStop` 事件在每次 subagent 结束时可靠触发 | Hook 设计（Section 6） | 阶段 F 验证：subagent 结束后检查 stderr 是否有 hook 输出 |
| T3 | MCP Server 通过 stdio 通信，生命周期由 Claude Code 自动管理（随 session 启停） | MCP Server 实现（Section 3.3） | 阶段 A 验证：安装 Plugin 后启动 Claude Code，检查 MCP 进程是否自动启动 |
| T4 | `plugin.json` 中声明的 MCP 工具在 Claude 的工具列表中自动可见，无需额外注册 | 所有 MCP 工具 | 阶段 B 验证：注册工具后 Claude 能列出并调用 |
| T5 | Plugin 内的 `skills/` 目录下的 SKILL.md 会被 Claude 自动加载为 Skill 指令 | Skill 编排（Section 5） | 阶段 E 验证：安装 Plugin 后触发 `/auto-dev` 能加载 SKILL.md |
| T6 | `${CLAUDE_PLUGIN_ROOT}` 环境变量在 Hook 脚本中可用，指向 Plugin 安装目录 | Hook 脚本路径 | 阶段 F 验证：hook 脚本中 echo 该变量确认路径正确 |
| T7 | MCP Server 进程内存占用可控（预计 < 50MB），不会显著影响 Claude Code 使用体验 | 系统资源 | 阶段 H 验证：长时间运行后检查进程内存 |

## 11. 不做的事

| 不做 | 原因 |
|------|------|
| MCP 工具中实现 subagent 调度 | MCP 无法调度 Claude，只能被 Claude 调用 |
| 废弃所有 Skill 资产 | checklists 和 stacks 继续作为模板使用 |
| 用 Hook 替代 Skill 的流程控制 | Hook 是事件驱动的，不适合编排多阶段流程 |
| 将简单 git 命令封装为 MCP 工具 | git status/branch/commit/stash 是确定性命令，Claude 直接执行即可，过度封装增加复杂度 |

## 12. v4 → v5 迁移指南

### 12.1 迁移步骤

```
步骤 1：安装 Plugin
  $ cp -r auto-dev-plugin ~/.claude/plugins/auto-dev
  （或使用 Claude Code 的 Plugin 安装命令）

步骤 2：禁用 v4 Skill（避免冲突）
  将 ~/.claude/skills/auto-dev/SKILL.md 重命名为 SKILL.md.v4.bak
  （Plugin 内的 skills/auto-dev/SKILL.md 会自动接管）

步骤 3：验证安装
  启动 Claude Code，执行 /auto-dev
  确认 Claude 能调用 auto_dev_init 等 MCP 工具

步骤 4：清理（可选）
  确认 v5 工作正常后，可删除 v4 的以下文件：
  - ~/.claude/skills/auto-dev/SKILL.md.v4.bak
  - ~/.claude/skills/auto-dev/prompts/*.md（已被 agents/ 替代）
```

### 12.2 v4/v5 共存策略

| 场景 | 处理方式 |
|------|---------|
| v4 SKILL.md 和 v5 Plugin 同时存在 | Claude 会看到两份 Skill 指令，可能产生混淆。**必须禁用 v4 SKILL.md**（重命名即可）。 |
| v4 的 prompts/*.md 和 v5 的 agents/*.md 同时存在 | 不冲突。v4 的 prompts/ 是普通文件需要 Claude Read，v5 的 agents/ 是 Plugin 注册的 subagent。保留 v4 prompts/ 不会影响 v5。 |
| v4 的 checklists/ 和 stacks/ | 完全兼容。v5 Plugin 内包含同样的文件，MCP render 工具从 Plugin 目录读取。原位置的文件保留不冲突。 |
| 需要回退到 v4 | 卸载 Plugin（删除 `~/.claude/plugins/auto-dev/`），将 SKILL.md.v4.bak 恢复为 SKILL.md。 |

### 12.3 已有产出兼容性

| 产出文件 | v4 格式 | v5 格式 | 兼容性 |
|---------|---------|---------|--------|
| `progress-log.md` | `<!-- CHECKPOINT ... -->` 标记 + 自然语言 | 相同格式的 CHECKPOINT 标记 + 自然语言 | **完全兼容**。v5 的 checkpoint 工具生成的标记格式与 v4 相同。 |
| `docs/auto-dev/{topic}/` 目录 | 包含设计文档、计划、progress-log 等 | 相同内容 + 新增 `state.json` | **向前兼容**。v5 在已有目录中新增 state.json，不修改已有文件。 |
| `state.json` | 不存在 | v5 新增 | v4 产出目录中没有 state.json。v5 的 `auto_dev_init(onConflict='resume')` 检测到缺少 state.json 时，会扫描 progress-log.md 中的 CHECKPOINT 标记重建状态。 |

### 12.4 迁移注意事项

1. **不要同时运行 v4 和 v5**：同一 topic 目录下，v4 的纯 Skill 流程和 v5 的 MCP 工具流程不应混用，会导致 state.json 与 progress-log 不一致。
2. **已完成的 topic 无需迁移**：v4 产出的已完成项目保持原样，无需任何操作。
3. **进行中的 topic**：如果 v4 有一个进行中的 auto-dev session，安装 v5 后用 `auto_dev_init(topic, onConflict='resume')` 可以从 progress-log 中恢复状态继续。
