# 设计文档：auto-dev 自进化完整方案

## 1. 背景与目标

### 背景

auto-dev-plugin 是一个 Claude Code 插件，实现从设计到验收的 7 阶段全自动开发闭环。当前系统在每次开发循环中通过 Phase 7（Retrospective）提取教训，但存在以下局限：

1. **Lessons 作用域受限**：当前"Global"层实际存储在 `{project}/docs/auto-dev/_global/lessons-global.json`，仅在同一项目内共享，不同项目之间的经验完全隔离。
2. **缺少自我诊断能力**：auto-dev 无法主动评估自身的不足，只能被动地从每次执行中提取教训。
3. **缺少外部调度**：进化依赖人工触发，没有定时自动化机制。
4. **经验无法跨机器共享**：单机文件系统存储，多开发环境之间无法同步。

### 目标

让 auto-dev 成为自己的第一个用户 -- 用自己开发自己，形成自我进化闭环。

具体目标：
- **G1**: 建立三层 Lessons 架构（Local -> Project -> Global），使高价值经验跨项目复用
- **G2**: 新增 Self-Assess Skill，让 auto-dev 能主动分析自身代码和历史数据，产出改进建议
- **G3**: 集成 Agent Hub 的 Cron + Ephemeral Proxy，实现定时自动触发 + 飞书审批
- **G4**: 串联完整进化闭环：Cron -> Self-Assess -> 审批 -> Auto-Dev 执行 -> Lessons 回写

### Non-Goals

- **不做 Hub Memory 云端同步**：Global Lessons 与 Hub Memory 的双向同步作为后续迭代，本期不实现。
- **不做 GitHub Issues 分析**：项目尚未开源，此功能延后。
- **不做多机器 Lessons 合并冲突处理**：本期 Global 层仅支持单机文件，不处理并发写入。
- **不重写现有 Lessons 评分机制**：现有的 `applyDecay`、`SCORE_DELTA`、displacement 逻辑已足够成熟，保持不变。

---

## 2. 现状分析

### 2.1 现有 Lessons 架构

```
lessons-manager.ts
├── Local: {outputDir}/lessons-learned.json     ← per-topic
├── "Global": {projectRoot}/docs/auto-dev/_global/lessons-global.json  ← per-project (误称 global)
│
├── add()         → 写 Local，reusable=true 时自动 addToGlobal()
├── get()         → 读 Local
├── feedback()    → 同时更新 Local 和 "Global" 的评分
├── getGlobalLessons() → 读 "Global"，按 decayed score 排序取 top-N
├── promoteReusableLessons() → 将 Local 中 reusable=true 的提升到 "Global"
└── addToGlobal() → 去重 + pool 满时 displacement
```

**关键常量**（lessons-constants.ts）:
- `MAX_GLOBAL_POOL = 50`, `MAX_GLOBAL_INJECT = 10`
- `DECAY_PERIOD_DAYS = 30`, `MIN_DISPLACEMENT_MARGIN = 2`
- 评分: critical=10, important=6, minor=3
- 反馈增量: helpful=+3, not_applicable=-1, incorrect=-5

### 2.2 现有 Retrospective 流程

Phase 7（`retrospective.ts`）从 progress-log、code-review、test-results 中提取教训，写入 Local lessons，然后通过 `promoteReusableLessons()` 将 reusable 条目推到 Project-Global。

### 2.3 现有 Hub 集成

`hub-client.ts` 已有 HubClient 类，但仅用于 tribunal 三级执行策略（Level 1: Hub mode）。功能包括：
- `isAvailable()` — 探活
- `ensureConnected()` — 注册
- `findTribunalWorker()` — 查找 tribunal worker agent
- `executePrompt()` — 发送 execute_prompt 命令并轮询

单例模式，通过 `TRIBUNAL_HUB_URL` / `TRIBUNAL_HUB_TOKEN` 环境变量配置。

### 2.4 Agent Communication Hub 能力

Hub（`agent-communication-mcp`）提供：
- **ScheduledTask**: interval / once / cron 三种调度模式
- **Ephemeral Proxy**: agent 离线时自动启动一次性 Claude 会话执行任务
- **Hub Memory**: category（project/preference/lesson/context/general）, importance(1-10), 自动过期
- **Workflow**: 多步编排，上下游 context 传递
- **飞书 Bot**: 卡片推送 + 审批交互

---

## 3. 方案设计

### 方案 A：最小增量（扩展现有 LessonsManager + 独立 Skill 脚本）

**思路**: 在现有 `LessonsManager` 上新增 Global 层方法，Self-Assess 作为独立 skill prompt + shell 脚本，Hub 集成复用现有 `HubClient`。

| 维度 | 评价 |
|------|------|
| 改动范围 | 小 — 仅修改 lessons-manager.ts + 新增 skill 文件 |
| 复杂度 | 低 — 不引入新的运行时依赖 |
| 可测试性 | 高 — 纯文件操作，现有测试模式可覆盖 |
| Hub 集成深度 | 浅 — Cron 仅通过 Hub API 注册，不需要修改 Hub 代码 |
| 扩展性 | 一般 — Self-Assess 逻辑散落在 prompt 和脚本中 |

**具体方案**:
1. **三层 Lessons**: `LessonsManager` 新增 `globalFilePath` 指向 `~/.auto-dev/lessons-global.json`，晋升逻辑内置在 `promoteToGlobal()`
2. **Self-Assess**: 新建 `skills/auto-dev/prompts/self-assess.md` 模板 + 简单的数据收集脚本
3. **Hub 集成**: 通过 Hub API 注册 cron 任务，prompt 内容包含 self-assess 指令

### 方案 B：结构化集成（新增 MCP 工具 + Workflow 编排）

**思路**: 新增 `auto_dev_self_assess` MCP 工具处理数据收集和分析，通过 Hub Workflow 编排完整的进化流水线。

| 维度 | 评价 |
|------|------|
| 改动范围 | 中 — 新增 MCP 工具 + Workflow 模板 |
| 复杂度 | 中高 — 需要理解 Hub Workflow engine |
| 可测试性 | 中 — MCP 工具可单测，但 Workflow 集成测试需要 Hub 运行 |
| Hub 集成深度 | 深 — 完整利用 Workflow 多步编排能力 |
| 扩展性 | 高 — Workflow 步骤可灵活增减 |

**具体方案**:
1. **三层 Lessons**: 同方案 A
2. **Self-Assess**: 新增 `auto_dev_self_assess` MCP 工具，返回结构化评估结果
3. **Hub 集成**: 定义 Workflow 模板（self-assess -> feishu-approve -> auto-dev-execute -> report），通过 cron 触发 workflow

### 方案对比

| 对比维度 | 方案 A（最小增量） | 方案 B（结构化集成） |
|---------|------------------|-------------------|
| 开发工作量 | ~3天 | ~5天 |
| 引入新概念 | 0 | Workflow模板 |
| 与现有架构一致性 | 高（延续 prompt+skill 模式） | 中（引入新的编排模式） |
| 飞书审批实现 | Hub cron prompt 直接包含飞书通知指令 | Workflow 步骤中内置飞书审批 |
| 故障恢复 | 简单（单步重试） | 复杂（需 Workflow 断点续传） |
| 可观测性 | 低（日志散落） | 高（Workflow 有 step-level 状态） |
| 团队学习成本 | 低 | 中 |

### 选择方案 A，理由：

1. **YAGNI**: Workflow 编排对当前需求来说过度设计。进化闭环本质上是 3 步串行操作（assess -> approve -> execute），不需要通用编排引擎。
2. **渐进式**: 方案 A 的 Self-Assess skill 和 Global Lessons 可以立即发挥价值，即使 Hub 集成延迟也不影响核心功能。
3. **与现有模式一致**: auto-dev 全部通过 prompt template + agent 分发，Self-Assess 保持相同模式降低认知负担。
4. **向上兼容**: 如果后续确实需要 Workflow 编排，方案 A 的各组件（MCP 方法、skill prompt）可以直接被 Workflow 步骤包装，不需要重写。

---

## 4. 详细设计

### 4.1 三层 Lessons 架构

#### 层级定义

| 层级 | 存储路径 | 作用域 | 容量 |
|------|---------|--------|------|
| Local | `{outputDir}/lessons-learned.json` | 单 topic | 无上限 |
| Project | `{projectRoot}/docs/auto-dev/_global/lessons-global.json` | 同项目多 topic | MAX_GLOBAL_POOL=50 |
| Global | `~/.auto-dev/lessons-global.json` | 跨所有项目 | MAX_CROSS_PROJECT_POOL=100 |

#### 数据模型扩展

`LessonEntry` 新增字段：

```typescript
// types.ts — LessonEntrySchema 扩展
sourceProject: z.string().optional(),    // 来源项目标识（晋升到 Global 时记录）
promotedAt: z.string().optional(),       // 晋升到 Global 的时间
promotionPath: z.enum(["local_to_project", "project_to_global"]).optional(),
```

#### LessonsManager 改动

重命名现有方法以消除歧义，新增 Global 层方法：

```typescript
class LessonsManager {
  // 现有（保持不变）
  add(...)                          // 写 Local
  get(...)                          // 读 Local
  feedback(...)                     // 更新 Local + Project 评分

  // 重命名（内部实现不变，仅语义清晰化）
  getProjectLessons(limit?)         // 原 getGlobalLessons()
  addToProject(entry)               // 原 addToGlobal()
  readProjectEntries()              // 原 readGlobalEntries()
  promoteToProject(topic)           // 原 promoteReusableLessons()

  // 新增 — Global 层
  getCrossProjectLessons(limit?)    // 读 ~/.auto-dev/lessons-global.json
  promoteToGlobal(minScore?)        // Project -> Global 晋升
  injectGlobalLessons()             // 启动时从 Global 注入高分 lessons
}
```

#### 晋升逻辑

**Project -> Global 晋升条件**:
1. `reusable === true`
2. `applyDecay(entry) >= 6`（高于 important 初始分）
3. 不在 Global 中已存在（去重 by lesson text）

**晋升时机**:
- Phase 7 Retrospective 完成时自动调用 `promoteToGlobal()`
- Self-Assess 执行时主动扫描并晋升

**Global 层衰减和淘汰**: 复用现有 `applyDecay()` + displacement 逻辑，常量调整为：

```typescript
// lessons-constants.ts 新增
export const MAX_CROSS_PROJECT_POOL = 100;   // Global 容量
export const MAX_CROSS_PROJECT_INJECT = 15;  // 每次注入上限
export const GLOBAL_PROMOTE_MIN_SCORE = 6;   // 晋升最低分
```

#### 启动注入流程

```
auto_dev_init()
  ├── 现有: 检测 stack, 创建 state.json
  ├── 新增: LessonsManager.injectGlobalLessons()
  │         ├── 读 ~/.auto-dev/lessons-global.json
  │         ├── 按 decayed score 排序
  │         ├── 取 top MAX_CROSS_PROJECT_INJECT 条
  │         └── 写入 state.injectedGlobalLessonIds（用于后续 feedback 追踪）
  └── 现有: 返回 InitOutput
```

### 4.2 Self-Assess Skill

#### 数据收集范围

| 数据源 | 说明 | 收集方式 |
|--------|------|---------|
| 源码 | mcp/src/*.ts, agents/*.md, skills/auto-dev/**, prompts/** | 文件读取 |
| 三层 Lessons | Local + Project + Global | LessonsManager API |
| Retrospective 历史 | docs/auto-dev/*/retrospective.md | 文件遍历 |
| 测试结果 | npm test 输出 | Shell 执行 |
| 测试覆盖率 | 如果可用 | Shell 执行 |
| 构建状态 | npm run build 输出 | Shell 执行 |

#### Skill Prompt 设计

新增 `skills/auto-dev/prompts/self-assess.md`:

```markdown
# auto-dev Self-Assessment

## 输入
- project_root: {{project_root}}
- output_path: {{output_dir}}/improvement-candidates.md

## 任务
1. 读取 auto-dev 源码（mcp/src/, agents/, skills/auto-dev/）
2. 读取所有历史 retrospective（docs/auto-dev/*/retrospective.md）
3. 读取三层 lessons（local, project, global）
4. 执行 npm test，分析测试结果
5. 识别改进机会，产出 improvement-candidates.md

## 产出格式
improvement-candidates.md 按优先级排序：

| # | 改进项 | 类型 | 优先级 | 依据 | 预估工作量 |
|---|--------|------|--------|------|-----------|
| 1 | ... | bug/perf/feature/quality | P0/P1/P2 | 引用具体证据 | S/M/L |

每个改进项需要：
- 具体的问题描述（引用文件名和行号）
- 改进方案概要
- 预期收益
```

#### 执行方式

Self-Assess 作为标准 auto-dev agent 任务执行，通过 Ephemeral Proxy 启动一次性 Claude 会话：

```
Claude Session (ephemeral)
  ├── 读取 self-assess.md prompt
  ├── 使用 Read/Bash 工具收集数据
  ├── 分析产出 improvement-candidates.md
  └── 写入 {project}/docs/auto-dev/_self-assess/improvement-candidates.md
```

### 4.3 Hub 集成

#### Agent 注册

auto-dev-plugin 不需要作为持久在线的 Hub Agent 运行。利用 Hub 的 Ephemeral Proxy 机制：

1. 在 Hub 中注册一个 agent name: `auto-dev-evolver`
2. 配置 `proxyConfigPath` 指向 Claude Code 的配置文件
3. Cron 触发时，Hub Scheduler 自动 spawn ephemeral proxy

#### Cron 配置

通过 Hub API 注册定时任务：

```json
{
  "agentName": "auto-dev-evolver",
  "scheduleType": "cron",
  "cronExpression": "0 0 */8 * * *",
  "prompt": "执行 auto-dev self-assess。项目: D:/dycuui/auto-dev-plugin。完成后将结果推送到飞书。",
  "description": "auto-dev 自进化评估（每8小时）",
  "timeoutMs": 1800000
}
```

#### 飞书审批流程

```
Cron 触发
  → Ephemeral Proxy 启动
  → 执行 Self-Assess，产出 improvement-candidates.md
  → 通过 Hub 飞书 Bot 推送审批卡片
      卡片内容：改进项摘要（top-3）+ 审批/拒绝按钮
  → 等待审批结果
      ├── 审批通过 → 继续执行 auto-dev（topic=选中的改进项）
      └── 审批拒绝 → 记录拒绝原因，结束
```

**简化设计**：飞书审批不在 MCP 层实现，而是在 Ephemeral Proxy 的 prompt 中通过 Hub MCP 工具（`hub_send_message`）实现。这样不需要修改 auto-dev-plugin 的 MCP server 代码。

### 4.4 进化闭环数据流

```
┌─────────────────────────────────────────────────────────┐
│                    每 8 小时 Cron                         │
│                         │                                │
│                    ┌────▼────┐                           │
│                    │Self-Assess│ ← 读三层 Lessons         │
│                    │  Skill   │ ← 读 Retrospectives      │
│                    └────┬────┘ ← 读源码 + 跑测试          │
│                         │                                │
│              improvement-candidates.md                   │
│                         │                                │
│                    ┌────▼────┐                           │
│                    │ 飞书审批  │                          │
│                    └────┬────┘                           │
│                    审批通过                               │
│                         │                                │
│                    ┌────▼────┐                           │
│                    │ auto-dev │ ← topic=选中的改进项       │
│                    │  full    │ ← 使用自身代码库           │
│                    └────┬────┘                           │
│                         │                                │
│                    ┌────▼────┐                           │
│                    │Phase 7   │                          │
│                    │Retrospect│ → 写 Local Lessons        │
│                    └────┬────┘ → promoteToProject()      │
│                         │      → promoteToGlobal()       │
│                         │                                │
│               Lessons 更新完成                            │
│            下次 Self-Assess 读取新 Lessons                │
│                    飞轮加速                               │
└─────────────────────────────────────────────────────────┘
```

### 4.5 接口契约

#### 4.5.1 LessonsManager 新增方法

```typescript
// 返回 Global 层高分 lessons（跨项目）
async getCrossProjectLessons(limit?: number): Promise<LessonEntry[]>

// 将 Project 层高分 reusable lessons 晋升到 Global
async promoteToGlobal(minScore?: number): Promise<number>

// 启动时从 Global 注入（写入 state.injectedGlobalLessonIds）
async injectGlobalLessons(): Promise<LessonEntry[]>

// Global 层文件路径
private crossProjectFilePath(): string
// 返回: path.join(os.homedir(), '.auto-dev', 'lessons-global.json')
```

#### 4.5.2 MCP 工具扩展（可选）

如果后续需要让 agent 直接操作 Global lessons，新增 MCP 工具：

```typescript
// auto_dev_lessons_get — 扩展 scope 参数
{
  scope: "local" | "project" | "global",  // 新增 "global"
  phase?: number,
  category?: string,
}

// auto_dev_lessons_promote — 手动触发晋升
{
  scope: "project_to_global",
}
```

本期暂不新增 MCP 工具，通过 `LessonsManager` 内部调用即可。

#### 4.5.3 Self-Assess 输出格式

```typescript
interface ImprovementCandidate {
  id: string;                          // "IMP-001"
  title: string;                       // 改进项标题
  type: "bug" | "perf" | "feature" | "quality" | "process";
  priority: "P0" | "P1" | "P2";
  evidence: string;                    // 具体证据（文件名:行号 或 lesson ID）
  proposal: string;                    // 改进方案概要
  estimatedEffort: "S" | "M" | "L";   // 预估工作量
  autoDevTopic?: string;              // 可直接用作 auto-dev topic 的字符串
}
```

---

## 5. 影响分析

### 5.1 文件改动范围

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| `mcp/src/lessons-manager.ts` | 修改 | 新增 Global 层方法，重命名现有方法 |
| `mcp/src/lessons-constants.ts` | 修改 | 新增 Global 层常量 |
| `mcp/src/types.ts` | 修改 | LessonEntry 新增 sourceProject/promotedAt 字段 |
| `mcp/src/index.ts` | 修改 | init 流程中调用 injectGlobalLessons() |
| `mcp/src/retrospective.ts` | 修改 | Phase 7 末尾调用 promoteToGlobal() |
| `mcp/src/__tests__/lessons-manager.test.ts` | 修改 | 新增 Global 层测试用例 |
| `skills/auto-dev/prompts/self-assess.md` | 新增 | Self-Assess prompt 模板 |
| `agents/auto-dev-evolver.md` (可选) | 新增 | 进化专用 agent 定义 |

### 5.2 兼容性

- **向后兼容**: 所有现有方法保持可用，重命名通过导出别名（`getGlobalLessons = getProjectLessons`）确保不破坏现有调用方。
- **数据兼容**: `LessonEntry` 新字段均为 optional，现有 JSON 文件无需迁移。
- **Global 文件不存在时**: `getCrossProjectLessons()` 返回空数组（与现有 `readGlobalEntries()` 行为一致）。

### 5.3 迁移路径

1. **Phase 1**: 实现三层 Lessons + 单元测试（可独立发布）
2. **Phase 2**: 实现 Self-Assess Skill + prompt（可独立使用）
3. **Phase 3**: Hub Cron + 飞书集成（需要 Hub 环境）
4. **Phase 4**: 端到端联调 + 进化闭环验证

每个 Phase 可独立合并，不依赖后续 Phase。

### 5.4 回滚方案

- **三层 Lessons 回滚**: 删除 `~/.auto-dev/lessons-global.json` 文件，注释掉 `promoteToGlobal()` 调用。现有 Local + Project 行为完全不受影响。
- **Self-Assess 回滚**: 删除 `skills/auto-dev/prompts/self-assess.md`，不影响任何现有功能。
- **Hub Cron 回滚**: 通过 Hub API 删除定时任务（`DELETE /scheduled-tasks/{taskId}`），或直接暂停（`PATCH status=paused`）。

---

## 6. 风险与缓解

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|---------|
| Global 文件写入竞态（多个项目同时执行 promoteToGlobal） | 低 | 数据丢失 | 使用现有 writeAtomic（rename）模式，最后写入者获胜；Global 层数据可从各 Project 层重建 |
| Self-Assess 产出低质量改进建议 | 中 | 浪费计算资源 | 飞书人工审批环节把关；Self-Assess prompt 中要求引用具体证据 |
| Ephemeral Proxy 超时（self-assess 分析量大） | 中 | 进化中断 | 设置充足 timeoutMs（30min）；Self-Assess 数据收集阶段限制读取范围 |
| Global lessons 膨胀导致注入 prompt 过长 | 低 | token 浪费 | MAX_CROSS_PROJECT_INJECT=15 硬限制；注入时只包含 lesson 文本，不包含 metadata |
| 重命名现有方法导致外部调用方报错 | 低 | 编译失败 | 导出旧名称作为别名（`export { getProjectLessons as getGlobalLessons }`）；全项目 grep 确认无外部引用 |
| 进化循环产生的代码改动引入 bug | 中 | 功能回归 | 进化执行使用 full mode（包含 Phase 4 tribunal + Phase 5 E2E），自身测试套件作为安全网 |

---

## 7. 验收标准

| AC | 描述 | 验证方式 |
|----|------|---------|
| AC-1 | `LessonsManager.getCrossProjectLessons()` 从 `~/.auto-dev/lessons-global.json` 读取条目，按 decayed score 降序返回 top-N（默认 N=15），文件不存在时返回空数组 | 单元测试 |
| AC-2 | `LessonsManager.promoteToGlobal()` 将 Project 层中 `reusable=true` 且 `applyDecay(entry) >= 6` 的条目写入 Global 文件，去重（相同 lesson text 不重复添加），返回晋升数量 | 单元测试 |
| AC-3 | Global 层 pool 满（100 条活跃条目）时，新条目的 decayed score 超过最低分 + `MIN_DISPLACEMENT_MARGIN` 才能淘汰最低分条目，否则拒绝写入 | 单元测试 |
| AC-4 | `auto_dev_init()` 执行时自动调用 `injectGlobalLessons()`，将注入的 lesson IDs 写入 `state.injectedGlobalLessonIds`，用于后续 feedback 追踪 | 集成测试 |
| AC-5 | Phase 7 Retrospective 完成后自动调用 `promoteToGlobal()`，将高分 reusable lessons 从 Project 层晋升到 Global 层 | 集成测试 |
| AC-6 | `LessonEntry` 新增的 `sourceProject`、`promotedAt`、`promotionPath` 字段均为 optional，现有 JSON 文件无需迁移即可正常读取 | 单元测试（反序列化旧格式数据） |
| AC-7 | Self-Assess skill prompt 存在于 `skills/auto-dev/prompts/self-assess.md`，可被 `TemplateRenderer.render()` 正确渲染（变量替换无报错） | 单元测试 |
| AC-8 | Self-Assess 执行后在指定路径产出 `improvement-candidates.md`，包含至少 1 条改进建议，每条含 title/type/priority/evidence 字段 | 运行验证（手动触发 self-assess 后检查输出文件格式） |
| AC-9 | 现有方法重命名后，旧名称通过别名导出仍可正常调用（`getGlobalLessons` 调用 `getProjectLessons`），编译通过，现有测试全部 PASS | 单元测试 + `npm run build` + `npm test` |
| AC-10 | 传入空的 Global lessons 文件（`[]`）时 `getCrossProjectLessons()` 返回空数组，不抛异常；传入格式异常的文件时返回空数组，不抛异常 | 单元测试（正向 + 负向） |
| AC-11 | `promoteToGlobal()` 对 `applyDecay(entry) < 6` 的条目不执行晋升，返回晋升数量 = 0 | 单元测试（负向场景） |
