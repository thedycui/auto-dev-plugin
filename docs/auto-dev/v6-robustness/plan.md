# auto-dev v6.0 健壮性增强 -- 实施计划

## 概述

本计划将 design.md 中 4 个改动项 + 测试分解为 10 个可顺序执行的 Task。每个 Task 有明确的输入/输出文件、具体修改描述、复杂度评估和依赖关系。

**基准路径**：`/Users/admin/.claude/plugins/auto-dev-plugin/mcp/src/`

---

## 依赖拓扑

```
Task 1 (types.ts)
  |
  +---> Task 2 (phase-enforcer: iteration limit)
  |       |
  +---> Task 3 (phase-enforcer: REGRESS)
  |       |
  +---> Task 4 (state-manager: rebuild + helpers)
  |       |
  |       +---> Task 5 (index.ts: checkpoint 集成 -- iteration limit + REGRESS)
  |       |
  |       +---> Task 6 (index.ts: init resume 集成 -- rebuild)
  |       |
  |       +---> Task 7 (index.ts: preflight 增强 -- extraContext)
  |
  +---> Task 8  (test: iteration-limit.test.ts)
  +---> Task 9  (test: regress.test.ts)
  +---> Task 10 (test: state-rebuild.test.ts + preflight-context.test.ts)
```

执行顺序：Task 1 -> 2 -> 3 -> 4 -> 5 -> 6 -> 7 -> 8 -> 9 -> 10

---

## Task 1: types.ts Schema 变更

| 属性 | 值 |
|---|---|
| 复杂度 | S |
| 输入文件 | `types.ts` |
| 输出文件 | `types.ts` |
| 依赖 | 无 |
| 对应 AC | AC-4 |

### 具体修改

1. **PhaseStatusSchema 新增 `REGRESS`**（L16-22）：在 `z.enum([...])` 数组末尾添加 `"REGRESS"`，变为：
   ```ts
   export const PhaseStatusSchema = z.enum([
     "IN_PROGRESS", "PASS", "NEEDS_REVISION", "BLOCKED", "COMPLETED", "REGRESS",
   ]);
   ```

2. **CheckpointInputSchema 新增 `regressTo` 字段**（L169-175）：在 `tokenEstimate` 之后添加：
   ```ts
   regressTo: z.number().int().min(1).max(5).optional(),
   ```

3. **StateJsonSchema 新增 `regressionCount` 字段**（L69-114）：在 `startCommit` 之后添加：
   ```ts
   regressionCount: z.number().int().optional(),
   ```

---

## Task 2: phase-enforcer.ts -- 迭代限制函数

| 属性 | 值 |
|---|---|
| 复杂度 | S |
| 输入文件 | `phase-enforcer.ts` |
| 输出文件 | `phase-enforcer.ts` |
| 依赖 | Task 1（需要 StateJson 类型更新） |
| 对应 AC | AC-1 |

### 具体修改

1. **新增 `MAX_ITERATIONS_PER_PHASE` 常量**：在 `REQUIRED_PHASES_QUICK` 常量之后（L24 后），添加：
   ```ts
   const MAX_ITERATIONS_PER_PHASE: Record<number, number> = {
     1: 3, 2: 3, 3: 2, 4: 3, 5: 3,
   };
   ```

2. **新增 `IterationCheckResult` 接口**：在 `MAX_ITERATIONS_PER_PHASE` 之后导出：
   ```ts
   export interface IterationCheckResult {
     allowed: boolean;
     exceeded: boolean;
     currentIteration: number;
     maxIteration: number;
     action: "CONTINUE" | "FORCE_PASS" | "BLOCK";
     message: string;
   }
   ```

3. **新增 `checkIterationLimit` 函数**：在 `IterationCheckResult` 之后导出。逻辑：
   - 从 `MAX_ITERATIONS_PER_PHASE` 取 `maxIteration`，若 phase 不在 map 中则无限制（`return { allowed: true, action: "CONTINUE", ... }`）
   - `currentIteration < maxIteration` -> `action: "CONTINUE"`
   - `currentIteration >= maxIteration && isInteractive` -> `action: "BLOCK"`，message 提示用户介入
   - `currentIteration >= maxIteration && !isInteractive` -> `action: "FORCE_PASS"`，message 记录 warning

---

## Task 3: phase-enforcer.ts -- REGRESS 逻辑

| 属性 | 值 |
|---|---|
| 复杂度 | M |
| 输入文件 | `phase-enforcer.ts` |
| 输出文件 | `phase-enforcer.ts` |
| 依赖 | Task 1（需要 `REGRESS` status 和 `regressionCount` 字段） |
| 对应 AC | AC-4 |

### 具体修改

1. **修改 `computeNextDirective` 函数签名**（L42-46）：新增第 4 个参数 `regressTo?: number`：
   ```ts
   export function computeNextDirective(
     currentPhase: number,
     status: string,
     state: StateJson,
     regressTo?: number,
   ): NextDirective {
   ```

2. **在守卫逻辑之前插入 REGRESS 分支**（L52 之前，即 `if (status !== "PASS" ...)` 之前）：
   - 检查 `status === "REGRESS"`
   - 验证 `regressTo` 存在且 `< currentPhase`，否则返回 ERROR directive
   - 检查 `state.regressionCount ?? 0 >= 2`，是则返回 BLOCKED directive
   - 正常情况返回 `{ phaseCompleted: false, nextPhase: regressTo, nextPhaseName: PHASE_META[regressTo].name, mandate: "[REGRESS] ..." }`
   - 具体实现参照 design.md 中的代码块

3. **导出 `PHASE_META`**：当前 `PHASE_META` 是模块级 `const`（L11），不需要改为 export（REGRESS 分支在同模块内可直接访问）。保持不变。

---

## Task 4: state-manager.ts -- rebuild 方法和辅助函数

| 属性 | 值 |
|---|---|
| 复杂度 | M |
| 输入文件 | `state-manager.ts` |
| 输出文件 | `state-manager.ts` |
| 依赖 | Task 1（StateJson 新增 regressionCount 字段） |
| 对应 AC | AC-2, AC-3 |

### 具体修改

1. **新增模块级辅助函数 `parseHeaderField`**（在 `fileExists` 函数之后，L56 后）：
   - 接受 `(content: string, field: string): string | null`
   - 用正则 `/>\\s*${field}:\\s*(.+?)\\s*$/m` 匹配 progress-log header 中的字段
   - 返回 trim 后的值或 null

2. **新增模块级辅助函数 `parseAllCheckpoints`**（紧接 `parseHeaderField` 之后）：
   - 接受 `(content: string): Array<{ phase: number; status: string }>`
   - 用正则 `/<!-- CHECKPOINT phase=(\d+).*?status=(\S+)/g` 提取所有 CHECKPOINT
   - 返回 `{ phase, status }` 数组

3. **新增导出函数 `extractDocSummary`**（在 `parseAllCheckpoints` 之后）：
   - 接受 `(content: string, maxLines: number): string`
   - 优先查找 `## 概述` 或 `## Summary` 段落（到下一个 `## ` 或文件末尾）
   - 如果找不到概述段落，取前 `maxLines` 行
   - 返回摘要文本

4. **新增导出函数 `extractTaskList`**（紧接 `extractDocSummary` 之后）：
   - 接受 `(content: string): string`
   - 用正则提取 `### Task \d+` 或 `- [ ] Task \d+` 或 `## Task \d+` 格式的行
   - 返回精简的任务编号+标题列表文本

5. **在 `StateManager` 类中新增 `rebuildStateFromProgressLog` 方法**（在 `loadAndValidate` 方法之后，L171 后）：
   - 签名：`async rebuildStateFromProgressLog(): Promise<StateJson>`
   - 读取 `this.progressLogPath` 内容
   - 调用 `parseHeaderField` 提取 `startedAt` 和 `mode`
   - 调用 `parseAllCheckpoints` 获取最后一条 checkpoint 的 phase 和 status
   - 调用 `this.detectStack()` 重新检测技术栈
   - 组装 `StateJson` 对象（所有必需字段）
   - 调用 `this.atomicWrite` 写入 state.json
   - 返回重建的 state

---

## Task 5: index.ts -- checkpoint 工具集成（迭代限制 + REGRESS）

| 属性 | 值 |
|---|---|
| 复杂度 | M |
| 输入文件 | `index.ts` |
| 输出文件 | `index.ts` |
| 依赖 | Task 2（checkIterationLimit）, Task 3（computeNextDirective 新签名 + REGRESS） |
| 对应 AC | AC-1, AC-4 |

### 具体修改

1. **更新 import**（L19）：从 `phase-enforcer.js` 新增导入 `checkIterationLimit`。

2. **修改 checkpoint 工具的内联 schema**（L222-225）：
   - `status` 的 `z.enum` 数组末尾添加 `"REGRESS"`
   - 新增参数 `regressTo: z.number().int().min(1).max(5).optional()`

3. **修改 checkpoint handler 的解构参数**（L226）：添加 `regressTo`。

4. **在 idempotency check 之后、progress-log append 之前（L232 后）插入迭代限制检查**：
   - 当 `status === "NEEDS_REVISION"` 时：
     - 自动递增 iteration：`const newIteration = (state.iteration ?? 0) + 1;`
     - 调用 `checkIterationLimit(phase, newIteration, state.interactive ?? false)`
     - **[P1-1 修复] 三种情况的完整行为说明**：
       - `action === "CONTINUE"`：`stateUpdates["iteration"] = newIteration;`（递增并写入），继续正常流程
       - `action === "FORCE_PASS"`：覆写 `status` 变量为 `"PASS"`，在 summary 前追加 `[FORCED_PASS: iteration limit exceeded]`。**progress-log 中 CHECKPOINT status 记录为 `PASS`（非 NEEDS_REVISION）**，summary 中的 `[FORCED_PASS]` 标记作为审计追踪。`stateUpdates["iteration"] = 0;`（Phase 完成，重置迭代计数）。同时调用 `lessons_add` 记录遗留问题。
       - `action === "BLOCK"`：直接返回 BLOCKED 结果和 mandate，**不写入 stateUpdates**（不更新 state.json）

5. **在 stateUpdates 构建处（L240-241 后）插入 REGRESS 处理**：
   - 当 `status === "REGRESS"` 时：
     - 校验 `regressTo` 存在，否则返回错误
     - `stateUpdates["regressionCount"] = (state.regressionCount ?? 0) + 1`
     - `stateUpdates["iteration"] = 0`（回退后重置迭代计数）

6. **修改 `computeNextDirective` 调用**（L345）：传入第 4 个参数 `regressTo`：
   ```ts
   const nextDirective = computeNextDirective(phase, status, state, regressTo);
   ```

---

## Task 6: index.ts -- init resume 分支集成（state rebuild）

| 属性 | 值 |
|---|---|
| 复杂度 | M |
| 输入文件 | `index.ts` |
| 输出文件 | `index.ts` |
| 依赖 | Task 4（rebuildStateFromProgressLog 方法） |
| 对应 AC | AC-2 |

### 具体修改

1. **重写 `auto_dev_init` 工具中 `onConflict === "resume"` 分支**（L100-131）：
   - 将 L101 的 `const state = await sm.loadAndValidate();` 替换为 try-catch 结构：
     ```ts
     let state: StateJson;
     try {
       state = await sm.loadAndValidate();
     } catch (err) {
       const errMsg = (err as Error).message;
       if (errMsg.includes("dirty")) {
         // 尝试清除 dirty flag 后 re-validate
         try {
           const raw = JSON.parse(await readFile(sm.stateFilePath, "utf-8"));
           raw.dirty = false;
           raw.updatedAt = new Date().toISOString();
           await sm.atomicWrite(sm.stateFilePath, JSON.stringify(raw, null, 2));
           state = await sm.loadAndValidate();
         } catch {
           state = await sm.rebuildStateFromProgressLog();
         }
       } else {
         state = await sm.rebuildStateFromProgressLog();
       }
     }
     ```
   - 其余 resume 逻辑（解析 resumeTask 等）保持不变，但使用新的 `state` 变量

---

## Task 7: index.ts -- preflight 增强（前序产出物注入）

| 属性 | 值 |
|---|---|
| 复杂度 | S |
| 输入文件 | `index.ts` |
| 输出文件 | `index.ts` |
| 依赖 | Task 4（extractDocSummary, extractTaskList 函数） |
| 对应 AC | AC-3 |

### 具体修改

1. **更新 import**（文件顶部）：从 `state-manager.js` 新增导入 `extractDocSummary` 和 `extractTaskList`。

2. **[P1-3 修复] 修改 preflight 工具的 `if (mapping)` 块**（L434-444）：**保留现有块的整体结构**（包括 `suggestedAgent` 赋值），仅修改 L440 的 `renderer.render` 调用。具体步骤：
   - 在 L440 `const rendered = await renderer.render(...)` 之前，构建 `extraContext` 变量：
     - 当 `phase >= 3` 时，尝试读取 `join(outputDir, "design.md")`，调用 `extractDocSummary(content, 80)` 拼接到 `extraContext`
     - 当 `phase === 3` 时，额外尝试读取 `join(outputDir, "plan.md")`，调用 `extractTaskList(content)` 拼接到 `extraContext`
   - 修改 L440 为 `const rendered = await renderer.render(mapping.promptFile, variables, extraContext || undefined);`
   - **不替换整个 `if (mapping)` 块**，保留 `result.suggestedAgent = mapping.agent;`（L441）等现有逻辑

---

## Task 8: 测试文件 -- iteration-limit.test.ts

| 属性 | 值 |
|---|---|
| 复杂度 | S |
| 输入文件 | `phase-enforcer.ts`（import 被测函数） |
| 输出文件 | `__tests__/iteration-limit.test.ts`（新建） |
| 依赖 | Task 2（checkIterationLimit 函数） |
| 对应 AC | AC-5 |

### 测试用例

1. `checkIterationLimit(1, 1, false)` -> `action: "CONTINUE"`, `allowed: true`
2. `checkIterationLimit(1, 3, true)` -> `action: "BLOCK"`, `exceeded: true`
3. `checkIterationLimit(1, 3, false)` -> `action: "FORCE_PASS"`, `exceeded: true`
4. `checkIterationLimit(4, 2, false)` -> `action: "CONTINUE"`（Phase 4 上限为 3）
5. `checkIterationLimit(4, 3, false)` -> `action: "FORCE_PASS"`
6. `checkIterationLimit(6, 10, false)` -> `action: "CONTINUE"`（Phase 6 无上限）
7. 不同 phase 的 maxIteration 值验证

---

## Task 9: 测试文件 -- regress.test.ts

| 属性 | 值 |
|---|---|
| 复杂度 | S |
| 输入文件 | `phase-enforcer.ts`（import computeNextDirective） |
| 输出文件 | `__tests__/regress.test.ts`（新建） |
| 依赖 | Task 3（REGRESS 逻辑） |
| 对应 AC | AC-5 |

### 测试用例

使用 `improvements.test.ts` 中的 `makeState` 辅助函数模式。

1. `computeNextDirective(4, "REGRESS", state, 1)` -> `nextPhase: 1`, mandate 包含 `[REGRESS]`
2. `computeNextDirective(4, "REGRESS", state, 4)` -> mandate 包含 `[ERROR]`（regressTo >= currentPhase）
3. `computeNextDirective(4, "REGRESS", state, 5)` -> mandate 包含 `[ERROR]`（regressTo > currentPhase）
4. `computeNextDirective(4, "REGRESS", makeState({ regressionCount: 2 }), 1)` -> mandate 包含 `[BLOCKED]`
5. `computeNextDirective(4, "REGRESS", state)` -> mandate 包含 `[ERROR]`（无 regressTo）
6. REGRESS 返回 `phaseCompleted: false`
7. REGRESS 返回 `canDeclareComplete: false`
8. `regressionCount: 1` 时仍允许回退

---

## Task 10: 测试文件 -- state-rebuild.test.ts + preflight-context.test.ts

| 属性 | 值 |
|---|---|
| 复杂度 | M |
| 输入文件 | `state-manager.ts`（import 辅助函数） |
| 输出文件 | `__tests__/state-rebuild.test.ts`（新建）, `__tests__/preflight-context.test.ts`（新建） |
| 依赖 | Task 4（rebuildStateFromProgressLog, extractDocSummary, extractTaskList） |
| 对应 AC | AC-5 |

### state-rebuild.test.ts 测试用例

注意：`rebuildStateFromProgressLog` 是 `StateManager` 实例方法，需要 mock 文件系统（`readFile`、`detectStack`）或使用临时目录。推荐使用 vitest 的 `vi.mock` 模拟 `node:fs/promises`。

1. 正常 progress-log（header + 多条 CHECKPOINT） -> 正确解析最后 phase/status/mode
2. progress-log 无 CHECKPOINT -> 返回 phase=1, status="IN_PROGRESS"
3. progress-log 不存在 -> 抛出错误（readFile 失败）
4. progress-log header 有额外空格 -> 正确容错解析 mode 和 startedAt
5. 多条 CHECKPOINT（PASS + NEEDS_REVISION 混合） -> 取最后一条

### preflight-context.test.ts 测试用例

测试 `extractDocSummary` 和 `extractTaskList` 纯函数：

1. `extractDocSummary` 含 `## 概述` 段落 -> 返回概述段落内容
2. `extractDocSummary` 含 `## Summary` 段落 -> 返回 Summary 段落内容
3. `extractDocSummary` 无概述段落 -> 返回前 maxLines 行
4. `extractDocSummary` 空内容 -> 返回空字符串
5. `extractTaskList` 含 `### Task N:` 行 -> 正确提取编号和标题
6. `extractTaskList` 含 `- [ ] Task N:` 行 -> 正确提取
7. `extractTaskList` 无匹配行 -> 返回空字符串

---

## 执行检查清单

| 顺序 | Task | 文件 | 复杂度 | 依赖 | AC |
|------|------|------|--------|------|-----|
| 1 | Task 1: Schema 变更 | types.ts | S | -- | AC-4 |
| 2 | Task 2: 迭代限制函数 | phase-enforcer.ts | S | T1 | AC-1 |
| 3 | Task 3: REGRESS 逻辑 | phase-enforcer.ts | M | T1 | AC-4 |
| 4 | Task 4: rebuild + 辅助函数 | state-manager.ts | M | T1 | AC-2, AC-3 |
| 5 | Task 5: checkpoint 集成 | index.ts | M | T2, T3 | AC-1, AC-4 |
| 6 | Task 6: resume 集成 | index.ts | M | T4 | AC-2 |
| 7 | Task 7: preflight 增强 | index.ts | S | T4 | AC-3 |
| 8 | Task 8: iteration-limit 测试 | __tests__/iteration-limit.test.ts | S | T2 | AC-5 |
| 9 | Task 9: regress 测试 | __tests__/regress.test.ts | S | T3 | AC-5 |
| 10 | Task 10: rebuild + preflight 测试 | __tests__/state-rebuild.test.ts, __tests__/preflight-context.test.ts | M | T4 | AC-5 |

**每个 Task 完成后**：运行 `npm test` 确保 AC-6（现有测试不被破坏）。

**[P1-5 修复] 集成测试说明**：Task 8/9/10 覆盖纯函数逻辑。checkpoint handler 中的集成行为（FORCE_PASS status 覆写传播、REGRESS regressionCount/iteration 写入）通过 Task 5 完成后的手动验证覆盖：
1. 在临时项目上运行 `/auto-dev`，手动触发 NEEDS_REVISION 超限场景，验证 progress-log 中记录的 CHECKPOINT status 为 PASS + summary 含 `[FORCED_PASS]`
2. 手动构造 REGRESS 场景，验证 state.json 中 regressionCount 递增且 iteration 重置
如果后续需要自动化集成测试，需要 mock 完整 MCP server，成本较高，当前阶段手动验证已足够。

---

## 回滚方案

- 所有改动在 4 个源文件 + 4 个新测试文件中，git 层面可以精准回滚
- Task 1 (types.ts) 的 Schema 变更都是 `.optional()` 新增，不影响已有数据
- 如果 Task 5-7（index.ts 集成）出现问题，可以单独回滚 index.ts 而保留 types/phase-enforcer/state-manager 的改动
- 新测试文件独立存在，删除即可回滚

## 迁移路径

- 无数据库迁移
- 已有 state.json 不含 `regressionCount` 字段，通过 `.optional()` 自动兼容
- 已有 progress-log 格式不变，新增的 `[FORCED_PASS]` 标记不影响现有解析逻辑
