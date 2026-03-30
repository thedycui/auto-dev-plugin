# Phase 3 TDD Gate 设计方案：RED-GREEN 强制门禁

## 一、问题定义

auto-dev 的 TDD 模式（`tdd: true`）已连续在 3 个项目中被跳过：
- metrics-web v2-three-features：先写实现后补测试，Phase 5 才统一写
- metrics-web api-key-auth：55 个用例全标 DEFERRED，0 个测试文件
- auto-dev tribunal：`tdd: true` 在 state 中但无 commit 证明 test-first

**根因**：TDD 是**过程约束**（先写测试再写实现），但当前框架只能验证**产物**（有没有测试文件）。Phase 3 的 developer agent 收到"实现 Task N"的指令后，自然先写实现再补测试，框架无法追溯编写顺序。

**为什么现有机制不够**：
- SKILL.md 写了 TDD Iron Law → 遵守率 ~50%，agent 直接忽略
- Phase 3 checkpoint 检查 git diff 有没有测试文件 → 一次性写完 test+impl 也能通过
- 并行 agent 执行不产生 commit → 基于 commit 顺序的检查完全失效
- Phase 5 tribunal 能审查测试质量 → 但无法追溯 Phase 3 的编写过程

**核心矛盾**：
> 当前 Phase 3 的一个 task 调用一次 agent，agent 一次性返回 test+impl。框架在 agent 返回后才介入，已经来不及检查"先写了什么"。

## 二、设计目标

在 Phase 3 内部实现 TDD 的机械约束，确保：

1. **每个 task 的测试文件必须先于实现文件提交** — 框架级强制，不依赖 agent 自觉
2. **RED 状态可验证** — 测试写完后必须有失败的测试，证明测试在验证真实逻辑
3. **GREEN 状态可验证** — 实现写完后所有测试必须通过
4. **不完全杀死并行** — 允许独立 task 之间并行，但单个 task 内部 RED→GREEN 串行
5. **支持豁免** — 纯配置/文档 task 可标记 `tdd: skip`

## 三、方案设计

### 方案 A：RED-GREEN Gate（推荐）

每个 task 拆为两步，框架在中间做 gate：

```
Task N:
  Step 1 (RED):  agent 只写测试 → 框架验证只有测试文件变更 + 新测试失败
  Step 2 (GREEN): agent 只写实现 → 框架验证所有测试通过
```

**优点**：
- 框架在 RED 和 GREEN 之间做了物理隔离，agent 不可能一次性写完 test+impl
- 失败的测试是 RED 的客观证据
- 与现有 task 粒度对齐，不需要改 plan 格式

**缺点**：
- 每个 task 需要两次 agent 调用，Phase 3 耗时增加
- "只跑新测试"需要按语言生成特定命令

### 方案 B：Two-Pass Phase 3

Phase 3 拆为两遍：先写所有测试（3A），再写所有实现（3B）。

**优点**：测试和实现在时间上完全分离
**缺点**：不是 per-task 的 TDD，后写的实现可能改变测试需求；失去 task 级粒度

### 方案 C：Framework-Controlled Agent（tribunal 方式）

框架用 `claude -p` 分别调用两次独立 agent：一次写测试，一次写实现。

**优点**：主 Agent 完全无法干预
**缺点**：成本翻倍（每个 task 两次 claude -p 调用），且丧失上下文连续性

### 决策：选择方案 A

方案 A 在约束力和成本之间最平衡。主 Agent 仍然控制 agent 调用，但框架在两步之间做 gate，物理上不可能跳过 RED。

## 四、详细设计

### 4.1 新增 MCP Tools

#### `auto_dev_task_red`

RED 阶段完成后调用，框架验证测试文件已写好且测试失败。

```typescript
{
  name: "auto_dev_task_red",
  description: "提交 Task 的 RED 阶段（仅测试文件）。框架验证：只有测试文件变更 + 新测试失败。",
  parameters: {
    projectRoot: z.string(),
    topic: z.string(),
    task: z.number(),
    testFiles: z.array(z.string()),  // 新增/修改的测试文件路径列表
  }
}
```

Handler 逻辑：
1. 验证当前 phase=3，status=IN_PROGRESS
2. 验证 task 的 RED 尚未完成
3. **文件分类检查**：git diff 中只允许测试文件变更
   - 测试文件：匹配 `*Test.*`, `*.test.*`, `*.spec.*`, `_test.*`, `tests/` 目录
   - 如果有实现文件变更 → **REJECTED**："RED 阶段不允许写实现代码"
4. **测试失败验证**：运行指定的测试文件
   - Java: `mvn test -Dtest="TestClassName" -pl module`
   - vitest: `npx vitest run path/to/test.ts`
   - pytest: `pytest path/to/test.py`
   - 命令由框架根据语言和 testFiles 参数自动生成
   - 至少有 1 个测试 FAIL → RED 确认
   - 所有测试 PASS → **REJECTED**："没有失败的测试，RED 不成立"
5. 记录 RED snapshot（git stash create 或 file hash）
6. 返回 `{ status: "RED_CONFIRMED", task, failedTests: [...] }`

#### `auto_dev_task_green`

GREEN 阶段完成后调用，框架验证实现已写好且测试通过。

```typescript
{
  name: "auto_dev_task_green",
  description: "提交 Task 的 GREEN 阶段（实现代码）。前置：task_red 必须已 PASS。框架验证：所有测试通过。",
  parameters: {
    projectRoot: z.string(),
    topic: z.string(),
    task: z.number(),
  }
}
```

Handler 逻辑：
1. **前置检查**：task 的 RED 必须已 CONFIRMED → 否则 **REJECTED**："必须先完成 RED"
2. **测试通过验证**：运行 testCmd
   - 所有测试 PASS → GREEN 确认
   - 有测试 FAIL → **REJECTED**："实现不完整，测试仍在失败"
3. 返回 `{ status: "GREEN_CONFIRMED", task }`

### 4.2 Task 状态机

```
task_pending → RED_IN_PROGRESS → RED_CONFIRMED → GREEN_IN_PROGRESS → GREEN_CONFIRMED
                                                                           │
                                                                    task_completed
```

每个 task 的 TDD 状态存储在 state.json 中：

```typescript
// state.json 新增字段
tddTaskStates: z.record(z.string(), z.object({
  redConfirmed: z.boolean(),
  redTestFiles: z.array(z.string()).optional(),
  redFailedTests: z.array(z.string()).optional(),
  greenConfirmed: z.boolean(),
})).optional(),
```

### 4.3 修改 Phase 3 的 checkpoint

现有 `checkpoint(phase=3, task=N, status=PASS)` 需要增加验证：

```typescript
// 在 Phase 3 checkpoint PASS 时检查
if (phase === 3 && status === "PASS" && state.tdd === true) {
  const tddState = state.tddTaskStates?.[String(task)];

  // 检查是否 TDD-exempt task
  const isExempt = await isTddExemptTask(outputDir, task);  // 从 plan.md 解析

  if (!isExempt) {
    if (!tddState?.redConfirmed) {
      return reject("Task 未完成 RED 阶段。必须先调用 auto_dev_task_red。");
    }
    if (!tddState?.greenConfirmed) {
      return reject("Task 未完成 GREEN 阶段。必须先调用 auto_dev_task_green。");
    }
  }
}
```

### 4.4 "只跑新测试"命令生成

RED 阶段需要只跑新增的测试文件，不跑全量测试（避免预存失败干扰）。

```typescript
function buildTestCommand(
  language: string,
  testFiles: string[],
  projectRoot: string,
): string {
  switch (language) {
    case "Java 8":
    case "Java":
      // 提取类名：src/test/java/com/foo/BarTest.java → BarTest
      const classes = testFiles.map(f => {
        const match = f.match(/([^/]+)\.java$/);
        return match ? match[1] : null;
      }).filter(Boolean);
      return `mvn test -Dtest="${classes.join(",")}" -DfailIfNoTests=false`;

    case "TypeScript/JavaScript":
    case "TypeScript":
      return `npx vitest run ${testFiles.join(" ")} --reporter=verbose`;

    case "Python":
      return `pytest ${testFiles.join(" ")} -v`;

    default:
      // 回退：跑全量测试
      return "";  // 空字符串表示用 testCmd
  }
}
```

### 4.5 TDD 豁免机制

不是所有 task 都适合 TDD。plan.md 中可以标注豁免：

```markdown
## Task 9: Update SKILL.md
- **TDD**: skip（配置文件，无可测逻辑）
- **理由**: 纯文档更新，没有可执行的逻辑

## Task 10: Build verification
- **TDD**: skip（验证任务，不产出代码）
```

框架解析 plan.md 判断 task 是否豁免：

```typescript
async function isTddExemptTask(outputDir: string, task: number): Promise<boolean> {
  const plan = await readFile(join(outputDir, "plan.md"), "utf-8").catch(() => "");
  // 匹配 Task N 下的 **TDD**: skip
  const regex = new RegExp(
    `## Task ${task}[\\s\\S]*?\\*\\*TDD\\*\\*:\\s*skip`,
    "i"
  );
  return regex.test(plan);
}
```

### 4.6 并行策略

RED-GREEN gate 是否杀死并行？**不完全**。

```
策略 1：Task 内串行，Task 间并行（推荐）

  Task 1: RED → GREEN  ←─┐
  Task 2: RED → GREEN  ←─┤ 并行（如果无依赖）
  Task 3: RED → GREEN  ←─┘

  但每个 Task 内部 RED 必须在 GREEN 之前
```

```
策略 2：批量 RED → 批量 GREEN（替代方案）

  Task 1 RED ──┐
  Task 2 RED ──┤ 并行写测试
  Task 3 RED ──┘
  框架批量验证 RED
  Task 1 GREEN ──┐
  Task 2 GREEN ──┤ 并行写实现
  Task 3 GREEN ──┘
  框架批量验证 GREEN
```

**注意**：如果两个并行 task 的测试和实现涉及同一个文件，需要串行。框架通过 plan.md 中的依赖关系判断。

### 4.7 SKILL.md 更新

Phase 3 的驱动循环需要更新：

```markdown
## Phase 3: EXECUTE（TDD 模式）

对 plan.md 中每个 task：

if task.tdd == "skip":
    # 豁免 task，走原流程
    调用 developer agent 实现 task
    checkpoint(phase=3, task=N, status=PASS)
else:
    # TDD task，走 RED-GREEN gate
    Step 1 (RED):
        调用 developer agent："只写 Task N 的测试，不写实现代码"
        auto_dev_task_red(task=N, testFiles=[...])
        → RED_CONFIRMED 后进入 Step 2
        → REJECTED 则修改测试后重试

    Step 2 (GREEN):
        调用 developer agent："写 Task N 的最小实现，让测试通过"
        auto_dev_task_green(task=N)
        → GREEN_CONFIRMED 后 task 完成
        → REJECTED 则修改实现后重试

    checkpoint(phase=3, task=N, status=PASS)
```

## 五、文件改动清单

| 文件 | 改动 | 说明 |
|------|------|------|
| `mcp/src/index.ts` | 修改 | 新增 `auto_dev_task_red` 和 `auto_dev_task_green` handler；Phase 3 checkpoint 增加 TDD 状态检查 |
| `mcp/src/tdd-gate.ts` | **新增** | RED/GREEN 验证逻辑：文件分类检查、测试命令生成、测试执行、状态管理 |
| `mcp/src/types.ts` | 修改 | StateJsonSchema 新增 `tddTaskStates` 字段 |
| `mcp/src/phase-enforcer.ts` | 修改 | `isTddExemptTask` 从 plan.md 解析豁免标记 |
| `skills/auto-dev/SKILL.md` | 修改 | Phase 3 驱动循环改为 RED-GREEN 流程 |
| `skills/auto-dev/prompts/phase3-developer.md` | 修改 | 分为 RED prompt（只写测试）和 GREEN prompt（只写实现） |

## 六、与现有机制的关系

| 机制 | Phase 3 RED-GREEN Gate | 关系 |
|------|------------------------|------|
| Phase 3 checkpoint TDD 检查 | 现有：检查 git diff 有没有测试文件 | **替换为**：检查 tddTaskStates 的 RED+GREEN 是否都 confirmed |
| Phase 4 tribunal | Code review | **互补**：Phase 3 gate 保证 TDD 过程，Phase 4 审查代码质量 |
| Phase 5 tribunal | 测试充分性审查 | **互补**：Phase 3 gate 保证每个 task 有测试，Phase 5 审查测试覆盖率 |
| `tdd: true` in state | 开关 | **保留**：`tdd: false` 时 RED-GREEN gate 不启用 |

## 七、验收标准

| AC | 描述 | 验证方式 |
|----|------|---------|
| AC-1 | `auto_dev_task_red` 在只有测试文件变更时返回 RED_CONFIRMED | 单元测试 |
| AC-2 | `auto_dev_task_red` 在有实现文件变更时返回 REJECTED | 单元测试 |
| AC-3 | `auto_dev_task_red` 在所有新测试都 PASS 时返回 REJECTED（不是真正的 RED） | 单元测试 |
| AC-4 | `auto_dev_task_green` 在 RED 未完成时返回 REJECTED | 单元测试 |
| AC-5 | `auto_dev_task_green` 在所有测试 PASS 时返回 GREEN_CONFIRMED | 单元测试 |
| AC-6 | `auto_dev_task_green` 在测试仍 FAIL 时返回 REJECTED | 单元测试 |
| AC-7 | Phase 3 checkpoint(task=N, PASS) 在 tdd=true 时要求 RED+GREEN 都 confirmed | 单元测试 |
| AC-8 | plan.md 中标注 `TDD: skip` 的 task 跳过 RED-GREEN 检查 | 单元测试 |
| AC-9 | Java 项目的 RED 阶段生成正确的 `mvn test -Dtest=` 命令 | 单元测试 |
| AC-10 | TypeScript 项目的 RED 阶段生成正确的 `npx vitest run` 命令 | 单元测试 |
| AC-11 | tdd=false 时 RED-GREEN gate 不启用，走原流程 | 单元测试 |
| AC-12 | SKILL.md 描述了 RED-GREEN 流程 | 代码审查 |

## 八、成本影响

| 场景 | 当前 Phase 3 | 改造后 Phase 3 |
|------|-------------|--------------|
| 10 个 task（8 TDD + 2 skip） | 8 次 agent 调用 | 16 次 agent 调用（每个 TDD task 2 次） |
| 时间增量 | — | +50%~80%（RED 步骤较快，只写测试） |
| Token 增量 | — | +30%~50%（RED prompt 比 GREEN 短） |

相比于"写完代码后才发现测试不够"导致的返工，这个成本是值得的。

## 九、风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| RED 阶段 agent 偷偷写了实现代码 | gate 检查会拦住 | 文件分类检查（测试文件 vs 实现文件） |
| "只跑新测试"命令不适用于某些项目 | RED 验证失败 | 回退到全量 testCmd |
| 并行 task 的测试互相干扰 | 误判 RED/GREEN | 通过 plan.md 依赖关系判断是否可并行 |
| 某些逻辑无法先写测试（如 UI 渲染） | 强制 TDD 不合理 | `TDD: skip` 豁免机制 |
| 增加 Phase 3 耗时 | 整体 auto-dev 变慢 | RED 步骤较快（只写测试），实际增量 ~50% |
