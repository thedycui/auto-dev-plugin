# auto-dev Plugin

> Claude Code 插件 — 自治开发循环，从设计到验收的全自动闭环。

## 简介

auto-dev 是一个 Claude Code Plugin，将「自治开发循环」从纯 Skill 指令升级为 **MCP 工具 + Agent 定义 + Skill 编排 + Hook 自动化** 的组合架构。Claude 是主控方，Plugin 提供确定性工具保障流程可靠执行。

### 核心理念

```
默认全自动，零确认 — auto-dev 的第一性原理
```

## 完整流程详解

### 流程全景图

```
用户输入 /auto-dev "功能描述"
         │
         ▼
┌─ Phase 1: DESIGN ─────────────────────────────────────┐
│  Architect Agent 探索代码库 → 产出 design.md           │
│  (含方案对比、数据模型、验收标准 AC-N)                   │
│  Reviewer Agent 审查 → P0/P1? → 修复 → 重审(max 3轮)  │
└────────────────────────────────────────────────────────┘
         │ PASS
         ▼
┌─ Phase 2: PLAN ───────────────────────────────────────┐
│  Tech Lead Agent 拆解任务 → 产出 plan.md               │
│  (含依赖关系、文件清单、复杂度评估)                      │
│  Reviewer Agent 审查 → P0/P1? → 修复 → 重审(max 3轮)  │
└────────────────────────────────────────────────────────┘
         │ PASS
         ▼
┌─ Phase 3: EXECUTE ────────────────────────────────────┐
│  对 plan.md 中每个任务：                                │
│    Developer Agent 实现 → git commit                   │
│    diff_check 校验变更范围                              │
│    Reviewer Agent 快速审查                              │
│    NEEDS_FIX → 修复(max 2次) → 仍失败 → rollback + 跳过│
└────────────────────────────────────────────────────────┘
         │ 全部任务完成
         ▼
┌─ Phase 4: VERIFY ─────────────────────────────────────┐
│  Step 1: 编译 {build_cmd} → 失败则 bug-analyzer 修复   │
│  Step 2: 测试 {test_cmd} → 失败则 bug-analyzer 修复    │
│  Step 3: Reviewer Agent 整体代码审查                    │
│          (聚焦跨任务问题：接口一致性、全局状态、安全)     │
└────────────────────────────────────────────────────────┘
         │ PASS
         ▼
┌─ Phase 5: E2E TEST ──────────────────────────────────┐
│  Test Architect Agent 设计测试用例                      │
│  Reviewer Agent 审查覆盖度                             │
│  Developer Agent 实现测试                              │
│  运行测试 → 失败则 bug-analyzer + fix + 重跑           │
└────────────────────────────────────────────────────────┘
         │ PASS
         ▼
┌─ Phase 6: ACCEPTANCE ────────────────────────────────┐
│  Acceptance Validator Agent 从 design.md 提取 AC-N     │
│  逐条验证：代码审查 + 测试验证 + 运行验证               │
│  产出 acceptance-report.md                             │
│  FAIL → Developer 修复 → 重新验收(max 2次)             │
└────────────────────────────────────────────────────────┘
         │ PASS
         ▼
┌─ Phase 7: RETROSPECTIVE ─────────────────────────┐
│  自动生成回顾数据：phase timings, tribunal stats,  │
│  TDD compliance, lesson extraction                │
│  写入 retrospective-data.md                        │
└────────────────────────────────────────────────────┘
         │
         ▼
    ✅ COMPLETED
    输出统计摘要 + 下一步选项
```

### 各阶段详细说明

#### Phase 1: DESIGN（设计）

**目标**：产出架构设计文档，含验收标准。

- **执行者**：`auto-dev-architect` Agent（资深架构师角色）
- **产出**：`design.md`
  - 方案对比（至少 2 个方案）
  - 数据模型设计
  - 接口定义
  - 迁移路径和回滚方案
  - **验收标准（AC-N）**：每个核心功能点的可验证条件
- **审查**：`auto-dev-reviewer` Agent 按 `design-review.md` checklist 审查
  - 检查功能完备性、方案选型、可靠性、安全性、验收标准质量
  - P0/P1 问题必须修复，最多 3 轮迭代
- **MCP 工具**：`auto_dev_preflight` → `auto_dev_render` → `auto_dev_checkpoint`

#### Phase 2: PLAN（计划）

**目标**：将设计拆解为可执行的任务列表。

- **执行者**：`auto-dev-architect` Agent（Tech Lead 角色）
- **产出**：`plan.md`
  - 任务列表（编号、描述、涉及文件、依赖关系）
  - 复杂度评估（S/M/L）
  - 执行顺序（拓扑排序）
  - 并行可能性标注
- **审查**：`auto-dev-reviewer` Agent 按 `plan-review.md` checklist 审查
  - 检查功能覆盖度、依赖关系、验证方式
- **`--dry-run` 模式**：到这里就停止，只产出设计 + 计划

#### Phase 3: EXECUTE（执行）

**目标**：逐任务实现代码。

- **执行者**：`auto-dev-developer` Agent（每个任务独立调用）
- **每个任务的循环**：
  1. 记录 `task_start_commit`
  2. Developer Agent 实现代码
  3. `git add + commit`
  4. `auto_dev_diff_check` 校验：实际变更 vs 计划预期文件
  5. Reviewer Agent 快速审查（haiku 模型，节省成本）
  6. NEEDS_FIX → 修复 → 再审查（最多 2 次）
  7. 仍失败 → `auto_dev_git_rollback` 精确回滚 → BLOCKED → 继续下一任务
- **变更规模策略**：
  - 1-3 个任务：轻量审查
  - 4-10 个任务：标准流程
  - 11+ 个任务：每 5 个任务插入编译检查

#### Phase 4: VERIFY（验证）

**目标**：确保代码可编译、测试通过、无跨任务问题。

- **Step 1 编译**：执行 `{build_cmd}`，失败则 `bug-analyzer` Agent 分析 + Developer 修复（max 3 次）
- **Step 2 测试**：执行 `{test_cmd}`，失败则同上
- **Step 3 整体审查**：`auto-dev-reviewer` Agent 做深度审查
  - 与 Phase 3 的任务级审查不同，聚焦 **跨任务问题**
  - 接口一致性、全局状态管理、端到端安全/性能

#### Phase 5: E2E TEST（端到端测试）

**目标**：设计并实现端到端测试用例。

- **Test Architect Agent** 设计测试用例（等价类划分、边界值分析）
- **Reviewer Agent** 审查覆盖度
- **Developer Agent** 实现测试代码
- 运行测试 → 失败则修复 → 重跑

#### Phase 6: ACCEPTANCE（验收）

**目标**：对照 design.md 中的验收标准（AC-N），逐条验证。

- **执行者**：`auto-dev-acceptance-validator` Agent
- **验证方式**（按优先级）：
  1. 代码验证：读源码确认功能已实现
  2. 测试验证：确认有对应测试且通过
  3. 运行验证：构造输入实际运行验证输出
- **产出**：`acceptance-report.md`

  | AC | 描述 | 验证方式 | 结果 | 证据 |
  |----|------|---------|------|------|
  | AC-1 | 传入空列表返回 400 | 单元测试 | PASS | XxxTest.testEmpty() |
  | AC-2 | 100 条数据 < 3s | 无性能测试 | SKIP | 需要集成环境 |

- **判定规则**：
  - PASS：所有 AC 为 PASS 或 SKIP（无 FAIL）
  - FAIL：有 FAIL → Developer 修复 → 重新验收（max 2 次）
  - BLOCKED：修复后仍 FAIL

### 异常处理

| 场景 | 行为 |
|------|------|
| 3 次迭代仍有 P0 | 生成 BLOCKED.md + 停止 |
| Subagent 超时 | 重试 1 次（timeout x 1.5）→ 仍超时则 BLOCKED |
| 任务 BLOCKED | git 精确回滚该任务 → 跳过 → 继续下一任务 |
| 编译/测试失败 | bug-analyzer 分析 + 修复 → 重试（max 3 次） |
| design.md 无验收标准 | 跳过 Phase 6，记录日志 |

### 状态持久化与断点恢复

每个关键节点写入 CHECKPOINT 标记：
```html
<!-- CHECKPOINT phase=3 task=5 status=PASS timestamp=2026-03-19T15:15:00 -->
```

`--resume` 时自动解析最后一个 CHECKPOINT，从断点继续。state.json 记录完整状态，支持原子写入和 dirty 恢复。

## 安装

### 一键安装（推荐）

在 Claude Code 中执行：

```
/plugin marketplace add https://code.iflytek.com/dycui/auto-dev-plugin.git
/plugin install auto-dev@auto-dev-local
/reload-plugins
```

无需手动 clone、无需 npm install、无需编译。

### 手动安装

如果一键安装不可用：

```bash
# 1. 克隆仓库
git clone https://code.iflytek.com/dycui/auto-dev-plugin.git ~/.claude/plugins/auto-dev-plugin

# 2. 在 Claude Code 中注册
/plugin marketplace add ~/.claude/plugins/auto-dev-plugin
/plugin install auto-dev@auto-dev-local
/reload-plugins
```

### 从源码构建（开发者）

```bash
git clone https://code.iflytek.com/dycui/auto-dev-plugin.git
cd auto-dev-plugin/mcp
npm install
npm run build
```

## 使用

```bash
# 从零开始（全自动，6 个阶段全跑）
/auto-dev "实现用户登录功能"

# 已有设计文档，从审查开始
/auto-dev @design.md

# 已有计划，跳过设计直接执行
/auto-dev @plan.md --skip-design

# 小改动，跳过设计和计划
/auto-dev --quick "修复分页 bug"

# 只产出设计和计划，不实现
/auto-dev --dry-run "重构支付模块"

# 断点恢复（从上次中断的地方继续）
/auto-dev --resume

# 交互模式（Phase 1 后等确认、git dirty 询问用户）
/auto-dev --interactive "新增导出功能"

# 指定从某个阶段开始
/auto-dev --phase 4
```

### 参数说明

| 参数 | 说明 |
|------|------|
| `"描述"` | 功能描述，从 Phase 1 开始 |
| `@file.md` | 已有设计/计划文档 |
| `--quick` | 快速模式，跳过设计和计划 |
| `--dry-run` | 只设计不实现（Phase 1-2） |
| `--resume` | 从上次断点恢复 |
| `--interactive` | 启用交互确认模式 |
| `--skip-design` | 跳过设计，直接从计划执行 |
| `--phase N` | 从指定阶段开始（1-7） |

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
| **MCP Server** | 状态管理、编排引擎、裁决系统、模板渲染、精确回滚、元学习等确定性操作 | 20+ 个工具 |
| **Agents** | 架构师、审查专家、开发者、测试架构师、验收专家 | 5 个 |
| **Skill** | 流程编排（Phase 顺序、循环、重试逻辑） | ~90 行 |
| **Hooks** | SubagentStop 事件后自动提醒更新 checkpoint | 1 个 |

### MCP 工具清单

| 工具 | 说明 |
|------|------|
| `auto_dev_init` | 初始化会话：创建目录、检测技术栈、生成 state.json |
| `auto_dev_next` | 获取下一步任务（编排引擎核心，驱动整个流程循环） |
| `auto_dev_state_get` | 读取当前状态（支持 --resume 恢复） |
| `auto_dev_state_update` | 原子更新状态字段 |
| `auto_dev_checkpoint` | 写入结构化 CHECKPOINT（幂等 + 原子写入） |
| `auto_dev_submit` | 提交 Phase 完成状态（触发 Phase 推进） |
| `auto_dev_complete` | 标记任务完成（触发 retrospective） |
| `auto_dev_render` | 模板渲染：变量替换 + checklist 注入 |
| `auto_dev_preflight` | 前置条件检查（Phase 1-7 各有不同检查项） |
| `auto_dev_diff_check` | 对比计划文件 vs 实际变更，报告异常 |
| `auto_dev_git_rollback` | 精确回滚指定任务的文件变更 |
| `auto_dev_tribunal_verdict` | 提交独立裁决结果（subagent 模式） |
| `auto_dev_task_red` | TDD RED 阶段：注册失败测试 |
| `auto_dev_task_green` | TDD GREEN 阶段：确认测试通过 |
| `auto_dev_lessons_add` | 记录经验教训（三层元学习：local/project/global） |
| `auto_dev_lessons_get` | 获取历史教训注入到 prompt |
| `auto_dev_lessons_feedback` | 教训反馈（提升/降级/退役） |

### Agent 定义

| Agent | 角色 | 使用阶段 |
|-------|------|---------|
| `auto-dev-architect` | 资深架构师，产出设计文档 + 验收标准 | Phase 1, 2 |
| `auto-dev-reviewer` | 审查专家（设计/计划/代码/测试） | Phase 1-5 |
| `auto-dev-developer` | 高级开发者，逐任务实现 | Phase 3, 6 |
| `auto-dev-test-architect` | 测试架构师，设计 E2E 用例 | Phase 5 |
| `auto-dev-acceptance-validator` | 验收专家，逐条验证 AC | Phase 6 |

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
├── acceptance-report.md   # 验收报告（Phase 6）
└── BLOCKED.md             # 阻塞记录（仅阻塞时生成）
```

## 支持的技术栈

| 技术栈 | 检测文件 | 构建命令 | 测试命令 |
|--------|---------|---------|---------|
| Java (Maven) | pom.xml | mvn compile -q | mvn test -q |
| Java (Gradle) | build.gradle | gradle build -q | gradle test -q |
| Node.js (npm) | package.json | npm run build | npm test |
| Python | pyproject.toml / requirements.txt | - | pytest |

## 目录结构

```
auto-dev-plugin/
├── .claude-plugin/
│   ├── plugin.json              # Plugin manifest
│   └── marketplace.json         # Marketplace 定义
├── agents/                      # Agent 定义（自动发现）
│   ├── auto-dev-architect.md
│   ├── auto-dev-reviewer.md
│   ├── auto-dev-developer.md
│   ├── auto-dev-test-architect.md
│   └── auto-dev-acceptance-validator.md
├── commands/                    # 命令定义（自动发现）
│   └── auto-dev.md
├── hooks/                       # Hook 配置（自动发现）
│   ├── hooks.json
│   └── post-agent.sh
├── mcp/                         # MCP Server
│   ├── package.json
│   ├── tsconfig.json
│   ├── dist/                    # 编译产物（已提交，免构建）
│   ├── node_modules/            # 依赖（已提交，免安装）
│   └── src/
│       ├── index.ts             # 入口 + 20+ 个工具注册
│       ├── orchestrator.ts      # 编排引擎（step 状态机、任务分发）
│       ├── tribunal.ts          # 独立裁决系统（Hub/Subagent/CLI 三级策略）
│       ├── state-manager.ts     # 状态管理（原子写入 + checkpoint 去重）
│       ├── template-renderer.ts # 模板渲染
│       ├── git-manager.ts       # Git 操作（rollback + diffCheck + 统一 diff）
│       ├── lessons-manager.ts   # 三层元学习（local/project/global + 衰减 + 去重）
│       ├── retrospective-data.ts # 回顾数据提取（checkpoint/tribunal/TDD 统计）
│       ├── phase-enforcer.ts    # Phase 门禁（TDD gate + 审查强制）
│       └── types.ts             # 类型定义 + Zod schema
├── skills/                      # Skill 定义（自动发现）
│   └── auto-dev/
│       ├── SKILL.md             # 流程编排指令（~90 行）
│       ├── checklists/          # 审查清单
│       └── stacks/              # 技术栈配置
└── README.md
```

## 更新

当插件发布新版本后，团队成员按以下步骤更新：

```bash
# 1. 刷新 marketplace（拉取最新版本信息）
/plugin marketplace update auto-dev-local

# 2. 打开 Plugin 管理界面
/plugin
# → 切到 "Installed" 标签
# → 选择 auto-dev
# → 点击 "Update now"

# 3. 生效
/reload-plugins
```

**注意**：Claude Code 通过 `plugin.json` 和 `marketplace.json` 中的 `version` 字段判断是否有新版本。如果版本号未变，会提示 "already at the latest version"。

### 发布新版本（维护者）

```bash
# 1. 修改代码
# 2. 同步更新两处版本号（必须一致）：
#    - .claude-plugin/plugin.json    → "version": "5.2.0"
#    - .claude-plugin/marketplace.json → "version": "5.2.0"
# 3. 如有 TypeScript 改动：cd mcp && npm run build
# 4. 提交并推送
git add -A && git commit -m "release: v5.2.0" && git push origin master
```

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
