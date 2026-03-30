# 设计文档：可观测性门禁 & 部署后验证闭环

## 背景与动机

### 真实案例

在 metrics-web 项目中，修复 SqlBuilder 的 STRING 类型聚合问题时：

1. **核心修复只有几行代码**（STRING 类型跳过 `toFloat64OrZero`），但验证环节耗费了 5+ 轮构建部署
2. **根因**：改了逻辑但没加日志 → 部署后无法确认改动是否生效 → 盲目重复部署
3. **触发点**：用户手动介入说"多加日志"、"自己测试"后才打破死循环

### 暴露的 auto-dev 框架缺陷

当前 auto-dev 的 7 阶段闭环覆盖了「写代码 → 测试通过」，但存在两个 gap：

| Gap | 描述 | 后果 |
|-----|------|------|
| **可观测性缺失** | 实现阶段不要求关键路径日志 | 部署后无法定位问题，只能反复猜测 |
| **部署验证缺失** | 没有"部署后自主验证"步骤 | agent 完成代码后就结束了，真实环境的问题留给用户 |

---

## 改动范围

### 方案 A：轻量级 — Prompt 增强 + Review 检查项（推荐）

仅修改 prompt 模板和 review checklist，不改动 orchestrator 核心逻辑。

**改动文件：**

| 文件 | 改动 |
|------|------|
| `skills/auto-dev/prompts/phase3-developer.md` | 新增「可观测性要求」章节 |
| `skills/auto-dev/prompts/phase4-full-reviewer.md` | 新增「可观测性审查」Must-Execute Rule |
| `skills/auto-dev/checklists/code-review-common.md` | 新增日志覆盖检查项 |
| `skills/auto-dev/prompts/phase1-architect.md` | AC 模板新增可选的「可观测性 AC」引导 |

**优点：** 零架构改动，向后兼容，立即可用
**缺点：** 依赖 agent 自觉遵守，无框架级强制

### 方案 B：重量级 — 新增部署验证阶段（Phase 4.5）

在 orchestrator 中新增一个可选的「部署后验证」步骤。

**改动文件：**

| 文件 | 改动 |
|------|------|
| `mcp/src/orchestrator.ts` | STEP_ORDER 新增 "4b"（部署验证步骤） |
| `mcp/src/orchestrator.ts` | STEP_AGENTS 新增 "4b" → "auto-dev-developer" |
| `mcp/src/orchestrator.ts` | validateStep 新增 case "4b" |
| `mcp/src/types.ts` | StateJson 新增 `deployVerify` 配置字段 |
| `skills/auto-dev/prompts/phase4b-deploy-verify.md` | 新增部署验证 prompt |
| `skills/auto-dev/prompts/phase3-developer.md` | 同方案 A 的可观测性要求 |
| `skills/auto-dev/prompts/phase4-full-reviewer.md` | 同方案 A 的审查规则 |

**优点：** 框架级强制，适用于需要部署验证的项目
**缺点：** 改动较大，且不是所有项目都需要部署验证

### 推荐

先落地方案 A（prompt 增强），后续根据实际使用情况决定是否追加方案 B。

---

## 方案 A 详细设计

### 1. Phase 3 开发者 Prompt 新增「可观测性要求」

在 `phase3-developer.md` 的 Requirements 章节后新增：

```markdown
## 可观测性要求

当改动涉及以下场景时，**必须**在关键节点添加 WARN 级别日志：

1. **数据转换/类型转换**：输入类型 + 输出类型 + 转换前后的值
2. **外部系统调用**（数据库查询、RPC、HTTP）：请求参数摘要 + 响应状态 + 首条结果的类型和值
3. **聚合/计算逻辑**：输入数据条数 + 计算方式 + 输出结果
4. **条件分支**（if/switch on type/config）：实际走了哪个分支 + 判断依据

### 日志规范
- 级别：WARN（确保在所有环境都能输出）
- 前缀：`[TRACE]`（便于 grep 过滤和后续清理）
- 内容：包含变量值和类型，不只是 "进入了 XX 方法"
- 示例：`logger.warn("[TRACE] SQL生成: type={}, calcMethod={}, sql={}", dataType, calcMethod, sql);`

### 不需要加日志的场景
- 纯粹的 CRUD（框架已有日志）
- getter/setter、DTO 转换
- 单元测试已完全覆盖的纯函数
```

### 2. Phase 4 Code Review 新增 Must-Execute Rule

在 `phase4-full-reviewer.md` 新增第三条 Must-Execute Rule：

```markdown
### Rule 3: Observability Coverage（可观测性覆盖）

当本次改动涉及数据转换、外部调用、聚合计算、条件分支时：

1. 检查每个改动点是否有对应的日志输出
2. 日志是否包含实际值和类型（不是空洞的 "method called"）
3. 日志级别是否足够高（WARN 级别，不是 DEBUG/INFO 可能被过滤）

| 改动点 | 是否有日志 | 日志内容是否充分 | 级别 |
|--------|-----------|-----------------|------|
| ... | 是/否 | 充分/不足/缺失 | WARN/INFO/无 |

> 没有日志的数据转换 = 盲区。部署后出问题时，没有日志就只能靠猜。
> 标记为 P1，除非改动已被单元测试 100% 覆盖。
```

### 3. Code Review Common Checklist 新增检查项

在 `checklists/code-review-common.md` 追加：

```markdown
## 可观测性
- [ ] 数据转换/类型转换处有 WARN 级别日志，包含输入输出值和类型
- [ ] 外部系统调用处有日志，包含请求摘要和响应状态
- [ ] 条件分支处有日志，说明走了哪个分支和判断依据
```

### 4. Phase 1 设计文档引导

在 `phase1-architect.md` 的 AC 模板说明中追加一条可选引导：

```markdown
### AC 编写提示

如果改动涉及跨系统数据流或类型转换，考虑增加一条可观测性 AC：
- 例：`AC-N: 关键数据转换节点有 WARN 级别日志，包含输入/输出值和类型，可通过 grep '[TRACE]' 验证`
```

---

## 方案 B 详细设计（预留）

### 新增步骤 4b：部署后验证

仅当 `state.deployVerify` 配置存在时激活。

#### state.json 扩展

```typescript
// types.ts StateJson 新增
deployVerify?: {
  /** 部署命令或脚本 */
  deployCmd: string;
  /** 验证用的 API endpoint 或 curl 命令 */
  verifyCmd: string;
  /** 日志路径（SSH 场景） */
  logPath?: string;
  /** SSH 配置（远程场景） */
  ssh?: {
    host: string;
    user: string;
  };
}
```

#### orchestrator.ts 改动

```typescript
// STEP_ORDER 变为
const STEP_ORDER = ["1a", "1b", "2a", "2b", "3", "4a", "4b", "5a", "5b", "6", "7"];

// STEP_AGENTS 新增
"4b": "auto-dev-developer",

// validateStep 新增 case "4b"
case "4b": {
  // 1. 执行 deployCmd
  // 2. 等待部署完成（polling deployStatus）
  // 3. 执行 verifyCmd，检查返回值
  // 4. 如果有 logPath，grep '[TRACE]' 检查日志输出
  // passed = verifyCmd 成功 && 日志中有预期输出
}
```

#### phase4b-deploy-verify.md prompt

```markdown
# 部署后验证

## Task
部署最新代码到测试环境并验证功能正确性。

## Steps
1. 执行部署命令：`{deploy_cmd}`
2. 等待部署完成（检查健康检查端点）
3. 执行验证命令：`{verify_cmd}`
4. 检查日志输出：`grep '[TRACE]' {log_path}`
5. 确认关键数据转换的日志值符合预期

## Success Criteria
- 部署成功且服务健康
- 验证命令返回预期结果
- 日志中包含 [TRACE] 标记的关键路径输出
```

---

## 验收标准

### 方案 A

| AC | 描述 | 验证方式 |
|----|------|---------|
| AC-1 | phase3 prompt 包含可观测性要求章节 | 读取 phase3-developer.md 确认 |
| AC-2 | phase4 prompt 包含 Observability Coverage 审查规则 | 读取 phase4-full-reviewer.md 确认 |
| AC-3 | code-review-common checklist 包含日志覆盖检查项 | 读取 checklist 确认 |
| AC-4 | 在一个测试项目上运行 auto-dev full 流程，code review 阶段能检出"缺少日志"的 P1 问题 | 手动集成测试 |

### 方案 B（预留）

| AC | 描述 | 验证方式 |
|----|------|---------|
| AC-5 | STEP_ORDER 包含 "4b"，且仅在 deployVerify 配置存在时激活 | 单元测试 |
| AC-6 | validateStep("4b") 执行部署+验证+日志检查 | 单元测试 |
| AC-7 | 无 deployVerify 配置时，4b 被跳过，行为与现有版本一致 | 回归测试 |

---

## 风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| agent 忽视 prompt 中的可观测性要求 | 日志仍然不加 | Phase 4 的 Must-Execute Rule 会在 code review 时强制检查，tribunal 会审计 |
| 过度加日志导致代码臃肿 | 噪音太多 | prompt 中明确了"不需要加日志的场景"，review 时同样会检查 |
| 方案 B 的 deployCmd 在 CI 环境不可用 | 部署验证步骤失败 | deployVerify 为可选配置，不配置则跳过 |

---

## 实现计划概要

### 方案 A（预估改动 ~80 行 prompt/markdown）

| 任务 | 文件 | 预估 |
|------|------|------|
| T1 | phase3-developer.md 新增可观测性章节 | 20 行 |
| T2 | phase4-full-reviewer.md 新增 Rule 3 | 25 行 |
| T3 | code-review-common.md 新增 checklist | 10 行 |
| T4 | phase1-architect.md 新增 AC 引导 | 5 行 |
| T5 | 集成测试验证 | 手动 |
