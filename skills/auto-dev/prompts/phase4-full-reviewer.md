# 完整代码审查

## Task

对本次 auto-dev 的全部代码变更进行深度审查。

**Topic**: {topic}
**Language**: {language}
**Project Root**: {project_root}
**Design Doc**: {output_dir}/design.md
**Plan Doc**: {output_dir}/plan.md

## Anti-Laziness Rule

**禁止无证据 PASS**。你的审查结果必须包含：
- 你执行的每条 Must-Execute Rule 的实际搜索结果（grep 输出、调用方列表）
- Dormant Path Analysis 表格不能为空（至少列出"无新路径"的判断依据）
- 如果 PASS：必须写明你审查了多少个文件、多少行变更
- **空洞的 PASS（没有搜索证据、没有文件列表）视为审查不合格**

## Review Scope

审查本次开发的所有代码变更，重点关注跨任务的集成问题。

## Review Checklist

<!-- requires: code-review-common -->
<!-- requires: {lang_checklist} -->

## Must-Execute Rules

### Rule 1: Caller-Side Review
当新代码实现接口方法或返回对象被已有代码消费时，必须追踪消费方的完整处理路径：
1. 识别所有调用方/消费方（grep 接口方法名、返回类型的字段 getter）
2. 追踪返回值的每个字段在下游如何被使用
3. 验证已有消费方能正确处理新代码返回的值

> 不只审"生产者"，必须审"消费者"。

### Rule 2: Dormant Path Detection
识别新功能依赖的已有代码路径是否曾在生产环境被执行过：
1. 列出新功能依赖的所有已有代码路径
2. 对每条路径标注：已验证（生产在用）/ 未验证（代码存在但从未执行）
3. 未验证路径标为 P1 风险

> "代码存在" 不等于 "代码验证过"，首次激活的路径是最高风险。

### Rule 3: Observability Coverage（可观测性覆盖）

当本次改动涉及数据转换、外部调用、聚合计算、条件分支时：

1. 检查每个改动点是否有对应的日志输出
2. 日志是否包含实际值和类型（不是空洞的"method called"）
3. 日志级别是否足够高（WARN 级别，不是 DEBUG/INFO 可能被过滤）

**检查表格**：

| 改动点 | 是否有日志 | 日志内容是否充分 | 级别 | 位置(文件:行号) |
|--------|-----------|-----------------|------|----------------|
| 数据转换/类型转换 | 是/否 | 充分/不足/缺失 | WARN/INFO/无 | ... |
| 外部系统调用 | 是/否 | 充分/不足/缺失 | WARN/INFO/无 | ... |
| 聚合/计算逻辑 | 是/否 | 充分/不足/缺失 | WARN/INFO/无 | ... |
| 条件分支 | 是/否 | 充分/不足/缺失 | WARN/INFO/无 | ... |

> 没有日志的数据转换 = 盲区。部署后出问题时，没有日志就只能靠猜。
> 标记为 P1，除非改动已被单元测试 100% 覆盖。

## Cross-Task Focus

- 组件间 API 接口匹配（生产者和消费者一致）
- 数据模型与设计一致
- 没有设计中未提到的"额外功能"
- 跨任务的数据流和错误传播

## Output Format

将审查结果写入 `{output_dir}/code-review.md`，格式：

```markdown
# Code Review: {topic}

## P0 (阻塞性问题)
- [问题描述] → [修复建议] → [涉及文件]

## P1 (重要问题)
- [问题描述] → [修复建议] → [涉及文件]

## P2 (优化建议)
- [建议描述]

## Dormant Path Analysis
| 代码路径 | 状态 | 风险等级 |
|---------|------|---------|
| ... | 已验证/未验证 | P1/P2 |

## 结论
PASS / NEEDS_FIX
```

- P0/P1 必须给出具体修复建议和涉及文件
- 只检查与本次变更相关的 checklist 项
- 不 bikeshed

---
完成后不需要做其他操作。直接完成任务即可。
