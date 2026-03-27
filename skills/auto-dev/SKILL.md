---
name: auto-dev
description: "自治开发循环 — 从设计到测试通过的全自动闭环。支持自审迭代，最小化人工介入。Use when user says /auto-dev, asks for autonomous development, wants a full dev loop (design -> plan -> implement -> verify -> e2e test), or mentions '自治开发', '自动开发循环', '全自动闭环', 'autonomous dev', 'auto implement'. Also use when user provides a design doc and wants it implemented end-to-end without manual intervention."
---

# auto-dev 自治开发

## 使用方式

### 1. 初始化

```
auto_dev_init(projectRoot, topic, mode?, skipE2e?, tdd?, costMode?, onConflict?, designDoc?, ship?, deployTarget?, deployBranch?, deployEnv?, verifyMethod?, verifyConfig?, shipMaxRounds?)
```

- `mode` — `full`（默认）/ `quick`（跳过设计计划）/ `turbo`（仅实现）
- `costMode` — `beast`（默认，全部最强模型）/ `economy`（按阶段选模型）
- `onConflict` — `resume`（恢复上次）/ `overwrite`（覆盖重来）
- `designDoc` — 指定已有设计文档路径（如 `docs/design-xxx.md`），自动复制并跳过重新设计
  - 不指定时，框架自动匹配 `docs/design-*{topic}*.md`
- `ship` — 是否启用 Phase 8 交付验证（默认 false）。启用后 Phase 7 完成会自动进入 Phase 8
- `deployTarget` — DevOps 组件名（`ship=true` 时必填）
- `deployBranch` — 部署分支（默认当前 git 分支）
- `deployEnv` — 目标环境（默认 `"green"`）
- `verifyMethod` — 远程验证方式：`"api"` / `"log"` / `"test"` / `"combined"`
- `verifyConfig` — 验证配置对象，包含 `endpoint?`、`expectedPattern?`、`logPath?`、`logKeyword?`、`sshHost?` 等可选字段
- `shipMaxRounds` — 最大交付轮次（默认 5）。交付验证发现代码 bug 会自动回退 Phase 3 修复并重新交付，超过此轮次 ESCALATE

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

### 4. Phase 8 交付验证（可选）

当 `ship=true` 时，Phase 7（复盘）完成后自动进入 Phase 8，依次执行：

- **8a — Push 代码**：commit 并 push 到远程仓库
- **8b — 构建**：触发 DevOps 构建，验证构建成功
- **8c — 部署**：部署到目标环境，验证部署成功
- **8d — 远程验证**：根据 `verifyMethod` 执行 API 调用、日志检查或远程测试，确认功能正常

Phase 8 不走 tribunal 裁决，验证基于硬数据（构建结果、部署状态、远程验证返回）。

**回退机制**：Step 8d 验证失败时，若判定为代码问题（CODE_BUG），自动回退到 Phase 3 修复后重新交付；若判定为环境问题（ENV_ISSUE），直接 ESCALATE 给用户。回退轮次超过 `shipMaxRounds` 时 ESCALATE。

**使用示例**：

```
auto_dev_init(
  projectRoot="/path/to/project",
  topic="add-user-export",
  ship=true,
  deployTarget="user-service",
  deployBranch="common-test",
  deployEnv="green",
  verifyMethod="api",
  verifyConfig={ endpoint: "http://test.example.com/api/users/export", expectedPattern: "200" }
)
```

未传 `ship=true` 时 Phase 8 不激活，不影响 Phase 1-7 的行为。

### 旧版模式

旧版 agent 驱动模式见 `SKILL.legacy.md`。
