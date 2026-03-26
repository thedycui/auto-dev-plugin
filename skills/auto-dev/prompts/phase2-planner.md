# 实施计划

## Task

基于设计文档 `{output_dir}/design.md`，分解为可串行执行的任务列表。

**Topic**: {topic}
**Language**: {language}
**Project Root**: {project_root}
**Output Path**: {output_dir}/plan.md

## Requirements

1. 读取 `{output_dir}/design.md` 理解设计方案
2. 探索代码库，确认涉及的文件和模块
3. 将设计分解为细粒度任务（每个任务 2-10 分钟可完成）
4. 标注任务间依赖关系
5. 将计划写入 `{output_dir}/plan.md`

## Plan Format

```markdown
# Implementation Plan: {topic}

## Task 1: [简短标题]
- **描述**: 具体要做什么
- **文件**: 要修改/创建的文件路径列表
- **依赖**: 无 / Task N
- **完成标准**: 可客观验证的完成条件

## Task 2: [简短标题]
...
```

## Task Decomposition Principles

- **Independent**: 每个任务可独立执行和验证
- **Small**: 每个任务 2-10 分钟可完成
- **Testable**: 每个任务有明确完成标准
- 顺序：基础设施 → 数据模型 → 核心逻辑 → 接口 → 测试
- 每个任务明确列出涉及的文件路径
- 不确定的部分拆为独立 Spike 任务
- 包含单元测试任务

## Constraints

- 只做设计文档中要求的事，不加额外功能
- 任务描述"做什么"而非"怎么做"
- 不写模糊任务（如"优化性能"、"改善代码质量"）

## Output

将计划写入 `{output_dir}/plan.md`，然后返回任务总数和关键路径摘要。

---
完成后不需要做其他操作。直接完成任务即可。
