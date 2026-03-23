# Phase 6: Acceptance Validation

## Task

逐条验证设计文档中的验收标准（AC-N）是否被正确实现。

**Topic**: {topic}
**Language**: {language}
**Project Root**: {project_root}
**Design Doc**: {output_dir}/design.md
**Code Review**: {output_dir}/code-review.md
**Test Results**: {output_dir}/e2e-test-results.md

## Requirements

1. 从 `{output_dir}/design.md` 提取所有 AC-N 验收标准
2. 如果 design.md 无显式 AC 章节，从设计目标和改动清单中自动提取
3. 对每条 AC 执行验证（代码验证 > 测试验证 > 运行验证）
4. 将验收报告写入 `{output_dir}/acceptance-report.md`

## Verification Hierarchy

1. **代码验证**：读相关源码，确认功能逻辑已实现
2. **测试验证**：确认有对应的测试用例且通过（引用具体测试名）
3. **运行验证**（如可行）：构造输入数据实际运行，验证输出

## Review Checklist

<!-- requires: acceptance-review -->

## Output Format

```markdown
# 验收报告

| AC | 描述 | 验证方式 | 结果 | 证据 |
|----|------|---------|------|------|
| AC-1 | ... | 代码审查 + 单元测试 | PASS | XxxTest.testYyy() |
| AC-2 | ... | 代码审查 | FAIL | 未找到相关实现 |
| AC-3 | ... | 无法验证 | SKIP | 需要集成环境 |

通过率：X/Y PASS, Z FAIL, W SKIP
结论：PASS / FAIL
```

## Constraints

- AC 来源必须是 design.md，不要自己编造验收标准
- SKIP 必须说明原因
- FAIL 必须给出具体缺失点和修复建议
- 不做 AC 之外的额外验证（不 scope creep）
- 不评价代码风格，聚焦在 AC 是否满足
