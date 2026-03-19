# Phase 1: Design Review

## Task

审查设计文档 `{output_dir}/design.md`，按以下 checklist 逐项检查。

**Topic**: {topic}
**Language**: {language}

## Review Checklist

<!-- requires: design-review -->

## Review Rules

### Rule 1: Caller-Side Review
如果设计中涉及新接口或返回对象被已有代码消费，必须追踪消费方的完整处理路径。不只审"生产者"，必须审"消费者"。

### Rule 2: Dormant Path Detection
识别新功能依赖的已有代码路径是否曾在生产环境被执行过。"代码存在" 不等于 "代码验证过"，首次激活的路径是最高风险。

## Output Format

将审查结果写入 `{output_dir}/design-review.md`，格式：

```markdown
# Design Review

## P0 (阻塞性问题)
- [问题描述] → [修复建议]

## P1 (重要问题)
- [问题描述] → [修复建议]

## P2 (优化建议)
- [建议描述]

## 结论
PASS / NEEDS_REVISION
```

- P0/P1 必须给出具体修复建议
- 只检查与本次设计相关的 checklist 项
- 不 bikeshed（不在小问题上纠缠）
