# 方案计划：端到端测试实现

> 任务：orchestrator-ux-improvements（Phase 5 E2E 测试）
> 日期：2026-04-02

---

## 主方案：新建专属测试文件（推荐）

**方法**：新建 `mcp/src/__tests__/orchestrator-ux-improvements.test.ts`，覆盖所有 UNIT 测试用例（20 个）。使用 `parseTaskList`、`parseDiffSummary`、`StateJsonSchema` 等已导出的纯函数，直接测试，无需 mock。INTEGRATION 测试用例中涉及 `computeNextTask` mock 基础设施的部分（I-FAIL、I-STEP3）已在 `orchestrator.test.ts` 中覆盖，新文件不重复建立相同 mock 栈，避免维护成本倍增。

**核心工具**：
- `vitest`（测试框架）
- `parseTaskList`（从 `../orchestrator.js` 导出）
- `parseDiffSummary`（从 `../tribunal.js` 导出）
- `StateJsonSchema`（从 `../types.js` 导出）
- `firstStepForPhase`（从 `../orchestrator.js` 导出）

**风险**：低。全为纯函数测试，无外部依赖，无 mock 失配风险。

---

## 备选方案一：在现有文件中追加测试

**方法**：在 `orchestrator.test.ts` 和 `tribunal.test.ts` 尾部追加新的 describe 块，使用相同 mock 基础设施测试 I-FAIL、I-STEP3、I-TRIB 等集成用例。

**与主方案的本质区别**：不新增文件，共享现有 mock 基础设施；但不满足"必须新增至少 1 个测试文件"的硬性要求（git diff 无新 *.test.ts 文件），会被 HARD BLOCK。

**风险**：高（硬性要求不满足）。

---

## 备选方案二：全量集成测试（含 computeNextTask mock 栈）

**方法**：在新文件中重建完整 mock 基础设施（vi.mock fs、StateManager、evaluateTribunal 等），覆盖所有 UNIT 和 INTEGRATION 测试用例（31 个）。

**与主方案的本质区别**：主方案只覆盖纯函数 UNIT 测试，集成用例委托现有文件；本方案全量覆盖，独立可运行。

**风险**：中。重建 mock 栈工作量约 150 行，且需与 orchestrator.test.ts 的 mock 路径保持同步，后续维护成本高。

---

## 实际执行方案

采用**主方案**：

1. 新建 `mcp/src/__tests__/orchestrator-ux-improvements.test.ts`
2. 实现全部 20 个 UNIT 测试用例（U-PARSE-1~6、U-DIFF-1~5、U-RESET-A/B/2/3/5/6、U-FAIL StateJsonSchema、StateJsonSchema 字段验证）
3. 运行 `npm test` 验证全部通过
