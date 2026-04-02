# 架构设计

## Task

为以下需求设计架构方案，产出设计文档。

**Topic**: {topic}
**Language**: {language}
**Project Root**: {project_root}
**Output Path**: {output_dir}/design.md

## Requirements

1. 探索代码库，理解现有架构、模块划分、技术栈和编码风格
2. 分析需求，识别核心功能点和非功能需求
3. 至少评估 2 个方案，给出量化对比
4. 撰写设计文档，写入 `{output_dir}/design.md`

## Design Document Structure

设计文档必须包含以下章节：

1. **背景与目标** — 为什么做、做什么、不做什么（Non-Goals）
2. **现状分析** — 现有架构中与需求相关的部分
3. **方案设计** — 至少 2 个方案的对比与选型理由
4. **详细设计** — 选定方案的具体实现细节（数据模型、接口设计、流程图）
5. **影响分析** — 对现有代码的改动范围、兼容性、迁移路径
6. **风险与缓解** — 已知风险及应对策略
7. **验收标准** — 格式如下（**必须包含**）：

```markdown
## 验收标准

| AC | 描述 | 验证方式 |
|----|------|---------|
| AC-1 | 具体的、可客观验证的行为描述 | 单元测试 / 集成测试 / 代码审查 / 运行验证 |
| AC-2 | ... | ... |
```

### 验收标准编写原则
- 每个核心功能点至少 1 条 AC
- 描述必须具体可验证（不写"系统正常工作"，写"传入空列表时返回 400 错误码"）
- 验证方式必须在当前环境下可行
- 包含正向和负向场景（正常输入 + 异常输入）

### AC 编写提示（可选）

如果改动涉及跨系统数据流、类型转换或外部调用，考虑增加一条可观测性 AC：
- 例：`AC-N: 关键数据转换节点有 WARN 级别日志，包含输入/输出值和类型，可通过 grep '[TRACE]' 验证`
- 例：`AC-N: 外部 API 调用有日志记录请求摘要和响应状态，便于部署后定位问题`

8. **结构化验收标准** — 在写入 design.md 的同时，将 AC 以结构化格式写入 `{output_dir}/acceptance-criteria.json`

### acceptance-criteria.json 编写指南

每条 AC 需要指定验证层级：
- `structural`：可以通过文件检查、配置值检查验证的 AC — 必须写 structuralAssertions
- `test-bound`：需要通过运行测试验证的功能行为 AC — 测试阶段会绑定测试，此处无需写断言
- `manual`：无法自动验证的 AC（架构合理性、代码风格等）

**约束**：`manual` 占比不得超过 40%。

structural 断言可用类型：
- `file_exists`：检查文件存在（支持 glob）
- `file_not_exists`：检查文件已删除
- `file_contains`：检查文件包含特定内容（正则表达式）
- `file_not_contains`：检查文件不包含特定内容
- `config_value`：检查 JSON 配置文件中的键值（点分隔路径）
- `build_succeeds`：编译通过
- `test_passes`：指定测试通过

示例：
```json
{
  "version": 1,
  "criteria": [
    {
      "id": "AC-1",
      "description": "传入空列表时返回 400 错误码",
      "layer": "test-bound"
    },
    {
      "id": "AC-2",
      "description": "新增配置项 max-retry 默认值为 3",
      "layer": "structural",
      "structuralAssertions": [
        { "type": "file_contains", "path": "src/main/resources/application.yml", "pattern": "max-retry:\\s*3" }
      ]
    },
    {
      "id": "AC-3",
      "description": "代码风格一致",
      "layer": "manual"
    }
  ]
}
```

## Constraints

- 不过度设计（YAGNI）
- 不忽略迁移路径和回滚方案
- 不选择团队不熟悉的技术栈
- 保持与现有代码风格一致
- 设计文档聚焦于接口契约、数据流和验收标准，避免写伪代码或指定具体实现方式
- 实现细节（具体的函数体、算法选择）留给后续实现阶段决定
- "怎么做"写到方案选型层面即可，不要写到代码行级别

## Output

将设计文档写入 `{output_dir}/design.md`，然后返回核心决策摘要（3-5 条要点）。

## Red Flags — 如果你在想以下任何一条，停下来

| 你在想的 | 实际情况 |
|----------|----------|
| "这个需求很简单，不需要 2 个方案对比" | 简单需求更容易过度设计。对比是防御手段。 |
| "我已经知道最佳方案了" | 你知道的是训练数据中的方案，不是这个项目的。先看代码。 |
| "AC 写 3 条就够了" | AC 是验收的唯一依据。少于 3 条说明你没想清楚边界。 |
| "这个改动影响范围很小" | 你还没读代码就下结论了。先 grep 所有引用。 |
| "不需要考虑回滚方案" | 回滚方案是设计的一部分，不是可选项。 |

## Iron Law

**设计文档必须包含至少 2 个方案的对比分析和至少 3 条可验证的验收标准（AC-N）。不符合则 review 必须返回 NEEDS_REVISION。**

---
完成后不需要做其他操作。直接完成任务即可。
