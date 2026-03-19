# auto-dev Plugin v5.1 增量设计：v4 SKILL 对齐

> 将 v4 SKILL.md 的新增内容同步到 Plugin v5。
> 聚焦两个核心变更：Phase 6 验收 + 默认行为反转。

## 1. 变更清单

### 1.1 Phase 6: ACCEPTANCE（验收阶段）— 新增

**来源**: v4 SKILL.md 新增的 Phase 6 章节

**功能描述**:
- Phase 5 (E2E TEST) 通过后，新增 Phase 6 验收阶段
- 从 design.md 提取验收标准（AC-N 条目）
- 逐条验证：代码验证 + 测试验证 + 运行验证（如可行）
- 产出 `acceptance-report.md`，含每条 AC 的 PASS/FAIL/SKIP 状态
- PASS 条件：所有 AC 均为 PASS 或 SKIP（无 FAIL）
- FAIL 时调用 Developer 修复 → 重新验收（最多 2 次）

### 1.2 默认行为反转 — 全自动模式

**来源**: v4 SKILL.md 将默认模式从"交互确认"改为"全自动零确认"

**变更**:
| 行为 | Plugin v5 (当前) | v4 SKILL / Plugin v5.1 (目标) |
|------|-----------------|------|
| Git dirty 处理 | 展示选项等用户选择 | **自动建 feature 分支，带走未提交变更** |
| Phase 1 后确认 | 默认等确认，`--no-confirm` 跳过 | **默认直接继续，`--interactive` 才等确认** |
| Init 输出 | 展示完整变量表 + 等确认 | **一行状态输出，直接继续** |
| 完成后 stash pop | 如有 stash 提示恢复 | **不 stash，不需要恢复** |

### 1.3 `--dry-run` 模式 — 新增

只跑 Phase 1-2（设计 + 计划），不实现。产出 design.md + plan.md 后停止。

### 1.4 `--interactive` 标志 — 替代原 `--no-confirm`

- `--interactive`: 启用交互模式（Phase 1 后等确认、git dirty 询问用户）
- 默认（无标志）: 全自动，零确认

## 2. 需要修改的 Plugin 组件

### 2.1 MCP Server 修改

#### 2.1.1 `auto_dev_init` 参数扩展

```typescript
// 新增参数
interface InitInput {
  // ... 现有参数 ...
  interactive?: boolean;  // 替代 noConfirm（语义反转）
  dryRun?: boolean;       // 只跑 Phase 1-2
}
```

**实现变更**:
- `interactive` 写入 state.json（供 SKILL.md 读取判断行为）
- `dryRun` 写入 state.json（Phase 2 通过后 SKILL.md 直接标记 COMPLETED）

#### 2.1.2 `auto_dev_preflight` Phase 6 支持

```
Phase 特定前置检查新增：
| Phase | 前置条件 |
| 6     | e2e-test-results.md 存在且通过 |
```

**实现变更**: preflight 工具的 phase-specific checks 新增 phase=6 分支。

#### 2.1.3 `auto_dev_checkpoint` Phase 6 支持

无代码改动——checkpoint 已支持任意 phase number。state.json 的 phase 字段是 `z.number().int()`，无硬编码上限。

#### 2.1.4 `types.ts` 扩展

```typescript
// StateJson 新增字段
interface StateJson {
  // ... 现有字段 ...
  interactive?: boolean;
  dryRun?: boolean;
}
```

### 2.2 新增 Agent 定义

#### `agents/auto-dev-acceptance-validator.md`

```markdown
---
description: Acceptance validator for auto-dev Phase 6. Validates implementation against acceptance criteria (AC-N) from design.md.
capabilities: ["acceptance-testing", "code-verification", "test-verification"]
---

# Auto-Dev Acceptance Validator

你是验收专家。你的任务是逐条验证设计文档中的验收标准（AC-N）是否被正确实现。

## 验证方式（按优先级）

1. **代码验证**：读相关源码，确认功能逻辑已实现
2. **测试验证**：确认有对应的测试用例且通过
3. **运行验证**（如可行）：构造输入数据实际运行，验证输出

## 输出格式

### acceptance-report.md

| AC | 描述 | 验证方式 | 结果 | 证据 |
|----|------|---------|------|------|
| AC-1 | ... | 代码审查 + 单元测试 | PASS | XxxTest.testYyy() |
| AC-2 | ... | 代码审查 | FAIL | 未找到相关实现 |
| AC-3 | ... | 无法验证 | SKIP | 需要集成环境 |

通过率：X/Y PASS, Z FAIL, W SKIP
结论：PASS / FAIL

## 约束

- AC 来源必须是 design.md，不要自己编造验收标准
- SKIP 必须说明原因（如"需要集成环境"、"需要外部服务"）
- FAIL 必须给出具体缺失点和修复建议
- 不做 AC 之外的额外验证（不 scope creep）
```

### 2.3 SKILL.md 更新

需要更新的内容：

1. **初始化流程**：
   - 默认全自动：auto_dev_init 后不等确认，直接继续
   - Git dirty 处理改为自动建分支
   - `--interactive` 模式下才展示选项

2. **新增 Phase 6 章节**（在 Phase 5 之后）

3. **Pre-flight 表**：新增 Phase 6 行

4. **完成后收尾**：
   - 移除 stash pop 逻辑
   - 新增"切回原分支"选项

5. **`--interactive` 替代 `--no-confirm`**

6. **`--dry-run` 模式**

7. **文件目录结构**：新增 `acceptance-report.md`

### 2.4 commands/auto-dev.md 更新

新增 `--dry-run` 和 `--interactive` 参数说明。

## 3. 不需要修改的组件

| 组件 | 原因 |
|------|------|
| `state-manager.ts` | StateJson schema 用 `.optional()` 声明新字段，不影响向后兼容 |
| `template-renderer.ts` | 无变更 |
| `git-manager.ts` | 无变更 |
| `lessons-manager.ts` | 无变更 |
| `index.ts` 大部分工具 | 只有 init 和 preflight 需要小改 |
| `hooks/` | 无变更 |
| 现有 Agent 定义 | 无变更，新增一个 acceptance-validator |
| `checklists/` | 无变更 |
| `stacks/` | 无变更 |

## 4. 实施任务

| # | 任务 | 复杂度 | 文件 |
|---|------|--------|------|
| 1 | types.ts 新增 interactive/dryRun 字段 | S | mcp/src/types.ts |
| 2 | auto_dev_init 支持 interactive/dryRun 参数 | S | mcp/src/index.ts |
| 3 | auto_dev_preflight 新增 Phase 6 检查 | S | mcp/src/index.ts |
| 4 | 新增 auto-dev-acceptance-validator Agent | S | agents/auto-dev-acceptance-validator.md |
| 5 | 更新 SKILL.md（Phase 6 + 行为反转 + dry-run） | M | skills/auto-dev/SKILL.md |
| 6 | 更新 commands/auto-dev.md | S | commands/auto-dev.md |

**总工作量**: 5S + 1M ≈ 4h

## 5. 向后兼容性

| 方面 | 兼容性 |
|------|--------|
| state.json | `interactive` 和 `dryRun` 是 optional 字段，旧 state.json 不含这些字段时默认 `false`（全自动） |
| SKILL.md | v5 → v5.1 的行为变更：默认不再等确认。习惯了旧行为的用户需要加 `--interactive` |
| Phase 6 | 新增阶段，不影响 Phase 1-5 的流程。`--resume` 恢复到 Phase 6 之前的 checkpoint 不受影响 |
| MCP 工具 | init 新增 optional 参数，不影响已有调用 |

## 6. 风险

| 风险 | 缓解 |
|------|------|
| 默认全自动可能导致意外操作（如自动建分支） | auto-dev 分支命名有固定前缀 `feature/auto-dev-{topic}`，不会覆盖已有分支 |
| Phase 6 验收标准可能在 design.md 中缺失 | 如果 design.md 没有验收标准章节，Phase 6 跳过并在 progress-log 中记录 "No acceptance criteria found, skipping Phase 6" |
| dry-run 模式下 Phase 3+ 的产出文件不存在 | preflight 检查会阻止进入 Phase 3+，但 COMPLETED checkpoint 标记需要在 Phase 2 后写入 |
