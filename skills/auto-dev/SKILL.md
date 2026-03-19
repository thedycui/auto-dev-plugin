---
name: auto-dev
description: "自治开发循环 — 从设计到测试通过的全自动闭环。支持自审迭代，最小化人工介入。Use when user says /auto-dev, asks for autonomous development, wants a full dev loop (design -> plan -> implement -> verify -> e2e test), or mentions '自治开发', '自动开发循环', '全自动闭环', 'autonomous dev', 'auto implement'. Also use when user provides a design doc and wants it implemented end-to-end without manual intervention."
---

# auto-dev (Plugin-Powered v5.1)

> 本 skill 由 auto-dev Plugin 的 MCP 工具和 Agent 定义驱动。
> **默认全自动，零确认** — 这是 auto-dev 的第一性原理。

## 初始化

1. 调用 `auto_dev_init(projectRoot, topic, mode, interactive?, dryRun?)` → 获取技术栈和变量
   - 返回 `OUTPUT_DIR_EXISTS` → 展示已有状态，让用户选择 resume/overwrite，再次调用 init
2. **默认模式（全自动）**：
   - 记录当前分支名和 HEAD commit 到 progress-log
   - `git checkout -b feature/auto-dev-{topic}` 创建新分支（未提交变更会带到新分支）
   - 如果已在 `feature/auto-dev-{topic}` 分支上（--resume），直接继续
   - 一行状态输出后直接继续，不等确认
3. **`--interactive` 模式**：
   - 如果 `git.isDirty` → 展示 diff stat，让用户选择 a) commit b) stash c) 不处理 d) 取消
   - 展示完整变量表，等用户确认

## Phase 1: DESIGN (max 3 iterations)

1. `auto_dev_preflight(phase=1)` → 检查前置条件
2. `auto_dev_render("phase1-architect", variables)` → 获取渲染后的 prompt
3. 用渲染后 prompt 调用 **auto-dev-architect** Agent → 产出 design.md
4. `auto_dev_checkpoint(phase=1, status="IN_PROGRESS")`
5. `auto_dev_render("phase1-design-reviewer", variables)` → 调用 **auto-dev-reviewer** Agent
6. 读 review 结果 → PASS / NEEDS_REVISION
7. `auto_dev_checkpoint(phase=1, status=result)`
8. `--interactive` 模式：PASS 后展示摘要等用户确认

## Phase 2: PLAN (max 3 iterations)

与 Phase 1 类似：preflight → render → auto-dev-architect Agent → checkpoint → render review → auto-dev-reviewer Agent → checkpoint

**`--dry-run` 模式**：Phase 2 通过后 `auto_dev_checkpoint(status="COMPLETED")` 并停止。

## Phase 3: EXECUTE (串行，每任务 max 2 fix)

对 plan.md 中每个任务：
1. 记录 `task_start_commit = git rev-parse HEAD`
2. `auto_dev_render("phase3-developer", variables + task_context)` → 调用 **auto-dev-developer** Agent
3. Claude 直接执行 `git add <files> && git commit -m "auto-dev({topic}): Task N - title"`
4. `auto_dev_diff_check(expectedFiles, task_start_commit)` → 异常文件警告
5. 调用 **auto-dev-reviewer** Agent 快速审查
6. `auto_dev_checkpoint(phase=3, task=N, status=result)`
7. 如果 NEEDS_FIX → 修复 → 再审查一次
8. 如果仍 NEEDS_FIX → `auto_dev_git_rollback(task_start_commit)` → 标记 BLOCKED

## Phase 4: VERIFY

1. Claude 执行 `{build_cmd}` → 失败则用 bug-analyzer + fix（max 3 次）
2. Claude 执行 `{test_cmd}` → 失败则用 bug-analyzer + fix（max 3 次）
3. `auto_dev_render("phase4-full-reviewer", variables)` → 调用 **auto-dev-reviewer** Agent 整体审查
4. `auto_dev_checkpoint(phase=4, status=result)`

## Phase 5: E2E TEST

1. `auto_dev_render("phase5-test-architect", variables)` → 调用 **auto-dev-test-architect** Agent 设计用例
2. 调用 **auto-dev-reviewer** Agent 审查覆盖度
3. `auto_dev_render("phase5-test-developer", variables)` → 调用 **auto-dev-developer** Agent 实现
4. Claude 执行测试 → 失败则 bug-analyzer + fix + 重跑
5. `auto_dev_checkpoint(phase=5, status=result)`

## Phase 6: ACCEPTANCE（验收）

1. `auto_dev_preflight(phase=6)` → 检查 e2e-test-results.md 存在
2. 调用 **auto-dev-acceptance-validator** Agent：
   - 从 design.md 提取验收标准（AC-N 条目）
   - 逐条验证（代码 + 测试 + 运行验证）
   - 产出 `{output_dir}/acceptance-report.md`
3. 判定：
   - **PASS**：所有 AC 均为 PASS 或 SKIP（无 FAIL）→ `auto_dev_checkpoint(phase=6, status="PASS")`
   - **FAIL**：有 FAIL 项 → 调用 **auto-dev-developer** Agent 修复 → 重新验收（max 2 次）
   - **BLOCKED**：2 次修复后仍有 FAIL
4. 如 design.md 无验收标准章节 → 跳过 Phase 6，记录 "No AC found, skipping"

## 上下文管理

**不主动 compact**，依赖 Claude Code 自动压缩。但确保压缩后可恢复：

**Phase 间状态锚点**：每个 Phase 完成时，在主对话中输出以下格式的摘要（这段文字在压缩后仍可保留核心信息）：

```
---
auto-dev 状态: Phase {N} {name} {PASS/BLOCKED}（第 {X} 次迭代）
topic: {topic} | branch: {branch} | output: {output_dir}
下一步: Phase {N+1} {next_name}
如果上下文被压缩，请 Read {output_dir}/progress-log.md 恢复完整状态
---
```

**为什么不主动 compact**：
- 主动 compact 可能丢失 SKILL.md 的流程指令
- Subagent 已隔离上下文（主要消耗不在主 agent）
- 所有状态已持久化（progress-log + state.json + CHECKPOINT），压缩后可从磁盘恢复

## 完成后

1. Claude 读取 state.json + progress-log.md 汇总统计
2. `auto_dev_checkpoint(status="COMPLETED")`
3. 提示下一步：
   a. /commit — 整理 commit 历史
   b. git merge 到测试分支
   c. /impact-check — 跨项目评估
   d. 创建 PR
   e. 切回原分支继续其他工作

## Quick Mode (--quick)

跳过 Phase 1-2：直接实现 → 快速审查 → build + test → 完成
