# 2026-03-23 工作总结与工作流分析

## 1. 工作产出总览

| 指标 | 数值 |
|------|------|
| 涉及项目 | 7 个 |
| Claude Code 会话 | ~28 个 |
| Git 提交 | 20 个 |
| 估计改动行数 | ~3000 行 |

### 按项目分类的工作量

| 项目 | 会话数 | 提交数 | 主要工作 |
|------|--------|--------|----------|
| auto-dev-plugin | 2 | 6 | v6.0 健壮性升级（迭代限制、状态重建、preflight） |
| job-tifenbao-gen-pdf | 21 | 9 | 适配器设计文档、渲染链路诊断日志、静测问题修复 |
| local-scripts | 11 | 10 | WebUI 全面改进、飞书 Bot 文件浏览、文章撰写 |
| html-paperfresh-pc | 1 | 1 | 分支合并 |
| agent-communication-mcp | 1 | 0 | 飞书文件发送功能实现（含 auto-dev 全流程） |
| job-tifenbao-process | 1 | 0 | 代码阅读/分析 |
| web-tifenbao-campus-report | 1 | 0 | 前端问题排查 |

## 2. 主要工作内容详述

### 工作线 A：auto-dev-plugin v6.0 健壮性升级（主要工作之一）

**做了什么**：对 auto-dev 自治开发循环框架进行了 6 个 commit 的重大升级，提升系统健壮性和自动化程度。

具体改进（6 个提交）：
1. **状态转换守卫**（1d0fb47）— 防止编排 agent 绕过 phase-enforcer 逻辑：阻止阶段跳跃、阻止未完成阶段前进、阻止非法 COMPLETED 设置
2. **7 项功能增强**（e124b85）— state lockdown（强制 checkpoint）、startCommit（记录初始 HEAD）、preflight suggestedPrompt（自动渲染下一阶段提示）、resume task 级恢复、phaseTimings 记录、skipE2e 标志、tokenEstimate 跟踪
3. **SKILL.md 文档更新**（cf43914）— 记录所有新功能、更新 Phase 6 提示模板参考表、清理 .gitignore
4. **v6.0 健壮性**（2ac25c7）— 迭代限制（checkpoint 自动检测 NEEDS_REVISION 超限）、状态重建（从 progress-log.md 恢复损坏的 state.json）、preflight context（Phase 3+ 自动注入设计摘要和计划任务列表）、REGRESS 状态（支持阶段回退，最多 2 次）、57 个测试全部通过
5. **Phase 5/6 checklist 和模板**（f7895d0）— E2E 测试审查 checklist、验收审查 checklist、Phase 6 提示模板
6. **MCP tools 计数注释修正**（276fbe3）

**对话中学到的教训**：
- AI agent 的状态管理需要多层防御：不能信任 agent 自己调用 state_update，必须通过 checkpoint 强制校验
- 迭代限制是防止 AI 无限循环的必要机制，不同阶段应有不同的限制阈值
- 状态重建能力是生产级系统的必备功能，progress-log.md 作为 single source of truth

### 工作线 B：agent-communication-mcp 飞书文件发送 + WebUI 全面改进

**做了什么**：实现 CC（Claude Code）主动向飞书用户发送文件的能力，以及 WebUI 和飞书 Bot 的全面功能增强。

具体产出（10 个 local-scripts 提交）：

**飞书文件发送核心功能**：
- Hub：`POST /files`（上传）、`GET /files/:fileId`（下载）、自动清理
- MCP Plugin：`hub_send_file` 工具 + uploadFile 方法
- Feishu-bot：`file.uploaded` 事件监听，下载文件后上传到飞书发送给用户
- 安全：fileName 用 basename() 防路径穿越

**远程文件系统浏览**：
- Hub：5 个 `/ui/api/fs/*` 接口（list, read, targets, roots 管理）
- FileBrowser 类：白名单/黑名单安全、symlink 解析、二进制检测、路径穿越保护
- 飞书 Bot：`/browse` 命令 + 交互式卡片导航
- Web UI：新"Files"标签页，双栏布局（目录树 + 预览）

**飞书 Bot 改进**：
- 从交互式卡片切换到文本命令（`/browse`、`/ls`、`/cat`），因为飞书 WebSocket 模式不支持卡片 action callback
- 添加 start.sh 一键启动脚本

**WebUI 全面改进**（8 项）：
1. Agent 下线自动结束关联 Session
2. Session 时间显示完整日期
3. 审批改为右上角通知弹出面板（铃铓 + Popover）
4. 新增定时任务管理页（完整 CRUD）
5. 文件浏览器对目录创建 Proxy
6. 支持删除 offline Agent 和已结束 Session
7. 全部 UI 文本中文化
8. Tab 结构调整

**Bug 修复**（3 个 P0）：
- 重新启用 Permission MCP tool（之前被 TODO 注释掉了）
- 所有 SQLite row mapper 添加 safe JSON.parse（防止脏数据崩溃）
- unregister() 验证 agent 存在性（返回 404）

**对话中学到的教训**：
- 飞书 WebSocket 模式的限制：不支持交互式卡片回调，需要公共 HTTP 端点。在架构设计时必须先确认平台的实际能力
- SQLite 的 JSON.parse 缺少 try-catch 是常见但致命的遗漏，一条脏数据可以导致整个服务崩溃
- 文件浏览安全需要多层防护：路径穿越、symlink 解析、白名单/黑名单

### 工作线 C：job-tifenbao-gen-pdf 适配器设计 + 渲染链路日志

**做了什么**：为渲染引擎重构项目编写详细的适配器实现计划文档，并在 release 分支添加渲染链路诊断日志。

具体产出（9 个提交）：
1. **渲染链路关键节点 warn 日志** — 覆盖 DefaultRenderEngine 三路径路由、AbstractTaskHandler PDFGenerator 选择、GenericRenderTaskHandler 适配器路由、ChromePDFGenerator 入口出口、CustomWKHtmlToPdfUtil 全链路
2. **AI 可读的渲染平台集成指南** — 涵盖模板开发、注册、渲染触发、结果获取、遗留适配器模式、renderData 约定、错误排查、文件索引
3. **适配器实现计划**（v1）— 21 个待实现适配器分 5 个 Wave 的实现计划
4. **Wave 1 详细设计** — 英语系列 + 英语作文报告 7 个适配器的详细设计
5. **静测问题修复**、**个性回扫并发问题修复**、**senerna 文件过滤**、**templatemanager 更新**
6. **新模板 A4 支持**、**异步上传 PDF 异常处理优化**、**文件换行配置及只读内存模式**

**对话中学到的教训**：
- 适配器模式设计中，多 taskType 支持是常见的遗漏点（design review 发现的 P0 问题）
- release 分支与 master 差异较大，添加日志时需要针对 release 分支代码独立分析
- AI 可读的集成指南可以显著加速后续的 AI 辅助开发

### 工作线 D：Claude Code Harness 文章迭代

**做了什么**：对"Claude Code Harness: 自治开发循环"文章进行重构和增强。

关键改动：
- 添加 token 成本估算（~150K/$1.5, ~200K/$2）
- 添加"AI审AI的局限"章节（同模型盲点）
- 添加 v6.0 到演进历史
- 添加失败路径（回滚、迭代限制、REGRESS、状态重建）
- 添加工具架构（11 MCP tools + 5 Agents）
- 压缩附录从 100+ 行到简洁快速入门
- 添加 v2 精简版（~12K 字，从 ~22K 压缩）

## 3. 经验教训汇总

| 价值评级 | 类别 | 教训内容 | 可复用性 |
|----------|------|----------|----------|
| P0 | 系统设计 | AI agent 的状态管理不能信任 agent 自己，必须通过 checkpoint 强制校验 | 高 — 所有 AI 编排系统 |
| P0 | 平台集成 | 飞书 WebSocket 模式不支持交互式卡片回调，需要确认平台实际能力再设计 | 高 — 飞书/企微/钉钉集成 |
| P0 | 防御编程 | SQLite JSON.parse 必须有 try-catch，一条脏数据可以导致整个服务崩溃 | 高 — 所有 SQLite/JSON 场景 |
| P1 | 迭代限制 | 防止 AI 无限循环需要硬性迭代限制，不同阶段应有不同阈值 | 高 — auto-dev 及类似系统 |
| P1 | 状态恢复 | 生产级系统必须有状态重建能力，日志文件作为 single source of truth | 高 — 有状态系统设计 |
| P1 | 安全设计 | 文件浏览需要多层防护：路径穿越、symlink、白名单/黑名单 | 高 — 所有文件系统暴露场景 |
| P2 | 文档策略 | AI 可读的集成指南可以显著加速 AI 辅助开发 | 中 — 大型项目文档 |

## 4. Skill 提取建议

1. **平台能力预检 Skill** — 在设计集成方案时，自动检查目标平台（飞书/企微/钉钉）的实际 API 限制
2. **SQLite 安全编码检查 Skill** — 自动扫描代码中缺少 try-catch 的 JSON.parse 调用

## 5. 工作流深度分析

### 做得好的地方
- **auto-dev v6.0 升级**系统性地解决了健壮性问题：状态守卫、迭代限制、状态重建、阶段回退
- **agent-communication-mcp** 实现了完整的文件发送链路，从 MCP 工具到 Hub 到飞书 Bot，三端协调
- **WebUI 改进**覆盖了 8 个用户痛点，且包含了 3 个 P0 bug 修复
- **文章迭代**同时维护完整版和精简版，适应不同读者需求

### 反模式
- **gen-pdf 对话数过多**（21 个）：同一天在同一个项目开了大量会话，可能存在重复启动 auto-dev 流程的情况
- **飞书卡片回调限制**在实现后才发现：应该在设计阶段就验证平台能力

### 成熟度评估
- **auto-dev 框架**：从 v5 → v6 的关键跃迁，增加了生产级所需的健壮性机制
- **agent-communication-mcp**：从 MVP 向可用产品过渡，开始考虑安全和错误处理
- **gen-pdf 适配器设计**：从概念设计进入详细设计阶段

## 6. 真实踩坑时间线

| 时间 | 事件 | 影响 |
|------|------|------|
| 上午 | auto-dev 状态转换守卫 — 发现 agent 可以绕过 phase-enforcer 通过 state_update 跳阶段 | 需要添加 4 层守卫 |
| 上午 | 飞书 Bot 卡片回调不可用 — WebSocket 模式不支持 action callback | 从交互式卡片切换到文本命令 |
| 下午 | SQLite row mapper 缺少 try-catch — 一条脏数据导致服务崩溃 | 紧急修复所有 row mapper |
| 下午 | Permission MCP tool 被注释 — CLI runner 中有 TODO 注释掉了权限工具 | 重新启用 |
| 晚间 | gen-pdf 适配器 design review 发现 2 个 P0 — multi-taskType 支持缺失 | 需要修改设计文档 |
| 深夜 | 适配器实现计划和 Wave 1 设计文档编写完成 | 为后续实现铺路 |

## 7. 改进路线图

1. **短期** — auto-dev v6.0 在实际项目中验证迭代限制和 REGRESS 机制的有效性
2. **短期** — 为 agent-communication-mcp 的 WebUI 添加端到端测试
3. **中期** — 建立平台 API 能力矩阵，在设计阶段自动检查可行性
4. **长期** — 将 auto-dev 的 checkpoint/state 模式抽象为通用框架，可用于其他 AI 编排场景
