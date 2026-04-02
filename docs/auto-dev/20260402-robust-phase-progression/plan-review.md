# Plan Review

## 已解决问题

- P1-1（已解决）：Task 8 依赖字段已更正为 Task 1、Task 6，与关键路径图对齐
- P1-2（已解决）：Task 12 的完成标准中已补充 SKILL.md 更新要求——在 Phase 7 完成节点后添加"必须先调用 `auto_dev_complete` 再推进 Phase 8"的说明
- P1-3（已解决）：Task 12 的完成标准中已补充 baseline worktree 依赖安装验证——要求 `checkBuildWithBaseline` 调用 `installDepsIfNeeded(baselineDir)` 并在 finally 块中执行 `git worktree remove --force`

## P2 (优化建议，不阻塞实施)

### P2-1：Task 7 同步更新测试的风险提示

Task 7 要求"在同一 task 中完成"对 `orchestrator-prompts.test.ts` 的格式断言更新，设计文档 4.7.2 也明确强调了这一实施策略。计划在这里是正确的，但可以补充一句完成标准："`npm test -- orchestrator-prompts` 通过，且不存在跳过（skip）的测试"，以防实现者删掉测试而不是更新断言。

### P2-2：Task 13 测试文件路径歧义

Task 13 描述中写"新增 `worktree-integration.test.ts`（或在 `orchestrator.test.ts` 中新增 worktree describe block）"。"或"会让实现者面临选择，可能导致测试分散在两个文件中。建议明确指定一个位置，消除歧义。

### P2-3：EFFORT_LIMITS 常量的 `maxTribunalAttempts` 与现有逻辑的双写问题

设计文档 4.2 节指出 `tribunalSubmits` 的现有 "3次→escalate" 逻辑保留不变，`stepEffort.tribunalAttempts` 只是同步更新。Task 3 的完成标准没有验证两者是否一致（同步更新是否真的发生）。建议在 Task 9 的 AC-8 测试里补充一个验证：当 `tribunalAttempts` 递增时，对应的 `tribunalSubmits` 也同步更新。

---

## Coverage Matrix

| 设计章节/功能点 | 对应任务 | 覆盖状态 |
|----------------|---------|---------|
| 4.1.1 目标架构（worktree 目录结构） | Task 10 | OK |
| 4.1.2 Worktree 生命周期 — init 创建 worktree | Task 10 | OK |
| 4.1.2 Worktree 生命周期 — complete 合并与清理 | Task 11 | OK |
| 4.1.3 Worktree 路径规则（getWorktreeDir / getWorktreeBranch） | Task 10 | OK |
| 4.1.4 effectiveRoot 计算（computeNextTask 顶部） | Task 12 | OK |
| 4.1.4a effectiveCodeRoot 组合规则 | Task 12 | OK |
| 4.1.5 消除 stash hack（checkBuildWithBaseline 重构） | Task 12 | OK |
| 4.1.6 --no-worktree 兼容模式 | Task 10 | OK |
| 4.1.7 Resume 时 worktree 恢复 | Task 10 | OK |
| 4.2 StepEffort 数据结构（types.ts） | Task 1 | OK |
| 4.2 EFFORT_LIMITS / REVISION_TO_REVIEW 常量 | Task 1 | OK |
| 4.2 StepEffort 深度合并（state-manager.ts） | Task 2 | OK |
| 4.2 effortKeyForStep / hashContent 工具函数 | Task 2 | OK |
| 4.2 预算检查（handleValidationFailure 开头） | Task 3 | OK |
| 4.2 预算更新时机（totalAttempts++/tribunalAttempts++） | Task 3 | OK |
| 4.2 与现有计数器的关系（stepIteration 降级 fallback） | Task 3 | OK（隐含）|
| 4.3 validateStep "1c"/"2c"/"5c" 新增 case | Task 5 | OK |
| 4.3 Artifact Hash 追踪（lastArtifactHashes 记录时机） | Task 5 | OK |
| 4.4 修复 advanceToNextStep revision→parent 逻辑（P0-1） | Task 4 | OK |
| 4.5 Phase 3 空转检测（git diff 为空时返回 failed） | Task 6 | OK |
| 4.6 STEP_PREREQUISITES 常量 + checkPrerequisites 函数 | Task 6 | OK |
| 4.7.1 Phase 4a 空 dispatch（buildTaskForStep 返回 null） | Task 8 | OK |
| 4.7.2 buildRevisionPrompt 格式重写为 markdown 标题 | Task 7 | OK |
| 4.7.2 previousAttemptSummary 填充 + buildPreviousAttemptSummary | Task 7 | OK |
| 4.7.3 Phase 3 嵌入 plan.md 全文 + design 目标摘要 | Task 8 | OK |
| 5.1 向后兼容（旧 state.json 不 crash） | Task 13 AC-11 | OK |
| 5.3 Phase 8 守卫（validateStep("8a") 检查 worktreeRoot） | Task 12 | OK |
| 5.3 SKILL.md 流程文档更新（Phase 7 → complete → Phase 8） | Task 12 | OK |
| 6 风险缓解 — baseline worktree 依赖安装 | Task 12 | OK |
| AC-1 worktree 隔离验证 | Task 13 | OK |
| AC-2 complete 合并验证 | Task 13 | OK |
| AC-3 tribunal diff 隔离验证 | Task 13 | OK |
| AC-4 无 stash 调用验证 | Task 13 | OK |
| AC-5 revision 循环上限 | Task 9 | OK |
| AC-6 validateStep("1c") delta check | Task 9 | OK |
| AC-7 Phase 3 空 diff 阻止 | Task 9 | OK |
| AC-8 effort_exhausted escalation | Task 9 | OK |
| AC-9 prerequisite_missing escalation | Task 9 | OK |
| AC-10 --no-worktree 全流程兼容 | Task 13 | OK |
| AC-11 旧 state.json 不 crash | Task 13 | OK |
| AC-12 resume worktree 重建 | Task 13 | OK |
| AC-13 Phase 4a agent=null | Task 9 | OK |
| AC-14 revision prompt 格式 + previousAttemptSummary | Task 9 | OK |
| AC-15 Phase 3 prompt 含 plan 上下文 | Task 9 | OK |
| AC-16 Phase 8 守卫 | Task 9 + Task 12 | OK |
| AC-17 validateStep("5c") delta check | Task 9 | OK |

---

## 结论

PASS
