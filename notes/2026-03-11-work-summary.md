# 2026-03-11 工作总结与工作流分析

## 1. 工作产出总览

- **涉及项目数**: 3 个（server-diagnose-skill、gen-pdf、share-documents）
- **会话数**: 13 个
- **Git 提交数**: 0（本日无 git 提交）
- **改动行数**: 0（代码改动未提交）

### 按项目分类的工作量表

| 项目 | 会话数 | 主要工作 |
|------|--------|----------|
| server-diagnose-skill | 3 | 远程日志诊断（tfb-manage-service）、安装脚本修复 |
| gen-pdf (tifenbao) | 2 | git 分支管理、templatemanager 编译部署 |
| share-documents | 8 | --print 模式文章多轮优化和审稿 |

## 2. 主要工作内容详述

### 工作线一：生产环境问题诊断 — tfb-manage-service（高价值产出）

使用 log-diagnostic skill 对 tfb-manage-service 进行了完整的远程诊断：

1. **诊断过程**：
   - 连接跳板机 web01 (10.215.0.10)
   - 检查 web05、web06 两节点进程状态（均 ALIVE）
   - 分析日志错误（web05: 0 errors, web06: 8 errors）
   - 版本信息确认（两节点 WAR 部署时间一致：09:31-09:32）

2. **TemplateRegistryService 问题定位**：
   - 确认服务通过 Dubbo consumer 引用，注册中心为阿里云 MSE ZK
   - 追踪到 provider 为 tfbservice-service 进程
   - 检查 registry cache，发现 `empty://` 状态（configurators 类别正常）
   - 最终定位根因：**阿里云 MSE ZooKeeper (`mse-a99fa572-zk.mse.aliyuncs.com:2181`) 从 web05/web06 均无法建立 TCP 连接（超时）**
   - 进一步排查发现 IDC ZK (`10.215.0.199:2181`) 也不可达

3. **根因结论**：ZooKeeper 集群全部不可达，影响链为 tfbservice-service (provider) -> ZK 注册失败 -> tfb-manage-service (consumer) -> TemplateRegistryService 调用失败

**教训**：微服务注册中心连通性是第一排查点。即使 provider 进程存活，注册中心不可达也会导致服务调用失败。

### 工作线二：server-diagnose-skill 安装脚本修复

修复了 `install.sh --global` 安装过程中的路径问题：

1. **问题**：`install.py` 使用相对路径 `mcp-servers/ssh-server/.venv/bin/pip`，当从非项目根目录执行 install.sh 时，`subprocess.run` 无法找到 pip
2. **修复**：在 `install.py` 中对 pip_path 调用 `.resolve()` 转为绝对路径
3. **额外修复**：在 `install.sh` 中增加 `cd "$(dirname "$0")"` 确保工作目录正确
4. **验证**：dry-run 安装测试通过

**教训**：Python 的 `subprocess.run(executable=...)` 使用相对路径时，解析基于父进程的 cwd，不是子进程的 cwd。始终用 `.resolve()` 转绝对路径。

### 工作线三：--print 模式分享文章多轮优化（大规模产出）

对 `2026-03-09-claude-print-mode-guide.md` 进行了密集的多轮迭代优化，涉及 8 个独立会话：

**会话1（96964276）- 文章评价与结构调整**：
- 从研发和测试视角评价文档价值
- 调整章节顺序：坑点提前到社区案例之前（阅读节奏变为"实践 -> 避坑 -> 更多案例"）
- 删除"三个层次的自动化"冗余部分
- 压缩第6节（愿景），删除未验证的 ROI 估算

**会话2（a4e310b9）- PDF 文档翻译**：
- 将英文 PDF "The Complete Guide to Building Skills for Claude" 翻译成中文总结文档

**会话3（10859fa4）- agent-teams 多视角审稿**：
- 使用 agent-teams 创建 5 个专业 agent 并行审稿（tech-reviewer、ux-reviewer、practitioner-reviewer、educator-reviewer、community-reviewer）
- 收到 5 份详细审稿报告，发现 P0 级问题并修复

**会话4（11f1722b）- 内容深度优化**：
- 在愿景部分加入远程日志诊断能力
- 增加阅读前提示，降低非研发人员阅读门槛
- 每段代码增加简明解释
- 前景展望部分精简代码，只保留工具作用说明
- 删除"相关文件"部分
- 常用 Flag 组合速查移到附录
- 修正 stdin/stdout 比喻（最终去掉比喻，直接表述）
- "钉钉/企业微信/Slack" 改为 "i讯飞"

**会话5（b2b1b54a）- 标题和简介优化**：
- 生成多个一句话简介备选
- 最终风格：实战味重，口语化，不端着

**会话6（a3b7467b）- 风格统一性检查**：
- 与前三篇文章对比风格一致性
- 发现缺少真实对话案例、缺少个人经历叙事
- 将文章定位调整为"价值发现分享"（而非"经验分享"）
- 增加坦白说明：自己用得不多但认为有价值

**会话7（caed5f76）- 产研测视角再评价**：
- 从产品经理、研发、测试三个角色评价修改后的文档
- 删除"实际效果"部分
- 标题优化为强调"被低估"角度
- 发现 `--max-turns` 参数不存在于官方文档，替换为 `--max-budget-usd`

**会话8（fb3cc1e1）- agent-teams 研发视角审稿**：
- 使用 agent-teams 创建 3 个专业 agent（架构师、后端研发、DevOps）审稿
- 生成综合评价报告
- 根据报告修复问题
- 增加第4节末尾"坑5：生产环境的额外考量"

**教训汇总**：
- 文章需要多轮迭代才能达到可分享质量，单次生成通常不够
- 多视角审稿（使用 agent-teams）是高效的质量提升手段
- 事实准确性需要逐一验证，AI 可能编造不存在的参数（如 `--max-turns`）

### 工作线四：gen-pdf 分支管理和编译部署

1. **分支管理**：
   - 帮助找回遗忘的渲染重构分支（实际是在 templatemanager 的 master 分支上工作）
   - 创建 `feature/template-studio-render-refactor` 分支，推送 15 个渲染重构 commit
   - 将 master reset 回 `origin/master` 保持干净

2. **编译部署排查**：
   - 前端预览 404 错误（`runtime-host.html` 路径问题）
   - 编译 templatemanager 需要 `nvm use 14`（Node 14 环境）
   - web-tifenbao-campus-report 编译打包覆盖 dist 目录问题
   - 静态资源引用路径不一致问题

**教训**：在 master 分支上直接工作是高风险行为，应该始终在 feature 分支开发。git reflog 是找回遗忘分支的有效工具。

## 3. 经验教训汇总

| 价值评级 | 类别 | 教训内容 | 可复用性 |
|----------|------|----------|----------|
| P0 | 运维诊断 | 微服务调用失败时，优先排查注册中心（ZK/Nacos）连通性，而非 provider 进程状态 | 高 |
| P0 | 编码规范 | Python subprocess.run 使用相对路径会基于父进程 cwd 解析，必须用 .resolve() 转绝对路径 | 高 |
| P0 | 内容创作 | AI 可能编造不存在的参数（如 --max-turns），技术文章中的每个参数都必须验证 | 高 |
| P1 | Git 管理 | 在 master 上直接工作是高风险行为，用 git reflog 找回遗忘的 commit | 高 |
| P1 | 工作流 | 多视角审稿（agent-teams）是文章质量提升的高效手段，一次可获得 3-5 个不同角度的反馈 | 高 |
| P1 | 内容创作 | 文章定位要诚实（"价值发现分享" vs "经验分享"），坦白说明自己用得不多反而增加可信度 | 中 |
| P2 | 工具使用 | Shell 脚本中始终加 `cd "$(dirname "$0")"` 确保工作目录正确 | 高 |
| P2 | 编译部署 | Node 版本依赖要文档化（如 nvm use 14），不同项目可能依赖不同版本 | 中 |
| P3 | 内容创作 | stdin/stdout 等技术术语不要加比喻，直接表述更清晰 | 低 |

## 4. Skill 提取建议

1. **微服务注册中心连通性诊断**：当 Dubbo/Spring Cloud 服务调用失败时，自动检查注册中心连通性的标准流程
2. **Python 安装脚本路径安全**：在 install.py 中自动检测并修复相对路径问题的模板

## 5. 工作流深度分析

### 做得好的地方

- **诊断效率**：log-diagnostic skill 显著提升了远程诊断效率，从连接到定位根因的完整流程非常流畅
- **文章迭代**：8 个会话的密集迭代，每个会话聚焦一个改进方向，避免了"一次改太多"的问题
- **多视角审稿**：利用 agent-teams 能力获得架构师、后端、DevOps、UX、教育等多个专业视角的反馈
- **Git 管理规范**：发现 master 分支上的 commit 后，及时创建 feature 分支并 reset master

### 反模式

- **无 git 提交日**：尽管有大量代码改动（install.py 修复、文章多轮修改），但没有提交到任何 git 仓库
- **文章迭代轮次过多**：8 个会话用于一篇文章的优化，可能存在过度打磨的倾向
- **重复性工作**：stdin/stdout 比喻经过多次更换（窗口比喻 -> 去掉比喻），可以更早做出决定

### 成熟度评估

- **远程诊断工作流**: 5/5 — 从诊断到根因定位到报告输出，全流程自动化且高效
- **内容创作工作流**: 4/5 — 多轮迭代+多视角审稿的模式已成熟，但需要控制迭代次数
- **代码开发工作流**: 2/5 — 有代码修复但未提交，缺少 commit 习惯

## 6. 真实踩坑时间线

1. **ZK 集群全部不可达**：MSE ZK (10.215.0.90:2181) 和 IDC ZK (10.215.0.199:2181) 均超时，TCP 连接无法建立。Ping 通但端口不监听。
2. **install.sh 路径问题**：从非项目目录执行 ./install.sh --global 报 FileNotFoundError，根因是 Python subprocess 使用相对路径解析。
3. **`--max-turns` 参数不存在**：AI 在文章中编造了 `--max-turns` 参数，经验证不存在于官方文档，替换为 `--max-budget-usd`。
4. **master 分支误用**：渲染重构工作一直在 templatemanager 的 master 上进行，直到需要切换分支时才发现。通过 git reflog 找回并创建 feature 分支。
5. **前端编译环境**：templatemanager 编译需要 Node 14，但系统默认是更高版本。

## 7. 改进路线图

1. **短期**：养成每完成一个改动就 commit 的习惯，避免"无提交日"
2. **短期**：建立文章迭代的终止条件（如"修改不超过 N 处即可定稿"），避免过度打磨
3. **中期**：将 ZK 连通性检查加入 log-diagnostic skill 的自动检查项
4. **中期**：建立项目 Node 版本依赖文档（.nvmrc 或 README 说明）
5. **长期**：探索 AI 辅助技术写作的"质量 vs 效率"平衡点
