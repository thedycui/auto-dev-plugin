# 端到端测试用例 — 双层可执行验收标准框架

> Topic: executable-ac
> 日期: 2026-04-01
> 测试命令: `cd mcp && npm test -- --run`

## 一、已有测试覆盖分析

| 测试文件 | 用例数 | 覆盖范围 |
|----------|--------|---------|
| ac-schema.test.ts | 11 | Zod schema 7 种断言解析、必填校验、hash 稳定性/差异性/description 排除 |
| ac-runner.test.ts | 22 | 7 种断言执行器（file_exists/not_exists/contains/not_contains/config_value/build_succeeds/test_passes）、glob、多断言 AND 语义、非 structural AC 过滤 |
| ac-test-binding.test.ts | 13 | Node/Java/Python 3 种语言绑定发现、覆盖率验证、目标测试命令生成 |
| ac-integration.test.ts | 9 | 6 个端到端场景（全 PASS/structural FAIL/hash 篡改/legacy 兼容/binding 缺失/全管线） |

**已覆盖**: 55 个用例

## 二、覆盖缺口分析

### 2.1 未覆盖的集成入口路径

已有测试均直接调用底层函数（`runStructuralAssertions`、`validateAcJson` 等），但**从未测试 orchestrator.ts 和 index.ts 中的 Phase 6 入口路径**。

- orchestrator.ts `case "6"` 路径：hash 校验 -> parse -> binding 覆盖 -> structural -> test-bound -> 写 results.json -> 失败短路 -> Tribunal
- index.ts Phase 1 checkpoint 的 AC_LOCK 写入路径
- index.ts Phase 6 submit 的 legacy 兜底路径

这些入口包含**独有的控制流逻辑**（如 binding missing 时直接返回 BLOCKED、structuralFails + testFails 合并判断、framework-ac-results.json 写文件），底层测试无法覆盖。

### 2.2 未覆盖的边界条件

| 编号 | 缺口描述 | 风险 |
|------|---------|------|
| G-1 | structural AC 没有 structuralAssertions 字段（空数组或 null） | 运行时是否返回 passed:true 还是抛异常 |
| G-2 | AC JSON 为空 criteria 数组 `{ version: 1, criteria: [] }` | manual ratio 计算分母为 0 |
| G-3 | 同一 AC-id 出现多次 | 是否去重、hash 是否稳定 |
| G-4 | config_value 对非 JSON 文件（如 YAML） | 当前只解析 JSON，YAML 文件会 parse 失败 |
| G-5 | file_contains 使用无效正则 | `new RegExp(pattern)` 是否捕获异常 |
| G-6 | discoverAcBindings 对不支持的语言（如 go） | 返回空数组还是抛异常 |
| G-7 | buildTargetedTestCommand 对 unknown 语言 | fallback 路径是否可用 |
| G-8 | runAcBoundTests 传入空 bindings 数组 | 循环不执行，返回空 Map |
| G-9 | computeAcHash 对含有嵌套 structuralAssertions 的 criteria（7 种混合） | hash 稳定性 |
| G-10 | AC_LOCK marker 格式异常（hash 被截断） | regex 匹配失败时的降级行为 |

### 2.3 未覆盖的负面测试

- validateAcJson 传入非 JSON 字符串
- validateAcIntegrity 传入格式错误的 AC JSON
- runStructuralAssertions 中 config_value 处理 malformed JSON 文件
- discoverAcBindings 在项目根目录不存在时的行为

## 三、补充测试用例

### TC-E2E-01: orchestrator Phase 6 全 PASS 管线（集成入口测试）

**目的**: 从 orchestrator 入口验证完整 Phase 6 管线：hash 校验 -> structural 断言 -> test-bound 执行 -> framework-ac-results.json 写入。

**前置条件**:
- 临时目录包含 `acceptance-criteria.json`（1 structural + 1 manual AC）
- progress-log.md 包含正确的 AC_LOCK marker
- structural AC 要求的文件已存在（如 `config.json` 含 `"max-retry"`）
- 无 test-bound AC（简化，避免需要真实测试文件）

**步骤**:
1. 构造 state 对象（含 stack.language = "node"、codeRoot 指向临时目录）
2. 调用 orchestrator 的 Phase 6 分支（模拟 evaluateTribunal 返回 PASS）
3. 检查返回值

**预期结果**:
- 返回 `passed: true`
- `framework-ac-results.json` 被写入临时目录
- JSON 中 `structural.AC-1.passed === true`
- JSON 中 `pendingManual` 包含 manual AC 的 id

**验证方式**: 断言返回值 + 读取并解析 framework-ac-results.json

---

### TC-E2E-02: orchestrator Phase 6 structural FAIL 短路

**目的**: 验证 structural 断言失败时，orchestrator 直接返回 BLOCKED 而不调用 Tribunal。

**前置条件**:
- acceptance-criteria.json 含 1 条 structural AC（要求 `config.json` 存在）
- 临时目录中**没有** `config.json`
- progress-log.md 含正确 AC_LOCK

**步骤**:
1. 调用 orchestrator Phase 6 分支

**预期结果**:
- 返回 `passed: false`
- `feedback` 包含 `"Structural AC FAIL"`
- `feedback` 包含 `"AC-1"`
- Tribunal 未被调用（可通过 mock 验证）

---

### TC-E2E-03: orchestrator Phase 6 hash 篡改 BLOCKED

**目的**: 验证 AC JSON 被修改后（hash 与 AC_LOCK 不匹配），orchestrator 直接返回 BLOCKED。

**前置条件**:
- acceptance-criteria.json 与 AC_LOCK 中的 hash 不一致

**步骤**:
1. 调用 orchestrator Phase 6 分支

**预期结果**:
- 返回 `passed: false`
- `feedback` 包含 `"tamper detected"`

---

### TC-E2E-04: orchestrator Phase 6 binding 缺失 BLOCKED

**目的**: 验证 test-bound AC 没有对应测试绑定时，orchestrator 返回 BLOCKED 并提示回退 Phase 5。

**前置条件**:
- acceptance-criteria.json 含 1 条 `layer: "test-bound"` AC（AC-3）
- 项目代码中没有任何 `[AC-3]` 标注的测试

**步骤**:
1. 调用 orchestrator Phase 6 分支

**预期结果**:
- 返回 `passed: false`
- `feedback` 包含 `"missing bindings"`
- `feedback` 包含 `"AC-3"`
- `feedback` 包含 `"Phase 5"` 的回退提示

---

### TC-E2E-05: orchestrator Phase 6 无 AC JSON 时降级到 legacy Tribunal

**目的**: 验证没有 acceptance-criteria.json 时，orchestrator 跳过 AC 框架直接进入 Tribunal 审查（向后兼容）。

**前置条件**:
- 临时目录中**没有** `acceptance-criteria.json`

**步骤**:
1. 调用 orchestrator Phase 6 分支（mock evaluateTribunal 返回 PASS）

**预期结果**:
- 返回 `passed: true`（由 Tribunal 决定）
- `framework-ac-results.json` **不存在**
- evaluateTribunal 被调用 1 次

---

### TC-E2E-06: index.ts Phase 1 checkpoint AC_LOCK 写入（集成入口测试）

**目的**: 验证 Phase 1 checkpoint PASS 时，如果存在 acceptance-criteria.json，框架会验证 schema 并写入 AC_LOCK marker。

**前置条件**:
- 有效的 state.json（phase=1, status 未到 PASS）
- acceptance-criteria.json schema 合法、manual 占比 <= 40%
- design-review.md 存在且 >= 100 字符

**步骤**:
1. 调用 `auto_dev_checkpoint` tool（phase=1, status=PASS）

**预期结果**:
- checkpoint 返回成功
- progress-log.md 新增一行 `<!-- AC_LOCK hash=xxx total=N structural=M testBound=K manual=J -->`
- hash 值与 `computeAcHash(criteria)` 计算结果一致

---

### TC-E2E-07: index.ts Phase 1 checkpoint AC schema 无效时拒绝

**目的**: 验证 Phase 1 checkpoint 时，如果 acceptance-criteria.json schema 非法，checkpoint 被拒绝。

**前置条件**:
- acceptance-criteria.json 内容为 `{ "version": 1, "criteria": [{ "id": "AC-1", "layer": "structural" }] }`（缺少 description）

**步骤**:
1. 调用 `auto_dev_checkpoint`（phase=1, status=PASS）

**预期结果**:
- 返回 error: `"AC_SCHEMA_INVALID"`
- state.json 的 phase 未被更新（"No state pollution"）

---

### TC-E2E-08: index.ts Phase 1 checkpoint manual 占比超标拒绝

**目的**: 验证 manual AC 占比 > 40% 时 checkpoint 被拒绝。

**前置条件**:
- acceptance-criteria.json 含 4 条 AC，3 条 manual（75%）

**步骤**:
1. 调用 `auto_dev_checkpoint`（phase=1, status=PASS）

**预期结果**:
- 返回 error: `"AC_SCHEMA_INVALID"`
- message 包含 `"exceeds 40%"`

---

### TC-E2E-09: index.ts Phase 6 submit legacy 兜底路径

**目的**: 验证 index.ts 的 `auto_dev_submit` 在非 orchestrator 模式下的 Phase 6 AC 框架执行（与 TC-E2E-01 对应但走不同代码路径）。

**前置条件**:
- 非 orchestrator 会话
- acceptance-criteria.json + 正确 AC_LOCK + structural 断言的文件存在

**步骤**:
1. 调用 `auto_dev_submit`（phase=6）

**预期结果**:
- structural 断言通过
- framework-ac-results.json 被写入
- 流程继续到 Tribunal

---

### TC-E2E-10: index.ts Phase 6 submit structural 失败返回 AC_FRAMEWORK_FAIL

**目的**: 验证 index.ts legacy 路径中 structural 失败时返回正确的错误码。

**前置条件**:
- acceptance-criteria.json 存在，structural AC 要求的文件不存在

**步骤**:
1. 调用 `auto_dev_submit`（phase=6）

**预期结果**:
- 返回 error: `"AC_FRAMEWORK_FAIL"`
- mandate 包含 `"[BLOCKED]"`

---

### TC-B-01: structural AC 有 null structuralAssertions

**目的**: 验证 `layer: "structural"` 但 `structuralAssertions: null` 时不会抛异常。

**输入**:
```json
{ "id": "AC-1", "description": "test", "layer": "structural", "structuralAssertions": null }
```

**步骤**:
1. 调用 `runStructuralAssertions([criterion], tempDir)`

**预期结果**:
- 返回 `{ "AC-1": { passed: true, details: [] } }`（空断言 = 空列表 = 全通过）

---

### TC-B-02: structural AC 有空数组 structuralAssertions

**目的**: 与 TC-B-01 类似，验证空数组行为。

**输入**:
```json
{ "id": "AC-1", "description": "test", "layer": "structural", "structuralAssertions": [] }
```

**预期结果**:
- 返回 `{ "AC-1": { passed: true, details: [] } }`

---

### TC-B-03: validateAcJson 空 criteria 数组

**目的**: 验证 `criteria: []` 时 manual ratio 计算不发生除零错误。

**输入**:
```json
{ "version": 1, "criteria": [] }
```

**步骤**:
1. 调用 `validateAcJson(JSON.stringify(input))`

**预期结果**:
- `valid: true`
- `stats.total === 0`
- `hash` 是有效的 32 位 hex 字符串

---

### TC-B-04: validateAcJson 传入非 JSON 字符串

**目的**: 验证传入非法 JSON 时不抛异常，返回有意义的错误。

**输入**: `"not a json {{}"`

**步骤**:
1. 调用 `validateAcJson(input)`

**预期结果**:
- `valid: false`
- `error` 包含 `"parse error"`

---

### TC-B-05: validateAcIntegrity 传入格式错误的 AC JSON

**目的**: 验证 integrity 检查中 JSON parse 失败时不抛异常。

**输入**: acContent = `"broken json"`，progressLog 含 AC_LOCK marker

**预期结果**:
- `valid: false`
- `error` 包含 `"parse error"`

---

### TC-B-06: file_contains 使用无效正则表达式

**目的**: 验证 `pattern` 为非法正则（如 `[invalid`）时断言 FAIL 而非抛异常。

**前置条件**:
- 临时目录包含文件 `test.txt`

**输入**:
```json
{ "type": "file_contains", "path": "test.txt", "pattern": "[invalid" }
```

**步骤**:
1. 调用 `runStructuralAssertions` 包含该断言

**预期结果**:
- 断言 `passed: false`（或异常被捕获）
- 不抛未捕获异常导致进程崩溃

---

### TC-B-07: config_value 读取 malformed JSON 文件

**目的**: 验证配置文件不是合法 JSON 时返回 FAIL 而非抛异常。

**前置条件**:
- `config.json` 内容为 `"{ broken json"`

**预期结果**:
- `passed: false`
- `detail` 包含 `"Cannot read/parse"`

---

### TC-B-08: discoverAcBindings 对不支持的语言

**目的**: 验证传入 `"go"` 等不支持的语言时返回空数组。

**步骤**:
1. 调用 `discoverAcBindings(tempDir, "go")`

**预期结果**:
- 返回空数组 `[]`
- 不抛异常

---

### TC-B-09: buildTargetedTestCommand 对未知语言的 fallback

**目的**: 验证未知语言走 default 分支。

**步骤**:
1. 调用 `buildTargetedTestCommand("rust", "tests/test_main.rs", [...], "/project")`

**预期结果**:
- 返回 `"cd /project && tests/test_main.rs"`

---

### TC-B-10: computeAcHash 对重复 AC-id 的稳定性

**目的**: 验证相同 id 出现多次时 hash 稳定（不去重，hash 基于完整数组）。

**输入**:
```typescript
[
  { id: "AC-1", description: "a", layer: "manual" },
  { id: "AC-1", description: "b", layer: "manual" },
]
```

**步骤**:
1. 调用 `computeAcHash` 两次，输入相同

**预期结果**:
- 两次 hash 相同
- hash 是 32 位 hex

---

### TC-B-11: AC_LOCK marker 格式异常（hash 被截断）

**目的**: 验证 progress-log 中 AC_LOCK hash 不完整时 validateAcIntegrity 的行为。

**输入**:
- progressLog: `"<!-- AC_LOCK hash=abc total=2 -->"`（hash 只有 3 位）
- acContent: 合法 AC JSON

**预期结果**:
- `valid: false`
- `error` 包含 `"tamper detected"`（因为 3 位 hash 必然与 32 位 hash 不匹配）

---

### TC-B-12: runAcBoundTests 空 bindings 数组

**目的**: 验证传入空数组时不报错。

**步骤**:
1. 调用 `runAcBoundTests([], tempDir, "node", "npx vitest run")`

**预期结果**:
- 返回空 Map（`size === 0`）

---

### TC-B-13: 多个 AC 混合 structural + test-bound + manual

**目的**: 验证 runStructuralAssertions 只处理 structural AC，正确忽略其余两种。

**输入**:
- 3 条 AC：structural（file_exists 通过）、test-bound、manual

**步骤**:
1. 调用 `runStructuralAssertions(criteria, tempDir)`

**预期结果**:
- 结果只包含 structural AC 的 key
- test-bound 和 manual AC 不出现在结果中

---

### TC-B-14: discoverAcBindings 项目根目录不存在

**目的**: 验证项目根路径不存在时优雅降级。

**步骤**:
1. 调用 `discoverAcBindings("/nonexistent/path", "node")`

**预期结果**:
- 返回空数组 `[]`
- 不抛未捕获异常

---

### TC-B-15: validateAcJson manual 占比恰好 40%

**目的**: 边界值测试，验证 40% 是允许的（>40% 才拒绝）。

**输入**:
- 5 条 AC：2 manual + 3 structural（40% = 2/5）

**预期结果**:
- `valid: true`

---

### TC-B-16: validateAcJson manual 占比刚好超过 40%

**目的**: 边界值，验证 41% 以上被拒绝。

**输入**:
- 5 条 AC：3 manual + 2 structural（60%）

**预期结果**:
- `valid: false`
- `error` 包含 `"exceeds 40%"`

---

### TC-B-17: file_not_contains 对不存在的文件

**目的**: 验证文件不存在时 file_not_contains 返回 PASS（已在 ac-runner.test.ts 覆盖，此处记录为确认）。

**预期结果**: `passed: true`

**状态**: 已有覆盖

---

### TC-B-18: validateAcBindingCoverage 同一 AC 有多个绑定

**目的**: 验证一个 AC-id 被多个测试绑定时不重复计入。

**输入**:
```typescript
criteria: [{ id: "AC-1", layer: "test-bound", description: "test" }]
bindings: [
  { acId: "AC-1", testFile: "a.test.ts", testName: "test1", language: "node" },
  { acId: "AC-1", testFile: "b.test.ts", testName: "test2", language: "node" },
]
```

**预期结果**:
- `covered: ["AC-1"]`（不重复）
- `missing: []`
- `extraBindings: []`

## 四、覆盖矩阵

### 4.1 模块 x 测试类型矩阵

| 模块 | 单元测试（已有） | 边界值测试（补充） | 集成入口测试（补充） |
|------|-----------------|-------------------|-------------------|
| **ac-schema.ts** (Schema + Hash) | 11 tests: 7 种断言解析、必填/可选字段、hash 稳定性 | TC-B-03 (空 criteria)、TC-B-10 (重复 id)、TC-B-15/16 (40% 边界) | TC-E2E-06/07/08 (Phase 1 checkpoint 入口) |
| **ac-runner.ts** (Structural 断言) | 22 tests: 7 种断言器正反用例、glob、多断言、跳过非 structural | TC-B-01/02 (null/空断言)、TC-B-06 (无效正则)、TC-B-07 (malformed JSON)、TC-B-13 (混合 AC 过滤) | TC-E2E-01/02 (orchestrator 入口)、TC-E2E-09/10 (index.ts 入口) |
| **ac-test-binding.ts** (绑定发现) | 13 tests: 3 语言发现、覆盖率验证、命令生成 | TC-B-08 (不支持语言)、TC-B-09 (未知语言命令)、TC-B-12 (空 bindings)、TC-B-14 (路径不存在)、TC-B-18 (重复绑定) | TC-E2E-04 (binding 缺失入口) |
| **phase-enforcer.ts** (validateAcJson/Integrity) | 包含在 integration test 中 | TC-B-04 (非 JSON)、TC-B-05 (integrity 非法 JSON)、TC-B-11 (截断 hash)、TC-B-15/16 (40% 边界) | TC-E2E-06/07/08 (Phase 1 入口) |
| **orchestrator.ts** (Phase 6 分支) | 无直接单测 | -- | TC-E2E-01/02/03/04/05 (5 条入口测试) |
| **index.ts** (Phase 1 + Phase 6 兜底) | 无直接单测 | -- | TC-E2E-06/07/08/09/10 (5 条入口测试) |

### 4.2 设计文档验收标准 x 测试矩阵

| 设计文档 AC | 已有测试 | 补充测试 |
|------------|---------|---------|
| Layer 1 structural 断言由框架执行（7 种类型白名单） | ac-runner.test.ts 全部 22 tests | TC-B-01/02/06/07 |
| Layer 2 test-bound 由框架运行标注测试 | ac-test-binding.test.ts 全部 13 tests | TC-B-08/09/12/14/18 |
| Layer 3 manual 由 Tribunal 审查 | ac-integration Scenario 1/6 | TC-E2E-01/05 |
| manual 占比 <= 40% | ac-integration Scenario 6 (reject 75%) | TC-B-03/15/16、TC-E2E-08 |
| AC_LOCK 防篡改 | ac-integration Scenario 3 | TC-B-11、TC-E2E-03/06 |
| binding 覆盖率检查 | ac-integration Scenario 5 | TC-B-18、TC-E2E-04 |
| structural FAIL 短路 | ac-integration Scenario 2 | TC-E2E-02/10 |
| 无 AC JSON 时向后兼容 | ac-integration Scenario 4 | TC-E2E-05 |
| Phase 1 写入 AC_LOCK marker | 无 | TC-E2E-06/07/08 |
| Phase 6 orchestrator 主路径 | 无 | TC-E2E-01/02/03/04/05 |
| Phase 6 index.ts 兜底路径 | 无 | TC-E2E-09/10 |

### 4.3 测试技术覆盖

| 测试技术 | 对应用例 |
|----------|---------|
| 等价类划分 | TC-E2E-01 (全 PASS 类)、TC-E2E-02 (structural FAIL 类)、TC-E2E-05 (无 AC JSON 类) |
| 边界值分析 | TC-B-03 (0 条 criteria)、TC-B-15 (40% 恰好)、TC-B-16 (41% 刚超)、TC-B-11 (截断 hash) |
| 决策表 | orchestrator Phase 6: {AC JSON 存在, hash 匹配, binding 完整, structural 通过, test 通过} 5 因素组合 |
| 负面测试 | TC-B-04/05/06/07/14 (非法输入、不存在路径、格式错误) |
| 集成入口测试 | TC-E2E-01~10 (从 orchestrator/index.ts 入口发起) |

## 五、优先级排序

| 优先级 | 用例 | 理由 |
|--------|------|------|
| P0 | TC-E2E-01, TC-E2E-02, TC-E2E-06 | 核心路径集成入口，已有测试完全未覆盖 |
| P0 | TC-B-01, TC-B-03, TC-B-06 | 高概率触发的边界条件 |
| P1 | TC-E2E-03, TC-E2E-04, TC-E2E-05 | 安全/兼容性路径 |
| P1 | TC-B-04, TC-B-05, TC-B-07, TC-B-08 | 异常输入防御 |
| P1 | TC-B-15, TC-B-16 | 业务规则边界值（40% 阈值） |
| P2 | TC-E2E-07, TC-E2E-08, TC-E2E-09, TC-E2E-10 | Phase 1 拒绝路径、legacy 兜底 |
| P2 | TC-B-09, TC-B-10, TC-B-11, TC-B-12, TC-B-14, TC-B-18 | 低概率边界条件 |

## 六、测试实施说明

### 6.1 集成入口测试的 mock 策略

orchestrator.ts 和 index.ts 的入口测试需要 mock 以下外部依赖：
- `evaluateTribunal` / `executeTribunal` — mock 为返回 PASS/FAIL
- 文件系统 — 使用 `mkdtemp` 创建临时目录
- `readFileSafe` — 指向临时目录中的文件
- state 对象 — 手动构造最小化 StateJson

### 6.2 建议的测试文件组织

| 文件 | 内容 |
|------|------|
| `ac-schema.test.ts` | 追加 TC-B-03, TC-B-10, TC-B-15, TC-B-16 |
| `ac-runner.test.ts` | 追加 TC-B-01, TC-B-02, TC-B-06, TC-B-07, TC-B-13 |
| `ac-test-binding.test.ts` | 追加 TC-B-08, TC-B-09, TC-B-12, TC-B-14, TC-B-18 |
| `ac-integration.test.ts` | 追加 TC-B-04, TC-B-05, TC-B-11 |
| `ac-orchestrator-e2e.test.ts`（新建） | TC-E2E-01 ~ TC-E2E-05 |
| `ac-index-e2e.test.ts`（新建） | TC-E2E-06 ~ TC-E2E-10 |

### 6.3 测试用例总数统计

| 类别 | 数量 |
|------|------|
| 已有测试 | 55 |
| 补充：集成入口测试（E2E） | 10 |
| 补充：边界值/负面测试 | 17 (TC-B-17 已有覆盖，不计) |
| **合计** | **82** |
