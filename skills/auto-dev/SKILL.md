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

- `mode` — `full`（默认）/ `quick`（跳过设计计划）/ `turbo`（仅实现）。**bugfix 类型不传 mode 时框架自动选 quick**
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
    if result.escalation.reason == "tribunal_subagent":
      // 自动启动 subagent 执行裁决（不中断流程）
      digestPath = result.escalation.digestPath
      Agent(subagent_type="auto-dev-reviewer", prompt="""
        你是独立裁决者。请先用 Read 工具读取文件 "{digestPath}"，
        然后按照其中的检查清单逐条裁决。
        裁决完成后调用 auto_dev_tribunal_verdict 提交结果。
        PASS 必须对每条检查项提供 passEvidence（文件名:行号）。
        如果不确定，判 FAIL。
      """)
      result = auto_dev_next(projectRoot, topic)
      continue
    else:
      // 其他 escalation（tribunal_crashed, tribunal_parse_failure, iteration_limit 等）
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

### 5. 设计文档模板（推荐）

使用以下模板编写设计文档，可让 auto-dev **跳过 Phase 1a（设计重写）**，直接进入 Phase 1b（审查），节省约 10-15 分钟。

要求：方案对比表 ≥2 个方案，验收标准 ≥3 条 AC。

```markdown
# 设计文档：[标题]

## 1. 背景与目标
[为什么做、做什么、不做什么（Non-Goals）]

## 2. 现状分析
[现有架构中与需求相关的部分]

## 3. 方案设计
| 方案 | 描述 | 优点 | 缺点 |
|------|------|------|------|
| A: [名称] | ... | ... | ... |
| B: [名称] | ... | ... | ... |

**选择方案 X**，理由：...

## 4. 详细设计
[选定方案的具体实现：改动范围、数据模型、接口设计、数据流]

## 5. 影响分析
[对现有代码的改动范围、兼容性、迁移路径]

## 6. 风险与缓解
| 风险 | 缓解措施 |
|------|---------|
| ... | ... |

## 7. 验收标准
| AC | 描述 | 验证方式 |
|----|------|---------|
| AC-1 | [具体可验证的行为描述] | 单元测试 / 集成测试 / 代码审查 |
| AC-2 | ... | ... |
| AC-3 | ... | ... |
```

不符合此格式时，Phase 1a 会自动基于原始文档重新生成标准化版本。

### 旧版模式

旧版 agent 驱动模式见 `SKILL.legacy.md`。
