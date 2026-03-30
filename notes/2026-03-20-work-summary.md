# 2026-03-20 工作总结与工作流分析

## 1. 工作产出总览

| 指标 | 数值 |
|------|------|
| 涉及项目 | 5 个 |
| Claude Code 会话 | ~37 个 |
| Git 提交 | 14 个（gen-pdf 项目） |
| 估计改动行数 | ~1500 行 |

### 按项目分类的工作量

| 项目 | 会话数 | 提交数 | 主要工作 |
|------|--------|--------|----------|
| job-tifenbao-gen-pdf | 12 | 14 | 双轨渲染修复、诊断日志、代表性PDF上传、Sonar修复 |
| agent-communication-mcp | 5 | 0 | 双模式会话设计（Command+Chat）、飞书文件发送设计 |
| share-documents（文章撰写） | 3 | 0 | "AI编程的坑"文章撰写、真实案例替换 |
| auto-dev-plugin | 2 | 0 | design-review skill 增强、跨组件影响分析 |
| local-scripts | 15 | 0 | episodic-memory 调试、文章协作 |

## 2. 主要工作内容详述

### 工作线 A：job-tifenbao-gen-pdf 双轨渲染稳定性修复（主要工作）

**做了什么**：解决 gen-pdf 服务在 download 服务器上使用 wkhtmltopdf 渲染时的图片缺失问题，以及双轨渲染流程中的多个 bug。

具体产出（14 个提交）：
1. **图片资源缺失排查** — 发现 IST/Ultra 模板的 22 张图标从未被添加到 templatemanager 子模块，导致 download 服务器渲染 PDF 时"图片加载失败"
2. **双轨诊断日志** — 老流程双轨验证结果为 SINGLE_PDF 而非 ZIP_PACKAGE，添加诊断日志覆盖 genFileName 返回值、ZIP 判断入口、ZIP 上传结果、最终 outputType
3. **isDualTrackEnabled=false 适配器跳过** — 依赖外部服务的适配器（语文作文教师/学生报告）不支持本地模板渲染，直接保存 NOT_SUPPORTED 跳过
4. **代表性 PDF 上传** — PushPdfRenderAdapter 标记教师讲义 folder/fileName，GenericRenderTaskHandler 在 ZIP 打包前单独上传代表性 PDF
5. **Sonar 修复** — 嵌套超过 5 层，提取 fillRepresentativePdf 为独立方法
6. **空值防御** — GenericRenderTaskHandler.getDesiredPageSize 和 EngMvpPreviewRenderAdapter 的 try-catch 保护
7. **版本封版** — release/20260323 封版、合并 feature 分支

**对话中学到的教训**：
- download 服务器和开发环境路径不同，需要通过跳板机实际验证文件存在性
- wkhtmltopdf 使用 `file://` 协议加载本地文件，图片路径必须在服务器构建产物中实际存在
- 双轨渲染的 ZIP vs SINGLE_PDF 判断逻辑分散在多个方法中，需要系统性地添加诊断日志

### 工作线 B：agent-communication-mcp 双模式会话设计

**做了什么**：为 agent-communication-mcp 系统设计 Command（`claude -p --resume`）和 Chat（PTY 常驻进程）双模式会话支持。

关键设计决策：
- Command 模式：每次 `claude -p` + `--resume`，进程退出但上下文保留，适合独立指令
- Chat 模式：PTY 常驻进程，`send_input` 直接输入，适合多轮交互式开发
- Per-user 会话作用域 + 手动 `/chat` 进入 + 自动超时 1 天
- 默认 command 模式，按需进入 chat

**对话中学到的教训**：
- 架构设计需要先充分理解现有代码（CliRunner vs PtyRunner 的差异），再提出方案
- 双模式的核心问题是生命周期管理和资源释放

### 工作线 C：AI 编程踩坑文章撰写

**做了什么**：撰写关于"Claude Code 等 AI 编程工具的坑"的技术分享文章。

关键过程：
- 网络搜索收集真实案例（Terraform destroy、rm -rf、规则被无视等）
- 文章定位：给已经被"安利"过的同事泼冷水
- 替换 8 个编造的"自身经历"案例为真实案例（或标注"待补充"）
- 派 8 个 subagent 搜索历史聊天记录找真实案例，但因 episodic-memory 插件 better-sqlite3 版本不兼容全部失败
- 添加 Claude Code 自我回应作为彩蛋章节

**对话中学到的教训**：
- 文章的可信度取决于案例的真实性，编造的案例会被识破
- episodic-memory 插件依赖的 native 模块（better-sqlite3）在不同 Node.js 版本间存在兼容性问题

### 工作线 D：auto-dev-plugin design-review skill 增强

**做了什么**：将 design-review skill 的 Angle 4（跨组件影响分析）从 checklist 升级为强制执行步骤。

关键改进：
1. 提取变更清单 — 从设计中列出所有被改动的接口/类/表/配置/队列
2. 逐项搜索调用方（强制） — 必须用 grep/find_referencing_symbols 实际搜索
3. 影响判定与记录 — 区分本仓库、跨仓库（本地有代码）、跨仓库（本地无代码）
4. DB schema、API 兼容性、共享状态、部署顺序检查

**对话中学到的教训**：
- Skill 应该自包含，不能依赖别人也装了某个 skill
- Checklist 级别的约束力不够，需要升级为"强制执行步骤"才能保证 AI 真正执行

## 3. 经验教训汇总

| 价值评级 | 类别 | 教训内容 | 可复用性 |
|----------|------|----------|----------|
| P0 | 排查方法论 | wkhtmltopdf 渲染失败时，先确认 file:// 路径的文件在目标服务器上是否真实存在 | 高 — 每次涉及模板渲染排查都可用 |
| P0 | 防御编程 | 对外部数据（配置、JSON解析、空值）必须有 try-catch 保护 | 高 — 通用编码原则 |
| P1 | 诊断日志 | 对复杂的条件分支（如 ZIP vs SINGLE_PDF 判断），在入口/出口/每个分支添加搜索关键字标记的日志 | 高 — 所有复杂业务逻辑排查 |
| P1 | Skill 设计 | AI 工具的约束不能只是 checklist，必须是"强制执行步骤" | 高 — auto-dev 所有 skill |
| P1 | Native 模块 | better-sqlite3 等 native 模块需要与 Node.js 版本匹配 | 中 — MCP 插件开发 |
| P2 | 文章写作 | 技术文章的真实性 > 完整性，编造的案例宁可留空 | 中 — 知识分享 |

## 4. Skill 提取建议

1. **模板渲染图片排查 Skill** — 自动检查模板中引用的所有图片资源是否存在于构建产物和服务器上
2. **双轨渲染诊断 Skill** — 一键在渲染链路关键节点添加/移除诊断日志

## 5. 工作流深度分析

### 做得好的地方
- **双轨渲染修复**采用了系统化方法：先定位根因（图片缺失） -> 修复 -> 添加防御日志 -> 验证
- **文章撰写**过程中发现编造案例后立即纠正，保持了内容诚信
- **design-review skill 改进**从实际问题出发（跨组件影响分析不够深入），针对性地升级约束级别

### 反模式
- **episodic-memory 插件故障**：8 个 subagent 全部失败，浪费了大量 token。应该在启动批量任务前先验证工具链可用性
- **对话文件数量过多**（37 个）：同一天开了大量会话，部分可能是一次性问答，切换成本高

### 成熟度评估
- **业务代码修复**：成熟 — 有完整的排查 -> 修复 -> 防御 -> 提交流程
- **工具/框架开发**：发展中 — auto-dev skill 在持续迭代但尚未稳定
- **知识分享**：起步阶段 — 文章撰写刚开始，流程还在摸索

## 6. 真实踩坑时间线

| 时间 | 事件 | 影响 |
|------|------|------|
| 上午 | 发现 download 服务器 wkhtmltopdf 渲染失败，3 张图片缺失 | 耗时较长排查，需要通过跳板机验证 |
| 上午 | templatemanager 子模块更新后 pull 到 release 分支 | 解决了图片加载失败问题 |
| 下午 | 双轨验证发现 SINGLE_PDF 而非 ZIP_PACKAGE | 添加诊断日志定位问题 |
| 下午 | 派 8 个 subagent 搜索历史记录找真实案例 | 全部因 better-sqlite3 版本问题失败 |
| 傍晚 | 修复 episodic-memory 插件后重新发送搜索 | 搜索服务不稳定，多个 agent 未返回结果 |

## 7. 改进路线图

1. **短期** — 为 episodic-memory 插件添加版本兼容性检查和自动重编译机制
2. **中期** — 将双轨渲染诊断日志标准化为可开关的 feature flag，而非临时添加删除
3. **长期** — 建立 AI 编程踩坑案例库，从历史对话中自动提取真实案例，避免手动搜索
