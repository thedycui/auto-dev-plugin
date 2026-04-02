# Implementation Plan: executable-ac

> 基于设计文档 `design.md`（方案 D：混合 B+C，双层可执行 AC）
> 总任务数：14  
> 关键路径：Task 1 → Task 3 → Task 5 → Task 7 → Task 7a → Task 11 → Task 12

---

## Task 1: 创建 AC Schema 定义文件 (`ac-schema.ts`)

- **描述**: 新建 `mcp/src/ac-schema.ts`，定义 AC JSON 的 Zod schema（`AssertionTypeSchema`、`AcceptanceCriterionSchema`、`AcceptanceCriteriaSchema`）和 `computeAcHash()` 函数。包括 7 种断言类型的 discriminatedUnion、criterion 的 id/description/layer/structuralAssertions 结构、version 字段、以及基于 criteria 关键字段的 SHA-256 hash 计算。
- **文件**:
  - 新建: `mcp/src/ac-schema.ts`
- **依赖**: 无
- **完成标准**: 
  - `AcceptanceCriteriaSchema` 能正确 parse 设计文档中示例 JSON
  - `computeAcHash()` 对相同输入产生稳定的 32 字符 hex 字符串
  - TypeScript 编译通过

## Task 2: 创建 Structural 断言执行引擎 (`ac-runner.ts`)

- **描述**: 新建 `mcp/src/ac-runner.ts`，实现 `runStructuralAssertions()` 函数。对每条 `layer: "structural"` 的 AC，逐条执行其 `structuralAssertions` 数组中的断言。支持的断言类型：`file_exists`（支持 glob）、`file_not_exists`、`file_contains`（regex）、`file_not_contains`、`config_value`（JSON/YAML 点分隔 key 查找）、`build_succeeds`、`test_passes`。每条断言返回 `{ passed: boolean; detail: string }`。整体返回 `Record<string, { passed: boolean; details: AssertionResult[] }>`。
- **文件**:
  - 新建: `mcp/src/ac-runner.ts`
- **依赖**: Task 1
- **完成标准**:
  - `file_exists` 对存在的文件返回 passed=true，对不存在的文件返回 passed=false
  - `file_contains` 使用正则匹配文件内容
  - `config_value` 能解析 JSON 文件的点分隔路径
  - 所有断言类型不执行任意 shell 命令（`build_succeeds` 和 `test_passes` 除外，这两个使用受控的 `execFile`）

## Task 3: 创建 AC 测试绑定发现与运行模块 (`ac-test-binding.ts`)

- **描述**: 新建 `mcp/src/ac-test-binding.ts`，实现三个核心函数：(1) `discoverAcBindings()` — 通过 grep 扫描测试文件中的 `[AC-N]` 标注，支持 Java/Node/Python 三种语言的正则模式；(2) `validateAcBindingCoverage()` — 检查所有 `layer: "test-bound"` 的 AC 是否都有对应绑定；(3) `runAcBoundTests()` — 对每条绑定运行针对性测试命令并收集结果。内部使用 `buildTargetedTestCommand()` 按语言生成测试命令（Maven `-Dtest`、Vitest `--testPathPattern`、pytest `-k`）。
- **文件**:
  - 新建: `mcp/src/ac-test-binding.ts`
- **依赖**: Task 1
- **完成标准**:
  - `discoverAcBindings()` 能从 `test("[AC-1] desc", ...)` 格式中提取 acId="AC-1"
  - `validateAcBindingCoverage()` 正确识别 missing 和 extra bindings
  - `buildTargetedTestCommand()` 为 node 语言生成包含 `--testPathPattern` 的命令

## Task 4: ac-schema 和 ac-runner 单元测试

- **描述**: 为 Task 1、Task 2 的代码编写单元测试。测试 schema 解析（合法/非法输入）、hash 稳定性、各断言类型的执行逻辑（使用临时文件系统 mock）。
- **文件**:
  - 新建: `mcp/src/__tests__/ac-schema.test.ts`
  - 新建: `mcp/src/__tests__/ac-runner.test.ts`
- **依赖**: Task 1, Task 2
- **完成标准**:
  - 覆盖全部 7 种断言类型的正向和负向场景
  - Schema parse 测试覆盖合法 JSON、缺少必填字段、非法 layer 值
  - `computeAcHash` 测试验证相同输入产生相同输出、不同输入产生不同输出
  - 所有测试通过

## Task 5: ac-test-binding 单元测试

- **描述**: 为 Task 3 的代码编写单元测试。测试绑定发现的正则匹配（Java/Node/Python 各语言格式）、覆盖率检查逻辑、测试命令生成。
- **文件**:
  - 新建: `mcp/src/__tests__/ac-test-binding.test.ts`
- **依赖**: Task 3
- **完成标准**:
  - Java 的 `@DisplayName("[AC-1]...")` 和 `void AC1_method()` 两种格式都能被发现
  - Node 的 `test("[AC-1]...")` 和 `describe("AC-1: ...")` 两种格式都能被发现
  - `validateAcBindingCoverage` 正确返回 covered/missing/extraBindings
  - 所有测试通过

## Task 6: Phase 1 checkpoint 增加 AC JSON 校验 (`index.ts`)

- **描述**: 在 `mcp/src/index.ts` 的 `phase === 1 && status === "PASS"` 分支中增加 AC JSON 校验逻辑：(1) 尝试读取 `acceptance-criteria.json`；(2) 若存在则 schema 校验；(3) manual 占比检查（>40% 则 BLOCKED）；(4) 计算 hash 写入 progress-log（`AC_LOCK` 标记）；(5) 若不存在但 design.md 含 AC 表格且为 auto-dev 自生成则 BLOCKED。同时在 `types.ts` 中 export AC 相关类型。
- **文件**:
  - 修改: `mcp/src/index.ts`（Phase 1 checkpoint 分支）
  - 修改: `mcp/src/types.ts`（re-export AC schema types）
- **依赖**: Task 1
- **完成标准**:
  - 合法 AC JSON 通过校验并在 progress-log 中写入 `AC_LOCK` 标记
  - manual 占比 > 40% 时返回 `AC_MANUAL_RATIO_TOO_HIGH` 错误
  - 缺少 AC JSON 但 design.md 有 AC 表格时返回 `AC_JSON_MISSING`
  - 无 AC JSON 且无 AC 表格时不阻断（向后兼容）

## Task 6a: phase-enforcer.ts 增加 AC 校验函数

- **描述**: 在 `mcp/src/phase-enforcer.ts` 中新增两个函数：(1) `validateAcJson()` — 校验 acceptance-criteria.json 的 schema 合法性 + manual 占比 ≤ 40% 检查，供 Phase 1 checkpoint 调用；(2) `validateAcIntegrity()` — hash 防篡改校验，从 progress-log 读取 AC_LOCK 并与当前 AC JSON 比对，供 Phase 6 执行前调用。
- **文件**:
  - 修改: `mcp/src/phase-enforcer.ts`
- **依赖**: Task 1
- **完成标准**:
  - `validateAcJson()` 对合法 AC JSON 返回 valid=true，对 schema 不合法或 manual 占比过高的返回 valid=false 及具体原因
  - `validateAcIntegrity()` 在 hash 匹配时返回 valid=true，不匹配时返回 valid=false 及篡改提示
  - Task 6 的 index.ts 中 Phase 1 校验逻辑调用 `validateAcJson()` 而非内联实现
  - TypeScript 编译通过

## Task 7: Phase 6 orchestrator 增加框架自动执行逻辑 (`orchestrator.ts`)

- **描述**: 重构 `orchestrator.ts` 的 `case "6"` 分支。在调用 `evaluateTribunal` 之前插入：(1) 读取 `acceptance-criteria.json`；(2) 调用 `validateAcIntegrity()` hash 防篡改校验；(3) 调用 `validateAcBindingCoverage()` 检查 test-bound AC 绑定覆盖率（missing 不为空时返回 BLOCKED 提示回退 Phase 5，或允许降级为 manual 并记录降级原因）；(4) 调用 `runStructuralAssertions()` 执行 Layer 1 断言；(5) 调用 `discoverAcBindings()` + `runAcBoundTests()` 执行 Layer 2 测试；(6) 写入 `framework-ac-results.json`；(7) structural/test-bound 有 FAIL 则调用 acceptance-validator Agent 分析后短路返回失败。无 AC JSON 时走原有 Tribunal 流程（向后兼容）。
- **文件**:
  - 修改: `mcp/src/orchestrator.ts`（case "6" 分支）
- **依赖**: Task 1, Task 2, Task 3, Task 6a
- **完成标准**:
  - 有 AC JSON 时：先执行框架验证再进入 Tribunal
  - 无 AC JSON 时：走原有 Tribunal 流程
  - hash 不匹配时返回 BLOCKED 反馈
  - test-bound AC 绑定缺失时返回 BLOCKED 或降级为 manual
  - structural/test-bound FAIL 时调用 Agent 分析后短路返回失败
  - `framework-ac-results.json` 正确写入

## Task 7a: index.ts Phase 6 submit 兜底路径增加 AC 框架执行

- **描述**: 在 `mcp/src/index.ts` 的 `auto_dev_submit(phase=6)` handler 中（非 orchestrator 模式兜底），在现有 tribunal 调用之前插入与 Task 7 相同的 AC 框架执行逻辑（hash 校验 → structural 断言 → test-bound 测试 → 写 framework-ac-results.json → FAIL 短路），返回格式改为 `textResult`。
- **文件**:
  - 修改: `mcp/src/index.ts`（`auto_dev_submit` Phase 6 handler）
- **依赖**: Task 7
- **完成标准**:
  - 非 orchestrator 模式下 Phase 6 submit 执行 AC 框架验证
  - 有 AC JSON + FAIL 时返回 textResult 格式的错误信息
  - 无 AC JSON 时走原有 tribunal 流程
  - TypeScript 编译通过

## Task 8: Phase 6 tribunal checklist 增强 (`tribunal-checklists.ts`)

- **描述**: 更新 `tribunal-checklists.ts` 中的 Phase 6 checklist，增加框架自动验证（A 节）、AC 绑定完整性（B 节）、Manual AC 验证（C 节）、输出要求（D 节）四大板块。替换现有 Phase 6 checklist。
- **文件**:
  - 修改: `mcp/src/tribunal-checklists.ts`
- **依赖**: 无
- **完成标准**:
  - Phase 6 checklist 包含框架自动验证最高权重的审查项
  - 包含 "Layer 1/2 有 FAIL → 直接 FAIL" 规则
  - 包含 manual AC 的独立审查板块

## Task 9: Prompt 模板更新（Phase 1 / Phase 5 / Phase 6）

- **描述**: 更新三个 prompt 文件：(1) `phase1-architect.md` — 增加 `acceptance-criteria.json` 编写指南，包括 layer 分类说明、断言类型白名单、示例 JSON、manual ≤ 40% 约束；(2) `phase5-test-architect.md` — 增加 AC 绑定规范（[AC-N] 标注格式、AC 绑定矩阵模板）、未绑定导致 Phase 6 preflight 失败的警告；(3) `phase6-acceptance.md` — 重构为三层验证流程，明确 Agent 只负责 manual AC 和 FAIL 分析。
- **文件**:
  - 修改: `skills/auto-dev/prompts/phase1-architect.md`
  - 修改: `skills/auto-dev/prompts/phase5-test-architect.md`
  - 修改: `skills/auto-dev/prompts/phase6-acceptance.md`
- **依赖**: 无
- **完成标准**:
  - `phase1-architect.md` 包含 acceptance-criteria.json 编写指南和示例
  - `phase5-test-architect.md` 包含 AC 绑定规范和绑定矩阵模板
  - `phase6-acceptance.md` 包含三层验证流程和更新后的输出格式

## Task 10: Checklist 和 Agent prompt 更新

- **描述**: 更新两个文件：(1) `skills/auto-dev/checklists/design-review.md` — 增加 "F. 结构化 AC 审查" 板块（5 条检查项）；(2) `agents/auto-dev-acceptance-validator.md` — 更新 Agent 职责为仅负责 Layer 3 (manual) AC 和 FAIL 分析。
- **文件**:
  - 修改: `skills/auto-dev/checklists/design-review.md`
  - 修改: `agents/auto-dev-acceptance-validator.md`
- **依赖**: 无
- **完成标准**:
  - `design-review.md` 包含 acceptance-criteria.json schema 合法性、layer 标注完整性、manual 占比 ≤ 40% 等检查项
  - `acceptance-validator.md` 明确 Agent 不再重复验证 Layer 1/2 的 PASS 项

## Task 11: Phase 6 orchestrator 集成测试

- **描述**: 编写集成测试验证 Phase 6 完整流程。测试场景：(1) 有 AC JSON + 全部 PASS → 进入 Tribunal；(2) 有 AC JSON + structural FAIL → 调用 Agent 分析后短路返回失败；(3) 有 AC JSON + hash 不匹配 → BLOCKED；(4) 无 AC JSON → 走旧流程（向后兼容）；(5) test-bound AC 缺少绑定 → 报错提示；(6) index.ts 兜底路径：有 AC JSON + 全部 PASS → 走兜底路径成功。使用 mock 文件系统和 mock shell 命令。
- **文件**:
  - 新建或扩展: `mcp/src/__tests__/ac-integration.test.ts`
- **依赖**: Task 7, Task 7a
- **完成标准**:
  - 6 个核心场景全部覆盖（含 index.ts 兜底路径）
  - 向后兼容场景（无 AC JSON）通过
  - 所有测试通过

## Task 12: 编译验证与 SKILL.md 更新

- **描述**: (1) 全量编译确认无 TypeScript 错误；(2) 运行全部测试确认无回归；(3) 更新 `skills/auto-dev/SKILL.md` 中 Phase 6 流程描述，反映三层验证机制。
- **文件**:
  - 修改: `skills/auto-dev/SKILL.md`
- **依赖**: Task 1-11 全部完成
- **完成标准**:
  - `npm run build`（或 `tsc`）零错误
  - `npm test` 全部通过（含新增测试）
  - SKILL.md Phase 6 描述包含 structural/test-bound/manual 三层验证说明
