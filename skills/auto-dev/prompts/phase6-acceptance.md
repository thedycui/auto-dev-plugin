# 验收验证

## Task

逐条验证设计文档中的验收标准（AC-N）是否被正确实现。

**Topic**: {topic}
**Language**: {language}
**Project Root**: {project_root}
**Design Doc**: {output_dir}/design.md
**Code Review**: {output_dir}/code-review.md
**Test Results**: {output_dir}/e2e-test-results.md

## Requirements

1. 读取 `{output_dir}/framework-ac-results.json`（框架自动验证结果，如存在）
2. 从 `{output_dir}/design.md` 提取所有 AC-N 验收标准
3. 如果 design.md 无显式 AC 章节，从设计目标和改动清单中自动提取
4. 执行三层验证（见下文）
5. 将验收报告写入 `{output_dir}/acceptance-report.md`

## 三层验证流程

验收阶段采用三层验证。你只负责 Layer 3 (manual) 和 FAIL 分析：

1. **Layer 1 (structural)**: 框架已自动执行，结果在 framework-ac-results.json 中
2. **Layer 2 (test-bound)**: 框架已自动运行测试，结果在 framework-ac-results.json 中
3. **Layer 3 (manual)**: 你需要读代码主观判断

### 你的职责

- 对 Layer 1/2 的 PASS 项：在报告中直接引用框架结果，不需要重复验证
- 对 Layer 1/2 的 FAIL 项：分析原因（AC 定义不准 vs 代码缺陷），在报告中注明
- 对 Layer 3 (manual) 的 AC：执行代码验证 / 测试验证 / 运行验证
- 如果发现框架 FAIL 但代码实际满足（AC 定义有问题），在报告中注明

### Verification Hierarchy (for manual AC)

1. **代码验证**：读相关源码，确认功能逻辑已实现
2. **测试验证**：确认有对应的测试用例且通过（引用具体测试名）
3. **运行验证**（如可行）：构造输入数据实际运行，验证输出

## Review Checklist

<!-- requires: acceptance-review -->

## Output Format

```markdown
# 验收报告

| AC | 层级 | 描述 | 验证方式 | 结果 | 证据 |
|----|------|------|---------|------|------|
| AC-1 | test-bound | ... | 框架运行测试 | PASS | [AC-1] shouldReturn400... |
| AC-2 | structural | ... | 框架断言检查 | PASS | file_contains: matched |
| AC-3 | manual | ... | 代码审查 | PASS | 对比 UserService.java 与 OrderService.java 结构 |
| AC-4 | structural | ... | 框架断言检查 | FAIL | file_contains: pattern not found (AC 定义需修正) |

通过率：X/Y PASS, Z FAIL, W SKIP
结论：PASS / FAIL
```

## Constraints

- AC 来源必须是 design.md，不要自己编造验收标准
- SKIP 必须说明原因
- FAIL 必须给出具体缺失点和修复建议
- 不做 AC 之外的额外验证（不 scope creep）
- 不评价代码风格，聚焦在 AC 是否满足

---
完成后不需要做其他操作。直接完成任务即可。
