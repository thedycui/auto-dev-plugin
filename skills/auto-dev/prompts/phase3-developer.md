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

## 可观测性要求

当改动涉及以下场景时，**必须**在关键节点添加 WARN 级别日志：

1. **数据转换/类型转换**：输入类型 + 输出类型 + 转换前后的值
2. **外部系统调用**（数据库查询、RPC、HTTP）：请求参数摘要 + 响应状态 + 首条结果的类型和值
3. **聚合/计算逻辑**：输入数据条数 + 计算方式 + 输出结果
4. **条件分支**（if/switch on type/config）：实际走了哪个分支 + 判断依据

### 日志规范
- **级别**：WARN（确保在所有环境都能输出）
- **前缀**：`[TRACE]`（便于 grep 过滤和后续清理）
- **内容**：包含变量值和类型，不只是"进入了 XX 方法"
- **示例**：
  - Java: `logger.warn("[TRACE] SQL生成: type={}, calcMethod={}, sql={}", dataType, calcMethod, sql);`
  - Node: `logger.warn('[TRACE] SQL生成: type=%s, calcMethod=%s, sql=%s', dataType, calcMethod, sql);`
  - Python: `logger.warning('[TRACE] SQL生成: type=%s, calcMethod=%s, sql=%s', dataType, calcMethod, sql)`

### 不需要加日志的场景
- 纯粹的 CRUD（框架已有日志）
- getter/setter、DTO 转换
- 单元测试已完全覆盖的纯函数

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
