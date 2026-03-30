# 2026-03-05 工作总结与工作流分析

## 1. 工作产出总览

| 指标 | 数值 |
|------|------|
| 涉及项目数 | 18+ 个仓库（16 个业务项目 + 2 个工具项目） |
| Claude Code 会话数 | 15 个 |
| 会话总行数 | ~9,600 行 |
| 业务项目提交数 | ~243 commits（跨 16 个仓库） |
| 工具项目提交数 | 7 commits（local-scripts） |
| 估计改动行数 | ~5,000+ 行（含大量 CI 自动提交） |

### 按项目分类的工作量表

| 项目 | 提交数 | 主要工作 |
|------|--------|----------|
| api-school-book | 49 | 工作台26年套餐设计、写作区分学科、GB打印 |
| paperfresh | 41 | CI自动发布、新容器权限处理、150%分辨率适配、星火英语 |
| api-platform-report | 28 | 列表问题修复、AI个性化作业、步骤批三方教辅 |
| tfb-wowbook-web | 33 | 新容器仪表盘、路由守卫修复(v1-v5)、星火英语API迁移 |
| html-paperfresh-pc | 27 | 新容器权限跳转、150%分辨率适配、选题组卷 |
| web-tifenbao-campus-report | 13 | 高中语文原文与建议结构UI、批量导入题目 |
| job-tifenbao-campus-report | 10 | 评批一体润色、澳门作文分析 |
| api-tfb-operation-manage | 6 | 移除硬编码权限DTO、json解析异常处理 |
| api-tifenbao-pqbp | 6 | 工作流新增/修改 |
| tfb-manage-service | 6 | 打印价格功能 |
| local-scripts | 7 | Pipeline多会话架构、设计文档、实施计划 |
| 其他 6 个项目 | 各 1-4 | 合并分支、打印价格、修改api版本等 |

## 2. 主要工作内容详述

### 工作线 A：Claude Pipeline 多会话架构设计与实现（核心工作）

**做了什么：**
- 在 claude-pipeline 项目中，分析了多终端 Session 同时使用 pipeline 的问题，发现 StateManager 是单例模式，内存状态会互相覆盖
- 设计了多会话架构方案（单进程 + 多 Pipeline Registry），输出设计文档 `docs/plans/2026-03-05-multi-session-design.md`
- 使用 agent-teams 从 6 个角色（架构师、研发、产品经理、项目经理、测试工程师、运维）并行分析设计方案
- 输出完整设计文档和实施计划（18 个任务，7 个阶段），`docs/plans/2026-03-05-full-pipeline-design.md`（1201 行）和 `docs/plans/2026-03-05-full-pipeline-impl.md`（3026 行）
- 开始执行实施计划，完成了 Batch 1（Task 1-3）：monorepo 结构初始化、MCP Server 脚手架、StateManager 实现

**对话中学到的教训：**
- npm workspaces 在子包不存在时会静默失败，TypeScript devDependency 不会自动安装到根目录
- 需要先创建所有子包的最小 package.json，再运行 npm install

### 工作线 B：Claude Code 实战分享文档撰写

**做了什么：**
- 基于 `docs/sharing/2026-03-03-claude-code-practical-guide.md` 进行多角度分析
- 识别出 4 个值得深入的方向：入门心理落差、ROI 衡量、CLAUDE.md 进化路径、团队协作视角
- 针对目标受众（Cursor 重度用户转向 Claude Code）输出 4 篇深度分享文档

**对话中学到的教训：**
- 分享文档要基于真实数据（40天/130会话/6亿Token），不能空谈
- 对受众定位要有清醒认知：面向有开发经验的 Cursor 用户，不是初学者

### 工作线 C：业务项目开发与修复（多条并行）

**做了什么：**

1. **tfb-wowbook-web 路由守卫问题排查**：星火词汇错词页面在新容器环境下，切换学科后需要刷新两遍才能返回工作台。根因是新容器环境下路由守卫的权限检查逻辑与 sessionStorage 中学科信息的更新时序不一致

2. **星火英语 API 迁移**：发现 `release/release-0306` 分支没有合并 `feature-spark-english-0210`，导致星火词汇接口还在调用 paperfresh 而非 api-tifenbao-pqbp。执行了 cherry-pick 合并，排除了"移除学段硬编码"相关提交

3. **api-school-book 工作台26年套餐设计**：大量迭代开发（49 次提交），包括写作区分学科、套餐设计、claude 验证重构代码等

4. **paperfresh 新容器适配**：150% 分辨率适配（最小宽度改为 1100px）、权限跳转修复、试题组件 viewScene 判断

5. **检查近期代码变更**：使用 `/check-recent-code-changes` 命令审查了过去 20 天所有仓库的代码改动，确保上线前没有遗漏

**对话中学到的教训：**
- 路由守卫问题在新容器环境下的行为和独立运行时不同，需要分别测试
- 分支合并时需要仔细确认哪些提交需要排除，避免带入未完成的功能

## 3. 经验教训汇总

| 价值评级 | 类别 | 教训内容 | 可复用性 |
|----------|------|----------|----------|
| A | 工具链 | npm workspaces 在子包不完整时会静默失败，需先创建所有子包的最小 package.json | 高 |
| A | 工具链 | Claude Code agent-teams 多角色分析是验证设计方案的有效手段，6 个角色并行比单一视角全面得多 | 高 |
| B | 架构设计 | 单例模式在多会话场景下会出问题，需要用 Registry 模式管理多实例 | 中 |
| B | 前端开发 | 新容器环境（__POWERED_BY_ZX_CONTAINER__）下的路由守卫行为和独立运行时不同 | 中（项目特定） |
| B | Git 操作 | cherry-pick 合并时需明确排除未完成功能，通过 commit hash 逐一确认 | 高 |
| C | 文档 | 分享文档的受众定位必须精确，Cursor 用户和 Claude 新手是完全不同的受众 | 中 |
| C | CI/CD | paperfresh 等项目使用 CI 自动发布版本号（prepare release + prepare for next），了解此模式有助于排查 | 低 |

## 4. Skill 提取建议

1. **multi-perspective-analysis skill**：当前 agent-teams 分析设计方案的模式（6 角色并行）可以固化为 skill，输入设计文档自动输出多角度分析报告

2. **branch-cherry-pick-planner skill**：根据分支差异自动生成 cherry-pick 计划，排除指定功能的提交

## 5. 工作流深度分析

### 做得好的地方
- **设计先行**：Pipeline 项目先出设计文档（1201 行），再用 agent-teams 验证，最后才写代码
- **并行工作**：同一天处理了 Pipeline 架构设计、分享文档撰写、业务项目修复三条工作线
- **使用 CC 能力验证设计**：agent-teams 6 角色分析是高效的设计验证方法

### 反模式
- **tfb-wowbook-web 路由守卫 v1-v5 迭代**：同一天提交了 5 个版本修复路由守卫问题（v1, v2, v3, v4, v5），说明问题定位不精确，应该在本地充分验证后再提交
- **paperfresh 8 次 CI 发布**：一天内发布 8 个版本（17684-17691），频繁的小改动导致 CI 资源浪费

### 成熟度评估
- 设计阶段：4/5（有完整的设计流程和验证机制）
- 执行阶段：3/5（Pipeline 执行顺利，但业务项目仍有多次迭代修复）
- 文档沉淀：4/5（设计文档、分享文档、实施计划均有产出）

## 6. 真实踩坑时间线

| 时间 | 事件 | 教训 |
|------|------|------|
| 09:15-10:30 | job-tfb-gen-school-book 会话，检查模型配置 | |
| 10:30-11:00 | 使用 /check-recent-code-changes 审查全仓库变更 | 上线前检查是好习惯 |
| 11:00-14:00 | gen-pdf 项目中撰写分享文档 | |
| 14:00-15:00 | Pipeline 项目中分析多会话问题，设计多会话方案 | 快速从问题到方案 |
| 15:00-17:00 | 使用 agent-teams 6 角色验证设计方案 |  |
| 17:00-21:00 | tfb-wowbook-web 路由守卫反复修复（5个版本） | 应该本地先完整验证 |
| 20:00-23:30 | Pipeline 实施计划编写和执行 | 3026 行实施计划一次性完成 |
| 23:30 | local-scripts 提交 multi-session 架构 | 2597 行新增代码 |

## 7. 改进路线图

1. **短期（本周）**：为业务项目的频繁修复场景建立"本地验证清单"，避免反复提交修复
2. **中期（本月）**：将 agent-teams 多角色分析固化为标准 skill
3. **长期（下月）**：Pipeline 多会话架构完成，上线 Web Dashboard
