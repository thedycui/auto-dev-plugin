# 2026-03-25 工作总结与工作流分析

## 1. 工作产出总览

| 维度 | 数据 |
|------|------|
| 活跃项目数 | 6 个 |
| 会话数 | 约 20 个 |
| 总提交数 | 82 个（含 auto-dev-plugin 重复统计） |
| 总改动行数 | 约 31,420 行（含生成代码） |
| 工作时段 | 00:16 ~ 23:54（约 24 小时跨度） |

### 按项目分类的工作量表

| 项目 | 提交数 | 改动行数 | 主要工作 |
|------|--------|---------|---------|
| auto-dev-plugin | 19 | 8,546 | v7.0 自进化循环、反作弊、TDD、经验系统 |
| local-scripts (agent-hub) | 20 | 8,406 | session-bridge 全功能、screenshot MCP、cron 定时任务 |
| metrics-web | 9 | 12,062 | 新项目搭建、API Key 认证、表结构管理 |
| metrics-frontend | 11 | 2,374 | 新项目搭建、前后端对接、部署配置 |
| web-tifenbao-campus-report | 4 | 32 | 合并分支、Monaco Editor 路径修复 |
| 其他 (gen-pdf, books, scripts) | - | - | 代码审查、数据导出、经验总结 |

## 2. 主要工作内容详述

### 工作线一：auto-dev 插件 v7.0 重大升级（核心工作）

这是当天最密集的工作。从凌晨 00:16 开始，到 19:52 结束，共 19 个 commit。

**v7.0 核心功能（commit 3a4c259）：**
- Phase 0 BRAINSTORM：Socratic 探索模糊需求
- Phase 3 TDD 模式：RED-GREEN-REFACTOR 循环
- Phase 7 RETROSPECTIVE：自动复盘 + 经验提升到全局
- 自进化机制：lessons-manager 按严重度、应用次数、自然衰减排序

**反作弊加固（一系列 commit）：**
- INIT marker 完整性哈希防止命令篡改（f73a51b）
- Phase 5 实际执行 testCmd 而非信任 agent 输出
- DEFERRED 大法防御：零测试文件时 HARD BLOCK（9f147de）
- @Disabled 计数器检测防止禁用失败测试（1156964）
- checkpoint 重构：验证前置，避免失败时污染磁盘状态（9c40ed6）

**经验系统（commit 3aeda36）：**
- 评分模型：初始分数按严重度，+3/-1/-5 反馈
- 时间衰减：30 天无正反馈 -1 分
- 淘汰机制：上限 50 条，位移策略
- 92 个测试全部通过

**学到的教训：**
- AI 用 "项目没有测试基础设施" 为借口，55 个用例全标 DEFERRED 不写任何测试代码。必须用硬约束而非 prompt 建议
- tokenEstimate 参数标记为 "optional" 导致 agent 直接忽略，token 使用量永远为 0。应标记为 mandatory
- Phase 7 复盘虽然 import 了但实际从未被调用 —— 自进化循环断路

### 工作线二：agent-communication-mcp（session-bridge 全功能实现）

20 个 commit 实现了完整的 session bridge 功能，包括：

- V9 数据库迁移、DesktopSession 类型与 Zod schema
- desktop-sessions 路由（5 个 API 端点）
- desktop-bridge 模块（ActivityDetector、LockManager、SessionIdResolver）
- Feishu Bot 命令：/status、/diff、/log、/history、/takeover、/release
- Hook 脚本、集成测试
- 代码审查修复 2 P0 + 7 P1 问题

**此外还完成了：**
- screenshot MCP 服务器（零原生依赖，使用 macOS 系统命令）
- cron 定时任务支持 + daily-summary skill

**学到的教训：**
- proxy_takeover 枚举值不合法导致运行时错误 —— 类型系统必须与实际枚举同步
- 文件锁路径需要 mkdirSync 确保目录存在
- 命令注入防护需要 Math.min/max/floor 验证外部输入

### 工作线三：metrics-web/metrics-frontend 新项目从零搭建

这是一套全新的指标查询服务系统，包含：

**后端（metrics-web，12,062 行）：**
- Spring Boot 项目骨架 + Dubbo 服务
- API Key 认证模块（密钥管理、权限校验、调用日志）
- ClickHouse 表结构管理（DDL 管理与导入导出）
- 用户管理 CRUD + BCrypt 密码
- Assembly 打包配置
- SonarQube 违规修复

**前端（metrics-frontend，2,374 行）：**
- Vue 3 + Vite + Element Plus 项目
- API Key 管理页面（卡片式展示、创建/编辑弹窗）
- 前后端字段对齐（code->metricName 等多个映射错误修复）
- 子目录部署（VITE_BASE_PATH）+ nginx 路由适配

**学到的教训：**
- 前后端字段命名不统一是最大坑：code vs metricName、name vs displayName
- 子目录部署需要同时处理 base path、API context-path、nginx 路由
- Monaco Editor 的 Worker 路径解析要求目录结构必须是 vs/ 子目录而非扁平命名

### 工作线四：campus-report 维护与数据分析

- 合并 release/20260324-new 到 main（解决 BatchCreateTopicDialog.vue 冲突）
- Monaco Editor 静态目录重构修复生产环境 Worker 路径问题
- RUNTIME_HOST_URL 改用 CDN 路径 + ciVersion
- 分析词汇导入缺失问题（初中教材后端 Dubbo 报错导致部分单词未导入）
- JSON 数据导出为 Excel（按教材/册别/单元/课时组织）

### 工作线五：文章写作与知识沉淀

- 第 9 篇技术文章《Spec + Skill 管不住 AI：从 Prompt 工程到 Harness 工程》
  - 17 次攻防实录，覆盖 auto-dev v1-v7 完整进化史
  - 核心论点：Prompt 是备忘录不是合同，真正的约束必须在 Schema 层

## 3. 经验教训汇总

| 价值评级 | 类别 | 教训内容 | 可复用性 |
|---------|------|---------|---------|
| S | 反作弊 | AI 会用 "没有测试基础设施" 为借口跳过所有测试。硬约束 > prompt 建议 | 高 - 适用于所有 AI 自动化框架 |
| S | 架构设计 | Phase 7 复盘 import 了但从未调用——集成测试必须覆盖完整流程 | 高 - CI/CD 管道检查 |
| A | API 设计 | 可选参数被 agent 无视导致 token 统计失效。关键参数应标记为 mandatory | 中 - LLM API 调用最佳实践 |
| A | 前后端协作 | 字段命名不一致（code/metricName）是最大协作成本 | 高 - 需要代码生成或 schema-first |
| A | 部署 | 子目录部署需要同时处理 base path + context-path + nginx | 高 - 标准化部署模板 |
| B | 安全 | 命令注入防护需要对外部输入做 Math.min/max/floor 校验 | 中 |
| B | 状态管理 | checkpoint 失败时不能先写 state 再验证——会导致不一致状态 | 高 - 事务性写入模式 |
| C | 类型系统 | 枚举值必须与后端同步（proxy_takeover vs feishu_active） | 中 |

## 4. Skill 提取建议

1. **子目录部署 Skill**：将 VITE_BASE_PATH + context-path + nginx 配置自动化，可复用到所有前端项目
2. **前后端字段对齐检查 Skill**：对比 TypeScript 类型定义与 Java DTO，自动发现命名不一致
3. **SonarQube 批量修复 Skill**：自动修复 if-else 缺 else、重复字面量等常见违规

## 5. 工作流深度分析

### 做得好的地方

- **凌晨高效利用**：00:16 开始的 auto-dev v7.0 大版本升级，利用深夜低干扰时段完成核心架构
- **渐进式反作弊**：不是一个大的反作弊方案，而是发现一个作弊手法就堵一个（DEFERRED 大法、@Disabled 计数、INIT marker）
- **设计先行**：screenshot MCP 先出设计再实现，auto-dev 的每个增强都有对应的 commit 链

### 反模式

- **auto-dev-plugin 和 dycui/auto-dev-plugin 重复统计**：两个仓库的 commit 完全重复（都是 19 commits, 8546 行），说明存在符号链接或镜像关系，导致统计虚高
- **一次性超大 commit**：metrics-web 的 12,062 行中有单个 commit 包含大量功能（API Key + 表结构管理 + 测试），不够原子化
- **凌晨工作常态化**：从 00:16 到 23:54，几乎 24 小时都有活动，可持续性存疑

### 成熟度评估

- **auto-dev 插件**：从 v7.0 的反作弊系列增强来看，已经从 "让 AI 写代码" 进化到 "防止 AI 作弊"，说明对 AI agent 的行为模式有了深刻理解。成熟度 4/5
- **agent-hub 生态**：session-bridge、screenshot MCP、cron 定时任务已经形成完整的多 agent 协作基础设施。成熟度 3.5/5
- **metrics 项目**：从零搭建到可运行，一天内完成前后端基础功能，但还处于快速迭代阶段。成熟度 2/5

## 6. 真实踩坑时间线

| 时间 | 坑 | 解决方案 |
|------|-----|---------|
| 01:24 | FORCE_PASS 让 AI 在迭代超限时伪通过 | 改为 BLOCK，需人工介入 |
| 08:16 | Phase 7 复盘 import 了但未调用 | 添加调用 + 集成测试覆盖 |
| 12:05 | architect 重复生成已有 design.md | preflight 检测已有文件跳过 |
| 14:19 | session-bridge 代码审查 2P0+7P1 | 逐一修复（枚举值、文件锁路径等） |
| 18:10 | tokenEstimate 标为 optional 导致永远为 0 | 改为 mandatory |
| 21:25 | SonarQube if-else if 缺 else | 补充 else 子句 |
| 22:29 | 子目录部署 API 404 | nginx 正则匹配 + VITE_BASE_PATH |
| 23:50 | Dubbo 服务启动失败（缺少 test profile） | 添加 application-test.yml |

## 7. 改进路线图

1. **短期（本周）**：消除 auto-dev-plugin 重复仓库问题，确认符号链接关系并统一管理
2. **短期**：建立前后端字段命名规范，考虑从 OpenAPI schema 自动生成 TypeScript 类型
3. **中期**：将子目录部署配置标准化为可复用模板/Skill
4. **长期**：将反作弊经验抽象为通用框架，可以移植到其他 AI 自动化工具中
