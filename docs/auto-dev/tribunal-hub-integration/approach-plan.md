# 方案计划：裁决官三级执行策略（Hub 集成）

## 主方案：runTribunalWithRetry 层分流 + 显式 subagentRequested 字段

**方法**: 在 `runTribunalWithRetry()` 层做三级策略分流（而非在 `runTribunal()` 中），`runTribunal()` 保持纯 CLI spawn 逻辑不变。默认路径（无环境变量）时 `runTribunalWithRetry()` 直接短路返回 `{ subagentRequested: true }`，不调用 `runTribunal()`。Hub 模式在 `runTribunalWithRetry()` 入口处尝试，失败则降级到 subagent。CLI 模式通过 `TRIBUNAL_MODE=cli` 显式 opt-in 时才调用原有 `runTribunal()`。

**核心工具**: TypeScript 类型扩展、HubClient 模块（纯 fetch HTTP）、环境变量分流

**风险**:
- `runTribunal()` 的现有测试（直接调用）不受影响，因为函数签名和行为不变
- `runTribunalWithRetry()` 的现有测试需要适配（设置 `TRIBUNAL_MODE=cli` 才走 CLI）
- 采纳 plan-review P1-1 建议：分流放在 `runTribunalWithRetry` 而非 `runTribunal`

## 备选方案 A：runTribunal 层联合类型返回

**方法**: 修改 `runTribunal()` 返回类型为 `Promise<TribunalVerdict | { subagentRequested: true }>`，在 `runTribunal()` 内部做三级分流。

**核心工具**: TypeScript 联合类型

**风险**:
- `TribunalVerdict` 是 JSON Schema 定义的类型，往里加 `subagentRequested` 不合适（plan-review P1-1 已指出）
- 所有调用 `runTribunal()` 的地方都需要做类型判断
- 与现有 `runTribunalWithRetry` 的 crash/retry 逻辑耦合

## 备选方案 B：中间件/装饰器模式

**方法**: 新建 `runTribunalStrategy()` 包装函数，内部选择 Hub/Subagent/CLI 路径，返回统一类型。原有 `runTribunal()` 和 `runTribunalWithRetry()` 不修改，新函数替换所有调用点。

**核心工具**: 新函数 + 调用点替换

**风险**:
- 增加一层间接调用，代码复杂度上升
- 需要修改 `evaluateTribunal()` 的调用目标（从 `runTribunalWithRetry` 改为 `runTribunalStrategy`）
- 改动量更大，引入新函数名

## 选择：主方案

理由：改动最集中（只改 `runTribunalWithRetry` 入口），`runTribunal()` 完全不变，现有直接测试 `runTribunal()` 的用例零影响。符合 plan-review P1-1 建议。
