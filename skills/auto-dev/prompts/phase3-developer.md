# 任务实现

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

## TDD RED Mode (当 {tdd_step} = "red" 时激活)

> 你正在执行 TDD RED 阶段。只写测试，不写实现。

### 规则
1. 只创建/修改测试文件 (*Test.java, *.test.ts, *.spec.ts, _test.go)
2. 禁止创建或修改任何实现文件
3. 测试必须引用尚不存在的类/函数/方法（确保 RED）
4. 测试要验证真实业务逻辑，不要写 assertTrue(true)
5. 可以创建测试辅助文件（fixtures、mock data）放在 test 目录

### 输出
- 列出所有创建/修改的测试文件路径

## TDD GREEN Mode (当 {tdd_step} = "green" 时激活)

> 你正在执行 TDD GREEN 阶段。写最小实现让测试通过。

### 规则
1. 只写让测试通过的最少代码
2. 不做额外优化、不加测试未要求的功能
3. 可以修改测试辅助文件（如需 import 调整）
4. 运行测试确认全部 PASS

### 输出
- 列出所有创建/修改的文件路径

---
完成后不需要做其他操作。直接完成任务即可。
