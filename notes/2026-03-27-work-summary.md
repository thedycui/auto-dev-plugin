# 2026-03-27 工作总结与工作流分析

## 1. 工作产出总览

| 维度 | 数据 |
|------|------|
| 活跃项目数 | 5 个 |
| 会话数 | 约 55 个（大量 metrics-web 子会话） |
| 总提交数 | 35 个（去重后） |
| 总改动行数 | 约 39,167 行 |
| 工作时段 | 00:08 ~ 18:37 |

### 按项目分类的工作量表

| 项目 | 提交数 | 改动行数 | 主要工作 |
|------|--------|---------|---------|
| auto-dev-plugin | 18 | 5,552 | Phase 8 ship、状态管理统一、7 个 bug 修复、v9.0/v9.1.0 |
| local-scripts (agent-hub) | 2 | 20,701 | session-detail UI 重设计（Cursor 风格 IDE） |
| metrics-web | 10 | 2,786 | 数据权限模式管理、E2E bug 修复、Skill 自动更新 |
| metrics-frontend | 5 | 10,128 | 数据权限 UI、IP 白名单双层开关、安装流程优化 |

## 2. 主要工作内容详述

### 工作线一：auto-dev 插件 v9.0 稳定化

18 个 commit，从凌晨 00:08 到下午 17:47。核心是解决 v8.0 引入的一系列状态管理问题。

**Phase 8 Ship Integration（commit 7296086）：**
- 可选的交付验证阶段：git push -> build -> deploy -> verify 四步闭环
- shipRound 计数器防止无限循环
- CODE_BUG 类型的 verify 失败自动回滚到 Phase 3
- 41 个新测试

**状态管理统一（commit 1246c09）—— 当天最重要的架构变更：**
- 消除双写问题：orchestrator、tribunal、checkpoint、submit 各自独立写 state.json 导致竞态条件
- 新增 evaluateTribunal() 纯函数：运行 tribunal 但不写状态
- 所有 state.json 写入通过 sm.atomicUpdate() 单一通道
- computeNextTask 接管 tribunal 计数器管理和 ESCALATE_REGRESS 逻辑
- 354 个测试全部通过

**7 个关键 Bug 修复链（时间线）：**

1. **batch1 guard optimization（01:39）**：移除 LESSON_FEEDBACK_REQUIRED 检查（过于严格），Phase 7 自动清除；tribunal schema 拆分为 blocking issues（带 acRef）和 advisory，无 P0/P1 时自动 FAIL->PASS

2. **batch2 stepState persistence + ESCALATE auto-regress（07:28）**：atomicUpdate safeParse 剥离非 schema 字段导致 step/approachState 丢失；ESCALATE 不再死路，首次自动回归 Phase 3 带 tribunal 反馈

3. **designDoc parameter（07:44）**：init 接受可选 designDoc 参数，自动匹配 docs/design-*{topic}*.md

4. **test file regex 统一（08:32）**：4 处重复的测试文件正则统一到 tdd-gate.ts isTestFile()/isImplFile()

5. **orchestrator 忽略 skipE2e（09:16）**：step 序列仅从 mode 构建，不检查 skipE2e，导致 Phase 5 在 skipE2e=true 时仍执行

6. **tribunal PASS 不重置计数器（10:23）**：tribunalSubmits 递增但 PASS 时不归零；tribunal PASS 不同步 step state 导致 auto_dev_next 重复返回同一步；ESCALATE_REGRESS 不清 approachState

7. **ESCALATE_REGRESS 残留计数器（10:29）**：只重置触发 phase 的计数器，上游 phase 保持旧值，重新进入时立即再 ESCALATE

8. **overwrite 删除 designDoc + 丢 progress-log（10:44）**：designDoc 在 output 目录内时 overwrite 先删整个目录；overwrite 创建新 progress-log 丢失所有历史 CHECKPOINT

9. **Phase 7 不需要 tribunal（11:37）**：evaluateTribunal(7) 抛异常因为 phase 7 没有 tribunal checklist

10. **auto_dev_submit 与 orchestrator 双路径冲突（11:24）**：state.step 存在时 submit 仍走 legacy executeTribunal() 路径，造成双写

11. **tribunal digest 溢出 + pre-existing build failure（17:44）**：大 monorepo 的 digest 超 MCP token 限制；baseline build 也失败时不应 block

**设计文档跳过优化（commit 52eef3c）：**
- 已有的设计文档含 >=3 AC + 方案对比表时，跳过 Phase 1a architect 重写
- 节省约 13 分钟/session

**学到的教训：**
- 双写是状态管理的万恶之源：多个模块独立写同一个文件 = 必然的不一致。必须单写入点
- safeParse 剥离非 schema 字段是隐性 bug：extra fields 在 Zod parse 时被静默丢弃
- tribunal digest 的大小限制不可忽视：大 monorepo 的 diff 可能超过 40K 字符
- overwrite 场景的边界条件测试不够：设计文档在输出目录内这个 case 被遗漏

### 工作线二：agent-hub session-detail UI 重设计

2 个大 commit，共 20,701 行（主要来自前端组件重写）。

**Cursor 风格 IDE 重设计（commit e2631c1 + 9db6a03）：**
- session-detail.tsx 重写为 Cursor 风格 IDE，支持 Tab 切换（events / commands / files）
- file-tree.tsx：文件浏览器，点击预览，双击编辑
- file-preview-drawer.tsx：右侧抽屉，语法高亮 + Markdown 渲染 + 图片预览 + 下载
- file-editor.tsx：textarea + highlight.js 覆盖层，多 Tab，Cmd+S 保存
- git-output-panel.tsx：git status/diff/log/branch/pull/switch 按钮
- 后端新增：POST /fs/write、POST /fs/upload、POST /launchers/:name/git
- Launcher 新增：git_exec（白名单 + workDir 验证）和 file_write（realpath 防路径穿越）
- 安全：basename() 过滤上传文件名、realpath bypass 修复、Markdown XSS 过滤
- 37 个 E2E 测试 + 27 个单元测试，650 个总计通过

**学到的教训：**
- 前端文件编辑器的 textarea + 语法高亮叠加层方案简单有效
- realpath 规范化是防止路径穿越的关键，不能仅靠字符串匹配
- Markdown 渲染必须做 XSS 过滤，不能直接 v-html 注入

### 工作线三：metrics-web 数据权限与稳定性

10 个 commit，集中在数据权限和测试。

**用户数据权限模式管理（commit 25941ae）：**
- UNRESTRICTED（不限制）/ LOCAL（本地配置）/ EXTERNAL（外部系统）三种模式
- UserInfo DTO 和 User 实体新增 dataScopeMode 字段
- 管理员可在系统内手动配置用户数据权限，无需去外部系统
- 13 个单元测试 + 5 个集成测试

**E2E 测试 Bug 修复（commit 2f6bd49）：**
- BUG-1：API Key 认证时 dataScope 被重取 DB 覆盖 -> 直接用已计算的 Key+User 权限交集
- BUG-2/3：自删除/重复用户名校验异常被 Dubbo 包装为 RuntimeException -> Controller 层直接 catch
- BUG-4：AdminAuthInterceptor 响应格式不统一 -> 改为标准 {code, message, data}
- BUG-5：ApiKeyController 创建失败返回 500 -> 改为 400

**Skill 自动更新（commit 4c9b759）：**
- SKILL.md v1.1.1：Content-Type 加 charset=utf-8
- 修复 GBK 终端中文请求体 Jackson 报 Invalid UTF-8 byte 的 500 错误
- 客户端每次查询前静默检查版本，有新版自动下载

**SqlBuilder LIKE 模糊匹配（commit 715c20c）：**
- 新增 {"like": "%关键词%"} 格式
- 解决 "合肥一中" 搜不到 "合肥市第一中学" 的问题

**学到的教训：**
- Dubbo 跨 RPC 传递时异常被包装为 RuntimeException，Controller 层必须 catch RuntimeException 而非具体的 IllegalArgumentException
- GBK 终端发送中文请求体时 Jackson 默认按 UTF-8 解析会报 Invalid UTF-8 byte

### 工作线四：metrics-frontend 前端功能补齐

5 个 commit，10,128 行（主要是新组件和类型定义）。

**数据权限模式 UI（commit 8ef47f0）：**
- 用户列表新增 "数据权限" 列，显示模式标签
- 编辑对话框新增 "数据权限模式" 选择器
- LOCAL 模式下显示学校名称文本框
- UNRESTRICTED 时弹出二次确认提示

**API Key IP 白名单双层开关（commit 376bfa8）：**
- 全局 IP 限制开关（system_configs 集合）
- 单 Key 的 ipRestricted 字段
- 管理员 Tab 顶部全局开关卡片（含二次确认）
- 创建/编辑弹窗添加单 Key IP 限制开关

**Claude Code 安装 API Key 预配置（commit a957633）：**
- "获取 API Key" 步骤改为两平台共享
- 安装命令内嵌真实 API Key
- 删除独立的 "配置 API Key" 步骤

### 工作线五：技术文章写作与设计分析

- 分析 full-loop-automation-design-v2.md（全自动闭环开发测试方案设计）
- 分析 auto-dev 对标 AutoResearch 和 Anthropic 官方 harness design 文章
- 使用 agent-teams 分别深入 3 个核心启发方向

## 3. 经验教训汇总

| 价值评级 | 类别 | 教训内容 | 可复用性 |
|---------|------|---------|---------|
| S | 状态管理 | 双写是万恶之源：多模块独立写同一文件 = 必然不一致。单写入点是唯一解 | 极高 - 所有有状态的系统 |
| S | 状态管理 | safeParse 剥离非 schema 字段是隐性 bug：extra fields 被静默丢弃 | 高 - Zod/JSON Schema 用户 |
| A | AI 框架 | tribunal digest 大小限制不可忽视：大 monorepo diff 可能超 40K | 高 - AI 自动化框架 |
| A | 安全 | realpath 规范化是防路径穿越的关键，不能仅靠字符串匹配 | 高 - 文件操作相关 |
| A | 安全 | Markdown 渲染必须做 XSS 过滤 | 高 - 前端安全 |
| A | RPC | Dubbo 跨 RPC 异常被包装为 RuntimeException，Controller 层必须 catch 具体类型 | 高 - Dubbo 项目 |
| B | 编码 | GBK 终端中文请求体 Jackson 报 500，需加 charset=utf-8 | 中 - 中文环境 |
| B | 边界测试 | overwrite 场景的 designDoc 在输出目录内被遗漏 | 高 - 自动化框架 |
| C | 工具 | 测试文件正则 4 处重复 -> 统一到 tdd-gate.ts | 中 |

## 4. Skill 提取建议

1. **Dubbo 异常处理 Skill**：标准化的 Controller 层异常捕获模板，自动处理 RPC 异常包装
2. **文件上传安全 Skill**：basename 过滤 + realpath 防穿越 + XSS 过滤的标准化流程
3. **状态管理单写入点 Skill**：适用于所有有状态的 AI 框架，确保 atomicUpdate 不丢失 extra fields

## 5. 工作流深度分析

### 做得好的地方

- **状态管理统一是当天最有价值的架构决策**：从多模块独立写 state.json 到 sm.atomicUpdate() 单通道，彻底解决了竞态条件和数据不一致
- **Bug 修复链条化**：不是零散修复，而是按根因归类（状态管理类、边界条件类、大小限制类），一次性解决同根问题
- **metrics 系统权限模型**：三种模式（UNRESTRICTED/LOCAL/EXTERNAL）设计清晰，覆盖了管理员手动配置和外部系统对接两种场景
- **session-detail UI 重设计**：借鉴 Cursor 风格，一次性解决文件浏览、预览、编辑三大需求

### 反模式

- **agent-hub 20,701 行只有 2 个 commit**：前端重设计的改动量应该拆分为更多原子 commit
- **auto-dev 连续 3 天高强度开发**：从 v7.0 到 v9.1.0 的演进速度过快，稳定性验证不够充分
- **metrics-web 41% 的 commit 是修复**：前一天 41 个 commit 中很多是修复，说明初始实现质量不够

### 成熟度评估

- **auto-dev 插件**：v9.1.0 标志着从功能开发转向稳定性治理。Phase 8 ship 让 auto-dev 具备了完整闭环能力。状态管理统一是成熟的标志。成熟度 4.5/5
- **metrics 系统**：数据权限模型从安全漏洞（P0）到三种模式管理，进步显著。E2E 测试发现 5 个 Bug 说明质量意识提升。成熟度 3.5/5
- **agent-hub**：session-detail UI 达到了可用级别，但前端代码需要更多打磨。成熟度 3.5/5

## 6. 真实踩坑时间线

| 时间 | 坑 | 解决方案 |
|------|-----|---------|
| 01:39 | LESSON_FEEDBACK_REQUIRED 过严阻塞流程 | 移除 guard，Phase 7 自动清除 |
| 07:28 | safeParse 剥离 step/approachState | atomicUpdate 保留 extra fields |
| 08:32 | 4 处重复测试文件正则 | 统一到 tdd-gate.ts |
| 09:16 | skipE2e 被忽略 | 添加 phase filtering |
| 10:23 | tribunal PASS 不重置计数器 | PASS 时归零 + 同步 step state |
| 10:29 | ESCALATE 只重置触发 phase 的计数器 | 重置所有 phase 计数器 |
| 10:44 | overwrite 删 designDoc + 丢 progress-log | 保存到 tmp + 保留旧 checkpoint |
| 11:24 | auto_dev_submit 与 orchestrator 双路径 | state.step 存在时 submit 返回 DEPRECATED |
| 11:37 | Phase 7 调用 evaluateTribunal(7) 抛异常 | 跳过 tribunal，直接 checkpoint PASS |
| 16:42 | v9.0.0 版本号未同步到 plugin.json | plugin.json 单独 bump |
| 17:44 | tribunal digest 超 MCP token 限制 | 截断到 40K + diffStat 100 行 |

## 7. 改进路线图

1. **短期**：auto-dev 的 v9.x 需要至少一周的真实项目验证期，不再添加新功能，专注稳定性
2. **短期**：agent-hub session-detail 前端代码需要 code review 和重构，20K 行 2 个 commit 太粗糙
3. **中期**：将状态管理单写入点的经验抽象为通用模式，可以用在其他有状态的系统中
4. **中期**：metrics 系统的 E2E 测试需要持续运行，建立自动化测试 CI
5. **长期**：auto-dev 的 Phase 8 ship integration 需要与公司 DevOps 平台深度集成，形成真正的闭环
