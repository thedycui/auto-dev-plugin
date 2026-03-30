# 2026-03-24 工作总结与工作流分析

## 1. 工作产出总览

| 指标 | 数值 |
|------|------|
| 涉及项目 | 5 个 |
| Claude Code 会话 | ~24 个 |
| Git 提交 | 12 个 |
| 估计改动行数 | ~5000 行 |

### 按项目分类的工作量

| 项目 | 会话数 | 提交数 | 主要工作 |
|------|--------|--------|----------|
| job-tifenbao-gen-pdf | 8 | 5 | Wave 1-5 全部 16 个适配器实现 + 文档定稿 |
| job-tfb-gen-school-book | 3 | 5 | AI 错因留痕功能修复、前端子模块更新 |
| agent-communication-mcp | 8 | 0 | MCP 配置排查、Agent 概念学习、TPD 画像查询、日报填写 |
| web-tifenbao-campus-report | 2 | 2 | 英语报告工具预览 404 修复 |
| local-scripts | 5 | 0 | 基础工具使用 |

## 2. 主要工作内容详述

### 工作线 A：job-tifenbao-gen-pdf 全部 16 个适配器实现（核心工作）

**做了什么**：在一天之内完成了渲染引擎重构项目中全部 16 个遗留适配器的实现，跨越 Wave 1 到 Wave 5，附带 226 个单元测试全部通过。

**Wave 1（7 个适配器，59 个测试）**：
- Wave 1A — 继承 AbstractEngWordRenderAdapter（4 个）：
  - EngWritingPracticeRenderAdapter（写作练习）
  - EngWritingGptRenderAdapter（GPT 写作）
  - EngComposeRenderAdapter（英语作文）
  - EngIstModuleRenderAdapter（IST 模块）
- Wave 1B — 继承 AbstractLegacyTaskAdapter（3 个）：
  - EngCompositionTeaRenderAdapter（英语作文教师报告）
  - EngCompositionStuRenderAdapter（英语作文学生报告）
  - EngCompositionPpytRenderAdapter（英语作文推送）

**Wave 2（4 个适配器，62 个测试）**：
- ReviseNewRenderAdapter（二轮复习，3 版本路由）
- ReviseRenderAdapter（二轮复习 IST，QR 码 + PDF 拼接）
- FirstReviseRenderAdapter（一轮复习，版块 JSON 深拷贝分解）
- FirstReviseComposeRenderAdapter（一轮复习组合，组合策略）

**Wave 3（3 个分层适配器，59 个测试）**：
- PersonalLayerRenderAdapter（个人推题中文）
- DailyLayerRenderAdapter（日日练）
- PersonalPhaseRenderAdapter（初中分层，IST 类型守卫 + isTer 参数）

**Wave 4-5（2 个适配器，46 个测试）**：
- EngPersonalLayerRenderAdapter（英语个人推题，3 路路由）
- SummerHWRenderAdapter（暑假作业 + PDF 合并）

**文档定稿**：
- 适配器实现计划升级为 v3（最终版），追加实际执行结果章节
- 16 个已实现适配器清单、5 个排除清单、226 个测试、与原计划差异、已知限制
- 4 份 Wave 设计文档标注已完成状态和测试数据

**taskTypes.js 前端配置更新**（13 个 taskType 翻转 hasAdapter: false -> true）

**对话中学到的教训**：
- 适配器实现的关键是先充分理解老 Handler 的完整逻辑，包括边界条件和非主路径
- 继承体系设计决定实现效率：Wave 1A 的 4 个适配器共享 AbstractEngWordRenderAdapter，实现速度比 Wave 1B 快得多
- 版块 JSON 深拷贝分解（FirstReviseRenderAdapter）和 QR 码 + PDF 拼接（ReviseRenderAdapter）是复杂度最高的两个适配器
- 测试先行（每波适配器都有完整测试套件）确保了实现质量

### 工作线 B：job-tfb-gen-school-book AI 错因留痕修复

**做了什么**：修复 AI 错因留痕功能的配置读取和数据填充问题，涉及多个服务层。

具体改动（5 个提交）：
1. **LeaveMarkConfigServiceImpl** — import 改为 ZX-tfbservice-api 的 HwUserConfigBizTypeEnum（含 TRACE_A_ERROR_REASON 枚举），补充配置查询和解析分支
2. **LeaveMarkConfigResp** — 补充 showErrorReason 字段
3. **StepCorrectReportService** — 新增 getEnglishStuStepCorrectInfo 接口（不依赖精批前置条件）
4. **StepCorrectReportServiceImpl** — 实现英语 AI 错因独立获取链路
5. **WowLeaveMarkHandler** — 英语作业额外调用 AI 错因获取并合并到步骤批改数据

关键设计决策：
- 英语 AI 错因独立获取链路不依赖精批前置条件，避免了原有链路的强耦合
- 使用枚举替代硬编码字符串，提升类型安全

**对话中学到的教训**：
- 教材批改系统中，英语和中文的错因分析逻辑差异很大，不能用同一套接口
- 配置枚举的 import 来源（本项目 vs tfbservice-api）需要明确，否则编译通过但运行时行为错误

### 工作线 C：web-tifenbao-campus-report 英语报告预览修复

**做了什么**：修复英语报告工具预览 iframe 的 404 问题。

根因分析：
- Preview iframe 使用相对路径加载 runtime-host.html
- 在 `/activitystudy/tfb/engReportToolWeb/` 子路径下，相对路径解析错误
- 测试环境静态文件从 origin 提供（test.zhixue.com），不是 CDN

修复方案（2 个提交）：
1. 添加 `RUNTIME_HOST_URL` 环境变量到 engReportToolWeb 配置
2. 测试/预发布/预生产环境使用相对路径 `./static/...`，生产环境保持绝对路径 `/static/...`

**对话中学到的教训**：
- 前端资源路径在多环境（CDN vs origin）下的行为差异是常见的部署坑
- iframe 内的相对路径解析基础 URL 与父页面不同，需要特别注意

### 工作线 D：agent-communication-mcp 环境调试与工具使用

**做了什么**：排查 MCP 配置问题，以及使用 TPD 平台进行人员画像查询等日常工作。

具体活动：
1. **MCP 配置排查** — agent-comm MCP 一直处于 connecting 状态，发现 `.mcp.json` 文件缺失
2. **TPD MCP 不可用** — tpd-mcp server 配置存在但工具未加载成功，检查 dist/index.js 存在且可启动
3. **Agent 概念学习** — 向同事解释 Agent 开发的核心概念（LLM + 工具调用 + 自主决策循环）
4. **日报填写** — 通过 Playwright 自动化尝试填写 TPD 日报，发现功能"系统升级中"不可用
5. **文件发送验证** — 验证飞书文件发送功能是否可用

**对话中学到的教训**：
- MCP server 的 connecting 状态问题通常是配置文件（.mcp.json）缺失或路径错误
- TPD 日报功能不可用时需要找其他入口
- 向非技术人员解释 AI Agent 概念时，"LLM + 工具 + 自主循环"的类比最有效

### 工作线 E：教材导入 bug 排查

**做了什么**：排查教材管理中批量导入时单元匹配错误的问题。

根因定位：
- `submitBatchImport` 方法中 `textbookTree.flatMap(item => item.children || [])` 把所有册别的单元扁平化
- 不同册别有相同名称的单元（如"Unit 1"），`find()` 总是返回第一个册别的单元
- 需要在匹配时同时考虑册别（父节点）信息

**对话中学到的教训**：
- `flatMap + find` 模式在有层级结构的数据中是经典的 bug 来源
- 批量导入的匹配逻辑必须考虑数据层级，不能简单扁平化

## 3. 经验教训汇总

| 价值评级 | 类别 | 教训内容 | 可复用性 |
|----------|------|----------|----------|
| P0 | 适配器模式 | 继承体系设计决定实现效率，共享基类的适配器实现速度远快于独立实现 | 高 — 所有适配器/策略模式场景 |
| P0 | 测试策略 | 每波适配器都有完整测试套件（59/62/59/46），累计 226 个测试保证了实现质量 | 高 — 大批量实现任务 |
| P1 | 层级数据 | flatMap + find 模式在有层级结构的数据中是经典 bug 来源 | 高 — 所有树形结构数据处理 |
| P1 | 多环境部署 | 前端资源路径在 CDN vs origin 部署模式下行为不同 | 高 — 所有前端多环境部署 |
| P1 | 枚举引用 | 配置枚举的 import 来源必须明确，本项目 vs 外部 API | 中 — Java 微服务开发 |
| P2 | MCP 排查 | MCP server connecting 状态问题通常是 .mcp.json 缺失或路径错误 | 中 — MCP 开发调试 |

## 4. Skill 提取建议

1. **适配器批量实现 Skill** — 给定老 Handler 列表和继承体系，自动生成适配器骨架 + 测试套件
2. **多环境资源路径检查 Skill** — 自动检测前端代码中可能在不同部署环境下行为不同的资源路径

## 5. 工作流深度分析

### 做得好的地方
- **适配器实现**：一天完成 16 个适配器 + 226 个测试，体现了 auto-dev 设计先行（Wave 设计文档）+ 批量实现的高效工作流
- **分层推进**：Wave 1 -> 2 -> 3 -> 4-5 逐波推进，每波完成后验证再进入下一波
- **问题排查**：campus-report 的 404 问题从根因分析到修复方案都很清晰
- **文档同步**：实现完成后立即更新适配器实现计划文档至最终版

### 反模式
- **MCP 配置问题**：agent-comm MCP 和 tpd-mcp 都出现配置/连接问题，说明 MCP server 的健康管理需要加强
- **TPD 日报不可用**：Playwright 自动化填写日报时才发现功能"系统升级中"，应该先用 API 检查功能可用性

### 成熟度评估
- **适配器实现**：非常高效 — 设计 -> 实现 -> 测试 -> 文档的全流程在一天内完成
- **日常运维**：发展中 — MCP 配置排查依赖手动检查，需要更好的自检工具
- **跨项目协作**：稳步推进 — 同时处理 gen-pdf、school-book、campus-report 三个项目

## 6. 真实踩坑时间线

| 时间 | 事件 | 影响 |
|------|------|------|
| 凌晨 | Wave 1 七个英语系列适配器实现完成 | 59 个测试通过 |
| 上午 | Wave 2 四个复习系列适配器实现完成 | 62 个测试通过 |
| 上午 | Wave 3 三个分层适配器实现完成 | 59 个测试通过 |
| 上午 | Wave 4-5 最后两个适配器实现完成 | 46 个测试通过，全部 16 个适配器完成 |
| 上午 | taskTypes.js 前端配置更新 | 13 个 taskType 翻转 |
| 上午 | 适配器文档定稿 | 实现计划升级为 v3 最终版 |
| 下午 | AI 错因留痕修复 — 配置枚举 import 来源错误 | 需要改为 tfbservice-api 的枚举 |
| 下午 | agent-comm MCP 连接失败 | .mcp.json 配置缺失 |
| 下午 | TPD MCP 工具未加载 | 配置存在但 server 未启动 |
| 晚间 | campus-report 英语报告预览 404 | runtime-host.html 路径解析错误 |

## 7. 改进路线图

1. **短期** — 为 MCP server 添加健康检查接口，在 Claude Code 启动时自动验证所有已配置的 MCP server
2. **短期** — 建立适配器实现的代码模板，加速后续类似重构任务
3. **中期** — 将 Wave 式批量实现模式抽象为 auto-dev 的可复用流程模板
4. **长期** — 为教材导入等批量操作添加数据一致性校验，防止层级数据扁平化导致的匹配错误
