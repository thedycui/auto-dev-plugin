# 设计文档：design-review 智能角色调度增强

## 1. 背景与目标

### 为什么做
当前 `/design-review` skill 对所有设计文档一视同仁 — 始终跑完 5 个审查角度（目标对齐/可行性/完整性/跨组件/代码对齐），每个角度都需要读取代码、grep 引用、分析影响。对于 3 个文件的 bugfix 设计和跨 5 个服务的架构重构，消耗的 token 和时间差距巨大，但当前流程没有区分。

### 做什么
在 `/design-review` 流程最前面增加**复杂度评估 + 角色调度**步骤，根据设计文档的实际内容自动决定激活哪些审查角色、启几个并行 Agent，做到"小设计轻量审、大设计深度审"。

### 不做什么（Non-Goals）
- 不新建独立 Skill，只改现有的 `/design-review`
- 不改变报告模板格式（保持现有 P0/P1/P2 结构）
- 不改 auto-dev 框架代码 — auto-dev Phase 1b 调用 `/design-review` 的方式不变

## 2. 现状分析

**当前 `/design-review` SKILL.md**（257 行，位于 `~/.claude/skills/design-review/`）：
- Core Flow：8 步线性流程，依次检查 5 个角度
- 已有 `## Parallel Review for Large Designs` 小节，但只是简单的 2 Agent 分工（code alignment + cross-component），没有动态调度
- 每次审查都跑完全部 5 个角度，不论设计规模

**auto-dev Phase 1b 如何调用**：
- auto-dev 的 tribunal 机制会启动 reviewer subagent
- reviewer subagent 本身不直接调用 `/design-review` skill，而是按 tribunal 检查清单执行
- 但用户手动调用 `/design-review` 时，走的就是这个 skill

**关键约束**：
- SKILL.md 是纯文本 prompt，不是代码 — 角色调度逻辑必须写成指令，由 Claude 自行判断执行
- Agent 派发是通过 `Agent()` 工具调用，SKILL.md 里描述流程，Claude 按流程执行

## 3. 方案设计

| 方案 | 描述 | 优点 | 缺点 |
|------|------|------|------|
| A: 角色池 + 信号匹配 | 定义角色池和激活信号关键词，读设计文档后按信号自动匹配角色 | 精准，每个角色有明确激活条件 | 信号关键词需要持续维护 |
| B: 三档模式（Light/Standard/Deep） | 根据设计文档行数分三档，每档固定角色组合 | 简单可预测 | 粒度粗，可能误判 |
| C: 由 Claude 自行判断（无硬编码规则） | 只给原则（"根据复杂度决定"），让 Claude 自行评估 | 最灵活 | 行为不可预测，难以复现 |

**选择方案 A**，理由：
- 方案 B 粒度太粗 — 300 行的单模块重构和 300 行的跨服务设计，需要不同的角色组合
- 方案 C 不可靠 — Claude 可能对"复杂度"判断不一致，且无法调优
- 方案 A 虽然需要维护信号词表，但规则明确、行为可预测、可渐进优化

## 4. 详细设计

### 4.1 角色池定义

| 角色 ID | 角色名 | 审查重点 | 激活信号关键词 |
|---------|--------|---------|---------------|
| `architect` | 架构师 | 方案选型、整体结构、Non-Goals | **始终激活** |
| `security` | 安全审查 | 认证、权限、数据安全、注入风险 | auth, token, permission, API Key, 密码, 加密, XSS, SQL, 白名单, CORS |
| `performance` | 性能审查 | 并发、缓存、批处理、N+1、内存 | cache, batch, streaming, N+1, 并发, 连接池, 大数据量, 分页, 异步 |
| `integration` | 集成审查 | 跨服务调用、接口兼容、数据格式 | RPC, API, MCP, 消息队列, Dubbo, HTTP, 接口变更, DTO, 序列化, 跨模块 |
| `frontend` | 前端审查 | 组件交互、路由、状态管理、样式 | component, route, state, render, Vue, React, 页面, UI, 表单, 弹窗 |

### 4.2 复杂度评估步骤（新增 Step 0）

在现有 Core Flow 的 "1. Read design document" 之前，新增 **Step 0: Complexity Assessment**：

```
Step 0: 复杂度评估
  1. 读取设计文档全文
  2. 统计以下信号：
     - 文档行数
     - 涉及的模块/服务数量（从标题、段落中识别）
     - 命中的角色激活信号关键词（按角色池匹配）
     - 是否涉及数据 schema 变更
     - 是否涉及跨仓库改动
  3. 输出评估结果：
     - 激活角色列表（1-5 个）
     - 是否启动并行 Agent（角色 ≥ 3 时启动并行）
  4. 打印评估结果让用户可见
```

### 4.3 角色调度逻辑

**始终激活 `architect` 角色** — 架构师负责目标对齐和整体评估，这是所有审查的基础。

**其他角色按信号匹配激活**：
- 扫描设计文档全文，检查是否包含各角色的激活信号关键词
- 匹配到任意一个关键词即激活该角色
- 如果没有任何额外信号，只保留 architect（轻量审查）

**并行策略**：
| 激活角色数 | 执行方式 |
|-----------|---------|
| 1（仅 architect） | 单 Agent 顺序执行，不派发 subagent |
| 2-3 | 主 Agent 做 architect，派 1-2 个 subagent 做其他角色 |
| 4-5 | 派发 N-1 个 subagent（architect + 其他角色各一个），主线程汇总 |

### 4.4 各角色的审查检查清单

每个角色有专属的检查项，替代当前 5 个固定角度：

**architect（始终激活）**：
- 目标对齐：设计是否解决了声称的问题
- 方案选型：备选方案对比是否合理
- 范围控制：是否过度设计或设计不足

**security（按需激活）**：
- 认证/授权机制是否完备
- 数据是否需要脱敏/加密
- 输入校验是否充分（SQL 注入、XSS、路径穿越）
- 敏感操作的审计日志

**performance（按需激活）**：
- 是否存在 N+1 查询
- 批量操作是否分页/流式处理
- 缓存策略是否合理
- 并发场景下的线程安全

**integration（按需激活）**：
- 接口签名变更是否兼容（breaking change 检查）
- 跨服务调用链路是否完整
- DTO 字段命名跨仓库是否对齐
- 部署顺序依赖是否明确

**frontend（按需激活）**：
- 组件状态管理是否一致
- 路由变更是否影响现有页面
- 不同环境（容器内/独立运行）适配
- 表单校验规则是否完备

### 4.5 报告模板调整

报告格式保持不变（P0/P1/P2），仅在"逐角度分析"一节按激活角色输出：

```markdown
## 审查配置
- 激活角色：architect, integration, security（3/5）
- 评估依据：跨服务调用 + 权限变更
- 执行方式：并行（2 subagent）

## 逐角色分析

### 架构师视角
- {findings}

### 集成审查视角
- {findings}

### 安全审查视角
- {findings}
```

### 4.6 分发方式

**迁移到插件内 skill**，随 auto-dev-plugin 分发：

| 步骤 | 操作 | 说明 |
|------|------|------|
| 1 | 新建 `auto-dev-plugin/skills/design-review/SKILL.md` | 增强版 skill 定义 |
| 2 | 删除 `~/.claude/skills/design-review/SKILL.md` | 避免重复注册（两个路径都会被扫描） |
| 3 | 其他人安装 auto-dev-plugin 后自动获得 `/design-review` | 无需额外配置 |

### 4.7 改动文件清单

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| `auto-dev-plugin/skills/design-review/SKILL.md` | **新建** | 基于 `~/.claude/skills/design-review/SKILL.md` 增强版，新增 Step 0、角色池、调度逻辑、角色检查清单 |
| `~/.claude/skills/design-review/SKILL.md` | **删除** | 迁移后移除个人副本，避免重复注册 |

预估：新建约 300 行（含现有 257 行 + 增强约 80 行 - 精简约 30 行重复内容）。

## 5. 影响分析

| 影响点 | 分析 |
|--------|------|
| auto-dev Phase 1b | 无影响 — auto-dev 的 tribunal reviewer 不直接调用此 skill |
| 现有 `/design-review` 用户 | 完全兼容 — 简单设计只激活 architect，行为等同当前流程 |
| 报告格式 | 向后兼容 — 新增"审查配置"节，其余结构不变 |
| 性能 | 简单设计更快（只跑 1 个角色），复杂设计不变（并行执行） |
| 插件分发 | 其他人安装 auto-dev-plugin 后自动获得，无需手动配置 |
| 与个人 skill 冲突 | 迁移后删除个人副本，不会出现两个 `/design-review` |

## 6. 风险与缓解

| 风险 | 缓解措施 |
|------|---------|
| 信号关键词误判（该激活的没激活） | architect 始终兜底，覆盖最基本的审查；信号词表可渐进补充 |
| Claude 不遵循 SKILL.md 中的调度指令 | Step 0 输出评估结果到对话中，用户可见并可纠正 |
| 角色检查项与现有 5 个角度重叠 | 新角色检查项是对现有角度的重新分组，不重复 |

## 7. 验收标准

| AC | 描述 | 验证方式 |
|----|------|---------|
| AC-1 | 简单设计（单模块、< 3 文件）只激活 architect 角色，不派发 subagent，审查时间 < 当前流程的 50% | 用一个简单 bugfix 设计文档调用 `/design-review`，观察角色列表和执行方式 |
| AC-2 | 跨服务设计（含 RPC + 权限变更）自动激活 architect + integration + security，并行执行 | 用 metrics-web 权限设计文档调用，确认 3 个角色激活且有并行 Agent |
| AC-3 | 报告格式与现有报告兼容 — P0/P1/P2 问题列表格式不变，新增"审查配置"节 | 对比新旧报告格式，确认结构兼容 |
