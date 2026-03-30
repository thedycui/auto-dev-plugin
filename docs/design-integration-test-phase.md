# 设计文档：auto-dev Phase 8 — 集成测试

## 一、目标

在 auto-dev 现有 7 个 Phase 之后新增 Phase 8（集成测试），实现：

**部署到测试环境 → 逐条执行 AC 验证 → tribunal 审查测试结果**

覆盖从"代码通过本地验证"到"功能在真实环境可用"的缺口。

## 二、与现有 Phase 的关系

```
现有流程:
  Phase 1 设计 → 2 计划 → 3 实现 → 4 代码审查 → 5 E2E测试 → 6 验收 → 7 复盘

扩展后:
  Phase 1-7 不变
  Phase 8 集成测试（可选，通过 flag 启用）
    ├─ Step 8a: 部署（调用 /deploy skill 或手动部署）
    ├─ Step 8b: 集成测试执行（逐条 AC 验证）
    └─ Step 8c: 测试结果审查（tribunal）
```

**Phase 8 与 Phase 5 的区别：**

| 维度 | Phase 5 (E2E 测试) | Phase 8 (集成测试) |
|------|-------------------|-------------------|
| 运行环境 | 本地（vitest/jest/pytest） | 远程测试环境 |
| 测试对象 | 代码逻辑、单元/集成 | 部署后的真实服务 |
| 测试手段 | 测试框架 | Playwright/curl/SSH/MongoDB |
| 依赖 | 无外部依赖 | 需要构建部署完成 |
| 何时跑 | 每次代码变更后 | 部署成功后 |

## 三、启用方式

### 3.1 init 参数

```
auto_dev_init(... , integrationTest: true)
```

新增 `integrationTest` boolean flag，默认 false。仅当显式启用时 Phase 8 才加入 required phases。

### 3.2 mode 兼容

| mode | Phase 8 行为 |
|------|-------------|
| full | 如果 integrationTest=true，Phase 8 加入 required |
| quick | 同上 |
| turbo | 不支持 Phase 8 |
| dry-run | 不支持 Phase 8 |

### 3.3 用户触发

```
/auto-dev --integration-test @design.md "实现指标查询功能"
```

或在现有 auto-dev 流程结束后，手动触发：

```
auto_dev_state_update(phase=8, status="IN_PROGRESS")
auto_dev_next()
```

## 四、Step 详细设计

### Step 8a: 部署

**目标**：确保代码已部署到测试环境。

**执行逻辑**：

1. 检查项目根目录是否有 `.deploy.json`
   - 有 → 提示 agent 使用 `/deploy` skill 执行部署
   - 没有 → 提示 agent 手动完成部署（git push + DevOps 构建部署）
2. 部署完成后，agent 需要在 `{output_dir}/deploy-record.md` 中记录：
   ```markdown
   ## 部署记录
   - 时间: 2026-03-26 14:00
   - 组件:
     - dubbo-metrics #1008 → 蓝,绿 ✓
     - api-metrics #1017 → 蓝,绿 ✓
     - htm-metrics #1015 → A环境 ✓
   ```

**验证门禁**：
- `deploy-record.md` 存在且非空
- 包含至少一个组件的部署记录

**失败处理**：
- 部署失败 → 状态保持 IN_PROGRESS，revision prompt 包含失败日志
- 迭代上限 3 次

### Step 8b: 集成测试执行

**目标**：逐条执行 design.md 中的 AC，使用对应的测试手段验证。

**AC 提取规则**：

从 `design.md` 中提取验收标准（AC-N），每条 AC 映射到测试类型：

```
AC 内容包含关键词          → 测试类型      → 测试手段
"页面"/"菜单"/"按钮"/"显示" → UI           → Playwright
"接口"/"API"/"返回"/"请求"  → API          → curl/Bash
"Dubbo"/"RPC"/"服务层"      → SERVICE      → SSH（间接通过 API 验证）
"存储"/"入库"/"记录"/"数据" → DB           → SSH + mongo/clickhouse
"端口"/"进程"/"启动"        → INFRA        → SSH
```

一条 AC 可能映射到多种测试类型。

**执行流程**：

```
对 design.md 中的每条 AC-N:
  1. 确定测试类型和测试手段
  2. 执行测试:
     - UI: Playwright 导航 → 操作 → 截图 → DOM 断言
     - API: curl 调接口 → 验证状态码 + 返回体
     - DB: SSH 到节点 → mongo/clickhouse 查询 → 验证数据
     - SERVICE: SSH 查端口/进程
     - INFRA: SSH 查端口/进程/日志
  3. 记录结果到 integration-test-results.md
  4. UI 测试截图保存到 {output_dir}/screenshots/
```

**结果文件格式** (`integration-test-results.md`)：

```markdown
# 集成测试结果

## 概要
- 执行时间: 2026-03-26 14:30
- AC 总数: 8
- 通过: 7
- 失败: 1

## 详细结果

### AC-1: 管理员可以看到完整菜单
- 测试类型: UI
- 测试手段: Playwright
- 结果: PASS
- 截图: screenshots/ac-1.png
- 验证命令: browser_navigate("https://...") → browser_snapshot()

### AC-2: 查询接口返回正确数据
- 测试类型: API
- 测试手段: curl
- 结果: FAIL
- 实际结果: HTTP 500, {"code": -1, "message": "NPE"}
- 期望结果: HTTP 200, {"code": 200, "data": [...]}
- 验证命令: curl -s -k -H "X-API-Key: xxx" "https://..."
```

**验证门禁**：
- `integration-test-results.md` 存在
- 每条 AC 都有对应的测试结果（PASS/FAIL），不允许 SKIP 或空白
- UI 测试必须有截图文件
- FAIL 结果必须有"实际结果"和"验证命令"字段

**失败处理**：
- 如果有 AC 验证失败 → 状态 NEEDS_REVISION
- revision prompt 中包含失败的 AC 列表和实际结果
- agent 需要分析失败原因，修复代码，回到 Step 8a 重新部署
- 迭代上限 3 次（每次包含 修复 → 部署 → 重测 完整循环）

### Step 8c: 测试结果审查（Tribunal）

**目标**：独立 judge 验证测试结果的真实性。

**Tribunal digest 包含**：
- design.md 中的 AC 列表
- integration-test-results.md 完整内容
- screenshots/ 目录下的截图文件列表
- deploy-record.md 内容

**Tribunal 交叉验证**：
- AC 数量 = 测试结果数量（没有遗漏）
- 每条 PASS 的 AC 都有验证命令（不是空话）
- FAIL 的 AC 有具体的实际结果（不是模糊描述）
- UI 测试的截图文件实际存在

**Tribunal 判定**：
- PASS → Phase 8 完成
- FAIL → 返回问题列表，agent 修复后重新提交

## 五、代码改动范围

### 5.1 types.ts

```typescript
// StateJson 新增字段
integrationTest?: boolean    // 是否启用集成测试

// PhaseNumber 扩展
type PhaseNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8
```

### 5.2 phase-enforcer.ts

```typescript
// PHASE_META 新增
8: {
  name: "INTEGRATION_TEST",
  label: "集成测试",
  maxIterations: 3,
  requiresTribunal: true
}

// MODE_REQUIRED_PHASES 修改
// 不直接修改，改为动态计算:
function getRequiredPhases(mode, skipE2e, integrationTest): number[] {
  let phases = MODE_REQUIRED_PHASES[mode]
  if (skipE2e) phases = phases.filter(p => p !== 5)
  if (integrationTest && mode !== 'turbo' && mode !== 'dry-run') {
    phases.push(8)
  }
  return phases
}
```

### 5.3 orchestrator.ts — computeNextTask()

新增 Step 定义：

```typescript
// Step 8a: 部署
{
  step: "8a",
  phase: 8,
  agent: "auto-dev:auto-dev-developer",  // 复用 developer agent
  promptFile: "phase8-deploy.md",
  validation: () => {
    // deploy-record.md 存在且非空
    return fileExists("deploy-record.md") && fileSize > 50
  }
}

// Step 8b: 集成测试执行
{
  step: "8b",
  phase: 8,
  agent: "auto-dev:auto-dev-developer",  // developer agent 执行测试
  promptFile: "phase8-integration-test.md",
  validation: () => {
    // integration-test-results.md 存在
    // 每条 AC 都有结果
    // 无 SKIP 结果
    return validateIntegrationTestResults()
  }
}

// Step 8c: Tribunal 审查
{
  step: "8c",
  phase: 8,
  agent: "tribunal",
  validation: () => tribunalVerdict === "PASS"
}
```

### 5.4 tribunal.ts

新增 Phase 8 的 digest 准备逻辑：

```typescript
case 8:
  // 收集 design.md AC 列表
  // 收集 integration-test-results.md
  // 收集 deploy-record.md
  // 列举 screenshots/ 文件
  // 写入 tribunal-digest-phase8.md
```

新增 Phase 8 的交叉验证：

```typescript
case 8:
  // AC 数量 = 测试结果数量
  // PASS 的 AC 有验证命令
  // 截图文件实际存在
```

### 5.5 新增 prompt 文件

#### `skills/auto-dev/prompts/phase8-deploy.md`

```markdown
# 部署到测试环境

## 任务
将代码部署到测试环境，确保所有组件正常运行。

## 步骤
1. 检查 {project_root}/.deploy.json 是否存在
2. 如果存在，按配置执行部署:
   - git push origin {branch}
   - 按 order 顺序调用 mcp__devops__devops_build 构建
   - 轮询 mcp__devops__devops_status 等待构建完成
   - 调用 mcp__devops__devops_deploy 部署到各环境
   - 轮询等待部署完成
3. 如果不存在，手动完成部署

## 产出
在 {output_dir}/deploy-record.md 中记录:
- 每个组件的构建版本号
- 部署的环境
- 部署状态（成功/失败）
```

#### `skills/auto-dev/prompts/phase8-integration-test.md`

```markdown
# 集成测试

## 任务
逐条验证 design.md 中的验收标准（AC），确认功能在测试环境正常工作。

## 步骤
1. 读取 {output_dir}/design.md，提取所有 AC-N
2. 为每条 AC 确定测试类型和测试手段
3. 逐条执行测试:
   - UI 测试: 使用 Playwright MCP 打开页面 → 操作 → 截图 → 验证
   - API 测试: 使用 Bash curl 调接口 → 验证返回
   - DB 测试: 使用 SSH MCP 连接数据库 → 查询验证
   - SERVICE 测试: 使用 SSH MCP 查端口/进程
4. 每条测试记录: PASS/FAIL + 验证命令 + 实际结果
5. UI 测试截图保存到 {output_dir}/screenshots/

## 产出
{output_dir}/integration-test-results.md

## 要求
- 每条 AC 必须实际执行测试，不允许跳过
- FAIL 的 AC 必须记录实际结果和验证命令
- UI 测试必须截图
- 不要伪造测试结果
```

### 5.6 state-manager.ts

`auto_dev_init` 新增 `integrationTest` 参数，写入 state.json。

### 5.7 改动文件清单

| 文件 | 改动 | 预估行数 |
|------|------|---------|
| mcp/src/types.ts | 新增 integrationTest 字段，PhaseNumber 扩展到 8 | ~10 |
| mcp/src/phase-enforcer.ts | Phase 8 元数据，动态 required phases 计算 | ~30 |
| mcp/src/orchestrator.ts | Step 8a/8b/8c 定义，验证逻辑 | ~60 |
| mcp/src/tribunal.ts | Phase 8 digest 准备 + 交叉验证 | ~40 |
| mcp/src/state-manager.ts | init 参数新增 integrationTest | ~10 |
| mcp/src/index.ts | auto_dev_init tool schema 新增参数 | ~5 |
| prompts/phase8-deploy.md | 新建 | ~30 |
| prompts/phase8-integration-test.md | 新建 | ~40 |
| **合计** | | **~225** |

## 六、修复循环（Step 8b 失败时）

```
Step 8b 测试失败
  → NEEDS_REVISION, iteration++
  → revision prompt 包含失败的 AC 和实际结果
  → agent 分析原因:
      UI 问题 → 看截图 → 改前端代码
      API 错误 → 看返回值 → 改后端代码
      数据问题 → 查 MongoDB → 修数据或改代码
      服务异常 → SSH 查日志 → 改配置或代码
  → 修复代码 → 本地构建验证
  → 回到 Step 8a 重新部署
  → 重新执行 Step 8b 测试
  → iteration < 3 ? 继续 : BLOCKED
```

这个循环天然地复用了 auto-dev 现有的迭代机制（iteration count + max limit），不需要额外实现循环控制。

## 七、风险与缓解

| 风险 | 缓解 |
|------|------|
| Context 窗口不够 | Phase 8 独立于前面的 Phase，通过 checkpoint 跨 session 恢复。Agent 在 Phase 8 只需要 design.md 的 AC 和部署信息 |
| Agent 伪造测试结果 | Tribunal 交叉验证截图文件是否存在，验证命令是否合理 |
| 部署超时阻塞 | Step 8a 有独立的迭代上限（3次），超时后 BLOCKED |
| AC 不够具体无法测试 | 这是 Phase 1 设计质量问题，不在 Phase 8 解决。可在 Phase 1 的 checklist 中增加 AC 可执行性检查 |
| 测试环境不稳定 | 非代码问题的测试失败（如环境挂了），iteration 消耗后 BLOCKED，提示用户人工处理 |

## 八、不做的事情

1. **不做测试用例自动生成** — 直接用 design.md 的 AC，不增加中间层
2. **不做测试报告飞书发送** — 留给未来阶段 3
3. **不做跨项目部署编排** — 如果前后端在不同 repo，需要分别跑 Phase 8
4. **不做并行测试** — 逐条串行执行，简单可靠
