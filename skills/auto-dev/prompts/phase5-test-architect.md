# Phase 5: E2E Test Design

## Task

为本次实现设计端到端测试用例。

**Topic**: {topic}
**Language**: {language}
**Project Root**: {project_root}
**Test Command**: {test_cmd}
**Design Doc**: {output_dir}/design.md
**Code Review**: {output_dir}/code-review.md

## Requirements

1. 读取 `{output_dir}/design.md` 理解功能需求和验收标准
2. 读取 `{output_dir}/code-review.md` 关注 Dormant Path Analysis 中标记为"未验证"的路径
3. 探索实现代码，理解调用链和数据流
4. 设计测试用例，写入 `{output_dir}/e2e-test-cases.md`

## Test Design Techniques

- 等价类划分（Equivalence Partitioning）
- 边界值分析（Boundary Value Analysis）
- 决策表（Decision Table）— 复杂条件组合
- 状态转换（State Transition）— 如有状态机

## Must-Execute Rule: Integration Entry Point Test

测试设计必须包含至少一个从调用方入口发起的测试：
1. 识别新代码的调用方入口（如 Handler.handle()、Controller 方法）
2. 从入口发起测试，使用真实输入数据
3. 验证新代码的输出在已有管线中被正确传递和处理

> 组件正确不等于集成正确，必须从入口测。

## Output Format

将测试用例写入 `{output_dir}/e2e-test-cases.md`，格式：

```markdown
# E2E Test Cases: {topic}

## TC-1: [测试标题]
- **类型**: 正向 / 负向 / 边界
- **前置条件**: ...
- **测试步骤**:
  1. 具体步骤（不写"输入有效数据"）
  2. ...
- **预期结果**: 具体可验证的结果（不写"系统正常工作"）
- **验证方式**: 断言 / 数据库查询 / 日志检查

## TC-2: ...
```

## Anti-Laziness Rule

**禁止偷工减料的测试覆盖**：
- 从 design.md 中提取所有功能点，在输出末尾附一个覆盖矩阵：

```markdown
## 覆盖矩阵
| 功能点 | 正向测试 | 负向测试 | 边界测试 |
|--------|---------|---------|---------|
| 功能A  | TC-1    | TC-3    | TC-5    |
| 功能B  | TC-2    | TC-4    | -       |
```

- 如果某功能点没有负向/边界测试，必须标注 `-` 并说明原因
- **测试用例数 < 功能点数 x 2 时**，必须解释为什么覆盖充分

## Constraints

- 每个测试用例必须可独立执行
- 预期结果必须可客观验证
- 包含正向和负向测试
- 覆盖 code-review 中标记的未验证路径
