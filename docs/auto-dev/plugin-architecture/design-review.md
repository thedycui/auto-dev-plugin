# auto-dev Plugin 架构设计 v2 - Design Review

> 审查日期：2026-03-19
> 审查文档：`/Users/admin/.claude/skills/auto-dev/docs/plugin-architecture-design.md`
> 审查人：架构评审 Agent

---

## A. 功能完备性

### A1. 所有功能需求都有对应的设计组件？ -- PASS

设计文档第 8 节的对比表清晰地列出了 v4 的每个能力在 v5 中由哪个组件承接。流程控制、变量替换、状态持久化、断点恢复、Pre-flight、Git 操作、diff 校验、元学习、Agent 定义、进度提醒、Checklist 注入均有对应组件。新增的 diff_check 和 lessons 是增量功能。

### A2. 非目标（Non-Goals）明确定义？ -- PASS

第 11 节"不做的事"明确列出 4 项非目标，且每项都有清晰理由。特别是"MCP 无法调度 Claude"这一点是 v1 到 v2 修正的核心认知。

### A3. 需求到设计组件的追溯关系完整？ -- CONCERN

第 8 节的对比表起到了追溯作用，但缺少从"用户场景"到"组件"的追溯。例如 `--resume` 场景具体调用哪些工具、什么顺序，只在 Skill 编排中隐含，没有单独梳理。建议补充关键用户场景的调用链路图。

---

## B. 方案选型

### B1. 至少评估了 2 个方案？ -- CONCERN

文档以"v1 错误假设 vs v2 修订"的形式呈现了两种架构（Plugin 主控 vs Claude 主控），但这不是严格的方案对比，而是"v1 不可行所以选 v2"。对于 v2 内部的具体选型（例如：状态管理用 state.json 文件 vs SQLite vs 内存；模板引擎自研 vs 用 Handlebars/Mustache 等），没有方案对比。

**P2 建议**：对于 CLI Plugin 场景，state.json 是合理选择，不必过度比较。但如果有时间，可在文档中补充一句"为什么用 JSON 文件而不是 SQLite"的简要理由。

### B2. 每个方案的优劣有量化对比？ -- N/A

CLI Plugin 场景下，不存在需要量化对比的关键选型（如数据库选型、消息队列选型等）。v1 vs v2 是可行性问题而非性能取舍。

### B3. 选择理由清晰？ -- PASS

v1 不可行的原因在第 1 节解释得很清楚：Plugin 不能主动调度 Claude，只能被调用。控制流对比图直观。

### B4. 是否存在 Golden Hammer？ -- PASS

四种组件（MCP/Agent/Skill/Hook）各司其职，没有试图用单一机制解决所有问题。MCP 做确定性操作、Skill 做流程编排、Agent 做专用角色、Hook 做事件提醒，分工合理。

### B5. 是否过度设计？ -- CONCERN

15 个 MCP 工具中，部分工具的必要性值得斟酌：

1. **`auto_dev_git_*` 系列（5 个工具）**：Claude 本身就擅长执行 git 命令。将 git 操作封装为 MCP 工具，增加了实现复杂度，但带来的确定性提升有限（git 命令本身就是确定性的）。唯一有明确价值的是 `auto_dev_git_rollback`（精确按任务回滚）和 `auto_dev_diff_check`（plan vs actual 比对），其余的 `git_status`、`git_branch`、`git_commit` 可以考虑保留为 Claude 直接执行 bash 命令。

2. **`auto_dev_progress_log`**：单纯追加内容到 md 文件，Claude 用 Write/Edit 工具即可完成，封装为 MCP 工具价值不高。

**P1 建议**：将 MCP 工具精简到 10 个以内，只封装"Claude 做不好或容易出错"的操作。建议保留：init、state_get、state_update、checkpoint、render、preflight、diff_check、git_rollback、lessons_add、lessons_get。将 git_status/branch/commit/stash/progress_log/summary 改为 Skill 中的自然语言指令让 Claude 直接执行。

---

## C. 数据模型

### C1. 数据结构满足当前需求？ -- PASS

`state.json` 包含 phase、task、iteration、status 等字段（从 InitOutput 和 CheckpointInput 可推断）。能支持断点恢复、进度查询等核心场景。

### C2. 数据量级评估？ -- N/A

CLI 本地场景，state.json 几百字节，progress-log.md 几十 KB，不存在数据量级问题。

### C3. 数据生命周期？ -- CONCERN

state.json 和 progress-log.md 的生命周期未明确说明。问题包括：
- 一次 auto-dev 结束后，state.json 是否保留？保留多久？
- 多次对同一 topic 执行 auto-dev 时，state.json 是覆盖还是追加？
- progress-log.md 是否需要归档机制？

**P2 建议**：补充简要说明：auto-dev 完成后 state.json 保留在 `docs/auto-dev/{topic}/` 目录供回溯，再次执行同一 topic 时覆盖或提示用户选择。

### C4. 索引策略？ -- N/A

不涉及数据库。

---

## D. 可靠性 & 容错

### D1. 故障模式分析？ -- CONCERN

第 10 节列出了 6 个风险，但偏向"使用体验"层面的风险。缺少对以下故障模式的分析：

1. **MCP Server 进程崩溃**：state.json 写到一半崩溃，文件损坏
2. **Claude session 中断**：用户 Ctrl+C 或网络断连，state.json 处于中间状态
3. **`auto_dev_checkpoint` 声称"原子操作"**：state.json 和 progress-log.md 两个文件的更新不可能真正原子（除非用 rename-based write），如果写 state.json 成功但写 progress-log 失败，状态不一致

**P1 建议**：
- 对 state.json 写入使用 write-to-temp-then-rename 模式保证单文件原子性
- checkpoint 中如果 progress-log 写入失败，应回滚 state.json（或至少标记为 dirty）
- 补充 state.json 的校验逻辑：`auto_dev_state_get` 读取时做 schema validation，损坏时给出明确错误而非 crash

### D2. 重试/补偿/幂等策略？ -- CONCERN

- `auto_dev_checkpoint` 是否幂等？同一 phase+task+status 重复调用是否安全？
- `auto_dev_init` 对已存在的 `docs/auto-dev/{topic}/` 目录如何处理？

**P1 建议**：
- checkpoint 应设计为幂等（相同参数重复调用不产生副作用，不重复追加 progress-log）
- init 对已存在目录应检测并提供 resume/overwrite 选项

### D3. 数据一致性保证？ -- 见 D1

### D4. 超时设置？ -- N/A

MCP 工具都是本地文件操作和 git 命令，延迟在毫秒级。Claude Code 本身有 session timeout，不需要工具级超时。

### D5. 降级方案？ -- PASS

第 10 节提到"保留 `auto_dev_render()` 作为 fallback"。更重要的是，整个设计允许用户回退到 Skill v4：只要不安装 Plugin，原有 Skill 仍可工作（checklists 和 stacks 兼容）。这是一个好的降级路径。

---

## E. 安全性

### E1. 输入验证策略？ -- PASS

使用 zod schema 做参数校验（代码示例中可见 `z.string()`、`z.enum()`、`z.array()` 等）。这是 MCP SDK 的标准做法。

### E2. 认证 & 授权方案？ -- N/A

本地 CLI Plugin，通过 stdio 通信，不涉及网络认证。

### E3. 敏感数据处理？ -- N/A

不处理密码、密钥等敏感数据。state.json 中只有项目元信息。

---

## F. 性能

### F1. 性能目标？ -- N/A

CLI 工具，用户感知的延迟主要来自 Claude API 调用（秒级），MCP 工具的本地操作（毫秒级）不是瓶颈。

### F2. 热路径识别和优化策略？ -- PASS

第 10 节提到"合并工具（如 init 一次性返回所有信息，不拆成多个 tool）"来减少 MCP 调用次数。这是正确的优化方向，因为每次 MCP 调用都有序列化/反序列化开销和 Claude 的 tool-use token 消耗。

### F3. 缓存策略？ -- N/A

不需要缓存。

### F4. 资源使用预估？ -- CONCERN

未提及 MCP Server 进程的资源占用。MCP Server 是一个常驻 Node.js 进程（stdio 模式），会占用内存。

**P2 建议**：补充说明 MCP Server 的内存预估（预计 < 50MB），以及是否随 Claude Code session 自动启停。

---

## G. 可维护性 & 可操作性

### G1. 系统由松耦合的模块组成？ -- PASS

四种组件（MCP/Agent/Skill/Hook）天然解耦：
- MCP 工具之间通过 state.json 共享状态，不直接互调
- Agent 定义是独立的 markdown 文件
- Skill 只引用工具名和 Agent 名
- Hook 通过事件名触发，不依赖具体工具实现

MCP 内部按职责拆分为 state-manager、template-renderer、git-manager、lessons-manager 四个模块，也是合理的。

### G2. 变更影响可评估？ -- PASS

- 新增 MCP 工具：只需在 index.ts 注册，不影响现有工具
- 修改 Agent 定义：只影响对应的 subagent 行为
- 修改 Skill：只影响流程编排
- 修改 Hook：只影响自动化提醒

### G3. 可测试性？ -- CONCERN

文档未提及测试策略。MCP 工具是纯函数式的（输入 -> 文件操作 -> 输出），天然可测试，但需要：
- state-manager 的单元测试（init、update、get）
- template-renderer 的单元测试（变量替换、缺失变量警告）
- git-manager 的集成测试（需要 git repo fixture）
- 端到端测试（完整流程跑一遍）

**P1 建议**：在实施计划中增加测试阶段的细化：
- 阶段 B/C 各完成后应有对应模块的单元测试
- 阶段 H "本地测试"应明确测试用例（至少覆盖：正常流程、--resume、git dirty 场景、BLOCKED 场景）

### G4. 监控方案？ -- N/A

CLI 工具，不需要监控。

### G5. 日志方案？ -- CONCERN

progress-log.md 是面向用户的日志，但 MCP Server 自身的调试日志方案未说明。第 10 节提到"增加 `auto_dev_debug()` 工具"，但这是被动的（需要 Claude 主动调用）。

**P2 建议**：MCP Server 应有 stderr 日志输出（MCP SDK 标准做法），记录每次工具调用的输入参数和耗时，方便调试。

### G6. 部署方案？ -- PASS

第 7 节给出了完整的文件结构，第 10 节提到"README 提供一键安装命令"。对于本地 Plugin，这已足够。

### G7. 回滚方案？ -- PASS

第 10 节提到"Plugin 兼容 v4 的 checklists/stacks，只需安装 Plugin 即可"，反向来说，卸载 Plugin 即可回退到 v4。这是一个自然的回滚路径。

---

## H. 文档质量

### H1. 有上下文说明？ -- PASS

第 1 节"关键认知修正"清晰地说明了从 v1 到 v2 的认知变化，让读者理解设计的演进背景。

### H2. 有架构图/流程图？ -- PASS

第 2 节有 ASCII 架构图，第 1 节有控制流对比图。对于设计文档来说足够清晰。

### H3. 技术约束和假设显式声明？ -- CONCERN

隐含假设未显式列出，例如：
- 假设 Claude Code Plugin SDK 支持 agents/ 目录定义 subagent
- 假设 Hook 的 SubagentStop 事件可靠触发
- 假设 MCP Server 通过 stdio 通信且由 Claude Code 自动管理生命周期

**P1 建议**：增加"技术假设"小节，显式列出对 Claude Code Plugin SDK 的依赖假设。如果 SDK 行为变更（例如 agents/ 目录格式变化），这些假设就是需要检查的点。

### H4. 迁移路径？ -- CONCERN

第 9 节实施计划列出了 A-I 阶段，但缺少以下关键信息：

1. **v4 到 v5 的用户迁移步骤**：现有 v4 用户如何切换到 v5？是否需要手动操作？
2. **并行运行期**：v4 和 v5 能否共存？如果不能，切换的原子性如何保证？
3. **已有 auto-dev 产出的兼容性**：v4 产出的 progress-log.md 能否被 v5 的 `auto_dev_state_get` 识别？

**P1 建议**：补充用户迁移指南：
- 安装 Plugin 后，v4 的 SKILL.md 应如何处理（删除 / 重命名 / 自动禁用）
- v4 的 prompts/*.md 不再需要（被 agents/ 替代），但保留不会冲突
- 已有的 docs/auto-dev/{topic}/ 产出目录兼容，v5 会在同目录下新增 state.json

---

## 问题汇总

### P0 - 阻塞性问题

无。

### P1 - 重要问题

| # | 类别 | 问题 | 修复建议 |
|---|------|------|----------|
| 1 | D1 | checkpoint 声称原子但两文件写入无法真正原子 | state.json 使用 write-temp-then-rename；checkpoint 失败时标记 dirty 状态 |
| 2 | D2 | 关键工具的幂等性未定义 | checkpoint 相同参数幂等；init 对已存在目录提供 resume/overwrite 选项 |
| 3 | G3 | 缺少测试策略 | 实施计划 B/C 阶段补充单元测试；阶段 H 明确测试场景清单 |
| 4 | H3 | 对 Plugin SDK 的依赖假设未显式声明 | 增加"技术假设"小节 |
| 5 | H4 | 用户迁移路径不完整 | 补充 v4 -> v5 迁移步骤、共存策略、产出兼容性说明 |

### P2 - 优化建议

| # | 类别 | 问题 | 建议 |
|---|------|------|------|
| 1 | B5 | git_status/branch/commit/stash/progress_log 封装为 MCP 工具必要性不足 | 精简到 10 个核心工具，其余由 Claude 直接执行 |
| 2 | A3 | 缺少关键用户场景的调用链路 | 补充 --resume、BLOCKED 恢复等场景的工具调用时序 |
| 3 | C3 | 数据生命周期未说明 | 补充 state.json 的保留/覆盖策略 |
| 4 | F4 | 未说明 MCP Server 进程资源占用 | 补充内存预估和生命周期管理说明 |
| 5 | G5 | MCP Server 调试日志方案缺失 | 使用 stderr 输出调试日志 |

---

## 总结

**NEEDS_REVISION**

整体架构方向正确：四种组件分工合理，v1 到 v2 的认知修正是关键的设计决策，"Claude 是主控方"的模型符合 Plugin SDK 的实际能力。文档质量较高，架构图、对比表、实施计划都具备。

需要修订的核心点：
1. **可靠性**：checkpoint 的原子性保证和关键工具的幂等性设计需要补充
2. **迁移路径**：用户从 v4 到 v5 的迁移步骤需要明确
3. **测试策略**：实施计划中需要补充测试阶段的具体内容
4. **技术假设**：对 Plugin SDK 的依赖假设需要显式声明

以上 P1 问题修复后即可 PASS。P2 建议可在实施过程中逐步完善。

---

# 复审报告

> 复审日期：2026-03-19
> 复审对象：`design.md` v2 修订版
> 触发原因：上一轮审查报告中 5 个 P1 问题的修复验证

---

## P1 修复验证

| # | 原问题 | 修复状态 | 说明 |
|---|--------|---------|------|
| D1 | checkpoint 原子性：两文件写入无法真正原子 | **FIXED** | Section 3.2 `auto_dev_checkpoint` 详细设计中明确了：(1) state.json 使用 write-to-temp-then-rename 模式（POSIX rename 原子性）；(2) 写入顺序为先 progress-log 再 state.json；(3) progress-log 成功但 state.json 失败时标记 dirty=true 并保留 .tmp 文件供恢复；(4) progress-log 写入失败则直接抛错不更新 state.json。同时 `auto_dev_state_get` 增加了 schema validation 和 dirty 检测。设计合理完备。 |
| D2 | 关键工具幂等性未定义 | **FIXED** | 两处修复：(1) `auto_dev_checkpoint` 增加幂等检查——追加前比对最后一条 CHECKPOINT 的 phase+task+status+summary，完全相同则跳过（Section 3.2 注释）；(2) `auto_dev_init` 增加 `onConflict` 参数，已存在目录时返回 `OUTPUT_DIR_EXISTS` 错误并提示 resume/overwrite，overwrite 时先备份为 `.bak.{timestamp}`（Section 3.2 + 3.3 代码）。state_update 的幂等性也通过"相同值覆盖写入无副作用"说明。 |
| G3 | 缺少测试策略 | **FIXED** | Section 9 实施计划中每个阶段都补充了"测试要求"列：阶段 B 要求 state-manager 和 template-renderer 的单元测试；阶段 C 要求 git repo fixture 的集成测试；阶段 D/E/F 有验证方式说明；阶段 H 新增了 8 个具体的端到端测试场景（H1-H8），覆盖正常流程、resume 恢复、git dirty、BLOCKED、checkpoint 幂等、state.json 损坏、NEEDS_REVISION 循环、diff_check 异常检测。测试策略充分。 |
| H3 | 技术假设未显式声明 | **FIXED** | 新增 Section 10.5"技术假设"，列出 7 项假设（T1-T7），每项包含假设内容、影响范围、验证方式。覆盖了 agents/ 目录自动注册（T1）、SubagentStop 事件可靠性（T2）、MCP stdio 生命周期管理（T3）、工具自动可见（T4）、Skill 自动加载（T5）、CLAUDE_PLUGIN_ROOT 环境变量（T6）、内存占用（T7）。验证方式与实施阶段对应，可操作性强。 |
| H4 | 迁移路径不完整 | **FIXED** | 新增 Section 12"v4 -> v5 迁移指南"，包含四个子节：(1) 12.1 迁移步骤（安装、禁用 v4、验证、清理）；(2) 12.2 共存策略（明确 v4/v5 同时存在的 4 种场景及处理方式，特别指出必须禁用 v4 SKILL.md）；(3) 12.3 已有产出兼容性（progress-log 完全兼容、目录向前兼容、缺少 state.json 时从 CHECKPOINT 标记重建）；(4) 12.4 迁移注意事项。内容完整，回退路径清晰（删除 Plugin 目录 + 恢复 SKILL.md.v4.bak）。 |

---

## P2-B5（MCP 工具精简）验证

**状态：FIXED**

原建议是将 15 个 MCP 工具精简到 10 个以内，移除 git_status/branch/commit/stash/progress_log/summary。

修订版在 Section 3.1 中：
- 工具清单精简至 **10 个**（init、state_get、state_update、checkpoint、render、preflight、diff_check、git_rollback、lessons_add、lessons_get）
- 新增"移除的工具及替代方式"表格，6 个被移除的工具每个都有明确的替代方案（Skill 指令引导 Claude 直接执行 bash 命令或使用 Write/Edit 工具）
- Section 3.1 开头增加了设计决策说明："只封装 Claude 做不好或容易出错的操作为 MCP 工具"

精简合理，保留的 10 个工具各有不可替代的价值。

---

## 新增问题检查

逐项检查修复内容是否引入新的 P0/P1 问题：

**未发现新的 P0 问题。**

**未发现新的 P1 问题。**

以下为修复过程中发现的小建议（P2 级别，不阻塞通过）：

| # | 类别 | 说明 |
|---|------|------|
| R1 | D1 补充 | checkpoint 的幂等检查"比对最后一条 CHECKPOINT"依赖 progress-log.md 的解析。如果文件很大，尾部解析可能有性能隐患。建议实现时从文件末尾反向读取（如 readline 反向迭代），而非全量加载。 |
| R2 | Section 12 | 迁移步骤 1 使用 `cp -r` 安装 Plugin，建议补充说明是否需要先 `cd ~/.claude/plugins/ && npm install`（MCP Server 依赖安装）。当前 Section 7 文件结构中有 `mcp/package.json`，但迁移步骤未提及依赖安装。 |
| R3 | Section 9 | 阶段 H 的 8 个测试场景均为手动验证。如果后续迭代频繁，建议在 H1/H2/H5/H6 场景上考虑自动化（脚本化 fixture 创建 + 断言检查）。 |

---

## 总结

**PASS**

上一轮 5 个 P1 问题全部修复到位，P2-B5 的 MCP 工具精简也合理落地。修复内容质量高，没有引入新的阻塞性或重要问题。设计文档已达到可进入实施阶段的质量标准。
