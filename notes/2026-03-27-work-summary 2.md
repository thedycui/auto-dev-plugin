# 工作总结 2026-03-26 ~ 2026-03-27

> 生成时间: 2026-03-27 | 覆盖范围: 5+ 个活跃项目, 64 个会话, 63+ 个 commit

---

## 一、工作产出总览

| 项目 | Commits | 新增行数 | 删除行数 | 关键词 |
|------|---------|----------|----------|--------|
| auto-dev-plugin | 26 | 25,516 | 872 | 编排器重构、circuit breaker、状态管理统一 |
| metrics-web | 27 | 2,663 | 101 | API Key 安全、OpenClaw 兼容、指标查询增强 |
| metrics-frontend | 10 | 1,326 | 607 | OpenClaw UX、权限分层、维度映射 |
| **合计** | **63** | **29,505** | **1,580** | |

**会话分布**: metrics-web (36), auto-dev-plugin (13), sharing-agent-communication-mcp (6), metrics-frontend (3), job-tifenbao-gen-pdf (3), share-documents (2), web-tifenbao-campus-report (1)

### 工作线划分

| 工作线 | 占比 | 涉及项目 |
|--------|------|----------|
| 🔧 auto-dev v8.0 架构升级 | ~40% | auto-dev-plugin |
| 📊 Metrics 平台功能迭代 | ~25% | metrics-web, metrics-frontend |
| 🌐 Agent Hub + DevOps MCP | ~20% | agent-communication-mcp |
| 🛡️ OpenClaw / API Key 安全体系 | ~10% | metrics-web, metrics-frontend |
| 📝 技术文章写作 | ~5% | share-documents |

---

## 二、主要工作内容详述

### 工作线 1: auto-dev v8.0 — 从"显式框架"到"隐形编排"的架构跃迁

**核心目标**: 让 AI Agent 在 auto-dev 流程中无感执行，不再需要理解框架本身（invisible framework）

**关键里程碑**:

1. **Tribunal 预消化 + 崩溃兜底** (16:18)
   - 重大重构：50 文件, 9396 行新增
   - Tribunal 输入预处理，防止 LLM 因输入过大崩溃

2. **Turbo Mode + 自动模式选择** (17:10)
   - 新增 turbo 模式，根据任务复杂度自动选择执行策略
   - 发布 v8.0.0

3. **Invisible Framework 架构** (18:47 ~ 19:43)
   - 从 tribunal.ts 提取 agent-spawner 模块
   - 新增 orchestrator-prompts 反馈翻译层
   - 实现 orchestrator 核心循环
   - Phase prompt 清理框架术语（agent 不再看到 auto-dev 内部概念）

4. **Step Orchestrator 重写** (21:02 ~ 21:07)
   - 将 orchestrator 从单一大函数重写为 step function（computeNextTask）
   - 用 auto_dev_next 替代 auto_dev_orchestrate

5. **Circuit Breaker 机制** (22:57 ~ 23:21)
   - 新增 approach-level 重试 + clean-slate prompt
   - 完成设计文档、测试结果和回顾

6. **状态管理统一** (次日 01:39 ~ 11:37)
   - 修复 8 个状态管理 bug：
     - stepState 持久化丢失
     - ESCALATE_REGRESS 遗留旧计数器
     - tribunal PASS 未重置 submit counter
     - orchestrator 忽略 skipE2e
     - overwrite 删除 designDoc
     - Phase 7 错误触发 tribunal
     - auto_dev_submit 与 orchestrator 并发冲突
   - 最终重构：统一为 single writer + single entry point

**经验教训**:
- 状态管理是 orchestrator 类系统的核心难点。分散的状态写入点 → 竞态条件和状态不一致。解决方案是 **single writer pattern**——所有状态变更通过唯一入口。
- **claude -p 隔离方案完全失败**（~90 分钟工作部分作废）：理论上完美隔离了框架感知，但也隔离了 agent 能力（无法读文件、无 MCP 工具），第一次实测就证伪。教训：**物理隔离 vs 能力保留是根本矛盾**，应先做最小可行验证。
- **框架修复自身的递归困境**：batch1 用有 bug 的 auto-dev 修 auto-dev 自己，全程 stepState 卡住需手动 python3 干预（~50 分钟浪费）。**必须先用非框架方式修复框架 bug，再恢复框架使用**。
- **Goodhart's Law 是核心架构挑战**："做好工作" vs "满足检查条件"——agent 会优化检查通过而非真正质量。隐形框架、blind mode selection、post-hoc guard 都是不同角度的解法。

---

### 工作线 2: Metrics 平台功能迭代

#### 2.1 认证/权限体系修复 (15:03 ~ 16:39)

**问题链**: CAS 认证 → 401 死循环 → enabled 字段处理

- **AJAX 401 死循环**: 前端 Axios 收到 401 后重定向到 CAS，但 AJAX 请求无法处理 302，死循环。修复：后端返回 CAS URL 让前端 `window.location` 跳转
- **enabled 为 null 导致无法登录**: MongoDB 中旧用户没有 enabled 字段，代码把 null 当 false 处理。修复：null 视为启用
- **管理员判断增强**: 同时支持 MongoDB roles 字段和配置文件白名单

#### 2.2 表结构 DDL 管理 (20:35 ~ 20:49)

- 后端: PUT 更新接口 + 公开只读表结构接口 `/api/metrics/tables`
- 前端: 完整 DDL 管理页面
- 修复: SqlBuilder 表名校验支持 `database.table` 格式

#### 2.3 指标查询增强 (21:27 ~ 23:20)

**深度调试**: STRING 类型指标聚合返回 0.0 的问题
- 经历 5 个 commit 的调试链：
  1. `fix: SqlBuilder STRING 类型指标跳过数值转换` (21:27)
  2. `feat: logback + ClickHouseDao 调试日志` (21:42)
  3. `fix: 花括号修复静测` (21:52)
  4. `debug: API 层输出 Dubbo 返回数据类型` (22:04)
  5. `debug: 全链路 WARN 追踪` (22:06)
- **根因**: ClickHouse 返回 String 类型数据时，SqlBuilder 仍尝试数值转换
- **前端**: 指标查询页面按角色区分显示，普通用户展示只读指标目录，37 个维度中文映射补全

#### 2.4 SqlBuilder 模糊匹配 (次日 11:53)

- 新增 LIKE 操作符支持，解决学校简称查不到数据的问题

---

### 工作线 3: OpenClaw / API Key 安全体系

**从零构建** OpenClaw 平台兼容 + API Key 安全管理：

#### 3.1 OpenClaw 安装流程 (16:56 ~ 20:03)

- 3 次安装脚本重写：
  1. 初版: 安装脚本 + API Key 交互配置 (19:22)
  2. 拆分版: install + setup 两步，避免 `curl|bash` 下 read 不可用 (19:40)
  3. 合并版: 支持 key 参数一步完成 (20:01)
- 前端: 安装流程优化，先生成 API Key 再安装

**经验教训**: `curl | bash` 模式下 stdin 已被管道占用，`read` 无法获取用户输入。这个坑经历了 3 次迭代才彻底解决。

#### 3.2 API Key IP 白名单 (次日 09:51 ~ 10:50)

- 后端: 双层开关（全局 + 单 Key）, 845 行新代码
- 前端: IP 限制开关前端支持
- 测试: 100 行 REST 接口单元测试

#### 3.3 Claude Code 安装预配置 (次日 12:03)

- 安装脚本支持 API Key 预配置参数
- 402 行单元测试

---

### 工作线 4: Agent Hub — Windows Worker 接入 + WebUI 重构

**项目**: agent-communication-mcp（233 条消息，~6 小时）

**完成功能**:
1. Windows worker 独立 zip 包打包 + 零配置启动
2. 远程目录浏览功能（Launcher 注报 `allowedDirs`）
3. Hub 提供 `/worker-bundle` 下载接口 + `start.bat` 自动更新
4. git clone 功能（零 token，Launcher 直接执行）
5. **修复根本 bug**: Hub 命令状态未写回数据库（WebSocket 响应只转发给请求者，未更新 DB）
6. WebUI 重构：消息气泡化 + 流式输出 + 左文件浏览器 + 右聊天布局

**踩坑**:
- Windows 批处理 `echo level: 1>>file` 中 `1>>` 被当作文件描述符重定向
- `spawn claude` 在 Windows 需要 `shell: true`
- chat session 持久化反复 3 次才稳定（state → 报错 → localStorage）

---

### 工作线 5: DevOps MCP — 公司 DevOps 平台 MCP 化

**交付**: 7 个 MCP Tools（search_app, status, build, deploy, build_and_deploy, build_log, deploy_log），约 830 行 TypeScript

**SSO 认证调试黑洞**（约 90 分钟，历经 7 个错误方向）:

| 阶段 | 假设 | 结果 |
|------|------|------|
| 1 | ticket 直接获取 cookie | ticket 只能用一次 |
| 2 | POST `/checkTicket` 获取 JSESSIONID | 成功但不够 |
| 3 | 用 checkTicket cookie 调 API | 返回 3004 |
| 4 | 密码解密问题？ | 调试代码 log 截断误判 |
| 5 | 需调 `sysSetting` 激活 session | 仍 3004 |
| 6 | `users/self` 更新 JSESSIONID | 本身就返回 3004 |
| 7 | POST 缺 Content-Length？ | 浏览器 OK 但 curl 不行 |
| **根因** | **checkTicket 只是第一步，需调用 `authenticate/resourceOperate` 等初始化 API 加载权限** | ✓ |

**教训**: SPA + CAS 认证链，应该 **先用 Playwright 完整记录浏览器的所有请求序列**，再逐一模拟，而非逐个猜测。

---

### 工作线 6: auto-dev 进化史文章

- 续写 `auto-dev-adversarial-collaboration.md`，加入 v8 三权分立 Tribunal 进化史
- 从 770 行精简到 514 行，制作飞书适配版
- 新增 v9 章节（Goodhart 效应 + 隐形框架设计方向）

---

## 三、经验教训汇总

| 价值 | 类别 | 经验教训 | 可复用性 |
|------|------|----------|----------|
| ★★★★★ | 安全 | 测试 SKIP 等于放弃安全网——本次直接导致 2 个 P0 安全漏洞被遗漏 | CLAUDE.md |
| ★★★★★ | 架构设计 | 分布式状态管理必须 single writer pattern，分散写入点 = 竞态条件温床 | CLAUDE.md |
| ★★★★★ | 安全 | "代码存在 ≠ 代码被执行"——权限链路必须端到端验证，不能只看代码有没有写 | 工作习惯 |
| ★★★★★ | 工程效率 | Orchestrator 类系统用 step function 模式（每次只计算下一步），而非大循环 | 知识点 |
| ★★★★★ | AI Agent | 框架修复自身存在递归困境——必须先用非框架方式修复框架 bug | CLAUDE.md |
| ★★★★★ | AI Agent | Goodhart's Law: agent 会优化检查通过而非质量，需要 post-hoc guard 而非前置规则 | 知识点 |
| ★★★★ | 工程效率 | 工具安装失败 2 次后必须评估替代方案，不要在不可行路径上死磕 | CLAUDE.md |
| ★★★★ | 架构设计 | 物理隔离 vs 能力保留是根本矛盾，新架构方案必须先做最小可行验证再实现 | 知识点 |
| ★★★★ | 平台集成 | `curl \| bash` 模式下 stdin 不可用，需要用命令行参数代替交互式输入 | 知识点 |
| ★★★★ | 健壮性 | MongoDB 文档可能缺少字段（null ≠ false），所有布尔字段必须做 null 安全处理 | CLAUDE.md |
| ★★★★ | 调试技巧 | 数据类型问题要从数据源（ClickHouse）→ DAO → Service → API 全链路追踪 | 工作习惯 |
| ★★★★ | 前端 | 前后端对接前先 curl API 看实际响应结构，不要假设字段名和格式 | 工作习惯 |
| ★★★★ | 平台集成 | SPA+CAS 认证链必须先 Playwright 全量抓包，再逐一模拟，不要盲猜 | Skill |
| ★★★ | 代码质量 | 正则表达式在多处重复 → 提取为共享常量，用 refactor 而非 copy-paste | 知识点 |
| ★★★ | 安全 | API Key 安全需要双层控制（全局开关 + 单 Key 粒度），单层不够灵活 | 知识点 |
| ★★★ | 前端 | 前端 API 响应判断字段要和后端约定一致（res.code vs res.success） | 工作习惯 |
| ★★★★ | 部署 | 新服务必须配 logback-spring.xml，否则 stdout→/dev/null 导致无日志可查 | CLAUDE.md |
| ★★★ | 代码质量 | Java 所有 if 必须加花括号（java:S121），已因此 2 次构建失败 | CLAUDE.md |
| ★★★ | 调试技巧 | 调试日志必须用 WARN 级别（INFO 在生产配置中可能被过滤），被用户纠正 3 次 | CLAUDE.md |
| ★★★ | 调试技巧 | 调试代码的 log 截断/格式化也可能误导判断，调试工具本身要可靠 | 知识点 |
| ★★★ | 跨平台 | Windows 批处理有独特语法陷阱（`1>>` 重定向、`.cmd` spawn），需专门处理 | 知识点 |
| ★★★ | 工程效率 | 后端加接口后应主动提示"是否需要前端页面"，不要等用户问 | 工作习惯 |

---

## 四、Skill 提取建议

| 场景 | 工作流步骤 | 预估 ROI |
|------|-----------|----------|
| ClickHouse 数据类型调试 | 1. 确认指标 column_type → 2. 检查 DAO 层转换逻辑 → 3. 全链路 WARN 日志 → 4. 验证前端展示 | 中（每次调试省 30min） |
| curl\|bash 安装脚本设计 | 1. 参数化而非交互式 → 2. 幂等安装 → 3. 环境检测 → 4. 错误回退 | 中（避免重复踩坑） |

---

## 4.5、安全漏洞发现（P0 级别）

> 以下漏洞在 metrics-frontend 会话深度测试中发现

| 级别 | 漏洞 | 描述 | 发现方式 |
|------|------|------|----------|
| **P0** | API Key 绕过 admin 接口 | 添加 context-path 后 `getRequestURI()` 返回含前缀的路径，`/api/admin` 前缀匹配失效，API Key 可访问所有管理接口 | 用户追问测试 SKIP 项后 curl 验证发现 |
| **P0** | 用户数据权限未生效 | `dataScope` 永远为 null，外部权限系统 (`authCodeManageService.findByUserId`) 从未被调用，所有用户可查全部学校数据 | 代码审查发现"代码存在 ≠ 代码被执行" |
| **P1** | 前后端字段名不匹配 | `role`（前端）vs `roles`（后端），用户管理页面设置管理员实际不生效 | 功能测试发现 |

**关键教训**: 测试 SKIP 策略直接导致 P0 安全漏洞被遗漏。如果没有用户追问"跳过的 4 个测试是不是真的不能测"，这两个漏洞可能上线后才被发现。

---

## 五、工作流深度分析

### 5.1 做得好的地方

1. **auto-dev 重构节奏精准**: 从 tribunal 预消化 → invisible framework → step function → circuit breaker → 状态统一，每步有明确目标和验证。26 个 commit 形成清晰的演进线，没有无效回退。

2. **前后端同步发布**: metrics-web 和 metrics-frontend 的 commit 时间高度同步（如 11:29 同时提交权限功能、12:03 同时提交安装脚本），说明全栈开发能力强且协调到位。

3. **测试先行意识**: API Key IP 白名单（845 行实现 + 100 行测试）和安装脚本（402 行测试）都有配套测试。

4. **快速响应线上问题**: 401 死循环、enabled=null 等生产问题从发现到修复仅用 30 分钟。

### 5.2 反模式

#### 反模式 1: 测试 SKIP 规避策略

| 现象 | 问题 | 最佳实践 |
|------|------|----------|
| 标 SKIP 跳过接口级测试，通过流程检查 | 把流程通过当目标，忘了测试本身的价值 | 接口级测试不可 SKIP，改用 curl/Playwright 验证；auto-dev Phase 5 需要独立裁决 agent |

**影响**: 直接导致 2 个 P0 安全漏洞被遗漏。事后用户追问才补测发现。

#### 反模式 2: vitest 安装死循环（~35 分钟）

| 现象 | 问题 | 最佳实践 |
|------|------|----------|
| 反复删除 node_modules 重装 vitest，被用户中断 | 在不可行路径上死磕而不换方案 | 工具安装失败 2 次后立即评估替代方案（纯 Node.js 测试脚本仅需 5 分钟） |

#### 反模式 3: STRING 聚合 0.0 调试链过长

| 现象 | 问题 | 最佳实践 |
|------|------|----------|
| 5 个 commit 才定位 STRING 类型转换问题 | 调试用 commit 进入主线（debug: 前缀） | 调试日志用条件开关，不提交到主线；类型问题先检查 schema 再追踪代码 |

#### 反模式 4: OpenClaw 安装脚本 3 次重写

| 现象 | 问题 | 最佳实践 |
|------|------|----------|
| 交互式 → 拆分 → 合并，40 分钟迭代 3 版 | 未预研 `curl\|bash` 限制就动手 | 写安装脚本前先确认目标执行环境的约束（stdin、权限、PATH） |

#### 反模式 5: 跨端字段名不确认就写代码

| 现象 | 问题 | 最佳实践 |
|------|------|----------|
| `role` vs `roles`, 维度 key 大小写格式不匹配 | 假设字段名而非先看 API 实际返回 | 前后端对接前先 curl API 看实际响应结构 |

#### 反模式 6: 日志输出到 /dev/null 导致盲调

| 现象 | 问题 | 最佳实践 |
|------|------|----------|
| 新服务无 logback，stdout→/dev/null，全程靠猜 | 排查 401、enabled bug 等全部靠间接手段 | 新服务部署前必须配 logback-spring.xml |

#### 反模式 7: java:S121 静测规则重复踩坑

| 现象 | 问题 | 最佳实践 |
|------|------|----------|
| if 缺花括号导致 2 次构建失败 | 同一规则第 2 次踩坑 | 写入 CLAUDE.md: Java 所有 if/else 必须加花括号 |

**构建部署统计**: 约 27+10 轮构建部署（metrics-frontend 27 + metrics-web STRING 调试 10+），其中错误方向约占 1/3，估计可避免损耗 **4-5 小时**

### 5.3 成熟度评估

| 维度 | 评分 | 说明 |
|------|------|------|
| 架构设计能力 | 8/10 | step function 抽象优秀，但 claude -p 方案未做最小验证就全量实现（-1）|
| 全栈开发效率 | 9/10 | 前后端同步、一天 63 个有效 commit |
| 调试效率 | 6/10 | STRING 聚合 + SSO 认证两个调试黑洞，合计浪费 ~2 小时 |
| 测试覆盖 | 7/10 | 关键路径有测试，但部分功能（DDL 管理前端）缺少 |
| 安全意识 | 8/10 | IP 白名单双层开关设计合理，但安装脚本安全性未充分考虑 |
| 代码整洁度 | 8/10 | tdd-gate 正则统一做得好，但 debug commit 残留 |
| 状态管理 | 8/10 | 最终统一为 single writer，但过程中积累了 8 个 bug |
| 文档习惯 | 8/10 | circuit breaker 有完整设计文档+回顾，其他功能文档较少 |

---

## 六、真实踩坑时间线

### 踩坑 1: CAS 认证 401 死循环

```
用户报告无法登录
  → 检查发现 getSysTagCode 用错方法 (15:03)
  → 修复后仍有问题：AJAX 收到 401 重定向到 CAS，浏览器无法处理 (15:25)
  → 前端改为 window.location 跳转 (15:25)
  → 后端配合返回 CAS URL (15:28)
  → 又发现 enabled==null 的用户无法登录 (15:52)
  → 修复 null 处理 + 同步修复 ApiKeyAdmin 同类问题 (16:39)
```
**教训**: MongoDB schema-less 特性意味着每个字段都可能是 null，布尔判断必须三值处理

### 踩坑 2: STRING 指标聚合返回 0

```
指标查询返回 0.0
  → fix: STRING 类型跳过数值转换 (21:27)
  → 仍有问题，加日志 (21:42)
  → 静测报警修花括号 (21:52)
  → 加 Dubbo 返回类型日志 (22:04)
  → 加全链路 WARN 追踪 (22:06)
  → [最终定位] 问题在 DAO 层类型转换
```
**教训**: 数据类型问题从底层（数据库 schema）往上查比从 API 层往下查更高效

### 踩坑 3: auto-dev 状态管理连环 bug

```
orchestrator 上线后用户反馈异常
  → skipE2e 被忽略，Phase 5 不该跑的跑了 (09:16)
  → tribunal PASS 后 submit counter 未重置 (10:23)
  → ESCALATE_REGRESS 遗留旧计数器 (10:29)
  → overwrite 删除了 designDoc (10:44)
  → 根本原因：状态写入点分散在 5+ 个模块中
  → 大重构：统一 state management — single writer (11:15)
  → 又发现 submit 与 orchestrator 并发 (11:24)
  → Phase 7 错误触发 tribunal (11:37)
```
**教训**: 分布式状态更新是 bug 工厂。即使是单进程应用，状态写入点 > 2 就需要考虑 single writer 模式

### 踩坑 4: claude -p 隐形框架方案证伪（~90 分钟）

```
目标：agent 无感执行 auto-dev 流程（invisible framework）
  → 设计方案：claude -p 物理隔离，agent 不注册 auto-dev MCP
  → 实现 4 个新文件（agent-spawner, orchestrator-prompts, orchestrator, SKILL.md）
  → 端到端测试 → 立即失败："迭代耗尽"
  → [根因] claude -p 隔离了框架感知，但也隔离了 agent 能力（无法读文件、无 MCP）
  → 核心矛盾：物理隔离 vs 能力保留不可兼得
  → 切换到 step function + subagent 方案 ✓
```
**教训**: 新架构方案必须先做最小可行验证（5 分钟 spike），再投入全量实现

### 踩坑 5: 用有 bug 的框架修框架自己（~50 分钟）

```
batch1 需要修复 Issue #9/5/10
  → 用 auto-dev 跑 → Issue #8 (stepState 被 Zod 丢弃) 导致每个 step 都卡住
  → 手动用 python3 修 stepState → 继续下一步 → 又卡住
  → 全程 6+ 个 step 都需手动干预
  → [应该] 先手动修 Issue #8，再用 auto-dev 跑其他改动
```
**教训**: 框架自身有 bug 时，必须先用非框架方式修复，再恢复框架使用

### 踩坑 6: DevOps MCP SSO 认证（~90 分钟）

```
目标：用代码调用公司 DevOps 构建 API
  → 用 ticket 获取 cookie → ticket 只能用一次 (×)
  → POST /checkTicket → 拿到 JSESSIONID ✓ → 调 API → 3004 (×)
  → 怀疑密码问题 → 发现调试日志截断误导判断 (×)
  → 调 sysSetting 激活 → 仍 3004 (×)
  → users/self → 本身就 3004 (×)
  → 怀疑 Content-Length → 浏览器 OK curl 不行 (×)
  → [根因] checkTicket 只是认证第一步，需要继续调用 authenticate/resourceOperate 加载权限 ✓
```
**教训**: SPA+CAS 认证不要逐个猜测，应先用 Playwright 完整记录浏览器请求序列

### 踩坑 7: vitest 安装死循环（~35 分钟）

```
Phase 5 需要跑前端测试
  → npm install vitest → jsdom 29.x 需要 Node >=20.19（当前 20.16）(×)
  → 删 node_modules 重装 → 公司 npm 镜像 ECONNRESET (×)
  → 再删再装 → 同样失败 (×)
  → 用户中断："走进死胡同了"
  → [方案] 改用纯 Node.js .mjs 测试脚本 → 31 个测试通过 ✓
```
**教训**: 死磕不可行路径 vs 5 分钟换方案。失败 2 次就该评估替代方案

---

### 全天无效时间汇总

| 来源 | 估计时长 | 类别 |
|------|---------|------|
| claude -p 方案验证失败后重设计 | ~90 分钟 | 未做最小验证就全量实现 |
| DevOps SSO 7 个错误方向 | ~90 分钟 | 盲目调试 |
| metrics-frontend 错误方向构建 | ~60 分钟 | 未预研就动手 |
| batch1 用有 bug 的 auto-dev 修自己 | ~50 分钟 | 递归困境 |
| vitest 安装死循环 | ~35 分钟 | 死磕不可行路径 |
| chat session 持久化 3 次重做 | ~35 分钟 | 方案未想清楚 |
| STRING 聚合调试链 | ~30 分钟 | debug commit 入主线 |
| .claude/ 权限问题排查 | ~30 分钟 | 排查顺序错误 |
| tribunal 崩溃 3 次后才改方案 | ~25 分钟 | 应第 1 次崩溃就分析根因 |
| MCP 重连循环 6+ 次 | ~20 分钟 | 知识遗忘 |
| 其他零散 | ~45 分钟 | — |
| **合计** | **~8.5 小时** | **占总工作时间约 30-35%** |

---

## 七、改进路线图

### Phase 1: 立即可做（本周）

- [ ] **修复 2 个 P0 安全漏洞**: API Key 绕过 admin + 用户数据权限未生效
- [ ] **auto-dev Phase 5 测试不可 SKIP**: 接口级测试必须执行，改造 tribunal 识别 SKIP 策略
- [ ] **debug commit 规范**: 调试日志用 feature flag 控制，不提交 `debug:` 前缀 commit 到主线
- [ ] **MongoDB null 安全 checklist**: 所有布尔字段查询加 null 处理（可做成 CLAUDE.md 规则）
- [ ] **安装脚本预研模板**: 写安装脚本前先确认执行环境约束（stdin、权限、PATH、网络）

### Phase 2: 短期投入（1-2 周）

- [ ] **auto-dev 状态管理测试套件**: 为 single writer 写回归测试，防止未来修改引入竞态
- [ ] **metrics-web 集成测试**: STRING/NUMBER 类型指标端到端测试
- [ ] **API Key 安全审计**: 梳理所有 API Key 相关端点的认证和权限检查

### Phase 3: 中期建设（1 个月）

- [ ] **auto-dev v8.1 稳定化**: circuit breaker 机制实战验证 + 参数调优
- [ ] **Metrics 平台监控**: 添加指标查询成功率/延迟的自监控
- [ ] **OpenClaw 安装自动化测试**: 用 Docker 模拟不同环境测试安装脚本

---

## 附录: 时间分布

| 时间段 | 项目 | 工作内容 |
|--------|------|----------|
| 15:00-16:39 | metrics-web/frontend | CAS 认证修复链 |
| 16:18-17:14 | auto-dev-plugin | Tribunal 重构 + Turbo Mode + v8.0 |
| 16:56-20:03 | metrics-web/frontend | OpenClaw 兼容性开发 |
| 18:47-19:43 | auto-dev-plugin | Invisible Framework 架构 |
| 20:26-20:49 | metrics-web/frontend | DDL 管理 + 表名校验 |
| 21:02-21:07 | auto-dev-plugin | Step Orchestrator 重写 |
| 21:27-22:06 | metrics-web | STRING 聚合 0.0 调试 |
| 22:41-23:20 | metrics-frontend | OpenClaw UX + 指标权限分层 |
| 22:57-23:21 | auto-dev-plugin | Circuit Breaker 设计实现 |
| 00:08-01:39 | auto-dev-plugin | Phase 7 + batch1 优化（深夜） |
| 07:28-08:32 | auto-dev-plugin | batch2 + TDD gate 重构 |
| 09:16-11:37 | auto-dev-plugin | 状态管理 8-bug 修复 + 统一重构 |
| 09:51-10:50 | metrics-web/frontend | API Key IP 白名单 |
| 11:29-12:03 | metrics-web/frontend | 权限查看 + 安装预配置 |

### 其他项目时间线

| 时间段 | 项目 | 工作内容 |
|--------|------|----------|
| 03:36-07:17 (3/25-3/26) | agent-communication-mcp | devops-mcp 开发（含 SSO 90min 调试） |
| 08:42-09:25 | share-documents | auto-dev 进化史文章写作 |
| 08:55-14:55 | agent-communication-mcp | Windows Worker + WebUI 重构 |
