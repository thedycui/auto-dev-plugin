# 验收报告

> Topic：20260402-0902-orchestrator-ux-improvements
> 日期：2026-04-02
> 验证人：验收专家（Layer 3 + FAIL 分析）
> 框架结果：framework-ac-results.json 不存在，依据 e2e-test-results.md（全量 697 测试 PASS，exit code 0）和代码审查执行三层验证

---

## 验证结果汇总

| AC | 层级 | 描述摘要 | 验证方式 | 结果 | 证据 |
|----|------|---------|---------|------|------|
| AC-1 | test-bound | auto_dev_reset 重置 phase/step/stepIteration/lastValidation + progress-log 标记 | 测试文件 orchestrator-ux-improvements.test.ts | PASS | U-RESET-A: firstStepForPhase(3)="3"；U-RESET-A 通过 filterStateForReset 逻辑验证；e2e-test-results.md 25/25 PASS |
| AC-2 | test-bound | targetPhase > currentPhase 返回错误，state 不变 | 测试文件 orchestrator-ux-improvements.test.ts | PASS | U-RESET-2: validateResetRequest 返回含 "Forward jumps are forbidden" 的错误字符串；25/25 PASS |
| AC-3 | test-bound | status=COMPLETED 时返回错误 | 测试文件 orchestrator-ux-improvements.test.ts | PASS | U-RESET-3: validateResetRequest(COMPLETED...) 返回含 "COMPLETED" 的错误；25/25 PASS |
| AC-4 | test-bound | Step 5b FAIL 后 auto_dev_next 返回 lastFailureDetail 非空且与 validation.feedback 一致 | tribunal.test.ts + orchestrator.test.ts | PASS | orchestrator.ts 第 1509/1520 行：tribunal FAIL under limit 路径写入 state.json `lastFailureDetail: validation.feedback` 并在 return 中携带；697/697 测试 PASS |
| AC-5 | test-bound | Step 3 tasks 数组长度等于 plan.md ## Task N 块数量 | orchestrator-ux-improvements.test.ts | PASS | U-PARSE-1 验证 2 个 Task 块返回长度 2；computeNextTask step "3" 分支（orchestrator.ts 720-724 行）调用 parseTaskList(planContent)；25/25 PASS |
| AC-6 | test-bound | tasks[n].files 包含新建/修改路径 | orchestrator-ux-improvements.test.ts | PASS | U-PARSE-3 验证 3 个文件路径（新建 2 + 修改 1）均在 files 数组；25/25 PASS |
| AC-7 | test-bound | tasks[n].dependencies 正确提取依赖编号 | orchestrator-ux-improvements.test.ts | PASS | U-PARSE-4 验证 "依赖: Task 1, Task 2" 提取为 [1, 2]；25/25 PASS |
| AC-8 | test-bound | 700+ 行变更时 tribunal digest 含 HIGH 和必须逐文件审查 | tribunal.test.ts | PASS | tribunal.test.ts 第 1685-1706 行 [AC-8] prepareTribunalInput 集成测试：mock diffStat 700+100=800 行，assert digestContent 含 "HIGH" 和 "必须逐文件审查"；697/697 PASS |
| AC-9 | test-bound | 50 行以内变更时 digest 含 LOW 且不含必须逐文件审查 | tribunal.test.ts | PASS | tribunal.test.ts 第 1709-1726 行 [AC-9] prepareTribunalInput 集成测试：mock diffStat 30+20=50 行，assert 含 "LOW" 且不含 "必须逐文件审查"；697/697 PASS |
| AC-10 | manual | Step 5b FAIL 后 auto_dev_state_get 返回的 state 中 lastFailureDetail 为非空字符串 | 代码审查 | PASS | 见下方 AC-10 详细分析 |
| AC-11 | test-bound | Step 3 prompt 字段仍返回完整任务描述（向后兼容） | orchestrator-ux-improvements.test.ts | PASS | U-PARSE-6：无 Task 块时 parseTaskList 返回空数组，orchestrator 退化为单 agent；prompt 由 buildTaskForStep("3",...) 独立返回，与 tasks 无耦合（orchestrator.ts 720-724 行）；25/25 PASS |
| AC-12 | structural | buildTaskForStep 签名保持 Promise<string>，tasks 在上层组装 | 代码审查 | PASS | 见下方 AC-12 详细分析 |
| AC-13 | test-bound | reset 后 tribunalSubmits/phaseEscalateCount 过滤 >= targetPhase 条目 | orchestrator-ux-improvements.test.ts | PASS | U-RESET-A 和 U-RESET-B 验证过滤逻辑；index.ts 2098-2104 行实现与测试逻辑一致；25/25 PASS |
| AC-14 | test-bound | regressToPhase 路径触发后 state.json 中 lastFailureDetail 非空 | orchestrator.ts + 测试 | PASS | orchestrator.ts 1381-1390 行 handlePhaseRegress 内 atomicUpdate 写入 `lastFailureDetail: validation.feedback`；697/697 PASS |
| AC-15 | test-bound | ALL_APPROACHES_EXHAUSTED 触发后 lastFailureDetail 非空且 status=BLOCKED | orchestrator.ts + 测试 | PASS | orchestrator.ts 1442-1455 行 handleCircuitBreaker ALL_EXHAUSTED 路径：atomicUpdate 写入 `lastFailureDetail: validation.feedback` 且 `status: "BLOCKED"`；697/697 PASS |

---

## 详细分析

### AC-10（manual）— auto_dev_state_get 透传 lastFailureDetail

**验证路径**：

1. `types.ts` 第 204 行：`lastFailureDetail: z.string().nullable().optional()` — StateJsonSchema 已声明该字段。
2. 失败路径写入：orchestrator.ts 多处 `sm.atomicUpdate({ ..., lastFailureDetail: validation.feedback })` 持久化到 state.json。
3. `auto_dev_state_get` 实现（index.ts 555-567 行）：
   ```
   const state = await sm.loadAndValidate();
   return textResult(state);
   ```
   直接序列化完整 state 对象，无过滤逻辑。只要 `lastFailureDetail` 写入了 state.json（步骤 2 保证），`state_get` 就会返回它。
4. orchestrator-ux-improvements.test.ts 中 StateJsonSchema 字段测试验证了 `lastFailureDetail` 为字符串和 null 时 schema 均通过。

**结论**：AC-10 满足。通过代码审查确认持久化 + 读取链路完整，无需额外集成测试。

---

### AC-12（structural）— buildTaskForStep 签名不变，tasks 在上层组装

**验证路径**：

1. `orchestrator.ts` 第 1059-1068 行，函数签名：
   ```typescript
   export async function buildTaskForStep(
     step: string, outputDir: string, projectRoot: string,
     topic: string, buildCmd: string, testCmd: string,
     feedback?: string, extraVars?: Record<string, string>,
   ): Promise<string>
   ```
   返回类型为 `Promise<string>`，未变更。
2. AC-12 的 structuralAssertion `file_not_contains` 模式为 `buildTaskForStep.*Promise<\{`，在 orchestrator.ts 中搜索无匹配（已验证）。
3. `computeNextTask` step "3" 分支（orchestrator.ts 720-724 行）：
   ```typescript
   const prompt = await buildTaskForStep("3", ...);        // 独立调用，返回 string
   const planContent = await readFileSafe(join(outputDir, "plan.md"));
   const tasks = parseTaskList(planContent);               // 上层单独组装
   return { ..., prompt, tasks };                          // 两者独立注入
   ```
   `tasks` 不经由 `buildTaskForStep` 返回，完全在上层调用点组装。

**结论**：AC-12 满足。签名未变，tasks 组装点符合设计。

---

### AC-8/AC-9 额外说明

两条 AC 均要求验证"tribunal digest"（prepareTribunalInput 的实际输出）。tribunal.test.ts 第 1673-1727 行通过集成测试（mock git execFile）直接验证了 `prepareTribunalInput` 的 `digestContent` 包含正确的 HIGH/LOW 字样和审查指令字符串，不仅是解析逻辑，而是完整的输出内容。设计要求的文本（"必须逐文件审查"）与代码中 `scaleInstruction = "变更行数超过 500 行，必须逐文件审查，不得遗漏。"` 完全匹配。

---

## 通过率

**15/15 PASS，0 FAIL，0 SKIP**

---

## 结论

**PASS**

全部 15 条验收标准已满足：
- AC-1~3, AC-5~9, AC-11, AC-13~15：由 e2e-test-results.md 记录的 697/697 测试（含 tribunal.test.ts AC-8/AC-9 集成测试和 orchestrator-ux-improvements.test.ts 25 个单元测试）覆盖，全部通过。
- AC-4：tribunal FAIL under limit 路径的 lastFailureDetail 填充在 orchestrator.ts 代码中可直接确认，且被全量测试集覆盖。
- AC-10（manual）：通过代码链路审查（types.ts schema + atomicUpdate 写入 + state_get 直接序列化）确认满足，无需额外集成测试。
- AC-12（structural）：buildTaskForStep 签名为 `Promise<string>` 已确认，结构断言（file_not_contains）在代码中无匹配，满足。
