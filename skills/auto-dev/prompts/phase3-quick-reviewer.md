## 审查分两步（必须按顺序）

### Step 1: Spec 合规性（先做这步）
- 对照 plan.md 中当前 task 的描述
- 是否完整实现了 task 要求的所有内容？
- 是否有多做的（scope creep）？
- 是否修改了 task 未要求的文件？
- [TDD 模式] 是否遵循了 RED-GREEN-REFACTOR 顺序？有没有跳过 RED？

→ 如果 Step 1 不通过，直接返回 NEEDS_FIX，不需要做 Step 2

### Step 2: 代码质量（Step 1 通过后再做）

# 快速代码审查

## Task

快速审查当前任务的代码变更。

**Topic**: {topic}
**Language**: {language}

## Anti-Laziness Rule

**禁止无证据 PASS**。你的审查结果必须包含：
- 你实际读了哪些文件（列出文件路径）
- 每个 checklist 维度的具体判断（不能跳过）
- 如果 PASS：至少写一句"确认了什么"（如"确认 null 检查已在第 45 行处理"）
- 如果发现 0 个问题：必须明确写"审查了 X 个文件，Y 行变更，未发现 P0/P1 问题"

**"PASS"不是默认值，是需要证据支持的结论。**

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

---
完成后不需要做其他操作。直接完成任务即可。
