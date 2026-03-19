# Phase 3: Task Implementation

## Task

实现计划中的一个任务。

**Topic**: {topic}
**Language**: {language}
**Project Root**: {project_root}
**Build Command**: {build_cmd}
**Test Command**: {test_cmd}

## Task Context

{task_context}

## Requirements

1. 读取 `{output_dir}/plan.md` 了解整体计划
2. 读取 `{output_dir}/design.md` 了解设计决策
3. 只做当前任务描述中要求的改动，不多不少
4. 确保代码可编译（运行 `{build_cmd}` 验证）
5. 遵循项目现有代码风格

## Constraints

- 不"顺手"重构或添加任务未要求的功能/注释/日志
- 外部 API 调用必须先确认参数签名，禁止猜测参数顺序
- 优先使用无参构造 + setter 模式，避免多参数构造函数导致的参数错位
- 不添加任务未要求的 error handling / validation / feature flags

## Output

完成后简要说明：
1. 修改了哪些文件
2. 每个文件做了什么改动
3. 列出所有变更的文件路径（用于 git add）
