---
name: auto-dev
description: "自治开发循环 — 从设计到测试通过的全自动闭环。支持自审迭代，最小化人工介入。Use when user says /auto-dev, asks for autonomous development, wants a full dev loop (design -> plan -> implement -> verify -> e2e test), or mentions '自治开发', '自动开发循环', '全自动闭环', 'autonomous dev', 'auto implement'. Also use when user provides a design doc and wants it implemented end-to-end without manual intervention."
---

# auto-dev 自治开发

## 使用方式

### 1. 初始化

```
auto_dev_init(projectRoot, topic, mode?, skipE2e?, tdd?, costMode?, onConflict?, designDoc?)
```

- `mode` — `full`（默认）/ `quick`（跳过设计计划）/ `turbo`（仅实现）
- `costMode` — `beast`（默认，全部最强模型）/ `economy`（按阶段选模型）
- `onConflict` — `resume`（恢复上次）/ `overwrite`（覆盖重来）
- `designDoc` — 指定已有设计文档路径（如 `docs/design-xxx.md`），自动复制并跳过重新设计
  - 不指定时，框架自动匹配 `docs/design-*{topic}*.md`

### 2. 循环执行

```
result = auto_dev_next(projectRoot, topic)
while !result.done:
  if result.task:
    Agent(subagent_type=result.agentType, prompt=result.task, model=result.model)
  elif result.escalation:
    告知用户: result.escalation.reason + result.escalation.feedback
    等待用户决定后继续或终止
    break
  result = auto_dev_next(projectRoot, topic)
```

每次调用 `auto_dev_next`：
- 框架验证上一步产出（编译、测试、文档审查等）
- 返回下一个任务的 prompt 和建议的 agent 类型
- 你用 Agent() 派发 subagent 执行，subagent 有完整的工具能力

### 3. 查看状态

```
auto_dev_state_get(projectRoot, topic)
```

### 旧版模式

旧版 agent 驱动模式见 `SKILL.legacy.md`。
