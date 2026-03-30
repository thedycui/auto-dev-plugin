# 资源约束系统设计文档

> 灵感来源：Karpathy autoresearch — "约束即创造力"
> 日期：2026-03-26
> 状态：设计草案

## 一、背景与动机

### 1.1 问题现状

当前 auto-dev 的 Phase 3（EXECUTE）中，Developer Agent 有以下自由度：

1. **文件范围无限制**：plan.md 中虽列出每个 task 的预期文件，但 `auto_dev_diff_check` 仅返回 `isClean: true/false`，调用方（SKILL.md）只是信息展示，**不阻断**。Agent 可以随意修改白名单外的文件。
2. **修改规模无限制**：没有任何机制限制单个 task 的代码量。一个预估改 20 行的 task，实际写 200 行也不会触发任何预警。
3. **跨项目修改无安全网**：通过 `/add-dir` 添加的关联项目目录，Agent 可以编辑但 git 操作（diff/rollback/diff_check）只覆盖 `projectRoot`，跨项目修改处于裸奔状态。

### 1.2 autoresearch 的启发

Karpathy 的 autoresearch 用三个结构性约束逼出了算法创新：

- **5 分钟时间锁**：堵死"堆资源"的捷径，只能靠更聪明的算法
- **单文件限制**：聚焦创造力到 train.py 一个方向
- **奥卡姆剃刀**：加了 20 行丑代码不值得，删了代码反而加分

对应到 auto-dev，我们需要：
- **文件范围锁**：聚焦 Agent 到 plan 预期的文件范围内
- **Diff 预算**：逼出更精炼的实现，而非堆代码
- **复杂度惩罚**：奖励简洁，惩罚臃肿

### 1.3 跨项目场景的真实需求

用户常通过 `/add-dir` 将前端、后端、Dubbo 接口等多个独立 Git 仓库加入同一会话。当前问题：

- Agent 可以编辑所有目录的文件 ✅
- git commit/diff/rollback 只在 `projectRoot` 生效 ❌
- diff_check 只检查 `projectRoot` 的变更 ❌
- **关键边界**：其他 session 可能同时在修改关联 repo，auto-dev 不应误检测这些修改

## 二、整体架构

```
┌─────────────────────────────────────────────────────────────┐
│                     Phase 0: 多 Repo 感知                    │
│  auto_dev_init 记录声明的 repo + baseline commit              │
│  GitManager 扩展为 MultiRepoGitManager                       │
│  diff_check / rollback / getDiffStats 覆盖所有声明的 repo     │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│                     Phase 1: 文件范围锁                      │
│  Phase 2 PASS 时从 plan.md 提取白名单 → state.json           │
│  Phase 3 checkpoint PASS 内置强制校验（不依赖 Agent 调用）     │
│  分级响应：同目录放行 / 跨目录警告 / 完全意外阻断              │
│  scope_extend 工具：合理扩展 + 审计记录                       │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│                     Phase 2: Diff 预算                       │
│  Phase 2 plan.md 中预估每个 task 修改行数                     │
│  Phase 3 checkpoint 时对比实际 vs 预估                        │
│  超 warningThreshold 警告 / 超 blockingThreshold 阻断         │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│                     Phase 3: 复杂度惩罚                      │
│  基于 git diff 的轻量指标（净增行数 × 文件蔓延度 × 新增依赖）  │
│  Phase 3 每 task 后计算 complexityScore                      │
│  Phase 4 Tribunal checklist 增加合规检查                      │
└─────────────────────────────────────────────────────────────┘
```

## 三、Phase 0：多 Repo 感知基础设施

### 3.1 设计原则

**声明式注册，显式边界**：只有在 design.md 中声明了的关联 repo 才纳入监控。未声明的 repo 即使通过 `/add-dir` 可见，也完全忽略。

### 3.2 数据模型

在 `StateJsonSchema` 中新增：

```typescript
// types.ts 新增
additionalRepos: z.array(z.object({
  path: z.string(),              // 绝对路径，如 "/Users/admin/frontend-app"
  alias: z.string(),             // 短名，如 "frontend"，用于 plan.md 中引用
  gitRoot: z.string(),           // git 仓库根目录（通常 = path）
  baselineCommit: z.string(),    // init 时记录的 HEAD SHA
  branch: z.string(),            // init 时记录的分支名
})).optional(),
```

在 `InitInputSchema` 中新增可选参数：

```typescript
// types.ts InitInputSchema 新增
additionalRepos: z.array(z.object({
  path: z.string(),
  alias: z.string(),
})).optional(),
```

### 3.3 初始化流程

**Phase 1（DESIGN）中声明** → **用户确认后在 init 或 state_update 中注册**

具体流程：

1. Architect 在 design.md 中声明涉及的组件：
   ```markdown
   ## 涉及组件
   - backend-service（projectRoot）: ~/projects/backend-service
   - frontend-app: ~/projects/frontend-app
   - dubbo-api: ~/projects/dubbo-api
   ```

2. 主 Agent 解析声明，调用 `auto_dev_state_update` 注册：
   ```typescript
   auto_dev_state_update({
     projectRoot, topic,
     updates: {
       additionalRepos: [
         { path: "/Users/admin/projects/frontend-app", alias: "frontend" },
         { path: "/Users/admin/projects/dubbo-api", alias: "dubbo-api" },
       ]
     }
   })
   ```

3. 框架为每个 repo 记录 baseline：
   - 执行 `git -C <path> rev-parse HEAD` 获取 baselineCommit
   - 执行 `git -C <path> rev-parse --abbrev-ref HEAD` 获取 branch
   - 写入 state.json
   - 写入 progress-log：`<!-- REPO_BASELINE alias=frontend path=/Users/admin/projects/frontend-app commit=abc1234 branch=feature/xxx -->`

### 3.4 MultiRepoGitManager

扩展现有 `GitManager`，支持多 repo 操作：

```typescript
// multi-repo-git-manager.ts（新文件）

export class MultiRepoGitManager {
  private managers: Map<string, GitManager>; // alias → GitManager
  private baselines: Map<string, string>;     // alias → baselineCommit

  constructor(
    primaryRoot: string,
    primaryBaseline: string,
    additionalRepos?: Array<{ path: string; alias: string; baselineCommit: string }>
  ) {
    this.managers = new Map();
    this.baselines = new Map();

    this.managers.set("primary", new GitManager(primaryRoot));
    this.baselines.set("primary", primaryBaseline);

    for (const repo of additionalRepos ?? []) {
      this.managers.set(repo.alias, new GitManager(repo.path));
      this.baselines.set(repo.alias, repo.baselineCommit);
    }
  }

  /** 对所有声明的 repo 执行 diffCheck，合并结果 */
  async diffCheckAll(
    expectedFilesByRepo: Map<string, string[]>  // alias → expectedFiles
  ): Promise<MultiRepoDiffCheckOutput> { ... }

  /** 对所有声明的 repo 获取 diff stats */
  async getDiffStatsAll(): Promise<Map<string, DiffStats>> { ... }

  /** 对指定 repo 执行 rollback */
  async rollback(alias: string, files?: string[]): Promise<RollbackResult> { ... }

  /** 检查某个文件路径属于哪个 repo */
  resolveRepo(filePath: string): { alias: string; relativePath: string } | null { ... }
}
```

### 3.5 文件路径规范化

plan.md 中的文件引用需要统一格式，支持跨 repo：

```markdown
## Task 2: 新增用户查询接口
- **文件**:
  - dubbo-api: src/main/java/com/example/api/UserQueryService.java (新)
  - backend: src/main/java/com/example/service/UserQueryServiceImpl.java (新)
  - frontend: src/views/user/UserQuery.vue (改)
```

解析规则：
- `alias: path` 格式 → 跨 repo 文件
- 无前缀的裸路径 → projectRoot 内文件（向后兼容）

### 3.6 安全边界：排除外部修改

**核心机制**：每个 repo 的 diff 计算都以 `baselineCommit..HEAD` 为范围。

- 其他 session 在 auto-dev init **之前**的 commit → 不在 baseline..HEAD 范围内 → 不会被检测到 ✅
- 其他 session 在 auto-dev 运行**期间**的 commit → 会出现在 baseline..HEAD 中 → **误检测** ⚠️

缓解方案：
- diff_check 结果中标注每个变更文件的 commit author/message
- 如果 commit message 不包含 auto-dev 相关标记（如 `[auto-dev]` 前缀），标记为 `external_change` 并从校验中排除
- progress-log 记录排除的外部变更，供 Phase 4 Tribunal 审查

### 3.7 向后兼容

- `additionalRepos` 是 optional 字段，不传则行为完全不变
- 现有的 `auto_dev_diff_check` 工具签名不变，只在 projectRoot 范围内工作
- 新增 `auto_dev_diff_check_all` 工具覆盖多 repo（或增加 optional 参数）
- `auto_dev_state_update` 的 updates schema 需要扩展以接受 `additionalRepos`

## 四、Phase 1：文件范围锁（File Scope Lock）

### 4.1 数据模型

在 `StateJsonSchema` 中新增：

```typescript
constraints: z.object({
  // 文件范围锁
  fileScope: z.object({
    // 按 task 定义的文件白名单（key = task 编号字符串）
    byTask: z.record(z.string(), z.object({
      allowed: z.array(z.string()),         // 精确路径（含 repo alias 前缀）
      allowedPatterns: z.array(z.string()),  // glob 模式
    })),
    // 全局允许的文件模式（所有 task 共享）
    globalAllowed: z.array(z.string()),
    // 运行时扩展记录
    extensions: z.array(z.object({
      task: z.number(),
      file: z.string(),
      reason: z.string(),
      approvedAt: z.string(),
    })),
  }),
  // Diff 预算（见第五节）
  diffBudget: z.object({ ... }),
  // 复杂度基线（见第六节）
  complexity: z.object({ ... }),
}).optional(),
```

### 4.2 白名单生成

**时机**：Phase 2 checkpoint PASS 时自动提取。

**位置**：`index.ts` 的 checkpoint handler，在 Phase 2 PASS 的 pre-validation 之后、commit phase 之前。

**解析逻辑**（新增函数 `extractFileScopeFromPlan`）：

```typescript
// constraints.ts（新文件）

export function extractFileScopeFromPlan(
  planContent: string,
): Record<string, { allowed: string[]; allowedPatterns: string[] }> {
  const result: Record<string, ...> = {};

  // 按 ## Task N 分割
  const sections = planContent.split(/(?=^## Task \d+)/m);

  for (const section of sections) {
    const taskMatch = section.match(/^## Task (\d+)/);
    if (!taskMatch) continue;
    const taskNum = taskMatch[1];

    // 提取 **文件**: 或 **Files**: 后面的列表
    const filesMatch = section.match(/\*\*(?:文件|Files?)\*\*:\s*\n((?:\s*[-*].*\n)*)/i);
    if (!filesMatch) continue;

    const lines = filesMatch[1].split("\n").filter(l => l.trim());
    const allowed: string[] = [];
    const allowedPatterns: string[] = [];

    for (const line of lines) {
      const path = line.replace(/^\s*[-*]\s*/, "").replace(/\s*\(.*\)\s*$/, "").trim();
      if (path.includes("*")) {
        allowedPatterns.push(path);
      } else {
        allowed.push(path);
      }
    }

    result[taskNum] = { allowed, allowedPatterns };
  }

  return result;
}
```

**全局允许列表默认值**：

```typescript
const DEFAULT_GLOBAL_ALLOWED = [
  "*.md",
  "docs/**",
  ".gitignore",
  "package.json",
  "package-lock.json",
  "pom.xml",
  "build.gradle",
  "tsconfig.json",
  "*.lock",
];
```

### 4.3 分级响应机制

**核心思路**：不是非黑即白的阻断，而是根据"偏离程度"分级处理。

```typescript
export enum ScopeViolationLevel {
  SILENT_PASS = "silent_pass",       // 在 globalAllowed 中 → 不报告
  SAME_DIR_WARN = "same_dir_warn",   // 与 plan 中某个文件同目录 → 警告但放行
  SRC_DIR_FLAG = "src_dir_flag",     // 在项目 src 目录下 → 标记，Phase 4 审查
  BLOCK = "block",                   // 完全意外的路径 → 阻断
}

export function classifyViolation(
  unexpectedFile: string,
  taskAllowedFiles: string[],
  globalAllowed: string[],
  extensions: Array<{ file: string }>,
): ScopeViolationLevel {
  // 1. 在 globalAllowed 中？
  if (matchesAnyGlob(unexpectedFile, globalAllowed)) return SILENT_PASS;

  // 2. 已通过 scope_extend 申请？
  if (extensions.some(e => e.file === unexpectedFile)) return SILENT_PASS;

  // 3. 与 plan 中某个文件同目录？
  const allowedDirs = new Set(taskAllowedFiles.map(f => dirname(f)));
  if (allowedDirs.has(dirname(unexpectedFile))) return SAME_DIR_WARN;

  // 4. 在 src/ 或 test/ 目录下？
  if (/^(src|test|tests|lib|app)\//i.test(unexpectedFile)) return SRC_DIR_FLAG;

  // 5. 完全意外
  return BLOCK;
}
```

**Phase 3 checkpoint PASS 时的校验逻辑**：

```typescript
// 在 checkpoint handler 中，phase === 3 && status === "PASS" 时：

// 1. 获取当前 task 的白名单
const constraints = state.constraints;
if (constraints?.fileScope) {
  const taskScope = constraints.fileScope.byTask[String(task)];
  if (taskScope) {
    // 2. 获取实际变更文件
    const git = new GitManager(projectRoot);
    const diffResult = await git.diffCheck(taskScope.allowed, taskStartCommit);

    // 3. 对每个 unexpected 文件分级
    const violations: Array<{ file: string; level: ScopeViolationLevel }> = [];
    for (const file of diffResult.unexpectedChanges) {
      const level = classifyViolation(
        file, taskScope.allowed,
        constraints.fileScope.globalAllowed,
        constraints.fileScope.extensions
      );
      if (level !== ScopeViolationLevel.SILENT_PASS) {
        violations.push({ file, level });
      }
    }

    // 4. 处理结果
    const blocks = violations.filter(v => v.level === "block");
    const flags = violations.filter(v => v.level !== "block");

    if (blocks.length > 0) {
      return textResult({
        error: "FILE_SCOPE_VIOLATION",
        blockedFiles: blocks.map(b => b.file),
        message: `Task ${task} 修改了白名单外的文件: ${blocks.map(b => b.file).join(", ")}。` +
          `请调用 auto_dev_scope_extend 申请扩展，或将改动移到正确的 task 中。`,
        mandate: "[BLOCKED] 文件范围锁校验失败。",
      });
    }

    // warnings/flags 记录到 progress-log 但不阻断
    if (flags.length > 0) {
      await sm.appendToProgressLog(
        `<!-- SCOPE_WARNING task=${task} files=${flags.map(f => f.file).join(",")} -->\n`
      );
    }
  }
}
```

### 4.4 scope_extend 工具

新增 MCP 工具，供 Developer Agent 在实现过程中申请扩展文件范围：

```typescript
// index.ts 新增工具

server.tool(
  "auto_dev_scope_extend",
  "Request to extend file scope for current task. Records the extension with reason for audit.",
  {
    projectRoot: z.string(),
    topic: z.string(),
    task: z.number(),
    files: z.array(z.string()),     // 要新增到白名单的文件
    reason: z.string(),              // 必须说明原因
  },
  async ({ projectRoot, topic, task, files, reason }) => {
    const sm = new StateManager(projectRoot, topic);
    const state = await sm.loadAndValidate();

    // 校验：Phase 3 IN_PROGRESS 才能调用
    if (state.phase !== 3 || state.status !== "IN_PROGRESS") {
      return textResult({
        error: "INVALID_PHASE",
        message: "scope_extend 只能在 Phase 3 IN_PROGRESS 状态下调用。",
      });
    }

    // 校验：单次最多 5 个文件
    if (files.length > 5) {
      return textResult({
        error: "TOO_MANY_FILES",
        message: "单次最多扩展 5 个文件。如需更多，请分多次申请。",
      });
    }

    // 校验：累计扩展不超过原白名单的 100%
    const constraints = state.constraints;
    if (constraints?.fileScope) {
      const taskScope = constraints.fileScope.byTask[String(task)];
      const originalCount = taskScope?.allowed.length ?? 0;
      const existingExtensions = constraints.fileScope.extensions
        .filter(e => e.task === task).length;
      if (existingExtensions + files.length > originalCount) {
        return textResult({
          error: "EXTENSION_LIMIT_EXCEEDED",
          message: `Task ${task} 原始白名单 ${originalCount} 个文件，` +
            `已扩展 ${existingExtensions} 个，本次请求 ${files.length} 个，超出 100% 上限。` +
            `说明 plan 质量可能不足，建议回退 Phase 2 重新规划。`,
        });
      }
    }

    // 记录扩展
    const now = new Date().toISOString();
    const newExtensions = files.map(f => ({
      task,
      file: f,
      reason,
      approvedAt: now,
    }));

    const updatedExtensions = [
      ...(constraints?.fileScope?.extensions ?? []),
      ...newExtensions,
    ];

    await sm.atomicUpdate({
      constraints: {
        ...constraints,
        fileScope: {
          ...constraints?.fileScope,
          extensions: updatedExtensions,
        },
      },
    });

    // 记录到 progress-log（审计追踪）
    await sm.appendToProgressLog(
      `<!-- SCOPE_EXTEND task=${task} files=${files.join(",")} reason="${reason}" -->\n`
    );

    return textResult({
      success: true,
      task,
      extendedFiles: files,
      totalExtensions: updatedExtensions.filter(e => e.task === task).length,
      message: `Task ${task} 文件范围已扩展: ${files.join(", ")}`,
    });
  },
);
```

## 五、Phase 2：Diff 预算（Diff Budget）

### 5.1 数据模型

```typescript
// constraints.diffBudget
diffBudget: z.object({
  byTask: z.record(z.string(), z.object({
    estimatedLines: z.number(),       // 预估修改行数（增+删）
    estimatedNewFiles: z.number(),    // 预估新增文件数
  })),
  totalEstimatedLines: z.number(),
  // 运行时跟踪
  actualByTask: z.record(z.string(), z.object({
    addedLines: z.number(),
    deletedLines: z.number(),
    totalFiles: z.number(),
  })).optional(),
}),
```

### 5.2 Plan 模板增强

修改 `skills/auto-dev/prompts/phase2-planner.md`，在 Plan Format 中增加：

```markdown
## Task N: [标题]
- **描述**: ...
- **文件**: 文件路径列表
- **预估规模**: ~30 行（增+删）, 1 个新文件
- **TDD**: enabled/skip
- **依赖**: Task M
```

### 5.3 预算提取

Phase 2 checkpoint PASS 时，与文件白名单同时提取：

```typescript
export function extractDiffBudgetFromPlan(
  planContent: string,
): { byTask: Record<string, { estimatedLines: number; estimatedNewFiles: number }>; total: number } {
  const byTask: Record<string, ...> = {};
  let total = 0;

  const sections = planContent.split(/(?=^## Task \d+)/m);
  for (const section of sections) {
    const taskMatch = section.match(/^## Task (\d+)/);
    if (!taskMatch) continue;

    // 解析 **预估规模**: ~30 行（增+删）, 1 个新文件
    const sizeMatch = section.match(/\*\*预估规模\*\*:\s*~?(\d+)\s*行/i);
    const newFileMatch = section.match(/(\d+)\s*个新文件/i);

    const estimatedLines = sizeMatch ? parseInt(sizeMatch[1]) : 50; // 默认 50 行
    const estimatedNewFiles = newFileMatch ? parseInt(newFileMatch[1]) : 0;

    byTask[taskMatch[1]] = { estimatedLines, estimatedNewFiles };
    total += estimatedLines;
  }

  return { byTask, total };
}
```

### 5.4 动态容差

小任务的相对波动更大，给更宽松的容差：

```typescript
export function getThresholds(estimatedLines: number): { warning: number; blocking: number } {
  if (estimatedLines < 50) {
    return { warning: 2.0, blocking: 3.0 };   // 小任务：2x 警告，3x 阻断
  } else if (estimatedLines <= 200) {
    return { warning: 1.5, blocking: 2.5 };   // 中任务
  } else {
    return { warning: 1.3, blocking: 2.0 };   // 大任务
  }
}
```

### 5.5 检查时机

**Phase 3 每个 task 的 checkpoint(phase=3, task=N, status="PASS") 时**：

```typescript
// 在 checkpoint handler 中 phase === 3 && status === "PASS" 时：

if (constraints?.diffBudget) {
  const taskBudget = constraints.diffBudget.byTask[String(task)];
  if (taskBudget) {
    // 获取实际 diff stats
    const git = new GitManager(projectRoot);
    const stats = await git.getDiffStats(taskStartCommit); // 新方法
    const actualLines = stats.addedLines + stats.deletedLines;

    // 记录实际值
    const actualByTask = { ...(constraints.diffBudget.actualByTask ?? {}) };
    actualByTask[String(task)] = {
      addedLines: stats.addedLines,
      deletedLines: stats.deletedLines,
      totalFiles: stats.filesChanged,
    };
    // 更新 state（不阻断此处，下面判断是否阻断）

    // 计算比率
    const ratio = actualLines / taskBudget.estimatedLines;
    const thresholds = getThresholds(taskBudget.estimatedLines);

    if (ratio > thresholds.blocking) {
      return textResult({
        error: "DIFF_BUDGET_EXCEEDED",
        estimated: taskBudget.estimatedLines,
        actual: actualLines,
        ratio: ratio.toFixed(1),
        message: `Task ${task} 超出 diff 预算：预估 ${taskBudget.estimatedLines} 行，` +
          `实际 ${actualLines} 行（${ratio.toFixed(1)}x）。` +
          `超过阻断阈值 ${thresholds.blocking}x。请拆分 task 或精简实现。`,
        mandate: "[BLOCKED] Diff 预算超标。",
      });
    }

    if (ratio > thresholds.warning) {
      // 警告但放行，记录到 progress-log
      await sm.appendToProgressLog(
        `<!-- DIFF_BUDGET_WARNING task=${task} estimated=${taskBudget.estimatedLines} ` +
        `actual=${actualLines} ratio=${ratio.toFixed(1)} -->\n`
      );
    }
  }
}
```

### 5.6 GitManager.getDiffStats（新方法）

```typescript
// git-manager.ts 新增

interface DiffStats {
  addedLines: number;
  deletedLines: number;
  filesChanged: number;
}

async getDiffStats(baseCommit: string): Promise<DiffStats> {
  this.validateRef(baseCommit);

  const numstat = await this.execGit(
    "diff", "--numstat", `${baseCommit}..HEAD`, "--"
  );

  let addedLines = 0;
  let deletedLines = 0;
  let filesChanged = 0;

  for (const line of numstat.trim().split("\n")) {
    if (!line.trim()) continue;
    const [added, deleted] = line.split("\t");
    // Binary files show "-" instead of numbers
    if (added !== "-") addedLines += parseInt(added, 10);
    if (deleted !== "-") deletedLines += parseInt(deleted, 10);
    filesChanged++;
  }

  return { addedLines, deletedLines, filesChanged };
}
```

## 六、Phase 3：复杂度惩罚（Complexity Penalty）

### 6.1 设计目标

量化代码变更的"质量成本"，不引入外部工具，纯基于 git diff 可计算的轻量指标。

### 6.2 复杂度指标

| 指标 | 计算方式 | 含义 |
|------|---------|------|
| 净增行数 (netAdded) | addedLines - deletedLines | 删代码同时改进功能是最优解 |
| 文件蔓延度 (fileSpread) | actualFiles / plannedFiles | 比值越大说明改动越分散 |
| 新增依赖数 (newDeps) | 扫描 diff 中新增的 import/require | 外部依赖增加维护成本 |

### 6.3 评分公式

```typescript
export function computeComplexityScore(
  netAdded: number,
  estimatedLines: number,
  actualFileCount: number,
  plannedFileCount: number,
  newDependencies: number,
): number {
  const lineRatio = Math.max(netAdded, 1) / Math.max(estimatedLines, 1);
  const fileSpread = Math.max(actualFileCount, 1) / Math.max(plannedFileCount, 1);
  const depPenalty = 1 + newDependencies * 0.1;

  return lineRatio * fileSpread * depPenalty;
}
```

**评分区间**：

| 分数 | 等级 | 处理 |
|------|------|------|
| < 1.0 | 优秀 | 无操作（做得比预估精简） |
| 1.0 - 1.5 | 正常 | 无操作 |
| 1.5 - 2.0 | 警告 | checkpoint 返回中标注 `complexityWarning` |
| > 2.0 | 需解释 | 写入 progress-log，Phase 4 Tribunal 必须关注 |

**注意**：复杂度惩罚**不阻断**，只标记。最终由 Phase 4 的 Tribunal 综合判断。

### 6.4 豁免规则

1. **测试文件豁免**：测试文件的行数不计入净增行数（但计入 diff 预算）
2. **TDD skip task 豁免**：标记为 `**TDD**: skip` 的配置/基础设施 task，阈值放宽 1.5x
3. **重构 task**：如果 task 描述包含"重构/refactor"关键词且 netAdded < 0，complexityScore 自动设为 0.5
4. **Task 1 宽容**：第一个 task 通常是基础设施搭建，阈值放宽 2x

### 6.5 新增依赖检测

```typescript
export function countNewDependencies(diffContent: string, language: string): number {
  const lines = diffContent.split("\n").filter(l => l.startsWith("+") && !l.startsWith("+++"));

  const importPatterns: Record<string, RegExp> = {
    java: /import\s+[\w.]+;/,
    node: /(?:import\s+.*from\s+['"]|require\s*\(\s*['"])([@\w/-]+)/,
    python: /(?:import\s+|from\s+)([\w.]+)/,
  };

  const pattern = importPatterns[language];
  if (!pattern) return 0;

  return lines.filter(l => pattern.test(l)).length;
}
```

## 七、约束级别配置

支持用户在 init 或运行时调整约束松紧度：

```typescript
// InitInputSchema 新增
constraintLevel: z.enum(["strict", "normal", "relaxed", "off"]).optional(),
```

| 级别 | 文件范围锁 | Diff 预算 | 复杂度惩罚 |
|------|-----------|-----------|-----------|
| **strict** | BLOCK 级别阻断，scope_extend 上限 50% | warning 1.2x / blocking 1.8x | 1.5 即阻断 |
| **normal**（默认） | 分级响应（同目录放行） | 动态容差（见 5.4） | 不阻断，仅标记 |
| **relaxed** | 全部 warn，不阻断 | warning 2.0x / blocking 3.5x | 仅记录 |
| **off** | 关闭约束系统 | 关闭 | 关闭 |

配置存入 state.json，Phase 3 checkpoint 检查时读取。

## 八、与现有系统的集成

### 8.1 与 diff_check 的集成

现有 `auto_dev_diff_check` 工具保持不变（向后兼容）。文件范围锁的校验内置在 **checkpoint handler** 中，不依赖 Agent 是否调用 diff_check。

关键区别：
- **现有 diff_check**：Agent 主动调用，结果仅展示 → 保留，用于 Agent 自检
- **新增 checkpoint 内置校验**：框架自动执行，Agent 无法绕过 → 这是"结构保证"

### 8.2 与 Tribunal 的集成

Phase 4 的 tribunal checklist（`tribunal-checklists.ts`）新增检查项：

```typescript
// Phase 4 checklist 新增
{
  id: "constraint_compliance",
  description: "约束合规检查",
  items: [
    "是否有白名单外的文件修改？如有，是否通过 scope_extend 正式申请？",
    "各 task 的 diff 预算使用率是否合理？（检查 DIFF_BUDGET_WARNING 标记）",
    "complexityScore > 1.5 的 task 是否有合理解释？",
    "scope_extend 使用频率是否过高（可能说明 plan 质量低）？",
  ],
}
```

### 8.3 与 TDD Gate 的集成

TDD RED 阶段只允许测试文件变更，这与文件范围锁正交：
- RED 阶段：`validateRedPhase` 已有自己的文件校验逻辑，不受范围锁影响
- GREEN 阶段：实现文件受范围锁约束
- 两套机制互不干扰

### 8.4 与 Phase 7 复盘的集成

Phase 7 的 reviewer 在 `retrospective.md` 中新增"约束合规分析"章节：
- 文件范围扩展次数和原因汇总
- Diff 预算总使用率（实际行数 / 预估行数）
- 复杂度评分分布（各 task 的 score 列表）
- 预估准确度分析（哪些 task 偏差最大，为什么）

## 九、改动范围汇总

### 新增文件

| 文件 | 说明 | 行数预估 |
|------|------|---------|
| `mcp/src/constraints.ts` | 约束引擎核心：解析 plan、分级校验、评分计算 | ~250 行 |
| `mcp/src/multi-repo-git-manager.ts` | 多 repo git 操作封装 | ~150 行 |
| `mcp/src/__tests__/constraints.test.ts` | 约束系统单元测试 | ~200 行 |
| `mcp/src/__tests__/multi-repo-git-manager.test.ts` | 多 repo 测试 | ~100 行 |

### 修改文件

| 文件 | 改动 |
|------|------|
| `mcp/src/types.ts` | 新增 `additionalRepos`、`constraints`、`constraintLevel` 字段到 StateJsonSchema 和 InitInputSchema |
| `mcp/src/index.ts` | ① Phase 2 checkpoint PASS 时提取约束 ② Phase 3 checkpoint PASS 时校验约束 ③ 注册 `auto_dev_scope_extend` 工具 ④ init handler 支持 additionalRepos 和 constraintLevel |
| `mcp/src/git-manager.ts` | 新增 `getDiffStats(baseCommit)` 方法 |
| `mcp/src/state-manager.ts` | `atomicUpdate` 支持 `constraints` 和 `additionalRepos` 字段的深度合并 |
| `mcp/src/phase-enforcer.ts` | 新增 `validateConstraints()` 统一入口 |
| `mcp/src/tribunal-checklists.ts` | Phase 4 checklist 增加约束合规检查项 |
| `skills/auto-dev/prompts/phase2-planner.md` | Plan Format 增加 `**预估规模**` 字段说明 |
| `skills/auto-dev/prompts/phase1-architect.md` | Design 模板增加"涉及组件"声明说明 |
| `skills/auto-dev/SKILL.md` | Phase 3 流程描述更新，增加约束相关说明 |
| `agents/auto-dev-developer.md` | 增加约束意识描述和 scope_extend 使用指引 |

### 不改动的文件

- `mcp/src/tdd-gate.ts` — TDD 流程不受影响
- `mcp/src/tribunal.ts` — Tribunal 执行逻辑不变，只改 checklist
- `mcp/src/lessons-manager.ts` — 经验系统不变
- `mcp/src/template-renderer.ts` — 模板渲染不变
- `mcp/src/retrospective.ts` — 框架生成的数据不变（复盘分析由 reviewer agent 完成）

## 十、分阶段实施计划

### 阶段 A：多 Repo 感知基础设施（2-3 天）

**目标**：让框架能感知和操作多个 Git 仓库。

1. `types.ts` — 新增 `additionalRepos` 字段
2. `multi-repo-git-manager.ts` — 实现 MultiRepoGitManager
3. `git-manager.ts` — 新增 `getDiffStats()` 方法
4. `index.ts` — init handler 支持 additionalRepos，记录 baseline commit
5. `state-manager.ts` — atomicUpdate 支持新字段
6. 单元测试

### 阶段 B：文件范围锁（2 天）

**目标**：Phase 3 checkpoint 内置文件范围校验。

1. `constraints.ts` — 实现 `extractFileScopeFromPlan()`、`classifyViolation()`
2. `index.ts` — Phase 2 checkpoint PASS 时提取白名单
3. `index.ts` — Phase 3 checkpoint PASS 时校验白名单（分级响应）
4. `index.ts` — 注册 `auto_dev_scope_extend` 工具
5. `phase2-planner.md` — 更新模板
6. 单元测试

### 阶段 C：Diff 预算（1.5 天）

**目标**：预估修改规模，超标时预警/阻断。

1. `constraints.ts` — 实现 `extractDiffBudgetFromPlan()`、`getThresholds()`
2. `index.ts` — Phase 2 checkpoint 时提取预算
3. `index.ts` — Phase 3 checkpoint 时校验预算
4. `phase2-planner.md` — 增加 `**预估规模**` 字段

### 阶段 D：复杂度惩罚（1.5 天）

**目标**：量化代码变更质量，标记异常。

1. `constraints.ts` — 实现 `computeComplexityScore()`、`countNewDependencies()`
2. `index.ts` — Phase 3 checkpoint 时计算并记录
3. `tribunal-checklists.ts` — Phase 4 增加合规检查

### 阶段 E：集成与打磨（1 天）

**目标**：端到端验证，文档更新。

1. `SKILL.md` 更新 Phase 3 流程描述
2. `agents/auto-dev-developer.md` 更新约束说明
3. `phase1-architect.md` 增加组件声明说明
4. 端到端测试（单 repo + 多 repo）
5. 约束级别配置（strict/normal/relaxed/off）

**总计约 8-9 天工作量。**

## 十一、风险与缓解

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|---------|
| plan.md 格式不规范导致解析失败 | 中 | 约束系统失效 | 宽容解析 + fallback（解析失败时 warn 但不 block，约束降级为 off） |
| 约束太紧导致频繁阻断浪费 token | 中 | 开发效率下降 | 默认 `normal` 级别；首周观察数据后调整默认值 |
| 预估行数本身不准 | 高 | diff 预算误报 | 动态容差（小任务高容差）；Phase 7 统计偏差率积累经验 |
| Agent 绕过约束（不调 diff_check） | 低 | 约束被规避 | 校验内置在 checkpoint handler 中，Agent 必须经过 checkpoint 才能推进 |
| scope_extend 被滥用 | 中 | 约束形同虚设 | 累计上限 100%；Phase 4 tribunal 审查；Phase 7 统计 |
| 多 repo 场景误检测外部修改 | 中 | 误判导致阻断 | 按 commit 过滤外部变更；baseline 机制隔离 |
| additionalRepos 路径不存在或非 git repo | 低 | init 失败 | 注册时校验路径存在且为 git repo，失败则 warn 但不 block |

## 十二、未来扩展

本设计为以下方向预留了扩展空间：

1. **可执行验收标准（方向一）**：acceptance-criteria.json 可以引用约束数据（diff 预算达成率、复杂度评分）作为自动 AC
2. **实验模式（方向二）**：实验循环的评分函数可以复用 complexityScore + diff 行数作为维度
3. **约束学习**：Phase 7 复盘时统计预估偏差率，作为 lesson 注入后续 Phase 2 的规划，逐步提高预估准确度
4. **IDE 集成**：约束数据（白名单、预算）可以导出为 IDE 配置，实现实时文件编辑提示
