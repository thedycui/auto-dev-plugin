# Auto-Dev Plugin Roadmap

> 版本: 9.5.2 | 更新: 2026-04-02
> 记录已完成的能力、已知问题和未来规划

---

## 已完成

### 核心框架 (v9.0)
- [x] 7-Phase 自治开发循环（Design → Plan → Execute → Verify → E2E → Acceptance → Retrospective）
- [x] MCP 工具引擎（20+ 个工具：状态管理、编排、裁决、回滚、模板渲染）
- [x] 5 个专用 Agent（architect / reviewer / developer / test-architect / acceptance-validator）
- [x] Tribunal 独立裁决系统（Phase 4/5/6 三级裁决策略）
- [x] Git worktree 生命周期（init 时创建，complete 时清理）
- [x] 精确文件级回滚（auto_dev_git_rollback）
- [x] 断点恢复（state.json 持久化）
- [x] 三层元学习（local / project / global lessons）

### 质量保障 (v9.1-9.3)
- [x] Executable Acceptance Criteria (AC) 框架
- [x] AC 框架自动化测试（plan → AC JSON → 验证）
- [x] TDD gate 全局门禁（Phase 3→4 过渡检查）
- [x] Agent dispatch 纪律（mandate injection 防止越权）
- [x] diff_check（计划文件 vs 实际变更对比）

### 稳定性 (v9.3-9.4)
- [x] Tribunal crash observability（崩溃提取 + 安全上报）
- [x] Phase desync guard（状态与实际不同步时阻断）
- [x] Revision step re-validation（修订后重新验证）
- [x] Tribunal overflow fix（裁决溢出保护）
- [x] Circuit breaker（phase 级别熔断）
- [x] Prompt-lint timeout 调优（防 flaky）

### Orchestrator 重构 (v9.4-9.5)
- [x] God function 拆分（从 2000+ 行单体拆为模块化步骤函数）
- [x] Effort budget + revision cycle guard
- [x] Hash-based validation（幂等 checkpoint）
- [x] effectiveRoot 透明化（worktree 路径正确传播）
- [x] Orchestrator UX 改进（更好的错误消息、进度报告）
- [x] Robust phase progression（防止过早推进）
- [x] Worktree handler 集成测试

---

## 进行中 / 近期计划

### P0: 提升自测能力
- [ ] **开发工作流改进**：使用 feature 分支开发，master 保持稳定可用的 auto-dev
- [ ] **CI 集成**：每次 push 自动跑 `npm test`，防止破坏性变更合入 master

### P1: Code-Review 文档闭环 (TODO-1)
- [ ] Phase 4 tribunal 裁决完成后，自动提取为 `code-review.md`
- [ ] 方案 A（推荐）：从 tribunal 输出提取 P0/P1 + Dormant Path
- [ ] 消除 Phase 5a 对 code-review.md 的可选依赖

### P1: 设计审查问题闭环 (TODO-2)
- [ ] Phase 3 task prompt 注入设计审查 P0/P1 清单
- [ ] 框架层面：Phase 4 tribunal 发现 NOT_FIXED 的 P0/P1 自动降级

### P1: Tribunal traces 成本优化 (TODO-4)
- [ ] 历史问题预分类（代码类 → grep 证据，文档类 → DEFERRED）
- [ ] Traces 上限控制（最多 15 个问题）
- [ ] P2 及以下不进入 traces

---

## 中期规划

### P2: TDD gate 强化 (TODO-3)
- [ ] Phase 3 每 task 级别的 RED→GREEN 框架强制（方案 A）
- [ ] 目前只有全局门禁（Phase 3→4），缺少 task 级拦截

### P2: Subagent 裁决审计追踪 (TODO-5)
- [ ] auto_dev_tribunal_verdict 结果写入 tribunal-phaseN.md
- [ ] progress-log.md 区分裁决来源（CLI/Hub/Subagent）
- [ ] Subagent 裁决 prompt 输出结构化 evidence

### P2: 多语言支持扩展
- [ ] 支持 Python 项目（当前主要是 TS/JS）
- [ ] 支持 Java 项目（企业需求）

### P2: 并行任务执行优化
- [ ] 目前 Phase 3 任务按 file-overlap waves 并行
- [ ] 更智能的依赖分析和并行策略

---

## 远期愿景

### P3: 跨仓库联动
- [ ] 支持同时修改多个关联仓库
- [ ] 跨仓库依赖感知（A 仓库的 API 变更自动触发 B 仓库适配）

### P3: 生产部署闭环
- [ ] 验收通过后自动触发部署流水线
- [ ] 部署后健康检查 + 自动回滚

### P3: 智能规划
- [ ] 基于历史数据自动估算任务复杂度
- [ ] 失败模式学习（哪些类型的任务容易出问题）

### P3: 多人协作
- [ ] 支持多个开发者同时使用 auto-dev（各自 feature 分支）
- [ ] 冲突检测和协调

---

## 版本历史

| 版本 | 日期 | 主题 |
|------|------|------|
| 9.5.2 | 2026-04-02 | UX 改进 + robust phase progression + worktree 测试 |
| 9.5.0 | 2026-04-02 | Orchestrator god function 拆分 + effort budget |
| 9.4.0 | 2026-04-01 | Executable AC 框架 |
| 9.3.0 | 2026-03-30 | Self-evolution round 2（内部质量三重修复 + TDD gate） |
| 9.2.0 | 2026-03-28 | Tribunal crash observability + hub integration |
| 9.1.0 | 2026-03-25 | Tribunal 独立裁决系统 + 状态统一 |
| 9.0.0 | 2026-03-20 | Plugin 架构（MCP + Agent + Skill + Hook） |
