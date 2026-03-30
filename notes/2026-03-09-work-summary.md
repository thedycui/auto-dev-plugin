# 2026-03-09 工作总结与工作流分析

## 1. 工作产出总览

| 指标 | 数值 |
|------|------|
| 涉及项目数 | 17 个仓库（15 个业务项目 + local-scripts + share-documents） |
| Claude Code 会话数 | 11 个 |
| 会话总行数 | ~1,200 行（主要会话） |
| 业务项目提交数 | ~149 commits（跨 15 个仓库） |
| 工具项目提交数 | 0 commits（local-scripts 本日无提交） |
| 估计改动行数 | ~3,000+ 行（不含 CI 自动提交） |

### 按项目分类的工作量表

| 项目 | 提交数 | 主要工作 |
|------|--------|----------|
| paperfresh | 46 | CI自动发布、澳门版题型排序、数据统计国际化、配对题连号、教材题规则 |
| api-school-book | 17 | 卡片平台优化、历史paperId处理、以数据库配置为准、写作区分学科 |
| api-tfb-operation-manage | 19 | AgentTools 订单二次确认流程、地址解析、回调服务、历史会话 |
| api-platform-report | 15 | 步骤批三方教辅、科目修复、列表下载、AI个性化 |
| html-paperfresh-pc | 13 | AI知识点标注、试题左侧栏题库切换、考试类型筛选器、校自编教辅 |
| paper-homework-service | 7 | 成品卷换题接口、AI知识点标注、分页查询修复 |
| tfb-wowbook-web | 9 | 错误单词详情接口修复、结构优化、下载按钮、学段学科修改 |
| job-tifenbao-gen-pdf | 5 | 英语星火作文评批一体报告渲染改造、Phase 5 AI模板生成设计文档 |
| tfb-manage-service | 4 | 打印价格、评批一体合并 |
| tfb-shoolbook-report-web | 4 | 代码还原、轻质课相关 |
| tfbservice | 4 | AI模板生成服务（Prompt模板引擎、VueSfcParser、LLM API Client） |
| api-tifenbao-pqbp | 1 | 工作流修改 |
| job-tfb-gen-school-book | 2 | 步骤批合并 |
| web-tifenbao-campus-report | 1 | 注释修改 |
| tfbservice-api | 2 | AI模板生成服务接口和模型 |

## 2. 主要工作内容详述

### 工作线 A：Agent-Teams 功能测试与 iTerm2 分屏调试

**做了什么：**
- 在 job-tifenbao-gen-pdf 项目中测试 agent-teams 的分屏功能
- 创建了多个 agent（maven-analyzer、readme-reader、git-checker、team-lead）来验证分屏显示
- 发现 iTerm2 中没有自动分屏显示 agent 状态，排查原因
- 检查 it2 命令行工具是否安装，参考 mkusaka/it2 安装
- 最终确认 teammateMode 模式和显示模式选择

**对话中学到的教训：**
- agent-teams 分屏依赖 iTerm2 的 it2 命令行工具，需要单独安装
- teammateMode 有多种模式（pane、tab、window），需要根据终端能力选择

### 工作线 B：Claude Print 模式分享文章撰写

**做了什么：**
- 基于已有的两个草稿版本（practice 版和 exploration 版），撰写了融合版分享文档
- 搜索了社区中其他人使用 `claude -p`（print 模式）的真实案例
- 收集到 8-10 个社区案例：Ceedar.ai 的 Issue->PR 自动化、CI 代码审查管道、Dependabot 影响分析、批量 TS 迁移等
- 验证了官方文档对 `-p` 模式的描述准确性，确保不捏造事实
- 参考 headless 文档（code.claude.com/docs/en/headless）补充了细节
- 参考素材保存到 `references/claude-print-mode-community-examples.md`
- 最终文章写入 `2026-03-09-claude-print-mode-guide.md`（697 行）

**对话中学到的教训：**
- 分享文档中涉及官方文档描述的部分，必须先验证再引用，不能凭印象
- "官方文档里只有一句话的描述"这种说法需要事实核查
- 文件过大导致写入失败时，应使用 Command 命令分段写入

### 工作线 C：AI 模板生成系统设计与实现（新功能启动）

**做了什么：**
- 在 tfbservice 项目中实现了 AI 模板生成服务的核心组件：
  - `Prompt` 模板引擎和组件文档（为 AI 生成服务提供提示词模板）
  - `AiTemplateServiceImpl`，包含 VueSfcParser、SchemaInferrer、BindingExtractor
  - LLM API Client，支持重试和多模态调用
- 在 tfbservice-api 中定义了 AI 模板生成服务接口和模型
- 在 job-tifenbao-gen-pdf 中编写了 Phase 5 设计文档：
  - `Phase 5 AI-driven template generation design and feasibility analysis`
  - `Phase 5 list pattern recognition capability analysis`

**对话中学到的教训：**
- AI 模板生成需要三个核心组件协同：VueSfcParser（解析现有模板）、SchemaInferrer（推断数据模型）、BindingExtractor（提取数据绑定）
- LLM API Client 需要内置重试机制，处理网络波动和限流

### 工作线 D：api-tfb-operation-manage AgentTools 订单流程

**做了什么：**
- 实现了设备发货订单的二次确认流程：
  - 学校地址解析二次确认
  - 学校信息二次确认
  - 物料信息及订单信息保存前二次确认
- 订单回显计算总价功能
- 地址解析工具增加开发区后缀
- 历史会话接口修复
- 文本格式改为 markdown
- 回调服务修改

**对话中学到的教训：**
- 二次确认流程在 Agent 场景下特别重要，防止 AI 自动化操作导致错误订单
- 地址解析需要覆盖更多行政区域后缀（如开发区）

### 工作线 E：业务项目持续迭代

**做了什么：**

1. **paperfresh 澳门版适配**：大量澳门版题型排序修复（资讯科技题类、品德与公民学科）、数据统计国际化、配对题连号、教材题规则修改、异常兜底处理

2. **api-school-book**：历史 paperId 的 setPaper 处理、以数据库配置为准（而非硬编码）、合并代码

3. **paper-homework-service**：成品卷换题接口（新增）、全学科开启 AI 知识点标注、分页查询问题修复

4. **html-paperfresh-pc**：试题左侧栏增加题库切换、考试类型筛选器组件、试卷分享判断条件修改、校自编教辅展示修复

## 3. 经验教训汇总

| 价值评级 | 类别 | 教训内容 | 可复用性 |
|----------|------|----------|----------|
| A | 文档 | 分享文档涉及官方文档描述必须先验证再引用，不能凭印象或假设 | 高 |
| A | AI工程 | AI 模板生成三个核心组件（Parser + Inferrer + Extractor）的架构模式可复用于其他代码生成场景 | 高 |
| A | 安全 | Agent 自动化场景下的订单操作必须增加二次确认流程 | 高 |
| B | 工具链 | agent-teams 分屏依赖 it2 工具，需要在环境配置中预装 | 中 |
| B | 开发 | 文件过大时 Claude Code 写入会失败，需分段写入 | 中 |
| B | 架构 | LLM API Client 需内置重试机制（指数退避）和多模态支持 | 高 |
| C | 业务 | 澳门版数据统计需要国际化处理（繁体中文等） | 低（项目特定） |
| C | 前端 | 试题筛选器组件可复用于多个页面（题库切换 + 考试类型筛选） | 中 |

## 4. Skill 提取建议

1. **claude-print-mode-guide skill**：将 print 模式的使用经验和社区案例固化为 skill，支持快速查阅 print 模式的用法和最佳实践

2. **ai-template-generation skill**：VueSfcParser + SchemaInferrer + BindingExtractor 的架构模式可以固化为通用的代码生成 skill

3. **agent-order-confirmation skill**：Agent 自动化场景下的二次确认流程可以抽象为通用的安全 skill

## 5. 工作流深度分析

### 做得好的地方
- **技术探索**：AI 模板生成系统的设计体现了技术深度，三个核心组件的设计思路清晰
- **分享沉淀**：Claude print 模式分享文档是高质量的知识输出（697 行，包含 8+ 社区真实案例）
- **Agent 安全**：在 AgentTools 订单流程中主动增加二次确认，体现了安全意识

### 反模式
- **paperfresh 46 次提交**：大量是 CI 自动发布和小的澳门版适配修改，说明缺乏批量处理意识，应该先完成所有修改再一次性提交
- **工具项目零提交**：local-scripts 在 03-06 之后没有持续迭代，可能是精力转移到业务项目上

### 成熟度评估
- 技术深度：4/5（AI 模板生成系统设计有深度）
- 知识输出：4/5（print 模式分享文档质量高）
- 业务交付：3/5（持续迭代但缺乏批量处理意识）
- 工具建设：2/5（本日主要是使用工具而非建设工具）

## 6. 真实踩坑时间线

| 时间 | 事件 | 教训 |
|------|------|------|
| 09:00-10:30 | agent-teams 分屏测试，发现 it2 未安装 | 环境依赖需要提前检查 |
| 10:00-11:30 | Paperfresh/paper-homework-service 澳门版迭代 | 持续小修改，应集中处理 |
| 11:00-14:00 | api-tfb-operation-manage 二次确认流程实现 | Agent 安全场景的必要保护 |
| 14:00-18:00 | paperfresh 大量 CI 自动发布 | CI 资源浪费，应合并修改 |
| 16:00-19:00 | AI 模板生成系统设计与实现 | 新技术方向启动 |
| 18:00-19:00 | Claude print 模式分享文章搜索和撰写 | 社区案例收集是关键 |
| 19:30-23:50 | job-tifenbao-gen-pdf Phase 5 设计文档 | AI 模板生成的可行性分析 |
| 23:44 | Phase 5 list pattern recognition 分析 | 深夜仍在输出设计文档 |

## 7. 改进路线图

1. **短期（本周）**：安装 it2 工具，验证 agent-teams 分屏功能正常工作
2. **短期（本周）**：批量处理 paperfresh 等项目的修改，减少 CI 自动发布次数
3. **中期（本月）**：AI 模板生成系统完成原型，进行可行性验证
4. **中期（本月）**：print 模式分享文档完善后发布到团队
5. **长期（下月）**：AI 模板生成系统集成到 job-tifenbao-gen-pdf 的生产流程中
