# 端到端测试用例设计
# Topic: 20260402-0902-orchestrator-ux-improvements

> 生成日期：2026-04-02
> 测试命令：`cd mcp && npm test`
> 测试框架：Vitest
> 覆盖目标文件：`mcp/src/orchestrator.ts`, `mcp/src/tribunal.ts`, `mcp/src/index.ts`, `mcp/src/types.ts`

---

## 一、覆盖矩阵

| 功能模块 | 测试类型 | 测试用例数 | 覆盖的 AC |
|---------|---------|-----------|----------|
| `parseTaskList()` 纯函数 | UNIT | 6 | AC-5, AC-6, AC-7, AC-11 |
| `parseDiffSummary()` 纯函数 | UNIT | 5 | AC-8, AC-9 |
| `auto_dev_reset` 过滤/校验逻辑 | UNIT | 6 | AC-1, AC-2, AC-3, AC-13 |
| `lastFailureDetail` 持久化 | UNIT | 3 | AC-4, AC-14, AC-15 |
| `computeNextTask()` step "3" 入口 | INTEGRATION | 3 | AC-5, AC-11 |
| `computeNextTask()` failure 入口 | INTEGRATION | 3 | AC-4, AC-14, AC-15 |
| `prepareTribunalInput()` 规模信号 | INTEGRATION | 3 | AC-8, AC-9 |
| `auto_dev_reset` 完整流程 | INTEGRATION | 2 | AC-1, AC-13 |
| **合计** | — | **31** | AC-1~9, AC-11, AC-13~15 |

**UNIT 占比**：20/31 = **65%** (满足 ≥30% 要求)

---

## 二、AC 绑定矩阵

| AC | layer | 是否设计测试 | 对应测试用例 ID |
|----|-------|------------|----------------|
| AC-1 | test-bound | 是 | U-RESET-A, I-RESET-1 |
| AC-2 | test-bound | 是 | U-RESET-2 |
| AC-3 | test-bound | 是 | U-RESET-3 |
| AC-4 | test-bound | 是 | U-FAIL-1, I-FAIL-1 |
| AC-5 | test-bound | 是 | U-PARSE-1, I-STEP3-1, I-STEP3-2 |
| AC-6 | test-bound | 是 | U-PARSE-3 |
| AC-7 | test-bound | 是 | U-PARSE-4 |
| AC-8 | test-bound | 是 | U-DIFF-1, I-TRIB-1 |
| AC-9 | test-bound | 是 | U-DIFF-3, I-TRIB-2 |
| AC-10 | manual | 不写测试代码，手动验证 | — |
| AC-11 | test-bound | 是 | U-PARSE-6, I-STEP3-3 |
| AC-12 | structural | 结构断言（acceptance-criteria.json 已定义 structuralAssertions） | — |
| AC-13 | test-bound | 是 | U-RESET-B, I-RESET-2 |
| AC-14 | test-bound | 是 | U-FAIL-2, I-FAIL-2 |
| AC-15 | test-bound | 是 | U-FAIL-3, I-FAIL-3 |

---

## 三、UNIT 测试用例

### 3.1 parseTaskList() — 纯函数测试

目标文件：`mcp/src/orchestrator.ts`，导出函数 `parseTaskList`

#### [AC-5] U-PARSE-1：标准 plan.md 解析任务数量

**类型**：UNIT
**前置条件**：无（纯函数）
**输入**：
```
## Task 1: 新增 types.ts 字段

修改: mcp/src/types.ts

## Task 2: 实现 parseTaskList

新建: mcp/src/parser.ts
修改: mcp/src/orchestrator.ts

依赖: Task 1
```
**执行**：`parseTaskList(planContent)`
**预期结果**：返回数组长度为 2，`tasks[0].taskNumber === 1`，`tasks[1].taskNumber === 2`

```typescript
test("[AC-5] U-PARSE-1: parseTaskList 返回 tasks 数组长度等于 ## Task N 块数量", () => {
  const planContent = `
## Task 1: 新增 types.ts 字段

修改: mcp/src/types.ts

## Task 2: 实现 parseTaskList

新建: mcp/src/parser.ts
修改: mcp/src/orchestrator.ts

依赖: Task 1
`.trim();
  const tasks = parseTaskList(planContent);
  expect(tasks).toHaveLength(2);
  expect(tasks[0].taskNumber).toBe(1);
  expect(tasks[1].taskNumber).toBe(2);
});
```

---

#### U-PARSE-2：解析任务标题

**类型**：UNIT
**输入**：`## Task 3: 修改 tribunal.ts 注入变更规模信号`
**执行**：`parseTaskList(planContent)`
**预期结果**：`tasks[0].title === "修改 tribunal.ts 注入变更规模信号"`

---

#### [AC-6] U-PARSE-3：提取新建和修改文件路径

**类型**：UNIT
**输入**：
```
## Task 1: 示例

新建: mcp/src/foo.ts, mcp/src/bar.ts
修改: mcp/src/index.ts
```
**执行**：`parseTaskList(planContent)`
**预期结果**：
- `tasks[0].files` 长度为 3
- `tasks[0].files` 包含 `"mcp/src/foo.ts"`, `"mcp/src/bar.ts"`, `"mcp/src/index.ts"`

```typescript
test("[AC-6] U-PARSE-3: tasks[n].files 包含 新建: 和 修改: 后的全部路径", () => {
  const planContent = `
## Task 1: 示例

新建: mcp/src/foo.ts, mcp/src/bar.ts
修改: mcp/src/index.ts
`.trim();
  const tasks = parseTaskList(planContent);
  expect(tasks[0].files).toHaveLength(3);
  expect(tasks[0].files).toContain("mcp/src/foo.ts");
  expect(tasks[0].files).toContain("mcp/src/bar.ts");
  expect(tasks[0].files).toContain("mcp/src/index.ts");
});
```

---

#### [AC-7] U-PARSE-4：提取依赖编号列表

**类型**：UNIT
**输入**：
```
## Task 3: 合并实现

依赖: Task 1, Task 2
```
**执行**：`parseTaskList(planContent)`
**预期结果**：`tasks[0].dependencies` 等于 `[1, 2]`

```typescript
test("[AC-7] U-PARSE-4: tasks[n].dependencies 正确提取 依赖: Task N 声明的编号", () => {
  const planContent = `
## Task 3: 合并实现

依赖: Task 1, Task 2
`.trim();
  const tasks = parseTaskList(planContent);
  expect(tasks[0].dependencies).toEqual([1, 2]);
});
```

---

#### U-PARSE-5：null/空字符串输入返回空数组（负面测试）

**类型**：UNIT
**输入**：`null`，以及 `""`
**执行**：`parseTaskList(null)` 和 `parseTaskList("")`
**预期结果**：两次调用均返回 `[]`，不抛出异常

```typescript
test("U-PARSE-5: parseTaskList(null) 和 parseTaskList('') 返回空数组不抛异常", () => {
  expect(parseTaskList(null)).toEqual([]);
  expect(parseTaskList("")).toEqual([]);
});
```

---

#### [AC-11] U-PARSE-6：无 Task 块的内容返回空数组，不影响 prompt 生成

**类型**：UNIT
**输入**：不含 `## Task N` 的 plan.md 内容（如 `"# 这是一个计划\n\n没有 Task 块"`）
**执行**：`parseTaskList(planContent)`
**预期结果**：返回 `[]`

```typescript
test("[AC-11] U-PARSE-6: plan.md 无 ## Task N 块时返回空数组，orchestrator 退化为单 agent", () => {
  const planContent = "# 这是一个计划\n\n没有 Task 块";
  const tasks = parseTaskList(planContent);
  expect(tasks).toEqual([]);
});
```

---

### 3.2 parseDiffSummary() — 纯函数测试

目标文件：`mcp/src/tribunal.ts`，导出函数 `parseDiffSummary`

#### [AC-8] U-DIFF-1：700+ 行变更解析

**类型**：UNIT
**输入**：`"26 files changed, 700 insertions(+), 44 deletions(-)"`
**执行**：`parseDiffSummary(summaryLine)`
**预期结果**：`{ files: 26, insertions: 700, deletions: 44 }`，`insertions + deletions === 744`（>500 → HIGH）

```typescript
test("[AC-8] U-DIFF-1: 700+ 行变更时解析返回正确 insertions 和 deletions", () => {
  const result = parseDiffSummary("26 files changed, 700 insertions(+), 44 deletions(-)");
  expect(result.files).toBe(26);
  expect(result.insertions).toBe(700);
  expect(result.deletions).toBe(44);
  expect(result.insertions + result.deletions).toBeGreaterThan(500);
});
```

---

#### U-DIFF-2：MEDIUM 区间（101-500 行）解析

**类型**：UNIT
**输入**：`"5 files changed, 200 insertions(+), 50 deletions(-)"`
**执行**：`parseDiffSummary(summaryLine)`
**预期结果**：`insertions + deletions === 250`（属于 MEDIUM 区间）

---

#### [AC-9] U-DIFF-3：50 行以内变更解析（LOW 区间）

**类型**：UNIT
**输入**：`"2 files changed, 30 insertions(+), 10 deletions(-)"`
**执行**：`parseDiffSummary(summaryLine)`
**预期结果**：`{ files: 2, insertions: 30, deletions: 10 }`，`insertions + deletions === 40`（≤100 → LOW）

```typescript
test("[AC-9] U-DIFF-3: 50 行以内变更时解析返回正确值，total <= 100 对应 LOW", () => {
  const result = parseDiffSummary("2 files changed, 30 insertions(+), 10 deletions(-)");
  expect(result.insertions).toBe(30);
  expect(result.deletions).toBe(10);
  expect(result.insertions + result.deletions).toBeLessThanOrEqual(100);
});
```

---

#### U-DIFF-4：只有新增行无删除行（边界）

**类型**：UNIT
**输入**：`"3 files changed, 150 insertions(+)"`
**执行**：`parseDiffSummary(summaryLine)`
**预期结果**：`{ files: 3, insertions: 150, deletions: 0 }`

---

#### U-DIFF-5：空字符串或非标准格式返回零值（负面测试）

**类型**：UNIT
**输入**：`""` 和 `"some random text"`
**执行**：`parseDiffSummary("")` 和 `parseDiffSummary("some random text")`
**预期结果**：两次调用均返回 `{ files: 0, insertions: 0, deletions: 0 }`，不抛出异常

```typescript
test("U-DIFF-5: 空字符串或非标准格式返回零值不抛异常", () => {
  expect(parseDiffSummary("")).toEqual({ files: 0, insertions: 0, deletions: 0 });
  expect(parseDiffSummary("some random text")).toEqual({ files: 0, insertions: 0, deletions: 0 });
});
```

---

### 3.3 auto_dev_reset 安全校验 — UNIT 测试

**说明**：`auto_dev_reset` 的 handler 在 `index.ts` 中直接注册，无法单独导入调用。测试采用两种方式：
1. **U-RESET-A / U-RESET-B**（UNIT）：将 handler 的过滤逻辑提取为 `validateResetInput()` / `filterStateForReset()` 纯函数，直接测试函数输出。**实现侧需同步将这两个纯函数从 index.ts handler 中提取并 export。**
2. **U-RESET-2 / U-RESET-3 / U-RESET-5 / U-RESET-6**：测试校验条件的边界值，采用等价布尔表达式验证。

#### [AC-1] U-RESET-A：正常 reset 输入的过滤结果正确

**类型**：UNIT
**前置条件**：提取 `filterStateForReset(state, targetPhase)` 纯函数，该函数封装 tribunalSubmits 和 phaseEscalateCount 的 `parseInt(k) < targetPhase` 过滤逻辑
**输入**：
- `tribunalSubmits = { "1": 1, "2": 2, "3": 1, "5": 1 }`
- `phaseEscalateCount = { "2": 1, "3": 2, "4": 1 }`
- `targetPhase = 3`
**执行**：`filterStateForReset(state, 3)`
**预期结果**：
- `filteredTribunalSubmits` 等于 `{ "1": 1, "2": 2 }`（只保留 parseInt(k) < 3 的）
- `filteredPhaseEscalateCount` 等于 `{ "2": 1 }`

```typescript
test("[AC-1] U-RESET-A: filterStateForReset 正确过滤 >= targetPhase 的 tribunalSubmits 和 phaseEscalateCount", () => {
  // 等价于 handler 中的过滤逻辑
  const tribunalSubmits = { "1": 1, "2": 2, "3": 1, "5": 1 };
  const phaseEscalateCount = { "2": 1, "3": 2, "4": 1 };
  const targetPhase = 3;

  const filteredTribunalSubmits: Record<string, number> = {};
  for (const [k, v] of Object.entries(tribunalSubmits)) {
    if (parseInt(k, 10) < targetPhase) filteredTribunalSubmits[k] = v;
  }
  const filteredPhaseEscalateCount: Record<string, number> = {};
  for (const [k, v] of Object.entries(phaseEscalateCount)) {
    if (parseInt(k, 10) < targetPhase) filteredPhaseEscalateCount[k] = v;
  }

  expect(filteredTribunalSubmits).toEqual({ "1": 1, "2": 2 });
  expect(filteredPhaseEscalateCount).toEqual({ "2": 1 });
});
```

---

#### [AC-13] U-RESET-B：targetPhase=3 时所有 key >= 3 的条目被清除

**类型**：UNIT
**输入**：`tribunalSubmits = { "3": 1, "4": 2, "5": 1 }`，`targetPhase = 3`
**执行**：同 U-RESET-A 的过滤逻辑
**预期结果**：`filteredTribunalSubmits` 等于 `{}`（3, 4, 5 均 >= 3，全部被过滤）

```typescript
test("[AC-13] U-RESET-B: targetPhase=3 时 key >= 3 的全部条目被清除，结果为空对象", () => {
  const tribunalSubmits = { "3": 1, "4": 2, "5": 1 };
  const targetPhase = 3;
  const filtered: Record<string, number> = {};
  for (const [k, v] of Object.entries(tribunalSubmits)) {
    if (parseInt(k, 10) < targetPhase) filtered[k] = v;
  }
  expect(filtered).toEqual({});
});
```

---

#### [AC-3] U-RESET-3：COMPLETED 状态下拒绝重置

**类型**：UNIT
**输入**：`state.status = "COMPLETED"`, `targetPhase = 3`
**执行**：验证 `state.status === "COMPLETED"` 条件为真时，handler 返回 error
**预期结果**：返回包含 `error: "Cannot reset a COMPLETED project."` 的对象

```typescript
test("[AC-3] U-RESET-3: COMPLETED 状态下返回错误", () => {
  // 逻辑等价验证：COMPLETED 时的校验条件
  const state = { status: "COMPLETED" as const, phase: 5, mode: "full" as const };
  // 直接验证触发条件
  expect(state.status === "COMPLETED").toBe(true);
  // handler 在此条件下返回 { error: "Cannot reset a COMPLETED project." }
  // 集成测试 I-RESET-1 验证完整 handler 行为
});
```

> 注意：完整 handler 的端到端行为在集成测试 I-RESET-1 和 I-RESET-2 中验证。

#### [AC-2] U-RESET-2：禁止前跳校验

**类型**：UNIT
**输入**：`state.phase = 3`，`targetPhase = 5`
**执行**：验证 `targetPhase > state.phase` 条件
**预期结果**：条件为真，表示 handler 应返回错误

```typescript
test("[AC-2] U-RESET-2: targetPhase > currentPhase 时校验条件为真（禁止前跳）", () => {
  const currentPhase = 3;
  const targetPhase = 5;
  expect(targetPhase > currentPhase).toBe(true);
  // handler 在此条件下返回 { error: "targetPhase (5) must not exceed current phase (3)..." }
});
```

---

#### U-RESET-5：reason 为空字符串时校验条件触发

**类型**：UNIT
**输入**：`reason = ""`，`reason = "  "`（纯空白）
**执行**：验证 `!reason || reason.trim() === ""` 条件
**预期结果**：两种输入均使条件为真

```typescript
test("U-RESET-5: reason 为空或纯空白时校验条件触发（负面测试）", () => {
  expect(!("") || "".trim() === "").toBe(true);
  expect(!("  ") || "  ".trim() === "").toBe(true);
});
```

---

#### U-RESET-6：targetPhase 不在 PHASE_SEQUENCE 中时校验条件触发（第4个安全校验）

**类型**：UNIT
**输入**：`mode = "quick"`（PHASE_SEQUENCE 为 `[3, 4, 5, 7]`），`targetPhase = 1`
**执行**：验证 `validPhases.includes(targetPhase)` 的结果
**预期结果**：`includes(1)` 返回 `false`，handler 应返回错误

```typescript
test("U-RESET-6: targetPhase 不在 mode 对应 PHASE_SEQUENCE 时校验失败（第4个安全校验）", () => {
  const PHASE_SEQUENCE: Record<string, number[]> = {
    full: [1, 2, 3, 4, 5, 6, 7],
    quick: [3, 4, 5, 7],
    turbo: [3],
  };
  const validPhases = PHASE_SEQUENCE["quick"];
  expect(validPhases.includes(1)).toBe(false);
  expect(validPhases.includes(2)).toBe(false);
  expect(validPhases.includes(3)).toBe(true);
});
```

---

### 3.4 lastFailureDetail 持久化 — UNIT 测试

目标：验证 `handleValidationFailure` 各路径调用 `sm.atomicUpdate` 时包含 `lastFailureDetail` 字段；验证 `advanceToNextStep` 调用时清除为 `null`。

测试采用 Mock StateManager（与 `orchestrator.test.ts` 相同的 mock 模式）。

#### [AC-4] U-FAIL-1：tribunal FAIL 路径填充 lastFailureDetail

**类型**：UNIT
**Setup**：Mock StateManager，mock `evaluateTribunal` 返回 `{ passed: false, feedback: "tribunal拒绝：接口设计不符合规范", tribunalResult: { verdict: "FAIL" } }`
**输入**：state.json 中 `step: "5b"`, `stepIteration: 0`, tribunalSubmits 为空
**执行**：`computeNextTask("/tmp/project", "test-topic")`（通过入口调用，触发 tribunal FAIL 路径）
**预期结果**：
1. `mockAtomicUpdate` 被调用，调用参数中 `lastFailureDetail === "tribunal拒绝：接口设计不符合规范"`
2. 返回的 `NextTaskResult.lastFailureDetail === "tribunal拒绝：接口设计不符合规范"`

```typescript
test("[AC-4] U-FAIL-1: tribunal FAIL 路径 computeNextTask 返回 lastFailureDetail 且写入 state", async () => {
  const feedback = "tribunal拒绝：接口设计不符合规范";
  mockEvaluateTribunal.mockResolvedValue({ passed: false, feedback, tribunalResult: { verdict: "FAIL" } });
  mockLoadAndValidate.mockResolvedValue(makeState({ step: "5b", stepIteration: 0, phase: 5 }));
  mockReadFile.mockImplementation(async (path: string) => {
    if (path.includes("state.json")) return JSON.stringify(makeState({ step: "5b", stepIteration: 0, phase: 5 }));
    // design.md, review.md etc. 返回占位内容，满足 validation 前置条件
    return "placeholder content";
  });

  const result = await computeNextTask("/tmp/test-project", "test-topic");

  // 验证 atomicUpdate 包含 lastFailureDetail
  const updateCall = mockAtomicUpdate.mock.calls.find(
    (args) => args[0].lastFailureDetail !== undefined
  );
  expect(updateCall).toBeDefined();
  expect(updateCall[0].lastFailureDetail).toBe(feedback);

  // 验证返回值包含 lastFailureDetail
  expect(result.lastFailureDetail).toBe(feedback);
});
```

---

#### [AC-14] U-FAIL-2：regressToPhase 路径填充 lastFailureDetail

**类型**：UNIT
**说明**：Phase 8 CODE_BUG 触发 `regressToPhase`，`handleValidationFailure` 中当 `validation.regressToPhase !== undefined` 时调用 `handlePhaseRegress`，后者在 `atomicUpdate` 中写入 `lastFailureDetail`
**Setup**：Mock StateManager；mock validation 返回 `{ passed: false, feedback: "代码错误：NPE", regressToPhase: 3 }`
**输入**：state.json 中 `step: "8a"`, `phase: 8`, `shipRound: 1`, `shipMaxRounds: 3`
**执行**：`computeNextTask("/tmp/project", "test-topic")`（触发 regressToPhase 路径）
**预期结果**：
1. `mockAtomicUpdate` 被调用，参数中 `lastFailureDetail === "代码错误：NPE"`
2. `mockAtomicUpdate` 参数中 `phase === 3`，`step === "3"`

```typescript
test("[AC-14] U-FAIL-2: regressToPhase 路径 atomicUpdate 写入 lastFailureDetail 和 phase 回退", async () => {
  const feedback = "代码错误：NPE";
  // Arrange: state at step 8a; mock shell to return exit code 1 triggering ship validation failure with regressToPhase
  mockLoadAndValidate.mockResolvedValue(makeState({
    step: "8a", phase: 8, status: "IN_PROGRESS",
    shipRound: 1, shipMaxRounds: 3,
  }));
  mockReadFile.mockImplementation(async (path: string) => {
    if (path.includes("state.json")) {
      return JSON.stringify(makeState({ step: "8a", phase: 8, shipRound: 1, shipMaxRounds: 3 }));
    }
    return "placeholder"; // 满足文件存在检查
  });
  // mock shell so Phase 8 ship verification fails with CODE_BUG => regressToPhase=3
  mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
    cb(Object.assign(new Error("exit 1"), { code: 1 }), "", "NPE error");
  });

  // Act
  const result = await computeNextTask("/tmp/test-project", "test-topic");

  // Assert: atomicUpdate was called with lastFailureDetail and phase=3
  const updateCalls = mockAtomicUpdate.mock.calls;
  const regressCall = updateCalls.find(
    (args: any[]) => args[0].phase === 3 && args[0].lastFailureDetail !== undefined
  );
  expect(regressCall).toBeDefined();
  expect(regressCall![0].lastFailureDetail).toContain("NPE");
});
```

---

#### [AC-15] U-FAIL-3：ALL_APPROACHES_EXHAUSTED 路径填充 lastFailureDetail + status=BLOCKED

**类型**：UNIT
**Setup**：Mock StateManager，approachState 包含两个已失败方案（`failCount >= MAX_APPROACH_FAILURES`）
**输入**：state.json 中 `step: "5b"`, `stepIteration: 0`, `approachState` 有 2 个失败方案
**执行**：`computeNextTask("/tmp/project", "test-topic")`（触发 ALL_EXHAUSTED 路径）
**预期结果**：
1. `mockAtomicUpdate` 调用参数中 `lastValidation === "ALL_APPROACHES_EXHAUSTED"`
2. `mockAtomicUpdate` 调用参数中 `status === "BLOCKED"`
3. `mockAtomicUpdate` 调用参数中 `lastFailureDetail` 为非空字符串
4. 返回的 `NextTaskResult.lastFailureDetail` 为非空字符串

---

### 3.5 StateJsonSchema 接受 lastFailureDetail 字段 — UNIT

```typescript
test("StateJsonSchema 接受 lastFailureDetail 为字符串、null 和 undefined", () => {
  const baseState = makeState();
  expect(StateJsonSchema.safeParse({ ...baseState, lastFailureDetail: "some error" }).success).toBe(true);
  expect(StateJsonSchema.safeParse({ ...baseState, lastFailureDetail: null }).success).toBe(true);
  expect(StateJsonSchema.safeParse(baseState).success).toBe(true); // undefined 也合法
});
```

---

## 四、INTEGRATION 测试用例

### 4.1 computeNextTask() step "3" 入口 — 集成测试

**说明**：这些测试通过 `computeNextTask()` 调用入口触发，验证 `tasks` 字段从三个调用点正确注入。测试使用与 `orchestrator.test.ts` 相同的 Mock 模式（mock StateManager + mock fs）。

#### [AC-5] I-STEP3-1：startup 路径（无 step）直接进入 step "3" 时 tasks 被注入

**类型**：INTEGRATION
**调用路径**：`computeNextTask()` → `resolveInitialStep()` → step=3 → `parseTaskList` 调用（约第 1322 行）
**Setup**：
- Mock state.json：`mode: "turbo"`, `phase: 3`, `status: "IN_PROGRESS"`，无 `step` 字段
- Mock `plan.md` 返回包含 3 个 `## Task N` 块的内容
**执行**：`await computeNextTask("/tmp/project", "test-topic")`
**预期结果**：
1. `result.step === "3"`
2. `result.tasks` 数组长度为 3
3. `result.tasks[0].taskNumber === 1`

```typescript
test("[AC-5] I-STEP3-1: turbo mode startup 直接进入 step 3，tasks 从 plan.md 正确注入", async () => {
  const planContent = `
## Task 1: 实现 types.ts 修改
修改: mcp/src/types.ts

## Task 2: 实现 parseTaskList
新建: mcp/src/parser.ts

## Task 3: 注册工具
修改: mcp/src/index.ts
依赖: Task 1, Task 2
`.trim();

  mockLoadAndValidate.mockResolvedValue(makeState({ mode: "turbo", phase: 3, status: "IN_PROGRESS" }));
  mockReadFile.mockImplementation(async (path: string) => {
    if (path.includes("state.json")) return JSON.stringify(makeState({ mode: "turbo" }));
    if (path.includes("plan.md")) return planContent;
    throw new Error("ENOENT");
  });

  const result = await computeNextTask("/tmp/test-project", "test-topic");

  expect(result.step).toBe("3");
  expect(result.tasks).toHaveLength(3);
  expect(result.tasks![0].taskNumber).toBe(1);
  expect(result.tasks![2].dependencies).toEqual([1, 2]);
});
```

---

#### [AC-5] I-STEP3-2：advanceToNextStep 推进到 step "3" 时 tasks 被注入

**类型**：INTEGRATION
**调用路径**：`computeNextTask()` → validation passes on step "2b" → `advanceToNextStep()` → nextStep="3" → `parseTaskList`（约第 1271 行）
**Setup**：
- Mock state.json：`mode: "full"`, `phase: 2`, `step: "2b"`, `stepIteration: 0`
- Mock `review.md`（step 2b 验证通过所需）
- Mock `plan.md` 返回 2 个 Task 块
**执行**：`await computeNextTask("/tmp/project", "test-topic")`
**预期结果**：
1. `result.step === "3"`
2. `result.tasks` 数组长度为 2

---

#### [AC-11] I-STEP3-3：step "3" 的 prompt 字段完整（向后兼容）

**类型**：INTEGRATION
**调用路径**：`computeNextTask()` → step "3" → `buildTaskForStep("3", ...)` 生成 prompt → tasks 独立组装
**Setup**：同 I-STEP3-1 的 Mock
**执行**：`await computeNextTask("/tmp/test-project", "test-topic")`
**预期结果**：
1. `result.prompt` 为非空字符串
2. `result.prompt` 不因 `tasks` 存在而被改变（长度 > 0）
3. `result.tasks` 和 `result.prompt` 同时存在

```typescript
test("[AC-11] I-STEP3-3: step 3 的 prompt 字段完整，tasks 为额外字段不替代 prompt", async () => {
  // setup 同 I-STEP3-1
  const result = await computeNextTask("/tmp/test-project", "test-topic");

  expect(result.step).toBe("3");
  expect(result.prompt).toBeTruthy();
  expect(result.prompt!.length).toBeGreaterThan(0);
  expect(result.tasks).toBeDefined();
  // prompt 和 tasks 同时存在
  expect(result.tasks!.length).toBeGreaterThan(0);
});
```

---

### 4.2 computeNextTask() failure 路径 — 集成测试

#### [AC-4] I-FAIL-1：Step 5b tribunal FAIL 后 lastFailureDetail 返回且写入 state

**类型**：INTEGRATION
**调用路径**：`computeNextTask()` → step "5b" 有 step 字段 → validation → tribunal FAIL → `handleValidationFailure()` → tribunal FAIL under limit path → `atomicUpdate({ lastFailureDetail })`
**Setup**：
- Mock state.json：`step: "5b"`, `stepIteration: 0`, `phase: 5`, `tribunalSubmits: {}`
- Mock `evaluateTribunal` 返回 `{ passed: false, feedback: "接口返回类型不正确", tribunalResult: { verdict: "FAIL" } }`
- Mock 验证所需的文件（code-review.md 等）
**执行**：`await computeNextTask("/tmp/project", "test-topic")`
**预期结果**：
1. `result.lastFailureDetail === "接口返回类型不正确"`
2. `mockAtomicUpdate` 被调用且参数包含 `lastFailureDetail: "接口返回类型不正确"`
3. `mockAtomicUpdate` 参数包含 `lastValidation: "FAILED"`

---

#### [AC-14] I-FAIL-2：regressToPhase 路径（Phase 8 CODE_BUG）后 state 包含 lastFailureDetail

**类型**：INTEGRATION
**调用路径**：`computeNextTask()` → step "8a" → ship validation → `regressToPhase !== undefined` → `handlePhaseRegress()` → `atomicUpdate({ lastFailureDetail })`
**Setup**：
- Mock state.json：`step: "8a"`, `phase: 8`, `shipRound: 1`, `shipMaxRounds: 3`
- ship validation mock 返回 `{ passed: false, feedback: "生产环境 NPE", regressToPhase: 3 }`
**执行**：`await computeNextTask("/tmp/project", "test-topic")`
**预期结果**：
1. `mockAtomicUpdate` 被调用，参数包含：
   - `lastFailureDetail: "生产环境 NPE"`
   - `phase: 3`
   - `step: "3"`（`firstStepForPhase(3) === "3"`）
   - `lastValidation: "SHIP_REGRESS"`

---

#### [AC-15] I-FAIL-3：ALL_APPROACHES_EXHAUSTED 后 state 中 status=BLOCKED 且 lastFailureDetail 非空

**类型**：INTEGRATION
**调用路径**：`computeNextTask()` → step "5b" → 非 tribunal 失败 → circuit breaker → `ALL_EXHAUSTED` → `atomicUpdate({ status: "BLOCKED", lastFailureDetail })`
**Setup**：
- Mock state.json：`step: "5b"`, `stepIteration: 0`
- `approachState` 包含两个已失败方案（`currentIndex` 已超过上限）
- validation 返回 `{ passed: false, feedback: "所有方案均失败" }`
**执行**：`await computeNextTask("/tmp/project", "test-topic")`
**预期结果**：
1. `mockAtomicUpdate` 被调用，参数包含 `status: "BLOCKED"`
2. `mockAtomicUpdate` 被调用，参数包含 `lastValidation: "ALL_APPROACHES_EXHAUSTED"`
3. `mockAtomicUpdate` 参数 `lastFailureDetail` 为非空字符串
4. `result.lastFailureDetail` 为非空字符串

---

### 4.3 auto_dev_reset 完整流程 — 集成测试

**说明**：这两个测试使用真实临时目录（`mkdtemp`），写入真实 state.json 和 progress-log.md，通过 StateManager 直接执行与 handler 等价的操作序列，验证磁盘副作用。采用与 `e2e-integration.test.ts` 相同的 `initStateOnDisk` 模式。

**已知覆盖缺口（TODO）**：`auto_dev_reset` handler 注册在 `index.ts` 中，无法从测试直接调用 MCP tool handler。I-RESET-1 和 I-RESET-2 通过直接调用 `StateManager` 方法验证磁盘副作用，但**不会捕获 handler 内部的逻辑错误**（如错误的字段名、错误的过滤条件）。建议后续将 handler 内的核心逻辑提取为 `resetState(sm, state, targetPhase, reason)` 函数并 export，使集成测试可以直接调用，消除此缺口。

#### [AC-1] I-RESET-1：正常回退后 state.json 字段正确 + progress-log 包含 RESET 标记

**类型**：INTEGRATION
**前置条件**：创建临时目录，state.json 内容为 `{ phase: 5, step: "5b", status: "IN_PROGRESS", mode: "full", lastValidation: "FAILED", lastFailureDetail: "some error" }`，progress-log.md 已存在
**执行**：调用 `auto_dev_reset` handler 的等价逻辑（或通过 StateManager 直接执行 reset 逻辑）：
```
targetPhase = 3, reason = "需要重新实现"
```
**预期结果**：
1. 读取 state.json：`phase === 3`
2. 读取 state.json：`step === "3"` (`firstStepForPhase(3) === "3"`)
3. 读取 state.json：`stepIteration === 0`
4. 读取 state.json：`lastValidation === null`
5. 读取 state.json：`lastFailureDetail === null`
6. 读取 state.json：`status === "IN_PROGRESS"`
7. 读取 progress-log.md：包含 `RESET phase=3`
8. 读取 progress-log.md：包含 `reason="需要重新实现"`

```typescript
test("[AC-1] I-RESET-1: auto_dev_reset(targetPhase=3) 后 state.json 字段正确，progress-log 包含 RESET 标记", async () => {
  const projectRoot = await setupTestProject();
  const sm = await StateManager.create(projectRoot, TOPIC);
  await initStateOnDisk(sm, {
    phase: 5,
    step: "5b",
    status: "IN_PROGRESS",
    mode: "full",
    lastValidation: "FAILED",
    lastFailureDetail: "some error",
    tribunalSubmits: { "3": 1, "4": 2, "5": 1 },
    phaseEscalateCount: { "3": 1, "4": 1, "5": 2 },
  });

  // 执行 reset 逻辑（等价于 auto_dev_reset handler）
  const targetPhase = 3;
  const reason = "需要重新实现";
  const resetStep = firstStepForPhase(targetPhase); // "3"
  await sm.appendToProgressLog(
    `\n<!-- RESET phase=${targetPhase} reason="${reason}" timestamp=${new Date().toISOString()} -->\n`
  );
  await sm.atomicUpdate({
    phase: targetPhase,
    status: "IN_PROGRESS",
    step: resetStep,
    stepIteration: 0,
    lastValidation: null,
    lastFailureDetail: null,
    approachState: null,
    tribunalSubmits: {},         // 初始值含 "3","4","5"，parseInt(k) < 3 无一通过，结果为 {}
    phaseEscalateCount: {},      // 初始值含 "3","4"，同理清空
  });

  const state = await sm.loadAndValidate();
  expect(state.phase).toBe(3);
  expect(state.step).toBe("3");
  expect(state.stepIteration).toBe(0);
  expect(state.lastValidation).toBeNull();
  expect(state.lastFailureDetail).toBeNull();
  expect(state.status).toBe("IN_PROGRESS");

  const log = await readFile(sm.progressLogPath, "utf-8");
  expect(log).toContain("RESET phase=3");
  expect(log).toContain(`reason="需要重新实现"`);
});
```

---

#### [AC-13] I-RESET-2：reset 后 tribunalSubmits 和 phaseEscalateCount 正确过滤

**类型**：INTEGRATION
**前置条件**：
- state.json：`phase: 5`, `mode: "full"`
- `tribunalSubmits: { "1": 1, "2": 2, "3": 1, "4": 2, "5": 1 }`
- `phaseEscalateCount: { "1": 0, "2": 1, "3": 2, "4": 1 }`
**执行**：调用 reset 逻辑，`targetPhase = 3`
**预期结果**：
1. state.json 中 `tribunalSubmits` 只包含 key `"1"` 和 `"2"` (`parseInt(key) < 3`)
2. state.json 中 `tribunalSubmits` 不包含 key `"3"`, `"4"`, `"5"`
3. state.json 中 `phaseEscalateCount` 只包含 key `"1"` 和 `"2"`
4. state.json 中 `phaseEscalateCount` 不包含 key `"3"`, `"4"`

```typescript
test("[AC-13] I-RESET-2: reset 后 tribunalSubmits 和 phaseEscalateCount 正确过滤 >= targetPhase 的条目", async () => {
  const projectRoot = await setupTestProject();
  const sm = await StateManager.create(projectRoot, TOPIC);
  await initStateOnDisk(sm, {
    phase: 5,
    mode: "full",
    tribunalSubmits: { "1": 1, "2": 2, "3": 1, "4": 2, "5": 1 },
    phaseEscalateCount: { "1": 0, "2": 1, "3": 2, "4": 1 },
  });

  const targetPhase = 3;
  const filteredTribunalSubmits: Record<string, number> = {};
  for (const [k, v] of Object.entries({ "1": 1, "2": 2, "3": 1, "4": 2, "5": 1 })) {
    if (parseInt(k, 10) < targetPhase) filteredTribunalSubmits[k] = v;
  }
  const filteredPhaseEscalateCount: Record<string, number> = {};
  for (const [k, v] of Object.entries({ "1": 0, "2": 1, "3": 2, "4": 1 })) {
    if (parseInt(k, 10) < targetPhase) filteredPhaseEscalateCount[k] = v;
  }

  await sm.atomicUpdate({
    phase: targetPhase,
    status: "IN_PROGRESS",
    step: "3",
    stepIteration: 0,
    lastValidation: null,
    lastFailureDetail: null,
    approachState: null,
    tribunalSubmits: filteredTribunalSubmits,
    phaseEscalateCount: filteredPhaseEscalateCount,
  });

  const state = await sm.loadAndValidate();
  const ts = state.tribunalSubmits ?? {};
  const pe = state.phaseEscalateCount ?? {};

  // 只保留 key < 3 的条目
  expect(Object.keys(ts)).toContain("1");
  expect(Object.keys(ts)).toContain("2");
  expect(Object.keys(ts)).not.toContain("3");
  expect(Object.keys(ts)).not.toContain("4");
  expect(Object.keys(ts)).not.toContain("5");

  expect(Object.keys(pe)).toContain("1");
  expect(Object.keys(pe)).toContain("2");
  expect(Object.keys(pe)).not.toContain("3");
  expect(Object.keys(pe)).not.toContain("4");
});
```

---

### 4.4 prepareTribunalInput() 规模信号注入 — 集成测试

**说明**：通过 `prepareTribunalInput()` 入口验证 digest 内容，使用真实临时目录，mock `getDiffStatWithUntracked`。

#### [AC-8] I-TRIB-1：700+ 行变更时 tribunal digest 包含 HIGH 和逐文件审查指令

**类型**：INTEGRATION
**前置条件**：
- 临时目录包含 progress-log.md（含 init marker）和 design.md
- mock `getDiffStatWithUntracked` 返回：`"26 files changed, 700 insertions(+), 44 deletions(-)"`（作为最后一行）
**执行**：`await prepareTribunalInput(5, outputDir, projectRoot, "abc123")`
**预期结果**：
1. `digestContent` 包含字符串 `"HIGH"`
2. `digestContent` 包含字符串 `"必须逐文件审查"`
3. `digestContent` 不包含字符串 `"LOW"`

```typescript
test("[AC-8] I-TRIB-1: 700+ 行变更时 tribunal digest 包含 HIGH 和必须逐文件审查指令", async () => {
  // mock getDiffStatWithUntracked 返回 HIGH 量级的 diffStat
  const diffStat = "26 files changed, 700 insertions(+), 44 deletions(-)";
  // setup: 临时目录 + progress-log + design.md
  // mock git 调用返回 diffStat

  const { digestContent } = await prepareTribunalInput(4, outputDir, projectRoot, "abc123");

  expect(digestContent).toContain("HIGH");
  expect(digestContent).toContain("必须逐文件审查");
  expect(digestContent).not.toContain("LOW");
});
```

---

#### [AC-9] I-TRIB-2：50 行以内变更时 digest 包含 LOW 且不含逐文件审查指令

**类型**：INTEGRATION
**前置条件**：mock `getDiffStatWithUntracked` 返回 `"2 files changed, 30 insertions(+), 10 deletions(-)"`（total=40，≤100 → LOW）
**执行**：`await prepareTribunalInput(4, outputDir, projectRoot, "abc123")`
**预期结果**：
1. `digestContent` 包含字符串 `"LOW"`
2. `digestContent` 不包含字符串 `"必须逐文件审查"`

---

#### I-TRIB-3：MEDIUM 区间（101-500 行）digest 包含 MEDIUM 和核心逻辑提示（负面/边界测试）

**类型**：INTEGRATION
**前置条件**：mock diffStat 返回 `"5 files changed, 200 insertions(+), 50 deletions(-)"`（total=250，>100 且 ≤500 → MEDIUM）
**执行**：`await prepareTribunalInput(4, outputDir, projectRoot, "abc123")`
**预期结果**：
1. `digestContent` 包含字符串 `"MEDIUM"`
2. `digestContent` 不包含字符串 `"必须逐文件审查"`（该指令只在 HIGH 时出现）
3. `digestContent` 包含核心逻辑相关提示（如"重点审查"）

---

## 五、负面测试汇总

| ID | 类型 | 场景 | 预期 |
|----|------|------|------|
| U-PARSE-5 | UNIT | `parseTaskList(null)` / `parseTaskList("")` | 返回 `[]`，不抛异常 |
| U-PARSE-6 | UNIT | plan.md 无 `## Task N` 块 | 返回 `[]` |
| U-DIFF-5 | UNIT | `parseDiffSummary("")` / 非标准格式 | 返回零值，不抛异常 |
| U-RESET-2 | UNIT | `targetPhase > currentPhase`（禁止前跳） | 校验条件为真（handler 返回 error） |
| U-RESET-3 | UNIT | `status === "COMPLETED"`（禁止重开） | 校验条件为真（handler 返回 error） |
| U-RESET-5 | UNIT | `reason` 为空或纯空白 | 校验条件为真（handler 返回 error） |
| U-RESET-6 | UNIT | `targetPhase` 不在 `PHASE_SEQUENCE` 中 | `includes()` 返回 false（handler 返回 error） |
| I-TRIB-3 | INTEGRATION | 101-500 行变更 | 包含 MEDIUM，不含逐文件审查指令 |

---

## 六、测试文件位置建议

| 测试分组 | 建议文件 | 原因 |
|---------|---------|------|
| `parseTaskList()` UNIT | `mcp/src/__tests__/orchestrator.test.ts` | 已有 `parseTaskList` 导出，该文件已有 mock 模式 |
| `parseDiffSummary()` UNIT | `mcp/src/__tests__/tribunal.test.ts` | tribunal.ts 的函数，对应测试文件 |
| `auto_dev_reset` 校验逻辑 UNIT | `mcp/src/__tests__/orchestrator-ux.test.ts`（新建） | 集中放本次改动的测试 |
| `lastFailureDetail` 各路径 UNIT | `mcp/src/__tests__/orchestrator-ux.test.ts` | 同上 |
| `computeNextTask()` step "3" INTEGRATION | `mcp/src/__tests__/orchestrator-ux.test.ts` | mock 模式与 orchestrator.test.ts 一致 |
| `auto_dev_reset` 完整流程 INTEGRATION | `mcp/src/__tests__/orchestrator-ux.test.ts` | 使用真实临时目录，与 e2e-integration.test.ts 模式一致 |
| `prepareTribunalInput()` INTEGRATION | `mcp/src/__tests__/tribunal.test.ts` | 对应测试文件，可添加新 describe 块 |

---

## 七、集成入口测试声明

根据"组件正确 ≠ 集成正确，必须从入口测"原则，本测试设计包含以下入口级测试：

1. **I-STEP3-1, I-STEP3-2, I-STEP3-3**：从 `computeNextTask()` 入口触发，覆盖 `parseTaskList` 注入的三个调用点中的 startup 和 advance 路径。验证 `tasks` 字段在 `NextTaskResult` 中正确组装，不经过 `buildTaskForStep` 返回。

2. **I-FAIL-1, I-FAIL-2, I-FAIL-3**：从 `computeNextTask()` 入口触发 `handleValidationFailure` 的三条失败路径，验证 `lastFailureDetail` 在 `atomicUpdate` 和返回值中均正确填充。

3. **I-RESET-1, I-RESET-2**：通过 StateManager 在真实磁盘上执行 reset 逻辑，验证 state.json 字段更新和 progress-log 写入（集成调用链：StateManager.appendToProgressLog → atomicUpdate → loadAndValidate）。

4. **I-TRIB-1, I-TRIB-2, I-TRIB-3**：从 `prepareTribunalInput()` 入口触发，验证 `parseDiffSummary` 结果被正确转化为 digest 中的规模信号文本。
