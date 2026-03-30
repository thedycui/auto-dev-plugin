# 2026-03-28 工作总结与工作流分析

> 生成时间: 2026-03-28
> 覆盖范围: 2026-03-27 14:00 ~ 2026-03-28 20:30
> 项目数: 4 | 会话数: 17 | 提交数: 8 | 代码变更: +19,867 / -157

---

## 一、工作产出总览

| 项目 | 工作量 | 关键词 |
|------|--------|--------|
| auto-dev-plugin | 3 commits, +4,843/-48, 30 files | tribunal 三级策略、bugfix 默认模式、稳定性修复 |
| agent-communication-mcp | 3 commits, +4,447/-91, 56 files | 飞书 7 bug 修复、Session Detail 重设计、批量 bugfix |
| metrics-frontend | 2 commits, +10,977, 41 files | E2E 测试用例设计 495 条、Playwright 代码 536 条 |
| job-tifenbao-gen-pdf | 0 commits（总结会话） | 日报生成、SLS 日志查询教学 |

### 工作线划分

本日工作可归纳为 **3 条工作线**：

1. **AI Agent 基础设施建设** — auto-dev tribunal 三级执行策略 + agent-communication-mcp Hub API 扩展 + 飞书通道可靠性
2. **质量保障体系** — metrics-frontend E2E 测试从用例设计到代码实现到执行调试的全流程
3. **能力扩展** — email-mcp 插件、`/search-log`、`/query-db`、`/email-briefing`、`/weekly-report` 五个新 Skill

---

## 二、主要工作内容详述

### 工作线 1: AI Agent 基础设施建设

#### 1.1 auto-dev tribunal 三级执行策略（最大单项交付）

**背景**: tribunal（代码审判机制）之前只有 CLI 子进程一种执行方式，存在参数过长崩溃、超时等稳定性问题。

**实现过程**:
- 先修复两个前置 bug：bugfix 类型默认走 quick mode（`338e0dc`）、digest > 8K 字符走文件模式 + 超时 3min→10min（`037e344`）
- 用户提出利用 agent-communication-mcp Hub 做跨 Agent 审查的想法
- 先去 Hub 侧新增 `GET /commands/:id` 和 `GET /agents?name=` 两个 API（`9f96cc6`）
- 回到 auto-dev-plugin，用 auto-dev 自身完成三级策略实现（`4693918`，+4,467/-18，30 文件）
- 策略：有 Hub 用 Hub → 没 Hub 默认走 Subagent → CLI 降为 opt-in
- auto-dev 全流程 Phase 1-7 一次走完，9/9 验收标准全部 PASS，465 测试通过

**经验**: auto-dev 用自己来开发自己（自举），验证了框架的成熟度。审查阶段拦截了 2 个 P0 + 5 个 P1 问题。

#### 1.2 飞书通道可靠性修复（12 个 bug）

**诊断过程出色**: 用户反映"飞书发消息收不到回复"，通过日志分析发现是 **5 层独立断点叠加**：
1. `sendPostMessage` 飞书 API 100% 返回 400（`style` 字段不被 IM API 支持）
2. 发送失败无 fallback，结果静默丢弃
3. `result.final` 只写 `session_events` 不写 `messages` 表
4. 飞书 SDK WSClient 静默断连，无监控
5. bot 重启后 session 状态丢失

修复后又处理了第二批 5 个 bug（通知缺失、session 未自动创建、双路由遗漏等）。

**审查机制的价值**: 3 次 auto-dev 流程共拦截 4 个 P0 安全/逻辑漏洞（路径遍历、双路由遗漏、WS 事件层级混淆、`git checkout` 安全风险）。

#### 1.3 Session Detail 页面重设计

实现了 Cursor/Windsurf 风格的 IDE 三栏布局（文件树 + 内容预览 + Git 操作），15/15 验收通过。部署后在浏览器端验证时遇到缓存、CSS 容器宽度、路由入口混淆等问题，花了较多时间排查。

### 工作线 2: 质量保障体系（metrics-frontend E2E）

#### 2.1 测试用例设计

3 个并行 Agent 阅读 PRD + 设计文档 + 源码，产出初版 297 条用例。用户三轮追问补充了近 200 条用例，最终覆盖 19 个模块、495 条编号（含数据权限、安全防护、Prompt 注入、Skill 端到端验证）。

**关键修正**: 初版遗漏了数据权限、安全攻防、核心 Skill 链路三大关键领域，用户追问后才补全。

#### 2.2 测试代码实现

7 个并行 Agent 分批编写 18 个 spec 文件，产出 536 条测试用例，9,543 行代码。TS 编译零错误。

#### 2.3 测试执行与调试

7 轮 run-fix-rerun 循环，主要在 auth setup 阶段：CAS 登录流程变更（新增 casnew 中间页）、token 异步竞争、API 地址错误等。会话结束时运行到 281/536（52%）。

### 工作线 3: 能力扩展

| 产出 | 说明 |
|------|------|
| email-mcp 插件 | 邮件收/发/搜/删，基于 nodemailer + imapflow |
| `/search-log` | SLS 日志查询（gc/huidu/fangliang/report 四环境） |
| `/query-db` | 生产数据库查询（5 实例，via cloud.eduisg.com API） |
| `/email-briefing` | 邮件简报 + iMessage 推送 |
| `/weekly-report` | 周报自动发送（飞书表格 → HTML 邮件） |

email-mcp 开发过程中遇到 **ESM/CJS 兼容性泥潭**（ImapFlow CJS + MCP SDK ESM），经历 6-7 轮方向转换后以子进程 worker 模式解决。

---

## 三、经验教训汇总

| 价值 | 类别 | 教训 | 可复用性 |
|------|------|------|----------|
| ★★★★★ | AI Agent | tribunal 频繁崩溃（3 个 auto-dev 流程共崩 5 次），文件模式 + 超时延长是必要的稳定性兜底 | CLAUDE.md |
| ★★★★★ | 工程效率 | 并行 Agent 分治是 E2E 测试代码生成的最佳策略：7 Agent 并行将 4-5 小时工作压缩到 45 分钟 | Skill |
| ★★★★★ | 代码质量 | auto-dev 审查机制真正有效 — 3 次流程拦截 4 个 P0 安全漏洞（路径遍历等），不是走形式 | 知识点 |
| ★★★★ | 平台集成 | ESM/CJS 兼容性：MCP Server (ESM) 与 CJS-only 依赖共存时，子进程隔离是唯一可靠方案 | Skill |
| ★★★★ | 工程效率 | Chromium 下载超时：直接用系统 Chrome (`channel: 'chrome'`) 绕过，不要反复重试下载 | CLAUDE.md |
| ★★★★ | AI Agent | 飞书问题诊断范式：从日志出发，逐层定位断点，5 层独立故障各有不同根因 | 工作习惯 |
| ★★★ | 构建 | MCP `/mcp` reconnect 不会重启进程 + 运行的可能不是你修改的入口文件，导致调试循环 | CLAUDE.md |
| ★★★ | 发版 | 前端部署验证链条过长（build→重启→清缓存→确认路由入口→CSS 检查），每个环节都可能出问题 | 工作习惯 |
| ★★★ | AI Agent | auto-dev 的 git diff 必须同时覆盖 committed + staged + untracked 三种文件来源 | CLAUDE.md |
| ★★ | 安全 | 用户追问暴露测试用例三大盲区（数据权限/安全攻防/Skill 链路），AI 初版容易遗漏安全类用例 | 知识点 |

---

## 四、Skill 提取建议

| 场景 | 工作流 | 预估 ROI |
|------|--------|----------|
| **E2E 测试批量生成** | PRD→用例文档→并行 Agent 分批生成 spec→编译验证→循环执行修复 | 高：每个新项目可节省 1-2 天 |
| **飞书/通道故障诊断** | 日志分析→断点定位→分层修复→auto-dev 批量实现 | 中：通道故障频发，标准化诊断流程有价值 |
| **MCP 插件开发** | 确认协议→处理 ESM/CJS→子进程隔离模式→集成测试 | 中：ESM/CJS 问题反复出现，模板化可减少踩坑 |

---

## 五、工作流深度分析

### 5.1 做得好的地方

1. **用户教学式交互**（SLS/query-db 会话）：用户手把手通过 Playwright 浏览器操作教 Claude 学习新技能，从零到可复用 Skill 的效率极高
2. **诊断先行**（飞书通道）：从日志出发系统化追踪到 5 层独立断点，每层根因不同，诊断逻辑清晰无遗漏
3. **auto-dev 自举**（tribunal 三级策略）：用 auto-dev 开发 auto-dev 的新功能，Phase 1-7 一次走完，验证了框架成熟度
4. **并行 Agent 最大化**：E2E 测试 7 Agent 并行、日报 3-4 Agent 并行、设计阶段 3 Agent 并行读文档，充分利用并发能力

### 5.2 反模式

| 现象 | 问题 | 最佳实践 | 改进建议 |
|------|------|----------|----------|
| ESM/CJS 兼容性 6-7 轮方向转换 | 每次只试一个方案，失败后换方向，无系统性排查 | 先理清依赖的模块格式，再选择兼容策略 | 建立 MCP 插件开发模板，内置 ESM/CJS 兼容方案 |
| Chromium 下载 4 次超时后才用系统 Chrome | 重复重试同一个失败操作 | 第 2 次失败就该切换策略 | 写入 CLAUDE.md：Playwright 下载失败时立即用 `channel: 'chrome'` |
| 前端部署后花 20+ 分钟排查缓存/路由问题 | 部署验证缺少检查清单 | 部署后按固定清单验证 | 部署 skill 增加前端验证步骤 |
| Tribunal 5 次崩溃全靠 fallback | Tribunal 稳定性不足 | 核心路径不应依赖 fallback | 已修复（文件模式 + 超时延长 + Hub 策略） |
| auth setup 5 轮修复 | 生成代码时未参考实际验证过的登录流程 | 会话 1 已用 Playwright MCP 验证过登录流程，信息应传递到代码生成 | 测试代码生成前先用 Playwright 实际走一遍关键流程 |

### 5.3 成熟度评估

| 维度 | 评分 | 说明 |
|------|------|------|
| 需求理解 | 9/10 | 用户三轮追问后覆盖全面，主动补充安全和权限维度 |
| 架构设计 | 8/10 | 三级执行策略设计合理，飞书诊断分层清晰 |
| 代码质量 | 8/10 | auto-dev 审查拦截 4 个 P0，TS 编译零错误 |
| 测试覆盖 | 7/10 | 536 条用例覆盖广，但 auth setup 实际验证不足 |
| 部署效率 | 5/10 | 前端部署验证链条过长，多次因缓存/路由排查耗时 |
| 故障诊断 | 9/10 | 飞书 5 层断点诊断堪称范例 |
| 并行利用 | 9/10 | 7 Agent 并行生成测试、4 Agent 并行分析会话 |
| 工具链掌握 | 7/10 | ESM/CJS 和 MCP 进程管理仍有知识盲区 |
| 自动化程度 | 8/10 | 5 个新 Skill 扩展了自动化边界 |
| 时间效率 | 6/10 | ESM/CJS 泥潭 + Chromium 重试 + auth 循环浪费约 2 小时 |

---

## 六、真实踩坑时间线

### 踩坑 1: ESM/CJS 兼容性泥潭（~90 分钟）

```
import ImapFlow (ESM)
  → 失败：CJS 包不支持 named import
  → 改 dynamic import()
  → 失败：timing 问题
  → 改 createRequire
  → 失败：模块解析路径不对
  → 改整个项目为 CJS
  → 失败：MCP SDK 是 ESM-only
  → 发现根因：StdioServerTransport 和 ImapFlow socket 资源冲突
  → 最终方案：子进程 worker 模式
```
**教训**: MCP Server 与 CJS 依赖共存时，子进程隔离是标准答案，应直接采用。

### 踩坑 2: Chromium 下载超时（~30 分钟）

```
npx playwright install chromium
  → 超时 (170MB, 2min timeout)
  → 重试 → 超时
  → 重试 → 超时
  → 重试 → 超时
  → 改用 channel: 'chrome' → 立即成功
```
**教训**: 第 2 次失败就该切换策略，不要机械重试。

### 踩坑 3: CAS 登录流程逐层修复（~40 分钟）

```
auth.setup.ts: waitForURL(/sso\.iflytek\.com/)
  → 超时：CAS 新增 casnew 中间页
  → 添加点击"讯飞域账号登录"
  → 超时：waitForURL 模式不匹配
  → 添加 casnew 等待逻辑
  → 失败：token 为 null
  → 改用 waitForFunction 轮询 localStorage
  → 失败：API 返回 HTML
  → API_BASE_URL 从 test.zhixue.com 改为 testgece.zhixue.com
  → 终于通过
```
**教训**: 生成 auth 代码前应先用 Playwright MCP 实际走一遍完整登录流程。

### 踩坑 4: MCP 进程管理盲区（~20 分钟）

```
修改 email-mcp 代码 → npm run build
  → /mcp reconnect → 行为没变
  → 再改代码 → 再 build → 再 reconnect → 还是没变
  → 发现 /mcp reconnect 不重启进程
  → kill 进程 → 发现运行的是 dist/index.js 而非 dist/server.cjs
  → 修正入口文件 → 终于生效
```
**教训**: `/mcp` reconnect ≠ 重启进程；修改后必须 kill 旧进程 + 确认实际运行的入口文件。

---

## 七、改进路线图

### Phase 1: 立即可做（习惯改变）

- [ ] CLAUDE.md 写入：Playwright 下载失败时立即用 `channel: 'chrome'`
- [ ] CLAUDE.md 写入：MCP 代码修改后必须 kill 旧进程再重连
- [ ] 重复失败 ≥ 2 次时切换策略，不要机械重试
- [ ] E2E auth 代码生成前先用 Playwright MCP 实际验证登录流程

### Phase 2: 短期投入（1-2 周）

- [ ] MCP 插件开发模板：内置 ESM/CJS 兼容方案（子进程 worker 模式）
- [ ] 前端部署验证检查清单：集成到 `/deploy` skill
- [ ] E2E 测试批量生成 Skill：标准化 PRD→用例→并行 Agent→spec 的流程
- [ ] auto-dev TODO.md 5 项改进：code-review 产出规范、审查闭环、TDD gate 可靠性

### Phase 3: 中期建设（1 个月）

- [ ] tribunal Hub 集成全面上线：验证跨 Agent 审查在真实场景的效果
- [ ] 通道故障诊断 Skill：标准化飞书/WebUI/MCP 通道的分层诊断流程
- [ ] auto-dev 全局经验教训系统：打通项目间的经验共享

---

## 附录: 今日全部 Git 提交

| 时间 | 项目 | 提交 | 描述 |
|------|------|------|------|
| 10:27 | agent-communication-mcp | `aa21b19` | fix: feishu channel reliability - 7 bugs fixed |
| 10:30 | metrics-frontend | `b770e6f` | docs: add E2E test cases document (297+ test cases) |
| 17:32 | metrics-frontend | `68fcbaf` | feat: add Playwright E2E test suite (536 test cases) |
| 18:07 | auto-dev-plugin | `338e0dc` | fix: bugfix changeType defaults to quick mode |
| 18:24 | auto-dev-plugin | `037e344` | fix: tribunal stability — file-based digest + 10min timeout |
| 18:46 | agent-communication-mcp | `9f96cc6` | feat(hub): add GET /commands/:id and agent filtering |
| 19:33 | agent-communication-mcp | `66be96a` | fix: batch bugfix - 5 issues across components |
| 20:19 | auto-dev-plugin | `4693918` | feat: tribunal 三级执行策略 Hub > Subagent > CLI |
