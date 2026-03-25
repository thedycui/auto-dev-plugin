---
name: auto-dev
description: "自治开发循环 — 从设计到测试通过的全自动闭环。支持自审迭代，最小化人工介入。Use when user says /auto-dev, asks for autonomous development, wants a full dev loop (design -> plan -> implement -> verify -> e2e test), or mentions '自治开发', '自动开发循环', '全自动闭环', 'autonomous dev', 'auto implement'. Also use when user provides a design doc and wants it implemented end-to-end without manual intervention."
---

# auto-dev (Plugin-Powered v7.0)

> 本 skill 由 auto-dev Plugin 的 MCP 工具和 Agent 定义驱动。
> **默认全自动，零确认** — 这是 auto-dev 的第一性原理。
> **严禁在非 interactive 模式下暂停等待用户确认、询问"是否继续"、或展示摘要等用户回复。Phase 之间必须直接推进，不停顿。**

## ⚠️ 强制执行规则（最高优先级）

**以下规则不可绕过、不可跳过、不可合理化：**

1. **Phase 必须按顺序执行**：1 → 2 → 3 → 4 → 5 → 6 → 7(auto_dev_complete 自动触发)。每个 checkpoint 返回值中包含 `mandate` 字段，必须遵守。
2. **禁止在未调用 `auto_dev_complete` 的情况下向用户宣称任务完成**。`auto_dev_complete` 会验证所有必需 Phase 是否已 PASS，未通过则拒绝。
3. **Phase 3 完成 ≠ 任务完成**。代码写完只是中间状态，Phase 4 (验证) 和 Phase 5 (测试) 才是质量保障的核心。
4. **编译通过 ≠ 验证通过**。Phase 4 要求执行 build_cmd + test_cmd + 全量代码审查。
5. **禁止通过 checkpoint 设置 COMPLETED 状态**。checkpoint 只接受 IN_PROGRESS/PASS/NEEDS_REVISION/BLOCKED/REGRESS。完成只有一条路：`auto_dev_complete()`。框架会硬拒绝 checkpoint(status=COMPLETED)。
6. **checkpoint 会验证前置阶段**。checkpoint(phase=N, status=PASS) 会被拒绝，除非 phase N-1 已有 PASS 记录。框架层面硬拒绝，禁止跳阶段。
7. **Phase 7 (RETROSPECTIVE) 不可跳过**。必须作为独立阶段由 subagent 执行深度分析。
8. **禁止 agent 自行设置 `skipE2e=true`**。只有用户在命令中显式传入 `--skip-e2e` 时才可设置。init 参数会被写入 progress-log INIT 标记，`auto_dev_complete` 会校验一致性，篡改会被检测。
9. **禁止篡改 testCmd/buildCmd**。框架在 init 时将原始命令写入 progress-log（不可修改），checkpoint 和 complete 从日志读取原始命令执行。篡改 state.json 中的命令会被检测并拒绝。
10. **禁止伪造测试报告**。Phase 5 checkpoint 会由框架自己执行 testCmd 验证，不依赖 agent 声称的结果。
11. **Phase 1/2 PASS 要求 review 产物**。checkpoint(phase=1, PASS) 要求 design-review.md 存在，checkpoint(phase=2, PASS) 要求 plan-review.md 存在。禁止跳过 reviewer 直接 PASS。

### 驱动循环

```
init → preflight(0)  # if --brainstorm
while phase <= maxPhase:
    result = preflight(phase)             # 返回 suggestedPrompt + suggestedAgent
    用 result.suggestedPrompt 调用 result.suggestedAgent
    auto_dev_lessons_feedback(feedbacks)  # 对注入的经验逐条反馈，必须在 checkpoint PASS 之前
    checkpoint_result = checkpoint(phase, status, tokenEstimate?)
    遵守 checkpoint_result.mandate        # 强制下一步
    phase = checkpoint_result.nextPhase
auto_dev_complete()                       # 唯一的完成入口 → 验证所有 phase → build → test → Phase 7 RETROSPECTIVE → COMPLETED
# ⚠️ 任何其他方式宣称完成都是违规。checkpoint(status=COMPLETED) 会被框架硬拒绝。
```

**重要约束**：
- **经验反馈（lessons feedback）**：每个 Phase 完成后、调用 `checkpoint(status="PASS")` 之前，必须调用 `auto_dev_lessons_feedback` 对 preflight 注入的经验逐条反馈。三种 verdict：
  - `helpful`：该经验对本阶段确实有帮助
  - `not_applicable`：该经验与本阶段无关
  - `incorrect`：该经验内容有误或已过时
  Checkpoint 会拒绝 PASS 如果仍有未反馈的经验（`injectedLessonIds` 非空）。
- checkpoint 返回的 `mandate` 字段是强制指令，不是建议。如果你发现自己在想"这个 Phase 可以跳过"——停下来，你在合理化。
- `auto_dev_state_update` **不能修改 phase 和 status**（已从 schema 移除），只能改辅助字段（task, iteration, flags）。Phase/status 变更**必须**通过 `auto_dev_checkpoint`。
- `auto_dev_preflight` 返回 `suggestedPrompt` 和 `suggestedAgent`，**优先使用**它们而非手动调用 `auto_dev_render`。
- `auto_dev_checkpoint` 可选传入 `tokenEstimate` 追踪 token 消耗。

## 变量映射

`auto_dev_init` 返回的值需要映射为 `auto_dev_render` 的 variables：

| init 返回字段 | render 变量名 | 说明 |
|--------------|-------------|------|
| `topic` | `topic` | 主题 |
| `language` | `language` | 语言 |
| `buildCmd` | `build_cmd` | 编译命令 |
| `testCmd` | `test_cmd` | 测试命令 |
| `langChecklist` | `lang_checklist` | 语言专属 checklist 文件名 |
| `outputDir` | `output_dir` | 输出目录 |
| `projectRoot` | `project_root` | 项目根目录 |
| `branch` | `branch` | 当前分支 |

Phase 3 额外变量：`task_context`（当前任务的描述、文件列表、依赖等，从 plan.md 中提取）

## 初始化

1. 调用 `auto_dev_init(projectRoot, topic, mode, interactive?, dryRun?, skipE2e?)` → 获取技术栈和变量
   - `skipE2e=true`：跳过 Phase 5（E2E 测试），适用于小改动/配置修改/纯重构
   - `tdd=false`：关闭 TDD 模式（默认开启，Phase 3 每个 task 执行 RED-GREEN-REFACTOR）
   - `brainstorm=true`：启用 Phase 0（需求探索），适用于模糊需求
   - 返回 `OUTPUT_DIR_EXISTS` → 展示已有状态，让用户选择 resume/overwrite，再次调用 init
   - resume 时返回 `resumeTask` / `resumeTaskStatus`，用于 Phase 3 task 级恢复
2. **默认模式（全自动）**：
   - 记录当前分支名和 HEAD commit 到 progress-log
   - `git checkout -b feature/auto-dev-{topic}` 创建新分支（未提交变更会带到新分支）
   - 如果已在 `feature/auto-dev-{topic}` 分支上（--resume），直接继续
   - 一行状态输出后直接继续，不等确认
3. **`--interactive` 模式**：
   - 如果 `git.isDirty` → 展示 diff stat，让用户选择 a) commit b) stash c) 不处理 d) 取消
   - 展示完整变量表，等用户确认

## Phase 0: BRAINSTORM (可选，max 2 iterations)

> `--brainstorm` 启用，或用户输入 < 50 字且无 design.md 时自动触发

1. `auto_dev_preflight(phase=0)` → 检查前置条件
2. 调用 **auto-dev-architect** Agent → 苏格拉底式探索：问题定义、2-3 方案对比、推荐方向
3. 产出 `brainstorm-notes.md`（自动注入 Phase 1 作为 extraContext）
4. `auto_dev_checkpoint(phase=0, status="PASS")`
5. **默认模式：PASS 后直接进入 Phase 1，禁止暂停**

## Phase 1: DESIGN (max 3 iterations)

1. `auto_dev_preflight(phase=1)` → 检查前置条件
   - **如果 design.md 已存在**（用户提供了设计文档），preflight 返回 `designExists=true`，suggestedPrompt 为 reviewer 而非 architect。此时**跳过步骤 2-3，直接进入步骤 5 审查**。禁止重新生成设计文档。
   - **如果 design.md 不存在**，按正常流程执行步骤 2-3 生成设计。
2. `auto_dev_render("phase1-architect", variables)` → 获取渲染后的 prompt（仅当 design.md 不存在时）
3. 用渲染后 prompt 调用 **auto-dev-architect** Agent → 产出 design.md（仅当 design.md 不存在时）
4. `auto_dev_checkpoint(phase=1, status="IN_PROGRESS")`
5. `auto_dev_render("phase1-design-reviewer", variables)` → 调用 **auto-dev-reviewer** Agent
6. 读 review 结果 → PASS / NEEDS_REVISION
7. `auto_dev_checkpoint(phase=1, status=result)`
8. `--interactive` 模式：PASS 后展示摘要等用户确认
9. **默认模式：PASS 后直接进入 Phase 2，禁止暂停、禁止询问用户、禁止等待确认**

## Phase 2: PLAN (max 3 iterations)

1. `auto_dev_preflight(phase=2)` → 检查前置条件（design.md 必须存在）
2. `auto_dev_render("phase2-planner", variables)` → 获取渲染后的 prompt
3. 用渲染后 prompt 调用 **auto-dev-architect** Agent → 产出 plan.md
4. `auto_dev_checkpoint(phase=2, status="IN_PROGRESS")`
5. `auto_dev_render("phase2-plan-reviewer", variables)` → 调用 **auto-dev-reviewer** Agent
6. 读 review 结果 → PASS / NEEDS_REVISION
7. `auto_dev_checkpoint(phase=2, status=result)`
8. `--interactive` 模式：PASS 后展示摘要等用户确认
9. **默认模式：PASS 后直接进入 Phase 3，禁止暂停、禁止询问用户、禁止等待确认**

**`--dry-run` 模式**：Phase 2 通过后 `auto_dev_checkpoint(status="COMPLETED")` 并停止。

## 迭代次数限制

| Phase | 最大迭代 | 理由 |
|-------|---------|------|
| 0 (Brainstorm) | 2 | 方向探索不应反复，2 轮足够 |
| 1 (Design) | 3 | 设计可能需要多轮打磨 |
| 2 (Plan) | 3 | 任务拆分可能调整 |
| 3 (Execute) | 2 | 单个 task 超过 2 轮说明 task 拆分不够细 |
| 4 (Verify) | 3 | 审查可能发现多轮问题 |
| 5 (E2E Test) | 3 | 测试可能需要多次调整 |
| 6 (Acceptance) | 无限制 | 验收必须通过 |

达到限制后自动 BLOCK，需人工介入决定是否继续。

## Phase 3: EXECUTE (串行，每任务 max 2 fix)

对 plan.md 中每个任务：
1. 记录 `task_start_commit = git rev-parse HEAD`
2. **[TDD 模式（默认）]**：
   - RED: 先写失败测试 → 运行确认 FAIL → commit
   - GREEN: 写最小实现 → 运行确认 PASS → commit
   - REFACTOR: 清理代码 → 运行确认仍 PASS → commit
3. **[标准模式]** `auto_dev_render("phase3-developer", variables + {task_context})` → 调用 **auto-dev-developer** Agent
4. `git add <files> && git commit`
5. `auto_dev_diff_check(expectedFiles, task_start_commit)` → 异常文件警告
6. `auto_dev_render("phase3-quick-reviewer", variables)` → 调用 **auto-dev-reviewer** Agent **两阶段审查**（先 Spec 合规，再代码质量）
7. `auto_dev_checkpoint(phase=3, task=N, status=result)`
8. 如果 NEEDS_FIX → 修复 → 再审查一次
9. 如果仍 NEEDS_FIX → `auto_dev_git_rollback(task_start_commit)` → 标记 BLOCKED

**TDD Iron Law（默认生效，tdd=false 关闭）：禁止在没有失败测试的情况下编写实现代码。**

## Phase 4: VERIFY

1. Claude 执行 `{build_cmd}` → 失败则用 bug-analyzer + fix（max 3 次）
2. Claude 执行 `{test_cmd}` → 失败则用 bug-analyzer + fix（max 3 次）
3. `auto_dev_render("phase4-full-reviewer", variables)` → 调用 **auto-dev-reviewer** Agent 整体审查
4. `auto_dev_checkpoint(phase=4, status=result)`

## Phase 5: E2E TEST

**硬性要求（checkpoint 会验证，不满足则 PASS 被拒绝）**：
- 必须有新增**或修改**的测试文件（checkpoint 通过 git diff 检测 *Test.java / *.test.ts 等，扩展已有测试也算）
- e2e-test-results.md 必须包含实际执行结果（PASS/FAIL），不能只有"待执行"

**如果项目测试需要远程环境无法本地执行**：
- 仍然**必须写测试代码**（可以标注 @Ignore 或 skip）
- e2e-test-results.md 中记录：哪些测试本地通过了，哪些需要部署后验证
- 至少要有部分可本地执行的单元测试覆盖核心逻辑

**步骤**:
1. `auto_dev_render("phase5-test-architect", variables)` → 调用 **auto-dev-test-architect** Agent 设计用例
2. 调用 **auto-dev-reviewer** Agent 审查覆盖度
3. `auto_dev_render("phase5-test-developer", variables)` → 调用 **auto-dev-developer** Agent 实现测试代码
4. Claude 执行 `{build_cmd}` → **必须重新编译，确保测试代码无编译错误**（失败则 fix）
5. Claude 执行测试 → 失败则 bug-analyzer + fix + 重跑
6. `auto_dev_checkpoint(phase=5, status=result)` — **checkpoint 会验证测试文件和执行结果的存在**

## Phase 6: ACCEPTANCE（验收）

**硬性要求（checkpoint 会验证，不满足则 PASS 被拒绝）**：
- 必须生成 acceptance-report.md（checkpoint 验证文件存在）
- 报告中必须有至少 1 条验证结果（PASS/FAIL/SKIP）
- **禁止以"无 AC 标准"为由跳过**

**步骤**:
1. `auto_dev_preflight(phase=6)` → 检查 e2e-test-results.md 存在
2. 调用 **auto-dev-acceptance-validator** Agent：
   - 从 design.md 提取验收标准（AC-N 条目）
   - **如果没有显式 AC-N 条目**：从设计目标、改动清单、预期行为中自动提取至少 3 条可验证标准
   - 逐条验证（代码 + 测试 + 运行验证）
   - 产出 `{output_dir}/acceptance-report.md`
3. 判定：
   - **PASS**：所有 AC 均为 PASS 或 SKIP（无 FAIL）→ `auto_dev_checkpoint(phase=6, status="PASS")`
   - **FAIL**：有 FAIL 项 → 调用 **auto-dev-developer** Agent 修复 → 重新验收（max 2 次）
   - **BLOCKED**：2 次修复后仍有 FAIL

## Phase 7: RETROSPECTIVE（经验萃取）

> Phase 7 是独立阶段，由 subagent 执行深度分析，**不是** auto_dev_complete 内部的简单提取。

**步骤**:
1. `auto_dev_preflight(phase=7)` → 检查 acceptance-report.md 存在，返回 suggestedPrompt
2. 用 suggestedPrompt 调用 **auto-dev-reviewer** Agent：
   - 阅读 progress-log.md、design-review.md、code-review.md、e2e-test-results.md、acceptance-report.md
   - 按 4 个维度分析：踩坑记录、亮点、流程改进、技术经验
   - 对每条经验调用 `auto_dev_lessons_add` 保存，跨项目通用的标记 `reusable: true`
   - 生成 `{output_dir}/retrospective.md`
3. `auto_dev_checkpoint(phase=7, status="PASS")`
4. **默认模式：PASS 后直接调用 auto_dev_complete，禁止暂停**

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

1. 调用 `auto_dev_complete(projectRoot, topic)` — **必须调用，这是完成门禁**
   - 工具会验证所有必需 Phase（包括 Phase 7）是否已 PASS（`skipE2e=true` 时不要求 Phase 5）
   - **实际执行 build_cmd + test_cmd 验证**（编译通过 ≠ 验证通过，Phase 状态 PASS ≠ 最终可用）
   - 如果构建或测试失败 → 返回 error → **必须修复后重新调用**
   - 返回 `canComplete=true` + `timingSummary` + `tokenUsage`
2. 只有 `auto_dev_complete` 返回成功后，才能向用户宣称任务完成
3. 提示下一步：
   a. /commit — 整理 commit 历史
   b. git merge 到测试分支
   c. /impact-check — 跨项目评估
   d. 创建 PR
   e. 切回原分支继续其他工作

## Quick Mode (--quick)

跳过 Phase 1-2：直接实现 → 快速审查 → build + test → 完成

## TDD Mode (默认开启, --no-tdd 关闭)

Phase 3 每个 task 默认执行 RED-GREEN-REFACTOR 循环。使用 `tdd=false` 关闭。Phase 5 从"写全部测试"变为"补充集成/E2E 测试"。
`--tdd --skip-e2e` 组合：单元测试在 Phase 3 完成，Phase 5 完全跳过。

## Brainstorm Mode (--brainstorm)

启用 Phase 0，在 Phase 1 DESIGN 之前进行需求探索。适用于模糊需求、缺乏明确目标的场景。

## Skip E2E Mode (--skip-e2e)

跳过 Phase 5（E2E 测试），保留其他所有 Phase（1→2→3→4→6）。适用于小改动、配置修改、纯重构等不需要新增测试文件的场景。

## Prompt Template Reference

| Phase | Prompt File | Agent | 产出 |
|-------|------------|-------|------|
| 0 | `phase0-brainstorm` | auto-dev-architect | brainstorm-notes.md |
| 1 | `phase1-architect` | auto-dev-architect | design.md |
| 1 | `phase1-design-reviewer` | auto-dev-reviewer | design-review.md |
| 2 | `phase2-planner` | auto-dev-architect | plan.md |
| 2 | `phase2-plan-reviewer` | auto-dev-reviewer | plan-review.md |
| 3 | `phase3-developer` | auto-dev-developer | 代码变更 |
| 3 | `phase3-quick-reviewer` | auto-dev-reviewer | 快速审查结果 |
| 4 | `phase4-full-reviewer` | auto-dev-reviewer | code-review.md |
| 5 | `phase5-test-architect` | auto-dev-test-architect | e2e-test-cases.md |
| 5 | `phase5-test-developer` | auto-dev-developer | 测试代码 |
| 6 | `phase6-acceptance` | auto-dev-acceptance-validator | acceptance-report.md |
| 7 | `phase7-retrospective` | auto-dev-reviewer | retrospective.md + lessons |
