# 可执行验收标准设计文档（方案 D：混合 B+C）

> 灵感来源：Karpathy autoresearch — "锁死尺子"
> 日期：2026-03-26
> 状态：设计草案

## 一、背景与动机

### 1.1 问题现状

当前 Phase 6（ACCEPTANCE）的验证流程：

```
design.md 中自然语言 AC
  → acceptance-validator Agent 读代码"看一看"
    → 主观判断 PASS/FAIL
      → Tribunal 审查判断是否可信
```

三个弱点：
1. **Agent 验证是模拟的**：它说"我读了代码，确认 AC-1 满足"，但没有执行任何东西
2. **Tribunal 也是主观的**：Phase 6 的 checklist 只有 4 条，远不如 Phase 4/5 严格
3. **Developer Agent 可以"适配" AC**：因为 AC 是自然语言，写出表面满足但实质不满足的代码

### 1.2 设计目标

借鉴 autoresearch 的"prepare.py 不可修改"思想：**让尽可能多的 AC 由框架自动验证，而非 Agent 主观判断**。

## 二、核心设计：双层可执行 AC

### 2.1 AC 分类

每条 AC 根据其性质，分为三层验证：

| 层 | AC 类型 | 产出阶段 | 验证方式 | 示例 |
|----|---------|---------|---------|------|
| **Layer 1** | structural | Phase 1（Architect） | 框架执行预定义断言 | 文件存在、配置包含特定值 |
| **Layer 2** | test-bound | Phase 5（Test Architect） | 框架运行标注的测试 | `@AC-1` 标注的测试方法 |
| **Layer 3** | manual | — | Tribunal 审查 | 代码可读性、架构合理性 |

**关键约束**：Layer 1 + Layer 2 覆盖的 AC 占比不得低于 60%。

### 2.2 为什么不用方案 A（Agent 直接生成 shell command）

| 风险 | 方案 A | 方案 D |
|------|-------|-------|
| Architect 写的 command 路径错误 | 高 | 无（structural 断言由框架解释执行） |
| Architect 写的 command 不可移植 | 高 | 无（断言类型是跨平台的） |
| Agent 写出语法错误的 JSON | 中 | 低（structural JSON 结构极简、类型固定） |
| 需要 Architect 精通 shell | 是 | 否 |
| 测试代码重复编写 | 是（AC 测试 + Phase 5 测试重复） | 否（复用 Phase 5 测试） |

## 三、Layer 1：Structural 断言

### 3.1 断言类型白名单

框架只接受以下预定义断言类型，不执行任意命令：

```typescript
// ac-schema.ts

export const AssertionTypeSchema = z.discriminatedUnion("type", [
  // 文件存在检查（支持 glob）
  z.object({
    type: z.literal("file_exists"),
    path: z.string(),  // 支持 glob，如 "src/main/java/**/RetryConfig.java"
  }),

  // 文件不存在（验证删除操作）
  z.object({
    type: z.literal("file_not_exists"),
    path: z.string(),
  }),

  // 文件包含特定内容（regex）
  z.object({
    type: z.literal("file_contains"),
    path: z.string(),
    pattern: z.string(),  // 正则表达式
  }),

  // 文件不包含特定内容（验证移除操作）
  z.object({
    type: z.literal("file_not_contains"),
    path: z.string(),
    pattern: z.string(),
  }),

  // JSON/YAML 字段值检查
  z.object({
    type: z.literal("config_value"),
    path: z.string(),         // 配置文件路径
    key: z.string(),          // 点分隔的 key，如 "spring.retry.max-attempts"
    expectedValue: z.string(), // 期望值
  }),

  // 编译通过
  z.object({
    type: z.literal("build_succeeds"),
  }),

  // 指定测试通过
  z.object({
    type: z.literal("test_passes"),
    testFile: z.string().optional(),   // 测试文件路径
    testName: z.string().optional(),   // 测试方法名
  }),
]);
```

**安全性**：没有 `shell_command` 类型。所有断言由框架内部实现，不存在命令注入风险。

### 3.2 AC 结构化文件格式

Phase 1 Architect 在 design.md 的验收标准表格之外，额外产出 `acceptance-criteria.json`：

```json
{
  "version": 1,
  "criteria": [
    {
      "id": "AC-1",
      "description": "传入空列表时返回 400 错误码",
      "layer": "test-bound",
      "structuralAssertions": null,
      "note": "需在 Phase 5 绑定测试用例"
    },
    {
      "id": "AC-2",
      "description": "新增配置项 max-retry 默认值为 3",
      "layer": "structural",
      "structuralAssertions": [
        { "type": "file_exists", "path": "src/main/resources/application.yml" },
        { "type": "file_contains", "path": "src/main/resources/application.yml", "pattern": "max-retry:\\s*3" }
      ]
    },
    {
      "id": "AC-3",
      "description": "新模块与现有模块代码风格一致",
      "layer": "manual",
      "structuralAssertions": null
    }
  ]
}
```

**Architect 的负担极小**：
- `layer: "test-bound"` 的 AC 不需要写任何断言，只声明"Phase 5 会绑定测试"
- `layer: "structural"` 只需要写 `file_exists` + `file_contains`，这是最简单的 JSON
- `layer: "manual"` 只声明，不需要额外产出

### 3.3 防篡改机制

与资源约束设计文档中的 INIT marker 防篡改机制同构：

```
Phase 1 PASS 时：
  1. 框架验证 acceptance-criteria.json 的 schema 合法性
  2. 框架验证 layer 占比（manual ≤ 40%）
  3. 框架计算 SHA-256 hash → 写入 progress-log
     <!-- AC_LOCK hash=sha256:xxxx total=5 structural=2 testBound=2 manual=1 -->
  4. hash 覆盖范围：全部 criteria 的 id + layer + structuralAssertions

Phase 6 执行前：
  1. 重新读取 acceptance-criteria.json
  2. 重新计算 hash
  3. 与 progress-log 中 AC_LOCK 记录比对
  4. 不匹配 → BLOCKED："AC 文件已被篡改"
```

## 四、Layer 2：测试绑定（Test Binding）

### 4.1 AC 标注规范

Phase 5 test-architect/developer 在编写测试时，为每条 `layer: "test-bound"` 的 AC 标注对应测试：

**Java（JUnit 5）**：
```java
// 方式 1：@DisplayName 前缀（推荐，无需自定义注解）
@Test
@DisplayName("[AC-1] 传入空列表时返回 400 错误码")
void shouldReturn400WhenListIsEmpty() { ... }

// 方式 2：方法名前缀
@Test
void AC1_shouldReturn400WhenListIsEmpty() { ... }
```

**TypeScript/JavaScript（Jest/Vitest）**：
```typescript
// test 描述中标注
test("[AC-1] should return 400 when list is empty", () => { ... });

// 或 describe 块
describe("AC-1: empty list validation", () => {
  test("returns 400", () => { ... });
});
```

**Python（pytest）**：
```python
# 方式 1：函数名前缀
def test_ac1_empty_list_returns_400():
    ...

# 方式 2：pytest.mark（需要注册 marker）
@pytest.mark.ac("AC-1")
def test_empty_list_returns_400():
    ...
```

### 4.2 绑定发现机制

Phase 6 框架通过以下方式发现 AC↔测试 的绑定关系：

```typescript
// ac-test-binding.ts

export interface AcTestBinding {
  acId: string;           // "AC-1"
  testFile: string;       // 相对路径
  testName: string;       // 方法名或 describe/test 名
  language: string;       // java/node/python
}

/**
 * 扫描项目中的测试文件，提取 AC 标注。
 * 使用 grep 而非 AST 解析——简单、跨语言、不依赖编译。
 */
export async function discoverAcBindings(
  projectRoot: string,
  language: string,
  additionalRepos?: Array<{ path: string; alias: string }>,
): Promise<AcTestBinding[]> {
  const bindings: AcTestBinding[] = [];

  // 定义扫描模式
  const patterns: Record<string, RegExp> = {
    java: /(?:@DisplayName\s*\(\s*")\[AC-(\d+)\]|void\s+AC(\d+)_/,
    node: /(?:test|it|describe)\s*\(\s*["'`]\[AC-(\d+)\]/,
    python: /def\s+test_ac(\d+)_|@pytest\.mark\.ac\s*\(\s*["']AC-(\d+)/,
  };

  const pattern = patterns[language];
  if (!pattern) return bindings;

  // 扫描所有 repo（projectRoot + additionalRepos）
  const roots = [projectRoot, ...(additionalRepos ?? []).map(r => r.path)];

  for (const root of roots) {
    // grep -rn 搜索 AC 标注
    const grepResult = await execGrepForAcTags(root, pattern);
    bindings.push(...grepResult);
  }

  return bindings;
}
```

### 4.3 绑定完整性检查

Phase 6 preflight 时，框架检查所有 `layer: "test-bound"` 的 AC 是否都有对应绑定：

```typescript
export function validateAcBindingCoverage(
  criteria: AcceptanceCriteria[],
  bindings: AcTestBinding[],
): { covered: string[]; missing: string[]; extraBindings: string[] } {
  const testBoundAcs = criteria
    .filter(c => c.layer === "test-bound")
    .map(c => c.id);

  const boundAcIds = new Set(bindings.map(b => b.acId));

  const covered = testBoundAcs.filter(id => boundAcIds.has(id));
  const missing = testBoundAcs.filter(id => !boundAcIds.has(id));

  // 额外绑定（测试标注了 AC-N 但 AC JSON 中没有这个 ID）
  const allAcIds = new Set(criteria.map(c => c.id));
  const extraBindings = [...boundAcIds].filter(id => !allAcIds.has(id));

  return { covered, missing, extraBindings };
}
```

**missing 不为空时的处理**：
- Phase 6 preflight 返回 `ready: false`
- 提示：`AC-1 标记为 test-bound 但 Phase 5 未绑定测试。请回退 Phase 5 补充 [AC-1] 标注的测试。`
- 或：允许 acceptance-validator Agent 将 missing 的 AC 降级为 manual 验证（记录降级原因）

### 4.4 测试运行

对已绑定的 AC，框架直接运行对应测试：

```typescript
export async function runAcBoundTests(
  bindings: AcTestBinding[],
  projectRoot: string,
  language: string,
  testCmd: string,
): Promise<Map<string, { passed: boolean; output: string }>> {
  const results = new Map<string, { passed: boolean; output: string }>();

  // 按 testFile 分组，避免重复启动测试框架
  const byFile = groupBy(bindings, b => b.testFile);

  for (const [testFile, fileBindings] of byFile) {
    // 构建针对特定测试文件/方法的命令
    const cmd = buildTargetedTestCommand(language, testFile, fileBindings, projectRoot);

    const { exitCode, stdout, stderr } = await execWithTimeout(cmd, {
      cwd: projectRoot,
      timeout: 120_000,  // 单个 AC 测试最多 2 分钟
    });

    for (const binding of fileBindings) {
      results.set(binding.acId, {
        passed: exitCode === 0,
        output: (stdout + stderr).slice(0, 500),
      });
    }
  }

  return results;
}

function buildTargetedTestCommand(
  language: string,
  testFile: string,
  bindings: AcTestBinding[],
  projectRoot: string,
): string {
  switch (language) {
    case "java":
      // Maven: -Dtest=ClassName#methodName
      const className = testFile.replace(/.*\//, "").replace(".java", "");
      const methods = bindings.map(b => b.testName).join("+");
      return `cd ${projectRoot} && mvn test -Dtest=${className}#${methods} -pl . -q`;

    case "node":
      // Jest/Vitest: --testPathPattern + --testNamePattern
      const namePattern = bindings.map(b => escapeRegex(b.testName)).join("|");
      return `cd ${projectRoot} && npx vitest run ${testFile} -t "${namePattern}"`;

    case "python":
      // pytest: -k pattern
      const kPattern = bindings.map(b => b.testName).join(" or ");
      return `cd ${projectRoot} && python -m pytest ${testFile} -k "${kPattern}" -v`;

    default:
      return `cd ${projectRoot} && ${testFile}`;  // fallback
  }
}
```

## 五、Phase 6 重构后的完整流程

```
Phase 6 (ACCEPTANCE) — 新流程:

1. preflight(phase=6):
   ├─ 检查 acceptance-criteria.json 存在
   ├─ hash 与 AC_LOCK 一致（防篡改校验）
   ├─ 检查 test-bound AC 的绑定覆盖率
   └─ 返回 ready + acSummary

2. 框架自动执行 Layer 1（structural 断言）:
   ├─ 读取 acceptance-criteria.json
   ├─ 对每条 layer="structural" 的 AC：
   │   ├─ 逐条执行 structuralAssertions
   │   └─ 记录 PASS / FAIL + 详细诊断
   └─ 产出 framework-ac-structural.json

3. 框架自动执行 Layer 2（test-bound 测试）:
   ├─ discoverAcBindings() 扫描 AC 标注
   ├─ 对每条 layer="test-bound" 的 AC：
   │   ├─ 找到绑定的测试方法
   │   ├─ 运行测试，捕获 exit code
   │   └─ 记录 PASS / FAIL + 测试输出
   └─ 产出 framework-ac-testbound.json

4. 合并框架结果:
   └─ framework-ac-results.json:
      {
        "structural": { "AC-2": { "passed": true, "details": [...] } },
        "testBound": { "AC-1": { "passed": true, "testOutput": "..." } },
        "pendingManual": ["AC-3"],
        "summary": { "total": 3, "autoPassed": 2, "autoFailed": 0, "manual": 1 }
      }

5. 调用 acceptance-validator Agent:
   ├─ 只负责 layer="manual" 的 AC（读代码主观判断）
   ├─ 审查框架 FAIL 项（是 AC 定义不准还是代码没实现？）
   └─ 产出 acceptance-report.md

6. auto_dev_submit(phase=6) → Tribunal:
   ├─ Tribunal 读取 framework-ac-results.json（硬数据）
   ├─ Layer 1/2 有 FAIL → 直接 TRIBUNAL_FAIL（不管 Agent 怎么说）
   ├─ manual AC → Tribunal 独立审查
   └─ TRIBUNAL_PASS / TRIBUNAL_FAIL
```

## 六、对现有 Prompt 和 Agent 的改动

### 6.1 Phase 1 Architect prompt 改动

在 `phase1-architect.md` 的 Design Document Structure 第 7 项之后增加：

```markdown
8. **结构化验收标准** — 在写入 design.md 的同时，将 AC 以结构化格式写入 `{output_dir}/acceptance-criteria.json`

### acceptance-criteria.json 编写指南

每条 AC 需要指定验证层级：
- `structural`：可以通过文件检查、配置值检查验证的 AC → 必须写 structuralAssertions
- `test-bound`：需要通过运行测试验证的功能行为 AC → Phase 5 会绑定测试，此处无需写断言
- `manual`：无法自动验证的 AC（架构合理性、代码风格等）

**约束**：`manual` 占比不得超过 40%。

structural 断言可用类型：
- `file_exists`：检查文件存在（支持 glob）
- `file_not_exists`：检查文件已删除
- `file_contains`：检查文件包含特定内容（正则表达式）
- `file_not_contains`：检查文件不包含特定内容
- `config_value`：检查配置文件中的键值
- `build_succeeds`：编译通过
- `test_passes`：指定测试通过

示例：
```json
{
  "version": 1,
  "criteria": [
    {
      "id": "AC-1",
      "description": "传入空列表时返回 400 错误码",
      "layer": "test-bound"
    },
    {
      "id": "AC-2",
      "description": "新增配置项 max-retry 默认值为 3",
      "layer": "structural",
      "structuralAssertions": [
        { "type": "file_contains", "path": "src/main/resources/application.yml", "pattern": "max-retry:\\s*3" }
      ]
    }
  ]
}
```
```

### 6.2 Phase 1 Design Review checklist 改动

在 `design-review.md` 增加：

```markdown
## F. 结构化 AC 审查
- [ ] acceptance-criteria.json 文件已生成且 schema 合法？
- [ ] 每条 AC 都有 layer 标注（structural / test-bound / manual）？
- [ ] structural 类型的 AC 断言是否合理（path 是否可能存在、pattern 是否正确）？
- [ ] manual 占比是否 ≤ 40%？
- [ ] test-bound 类型的 AC 描述是否足够具体，让 Phase 5 能写出对应测试？
```

### 6.3 Phase 5 Test Architect prompt 改动

在 `phase5-test-architect.md` 的 Requirements 中增加：

```markdown
5. 读取 `{output_dir}/acceptance-criteria.json`，对所有 `layer: "test-bound"` 的 AC：
   - 为每条 AC 设计至少一个对应测试用例
   - 在测试用例标题中标注 `[AC-N]` 前缀

## AC 绑定规范

每个 `layer: "test-bound"` 的 AC 必须在测试代码中有对应标注：

**Java**: `@DisplayName("[AC-1] 描述")` 或方法名 `AC1_methodName`
**TypeScript**: `test("[AC-1] description", ...)` 或 `describe("AC-1: ...", ...)`
**Python**: `def test_ac1_description():` 或 `@pytest.mark.ac("AC-1")`

Phase 6 框架会自动扫描这些标注并运行对应测试，作为 AC 的自动验证。
**未绑定测试的 test-bound AC 会导致 Phase 6 preflight 失败。**
```

在覆盖矩阵后新增 AC 绑定矩阵：

```markdown
## AC 绑定矩阵

| AC | 描述 | 绑定测试 | 测试文件 |
|----|------|---------|---------|
| AC-1 | 传入空列表时返回 400 | TC-3: [AC-1] shouldReturn400... | UserServiceTest.java |
| AC-2 | max-retry 默认值为 3 | (structural, 无需绑定) | — |
| AC-3 | 代码风格一致 | (manual, 无需绑定) | — |
```

### 6.4 Phase 6 Acceptance Validator 改动

更新 `agents/auto-dev-acceptance-validator.md`：

```markdown
## 验证方式（更新）

Phase 6 采用三层验证，你只负责 Layer 3（manual）和 FAIL 分析：

1. **Layer 1 (structural)**: 框架已自动执行，结果在 framework-ac-results.json 中
2. **Layer 2 (test-bound)**: 框架已自动运行测试，结果在 framework-ac-results.json 中
3. **Layer 3 (manual)**: 你需要读代码主观判断

你的职责：
- 逐条验证 `layer: "manual"` 的 AC
- 审查 framework-ac-results.json 中 FAIL 的项目（判断是 AC 定义不准还是代码有缺陷）
- 如果发现框架 FAIL 但代码实际满足（AC 定义有问题），在报告中注明
```

### 6.5 Phase 6 Acceptance prompt 改动

更新 `phase6-acceptance.md`：

```markdown
## Requirements（更新）

1. 读取 `{output_dir}/framework-ac-results.json`（框架自动验证结果）
2. 对 Layer 1/2 的 PASS 项：在报告中直接引用框架结果，不需要重复验证
3. 对 Layer 1/2 的 FAIL 项：分析原因（AC 定义不准 vs 代码缺陷）
4. 对 Layer 3 (manual) 的 AC：执行代码验证 / 测试验证
5. 将验收报告写入 `{output_dir}/acceptance-report.md`

## 输出格式（更新）

| AC | 层级 | 描述 | 验证方式 | 结果 | 证据 |
|----|------|------|---------|------|------|
| AC-1 | test-bound | ... | 框架运行测试 | PASS | [AC-1] shouldReturn400... ✅ |
| AC-2 | structural | ... | 框架断言检查 | PASS | file_contains: ✅ |
| AC-3 | manual | ... | 代码审查 | PASS | 对比 UserService.java 与 OrderService.java 结构 |
```

## 七、Tribunal checklist 改动

更新 `tribunal-checklists.ts` 的 Phase 6 checklist：

```typescript
const PHASE_6_CHECKLIST = `## 裁决检查清单（Phase 6: 验收裁决）

> ${ANTI_LENIENCY}

### A. 框架自动验证（硬数据，最高权重）
- [ ] 读取 framework-ac-results.json
- [ ] Layer 1 (structural) 有 FAIL 项？→ 直接 FAIL（除非 Agent 给出充分的 AC 定义缺陷证据）
- [ ] Layer 2 (test-bound) 有 FAIL 项？→ 直接 FAIL（测试不通过 = AC 未满足）
- [ ] 框架 PASS 项与 Agent 报告一致？不一致则以框架结果为准

### B. AC 绑定完整性
- [ ] 所有 test-bound AC 是否都有绑定测试？
- [ ] 是否有 AC 被降级为 manual？如果有，降级理由是否充分？
- [ ] structural 断言是否覆盖了 AC 描述的关键点？

### C. Manual AC 验证
- [ ] 从 design.md 中提取 manual AC
- [ ] Agent 的主观判断是否有充分的代码证据？
- [ ] SKIP 必须有合理理由

### D. 输出要求
- AC 验证表（含层级、验证方式、框架结果引用）
- 框架 FAIL 分析（如有）
`;
```

## 八、MCP 层改动

### 8.1 Phase 1 checkpoint 新增校验

在 `index.ts` 的 checkpoint handler，`phase === 1 && status === "PASS"` 分支中增加：

```typescript
// Phase 1 AC JSON pre-validation
if (phase === 1 && status === "PASS") {
  // ... 现有 design-review.md 校验 ...

  // 新增：验证 acceptance-criteria.json
  let acContent: string | null = null;
  try {
    acContent = await readFile(join(sm.outputDir, "acceptance-criteria.json"), "utf-8");
  } catch { /* file doesn't exist */ }

  if (acContent) {
    // 1. Schema 校验
    const parseResult = AcceptanceCriteriaSchema.safeParse(JSON.parse(acContent));
    if (!parseResult.success) {
      return textResult({
        error: "AC_SCHEMA_INVALID",
        message: `acceptance-criteria.json schema 校验失败: ${parseResult.error.message}`,
        mandate: "[BLOCKED] AC JSON schema 不合法。",
      });
    }

    // 2. manual 占比检查
    const criteria = parseResult.data.criteria;
    const manualCount = criteria.filter(c => c.layer === "manual").length;
    const manualRatio = manualCount / criteria.length;
    if (manualRatio > 0.4) {
      return textResult({
        error: "AC_MANUAL_RATIO_TOO_HIGH",
        message: `manual AC 占比 ${Math.round(manualRatio * 100)}%（${manualCount}/${criteria.length}），超过 40% 上限。` +
          `请将更多 AC 转为 structural 或 test-bound。`,
        mandate: "[BLOCKED] manual AC 占比过高。",
      });
    }

    // 3. 计算 hash 写入 progress-log
    const { createHash } = await import("node:crypto");
    const acHash = createHash("sha256")
      .update(JSON.stringify(criteria.map(c => ({
        id: c.id,
        layer: c.layer,
        structuralAssertions: c.structuralAssertions,
      }))))
      .digest("hex")
      .slice(0, 16);

    const structuralCount = criteria.filter(c => c.layer === "structural").length;
    const testBoundCount = criteria.filter(c => c.layer === "test-bound").length;

    await sm.appendToProgressLog(
      `<!-- AC_LOCK hash=${acHash} total=${criteria.length} ` +
      `structural=${structuralCount} testBound=${testBoundCount} manual=${manualCount} -->\n`
    );
  }
  // 如果 acceptance-criteria.json 不存在：向后兼容，不阻断
  // Phase 6 检测到无 AC JSON 时退化为纯 Agent 验证（现有流程）
}
```

### 8.2 Phase 6 新增框架自动执行逻辑

在 `auto_dev_submit(phase=6)` 的 tribunal 调用之前，插入框架执行步骤：

```typescript
// Phase 6 submit 前置处理
if (phase === 6) {
  const acJsonPath = join(sm.outputDir, "acceptance-criteria.json");
  let acContent: string | null = null;
  try {
    acContent = await readFile(acJsonPath, "utf-8");
  } catch { /* no AC JSON → legacy flow */ }

  if (acContent) {
    // 1. Hash 校验
    const progressLog = await readFile(join(sm.outputDir, "progress-log.md"), "utf-8");
    const acLockMatch = progressLog.match(/<!-- AC_LOCK hash=(\w+)/);
    if (acLockMatch) {
      const storedHash = acLockMatch[1];
      const currentHash = computeAcHash(JSON.parse(acContent).criteria);
      if (currentHash !== storedHash) {
        return textResult({
          error: "AC_TAMPERED",
          message: "acceptance-criteria.json 已被篡改（hash 不匹配）。",
          mandate: "[BLOCKED] AC 文件完整性校验失败。禁止在 Phase 1 之后修改 AC 定义。",
        });
      }
    }

    // 2. 执行 structural 断言
    const structuralResults = await runStructuralAssertions(
      JSON.parse(acContent).criteria,
      projectRoot,
      state.additionalRepos,  // 支持多 repo
    );

    // 3. 执行 test-bound 测试
    const bindings = await discoverAcBindings(projectRoot, state.stack.language, state.additionalRepos);
    const testResults = await runAcBoundTests(bindings, projectRoot, state.stack.language, state.stack.testCmd);

    // 4. 写入框架结果文件
    const frameworkResults = {
      structural: structuralResults,
      testBound: Object.fromEntries(testResults),
      pendingManual: JSON.parse(acContent).criteria
        .filter(c => c.layer === "manual")
        .map(c => c.id),
      timestamp: new Date().toISOString(),
    };
    await sm.atomicWrite(
      join(sm.outputDir, "framework-ac-results.json"),
      JSON.stringify(frameworkResults, null, 2),
    );
  }

  // 继续执行 tribunal ...
}
```

### 8.3 新增文件

| 文件 | 说明 | 行数预估 |
|------|------|---------|
| `mcp/src/ac-schema.ts` | AC JSON 的 Zod schema + hash 计算 | ~80 行 |
| `mcp/src/ac-runner.ts` | structural 断言执行引擎 | ~150 行 |
| `mcp/src/ac-test-binding.ts` | AC↔测试 绑定发现 + 运行 | ~200 行 |
| `mcp/src/__tests__/ac-runner.test.ts` | 断言引擎测试 | ~150 行 |
| `mcp/src/__tests__/ac-test-binding.test.ts` | 绑定发现测试 | ~100 行 |

### 8.4 修改文件

| 文件 | 改动 |
|------|------|
| `mcp/src/index.ts` | Phase 1 checkpoint 增加 AC JSON 校验 + hash；Phase 6 submit 前增加框架自动执行 |
| `mcp/src/types.ts` | 新增 AcceptanceCriteria 相关类型 |
| `mcp/src/tribunal-checklists.ts` | Phase 6 checklist 大幅增强 |
| `mcp/src/phase-enforcer.ts` | 新增 `validateAcJson()` 和 `validateAcIntegrity()` |
| `skills/auto-dev/prompts/phase1-architect.md` | 增加 AC JSON 产出要求 |
| `skills/auto-dev/prompts/phase5-test-architect.md` | 增加 AC 绑定规范 |
| `skills/auto-dev/prompts/phase6-acceptance.md` | 重构为三层验证流程 |
| `skills/auto-dev/checklists/design-review.md` | 增加 AC JSON 审查项 |
| `agents/auto-dev-acceptance-validator.md` | 更新职责为 manual AC + FAIL 分析 |
| `skills/auto-dev/SKILL.md` | Phase 6 流程描述更新 |

## 九、向后兼容

**核心策略**：`acceptance-criteria.json` 是可选增强，不存在时退化为现有流程。

```typescript
// Phase 6 入口判断
if (acJsonExists && acLockExists) {
  // 新流程：框架自动执行 → Agent 补充 manual → Tribunal 审查
} else {
  // 旧流程：acceptance-validator Agent 全权验证 → Tribunal 审查
}
```

- 用户提供的 design.md（没有 AC JSON）→ 旧流程
- auto-dev Phase 1 生成的 design.md（有 AC JSON）→ 新流程
- 旧项目 --resume → 检测 AC_LOCK 标记决定走哪条路

## 十、分阶段实施计划

### 阶段 A：AC Schema + Structural 断言（2-3 天）

1. `ac-schema.ts` — Zod schema 定义 + hash 计算
2. `ac-runner.ts` — structural 断言执行引擎（file_exists, file_contains, config_value 等）
3. `index.ts` — Phase 1 checkpoint 增加 AC JSON 校验 + hash 写入
4. `phase1-architect.md` — 增加 AC JSON 产出要求
5. `design-review.md` — 增加 AC JSON 审查项
6. 单元测试

### 阶段 B：Test Binding 发现 + 运行（2-3 天）

1. `ac-test-binding.ts` — 多语言 AC 标注扫描 + 针对性测试运行
2. `phase5-test-architect.md` — 增加 AC 绑定规范
3. Phase 6 preflight 增加绑定覆盖率检查
4. 单元测试

### 阶段 C：Phase 6 流程重构（2 天）

1. `index.ts` — Phase 6 submit 前插入框架自动执行逻辑
2. `phase6-acceptance.md` — 重构为三层验证
3. `acceptance-validator.md` — 更新职责
4. `tribunal-checklists.ts` — Phase 6 checklist 增强
5. `SKILL.md` — Phase 6 流程更新

### 阶段 D：端到端验证（1 天）

1. 用真实项目测试完整 Phase 1→6 流程
2. 验证向后兼容（无 AC JSON 时退化为旧流程）
3. 验证防篡改（Phase 3 修改 AC JSON → Phase 6 被拒绝）
4. 验证绑定缺失时的降级策略

**总计约 7-9 天工作量。**

## 十一、风险与缓解

| 风险 | 缓解 |
|------|------|
| Architect 不生成 AC JSON | Phase 1 checkpoint 不强制要求（向后兼容），但 review checklist 会标记缺失 |
| structural 断言中 regex 写错 | design-review 增加审查项；框架在 Phase 1 试运行断言（dry-run，只检查语法不检查结果） |
| test-architect 忘记标注 [AC-N] | Phase 6 preflight 检查绑定覆盖率，missing → 提示回退 Phase 5 |
| 测试文件编译失败导致 AC 测试无法运行 | 使用 Phase 5 已验证通过的 testCmd，编译问题应在 Phase 5 解决 |
| 多 repo 场景下扫描 AC 标注耗时 | 限制扫描范围为测试目录（src/test, __tests__, tests/） |
| AC JSON 与 design.md 中 AC 表格不一致 | design-review 交叉检查两者的 AC ID 和描述 |

## 十二、与资源约束系统的协同

可执行 AC 系统与资源约束系统（方向三）完全独立，可以并行实施。但有两个协同点：

1. **Diff 预算达成率可以作为 structural AC**：
   ```json
   { "type": "test_passes", "testName": "all" }  // 所有测试通过
   ```
   或直接在 AC JSON 中引用约束数据。

2. **Phase 4 Tribunal checklist 共享**：约束合规检查（方向三）和 AC 完整性检查（方向一）都在 Phase 4/6 的 Tribunal 中执行，共享同一个 checklist 框架。

3. **多 repo 感知共享**：`discoverAcBindings` 的多 repo 扫描复用方向三的 `additionalRepos` 数据。
