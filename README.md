# auto-dev Plugin

> Claude Code 插件 — 自治开发循环，从设计到验收的全自动闭环。

## 简介

auto-dev 是一个 Claude Code Plugin，将「自治开发循环」从纯 Skill 指令升级为 **MCP 工具 + Agent 定义 + Skill 编排 + Hook 自动化** 的组合架构。Claude 是主控方，Plugin 提供确定性工具保障流程可靠执行。

### 核心理念

```
默认全自动，零确认 — auto-dev 的第一性原理
```

### 六阶段流程

```
Phase 1: DESIGN    架构师产出设计文档（含验收标准 AC-N）
Phase 2: PLAN      Tech Lead 产出实施计划
Phase 3: EXECUTE   开发者逐任务实现
Phase 4: VERIFY    编译 + 测试 + 整体代码审查
Phase 5: E2E TEST  端到端测试设计与实现
Phase 6: ACCEPTANCE 对照验收标准逐条验证
```

## 安装

```bash
# 1. 克隆到 Claude Code 插件目录
cp -r auto-dev-plugin ~/.claude/plugins/auto-dev

# 2. 安装依赖并编译 MCP Server
cd ~/.claude/plugins/auto-dev/mcp
npm install
npm run build

# 3. 验证
# 启动 Claude Code，输入 /auto-dev 确认可用
```

## 使用

```bash
# 从零开始（全自动）
/auto-dev "实现用户登录功能"

# 已有设计文档
/auto-dev @design.md

# 已有计划，跳过设计
/auto-dev @plan.md --skip-design

# 小改动，跳过设计和计划
/auto-dev --quick "修复分页 bug"

# 只产出设计和计划，不实现
/auto-dev --dry-run "重构支付模块"

# 断点恢复
/auto-dev --resume

# 交互模式（Phase 1 后等确认、git dirty 询问用户）
/auto-dev --interactive "新增导出功能"

# 指定从某个阶段开始
/auto-dev --phase 4
```

## 架构

```
┌─────────────────────────────────────────────────┐
│                 Claude (主控)                     │
│   读 Skill 指令 -> 调用 MCP 工具 / Agent         │
└──────┬──────────┬──────────┬──────────┬─────────┘
       │          │          │          │
  ┌────▼───┐ ┌───▼──┐ ┌────▼───┐ ┌────▼────┐
  │ MCP    │ │Agent │ │ Skill  │ │  Hook   │
  │ Server │ │ 定义 │ │  指令  │ │ 自动化  │
  │        │ │      │ │        │ │         │
  │ 10个   │ │ 5个  │ │ ~90行  │ │ 事件    │
  │ 确定性 │ │ 专用  │ │ 流程   │ │ 驱动    │
  │ 工具   │ │ 子代理│ │ 编排   │ │ 提醒    │
  └────────┘ └──────┘ └────────┘ └─────────┘
```

### 四种组件

| 组件 | 职责 | 数量 |
|------|------|------|
| **MCP Server** | 状态管理、模板渲染、精确回滚、元学习等确定性操作 | 10 个工具 |
| **Agents** | 架构师、审查专家、开发者、测试架构师、验收专家 | 5 个 |
| **Skill** | 流程编排（Phase 顺序、循环、重试逻辑） | ~90 行 |
| **Hooks** | SubagentStop 事件后自动提醒更新 checkpoint | 1 个 |

### MCP 工具清单

| 工具 | 说明 |
|------|------|
| `auto_dev_init` | 初始化会话：创建目录、检测技术栈、生成 state.json |
| `auto_dev_state_get` | 读取当前状态（支持 --resume 恢复） |
| `auto_dev_state_update` | 原子更新状态字段 |
| `auto_dev_checkpoint` | 写入结构化 CHECKPOINT（幂等 + 原子写入） |
| `auto_dev_render` | 模板渲染：变量替换 + checklist 注入 |
| `auto_dev_preflight` | 前置条件检查（Phase 1-6 各有不同检查项） |
| `auto_dev_diff_check` | 对比计划文件 vs 实际变更，报告异常 |
| `auto_dev_git_rollback` | 精确回滚指定任务的文件变更 |
| `auto_dev_lessons_add` | 记录经验教训（元学习） |
| `auto_dev_lessons_get` | 获取历史教训注入到 prompt |

### Agent 定义

| Agent | 角色 | 使用阶段 |
|-------|------|---------|
| `auto-dev-architect` | 资深架构师，产出设计文档 + 验收标准 | Phase 1 |
| `auto-dev-reviewer` | 审查专家（设计/计划/代码/测试） | Phase 1-5 |
| `auto-dev-developer` | 高级开发者，逐任务实现 | Phase 3, 6 |
| `auto-dev-test-architect` | 测试架构师，设计 E2E 用例 | Phase 5 |
| `auto-dev-acceptance-validator` | 验收专家，逐条验证 AC | Phase 6 |

## 目录结构

```
auto-dev-plugin/
├── .claude-plugin/
│   ├── plugin.json              # Plugin manifest
│   └── marketplace.json         # 本地开发元数据
├── agents/                      # Agent 定义
│   ├── auto-dev-architect.md
│   ├── auto-dev-reviewer.md
│   ├── auto-dev-developer.md
│   ├── auto-dev-test-architect.md
│   └── auto-dev-acceptance-validator.md
├── commands/
│   └── auto-dev.md              # /auto-dev 命令入口
├── hooks/
│   ├── hooks.json               # Hook 事件配置
│   └── post-agent.sh            # SubagentStop 提醒脚本
├── mcp/                         # MCP Server
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts             # 入口 + 10 个工具注册
│       ├── state-manager.ts     # 状态管理（原子写入）
│       ├── template-renderer.ts # 模板渲染
│       ├── git-manager.ts       # Git 操作（rollback + diffCheck）
│       ├── lessons-manager.ts   # 元学习
│       └── types.ts             # 类型定义 + Zod schema
├── skills/
│   └── auto-dev/
│       ├── SKILL.md             # 流程编排指令（~90 行）
│       ├── checklists/          # 审查清单
│       │   ├── design-review.md
│       │   ├── plan-review.md
│       │   ├── code-review-common.md
│       │   ├── code-review-java8.md
│       │   └── code-review-typescript.md
│       └── stacks/              # 技术栈配置
│           ├── java-maven.md
│           ├── java-gradle.md
│           ├── node-npm.md
│           └── python.md
└── README.md
```

## 运行时产出

每次 auto-dev 执行会在项目中生成：

```
docs/auto-dev/<topic>/
├── progress-log.md        # 全局进度日志（含 CHECKPOINT 标记）
├── design.md              # 设计文档（含验收标准）
├── design-review.md       # 设计审查报告
├── plan.md                # 实施计划
├── plan-review.md         # 计划审查报告
├── code-review.md         # 整体代码审查报告
├── e2e-test-cases.md      # E2E 测试用例
├── e2e-test-results.md    # E2E 测试结果
├── acceptance-report.md   # 验收报告
└── BLOCKED.md             # 阻塞记录（仅阻塞时生成）
```

## 支持的技术栈

| 技术栈 | 检测文件 | 构建命令 | 测试命令 |
|--------|---------|---------|---------|
| Java (Maven) | pom.xml | mvn compile -q | mvn test -q |
| Java (Gradle) | build.gradle | gradle build -q | gradle test -q |
| Node.js (npm) | package.json | npm run build | npm test |
| Python | pyproject.toml / requirements.txt | - | pytest |

## 从 v4 Skill 迁移

如果你之前使用的是纯 Skill 版本（v4）：

```bash
# 1. 安装 Plugin（见上方安装步骤）

# 2. 禁用 v4 Skill（避免冲突）
mv ~/.claude/skills/auto-dev/SKILL.md ~/.claude/skills/auto-dev/SKILL.md.v4.bak

# 3. 验证 Plugin 工作正常
# 启动 Claude Code，执行 /auto-dev

# 4. 清理（可选，确认 v5 正常后）
# v4 的 prompts/*.md 不再需要（被 agents/ 替代）
# v4 的 checklists/ 和 stacks/ 与 Plugin 内的兼容，保留无害
```

**已有产出兼容性**：v4 产出的 `docs/auto-dev/{topic}/` 目录与 v5 兼容。v5 会在同目录下新增 `state.json`。

## 开发

```bash
# 编译 MCP Server
cd mcp && npm run build

# 类型检查（不产出文件）
npx tsc --noEmit -p mcp/tsconfig.json

# 监听模式开发
cd mcp && npm run dev
```

## 技术栈

- TypeScript (ESNext + NodeNext)
- MCP SDK: @modelcontextprotocol/sdk
- Zod v4 (运行时 schema 校验)
- Node.js fs/promises (原子文件操作)

## 许可

MIT
