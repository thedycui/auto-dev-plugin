---
name: auto-dev
description: "自治开发循环 — 从设计到测试通过的全自动闭环。支持自审迭代，最小化人工介入。Use when user says /auto-dev, asks for autonomous development, wants a full dev loop (design -> plan -> implement -> verify -> e2e test), or mentions '自治开发', '自动开发循环', '全自动闭环', 'autonomous dev', 'auto implement'. Also use when user provides a design doc and wants it implemented end-to-end without manual intervention."
---

# auto-dev 自治开发

## 概述

auto-dev 通过编排器（Orchestrator）自动完成从设计到测试的全流程。你只需要调用两个工具。

## 使用方式

### 1. 初始化

```
auto_dev_init(projectRoot, topic, mode?, ...)
```

初始化项目：创建工作目录、检测技术栈、初始化状态。

参数：
- `projectRoot` — 项目根目录
- `topic` — 任务主题（用于创建工作目录 docs/auto-dev/{topic}）
- `mode` — `full`（默认，全流程）/ `quick`（跳过设计计划）/ `turbo`（仅实现）
- `skipE2e` — 跳过端到端测试阶段
- `tdd` — 启用 TDD 红绿循环（默认开启）
- `costMode` — `beast`（全部用最强模型，默认）/ `economy`（按阶段选模型）
- `onConflict` — `resume`（恢复上次进度）/ `overwrite`（覆盖重来）

### 2. 启动编排器

```
auto_dev_orchestrate(projectRoot, topic, mode?, skipE2e?, tdd?, costMode?)
```

编排器自动完成所有阶段：
- 设计 -> 计划 -> 实现 -> 验证 -> 测试 -> 验收 -> 回顾
- 每个阶段由独立的 agent 完成，编排器负责验证和反馈
- 如果需要人工决策，编排器会返回并说明情况

### 3. 人工介入

编排器在以下情况返回等待人工决策：
- 修订轮次耗尽（某个阶段多次修订仍未通过）
- 编译/测试持续失败
- 验证异常

收到返回后，根据 `escalation.reason` 和 `escalation.lastFeedback` 决定：
- 调整方向后重新调用 `auto_dev_orchestrate` 继续
- 手动修复问题后重新调用
- 终止流程

### 4. 查看状态

```
auto_dev_state_get(projectRoot, topic)
```

### 旧版模式

如需使用旧版 agent 驱动模式（agent 直接驱动流程），参考 `SKILL.legacy.md`。
