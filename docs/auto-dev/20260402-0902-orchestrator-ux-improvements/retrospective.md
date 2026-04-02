# 复盘报告: 20260402-0902-orchestrator-ux-improvements

> 生成时间: 2026-04-02 | 总耗时: 约 144 分钟（01:02 → 03:26）

---

## 一、执行概况

| Phase | 时间戳范围 | 迭代次数 | 结论 | 备注 |
|-------|-----------|---------|------|------|
| 1. Design | 01:02 → 01:16 | 2 | PASS（第二轮通过） | 第一轮 NEEDS_REVISION，3 个 P1 问题 |
| 2. Plan | 01:16 → 01:26 | 2 | PASS（第二轮通过） | 第一轮 NEEDS_REVISION，P0×2 + P1×3 问题 |
| 3. Implementation | 01:26 → 01:36 | 1 | PASS | 实际改动 917 行（设计估算 200 行），约 5 倍 |
| 4. Code Review | 01:36 → 01:59 | 1（FALLBACK） | PASS via FALLBACK | tribunalSubmits[4]=3，三次用尽后走 fallback |
| 5. E2E Test | 01:59 → 03:00 | 1（FALLBACK） | PASS via FALLBACK | tribunalSubmits[5]=5，五次用尽后走 fallback |
| 6. Acceptance | 03:00 → 03:26 | 1（FALLBACK） | PASS via FALLBACK | tribunalSubmits[6]=1，单次通过 |

**总 Tribunal 消耗**：Phase 4（3次）+ Phase 5（5次）+ Phase 6（1次）= 9次 tribunal 提交。Phase 4/5 均未能正常通过，全部依赖 FALLBACK 机制兜底。

---

## 二、诚实度审计

### 总评: 3/5 项 PASS

| 审计项 | 结论 | 证据 |
|--------|------|------|
| 是否跳过阶段 | PASS | progress-log.md 第 8-41 行：Phase 1~6 均有 CHECKPOINT 记录，skipE2e=false |
| 是否被框架拦截（review 触发修订） | PASS | Phase 1 第一轮 NEEDS_REVISION（design-review.md P1×3）；Phase 2 第一轮 NEEDS_REVISION（plan-review.md 初版 P0×2+P1×3），两阶段均执行了真实修订 |
| review 和测试是否真实 | PARTIAL | 见详细分析 2.3 节 |
| TDD 合规性 | N/A | state.json 第 18 行：`"tdd": false`，本次 TDD 未启用，不适用 |
| 是否有作弊行为 | PARTIAL | 见详细分析 2.5 节 |

### 2.1 阶段跳过检查

PASS。progress-log.md 完整记录了 Phase 1~6 的全部 CHECKPOINT，无跳过。design-review.md 和 plan-review.md 均存在且内容完整（不是空占位），均包含具体文件路径和行号引用。

### 2.2 执行过程完整性

PASS（主流程），但有异常。

Phase 1 经历了 2 轮审查（第一轮 NEEDS_REVISION，第二轮 PASS），Phase 2 同样经历 2 轮（第一轮 NEEDS_REVISION，第二轮 PASS）。修订过程真实，非跳过。

**异常**：Phase 3 实际改动量为 917 行（18 个文件，tribunal-digest-phase4.md 框架统计可见），而设计估算仅 170-200 行，**实际超出约 4.6 倍**。超出原因未在 progress-log 中记录，推测来自同步更新 dist/ 构建产物（mcp/dist/ 相关文件占大量 diff），以及测试代码新增（orchestrator.test.ts 新增 335 行）。这一偏差未触发任何警报或重新确认，说明框架对"实际变更量远超估算"没有检测机制。

### 2.3 review 和测试真实性

PARTIAL。存在一个结构性问题。

**design-review.md**：PASS。包含具体行号引用（如"第 1015 行 `buildTaskForStep` 签名"、"第 679、1172... 行调用点"），引用格式真实，非编造。

**plan-review.md**：PASS。初版 plan-review.md 发现了真实 P0 问题（Task 4 调用点描述错误），要求修订。第二轮 plan-review.md 包含具体行号对比（line 679 / ~1220 / ~1554 三处），审查深度真实。

**e2e-test-results.md**：PASS（测试执行结果真实）。e2e-test-results.md 引用 697 tests ALL PASS，framework-test-exitcode.txt 确认 exit code 为 0，测试文件 orchestrator-ux-improvements.test.ts 实际存在于 `mcp/src/__tests__/` 下并通过 Glob 验证。

**framework-ac-results.json 的严重异常**：FAIL。

framework-ac-results.json 是框架自动执行 AC 绑定检查的原始输出，其中：
- AC-3：运行 `ac-integration.test.ts`，输出 "26 tests | 26 skipped"，框架判 passed=true
- AC-1：运行 `ac-test-binding.test.ts`，输出 "18 tests | 18 skipped"，框架判 passed=true
- AC-2：同上，"18 tests | 18 skipped"，框架判 passed=true
- AC-5：同上，"18 tests | 18 skipped"，框架判 passed=true

这 4 个 AC 的"通过"是因为框架在定向跑 AC 绑定测试时，找到的测试文件是框架自身的 fixture 文件（ac-test-binding.test.ts、ac-integration.test.ts），而这些 fixture 文件在非特定环境下全部 skip。框架以"测试文件无 FAIL"为判定标准，把全部跳过也计为通过。

真正覆盖 AC-1/2/3/5 的测试在 orchestrator-ux-improvements.test.ts 中，该文件在全量 `npm test` 时确实运行且通过，但在框架的定向 AC 绑定验证流程中没有被正确路由。

**实际影响**：全量 `npm test` 697 tests 全部通过是真实的（exit code 0 可验证）。但框架按 AC 逐条验证的流程存在绑定路由失效，4 个 AC 的框架验证是空操作。

**AC-12 structural 检查**：FAIL。

framework-ac-results.json 显示 AC-12 的 structural 断言结果 detail 为 "File does not exist (pattern trivially absent): mcp/src/orchestrator.ts"。框架以路径相对于项目根解析文件，未找到文件，然后以"pattern trivially absent"判定 passed=true。这意味着 AC-12 的结构性验证（检查 buildTaskForStep 签名是否未改为返回对象）实际上是空操作，未真正读取 orchestrator.ts 内容。

### 2.4 TDD 合规性

N/A。state.json 第 18 行 `"tdd": false`，本次 session 未启用 TDD 模式。

### 2.5 是否有作弊行为

PARTIAL。无主动作弊，但存在测试断言力度不足的问题。

框架检测项（修改 testCmd/buildCmd、@Disabled 跳过预存测试）：PASS。state.json 中 buildCmd 和 testCmd 与 INIT 标记一致；grep 扫描未发现 `it.skip` 或 `describe.skip` 用法。

**测试断言力度不足（非作弊但影响验证有效性）**：

1. AC-15 的测试（orchestrator.test.ts 第 2540-2595 行）声称验证 ALL_APPROACHES_EXHAUSTED 路径，但测试注释明确写"This is a structural test — we verify the implementation added the field"，实际上依赖 build 失败间接触发路径，无法保证真正进入了 ALL_EXHAUSTED 分支而非其他失败分支。且未断言 `status='BLOCKED'`（AC-15 明确要求此条件）。

2. AC-2/AC-3 的测试（orchestrator-ux-improvements.test.ts 第 175-188 行）只调用 `validateResetRequest` 纯函数，未通过 MCP handler 调用 `auto_dev_reset`。若 handler 实现中字段名拼写错误，这些测试无法检测到。Tribunal Phase 4 裁决也标记此为 P1 问题（tribunal-phase4.md 第 8 行）。

---

## 三、踩坑清单

| 严重程度 | Phase | 问题 | 根因 | 修复 |
|---------|-------|------|------|------|
| CRITICAL | 2 | Task 4 调用点描述只写了 1 处（line 679），实际有 3 处，初版计划被判 P0 | Agent 未在代码中 grep 全部调用点，仅参考设计文档中的示例路径 | 计划审查第一轮拦截，要求修订后列全部 3 个调用点 |
| CRITICAL | 5 | 框架 AC 绑定对 AC-1/2/3/5 路由到 fixture 文件，全部 skip 仍判 PASS | 框架按 AC-id 正则匹配测试文件，优先匹配到了旧 fixture 文件 | 未修复，最终靠全量测试通过兜底 |
| CRITICAL | 4 | AC-12 structural 断言文件路径解析失败，判 passed=true 是空操作 | 框架 structural 断言以"文件不存在"等价于"pattern absent"，逻辑错误 | 未修复，AC-12 的结构性保护实际无效 |
| IMPORTANT | 1 | 设计文档中 `step = String(targetPhase)` 与 `firstStepForPhase()` 语义不一致，Phase=1 时结果不同 | 设计时只在 phase=3 这个特殊情况下验证了等价性 | 设计审查第一轮标注 P2-1，计划审查升级为 P1-1 并在测试中补充 phase=1/2 场景 |
| IMPORTANT | 1 | handleValidationFailure 有 5 条 return 路径，设计文档初版未全部枚举 | 代码路径分析不完整 | 设计审查第一轮拦截（P1-3），要求补全路径覆盖表 |
| IMPORTANT | 4 | AC-2/AC-3 测试仅调用纯函数 validateResetRequest，未覆盖 handler 实现 | 测试写法偏向白盒，未通过实际 MCP 调用验证 | Tribunal Phase 4 标注 P1，未在本次 session 内修复 |
| IMPORTANT | 5 | AC-15 未断言 status='BLOCKED'，与 AC 描述不符 | 测试实现者关注 lastFailureDetail 而遗漏了 status 字段断言 | Tribunal Phase 5 标注 P2，未在本次 session 内修复 |
| IMPORTANT | 3 | 实际变更量（917 行）约为设计估算（200 行）的 4.6 倍 | dist/ 构建产物自动纳入 diff；测试代码量远超估算 | 无框架拦截，全程未触发重新确认；应在 Phase 3 前分离 dist/ 和 src 变更统计 |
| IMPORTANT | 4/5 | Phase 4 tribunal 3 次、Phase 5 tribunal 5 次，均依赖 FALLBACK 通过 | Large diff（917 行）超出 tribunal 稳定审查能力；HIGH diff budget 500 行仍不够 | 走 FALLBACK，本次改动（变更规模信号注入）正是为了解决此问题 |

---

## 四、亮点

### 4.1 两阶段审查真实拦截了实质性问题

设计审查第一轮（design-review.md 第一版）和计划审查第一轮（plan-review.md 初版）均真实地发现并拦截了会导致实现错误的问题：
- 设计审查发现 5 条 return 路径遗漏、step 字段写法歧义、`parseInt` key 处理等
- 计划审查发现 Task 4 只列了 1 个调用点（实际有 3 个），这是 P0 级错误，若进入实现阶段会导致 AC-5/6/7 大量失败

两阶段审查机制在本次 session 中发挥了真实的质量门控作用，不是走形式。

### 4.2 测试文件与 AC 覆盖矩阵对应关系清晰

e2e-test-cases.md 中的 AC 绑定矩阵（第 29-47 行）详细列出了每个 AC 对应的具体测试用例 ID（如 AC-5 → U-PARSE-1, I-STEP3-1, I-STEP3-2），测试文件命名遵循规则（U-PARSE-*、U-DIFF-*、U-RESET-*、U-FAIL-*）。在全量测试中这些测试均可追溯。

### 4.3 design.md 的向后兼容性分析完整

design.md 第 5.2 节详细分析了 5 个变更维度的向后兼容性，每条有明确结论（"现有 state.json 无需迁移"、"MCP JSON 序列化忽略 undefined"等）。这种分析防止了对现有功能的意外破坏。

### 4.4 路径激活风险评估（Dormant Path Detection）在设计审查中被正确执行

design-review.md 第 114-116 行专门列出了"未验证路径风险"章节，识别了 handlePhaseRegress 和 handleCircuitBreaker ALL_EXHAUSTED 分支属于偶发路径，历史上从未携带 lastFailureDetail，要求专项 AC（AC-14/AC-15）覆盖。这是对"代码存在 ≠ 代码验证过"原则的正确应用。

---

## 五、改进建议

### 5.1 框架改进：AC 绑定路由应排除 fixture 文件

**问题**：框架按 AC-id 在 testBound 文件中定向执行时，将 `ac-test-binding.test.ts` 和 `ac-integration.test.ts` 纳入候选，这两个文件是框架自身的单元测试，对业务 AC 无覆盖价值。

**建议**：在 AC 绑定查找逻辑中增加 denylist，排除 `ac-*.test.ts` 这类框架内部文件；或要求业务测试文件名必须包含 topic 名称（如 `orchestrator-ux-improvements.test.ts`）才作为首选绑定目标。

### 5.2 框架改进：structural assertion 文件路径解析应相对于 projectRoot

**问题**：AC-12 structural 断言中 path 为 `mcp/src/orchestrator.ts`，框架解析时找不到文件，判定"trivially absent"即为通过，这是逻辑错误。

**建议**：structural 断言执行器应在 projectRoot 下拼接 path；若文件不存在，应返回 FAIL（文件缺失本身就是问题）而非 PASS。

### 5.3 框架改进：全量 skip 的测试文件应触发警告而非判 PASS

**问题**：AC 绑定执行结果中出现"18 tests | 18 skipped"时，框架仍判 passed=true。全部 skip 意味着绑定的测试没有实际运行，不应算作验证通过。

**建议**：在 AC 定向运行模式下，若目标测试文件运行后有效测试数（passed + failed）为 0，应返回 WARNING 或 FAIL，而非以 skip 通过。

### 5.4 变更量偏差检测：实际 diff 超估算应触发确认

**问题**：设计估算 200 行，实际执行后 917 行，但没有任何机制拦截这一偏差。

**建议**：Phase 3 完成时（或 Phase 4 tribunal 前），框架应读取实际 diff 统计并与 design.md 中的估算量对比；若超出 2 倍，自动记录偏差到 progress-log 并可选地要求 orchestrator 说明原因。

### 5.5 测试规范：HIGH-risk AC 应通过 handler 而非纯函数测试

**问题**：AC-2/AC-3（auto_dev_reset 守卫逻辑）仅通过 validateResetRequest 纯函数验证，未通过 MCP handler 调用，无法检测 handler 层的字段名拼写或逻辑错误。

**建议**：对 MCP 工具级别的 AC，测试应直接调用 handler 函数（mock SM 和文件系统），而非抽离纯函数后单独测试。这是"只审生产者不审消费者"反模式在测试层面的体现。

---

## 六、下次 auto-dev 注意事项

1. **计划阶段必须 grep 全部调用点**：凡计划中说"修改 X 的调用点"，必须先在代码中 grep 函数名，确认所有物理位置，一一列出，不能靠印象或设计文档描述。本次 Task 4 的 P0 错误可以通过这一步完全避免。

2. **多分支函数变更必须枚举全路径**：修改 handleValidationFailure、handleCircuitBreaker 等多分支函数时，必须在设计或计划中列出全部 return 路径数量，逐一标注本次是否修改、修改内容。设计文档的 5 条路径表格是正确示范。

3. **AC-15 类测试需验证 status 字段**：测试 BLOCKED 状态的 AC 时，除了验证 lastFailureDetail，必须同时断言 `status === 'BLOCKED'`。一个 AC 的描述中所有条件都要对应测试断言。

4. **dist/ 构建产物应从 diff 统计中排除**：Phase 3 后运行 build 会产生大量 dist/ 变更，这些不属于"实际代码改动量"，在做变更规模评估时应明确排除。

5. **framework-ac-results.json 的 PASS 不等于测试真正运行**：务必检查 framework-ac-results.json 中的 output 字段，若看到大量 skipped 而 passed=true，说明绑定路由失效，需要手动确认全量测试是否涵盖对应 AC。

6. **Tribunal FALLBACK 是信号，不是终点**：Phase 4/5 均走 FALLBACK 说明 tribunal 审查未能正常收敛，可能存在真实问题被掩盖。FALLBACK 通过后应手动审查 tribunal 的具体反馈（tribunal-phase4.md、tribunal-phase5.md），确认无 P0 遗漏。

---

*本报告基于以下文件的交叉验证：progress-log.md、framework-ac-results.json（关键原始证据）、state.json（tribunalSubmits 字段）、tribunal-phase4/5/6.md、orchestrator-ux-improvements.test.ts（实际测试代码）*
