# auto-dev-plugin 路线图

> 最后更新：2026-03-30 (observability-gate 方案 A 已完成)
>
> 本文档追踪所有设计文档的实现状态，作为插件演进的总路线图。

---

## 状态说明

| 标记 | 含义 |
|------|------|
| :white_check_mark: 已完成 | 设计已实现并通过验证（有 retrospective 或代码确认） |
| :construction: 进行中 | 已开始实现但未完成 |
| :hourglass: 待开发 | 设计已完成，等待排期实现 |
| :memo: 草案 | 设计尚在草案阶段，未最终确定 |
| :no_entry_sign: 搁置 | 已被其他方案覆盖或暂时搁置 |

---

## 一、已完成

按完成时间倒序排列。

### 1.1 核心架构（P0 — 框架骨架）

| # | 设计文档 | 主题 | 创建日期 | 完成日期 | 备注 |
|---|---------|------|---------|---------|------|
| 1 | [design-step-orchestrator.md](design-step-orchestrator.md) | Step 编排器（auto_dev_next） | 2026-03-26 | 2026-03-26 | orchestrator.ts 实现，替代旧的 auto_dev_orchestrate |
| 2 | [design-invisible-framework.md](design-invisible-framework.md) | 隐形框架 — Agent 无感知编排 | 2026-03-26 | 2026-03-27 | Agent 不再感知 Phase/checkpoint/tribunal，框架透明调度 |
| 3 | [design-state-update-guard.md](design-state-update-guard.md) | State 更新守卫 | 2026-03-23 | 2026-03-23 | auto_dev_state_update 移除 phase/status 字段，防止 agent 越权 |

### 1.2 质量保障（P0 — 裁决与验证）

| # | 设计文档 | 主题 | 创建日期 | 完成日期 | 备注 |
|---|---------|------|---------|---------|------|
| 4 | [design-tribunal-hub-integration.md](design-tribunal-hub-integration.md) | 裁决官三级执行策略 | 2026-03-29 | 2026-03-29 | Hub > Subagent(默认) > CLI(opt-in)，避免 CLI shell 溢出 |
| 5 | [design-circuit-breaker.md](design-circuit-breaker.md) | 断路器 — 预案制 + 清零重启 | 2026-03-26 | 2026-03-27 | 同方案失败 2 次自动切换，含 ApproachEntry/FailedApproach 机制 |

### 1.3 交付闭环（P1 — 端到端能力）

| # | 设计文档 | 主题 | 创建日期 | 完成日期 | 备注 |
|---|---------|------|---------|---------|------|
| 6 | [design-auto-dev-ship-integration.md](design-auto-dev-ship-integration.md) | Phase 8 交付验证 | 2026-03-28 | 2026-03-29 | 可选 Phase 8：push → build → deploy → verify，含 CODE_BUG 自动回退 |
| 7 | [design-integration-test-phase.md](design-integration-test-phase.md) | 集成测试阶段 | 2026-03-26 | 2026-03-29 | 并入 ship-integration 实现，Phase 8 覆盖集成测试场景 |

### 1.4 优化修复（P1 — 问题消灭）

| # | 设计文档 | 主题 | 创建日期 | 完成日期 | 备注 |
|---|---------|------|---------|---------|------|
| 8 | [design-batch2-step-fix-escalate-prompts.md](design-batch2-step-fix-escalate-prompts.md) | Step 修复 + ESCALATE 自动回退 + Prompt 优化 | 2026-03-26 | 2026-03-28 | 由 turbo-mode 任务完成。修复 stepState Zod bug，ESCALATE → REGRESS |
| 9 | [design-issues-2-5-9-10.md](design-issues-2-5-9-10.md) | Issue #2 #5 #9 #10 综合修复 | 2026-03-25 | 2026-03-28 | 分散在 circuit-breaker + batch1 + turbo 三个任务中完成 |
| 10 | [design-auto-dev-improvements.md](design-auto-dev-improvements.md) | 7 项综合优化 | 2026-03-23 | 2026-03-28 | state_update 守卫、startCommit、skipE2e 等，被多个子任务覆盖 |
| 11 | [design-observability-gate.md](design-observability-gate.md) | 可观测性门禁（方案 A） | 2026-03-26 | 2026-03-30 | Phase 3/4 prompt 增强 + code review checklist，可观测性覆盖强制检查 |
| 12 | [design-email-mcp-server.md](design-email-mcp-server.md) | 邮件 MCP Server 插件 | 2026-03-26 | 2026-03-28 | 独立项目，已实现于 `~/.claude/plugins/email-mcp`，IMAP/SMTP 完整功能 |

---

## 二、进行中

| # | 设计文档 | 主题 | 优先级 | 创建日期 | 当前进度 | 备注 |
|---|---------|------|--------|---------|---------|------|
| 13 | [design-batch1-guard-optimization.md](design-batch1-guard-optimization.md) | 框架守卫优化（Issue #9 #5 #10） | P1 | 2026-03-26 | Phase 5 PASS，未完成复盘 | lesson feedback 移除、tribunal 约束放宽等 |
| 14 | [design-state-unification.md](design-state-unification.md) | 状态管理统一重构 | P2 | 2026-03-26 | 仅初始化 | 单 writer + 单 API + phase 由 step 派生 |

### 相关进行中任务（无独立设计文档）

| # | auto-dev 任务目录 | 主题 | 当前进度 |
|---|------------------|------|---------|
| — | [20260330-1355-tribunal-crash-observability](auto-dev/20260330-1355-tribunal-crash-observability/) | Tribunal 崩溃可观测性改进 | 设计审查中 |

---

## 三、待开发

按优先级排序。优先级依据：对框架稳定性、日常使用体验、交付效率的影响程度。

### P1 — 高优先级（直接影响交付质量）

| # | 设计文档 | 主题 | 创建日期 | 重要性说明 |
|---|---------|------|---------|-----------|
| 14 | [design-executable-ac.md](design-executable-ac.md) | 可执行验收标准（混合 B+C 方案） | 2026-03-26 | 三层 AC：结构断言 + 测试绑定 + 人工审查，"锁死尺子"提升验收可靠性 |

### P2 — 中优先级（提升效率和体验）

| # | 设计文档 | 主题 | 创建日期 | 重要性说明 |
|---|---------|------|---------|-----------|
| 15 | [design-resource-constraints.md](design-resource-constraints.md) | 资源约束系统（文件锁 + diff 预算） | 2026-03-26 | 限制 agent 修改范围，防止跑偏，"约束即创造力" |
| 16 | [design-review-enhancement.md](design-review-enhancement.md) | design-review 智能角色调度 | 2026-03-30 | 小设计轻量审、大设计深度审，节省 token 和时间 |

### P3 — 低优先级（独立项目 / 非核心）

| # | 设计文档 | 主题 | 创建日期 | 完成日期 | 重要性说明 |
|---|---------|------|---------|---------|-----------|
| 17 | [design-email-mcp-server.md](design-email-mcp-server.md) | 邮件 MCP Server 插件 | 2026-03-26 | 2026-03-28 | 独立项目，已实现于 `~/.claude/plugins/email-mcp`，nodemailer + imapflow 对接 Coremail |

---

## 四、演进时间线

```
2026-03-23  ████ state-update-guard + auto-dev-improvements 启动
2026-03-25  ██ issues-2-5-9-10 设计
2026-03-26  ████████████ step-orchestrator / invisible-framework / circuit-breaker /
            executable-ac / observability-gate / resource-constraints 集中设计
2026-03-27  ████ invisible-framework + circuit-breaker 完成
2026-03-28  ████ batch2 + issues 修复完成, turbo-mode 上线
            ████ email-mcp-server 完成（独立插件）
2026-03-29  ████ tribunal-hub-integration + ship-integration 完成
2026-03-30  ██ tribunal-crash-observability 设计中, observability-gate 完成, review-enhancement 草案
            ↓
  下一步    → executable-ac (P1)
            → resource-constraints (P2)
            → review-enhancement (P2)
```

---

## 五、维护指南

- 每次 auto-dev 任务完成后，更新对应设计文档的状态和完成日期
- 新增设计文档时，在"待开发"章节添加条目并评估优先级
- 优先级调整需标注原因（如用户反馈、线上问题触发等）
- 搁置的设计文档移入"已完成"末尾并标注 :no_entry_sign:，说明搁置原因
