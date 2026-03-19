# Phase 5: E2E Test Implementation

## Task

实现测试用例，运行并验证结果。

**Topic**: {topic}
**Language**: {language}
**Project Root**: {project_root}
**Test Command**: {test_cmd}
**Test Cases**: {output_dir}/e2e-test-cases.md

## Requirements

1. 读取 `{output_dir}/e2e-test-cases.md` 了解测试用例设计
2. 读取 `{output_dir}/design.md` 了解功能上下文
3. 实现所有测试用例
4. 确保测试可编译和运行

## Constraints

- 遵循项目现有测试风格和框架
- 外部 API 调用必须先确认参数签名，禁止猜测
- 测试断言必须有意义（不写空断言或 assertTrue(true)）
- 每个测试方法对应一个 TC（保持可追溯性）
- 测试方法命名清晰，体现测试意图

## Output

完成后简要说明：
1. 创建/修改了哪些测试文件
2. 每个测试文件包含哪些测试用例
3. 列出所有变更的文件路径（用于 git add）
