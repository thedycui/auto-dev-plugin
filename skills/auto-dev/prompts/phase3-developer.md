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

## TDD 模式（当 {tdd_mode} = "enabled" 时激活）

> 如果你看到这段内容，说明 TDD 模式已启用。以下流程**必须**严格执行。

### Iron Law: 禁止在没有失败测试的情况下编写实现代码

### 每个 Task 执行 RED-GREEN-REFACTOR 循环：

#### Step 1: RED — 先写失败的测试
1. 根据 task 描述，编写单元测试
2. 运行测试，**确认测试 FAIL**
3. 如果测试直接 PASS → 测试写得不对，或功能已存在。停下来检查。
4. `git add && git commit -m "auto-dev({topic}): Task {task_number} - RED: add failing tests"`

#### Step 2: GREEN — 最小实现让测试通过
1. 只写让测试通过的最少代码，不做额外优化
2. 运行测试，**确认 PASS**
3. `git add && git commit -m "auto-dev({topic}): Task {task_number} - GREEN: implement to pass"`

#### Step 3: REFACTOR — 在测试保护下清理（可选）
1. 重构实现代码（提取方法、消除重复等）
2. 运行测试，**确认仍 PASS**
3. `git add && git commit -m "auto-dev({topic}): Task {task_number} - REFACTOR: clean up"`

### Red Flags

| 你在想的 | 实际情况 |
|----------|----------|
| "这个功能太简单了，不需要先写测试" | 简单功能更适合 TDD——测试快，反馈快 |
| "我先把实现写完，回头补测试" | 这就是 Test-After，不是 TDD。违反 Iron Law。 |
| "这个 task 不好写测试" | 说明接口设计有问题。先设计可测试的接口。 |
| "测试直接就 PASS 了" | 测试没写对，或功能已存在。先确认 RED。 |
