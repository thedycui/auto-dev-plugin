# Auto-Dev 问题清单

> 2026-03-26 | 来源项目：metrics-frontend (openclaw-apikey-install) + auto-dev-plugin (circuit-breaker)

---

## Issue #1: 测试文件检测模式不支持 `.mjs` / `.cjs` 后缀

**严重程度：** P0（直接导致 Phase 5 无法通过）

**现象：** 纯 Node.js 测试脚本 `guide-apikey.test.mjs` 31 个测试全部 PASS，但 tribunal 始终 FAIL，原因是"未检测到新增测试文件"。

**根因：** 测试文件检测有 3 处独立的正则列表，均不包含 `.mjs` / `.cjs`：

| 位置 | 文件 | 行号 | 当前模式 |
|------|------|------|---------|
| `countTestFiles()` | `phase-enforcer.ts` | 378-384 | `.test.(ts\|js\|tsx\|jsx)$` |
| `isTestFile()` | `tdd-gate.ts` | 11-16 | `.test.(ts\|js\|tsx\|jsx)$` |
| `runQuickPreCheck()` | `tribunal.ts` | 628-632 | `.test.(ts\|js)$` |

**修复方案：**

1. 统一测试文件检测到一个函数（目前 `countTestFiles` 和 `isTestFile` 是两套独立实现）
2. 扩展正则支持 `.mjs` / `.cjs` / `.mts` / `.cts`：
   ```typescript
   /\.test\.(ts|js|tsx|jsx|mjs|cjs|mts|cts)$/,
   /\.spec\.(ts|js|tsx|jsx|mjs|cjs|mts|cts)$/,
   ```
3. `tribunal.ts:628-632` 的局部 testPatterns 也要同步更新，或直接复用 `isTestFile()`

**影响范围：** `phase-enforcer.ts`, `tdd-gate.ts`, `tribunal.ts`

---

## Issue #2: TRIBUNAL_ESCALATE 后没有干净的恢复路径

**严重程度：** P0（用户被卡死，只能手动改 state.json）

**现象：** Phase 5 tribunal 3 次 FAIL 后变为 ESCALATE（"需要人工介入"），但：
- `auto_dev_checkpoint(phase=5, status=PASS)` → 拒绝：`TRIBUNAL_REQUIRED`
- `auto_dev_tribunal_verdict(verdict=PASS)` → 拒绝：`DIGEST_NOT_FOUND`
- 没有任何合法的 API 能让人工确认后继续

**根因：** ESCALATE 状态下：
- checkpoint 被硬拦（Phase 5 必须走 tribunal）
- tribunal_verdict 要求 digest 文件存在，但 ESCALATE 时 pre-check 就失败了，根本不会生成 digest

**修复方案：**

新增人工介入 API 或扩展现有 API：

```typescript
// 方案 A：新增 auto_dev_human_override 工具
auto_dev_human_override({
  projectRoot, topic, phase,
  verdict: "PASS",
  reason: "人工确认：31 个测试全部 PASS，tribunal 检测机制误判",
})

// 方案 B：让 checkpoint 支持 force 参数（仅 ESCALATE 状态下可用）
auto_dev_checkpoint({
  ..., status: "PASS",
  force: true,  // 仅当 tribunalSubmits[phase] >= MAX 时允许
  reason: "人工确认理由",
})
```

两种方案都应该在 progress-log 中记录 `[HUMAN_OVERRIDE]` 标记，并在 Phase 7 复盘时强制审计。

---

## Issue #3: 测试文件正则存在 3 份独立副本

**严重程度：** P1（维护隐患，直接导致 Issue #1 难以修复）

**现象：** 测试文件检测逻辑散布在 3 个文件中，各有一套独立的正则列表：

```
tdd-gate.ts:11-16      → TEST_PATTERNS（用于 isTestFile）
phase-enforcer.ts:378-384 → testPatterns（用于 countTestFiles）
tribunal.ts:628-632      → testPatterns（用于 runQuickPreCheck）
```

三处的模式还不完全一致（`tribunal.ts` 的版本比其他两处少了 `tsx|jsx`）。

**修复方案：**

将测试文件检测统一到 `tdd-gate.ts` 的 `isTestFile()` 函数，其他两处改为调用它：

```typescript
// phase-enforcer.ts
import { isTestFile } from "./tdd-gate.js";
export function countTestFiles(diffFileNames: string[]): number {
  return diffFileNames.filter(isTestFile).length;
}

// tribunal.ts runQuickPreCheck 中
const testFileCount = countTestFiles(files);  // 已经在用，但 implPatterns 过滤也需要复用
```

---

## Issue #4: `TESTS_NEWLY_DISABLED` 误报

**严重程度：** P1（阻塞 auto_dev_complete）

**现象：** `auto_dev_complete` 最终因 `TESTS_NEWLY_DISABLED` 被拒绝，但代码中实际没有新增任何 `@Disabled` / `.skip()` 注解。

**根因：** `index.ts:1286` 的 grep 命令：

```typescript
grep -r -c -E "@Disabled|@Ignore|@pytest.mark.skip|it\\.skip\\(|xit\\(|xdescribe\\(" projectRoot + "/src"
```

可能的误报原因：
1. 测试文件 `.mjs` 中的字符串字面量包含 `skip` 相关关键字（如注释中出现 "skip" 一词）
2. `it.skip(` 的正则 `it\\.skip\\(` 可能匹配到非测试代码中的 `it.skip` 文本
3. 扫描范围是整个 `/src` 目录，可能扫到了不相关的文件

**修复方案：**

1. grep 范围应限定为测试文件（用 `--include` 过滤 `*Test.java`, `*.test.ts` 等）
2. 或者只扫描 git diff 中变更的文件，而非全目录
3. 增加 debug 日志输出匹配到的具体文件和行号，方便排查误报

---

## Issue #5: Phase 跳过后 progress-log 状态不一致

**严重程度：** P1（阻塞 auto_dev_complete）

**现象：** 手动修改 `state.json` 将 phase 从 5 改为 6 后，Phase 6/7 正常完成，但 `auto_dev_complete` 检测到 Phase 5 的 progress-log 中没有 PASS 记录，拒绝完成。

**根因：** `auto_dev_complete` 的完成校验通过扫描 `progress-log.md` 中的 CHECKPOINT 标记来判断每个 Phase 是否通过。直接改 state.json 绕过了 progress-log 写入。

**修复方案：**

这个问题会被 Issue #2 的修复自动解决——如果有正规的人工介入 API，它会同时写入 state.json 和 progress-log.md，不会出现不一致。

作为防御性措施，`auto_dev_complete` 应该同时检查 state.json 和 progress-log，如果 state.json 显示已在更高 Phase 且 PASS，而 progress-log 缺失中间记录，应给出明确提示而非直接拒绝。

---

## Issue #6: tribunal pre-check 只扫 committed 文件，不包含 staged/untracked

**严重程度：** P2（用户需要额外操作才能通过）

**现象：** 测试文件 `git add` 后重新提交仍然失败。`tribunal.ts:614` 的 git diff 命令：

```typescript
execFile("git", ["diff", "--name-only", "--diff-filter=AM", diffBase, "HEAD"], ...)
```

这只扫描已 commit 的变更（`HEAD` 相对于 `diffBase`）。staged 但未 commit 的文件不会出现。

而 `index.ts:481` 的 checkpoint 版本多了一步 `git ls-files --others --exclude-standard` 来捕获 untracked 文件，但 tribunal 的 pre-check 没有。

**修复方案：**

统一 tribunal pre-check 和 checkpoint 的文件检测逻辑，都包含 committed + staged + untracked：

```typescript
// 提取为公共函数
async function listChangedFiles(projectRoot: string, startCommit: string): Promise<string[]> {
  const committed = await gitDiffNameOnly(startCommit, "HEAD", projectRoot);
  const staged = await gitDiffNameOnly("--cached", projectRoot);  // staged but not committed
  const untracked = await gitLsFilesUntracked(projectRoot);
  return [...new Set([...committed, ...staged, ...untracked])];
}
```

---

## 优先级排序

| 优先级 | Issue | 修复复杂度 | 原因 |
|--------|-------|-----------|------|
| **P0** | #1 测试文件后缀不全 | 低（改正则） | 直接导致合法测试被拒 |
| **P0** | #2 ESCALATE 无恢复路径 | 中（新增 API） | 用户被卡死 |
| **P1** | #3 正则 3 份副本 | 低（重构复用） | #1 的根因，也是维护债 |
| **P1** | #4 DISABLED 误报 | 中（改 grep 范围） | 阻塞正常完成流程 |
| **P1** | #5 状态不一致 | 低（被 #2 覆盖） | #2 修复后自动解决 |
| **P2** | #6 staged 文件不检测 | 低（统一函数） | 用户需要额外 commit |

**建议实施顺序：** #3 → #1 → #2 → #6 → #4
（先统一正则副本，再扩展后缀，再加人工介入 API，最后修 grep 误报）

---

## Issue #7: auto_dev_init 自动选择了错误的设计文档

**严重程度：** P0（整个 auto-dev 流程在实现错误的功能）

**现象：** 用户在讨论 `docs/design-observability-gate.md`（可观测性门禁）后说"按这个设计开始实现"，但 auto-dev skill 加载后自动读取了 `docs/design-circuit-breaker.md`（断路器机制），整个流程从 Phase 1 到 Phase 5 都在实现错误的功能。

**根因：** auto-dev 的 skill 模板或 init 流程没有让用户确认要实现哪个设计文档。当 `docs/` 目录下存在多个 `design-*.md` 文件时，自动匹配逻辑选错了目标。

**修复方案：**

1. `auto_dev_init` 应接受显式的 `designDoc` 参数，指定设计文档路径
2. 当 `docs/` 下存在多个 `design-*.md` 时，必须列出候选并让用户确认，不能自动选择
3. skill 模板（SKILL.md）中应引导 agent 在 init 前先确认用户意图对应的设计文档

**影响范围：** `skills/auto-dev/SKILL.md`, `mcp/src/index.ts`（auto_dev_init）

---

## Issue #8: `auto_dev_next` 步骤不推进（validateStep 未检测到产出物）

**严重程度：** P0（导致流程卡死，只能手动 checkpoint 绕过）

**现象：** architect agent 完成 design.md 后，调用 `auto_dev_next` 仍然返回 step "1a"，未推进到 "1b"（设计审查）。agent 注释："又遇到之前同样的状态推进问题"，说明这是一个已知的反复出现的 bug。

**根因：** `orchestrator.ts:validateStep` 的 case "1a" 检查 design.md 是否存在且长度 > 100 字符。可能的失败原因：
1. design.md 写入路径与 validateStep 检查的路径不一致（outputDir 计算差异）
2. architect agent 写入文件后，validateStep 的 `readFileSafe` 因为文件系统缓存或路径问题读不到
3. stepState 的持久化时机问题——第一次 `auto_dev_next` 写了 step="1a"，但后续调用没有正确进入 "step exists" 分支

**修复方案：**

1. 在 `validateStep` 中增加 WARN 日志，输出实际检查的文件路径和读取结果
2. 检查 `readStepState` / `writeStepState` 的读写一致性
3. 需要复现并精确定位——这是 orchestrator 核心逻辑的 bug，不能猜测修复

**影响范围：** `mcp/src/orchestrator.ts`

---

## Issue #9: `LESSON_FEEDBACK_REQUIRED` 阻塞 phase checkpoint

**严重程度：** P1（每次 phase 切换都多一轮无意义交互）

**现象：** Phase 2 和 Phase 3 的 `auto_dev_checkpoint(status=PASS)` 首次调用被拒绝，返回 `LESSON_FEEDBACK_REQUIRED`，要求先调用 `auto_dev_lessons_feedback` 提交经验反馈，然后重试 checkpoint 才能通过。

每次都是：
```
checkpoint(PASS) → 拒绝：LESSON_FEEDBACK_REQUIRED
lessons_feedback([...])
checkpoint(PASS) → 通过
```

**问题：** 经验反馈是辅助功能，不应该阻塞核心的 phase 推进流程。agent 被迫中断主流程去处理经验反馈，增加了不必要的复杂度和延迟。

**修复方案：**

1. **方案 A（推荐）：** checkpoint 正常通过，但返回中携带 `lessonFeedbackPending: true` 提示，agent 可以异步处理
2. **方案 B：** 在 phase 7（复盘）统一收集经验反馈，而非每个 phase 切换时强制
3. 无论哪种方案，`LESSON_FEEDBACK_REQUIRED` 不应该返回 error，而应该是 warning

**影响范围：** `mcp/src/index.ts`（checkpoint handler）

---

## Issue #10: Tribunal 追加了设计外的新功能需求

**严重程度：** P1（范围蔓延，tribunal 角色越界）

**现象：** Phase 4 tribunal 提了 2 个 P1：
1. CIRCUIT_BREAK 返回值需新增 `freshContext: true` 字段
2. approach-plan.md 格式不规范时需返回 `planFeedback` 反馈

这两个需求**不在设计文档的 AC-1~AC-8 中**，是 tribunal 自行追加的功能需求。agent 直接实现了，导致改动范围超出原设计。

**问题：** Tribunal 的职责是验证"代码是否符合设计"，而不是"追加设计中没有的功能"。当 tribunal 提出设计外的需求时，正确做法应该是记录为 P2 建议而非 P1 阻塞项。

**修复方案：**

1. Tribunal checklist（`tribunal-checklists.ts`）中明确限定审查范围：只验证 design.md 中的 AC 和 plan.md 中的 task，不能自创需求
2. Tribunal prompt 中加入约束："如果你发现的问题不在设计文档的 AC 或计划中，标记为 P2 建议，不要标为 P1 阻塞"
3. 或者在 tribunal schema 中区分 `blocking_issues`（必须在 AC 中有对应）和 `suggestions`（可以超出 AC 范围）

**影响范围：** `mcp/src/tribunal-checklists.ts`, `mcp/src/tribunal.ts`（prompt 构建）

---

## 更新后的优先级排序

| 优先级 | Issue | 修复复杂度 | 原因 |
|--------|-------|-----------|------|
| **P0** | #7 init 选错设计文档 | 中（改 init + skill） | 整个流程做错任务 |
| **P0** | #8 auto_dev_next 不推进 | 高（核心 bug） | 流程卡死，反复出现 |
| **P0** | #1 测试文件后缀不全 | 低（改正则） | 合法测试被拒 |
| **P0** | #2 ESCALATE 无恢复路径 | 中（新增 API） | 用户被卡死 |
| **P1** | #3 正则 3 份副本 | 低（重构复用） | #1 的根因 |
| **P1** | #9 经验反馈阻塞 checkpoint | 低（改为 warning） | 每次 phase 多一轮交互 |
| **P1** | #10 tribunal 范围蔓延 | 中（改 checklist + prompt） | 追加设计外需求 |
| **P1** | #4 DISABLED 误报 | 中（改 grep 范围） | 阻塞完成流程 |
| **P1** | #5 状态不一致 | 低（被 #2 覆盖） | #2 修复后自动解决 |
| **P2** | #6 staged 文件不检测 | 低（统一函数） | 用户需要额外 commit |

**建议实施顺序：** #8 → #7 → #3 → #1 → #2 → #9 → #10 → #6 → #4
（先修核心推进 bug，再修 init 选错文档，再统一正则，再加人工介入 API）
