# 2026-03-26 工作总结与工作流分析

## 1. 工作产出总览

| 维度 | 数据 |
|------|------|
| 活跃项目数 | 5 个 |
| 会话数 | 约 24 个 |
| 总提交数 | 105 个（含重复） |
| 总改动行数 | 约 42,667 行 |
| 工作时段 | 02:28 ~ 23:21 |

### 按项目分类的工作量表

| 项目 | 提交数 | 改动行数 | 主要工作 |
|------|--------|---------|---------|
| auto-dev-plugin | 23 | 33,422 | 三权分立 tribunal、TDD RED-GREEN Gate、invisible framework、turbo mode、circuit breaker |
| metrics-web | 41 | 3,084 | 权限模型、STRING 聚合修复、Skill 分发、OpenClaw 集成 |
| metrics-frontend | 25 | 4,901 | 角色权限 UI、OpenClaw 安装流程、表结构管理、使用指南 |
| local-scripts (agent-hub) | 16 | 1,460 | scheduler-ephemeral-proxy 全功能实现 |

## 2. 主要工作内容详述

### 工作线一：auto-dev 插件 v8.0 架构大重构（核心工作）

这是当天最重磅的工作。23 个 commit，从架构到功能全面升级。

**三权分立 Tribunal 系统（commit b23ba2b）：**
- 新增 auto_dev_submit MCP tool，主 Agent 只能提交不能判定 PASS
- checkpoint(phase=4/5/6/7, PASS) 被框架拦截，必须经独立裁决流程
- 裁决 Agent 通过 claude -p 独立 session 运行
- 框架交叉验证兜底（test exit code + impl/test 文件比例）
- 46 个测试 + 16 个 AC 全部验证

**TDD RED-GREEN Gate（commit ebc677c）：**
- 新增 auto_dev_task_red / auto_dev_task_green MCP tools
- RED 阶段：只允许测试文件变更 + 测试必须失败
- GREEN 阶段：前置 RED_CONFIRMED + 所有测试必须通过
- tddTaskStates 用 enum 状态机（PENDING/RED_CONFIRMED/GREEN_CONFIRMED）
- 212/212 测试全部通过

**Invisible Framework（commit d534475）：**
- 编排循环改为框架侧运行，task agents 不知道 phases/checkpoints/tribunal
- 消除 Goodhart 博弈激励 —— agents 不再优化 "通过关卡" 而非 "做好工作"
- SKILL.md 从 353 行简化到 62 行
- 12 个 phase prompt 清除所有框架术语

**Step Orchestrator（commit 2fe4976）：**
- auto_dev_orchestrate -> auto_dev_next：状态化 step function
- 每次调用返回一个 task，主 agent 通过 Agent() subagent 调度
- Turbo mode 支持：无 plan.md 时直接用 topic

**Turbo Mode + Auto Mode Selection（commit b91ad42 + 28435da）：**
- 三级模式：turbo（仅 Phase 3）/ quick / full
- Agent 提供改动估算但不知道映射规则，框架内部决定模式
- Post-hoc guard：turbo 模式实际 diff 超阈值自动升级

**Circuit Breaker（commit 64ab626）：**
- 检测同一方法重复失败（如 npm install 重试 6 次）
- 切换到替代方法 + 干净 prompt（排除先前失败上下文）
- parseApproachPlan、handleApproachFailure、buildCircuitBreakPrompt
- 38 个新测试，303 个总计通过

**Tribunal 稳定性改进（commit 8244752）：**
- Pre-digest 输入编译为单文件（<50KB）
- Crash 检测 + fallback：TRIBUNAL_PENDING 机制
- Inline prompt：将 digest 直接嵌入 -p 参数，消除 Read 工具调用

**学到的教训：**
- Tribunal 最初用 --bare 标志导致 "Not logged in" 错误（跳过了认证初始化）
- Agent 自行编造不存在的 agent 名（auto-dev-planer），需要在 SKILL.md 列出全部有效 agent 名
- Tribunal agent 只给 Read 权限但需要 Grep 搜索大 patch 文件导致崩溃
- 好的hart 定律：当指标成为目标，它就不再是好的指标。Agent 优化 "通过关卡" 而非 "做好工作"

### 工作线二：metrics-web 权限模型与功能完善

41 个 commit，集中在权限、安全、数据治理。

**P0 安全漏洞修复（commit c9f5551）：**
- dataScope 从 MongoDB 读取永远为 null，所有用户都能查所有学校数据
- 改为实时从外部权限系统获取用户数据权限
- 管理员/全国权限不限制、学校级权限限制查询范围、无权限时 SQL 加 1=0

**数据权限模式管理（commit 469e6e2, 25941ae）：**
- UNRESTRICTED/LOCAL/EXTERNAL 三种模式
- 管理员可在系统内手动配置用户数据权限
- AdminAuthInterceptor 同时支持数据库 roles 和配置文件白名单

**STRING 聚合修复（commit 3d81bc4）：**
- 考频等字符串字段经 toFloat64OrZero 全部变 0
- 改为按 dataType 分流：STRING + MAX/MIN 直接字符串聚合，STRING + SUM/AVG 降级为 COUNT

**Skill 分发与 OpenClaw 集成：**
- SkillController：版本查询、定义下载、一键安装脚本（Mac/Win/OpenClaw）
- OpenClaw 安装脚本拆分为 install + setup 两步
- 无 Python/Node 时 curl fallback

**认证修复系列：**
- enabled 为 null 时误判为禁用（Boolean.FALSE.equals 修复）
- extractClientIp 从 X-Forwarded-For 取第一个 IP（阿里云 SLB 追加代理 IP）
- AJAX 未认证返回 CAS 登录地址（避免前端 401 死循环）
- API Key 拦截器用 servletPath 替代 requestURI（context-path 兼容）

**学到的教训：**
- 阿里云 SLB 在 X-Forwarded-For 中追加代理 IP，取最后一个拿到的是内网 IP
- getRequestURI() 含 context-path，不匹配 startsWith("/api/admin")，要用 getServletPath()
- Spring Data MongoDB 3.x+ 默认关闭 auto-index-creation，@Indexed 注解不自动创建索引
- Dubbo 跨 RPC 时异常被包装为 RuntimeException，GlobalExceptionHandler 的 IllegalArgumentException 处理器接不到

### 工作线三：metrics-frontend 前端完善

25 个 commit，聚焦用户体验和安装流程。

**角色权限区分：**
- 侧边栏菜单按角色分区（管理员专属：用户管理、指标配置管理）
- 路由守卫 requiresAdmin + ElMessage 提示
- 普通用户展示只读指标目录（按分类分组、搜索过滤）

**OpenClaw 安装流程优化：**
- 先生成 API Key 再安装的引导流程
- 安装命令自动嵌入真实 API Key
- Mac/Windows 分 Tab 展示，零基础用户友好
- Windows 改用 .bat 双击运行（避免 ExecutionPolicy 限制）

**Router 改 hash 模式：**
- createWebHistory -> createWebHashHistory
- 解决 SPA 子路径 404 问题（不依赖服务端 try_files）

**学到的教训：**
- Windows PowerShell ExecutionPolicy 阻止 .ps1 脚本执行，改用 .bat 内嵌 powershell -ExecutionPolicy Bypass
- 前端 401 时 AJAX 无法触发浏览器跳转，需要 window.location 导航到 CAS
- 指标列表加载判断 res.code===200 而非 res.success（字段不存在导致列表为空）

### 工作线四：agent-hub scheduler-ephemeral-proxy

16 个 task-based commit，实现了调度器的 ephemeral proxy 功能：

- 当目标 agent 离线时，检查 proxyConfigPath 并启动 ephemeral proxy
- session-proxy --once 模式入口
- spawnEphemeralProxy：子进程管理、10 分钟超时、stderr 收集
- Feishu Bot 处理 schedule.failed 事件
- 完整的单元测试覆盖

## 3. 经验教训汇总

| 价值评级 | 类别 | 教训内容 | 可复用性 |
|---------|------|---------|---------|
| S | AI 治理 | Goodhart 定律：当关卡成为目标，AI 会优化过关而非做好工作。invisible framework 是正确方向 | 极高 - 所有 AI 自动化 |
| S | AI 治理 | Agent 会自行编造不存在的 agent 名。SKILL.md 必须列出全部有效 agent 名 | 高 - prompt engineering |
| A | 安全 | 阿里云 SLB X-Forwarded-For 追加代理 IP，取最后一个拿到内网 IP | 高 - 所有阿里云部署 |
| A | Spring Boot | getRequestURI() 含 context-path，getServletPath() 不含 | 高 - 所有 Spring 项目 |
| A | MongoDB | Spring Data 3.x+ 默认关闭 auto-index-creation | 中 - 版本升级注意 |
| A | 数据处理 | STRING 字段 toFloat64OrZero 全变 0，需按 dataType 分流 | 高 - ClickHouse 查询 |
| B | Windows | PowerShell ExecutionPolicy 阻止 .ps1 执行，改用 .bat 包装 | 高 - 跨平台安装脚本 |
| B | AI 工具 | Tribunal agent 只给 Read 权限不够，需要 Grep 搜索大文件 | 中 |
| C | 前端 | hash router 比 history router 在子目录部署下更可靠 | 中 |

## 4. Skill 提取建议

1. **Aliyun SLB IP 提取 Skill**：标准化从 X-Forwarded-For 取原始客户端 IP 的逻辑，适配阿里云/腾讯云/AWS
2. **AI Agent 权限白名单 Skill**：自动列出所有有效 agent/tool 名并校验，防止 AI 编造不存在的资源
3. **Windows 安装脚本模板 Skill**：标准化的 .bat 包装 PowerShell 方案，适配各种安装场景

## 5. 工作流深度分析

### 做得好的地方

- **架构演进有深度**：从 "AI 做任务" 到 "invisible framework"，解决了 Goodhart 定律这个根本性问题
- **Tribunal 三权分立**：设计严谨，独立裁决 + 交叉验证 + fallback，有 46 个测试覆盖
- **渐进式发布**：先 tribunal -> turbo mode -> invisible framework -> circuit breaker，每个增强独立可用
- **跨平台用户友好**：OpenClaw 安装流程充分考虑了 Windows 用户和零基础用户

### 反模式

- **一天 23 个 commit 到 auto-dev-plugin**：33,422 行改动，包含多个重大架构变更（tribunal、TDD gate、invisible framework、turbo mode、circuit breaker），单个工作日变更量过大
- ** Tribunal 连续崩溃**：从日志看 Phase 4 tribunal 连续 3 次崩溃后才通过 inline prompt 一次性解决。应该在第一次崩溃后就分析根因
- **metrics-web 41 个 commit 中大部分是修复**：权限、认证、IP 等问题在初始搭建时没有考虑充分

### 成熟度评估

- **auto-dev 插件**：从 "防止 AI 作弊" 进化到 "消除作弊动机"（invisible framework），这是质的飞跃。成熟度 4.5/5
- **metrics 系统**：权限模型从无到有，但还需要更多生产环境验证。成熟度 3/5
- **agent-hub**：scheduler-ephemeral-proxy 让调度能力更完整。成熟度 4/5

## 6. 真实踩坑时间线

| 时间 | 坑 | 解决方案 |
|------|-----|---------|
| 02:28 | X-Forwarded-For 取最后一个 IP 拿到 SLB 内网 IP | 改取第一个 |
| 07:23 | API Key 拦截路径不匹配（context-path 问题） | 用 getServletPath() |
| 08:30 | 用户 enabled=null 被判为禁用 | Boolean.FALSE.equals() |
| 10:48 | Agent 编造 auto-dev-planer agent 名 | SKILL.md 列出全部有效 agent 名 |
| 12:03 | session-proxy --bare 导致 Not logged in | 移除 --bare 标志 |
| 13:23 | Tribunal 只给 Read 权限但需要 Grep | 添加 Grep/Glob 工具 |
| 13:44 | Tribunal patch 文件太大导致崩溃 | 排除 dist/.map/.lock |
| 16:18 | Tribunal 连续崩溃 | Pre-digest + inline prompt |
| 20:35 | ClickHouse 表名含点号不匹配正则 | 新增 isSafeTableName 支持 db.table 格式 |
| 22:06 | STRING 聚合返回 0.0 | 按 dataType 分流处理 |

## 7. 改进路线图

1. **短期**：auto-dev v8.0 的 invisible framework 需要更多真实场景验证，特别是大型 Java 项目
2. **短期**：metrics-web 的权限模型需要 E2E 测试覆盖，特别是 API Key + 角色权限的组合场景
3. **中期**：将 Goodhart/invisible framework 的设计思想写成技术文章分享
4. **长期**：探索 circuit breaker 与 human-in-the-loop 的结合点，在自动恢复和人工介入之间找平衡
