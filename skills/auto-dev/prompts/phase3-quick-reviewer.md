# Phase 3: Quick Code Review

## Task

快速审查当前任务的代码变更。

**Topic**: {topic}
**Language**: {language}

## Review Scope

只审查当前任务的变更，不审查整个代码库。聚焦于：

1. **功能正确性** — 实现是否符合 plan.md 中该任务的描述和设计意图
2. **明显 bug** — null 检查、边界条件、资源泄漏
3. **API 参数** — 外部调用的参数顺序和类型是否正确
4. **编译安全** — 代码能否编译通过

## Review Checklist

<!-- requires: code-review-common -->
<!-- requires: {lang_checklist} -->

## Output Format

```markdown
## P0 (阻塞性问题)
- [问题描述] → [修复建议]

## P1 (重要问题)
- [问题描述] → [修复建议]

## P2 (优化建议)
- [建议描述]

## 结论
PASS / NEEDS_FIX
```

- 这是快速审查，聚焦 P0/P1，不纠缠 P2
- P0/P1 必须给出具体修复建议
- 不 bikeshed
