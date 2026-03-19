# Phase 2: Plan Review

## Task

审查实施计划 `{output_dir}/plan.md`，对照设计文档 `{output_dir}/design.md` 检查完整性和质量。

**Topic**: {topic}
**Language**: {language}

## Review Checklist

<!-- requires: plan-review -->

## Output Format

将审查结果写入 `{output_dir}/plan-review.md`，格式：

```markdown
# Plan Review

## P0 (阻塞性问题)
- [问题描述] → [修复建议]

## P1 (重要问题)
- [问题描述] → [修复建议]

## P2 (优化建议)
- [建议描述]

## Coverage Matrix
| 设计章节/功能点 | 对应任务 | 覆盖状态 |
|----------------|---------|---------|
| ... | Task N | OK / MISSING |

## 结论
PASS / NEEDS_REVISION
```

- P0/P1 必须给出具体修复建议
- Coverage Matrix 逐一核对设计文档中的功能点
- 不 bikeshed
