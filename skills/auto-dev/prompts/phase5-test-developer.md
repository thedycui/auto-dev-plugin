# 端到端测试实现

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
3. **必须实现所有标记为 UNIT 的测试用例**（用 Mockito/jest.mock，不依赖外部服务）
4. 对标记为 INTEGRATION 的用例，优先写自动化测试；如果确认本地无法启动服务，可用 curl 脚本替代
5. 对标记为 E2E 的用例，可以 DEFERRED，但必须在 e2e-test-results.md 中说明原因
6. 确保测试可编译和运行

## 硬性要求

- **必须新增至少 1 个测试文件**（*Test.java / *.test.ts 等）。框架会通过 git diff 检测，0 个新测试文件会被 HARD BLOCK
- 不允许只写 markdown 测试计划而不写任何测试代码
- "项目没有测试基础设施"不是跳过 UNIT 测试的理由 — Mockito/jest.mock 不需要基础设施

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

---
完成后不需要做其他操作。直接完成任务即可。
