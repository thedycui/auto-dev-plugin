# Design Review

> 审查日期：2026-04-02
> 审查人：架构评审专家（Phase 1，第 2 次审查）

---

## P0 (阻塞性问题)

无

---

## P1 (重要问题)

无（已在修订版中全部解决）

### 已解决的问题

- **P1-A**（已解决）：4.1.4a 节明确了 `effectiveRoot` 与 `effectiveCodeRoot` 的组合规则。在 worktree 模式下，`effectiveCodeRoot` 通过 `path.join(worktreeRoot, path.relative(projectRoot, codeRoot))` 计算，保留了技能类项目的子目录映射。同时明确了 `validateStep` 接收 `effectiveCodeRoot`（build/test 相关），`tribunal.ts` 接收 `effectiveRoot`（git diff 相关）。

- **P1-B**（已解决）：5.3 节明确了 Phase 8 必须在 `auto_dev_complete` 之后执行。Phase 8 的 `validateStep` 加入 guard 检查：若 `state.worktreeRoot` 仍非空（worktree 未合并），返回 `passed=false` 并提示"请先调用 auto_dev_complete"。AC-16 覆盖此场景的单元测试。

- **P1-C**（已解决）：`case "5c"` 改为 hash delta 检查，不再使用 `git diff startCommit`。基准 hash 在 5b 失败进入 5c 时记录（通过 `atomicUpdate(step="5c")` 同时写入 `lastArtifactHashes["test-files"]`），与 1c/2c 的逻辑保持一致。AC-17 覆盖未修改测试文件时验证失败的场景。

- **P1-D**（已解决）：4.7.2 节明确标注"这是一次格式重写，不仅仅是增加一个字段"，列出了影响范围（4 处 `buildRevisionPrompt` 调用、`orchestrator-prompts.test.ts` 中所有旧格式断言需同步更新），并给出了分两步实施的策略（先更新格式+快照，再填充 `previousAttemptSummary`）。AC-14 要求同步更新旧断言。

---

## P2 (优化建议)

以下问题来自上轮审查，评估为优化建议，不阻塞实现：

- **P1-E（上调为 P2）**：`checkBuildWithBaseline` 中 `installDepsIfNeeded` 的依赖安装成本无上界。设计 6.3 节已将其列为已知限制，建议实现时在 AC 注释中明确标注，待后续 PR 补充 lockfile hash 缓存方案。

- **P2-1**：`getWorktreeDir` 路径碰撞风险，建议在路径中加入 topic 的短 hash（6 位）以保证唯一性。

- **P2-2**：`stepIteration` 与 `stepEffort` 双轨并存增加维护成本，建议在同一 PR 中加注释标明 deprecation 路径。

- **P2-3**：hash 记录时机应明确为 `atomicUpdate` 的一部分（设计 4.3 节已补充说明，已达标）。

---

## 跨组件影响分析

### 变更清单

（已在原始审查中完成，修订版未引入新的接口变更）

| 序号 | 变更项 | 类型 |
|---|---|---|
| 1 | `StateJsonSchema` 新增 `worktreeRoot`、`worktreeBranch`、`sourceBranch`、`stepEffort`、`lastArtifactHashes` 字段 | 数据结构 |
| 2 | `InitInputSchema` 新增 `useWorktree` 参数 | MCP tool 参数 |
| 3 | `validateStep` 新增 `case "1c"/"2c"/"5c"/"8a"（worktree guard）` | 函数内部 |
| 4 | `advanceToNextStep` 修改 revision→parent 逻辑（effort 计数） | 函数内部 |
| 5 | `handleValidationFailure` 新增 effort budget 检查 | 函数内部 |
| 6 | `checkBuildWithBaseline` 重写（worktree 模式替代 stash） | 函数内部 |
| 7 | `buildRevisionPrompt` 格式重写（markdown 标题结构）并填充 `previousAttemptSummary` | 函数接口+实现 |
| 8 | `buildTaskForStep("3")` 嵌入 plan.md 上下文 | 函数内部 |
| 9 | `buildTaskForStep("4a")` 新增 null 返回值 | 返回类型扩展 |
| 10 | `auto_dev_init` 新增 worktree 创建逻辑 | MCP tool |
| 11 | `auto_dev_complete` 新增 merge + worktree 清理逻辑 | MCP tool |
| 12 | `EFFORT_LIMITS` 新常量 | 配置 |
| 13 | `STEP_PREREQUISITES` 新常量 | 配置 |

### 调用方影响

| 调用方 | 所在位置 | 影响类型 | 设计已覆盖 |
|---|---|---|---|
| `buildRevisionPrompt` 的 4 处调用 | `orchestrator.ts:1081, 1089, 1097, 1161` | 格式重写（breaking change） | 是（4.7.2 节明确标注，AC-14 要求同步更新测试） |
| `validateStep` 的测试 | `orchestrator.test.ts` | 新增 case 需要新测试 | 是（AC-5/6/7/16/17） |
| `computeNextTask` 接收 `buildTaskForStep` 返回 null | `orchestrator.ts` | 新增 null 返回值路径 | 是（4.7.1 节） |
| `tribunal.ts` 接收 `projectRoot` | `tribunal.ts:179, 699, 827` | 需改为 `effectiveRoot` | 是（设计提到 effectiveRoot 透传） |
| `auto_dev_complete` 调用时机 | SKILL.md | Phase 7 后、Phase 8 前的合并时机 | 是（5.3 节明确，AC-16） |

---

## 结论

PASS
