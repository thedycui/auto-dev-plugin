# 实施计划：Auto-Dev 自评改进 Round 2

**设计文档**: `docs/auto-dev/20260330-1821-auto-dev-self-improve-round2/design.md`
**预估总改动**: ~130 行（含测试）
**实施顺序**: R2-1 -> R2-2 -> R2-3 -> R2-4（按优先级串行）

---

## Task 1: R2-1 修复 tribunal verdict 后 step 推进缺失（P0）

**目标**: `auto_dev_tribunal_verdict` PASS 后清空 step 相关字段，避免死循环

**修改文件**: `mcp/src/index.ts`

**修改位置**: `auto_dev_tribunal_verdict` handler 的 PASS 分支（约 1906-1923 行），在 `internalCheckpoint` 调用成功后、`return textResult` 之前

**具体改动**:
1. 在 verdict === "PASS" 且 `internalCheckpoint` 成功后，添加：
   ```typescript
   await sm.atomicUpdate({ step: null, stepIteration: 0, lastValidation: null, approachState: null });
   ```
2. 仅在 `ckptResult.ok`（或 legacy 路径无错误）时才清空 step
3. FAIL 分支不做任何改动

**预估行数**: +5 行
**依赖**: 无
**验收**: AC-1, AC-2

---

## Task 2: R2-1 单元测试

**目标**: 验证 tribunal PASS 后 step 被清空，以及 orchestrator 能在 step=null 时正确计算下一步

**修改文件**: `mcp/src/__tests__/orchestrator.test.ts`（或 `tribunal.test.ts`，取决于现有测试结构）

**具体改动**:
1. 新增测试用例：mock `auto_dev_tribunal_verdict` PASS 调用后，验证 state.json 中 `step === null`、`stepIteration === 0`、`lastValidation === null`、`approachState === null`
2. 新增测试用例：设置 `phase=5, step=null` 后调用 `computeNextTask`，验证返回 `step: "5a"` 而非 tribunal escalation

**预估行数**: +20 行
**依赖**: Task 1
**验收**: AC-1, AC-2

---

## Task 3: R2-2 TDD 门禁全局校验（P1）

**目标**: Phase 3 完成进入 Phase 4 前，硬性 BLOCK 空 `tddTaskStates`

**修改文件**: `mcp/src/orchestrator.ts`

**修改位置**: `computeNextTask()` 中，step 已存在、validation.passed === true 后推进到下一步之前（约 1074 行之后的 validation passed 分支）。具体位置：当 `currentStep === "3"` 且 validation 通过、即将推进到 `"4a"` 时

**具体改动**:
1. 在 validation passed 后、推进到下一 step 前，增加 TDD 全局门禁检查：
   - 条件：`state.tdd === true && phaseForStep(currentStep) === 3 && nextStep && phaseForStep(nextStep) >= 4`
   - 读取 `plan.md`，用正则 `## Task\s+(\d+)` 提取所有 task 编号
   - 对每个 task 调用 `isTddExemptTask(outputDir, taskNum)` 判断是否 exempt
   - 统计非 exempt task 数量 N
   - 统计 `state.tddTaskStates` 中 `status === "GREEN_CONFIRMED"` 的数量 G
   - 若 N > 0 且 G < N，返回 BLOCK 结果（`done: false, step: currentStep, prompt: null, message: "TDD_GATE_GLOBAL_INCOMPLETE"`）
2. 需要在 `orchestrator.ts` 顶部 import `isTddExemptTask` from `phase-enforcer.js`

**预估行数**: +25 行
**依赖**: 无（可与 Task 1 并行开发，但按优先级串行交付）
**验收**: AC-3, AC-3b

---

## Task 4: R2-2 单元测试

**目标**: 验证 TDD 全局门禁的 BLOCK 和通过场景

**修改文件**: `mcp/src/__tests__/orchestrator.test.ts`

**具体改动**:
1. 新增测试用例：`tdd=true`，plan.md 有 2 个非 exempt task，`tddTaskStates` 为空 -> 验证返回包含 `TDD_GATE_GLOBAL_INCOMPLETE` 的 BLOCK
2. 新增测试用例：`tdd=true`，plan.md 所有 task 均为 exempt -> 验证正常通过不 BLOCK
3. 新增测试用例：`tdd=true`，plan.md 有 2 个非 exempt task，`tddTaskStates` 有 2 个 `GREEN_CONFIRMED` -> 验证正常通过

**预估行数**: +30 行
**依赖**: Task 3
**验收**: AC-3, AC-3b

---

## Task 5: R2-3 Phase 5a 增加 e2e-test-cases.md 文件存在性检查（P2）

**目标**: 将 Phase 5a 从 pass-through 改为有条件验证

**修改文件**: `mcp/src/orchestrator.ts`

**修改位置**: `validateStep` 函数中 `case "5a"` 分支（约 730-733 行）

**具体改动**:
1. 将现有的 `return { passed: true, feedback: "" }` 替换为：
   ```typescript
   case "5a": {
     const hasTestCases = await fileExists(join(outputDir, "e2e-test-cases.md"));
     if (!hasTestCases) {
       return { passed: false, feedback: "e2e-test-cases.md 不存在。Phase 5a 要求输出测试用例设计文件。" };
     }
     return { passed: true, feedback: "" };
   }
   ```
2. `fileExists` 已在 `orchestrator.ts:148` 定义为 export 函数，无需额外 import

**预估行数**: +5 行
**依赖**: 无
**验收**: AC-4, AC-5

---

## Task 6: R2-3 单元测试

**目标**: 验证 Phase 5a 的文件存在性检查

**修改文件**: `mcp/src/__tests__/orchestrator.test.ts`

**具体改动**:
1. 新增测试用例：output dir 中不存在 `e2e-test-cases.md` -> validateStep("5a") 返回 `passed: false`
2. 新增测试用例：output dir 中存在 `e2e-test-cases.md` -> validateStep("5a") 返回 `passed: true`

**预估行数**: +15 行
**依赖**: Task 5
**验收**: AC-4, AC-5

---

## Task 7: R2-4 新增 skipSteps 状态字段 + computeNextStep 过滤

**目标**: 支持跳过指定步骤（如 1b、2b）的 lightweight 审查模式

**分步骤**:

### 7a: 状态 Schema 新增 skipSteps 字段

**修改文件**: `mcp/src/types.ts`

**修改位置**: `StateJsonSchema` 定义中，behavior flags 区域（约 116 行 `skipE2e` 附近）

**具体改动**:
```typescript
skipSteps: z.array(z.string()).optional(),  // lightweight mode: skip specific steps (e.g. ["1b", "2b"])
```

**预估行数**: +1 行

### 7b: computeNextStep 增加 skipSteps 参数

**修改文件**: `mcp/src/orchestrator.ts`

**修改位置**: `computeNextStep` 函数（约 306 行）

**具体改动**:
1. 函数签名增加第三个 optional 参数：`skipSteps?: string[]`
2. 在循环中增加过滤：`if (skipSteps?.includes(candidate)) continue;`

```typescript
export function computeNextStep(currentStep: string, phases: number[], skipSteps?: string[]): string | null {
  const idx = STEP_ORDER.indexOf(currentStep);
  if (idx < 0) return null;
  for (let i = idx + 1; i < STEP_ORDER.length; i++) {
    const candidate = STEP_ORDER[i]!;
    if (skipSteps?.includes(candidate)) continue;
    const candidatePhase = phaseForStep(candidate);
    if (phases.includes(candidatePhase)) {
      return candidate;
    }
  }
  return null;
}
```

**预估行数**: +3 行（净增，函数体改动）

### 7c: computeNextTask 传递 skipSteps

**修改文件**: `mcp/src/orchestrator.ts`

**修改位置**: `computeNextTask()` 中所有调用 `computeNextStep()` 的位置

**具体改动**:
1. 在 `computeNextTask` 开头从 state 中读取 `skipSteps`：`const skipSteps = state.skipSteps ?? [];`（注：需确认 `types.ts` 中已有 `skipSteps` 字段后 state 类型会自动包含）
2. 所有 `computeNextStep(currentStep, phases)` 调用改为 `computeNextStep(currentStep, phases, skipSteps)`

**预估行数**: +5 行

### 7d: auto_dev_init 中设置 skipSteps

**修改文件**: `mcp/src/index.ts`

**修改位置**: `auto_dev_init` handler 中写入 `behaviorUpdates` 的区域（约 410-427 行）

**具体改动**:
1. 在 `behaviorUpdates` 赋值区域增加判断：
   ```typescript
   if (mode === "full" && (estimatedLines ?? 999) <= 50 && (estimatedFiles ?? 999) <= 3) {
     behaviorUpdates["skipSteps"] = ["1b", "2b"];
   }
   ```

**预估行数**: +3 行

**总预估行数**: +12 行
**依赖**: 无（但建议在 R2-1/R2-2 之后实施）
**验收**: AC-6, AC-7, AC-8

---

## Task 8: R2-4 单元测试

**目标**: 验证 skipSteps 的三个场景

**修改文件**: `mcp/src/__tests__/orchestrator.test.ts`

**具体改动**:
1. 新增测试用例：`computeNextStep("1a", [1,2,3,4,5,6,7], ["1b","2b"])` 返回 `"2a"`（跳过 1b）
2. 新增测试用例：`computeNextStep("2a", [1,2,3,4,5,6,7], ["1b","2b"])` 返回 `"3"`（跳过 2b）
3. 新增测试用例：`computeNextStep("3", [1,2,3,4,5,6,7], ["1b","2b"])` 返回 `"4a"`（4a 不被跳过）
4. 新增测试用例：验证 `auto_dev_init` 在 `mode=full, estimatedLines=30, estimatedFiles=2` 时设置 `skipSteps: ["1b","2b"]`

**预估行数**: +25 行
**依赖**: Task 7
**验收**: AC-6, AC-7, AC-8

---

## Task 9: 全量测试回归验证

**目标**: 确保所有改动不破坏现有功能

**操作**:
1. 运行 `cd /Users/admin/dycui/auto-dev-plugin/mcp && npm test`
2. 确认所有测试通过（含新增测试和已有测试）
3. 若有失败，定位并修复

**依赖**: Task 1-8 全部完成
**验收**: AC-9

---

## 依赖关系

```
Task 1 (R2-1 实现) → Task 2 (R2-1 测试)
                              ↓
Task 3 (R2-2 实现) → Task 4 (R2-2 测试)
                              ↓
Task 5 (R2-3 实现) ─┐
                     ├→ Task 6 (R2-3 测试) ─┐
Task 7 (R2-4 实现) ─┤                       ├→ Task 9 (回归验证)
                     └→ Task 8 (R2-4 测试) ─┘
```

注：Task 5 和 Task 7 互不依赖，可并行开发。但为保持 commit 粒度清晰，建议按序实施。

## 提交策略

| Commit | 包含 Task | 描述 |
|--------|----------|------|
| commit 1 | Task 1 + 2 | fix(auto-dev): tribunal verdict PASS 后清空 step 避免死循环 |
| commit 2 | Task 3 + 4 | fix(auto-dev): TDD 门禁增加全局 tddTaskStates 非空校验 |
| commit 3 | Task 5 + 6 + 7 + 8 | feat(auto-dev): Phase 5a 文件检查 + lightweight 审查模式 |
| commit 4 | Task 9 | （无代码改动，仅验证通过后确认） |
