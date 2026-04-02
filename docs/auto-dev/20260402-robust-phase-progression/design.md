# 设计文档：鲁棒的阶段推进机制

> 日期：2026-04-02
> 状态：待实现
> 第一性原理：高质量的开发任务，而不是快速完成任务

## 1. 背景与目标

### 1.1 问题现状

当前 orchestrator 的阶段推进机制存在两大类问题：**编排逻辑缺陷**（无限循环、空转、计数器碎片化）和 **Git 环境污染**（diff 范围不准确导致 tribunal 误判）。根本原因是系统设计偏向"快速推进"而非"确保每一步的质量"。

#### 问题一览

| 编号 | 级别 | 类别 | 问题 | 根因位置 |
|------|------|------|------|----------|
| P0-1 | P0 | 编排 | Revision 无限循环（1b→1c→1b→1c...永不 BLOCKED） | orchestrator.ts:1475 stepIteration 被重置 |
| P0-2 | P0 | 编排 | Revision step（1c/2c/5c）无验证，走 default pass | orchestrator.ts:988 switch/case 缺失 |
| P1-1 | P1 | 编排 | Phase 3 空转放行（agent 没改代码但 build/test 本来就通过） | orchestrator.ts:773-780 |
| P1-2 | P1 | 编排 | 4 套计数器碎片化，无统一 effort 视图 | stepIteration / tribunalSubmits / phaseEscalateCount / shipRound |
| P1-3 | P1 | 编排 | 缺少前置守卫（前阶段产物被误删时不阻止） | — |
| P1-4 | P1 | Git | Init 时 dirty working tree 污染 diff → tribunal 误判 | index.ts:373-374 只记录不阻止 |
| P1-5 | P1 | Git | 运行期间用户 merge/pull/手动改代码 → diff 膨胀 | — |
| P1-6 | P1 | Git | 会话中断→用户切分支→resume → startCommit 跨分支 | — |
| P1-7 | P1 | Git | `git stash` 冲突导致 working tree 被破坏 | orchestrator.ts:484-509 |
| P1-8 | P1 | Git | startCommit 因 rebase/force-push 不可达 → diff fallback 不准确 | tribunal.ts:103 |
| P1-9 | P1 | 验证 | Flaky test 浪费 iteration budget | — |

#### P0-1 详解：Revision 无限循环

```
1b（审查 FAIL） → 1c（修订） → validateStep("1c") → default: pass
→ advanceToNextStep("1c") → parentStep="1b" → atomicUpdate(step=1b, stepIteration=0)
→ 1b 再 FAIL → stepIteration=0+1=1 → step=1c
→ 1c default pass → step=1b, stepIteration=0 ← 又重置了！
→ 永远不会达到 stepIteration=3 的 escalation 阈值
```

**根因**：`advanceToNextStep` 在 revision step pass 回到 parent 时无条件重置 `stepIteration=0`（orchestrator.ts:1475），而 `MAX_STEP_ITERATIONS` 检查基于 `stepIteration`（orchestrator.ts:1408）。每轮 1c→1b 都重置计数器，循环永远无法被打断。

#### P1-4~P1-8 的统一根因：共享 Working Tree

Tribunal（Phase 4/5/6）的核心输入是 `git diff startCommit`（tribunal.ts:103, 236）。所有 Git 相关问题的统一根因是：**auto-dev 与用户共享同一个 working tree**。

| 外部因素 | 影响 |
|----------|------|
| Init 时 working tree dirty | 无关代码出现在 diff → tribunal 误判 |
| 运行期间 `git merge` / `git pull` | 大量他人代码涌入 diff → digest 截断 → 关键变更被截断 |
| 运行期间用户手动改代码 | 混入 diff，tribunal 无法区分来源 |
| 会话中断→用户切分支→resume | startCommit 跨分支 → diff 完全错误 |
| `checkBuildWithBaseline` 用 stash/pop | stash pop 冲突 → working tree 被破坏 |

### 1.2 设计目标

1. **Git 环境隔离**：auto-dev 在独立的 git worktree 中工作，与用户的 working tree 完全隔离
2. **消除无限循环**：任何 step 在有限次尝试内必须收敛（通过或 BLOCKED）
3. **Revision 必须产生 delta**：修订步骤必须证明"改了什么"
4. **空转检测**：Phase 3 无代码变更时不放行
5. **统一的努力预算**：一个 step 的所有重试/修订/tribunal 共享一个总预算
6. **前置守卫**：每个 step 验证前检查前置产物
7. **消除 stash hack**：用 worktree 的 clean 基线替代 stash/pop

### 1.3 Non-Goals

- 不改变 step 的顺序和分组逻辑（STEP_ORDER、PHASE_SEQUENCE 不变）
- 不改变 tribunal 的评估逻辑（evaluateTribunal 内部不动）
- 不改变 agent 的 prompt 模板（prompts/*.md 不动）
- 不解决 flaky test 本身（只做框架层面的容忍机制）

## 2. 现状分析

### 2.1 当前架构

```
用户 working tree (projectRoot)
├── src/                    ← auto-dev agent 在这里改代码
├── docs/auto-dev/{topic}/  ← auto-dev 输出目录
│   ├── state.json
│   ├── design.md / plan.md / ...
│   └── progress-log.md
├── (用户自己的改动也在这里)   ← 污染源
└── .git/
```

auto-dev 的 agent 和用户共享同一个 working tree：
- `git diff startCommit` 包含所有人的修改
- `git stash` / `git stash pop` 可能冲突
- 用户切分支会影响 HEAD

### 2.2 当前状态机

```
computeNextTask()
├── step=null → resolveInitialStep() → 确定第一个 step
└── step≠null → validateStep(step)
    ├── passed → advanceToNextStep()
    │   ├── revision step → 回到 parent step (stepIteration=0) ← BUG: 重置导致无限循环
    │   ├── nextStep exists → atomicUpdate(step=next)
    │   └── nextStep=null → COMPLETED
    └── failed → handleValidationFailure()
        ├── tribunal → handleTribunal*()
        ├── regressToPhase → handlePhaseRegress()
        ├── circuit breaker → handleCircuitBreaker()
        ├── iteration limit → BLOCKED  ← BUG: revision 循环永远达不到
        └── else → revision/retry (stepIteration++)
```

### 2.3 计数器现状

| 计数器 | 字段 | 作用域 | 上限 | 重置时机 |
|--------|------|--------|------|----------|
| stepIteration | state.stepIteration | 当前 step | 3 | step 变更、revision→parent（BUG：重置为0） |
| tribunalSubmits | state.tribunalSubmits[phase] | phase 级别 | 3 → escalate | phase 推进时 |
| phaseEscalateCount | state.phaseEscalateCount[phase] | phase 级别 | 2 → BLOCKED | 不重置 |
| shipRound | state.shipRound | 全局 | shipMaxRounds(5) | 不重置 |

## 3. 方案设计

### 方案对比

| 方案 | 描述 | 优点 | 缺点 |
|------|------|------|------|
| A: 补丁修复 + init dirty 检查 | 修 P0 bug + init 时检查 dirty tree 并警告 | 改动小（~100行） | 不解决运行期间的 Git 污染、stash 冲突问题 |
| B: 补丁修复 + Git worktree 隔离 | 修 P0 bug + 统一 effort 预算 + worktree 隔离 | **从根本上解决 Git 环境问题**（9/11 问题），消除 stash hack | 改动较大（~500行），需要管理 worktree 生命周期 |
| C: 方案 B + 可选模式 | 方案 B，但 worktree 作为可选模式（默认开启，可通过 `--no-worktree` 关闭） | 灵活，兼容旧行为 | 需要维护两套路径，增加测试复杂度 |

**选择方案 C**，理由：
1. 方案 A 只是打补丁，Git 污染问题在生产中频繁发生
2. 方案 B 的 worktree 一刀切可能在某些场景下不适用（如 worktree 路径与 build 工具不兼容、CI 环境限制等）
3. 方案 C 默认 worktree 隔离，但保留 `--no-worktree` 逃生口；对于内部编排逻辑修复（P0/P1 编排问题），无论是否启用 worktree 都生效

## 4. 详细设计

### 4.1 Git Worktree 隔离（核心架构变更）

#### 4.1.1 目标架构

```
用户 working tree (projectRoot)          auto-dev worktree (worktreeRoot)
├── src/                                 ├── src/           ← agent 在这里改代码
├── docs/auto-dev/{topic}/               ├── docs/auto-dev/{topic}/  ← 输出目录
│   └── state.json (worktreeRoot 字段)   │   └── state.json
├── (用户自己的改动)                      ├── (只有 auto-dev 的改动)
└── .git/                                └── .git → 指向主仓库 .git
    └── worktrees/
        └── auto-dev-{topic}/            ← git worktree 元数据
```

**关键改变**：auto-dev 的所有代码修改和验证都在隔离的 worktree 中进行。用户在主 working tree 中的任何操作不会影响 auto-dev，反之亦然。

#### 4.1.2 Worktree 生命周期

```
auto_dev_init(projectRoot, topic, ...)
  │
  ├─ 1. 确定 worktree 路径
  │     worktreeDir = path.join(projectRoot, "..", `.auto-dev-wt-${sanitize(topic)}`)
  │     branchName = `auto-dev/${sanitize(topic)}`
  │
  ├─ 2. 创建 worktree + 分支
  │     git worktree add -b {branchName} {worktreeDir} HEAD
  │     （从当前 HEAD 创建，确保 clean 起点）
  │
  ├─ 3. 安装依赖（如需要）
  │     检测 package.json → npm install / yarn install
  │     检测 pom.xml → mvn dependency:resolve
  │
  ├─ 4. 记录 worktree 信息到 state.json
  │     worktreeRoot: worktreeDir
  │     worktreeBranch: branchName
  │     startCommit: HEAD 的 commit hash
  │     sourceBranch: 当前分支名
  │
  └─ 5. 输出目录在 worktree 内
        outputDir = path.join(worktreeDir, "docs/auto-dev/{topic}/")

auto_dev_next / agent 执行
  │
  └─ 所有操作使用 worktreeRoot 代替 projectRoot
     build/test/git diff 都在 worktree 中执行

auto_dev_complete(projectRoot, topic)
  │
  ├─ 1. 在 worktree 中 commit 所有变更
  │     git add -A && git commit
  │
  ├─ 2. 切回主 working tree，合并 worktree 分支
  │     cd {projectRoot}
  │     git merge {branchName} --no-ff -m "auto-dev: {topic}"
  │
  ├─ 3. 清理 worktree
  │     git worktree remove {worktreeDir}
  │
  └─ 4. 可选：删除分支
        git branch -d {branchName}
```

#### 4.1.3 Worktree 路径规则

```typescript
function getWorktreeDir(projectRoot: string, topic: string): string {
  // 放在 projectRoot 的同级目录，避免嵌套 git 仓库问题
  const sanitized = topic
    .replace(/[^a-zA-Z0-9\u4e00-\u9fff-]/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 50);
  return path.join(projectRoot, "..", `.auto-dev-wt-${sanitized}`);
}

function getWorktreeBranch(topic: string): string {
  const sanitized = topic
    .replace(/[^a-zA-Z0-9\u4e00-\u9fff-]/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 50);
  return `auto-dev/${sanitized}`;
}
```

#### 4.1.4 对 computeNextTask 的影响

```typescript
export async function computeNextTask(
  projectRoot: string,
  topic: string,
): Promise<NextTaskResult> {
  const sm = await StateManager.create(projectRoot, topic);
  const state = await sm.loadAndValidate();

  // 关键：如果启用了 worktree，所有操作使用 worktreeRoot
  const effectiveRoot = state.worktreeRoot ?? projectRoot;
  const outputDir = sm.outputDir; // outputDir 已在 worktree 内

  // ... 后续所有 validateStep / buildTaskForStep 使用 effectiveRoot ...
}
```

#### 4.1.4a effectiveRoot 与 effectiveCodeRoot 的组合规则

代码中存在 `effectiveCodeRoot = state.codeRoot ?? projectRoot`（当前 orchestrator.ts:1731），用于"技能类项目"（如 `codeRoot = "mcp/"`，build/test 命令在子目录执行）。引入 worktree 后，两个变量必须明确组合规则：

```typescript
// worktree 模式下的组合规则
const effectiveRoot = state.worktreeRoot ?? projectRoot;

const effectiveCodeRoot = state.worktreeRoot
  ? (state.codeRoot
      // codeRoot 是相对于 projectRoot 的子路径，映射到 worktree 的对应位置
      ? path.join(state.worktreeRoot, path.relative(projectRoot, state.codeRoot))
      : state.worktreeRoot)
  : (state.codeRoot ?? projectRoot);
```

**关键决策**：
- `effectiveRoot`：worktree 根目录（或 projectRoot），用于 git 操作（`git diff`、`git log`）
- `effectiveCodeRoot`：build/test 命令的执行目录，在 worktree 模式下是 worktreeRoot 内的对应子目录
- `validateStep` 接收 `effectiveCodeRoot`（build/test 相关步骤）；`tribunal.ts` 接收 `effectiveRoot`（git diff 相关操作）
- 如果 `state.codeRoot` 未设置（大多数项目），`effectiveCodeRoot === effectiveRoot`，无需特殊处理

**示例**：
```
projectRoot = "/repo"
state.codeRoot = "/repo/mcp"
state.worktreeRoot = "/repo/../.auto-dev-wt-my-topic"（即 "/tmp/worktrees/my-topic"）

effectiveRoot     = "/tmp/worktrees/my-topic"
effectiveCodeRoot = "/tmp/worktrees/my-topic/mcp"
                    （= path.join(worktreeRoot, path.relative("/repo", "/repo/mcp"))）
```

#### 4.1.5 消除 `checkBuildWithBaseline` 的 stash hack

**当前实现**（orchestrator.ts:484-509）：
```typescript
// 危险的 stash/pop 模式
git stash --include-untracked -q
try { baseline = shell(cmd, projectRoot) }
finally { git stash pop -q }  // 可能冲突！
```

**新实现**（worktree 模式）：
```typescript
async function checkBuildWithBaseline(
  cmd: string,
  worktreeRoot: string,   // 已经是隔离的 worktree
  startCommit: string | undefined,
  failType: string = "BUILD_FAILED",
): Promise<{ passed: false; feedback: string } | null> {
  const result = await shell(cmd, worktreeRoot);
  if (result.exitCode === 0) return null;

  // 在 worktree 模式下，baseline 检查更安全：
  // worktree 本身就是从 startCommit 创建的，
  // 只需要检查 startCommit 时的状态
  if (startCommit) {
    // 方案 1（推荐）：创建临时 worktree 用于 baseline
    const baselineDir = `${worktreeRoot}-baseline`;
    const addResult = await shell(
      `git worktree add --detach "${baselineDir}" ${startCommit}`,
      worktreeRoot,
      10_000,
    );
    if (addResult.exitCode === 0) {
      try {
        // 在 baseline 目录安装依赖（如需要）
        await installDepsIfNeeded(baselineDir);
        const baselineResult = await shell(cmd, baselineDir, 300_000);
        if (baselineResult.exitCode !== 0) {
          return null; // 预存在失败，不是我们引入的
        }
      } finally {
        await shell(`git worktree remove --force "${baselineDir}"`, worktreeRoot, 10_000);
      }
    }
  }

  return {
    passed: false,
    feedback: translateFailureToFeedback(failType, result.stdout + "\n" + result.stderr),
  };
}
```

**优势**：
- **零冲突风险**：不再操作主 working tree 的 stash
- **不干扰任何人**：baseline worktree 是临时的，用完即删
- **正确性保证**：baseline worktree 精确还原 startCommit 状态

#### 4.1.6 `--no-worktree` 兼容模式

```typescript
// auto_dev_init 的输入参数新增
useWorktree: z.boolean().optional().default(true),

// 当 useWorktree=false 时：
// - 不创建 worktree，行为与当前完全一致
// - state.json 没有 worktreeRoot 字段
// - checkBuildWithBaseline 仍使用 stash 模式（fallback）
// - 但所有编排逻辑修复（P0-1, P0-2, P1-1~P1-3）仍然生效
```

#### 4.1.7 Resume 时的 Worktree 恢复

```typescript
// auto_dev_init 的 onConflict="resume" 路径
if (state.worktreeRoot) {
  // 检查 worktree 是否还在
  const wtExists = await fileExists(state.worktreeRoot);
  if (wtExists) {
    // worktree 还在，直接复用
    // 检查 worktree 的分支是否正确
    const branch = await shell("git branch --show-current", state.worktreeRoot);
    if (branch.stdout.trim() !== state.worktreeBranch) {
      // 分支被切了，警告用户
      return { error: `Worktree 分支不一致：期望 ${state.worktreeBranch}，实际 ${branch.stdout.trim()}` };
    }
    // OK，继续使用
  } else {
    // worktree 被删了，需要重建
    // 从 worktreeBranch 重建（如果分支还在）
    const branchExists = await shell(`git branch --list ${state.worktreeBranch}`, projectRoot);
    if (branchExists.stdout.trim()) {
      await shell(`git worktree add "${state.worktreeRoot}" ${state.worktreeBranch}`, projectRoot);
    } else {
      return { error: `Worktree 和分支都不存在，无法恢复。请重新 init。` };
    }
  }
}
```

### 4.2 StepEffort 统一预算

#### 数据结构

```typescript
// types.ts 新增
export const StepEffortSchema = z.object({
  totalAttempts: z.number().int().default(0),
  revisionCycles: z.number().int().default(0),
  tribunalAttempts: z.number().int().default(0),
});

// StateJsonSchema 新增字段
stepEffort: z.record(z.string(), StepEffortSchema).optional(),
```

#### 预算上限

```typescript
const EFFORT_LIMITS = {
  maxTotalAttempts: 6,       // 一个 step 最多尝试 6 次（含 revision）
  maxRevisionCycles: 2,      // revision 循环最多 2 轮
  maxTribunalAttempts: 3,    // tribunal 最多 3 次（保持现有行为）
} as const;
```

#### Effort Key 规则

Revision step 与 parent step 共享同一个 effort key：

```typescript
function effortKeyForStep(step: string): string {
  return REVISION_TO_REVIEW[step] ?? step;
  // "1c" → "1b", "2c" → "2b", "5c" → "5b", 其他 → 自身
}
```

#### 预算检查（在 handleValidationFailure 开头）

```typescript
const effortKey = effortKeyForStep(currentStep);
const effort = state.stepEffort?.[effortKey]
  ?? { totalAttempts: 0, revisionCycles: 0, tribunalAttempts: 0 };

if (effort.totalAttempts >= EFFORT_LIMITS.maxTotalAttempts) {
  await sm.atomicUpdate({ lastValidation: "EFFORT_EXHAUSTED", status: "BLOCKED" });
  return {
    done: false, step: currentStep, agent: null, prompt: null,
    escalation: {
      reason: "effort_exhausted",
      lastFeedback: `Step ${effortKey} 已用尽努力预算（${effort.totalAttempts}/${EFFORT_LIMITS.maxTotalAttempts} 次尝试，${effort.revisionCycles} 轮修订）。需要人工介入。`,
    },
    message: `Step ${effortKey} effort budget exhausted.`,
  };
}
```

#### 预算更新时机

1. **验证失败时**：`effort.totalAttempts++`
2. **tribunal 失败时**：`effort.totalAttempts++`，`effort.tribunalAttempts++`
3. **revision step pass → 回到 parent 时**：`effort.revisionCycles++`，`effort.totalAttempts++`
4. **step 推进成功（advance）时**：不更新（新 step 开始新的 effort）

#### 与现有计数器的关系

| 现有计数器 | 处理方式 |
|-----------|---------|
| `stepIteration` | **保留**，降级为参考值。`MAX_STEP_ITERATIONS` 检查改为仅当 `stepEffort` 不存在时 fallback |
| `tribunalSubmits` | **保留**，同时更新 `stepEffort.tribunalAttempts`。tribunal 3次→escalate 的现有逻辑不变 |
| `phaseEscalateCount` | **不变**（Phase 级别，与 step effort 不同粒度） |
| `shipRound` | **不变** |

### 4.3 Revision Step 验证（修复 P0-2）

#### 新增 validateStep case

```typescript
case "1c": {
  const designPath = join(outputDir, "design.md");
  const content = await readFileSafe(designPath);
  if (!content || content.length < 100) {
    return { passed: false, feedback: "design.md 不存在或内容不足，修订无效。" };
  }
  const prevHash = state.lastArtifactHashes?.["design.md"];
  if (prevHash && hashContent(content) === prevHash) {
    return { passed: false, feedback: "design.md 没有变化。修订步骤必须产生实质性修改，请根据审查反馈修改设计方案。" };
  }
  return { passed: true, feedback: "" };
}

case "2c": {
  const planPath = join(outputDir, "plan.md");
  const content = await readFileSafe(planPath);
  if (!content) {
    return { passed: false, feedback: "plan.md 不存在，修订无效。" };
  }
  const prevHash = state.lastArtifactHashes?.["plan.md"];
  if (prevHash && hashContent(content) === prevHash) {
    return { passed: false, feedback: "plan.md 没有变化。修订步骤必须产生实质性修改，请根据审查反馈修改实施计划。" };
  }
  return { passed: true, feedback: "" };
}

case "5c": {
  // 测试修订：检查测试文件是否有实质性变化（hash delta 检查）
  // 注意：不能用 git diff startCommit，因为 Phase 3 早已创建了测试文件，
  // 从 startCommit 开始的 diff 总会包含测试文件，检查形同虚设。
  // 应与 1c/2c 保持一致，使用进入 5c 前记录的 hash 做 delta 检查。
  const prevTestHash = state.lastArtifactHashes?.["test-files"];
  if (prevTestHash !== undefined) {
    // 扫描测试文件，计算当前 hash 组合
    const testFilesResult = await shell(
      `git ls-files --cached --others --exclude-standard | grep -E 'test|spec|__tests__'`,
      effectiveRoot, 10_000,
    );
    const testFileList = testFilesResult.stdout.trim().split("\n").filter(Boolean);
    let currentTestHash = "";
    for (const f of testFileList) {
      const content = await readFileSafe(join(effectiveRoot, f));
      currentTestHash += hashContent(content);
    }
    currentTestHash = hashContent(currentTestHash); // 聚合 hash

    if (!currentTestHash || currentTestHash === prevTestHash) {
      return { passed: false, feedback: "测试文件没有变化。测试修订步骤必须产生实质性修改，请根据失败反馈修改测试代码。" };
    }
  }
  // 测试必须通过
  const testResult = await shell(testCmd, effectiveRoot);
  if (testResult.exitCode !== 0) {
    return {
      passed: false,
      feedback: translateFailureToFeedback("TEST_FAILED", testResult.stdout + "\n" + testResult.stderr),
    };
  }
  return { passed: true, feedback: "" };
}
```

#### Artifact Hash 追踪

```typescript
// types.ts StateJsonSchema 新增
lastArtifactHashes: z.record(z.string(), z.string()).optional(),

// hash 函数
import { createHash } from "node:crypto";
function hashContent(content: string | null): string {
  if (!content) return "";
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}
```

hash 记录时机（必须在同一个 `atomicUpdate` 事务中完成，防止 state 被污染）：
- **1a 通过后**：记录 `design.md` hash
- **1b 失败（dispatch 1c 时）**：在 `atomicUpdate(step="1c")` 中同时记录当前 `design.md` hash（用于 1c 的 delta 检查）
- **2a 通过后**：记录 `plan.md` hash
- **2b 失败（dispatch 2c 时）**：在 `atomicUpdate(step="2c")` 中同时记录当前 `plan.md` hash
- **5b 失败（dispatch 5c 时）**：在 `atomicUpdate(step="5c")` 中同时扫描当前测试文件并记录聚合 hash 到 `lastArtifactHashes["test-files"]`（用于 5c 的 delta 检查）

### 4.4 修复 advanceToNextStep 的 Revision→Parent 逻辑（修复 P0-1）

**当前代码**（orchestrator.ts:1470-1476）：
```typescript
if (parentStep) {
  await sm.atomicUpdate({
    step: parentStep, stepIteration: 0, lastValidation: null, approachState: null,
  });
}
```

**修改为**：
```typescript
if (parentStep) {
  const effortKey = parentStep; // 1c→1b
  const effort = { ...(state.stepEffort?.[effortKey] ?? { totalAttempts: 0, revisionCycles: 0, tribunalAttempts: 0 }) };
  effort.revisionCycles++;
  effort.totalAttempts++;

  if (effort.revisionCycles >= EFFORT_LIMITS.maxRevisionCycles) {
    await sm.atomicUpdate({
      lastValidation: "REVISION_CYCLES_EXHAUSTED", status: "BLOCKED",
      stepEffort: { ...(state.stepEffort ?? {}), [effortKey]: effort },
    });
    return {
      done: false, step: parentStep, agent: null, prompt: null,
      escalation: {
        reason: "revision_cycles_exhausted",
        lastFeedback: `Step ${effortKey} 已完成 ${effort.revisionCycles} 轮修订循环仍未通过审查，需要人工介入。`,
      },
      message: `Step ${effortKey} revision cycles exhausted.`,
    };
  }

  await sm.appendToProgressLog(
    "\n" + sm.getCheckpointLine(currentPhase, undefined, "PASS",
      `Revision step ${currentStep} passed. Re-validating ${parentStep}. (cycle ${effort.revisionCycles}/${EFFORT_LIMITS.maxRevisionCycles})`) + "\n",
  );
  await sm.atomicUpdate({
    step: parentStep, stepIteration: 0, lastValidation: null, approachState: null,
    stepEffort: { ...(state.stepEffort ?? {}), [effortKey]: effort },
  });

  return {
    done: false, step: parentStep, agent: null, prompt: null,
    message: `Revision step ${currentStep} completed (cycle ${effort.revisionCycles}/${EFFORT_LIMITS.maxRevisionCycles}). Re-validating parent step ${parentStep}.`,
  };
}
```

### 4.5 Phase 3 空转检测（修复 P1-1）

```typescript
case "3": {
  // 新增：检查是否有代码变更（排除 docs 目录）
  if (state.startCommit) {
    const diffResult = await shell(
      `git diff --stat ${state.startCommit} -- . ':!docs/'`,
      effectiveRoot,   // worktree 模式下指向 worktreeRoot
      10_000,
    );
    if (diffResult.exitCode === 0 && !diffResult.stdout.trim()) {
      return {
        passed: false,
        feedback: "Phase 3 未检测到相对于 startCommit 的代码变更（git diff 为空）。请确保已实现 plan.md 中的任务。",
      };
    }
  }

  // 现有逻辑
  const buildFail3 = await checkBuildWithBaseline(buildCmd, effectiveRoot, state.startCommit);
  if (buildFail3) return buildFail3;
  const testFail3 = await checkBuildWithBaseline(testCmd, effectiveRoot, state.startCommit, "TEST_FAILED");
  if (testFail3) return testFail3;
  return { passed: true, feedback: "" };
}
```

### 4.6 前置守卫链（修复 P1-3）

```typescript
interface PrerequisiteCheck {
  file: string;
  description: string;
}

const STEP_PREREQUISITES: Record<string, PrerequisiteCheck[]> = {
  "1b": [{ file: "design.md", description: "设计文档" }],
  "1c": [{ file: "design.md", description: "设计文档" }, { file: "design-review.md", description: "设计审查" }],
  "2a": [{ file: "design.md", description: "设计文档" }],
  "2b": [{ file: "plan.md", description: "实施计划" }],
  "2c": [{ file: "plan.md", description: "实施计划" }, { file: "plan-review.md", description: "计划审查" }],
  "3":  [{ file: "plan.md", description: "实施计划" }],
  "5b": [{ file: "e2e-test-cases.md", description: "测试用例" }],
};

async function checkPrerequisites(step: string, outputDir: string): Promise<{ ok: boolean; missing: string[] }> {
  const prereqs = STEP_PREREQUISITES[step];
  if (!prereqs?.length) return { ok: true, missing: [] };
  const missing: string[] = [];
  for (const p of prereqs) {
    if (!(await fileExists(join(outputDir, p.file)))) {
      missing.push(`${p.description}（${p.file}）`);
    }
  }
  return { ok: missing.length === 0, missing };
}
```

在 `computeNextTask` 的 `validateStep` 之前调用：

```typescript
const prereqResult = await checkPrerequisites(currentStep, outputDir);
if (!prereqResult.ok) {
  return {
    done: false, step: currentStep, agent: null, prompt: null,
    escalation: {
      reason: "prerequisite_missing",
      lastFeedback: `Step ${currentStep} 的前置产物缺失：${prereqResult.missing.join("、")}。可能被误删或之前的阶段未正常完成。`,
    },
    message: `Prerequisite check failed for step ${currentStep}.`,
  };
}
```

### 4.7 Token 效率优化（不牺牲质量）

以下 3 项优化经过第一性原理审查，确认不降低开发质量，属于"同等质量、更少浪费"的改进。

#### 4.7.1 Phase 4a 跳过空 dispatch

**问题**：Phase 3→4a 推进时，orchestrator 无条件 dispatch 一个 developer agent，prompt 是"请检查并修复代码，确保编译和测试通过"（orchestrator.ts:1166）。当没有 feedback 时，agent 盲目探索不知道要修什么，最终可能什么都不改。真正的质量把关是 `validateStep("4a")` 中的 tribunal 评估。

**当前 token 消耗**：developer agent 盲搜 5,000-10,000 token，产出为零。

**改动**：

```typescript
// buildTaskForStep 中，step "4a" 的逻辑
if (step === "4a") {
  if (feedback) {
    // 有具体反馈时：正常 dispatch developer 修复
    return buildRevisionPrompt({
      originalTask: `代码验证：${topic}`,
      feedback,
      artifacts: [],
    }) + approachPlanInstruction + ISOLATION_FOOTER;
  }
  // 无 feedback 时：不 dispatch agent，直接让 orchestrator 进入 validateStep
  // 返回 null prompt，computeNextTask 检测到 null prompt 时跳过 dispatch
  return null;  // ← 新增：信号值，表示无需 dispatch
}
```

```typescript
// computeNextTask 中 advanceToNextStep 返回后：
if (!nextResult.prompt && nextResult.step) {
  // prompt 为 null：跳过 dispatch，直接进入下次 auto_dev_next 的验证流程
  // 设置 agent 为 null，mandate 不包含 dispatch 指令
  return {
    done: false,
    step: nextResult.step,
    agent: null,       // ← 无需 dispatch
    prompt: null,
    message: `Step ${nextResult.step} 不需要 agent 执行，直接验证。请立即调用 auto_dev_next。`,
  };
}
```

**质量保证**：Phase 4a 的质量由 tribunal 把关（build + test + 独立裁决），developer agent 的空 dispatch 不贡献任何质量价值。当 tribunal 发现问题时，feedback 不为空，会正常 dispatch developer 修复。

#### 4.7.2 Revision Prompt 填充 previousAttemptSummary（含格式重写说明）

**问题**：`buildRevisionPrompt`（orchestrator-prompts.ts）有 `previousAttemptSummary` 字段但**从未填充**。Agent 收到 revision 任务时缺少上下文，必须重新读取整个文件理解"之前做了什么"，浪费 1,000-2,000 token/次。

**重要：这是一次格式重写，不仅仅是增加一个字段**

当前实现中，`buildRevisionPrompt` 以 `lines.join("\n")` 的方式输出一段无结构的文本。本次改动将输出格式改写为 markdown 标题结构（`## 修订任务`、`## 历史尝试`、`## 审查反馈（必须逐条回应）`、`## 待修改文件`）。

影响范围：
- orchestrator.ts 中 4 处 `buildRevisionPrompt` 调用（第 1081、1089、1097、1161 行）收到的 prompt 格式全部变化
- `orchestrator-prompts.test.ts` 中对旧格式有断言的测试**全部需要同步更新**

实施策略（分两步，在同一 PR 中完成）：
1. **步骤一**：更新 `buildRevisionPrompt` 函数体为新 markdown 格式，同时更新 `orchestrator-prompts.test.ts` 中的快照断言
2. **步骤二**：填充 `previousAttemptSummary` 字段，并新增测试验证 previousAttemptSummary 的内容

AC-14 需覆盖格式验证：验证新 prompt 中 `## 审查反馈` 标题存在，且 previousAttemptSummary 正确插入。

**改动**：在 `handleValidationFailure` 构建 revision prompt 时，从 `lastValidation` 和 `stepEffort` 中提取上下文：

```typescript
// handleValidationFailure 中构建 revision prompt 时：
const previousAttemptSummary = buildPreviousAttemptSummary(effortKey, effort, validation.feedback);

const prompt = await buildTaskForStep(
  effectiveStep, outputDir, projectRoot, topic, buildCmd, testCmd,
  combinedFeedback, getExtraVars(effectiveStep),
  { previousAttemptSummary },  // ← 新增参数
);
```

```typescript
function buildPreviousAttemptSummary(
  stepId: string,
  effort: StepEffort,
  currentFeedback: string,
): string {
  const lines: string[] = [];
  lines.push(`这是第 ${effort.totalAttempts + 1} 次尝试（共 ${EFFORT_LIMITS.maxTotalAttempts} 次预算）。`);
  if (effort.revisionCycles > 0) {
    lines.push(`已完成 ${effort.revisionCycles} 轮修订循环。`);
  }
  lines.push(`上次失败原因：${currentFeedback.slice(0, 500)}`);
  lines.push(`请勿重复之前失败的方向，要产生实质性不同的修改。`);
  return lines.join("\n");
}
```

**在 buildRevisionPrompt 中使用**：

```typescript
// orchestrator-prompts.ts buildRevisionPrompt 增强
export function buildRevisionPrompt(opts: {
  originalTask: string;
  feedback: string;
  artifacts: string[];
  previousAttemptSummary?: string;  // ← 新增
}): string {
  let prompt = `## 修订任务\n\n原始任务: ${opts.originalTask}\n\n`;
  if (opts.previousAttemptSummary) {
    prompt += `## 历史尝试\n\n${opts.previousAttemptSummary}\n\n`;
  }
  prompt += `## 审查反馈（必须逐条回应）\n\n${opts.feedback}\n\n`;
  if (opts.artifacts.length > 0) {
    prompt += `## 待修改文件\n\n${opts.artifacts.map(a => `- ${a}`).join("\n")}\n\n`;
  }
  return prompt;
}
```

**质量提升**：Agent 知道了"第几次尝试""之前为什么失败""不要重复之前的方向"，修订质量反而会**提高**。这是 token 节省与质量提升的双赢。

#### 4.7.3 Phase 3 scoped_prompt 内嵌完整 task 上下文

**问题**：Phase 3 并行 dispatch 时，main agent 从 plan.md 解析 task，构造 scoped_prompt。但 scoped_prompt 只包含 task 描述，developer subagent 仍需**自己读 plan.md** 来获取整体上下文。5 个 task = 5 次重复读取 plan.md（~800 token/次 = 4,000 token 浪费）。

**改动**：在 `buildTaskForStep` 中，将 plan.md 的关键上下文直接嵌入 prompt，并在 prompt 中明确标注"不需要再读 plan.md"：

```typescript
// orchestrator.ts buildTaskForStep step "3" 的返回值增强
if (step === "3") {
  const planContent = await readFileSafe(planPath);
  const taskDetails = extractTaskDetails(planContent);

  // 新增：嵌入设计目标摘要（从 design.md 提取第一个 ## 段落）
  let designSummary = "";
  const designContent = await readFileSafe(join(outputDir, "design.md"));
  if (designContent) {
    const goalMatch = designContent.match(/##\s*1[.．]?\s*背景[与和]目标\s*\n([\s\S]*?)(?=\n##)/);
    if (goalMatch) {
      designSummary = `\n\n## 设计目标摘要\n\n${goalMatch[1].trim().slice(0, 500)}\n`;
    }
  }

  return `请完成以下任务：\n\n${taskDetails}${reviewSection}${designSummary}\n\n` +
    `项目根目录: ${projectRoot}\n输出目录: ${outputDir}\n\n` +
    `**重要：每完成一个 task，先验证其完成标准是否满足，再开始下一个。**\n` +
    `**注意：上述 task 描述已包含完整上下文，不需要再读 plan.md 或 design.md。**` +
    approachPlanInstruction + ISOLATION_FOOTER;
}
```

**质量保证**：Agent 拿到的信息量与自己读 plan.md 完全相同（甚至更多，因为加了设计目标摘要），只是传递方式从"agent 自己读文件"变为"prompt 直接包含"。

### 4.8 数据流总览

```
auto_dev_init(projectRoot, topic, useWorktree=true)
  │
  ├─ 创建 worktree (git worktree add -b auto-dev/{topic} {wtDir} HEAD)
  ├─ 安装依赖 (npm install / mvn dependency:resolve)
  ├─ 记录 state.json: { worktreeRoot, worktreeBranch, sourceBranch, startCommit }
  └─ outputDir 在 worktree 内

auto_dev_next(projectRoot, topic)
  │
  ├─ loadState → effectiveRoot = state.worktreeRoot ?? projectRoot
  │
  ├─ step=null?
  │   └─ resolveInitialStep
  │
  ├─ checkPrerequisites(step)                     ← 新增
  │   └─ 失败 → escalation("prerequisite_missing")
  │
  ├─ validateStep(step, effectiveRoot)             ← 增强
  │   ├─ "1c"/"2c" → delta check (hash)
  │   ├─ "5c" → test file diff + test pass
  │   ├─ "3" → git diff non-empty + build + test
  │   ├─ "4a"/"5b"/"6" → build + test + tribunal  (diff 只包含 worktree 的修改！)
  │   └─ 其余不变
  │
  ├─ effort budget check                           ← 新增
  │   └─ totalAttempts ≥ max → BLOCKED
  │
  ├─ passed → advanceToNextStep
  │   ├─ revision→parent → revisionCycles++        ← 修复
  │   │   └─ revisionCycles ≥ max → BLOCKED
  │   └─ normal advance → 记录 artifact hash
  │
  └─ failed → handleValidationFailure
      ├─ effort budget check → BLOCKED             ← 新增兜底
      ├─ tribunal → tribunalAttempts++
      └─ revision/retry → totalAttempts++

auto_dev_complete(projectRoot, topic)
  │
  ├─ worktree 中 commit 所有变更
  ├─ 合并 worktree 分支到 sourceBranch
  ├─ git worktree remove
  └─ 可选：git branch -d
```

### 4.8 受影响的文件

| 文件 | 改动类型 | 估计行数 |
|------|----------|---------|
| `mcp/src/orchestrator.ts` | 核心改动（验证增强、effort budget、前置守卫、effectiveRoot 替换、4a 空 dispatch 跳过、scoped_prompt 嵌入） | ~300行 |
| `mcp/src/orchestrator-prompts.ts` | buildRevisionPrompt 增加 previousAttemptSummary | ~30行 |
| `mcp/src/types.ts` | StepEffort / worktree 相关字段定义 | ~30行 |
| `mcp/src/state-manager.ts` | StepEffort merge + worktree 路径解析 | ~30行 |
| `mcp/src/index.ts` | auto_dev_init worktree 创建 + auto_dev_complete 合并清理 | ~120行 |
| `mcp/src/tribunal.ts` | effectiveRoot 透传 | ~20行 |
| `mcp/tests/orchestrator.test.ts` | 新增/修改测试用例 | ~300行 |
| 合计 | | ~830行 |

## 5. 影响分析

### 5.1 兼容性

- **向后兼容**：
  - 旧 state.json 没有 `worktreeRoot` / `stepEffort` / `lastArtifactHashes` 字段时，所有新增字段都是 optional
  - 没有 `worktreeRoot` → 使用 `projectRoot`（旧行为）
  - 没有 `stepEffort` → fallback 到 `stepIteration` 检查
  - `--no-worktree` 模式保留完整的旧行为路径

- **向前兼容**：
  - 新 state.json 可以被旧版本 orchestrator 读取（Zod schema 忽略未知字段）
  - 但旧版本不知道 worktree，会使用 projectRoot（退化为旧行为）

- **MCP 签名**：
  - `auto_dev_init` 新增可选参数 `useWorktree: boolean`（默认 true）
  - `auto_dev_next` 签名不变
  - `auto_dev_complete` 内部行为变更（有 worktree 时先合并再清理）
  - 新增的 `escalation.reason` 值对 SKILL.md 透明（走通用 escalation 分支）

### 5.2 不变量

以下行为不受影响：
- Phase 序列（full/quick/turbo）
- Agent 类型映射（STEP_AGENTS）
- Prompt 模板渲染
- Tribunal 评估逻辑（内部不动，只是 projectRoot → effectiveRoot）
- AC 框架（structural + test-bound）
- Circuit breaker 逻辑
- Phase 8 ship 流程（见下方 5.3 节关于 Phase 8 的执行顺序说明）

### 5.3 Phase 8 在 Worktree 模式下的执行顺序（P1-B）

**问题背景**：在 worktree 模式下，代码变更在 `auto-dev/{topic}` 分支，而主 working tree 的 `sourceBranch` 没有这些 commit。Phase 8 的 8a 步骤会检查"没有 unpushed commits"（在 `projectRoot` 执行），此时 sourceBranch 确实干净，但 worktree 分支的 commits 尚未合并，会误判 8a PASS，push 出去的是一个不包含任何变更的版本。

**决策：`auto_dev_complete` 必须在 Phase 8 开始之前执行**

```
Phase 7 完成（所有验收标准通过）
   │
   └─ 用户（或 SKILL.md 流程）调用 auto_dev_complete
         │
         ├─ 合并 auto-dev/{topic} → sourceBranch（主 working tree）
         ├─ 清理 worktree
         └─ state.json 标记 completed=true / worktreeRoot=null
   │
Phase 8 开始（push/build/deploy）
   │
   └─ 此时 sourceBranch 包含所有变更，8a 检查正确
```

**实现要求**：

1. `auto_dev_complete` 执行后，`state.worktreeRoot` 清空（或标记已合并），`state.sourceBranch` 保留（Phase 8 可以用于确认 push 目标）
2. Phase 8 的 validateStep 开头检查：如果 `state.worktreeRoot` 仍非空（worktree 未合并），返回错误提示"请先调用 auto_dev_complete 完成合并，再执行 Phase 8"
3. SKILL.md 流程中，Phase 7 完成后的 checklist 明确标注：**必须先调用 `auto_dev_complete`，再推进到 Phase 8**

**为何不选择"在 worktree 分支直接 push"**：  
Phase 8 可能包含 deploy 脚本、tag 打标、changelog 生成等操作，这些操作默认绑定 `sourceBranch`。如果在 worktree 分支 push，需要改造所有 Phase 8 步骤，改动范围过大，且破坏了"worktree 是临时工作区"的语义。强制 `auto_dev_complete` 先合并是更清晰的边界。

## 6. 风险与缓解

| 风险 | 严重程度 | 缓解措施 |
|------|----------|---------|
| Worktree 路径与 build 工具不兼容（绝对路径引用） | 中 | `--no-worktree` 逃生口；worktree 放在 projectRoot 同级目录，路径结构相似 |
| Worktree 中 npm install 耗时长 | 中 | 使用 `npm ci` 或 `--prefer-offline`；记录安装状态，resume 时跳过已安装的 |
| Worktree 合并冲突（用户在 sourceBranch 上也改了代码） | 中 | `auto_dev_complete` 合并时如果冲突，不自动解决，而是报告冲突让用户手动处理 |
| 磁盘空间（worktree 是完整的目录拷贝） | 低 | worktree 共享 .git 对象存储，只占用 working tree 空间；完成后自动清理 |
| Baseline worktree（checkBuildWithBaseline）的依赖安装开销 | 中 | 缓存策略：如果 baseline commit 的 lockfile hash 与当前一致，复用 node_modules 的符号链接 |
| stepEffort 与 stepIteration 双轨并行导致混乱 | 低 | stepIteration 降级为参考值，真正的上限由 stepEffort 管控 |
| hash 碰撞导致误判"没有变化" | 低 | SHA-256 前 16 字符（64bit），碰撞概率可忽略 |
| EFFORT_LIMITS 常量过严/过松 | 低 | 合理默认值，后续可通过 init 参数覆盖 |

## 7. 验收标准

| AC | 描述 | 验证方式 |
|----|------|---------|
| AC-1 | `auto_dev_init(useWorktree=true)` 创建独立的 git worktree 和分支，所有后续 agent 操作在 worktree 中执行，不影响主 working tree | 集成测试：init 后在主 working tree 创建脏文件，验证 worktree 中没有该文件；在 worktree 中修改代码，验证主 working tree 不受影响 |
| AC-2 | `auto_dev_complete` 将 worktree 分支合并回 sourceBranch 并清理 worktree 目录 | 集成测试：complete 后验证 sourceBranch 包含 worktree 的 commit，worktree 目录不存在 |
| AC-3 | Tribunal 的 `git diff startCommit` 在 worktree 模式下只包含 auto-dev 的修改，不包含主 working tree 的修改 | 集成测试：主 working tree 有脏文件，验证 tribunal digest 的 diff 不包含该文件 |
| AC-4 | `checkBuildWithBaseline` 在 worktree 模式下不使用 `git stash`，改用临时 worktree 做 baseline 检查 | 单元测试：mock shell，验证不调用 `git stash`；验证创建/删除临时 worktree |
| AC-5 | Revision 循环（1b→1c→1b→1c...）在 `maxRevisionCycles`（默认2）轮后 BLOCKED，不再无限循环 | 单元测试：模拟 1b 持续 NEEDS_REVISION，验证第 3 轮 1c→1b 时返回 escalation |
| AC-6 | Revision step（1c/2c/5c）的 validateStep 检查产物变更（delta check），未修改时返回 passed=false | 单元测试：构造未修改的 design.md，调用 validateStep("1c")，验证返回 passed=false |
| AC-7 | Phase 3 验证在无代码变更（git diff 为空）时返回 failed | 单元测试：mock git diff 返回空，验证 validateStep("3") 返回 passed=false |
| AC-8 | StepEffort 的 totalAttempts 在达到上限（默认6）时返回 BLOCKED escalation | 单元测试：设置 stepEffort.totalAttempts=6，验证返回 effort_exhausted |
| AC-9 | 前置守卫在 design.md 缺失时阻止 step "2a" 执行，返回 prerequisite_missing escalation | 单元测试：删除 design.md，调用 checkPrerequisites("2a")，验证返回 ok=false |
| AC-10 | `--no-worktree` 模式下所有功能正常，行为与当前版本一致（向后兼容） | 集成测试：useWorktree=false 时走完 full mode 全流程 |
| AC-11 | 旧 state.json（不含 worktreeRoot/stepEffort 字段）不会 crash，fallback 到旧行为 | 集成测试：用旧格式 state.json 调用 computeNextTask，验证正常推进 |
| AC-12 | 会话中断后 resume 时，如果 worktree 仍存在则复用，如果被删则从分支重建 | 集成测试：模拟中断→删除 worktree 目录→resume，验证从分支重建成功 |
| AC-13 | Phase 4a 首次执行（无 feedback）时不 dispatch developer agent，直接进入 validateStep 验证 | 单元测试：step=4a 且 feedback 为空时，buildTaskForStep 返回 null；computeNextTask 返回 agent=null、prompt=null |
| AC-14 | Revision prompt 采用 markdown 标题格式（含 `## 修订任务`、`## 审查反馈` 等标题），并填充 previousAttemptSummary（尝试次数、修订轮次、上次失败原因） | 单元测试：验证新格式中存在 `## 审查反馈` 标题；模拟 stepEffort.totalAttempts=2 时验证包含"第 3 次尝试"和失败原因摘要；同步更新 orchestrator-prompts.test.ts 中的旧格式断言 |
| AC-15 | Phase 3 的 scoped_prompt 包含完整 task 描述和设计目标摘要，prompt 中标注"不需要再读 plan.md" | 单元测试：验证 buildTaskForStep("3") 的返回值包含 design 目标摘要和"不需要再读 plan.md"标注 |
| AC-16 | Worktree 模式下，Phase 8 的 validateStep 检查 worktreeRoot 是否已清空（即 auto_dev_complete 已执行），若 worktree 仍存在则阻止并提示"请先调用 auto_dev_complete" | 单元测试：state.worktreeRoot 非空时调用 validateStep("8a")，验证返回 passed=false 且 feedback 包含"auto_dev_complete"关键词 |
| AC-17 | case "5c" 的 delta check 使用进入 5c 前记录的测试文件聚合 hash 进行比对，而非基于 startCommit 的 git diff | 单元测试：构造未修改测试文件的场景（lastArtifactHashes["test-files"] 与当前 hash 相同），调用 validateStep("5c")，验证返回 passed=false；修改测试文件后验证通过 |
