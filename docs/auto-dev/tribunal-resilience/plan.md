# Implementation Plan: tribunal-resilience

## Task 1: 辅助函数 — safeRead + getPhaseFiles
- **描述**: 新增两个辅助函数：`safeRead(path, maxLines)` 读文件并截断（文件不存在返回 null）；`getPhaseFiles(phase, outputDir)` 返回各阶段需要内联的文件清单和截断行数（Phase 4: design-review/plan-review/code-review 各 100 行；Phase 5: e2e-test-results/framework-test-log/framework-test-exitcode 各 80 行；Phase 6: acceptance-report 100 行；Phase 7: retrospective/retrospective-data/progress-log 各 80 行）。
- **文件**: mcp/src/tribunal.ts
- **依赖**: 无
- **完成标准**: 两个函数已导出，safeRead 对不存在的文件返回 null，getPhaseFiles 对 Phase 4/5/6/7 返回正确的文件清单。
- **TDD**: skip

## Task 2: 辅助函数 — getKeyDiff（含截断策略）
- **描述**: 新增 `getKeyDiff(projectRoot, startCommit, totalBudget)` 函数。执行 `git diff` 排除 `dist/`、`*.map`、`*.lock`、`node_modules/`、`__tests__/`，然后按文件均匀分配行数预算（每文件 max = totalBudget / fileCount，最少 20 行），确保每个文件至少有 hunk header + 前几行变更可见。
- **文件**: mcp/src/tribunal.ts
- **依赖**: 无
- **完成标准**: getKeyDiff 返回截断后的 diff 文本，每个文件至少有 hunk header 可见，总行数不超过 totalBudget。
- **TDD**: skip

## Task 3: 重写 prepareTribunalInput — 组装 digest
- **描述**: 重写 `prepareTribunalInput` 函数，使用 Task 1/2 的辅助函数组装单个 digest 文件 `tribunal-digest-phase${phase}.md`。内容顺序：裁决指令 → 框架统计（git diff --stat）→ 内联审查材料 → 关键代码变更 → checklist。Phase 5 的 testCmd 执行逻辑保留（在内联读取前执行），Phase 7 的 retrospective data 生成保留。不再产出 tribunal-diff-phaseN.patch。不再输出文件路径让 tribunal 自己读。
- **文件**: mcp/src/tribunal.ts
- **依赖**: Task 1, Task 2
- **完成标准**: prepareTribunalInput 产出单个 tribunal-digest-phaseN.md，内容包含所有内联材料。不再产出 patch 文件。
- **TDD**: skip

## Task 4: 修复 CLI 参数 — 改造 runTribunal
- **描述**: 修改 `runTribunal` 函数的 args 数组：添加 `--dangerously-skip-permissions`，移除 `--max-turns` 和 `--allowedTools`。将 timeout 从 120_000 增加到 180_000。修改 prompt 为 `读取 ${digestFile} 并按照检查清单逐条裁决`。
- **文件**: mcp/src/tribunal.ts
- **依赖**: Task 3
- **完成标准**: args 数组包含 `--dangerously-skip-permissions`，不包含 `--max-turns` 和 `--allowedTools`。spawnOpts.timeout = 180_000。
- **TDD**: skip

## Task 5: 清理 TRIBUNAL_MAX_TURNS
- **描述**: 从 tribunal-schema.ts 移除 `TRIBUNAL_MAX_TURNS` 导出和常量。更新 tribunal.ts 的 import 语句移除 `TRIBUNAL_MAX_TURNS`（保留 `TRIBUNAL_SCHEMA`）。runTribunal 中不再使用 maxTurns 变量。
- **文件**: mcp/src/tribunal-schema.ts, mcp/src/tribunal.ts
- **依赖**: Task 4
- **完成标准**: TRIBUNAL_MAX_TURNS 不再存在于代码中。import 语句只导入 TRIBUNAL_SCHEMA 和 TRIBUNAL_PHASES。
- **TDD**: skip

## Task 6: 崩溃检测 — 改造 runTribunalWithRetry
- **描述**: 修改 `runTribunalWithRetry` 返回值为 `{ verdict: TribunalVerdict; crashed: boolean }`。正常裁决返回 `crashed: false`，崩溃耗尽重试后返回 `crashed: true`。同步修改 executeTribunal 中对 runTribunalWithRetry 返回值的解构。
- **文件**: mcp/src/tribunal.ts
- **依赖**: Task 4
- **完成标准**: runTribunalWithRetry 返回 `{ verdict, crashed }` 结构，executeTribunal 正确解构并使用 crashed 字段。
- **TDD**: skip

## Task 7: TRIBUNAL_PENDING 返回 — 改造 executeTribunal
- **描述**: 在 `executeTribunal` 中，当 `crashed=true` 时：读取 digest 文件内容，计算 SHA-256 hash（取前 16 位），返回 `{ status: "TRIBUNAL_PENDING", phase, digest, digestHash, mandate }`。验证 auto_dev_submit → executeTribunal 的返回链路能正确透传 TRIBUNAL_PENDING 给 MCP 调用方（当前 textResult JSON 透传机制天然兼容）。
- **文件**: mcp/src/tribunal.ts
- **依赖**: Task 6
- **完成标准**: executeTribunal 在 crashed=true 时返回 TRIBUNAL_PENDING 状态。auto_dev_submit 能透传此状态。
- **TDD**: skip

## Task 8: crossValidate 增强 — Phase 4/6/7 硬数据校验
- **描述**: 扩展 `crossValidate` 函数，为 Phase 4/6/7 添加最低限度校验：Phase 4 检查 git diff 非空（使用 startCommit 参数）；Phase 6 检查 acceptance-report.md 有 PASS/FAIL 结果；Phase 7 检查 retrospective.md 存在且 ≥ 50 行。这些检查同时服务于 claude -p 正常路径和 fallback subagent 路径。
- **文件**: mcp/src/tribunal.ts
- **依赖**: 无
- **完成标准**: crossValidate 对 Phase 4/6/7 执行硬数据校验，校验失败返回非 null 错误字符串。
- **TDD**: skip

## Task 9: 新增 auto_dev_tribunal_verdict 工具
- **描述**: 在 index.ts 注册新 MCP 工具 `auto_dev_tribunal_verdict`。参数：projectRoot, topic, phase, verdict, issues, passEvidence, summary, digestHash。实现逻辑：(1) 校验 phase 是 tribunal phase（4/5/6/7）；(2) 通过 `new StateManager(projectRoot, topic).outputDir` 获取 outputDir，拼接 `tribunal-digest-phase${phase}.md` 路径，读取并计算 hash 与 digestHash 比对；(3) PASS 必须有 passEvidence 非空；(4) 调用 crossValidate（Phase 4/6/7 增强逻辑在 fallback 路径中执行）；(5) 写 tribunal log 标记 `source: "fallback-subagent"`；(6) 调用 internalCheckpoint 写入 PASS/FAIL。返回 TRIBUNAL_PASS / TRIBUNAL_FAIL / TRIBUNAL_OVERRIDDEN。
- **文件**: mcp/src/index.ts
- **依赖**: Task 7, Task 8
- **完成标准**: 新工具已注册，digestHash 校验、passEvidence 校验、crossValidate 调用、tribunal log 写入、checkpoint 写入全部实现。digest 文件路径能被正确定位。
- **TDD**: skip

## Task 10: SKILL.md 更新
- **描述**: 更新 SKILL.md 第 43-47 行的驱动循环部分，在 `TRIBUNAL_PASS` 和 `TRIBUNAL_FAIL` 之间增加 `TRIBUNAL_PENDING` 分支：收到 TRIBUNAL_PENDING 后调用 auto-dev-reviewer subagent 审查 digest，从输出中提取 verdict JSON，调用 auto_dev_tribunal_verdict(projectRoot, topic, phase, verdict, issues, passEvidence, digestHash) 提交。
- **文件**: skills/auto-dev/SKILL.md
- **依赖**: Task 9
- **完成标准**: SKILL.md 包含 TRIBUNAL_PENDING 处理分支，明确 fallback 流程步骤。
- **TDD**: skip

## Task 11: Build + Test 验证
- **描述**: 执行 `cd mcp && npm run build` 确认编译通过，执行 `npm test` 确认现有测试不被破坏。
- **文件**: 无新增
- **依赖**: Task 1-10
- **完成标准**: npm run build 退出码 0。npm test 全部通过（允许已有的 skip/pending 测试）。
- **TDD**: skip
