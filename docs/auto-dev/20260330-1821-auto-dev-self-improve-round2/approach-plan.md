# 方案计划

## 执行顺序

按 Task 1-9 顺序串行执行。每完成实现+测试后运行构建验证。

## Task 1: R2-1 tribunal verdict step 推进修复

**文件**: `mcp/src/index.ts` (~1907-1922 行)
**改动**: 在 `auto_dev_tribunal_verdict` PASS 分支中，`internalCheckpoint` 成功后（`ckptResult.ok` 为 true 时），在 `return textResult` 之前插入:
```typescript
await sm.atomicUpdate({ step: null, stepIteration: 0, lastValidation: null, approachState: null });
```

## Task 2: R2-1 单元测试

**文件**: `mcp/src/__tests__/orchestrator.test.ts`
**改动**: 新增 `computeNextStep` 在 step=null 时的行为测试（已在 first call 测试中隐式覆盖），以及 `computeNextTask` 在 phase=5 + step=null 时返回 5a 的测试。

注：R2-1 的 state 清空逻辑在 index.ts 中，依赖 `sm.atomicUpdate` mock。tribunal.test.ts 更适合测 tribunal 相关逻辑，但 orchestrator.test.ts 已有完善的 mock 体系。在 orchestrator.test.ts 中增加一个测试验证 step=null 时 orchestrator 正确返回第一步。

## Task 3: R2-2 TDD 门禁全局校验

**文件**: `mcp/src/orchestrator.ts` (~1374 行附近，validation passed 后、advance 逻辑前)
**改动**: 在 `computeNextStep` 返回 nextStep 后，判断当前 step 的 phase 是 3 且 nextStep 的 phase >= 4 且 `state.tdd === true` 时，执行全局 TDD 校验。需要 import `isTddExemptTask` from `phase-enforcer.js`。

## Task 4: R2-2 单元测试

**文件**: `mcp/src/__tests__/orchestrator.test.ts`
**改动**: 3 个测试用例覆盖 BLOCK / all-exempt / all-GREEN 场景。

## Task 5: R2-3 Phase 5a 文件检查

**文件**: `mcp/src/orchestrator.ts` (~730-733 行)
**改动**: 将 `case "5a"` 的 pass-through 替换为 `e2e-test-cases.md` 文件存在性检查。

## Task 6: R2-3 单元测试

**文件**: `mcp/src/__tests__/orchestrator.test.ts`
**改动**: 2 个测试用例覆盖文件存在/不存在场景。

## Task 7: R2-4 skipSteps

**文件**:
- `mcp/src/types.ts`: 新增 `skipSteps` 字段
- `mcp/src/orchestrator.ts`: `computeNextStep` 增加第三个参数，`computeNextTask` 传递 skipSteps
- `mcp/src/index.ts`: `auto_dev_init` 中判断条件设置 skipSteps

## Task 8: R2-4 单元测试

**文件**: `mcp/src/__tests__/orchestrator.test.ts`
**改动**: 3 个 `computeNextStep` skipSteps 测试 + 无需 auto_dev_init 集成测试（init 逻辑在 index.ts，不在 orchestrator test 范围内）。

## Task 9: 全量回归

运行 `npm test` 确认所有测试通过。
