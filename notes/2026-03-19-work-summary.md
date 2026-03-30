# 2026-03-19 工作总结与工作流分析

## 1. 工作产出总览

- **涉及项目数**: 5 个（auto-dev-plugin、gen-pdf、tfbservice、tfb-manage-service、paper-homework-service、agent-communication-mcp）
- **会话数**: 11 个
- **Git 提交数**: 49 个（auto-dev-plugin: 35, tfbservice: 8, tfb-manage-service: 6）
- **改动行数**: auto-dev-plugin +8623/-186（排除 node_modules/dist），tfbservice +92/-20，tfb-manage-service +43/-3

### 按项目分类的工作量表

| 项目 | 会话数 | 提交数 | 改动 | 主要工作 |
|------|--------|--------|------|----------|
| auto-dev-plugin | 0（远程操作） | 35 | +8623/-186 | 插件骨架搭建、MCP Server、模板渲染、agents 定义 |
| gen-pdf (tifenbao) | 9 | 0 | N/A | 双轨测试 ZIP 对比、skill 文章、buildTemplateDto 补全 |
| tfbservice | 0 | 8 | +92/-20 | 双轨测试支持 |
| tfb-manage-service | 0 | 6 | +43/-3 | 双轨测试前端支持 |
| paper-homework-service | 1 | 0 | N/A | SparkEnglishResourceService 优化 + 远程日志排查 |
| agent-communication-mcp | 1 | 0 | N/A | agent 列表查看和通信探索 |

## 2. 主要工作内容详述

### 工作线一：auto-dev-plugin 从零搭建（本日最大产出）

从初始化到完整插件架构，一天内完成了 35 个 commit，建立了完整的 Claude Code 插件系统。

**阶段一：项目初始化（12:04 - 12:55）**
- 创建插件骨架（plugin.json + marketplace.json）
- 配置 .gitignore，清理 node_modules
- MCP Server 项目初始化（package.json + tsconfig）

**阶段二：核心模块实现（12:54 - 13:21）**
- Task 1: Plugin skeleton
- Task 2: MCP Server 项目配置
- Task 3: TypeScript 类型定义（types.ts）
- Task 4: StateManager（原子写入、schema 校验、栈检测）
- Task 5: TemplateRenderer（变量替换、checklist 注入）
- Task 6+12: MCP Server 入口（10 个工具注册）
- Task 7: 4 个 Agent 定义
- Task 8: Hook 配置（hooks.json + post-agent.sh）
- Task 9: Skill 资产迁移（checklists + stacks）
- Task 10: GitManager（rollback、diffCheck）
- Task 11: LessonsManager（meta-learning）
- Task 13: Skill 重写（约 80 行）
- Task 14: Slash command 入口

**阶段三：验证修复（13:21 - 13:49）**
- Phase 4 验证修复：P0（git ref 校验、dirty-flag 恢复）+ P1（atomic append、fileURLToPath、tryReadState 校验等）
- 完成进度日志

**阶段四：功能同步（13:31 - 13:49）**
- auto-dev(v4-sync) 系列 6 个任务：
  - types.ts 增加 interactive/dryRun 字段
  - init 支持 interactive/dryRun，preflight 支持 Phase 6
  - acceptance-validator agent
  - SKILL.md v5.1（Phase 6 + auto mode + dry-run）
  - command 入口（--dry-run, --interactive）
  - design.md 要求验收标准（architect agent + design-review checklist）

**阶段五：发布准备（14:28 - 23:45）**
- 添加 README.md（中文）
- 修复 plugin.json 格式
- 包含 mcp/dist 和 mcp/node_modules 实现零构建安装
- 添加详细 workflow 说明
- MCP 响应瘦身（减少上下文消耗）
- v5.1.1 发布
- 添加 prompt 模板文件（9 个缺失的模板）
- 修复模板渲染顺序（变量替换需在 requires 解析之前）

**教训**：
1. 插件的 9 个 prompt 模板文件缺失会导致整个工作流在每个 phase 都失败——初始化时必须检查所有依赖
2. 模板渲染顺序很关键：变量替换必须在 requires 解析之前执行，否则 `<!-- requires: {lang_checklist} -->` 这种动态指令会被正则跳过

### 工作线二：双轨测试 ZIP 产物对比设计与实现（跨项目核心业务）

这是本日在业务项目上的主要工作，横跨 gen-pdf、tfbservice、tfb-manage-service 三个项目。

**设计阶段**：
- 发现问题：部分 taskHandler 产物是 ZIP 包（含多个 PDF），现有双轨测试框架只能对比单个 PDF
- 输出设计方案：`2026-03-18-dual-track-zip-compare-design.md`
- 经 design-review 发现关键缺陷：New 路径当前无法产出 ZIP（只渲染单个 PDF，不走 handler 的多学生遍历 + 打包流程）
- 修改方案为分阶段实施（Phase 1 只验证 Legacy），通过 v2 review

**实现阶段（使用 subagent 驱动开发）**：
- Phase 1 实现 + 测试
- Phase 2 实现
- 使用 design-review、plan-impl-review、review-fixer 等 skill 链确保代码质量

**buildTemplateDto 大规模补全**：
- 发现 23 个任务类型缺少 `buildTemplateDto` 实现（导致新流程渲染失败）
- 使用 agent-teams 并行补全所有 23 个任务类型
- 完成后使用 plan-impl-review skill 审查实现质量
- 使用 review-fixer skill 验证并修复审查发现的问题

**测试文档输出**：
- 为测试团队生成简明精确的测试方案和回归范围文档
- 补充任务类型对应的处理组件信息
- 补充查历史任务的 SQL 脚本

**跨组件修改汇总**：
- web-tifenbao-gen-pdf：双轨 ZIP 对比框架 + buildTemplateDto 补全
- tfbservice：双轨测试支持（8 个 commit, +92/-20）
- tfb-manage-service：双轨测试前端支持（6 个 commit, +43/-3）

**教训**：
1. 双轨测试涉及多个组件（gen-pdf、tfbservice、tfb-manage-service、web-tifenbao-campus-report），设计和计划时必须明确列出所有需要修改的组件
2. New 路径和 Legacy 路径的产物类型差异（单个 PDF vs ZIP 包）是容易遗漏的关键设计点
3. 23 个任务类型的 buildTemplateDto 补全使用 agent-teams 并行执行非常高效

### 工作线三：Claude Code Skill 分享文章撰写

继续 Skill 系统分享文章的创作：

1. **文章初稿**：基于积累的 skill 输出分享文章，介绍 skill 的产生背景、方式、用途
2. **多角色评价**：从研发总监、架构师、普通研发、测试、产品经理五个角度评价 Skill 系统指南文章
3. **内容补充**：根据反馈补充效果量化、Skill 构建方法、安全注意事项等
4. **官方资料集成**：将 "Skills have become one of the most used extension points in Claude" 文章内容翻译并整合
5. **Skill 与 Command 概念澄清**：区分 Skill（模型自动触发）和 Command（/ 命令手动触发），纠正了概念混淆
6. **事实错误修正**：检查并修正了文章中的多处事实错误和概念理解偏差

**教训**：
- Skill 和 Command 是两个不同概念，Skill 是 model-invoked（AI 自动判断是否使用），Command 是 user-invoked（用户主动调用）
- 分享文章中关于技术概念的描述必须对照官方文档验证

### 工作线四：自定义 Skill 创建

在本日工作中创造了多个实用 skill：

1. **plan-impl-review**：审查代码实现与实现计划的一致性
2. **plan-design-alignment**：检查 plan 和 design 是否统一
3. **review-fixer**：根据 review 结果文档检查设计/计划/代码，确认问题并修复或反驳
4. **auto-dev（全局 skill）**：将 auto-dev 流程封装为全局可用的 skill
5. **git-merge-workflow**：feature 分支合并到测试分支的工作流

### 工作线五：paper-homework-service 问题排查

1. **SparkEnglishResourceService 优化**：
   - 问题：重复 resource 插入时 `textbookResourceMapper.getByResource` 抛异常
   - 方案：修改为支持多个相同 resource 的查询

2. **教师报告错因分析排查**：
   - 连接测试服务器查看 job-tifenbao-campus-gen-pdf 日志
   - 查找教师报告中错因分析生成失败的完整日志
   - 定位问题原因

### 工作线六：项目 CLAUDE.md 生成

为三个项目生成了 CLAUDE.md 文档：
- tfbservice（142 个 Dubbo 服务、ShardingSphere 分表、MongoDB）
- tfb-manage-service
- web-tifenbao-campus-report

同时阅读并分析了《驯服 Agent：如何利用 SDD 在十年老系统上做生产级交付》文档。

## 3. 经验教训汇总

| 价值评级 | 类别 | 教训内容 | 可复用性 |
|----------|------|----------|----------|
| P0 | 架构设计 | 模板渲染顺序：变量替换必须在 requires 解析之前，否则动态指令会被正则跳过 | 高 |
| P0 | 工程实践 | 插件初始化时必须检查所有模板文件依赖是否完整，缺失 9 个模板会导致全链路失败 | 高 |
| P0 | 跨项目协作 | 双轨测试等跨模块功能涉及多个组件，设计时必须列出所有需要修改的组件清单 | 高 |
| P1 | 工作流 | design-review -> plan -> plan-impl-review -> review-fixer 的 skill 链确保代码质量 | 高 |
| P1 | 并行开发 | agent-teams 并行补全 23 个任务类型，效率远高于串行 | 高 |
| P1 | Skill 设计 | Skill（模型自动触发）vs Command（用户手动触发）是两个不同概念，分享时需明确区分 | 高 |
| P2 | 测试协作 | 给测试的文档要包含：任务类型、处理组件、SQL 脚本、具体操作步骤 | 中 |
| P2 | Git 工作流 | feature 分支开发 -> commit -> 合并到 common_test -> push 的标准流程 | 高 |
| P2 | 文档建设 | 为每个项目生成 CLAUDE.md，帮助 AI 快速理解项目上下文 | 高 |
| P3 | 发布管理 | 零构建安装需要将 dist 和 node_modules 都包含在 git 中 | 中 |

## 4. Skill 提取建议

本日已创建了多个实用 skill，无需额外提取。但以下模式值得关注：

1. **跨组件修改清单模板**：设计跨模块功能时，自动生成需要修改的组件清单
2. **双轨测试扩展检查表**：新增任务类型时，自动检查 buildTemplateDto 是否已实现
3. **CLAUDE.md 自动生成**：为新项目自动生成 CLAUDE.md 的标准流程

## 5. 工作流深度分析

### 做得好的地方

- **超高产出**：单日 35 个 auto-dev-plugin commit，从零到完整插件系统
- **skill 链成熟运用**：design-review -> plan -> subagent 实现 -> plan-impl-review -> review-fixer，形成了完整的质量保障闭环
- **并行效率**：23 个 buildTemplateDto 使用 agent-teams 并行完成，极大提升了效率
- **文档意识**：主动为项目生成 CLAUDE.md，为测试输出测试方案

### 反模式

- **auto-dev-plugin 的提交粒度不一致**：部分 commit 过大（如 plugin-architecture 系列每个 task 一个 commit 是好的，但某些 fix commit 包含了不相关的修改）
- **跨组件修改遗漏风险**：双轨测试最初设计时没有明确列出 web-tifenbao-campus-report 是否需要修改
- **gen-pdf 项目无 git 提交**：大量双轨测试相关的代码改动没有反映在 gen-pdf 的 git log 中（可能在子模块或其他分支中提交）

### 成熟度评估

- **插件开发工作流**: 4/5 — 从设计到实现到验证到发布，流程完整
- **业务开发工作流**: 5/5 — 设计 -> review -> 实现 -> 审查 -> 修复 -> 测试文档，全链路成熟
- **Skill 创建工作流**: 4/5 — 基于实际需求创建 skill，且形成了 design-review、plan-impl-review、review-fixer 的完整 skill 链
- **跨项目协作**: 3/5 — 有意识列出跨组件修改清单，但仍有遗漏

## 6. 真实踩坑时间线

1. **9 个 prompt 模板缺失**：auto-dev-plugin 初始化时缺少 9 个 prompt 模板文件（phase1-6 的模板），导致整个工作流在每个 phase 都失败。需要逐个创建。
2. **模板渲染顺序错误**：`<!-- requires: {lang_checklist} -->` 中的变量替换在 requires 解析之后执行，导致正则 `[\w-]+` 跳过含花括号的指令。修复：将变量替换移到 requires 解析之前。
3. **New 路径无法产出 ZIP**：双轨测试设计初版假设 New 路径也能产出 ZIP，但实际上 New 路径只渲染单个 PDF。修改为分阶段方案，Phase 1 只验证 Legacy。
4. **23 个任务类型缺少 buildTemplateDto**：新流程渲染失败的直接原因。使用 agent-teams 并行补全。
5. **Dubbo 注解误删**：simplify review 建议删掉 `com.zhixue.tfb.log` 的 Dubbo 注解，但 master 分支依赖这个注解。不能盲目接受 AI 的重构建议。
6. **aspectjweaver-1.8.9.jar 损坏**：本地编译环境问题（jar 文件损坏），不是代码问题但影响了编译验证。

## 7. 改进路线图

1. **短期**：为 auto-dev-plugin 增加模板完整性检查脚本，在启动前自动验证所有模板文件是否存在
2. **短期**：建立跨组件修改检查表模板，设计阶段就列出所有需要修改的组件
3. **中期**：将双轨测试扩展为自动化的回归测试框架，新增任务类型时自动检测 buildTemplateDto 缺失
4. **中期**：优化 review-fixer skill 的反驳能力，避免像 Dubbo 注解误删这类问题
5. **长期**：将 auto-dev-plugin 的 skill 链模式（design-review -> plan -> impl -> review -> fix）推广到更多项目
