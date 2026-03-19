---
name: auto-dev
description: "自治开发循环 — 从设计到测试通过的全自动闭环。支持自审迭代，最小化人工介入。Use when user says /auto-dev, asks for autonomous development, wants a full dev loop (design -> plan -> implement -> verify -> e2e test), or mentions '自治开发', '自动开发循环', '全自动闭环', 'autonomous dev', 'auto implement'. Also use when user provides a design doc and wants it implemented end-to-end without manual intervention."
---

# auto-dev (Plugin-Powered v5)

> 本 skill 由 auto-dev Plugin 的 MCP 工具和 Agent 定义驱动。

## 初始化

1. 调用 `auto_dev_init(projectRoot, topic, mode)` → 获取技术栈和变量
   - 返回 `OUTPUT_DIR_EXISTS` → 展示已有状态，让用户选择 resume/overwrite，再次调用 init
2. 如果 `git.isDirty` → 展示 diff stat，让用户选择：
   a) commit 后继续 b) stash c) 不处理 d) 取消
3. 展示变量表和成本预估，等用户确认

## Phase 1: DESIGN (max 3 iterations)

1. `auto_dev_preflight(phase=1)` → 检查前置条件
2. `auto_dev_render("phase1-architect", variables)` → 获取渲染后的 prompt
3. 用渲染后 prompt 调用 **auto-dev-architect** Agent → 产出 design.md
4. `auto_dev_checkpoint(phase=1, status="IN_PROGRESS")`
5. `auto_dev_render("phase1-design-reviewer", variables)` → 调用 **auto-dev-reviewer** Agent
6. 读 review 结果 → PASS / NEEDS_REVISION
7. `auto_dev_checkpoint(phase=1, status=result)`
8. PASS 且非 --no-confirm → 展示摘要等用户确认

## Phase 2: PLAN (max 3 iterations)

与 Phase 1 类似：preflight → render → auto-dev-architect Agent → checkpoint → render review → auto-dev-reviewer Agent → checkpoint

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

## 完成后

1. Claude 读取 state.json + progress-log.md 汇总统计
2. `auto_dev_checkpoint(status="COMPLETED")`
3. 如有 stash → Claude 执行 `git stash pop`
4. 提示下一步：/commit, merge, /impact-check, PR

## Quick Mode (--quick)

跳过 Phase 1-2：直接实现 → 快速审查 → build + test → 完成
