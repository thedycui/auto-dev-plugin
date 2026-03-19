# 实施计划: auto-dev Plugin

> 基于设计文档 v2 (design.md) Section 9，细化为线性可执行任务列表。
> 拓扑排序：A → (B, D, F, I 并行，线性展开为 B→D→F→I) → (C, E, G 并行，线性展开为 C→E→G) → H

## 前置说明

### Zod v4 注意事项
项目使用 zod v4.3.6，与设计文档示例代码中使用的 v3 API 基本兼容，但需注意：
- v4 中 `z.object()` / `z.string()` / `z.enum()` / `z.array()` 等核心 API 保持不变
- v4 引入了 `z.interface()` 作为 `z.object()` 的增强替代，但 `z.object()` 仍可用
- MCP SDK `server.tool()` 的 schema 参数接受 Zod schema 对象，v4 兼容

### 目录约定
- Plugin 根目录：`/Users/admin/.claude/plugins/auto-dev-plugin/`（下文简称 `{root}`）
- MCP Server 代码目录：`{root}/mcp/src/`
- MCP Server 有独立的 `package.json` 和 `tsconfig.json`（在 `{root}/mcp/` 下）
- 现有 Skill 资产源：`/Users/admin/.claude/skills/auto-dev/`

---

## 任务列表

### Task 1: Plugin 骨架 — plugin.json 与 marketplace.json
- **描述**: 创建 `.claude-plugin/plugin.json`（Plugin manifest，声明 name、version、MCP server 启动命令、agents 路径、hooks 路径等）和 `.claude-plugin/marketplace.json`（本地开发用元数据）。这是所有后续组件的基础——Claude Code 通过 plugin.json 发现并加载 Plugin 的各组件。
- **文件**:
  - 创建 `{root}/.claude-plugin/plugin.json`
  - 创建 `{root}/.claude-plugin/marketplace.json`
- **依赖**: 无
- **验证**:
  1. plugin.json 包含合法 JSON，声明了 name、version、mcp server 启动配置
  2. 启动 Claude Code，确认 Plugin 被识别加载（`/plugins` 或等效命令可见）
  3. 技术假设 T3、T4 在此阶段初步验证
- **复杂度**: S

---

### Task 2: MCP Server 项目初始化 — 独立 package.json 与 tsconfig.json
- **描述**: 在 `{root}/mcp/` 下创建独立的 `package.json`（声明 name、version、type=module、main=dist/index.js、build script、dependencies 引用根目录的 node_modules）和 `tsconfig.json`（rootDir=src、outDir=dist、启用 node types、继承或独立配置 strict mode）。确保 `npx tsc` 可在 mcp/ 下编译。
- **文件**:
  - 创建 `{root}/mcp/package.json`
  - 创建 `{root}/mcp/tsconfig.json`
  - 修改 `{root}/.gitignore`（添加 `mcp/dist/`）
- **依赖**: Task 1
- **验证**:
  1. `cd mcp && npx tsc --noEmit` 不报错（需要至少一个空的 ts 文件或 skipLibCheck）
  2. `mcp/package.json` 中 type=module，main 指向 dist/index.js
  3. `mcp/tsconfig.json` 中 rootDir=src, outDir=dist, types 包含 "node"
- **复杂度**: S

---

### Task 3: MCP Server 类型定义 — types.ts
- **描述**: 创建 `mcp/src/types.ts`，定义所有核心 TypeScript 接口：`InitInput`、`InitOutput`、`RenderInput`、`RenderOutput`、`CheckpointInput`、`DiffCheckInput`、`DiffCheckOutput`、`StateJson` schema（含 Zod schema 用于 runtime validation）、`StackInfo`、`GitInfo` 等。这是 MCP Server 各模块的数据契约。
- **文件**:
  - 创建 `{root}/mcp/src/types.ts`
- **依赖**: Task 2
- **验证**:
  1. `cd mcp && npx tsc --noEmit` 编译通过
  2. StateJson 的 Zod schema 能正确 parse 一个合法的 state.json 对象
  3. 所有接口与设计文档 Section 3.2 一致
- **复杂度**: M

---

### Task 4: StateManager 实现 — state-manager.ts
- **描述**: 实现 `StateManager` 类，负责：
  1. `outputDirExists()` — 检测工作目录是否已存在
  2. `tryReadState()` — 尝试读取已有 state.json（不抛错）
  3. `loadAndValidate()` — 读取 + Zod schema 校验 + dirty 检查
  4. `backupExistingDir()` — 备份已有目录为 `{dir}.bak.{timestamp}`
  5. `detectStack()` — 扫描项目根目录的 pom.xml/package.json/build.gradle 等，读取对应 stacks/*.md 解析变量
  6. `init()` — 创建 outputDir、初始化 state.json（原子写入）、创建 progress-log.md 头部
  7. `atomicUpdate()` — write-to-temp-then-rename 原子更新 state.json
  8. `getFullState()` — 返回完整状态对象
- **文件**:
  - 创建 `{root}/mcp/src/state-manager.ts`
- **依赖**: Task 3
- **验证**:
  1. 单元测试覆盖：init 创建目录和文件、atomicUpdate 原子性（中断后 .tmp 文件存在）、loadAndValidate 对损坏 JSON 返回错误而非 crash、幂等 init
  2. detectStack 能正确识别 Java Maven / Node NPM / Python 项目
  3. `cd mcp && npx tsc --noEmit` 编译通过
- **复杂度**: L

---

### Task 5: TemplateRenderer 实现 — template-renderer.ts
- **描述**: 实现 `TemplateRenderer` 类，负责：
  1. `render(promptFile, variables, extraContext?)` — 读取 prompts/{promptFile}.md 模板文件
  2. 解析 `<!-- requires: ... -->` 依赖声明
  3. 读取并注入对应的 checklist 文件内容
  4. 替换所有 `{variable}` 占位符
  5. 检查未替换的变量，加入 warnings 数组
  6. 追加 extraContext（如有）
  7. 返回 `{ renderedPrompt, warnings }`
- **文件**:
  - 创建 `{root}/mcp/src/template-renderer.ts`
- **依赖**: Task 3
- **验证**:
  1. 单元测试覆盖：变量替换正确、缺失变量产生 warning、checklist 注入正确、extraContext 追加正确
  2. 使用迁移后的 checklists/*.md 和 stacks/*.md 做真实模板渲染测试
  3. `cd mcp && npx tsc --noEmit` 编译通过
- **复杂度**: M

---

### Task 6: MCP Server 入口（核心工具）— index.ts 第一部分
- **描述**: 创建 `mcp/src/index.ts`，注册以下 6 个核心 MCP 工具：
  - `auto_dev_init` — 初始化 session
  - `auto_dev_state_get` — 读取状态
  - `auto_dev_state_update` — 更新状态
  - `auto_dev_checkpoint` — 写入 checkpoint（含幂等检查）
  - `auto_dev_render` — 渲染模板
  - `auto_dev_preflight` — 前置条件检查

  实现 `main()` 函数启动 StdioServerTransport。checkpoint 工具需包含幂等逻辑（检查 progress-log 最后一条 CHECKPOINT）和原子写入。
- **文件**:
  - 创建 `{root}/mcp/src/index.ts`
- **依赖**: Task 4, Task 5
- **验证**:
  1. `cd mcp && npx tsc` 编译成功，产出 dist/index.js
  2. `node mcp/dist/index.js` 启动后通过 stdio 通信正常（不立即 crash）
  3. 技术假设 T4 验证：安装 Plugin 后 Claude 能列出这些工具
- **复杂度**: L

---

### Task 7: Agent 定义迁移 — agents/*.md
- **描述**: 创建 4 个 Agent 定义文件（替代原 prompts/*.md）：
  - `auto-dev-architect.md` — 架构师 subagent
  - `auto-dev-reviewer.md` — 审查专家 subagent
  - `auto-dev-developer.md` — 开发者 subagent
  - `auto-dev-test-architect.md` — 测试架构师 subagent

  每个文件包含 YAML frontmatter（description、capabilities）和 Markdown 正文（角色设定、约束、输出格式）。内容按设计文档 Section 4 编写。
- **文件**:
  - 创建 `{root}/agents/auto-dev-architect.md`
  - 创建 `{root}/agents/auto-dev-reviewer.md`
  - 创建 `{root}/agents/auto-dev-developer.md`
  - 创建 `{root}/agents/auto-dev-test-architect.md`
- **依赖**: Task 1
- **验证**:
  1. 每个文件的 YAML frontmatter 合法（description 和 capabilities 字段存在）
  2. 技术假设 T1 验证：Claude 能通过 Agent 工具识别并调用这些 subagent
  3. 内容与设计文档 Section 4 一致
- **复杂度**: M

---

### Task 8: Hook 配置 — hooks.json + post-agent.sh
- **描述**: 创建 Hook 配置和脚本：
  1. `hooks/hooks.json` — 声明 SubagentStop 事件触发 post-agent.sh
  2. `hooks/post-agent.sh` — 向 stderr 输出提醒 Claude 调用 checkpoint 的信息
  3. 给 post-agent.sh 添加可执行权限
- **文件**:
  - 创建 `{root}/hooks/hooks.json`
  - 创建 `{root}/hooks/post-agent.sh`
- **依赖**: Task 1
- **验证**:
  1. hooks.json 是合法 JSON，结构符合 Plugin SDK 规范
  2. `bash hooks/post-agent.sh` 能执行，stderr 有输出
  3. 技术假设 T2、T6 验证：SubagentStop 事件触发 hook，`${CLAUDE_PLUGIN_ROOT}` 路径正确
- **复杂度**: S

---

### Task 9: 迁移现有 Skill 资产 — checklists/ + stacks/
- **描述**: 将现有 Skill 资产从 `/Users/admin/.claude/skills/auto-dev/` 复制到 Plugin 内的 `skills/auto-dev/` 目录：
  - `checklists/design-review.md`
  - `checklists/plan-review.md`
  - `checklists/code-review-common.md`
  - `checklists/code-review-java8.md`
  - `checklists/code-review-typescript.md`
  - `stacks/java-maven.md`
  - `stacks/java-gradle.md`
  - `stacks/node-npm.md`
  - `stacks/python.md`

  复制后验证文件内容完整，确保 TemplateRenderer 能正确读取。
- **文件**:
  - 复制到 `{root}/skills/auto-dev/checklists/*.md`（5 个文件）
  - 复制到 `{root}/skills/auto-dev/stacks/*.md`（4 个文件）
- **依赖**: Task 1
- **验证**:
  1. `diff` 对比源文件和目标文件，内容完全一致
  2. TemplateRenderer（Task 5 完成后）能读取迁移后的 checklist 文件
- **复杂度**: S

---

### Task 10: GitManager 实现 — git-manager.ts
- **描述**: 实现 `GitManager` 类，仅封装 Claude 做不好的 Git 操作：
  1. `getStatus()` — 返回 currentBranch、isDirty、diffStat（供 init 使用）
  2. `diffCheck(expectedFiles, baseCommit)` — 对比 plan 期望文件 vs `git diff --name-only {baseCommit}..HEAD` 的实际变更，返回 expectedButMissing、unexpectedChanges、isClean
  3. `rollback(baseCommit, files?)` — 使用 `git checkout {baseCommit} -- {files}` 精确回滚指定文件，如未指定 files 则通过 `git diff --name-only` 获取全部变更文件

  所有 git 命令通过 `child_process.execFile` 执行（避免 shell injection）。
- **文件**:
  - 创建 `{root}/mcp/src/git-manager.ts`
- **依赖**: Task 3
- **验证**:
  1. 集成测试：在 git repo fixture 中验证 diffCheck 正确识别缺失/多余文件
  2. 集成测试：rollback 后文件恢复到 baseCommit 状态
  3. `cd mcp && npx tsc --noEmit` 编译通过
- **复杂度**: M

---

### Task 11: LessonsManager 实现 — lessons-manager.ts
- **描述**: 实现 `LessonsManager` 类，负责元学习功能：
  1. `add(phase, category, lesson, context?)` — 记录一条经验教训到 `lessons-learned.json`（原子写入）
  2. `get(phase, category?)` — 按 phase 和可选 category 过滤，返回历史教训列表

  存储格式：JSON 数组，每条记录包含 phase、category、lesson、context、timestamp。
- **文件**:
  - 创建 `{root}/mcp/src/lessons-manager.ts`
- **依赖**: Task 3
- **验证**:
  1. 单元测试：add 后 get 能取回、按 phase 过滤正确、按 category 过滤正确
  2. 空文件/不存在文件时 get 返回空数组而非报错
  3. `cd mcp && npx tsc --noEmit` 编译通过
- **复杂度**: M

---

### Task 12: MCP Server 入口（扩展工具）— index.ts 补充 Git + Lessons 工具
- **描述**: 在 `mcp/src/index.ts` 中补充注册剩余 4 个 MCP 工具：
  - `auto_dev_diff_check` — 调用 GitManager.diffCheck
  - `auto_dev_git_rollback` — 调用 GitManager.rollback
  - `auto_dev_lessons_add` — 调用 LessonsManager.add
  - `auto_dev_lessons_get` — 调用 LessonsManager.get

  至此，设计文档中的 10 个 MCP 工具全部注册完毕。
- **文件**:
  - 修改 `{root}/mcp/src/index.ts`
- **依赖**: Task 6, Task 10, Task 11
- **验证**:
  1. `cd mcp && npx tsc` 编译成功
  2. 启动 MCP Server，通过 stdio 调用所有 10 个工具的 list_tools 确认注册
  3. 全量编译无 TypeScript 错误
- **复杂度**: M

---

### Task 13: Skill 精简重写 — SKILL.md
- **描述**: 创建精简版 `skills/auto-dev/SKILL.md`（目标 ~80 行），按设计文档 Section 5 编写：
  - YAML frontmatter（name: auto-dev, description）
  - 初始化流程（调用 auto_dev_init）
  - Phase 1-5 流程编排（每个 Phase: preflight → render → agent → checkpoint → 判断）
  - Phase 3 特别处理（git commit → diff_check → checkpoint → 可能 rollback）
  - 完成后汇总

  Skill 只包含流程编排指令，不包含 prompt 模板内容（由 render 工具注入）和确定性逻辑（由 MCP 工具保证）。
- **文件**:
  - 创建 `{root}/skills/auto-dev/SKILL.md`
- **依赖**: Task 6, Task 7
- **验证**:
  1. 文件行数 ≤ 120 行（含 frontmatter）
  2. 人工走读：所有 MCP 工具调用点和 Agent 调用点正确，无遗漏
  3. 技术假设 T5 验证：安装 Plugin 后 `/auto-dev` 能加载此 SKILL.md
- **复杂度**: M

---

### Task 14: Slash 命令入口 — commands/auto-dev.md
- **描述**: 创建 `/auto-dev` slash 命令定义文件。当用户输入 `/auto-dev` 时，Claude 加载 SKILL.md 并开始执行流程。文件内容应包含命令描述和触发 auto-dev skill 的指令。
- **文件**:
  - 创建 `{root}/commands/auto-dev.md`
- **依赖**: Task 13
- **验证**:
  1. 在 Claude Code 中输入 `/auto-dev` 能触发 auto-dev skill
  2. 命令描述在 `/help` 或自动补全中可见
- **复杂度**: S

---

### Task 15: MCP Server 编译与 Plugin 集成验证
- **描述**: 完整编译 MCP Server，验证 Plugin 整体结构：
  1. `cd mcp && npm install && npm run build`（编译 TypeScript → dist/）
  2. 检查 plugin.json 中的 MCP server 启动命令指向正确的 dist/index.js
  3. 启动 Claude Code，验证 Plugin 加载、MCP 工具可见、Agent 可调用
  4. 修复编译或集成中发现的问题
- **文件**:
  - 可能修改 `{root}/.claude-plugin/plugin.json`（修正路径）
  - 可能修改 `{root}/mcp/package.json`（修正 build script）
- **依赖**: Task 12, Task 13, Task 14
- **验证**:
  1. `cd mcp && npm run build` 无错误
  2. Claude Code 加载 Plugin 后能列出全部 10 个 auto_dev_* 工具
  3. Claude Code 能识别 4 个 agents
  4. `/auto-dev` 命令可用
- **复杂度**: M

---

### Task 16: 端到端测试 — H1~H8 场景
- **描述**: 按设计文档 Section 9 的阶段 H 测试场景，逐一验证：
  - **H1 正常全流程**: 从 init 到 COMPLETED
  - **H2 --resume 恢复**: Phase 2 中断后 resume
  - **H3 Git dirty 场景**: 工作区有未提交变更时 init
  - **H4 BLOCKED 场景**: 某任务 BLOCKED → BLOCKED.md + rollback
  - **H5 checkpoint 幂等**: 连续相同参数调用 checkpoint
  - **H6 state.json 损坏恢复**: 手动损坏后 state_get 的行为
  - **H7 NEEDS_REVISION 循环**: 修订→重审循环
  - **H8 diff_check 异常检测**: 故意修改 plan 外的文件

  记录每个场景的通过/失败结果和发现的问题。
- **文件**:
  - 可能修改多个 MCP Server 源文件（修复发现的 bug）
  - 创建测试记录（可选，按需决定存放位置）
- **依赖**: Task 15
- **验证**:
  1. H1~H8 全部通过
  2. 技术假设 T7 验证：长时间运行后 MCP Server 内存 < 50MB
  3. 所有发现的 bug 已修复
- **复杂度**: L

---

## 执行顺序总览

```
Task 1  (Plugin 骨架)           — 无依赖
  ├→ Task 2  (MCP 项目初始化)    — 依赖 T1
  │    └→ Task 3  (类型定义)      — 依赖 T2
  │         ├→ Task 4  (StateManager)     — 依赖 T3
  │         ├→ Task 5  (TemplateRenderer) — 依赖 T3
  │         ├→ Task 10 (GitManager)       — 依赖 T3
  │         └→ Task 11 (LessonsManager)   — 依赖 T3
  │              └→ Task 6  (index.ts 核心工具)  — 依赖 T4, T5
  │                   └→ Task 12 (index.ts 扩展工具) — 依赖 T6, T10, T11
  ├→ Task 7  (Agent 定义)        — 依赖 T1
  ├→ Task 8  (Hook 配置)         — 依赖 T1
  └→ Task 9  (资产迁移)          — 依赖 T1

Task 13 (SKILL.md)              — 依赖 T6, T7
Task 14 (命令入口)               — 依赖 T13
Task 15 (编译集成验证)           — 依赖 T12, T13, T14
Task 16 (端到端测试)             — 依赖 T15
```

### 线性执行顺序（auto-dev 串行）

| 顺序 | 任务 | 复杂度 |
|------|------|--------|
| 1 | Task 1: Plugin 骨架 | S |
| 2 | Task 2: MCP 项目初始化 | S |
| 3 | Task 3: 类型定义 | M |
| 4 | Task 9: 资产迁移 | S |
| 5 | Task 7: Agent 定义 | M |
| 6 | Task 8: Hook 配置 | S |
| 7 | Task 4: StateManager | L |
| 8 | Task 5: TemplateRenderer | M |
| 9 | Task 10: GitManager | M |
| 10 | Task 11: LessonsManager | M |
| 11 | Task 6: MCP Server 入口（核心工具） | L |
| 12 | Task 12: MCP Server 入口（扩展工具） | M |
| 13 | Task 13: Skill 精简重写 | M |
| 14 | Task 14: Slash 命令入口 | S |
| 15 | Task 15: 编译集成验证 | M |
| 16 | Task 16: 端到端测试 | L |

**总复杂度估算**: 4S + 7M + 3L ≈ 4×0.5h + 7×1.5h + 3×3h = 21.5h（单人工作量参考）
