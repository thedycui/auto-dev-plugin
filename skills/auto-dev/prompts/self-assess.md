# auto-dev Self-Assessment

## Task

对 auto-dev 系统进行全面自我评估，识别改进机会，产出改进候选列表。

**Project Root**: {project_root}
**Output Path**: {output_dir}/improvement-candidates.md

## Data Collection

依次收集以下数据：

1. **源码** — 读取 `mcp/src/*.ts`、`agents/*.md`、`skills/auto-dev/**`、`skills/auto-dev/prompts/**`
2. **三层 Lessons**:
   - Local: `{output_dir}/lessons-learned.json`
   - Project: `{project_root}/docs/auto-dev/_global/lessons-global.json`
   - Global: `~/.auto-dev/lessons-global.json`
3. **Retrospective 历史** — 遍历 `{project_root}/docs/auto-dev/*/retrospective.md`
4. **测试结果** — 执行 `cd {project_root}/mcp && npm test` 并记录输出
5. **构建状态** — 执行 `cd {project_root}/mcp && npm run build` 并记录输出

## Analysis

基于收集的数据，从以下维度分析：

1. **代码质量** — 重复代码、过长函数、缺少类型、错误处理不足
2. **测试覆盖** — 未覆盖的分支、缺少边界测试
3. **性能** — 不必要的文件读写、同步操作、可优化的循环
4. **架构** — 耦合度、模块划分、接口清晰度
5. **流程** — Lessons 中反复出现的 pitfall、高频 NEEDS_REVISION 的阶段
6. **文档** — 过时的文档、缺少的使用说明

## Output Format

将结果写入 `{output_dir}/improvement-candidates.md`，格式如下：

```markdown
# auto-dev 改进候选列表

> 生成时间: {timestamp}
> 数据范围: {project_root}

## 摘要

- 扫描文件数: N
- 历史 Retrospective 数: N
- 三层 Lessons 总数: Local=N, Project=N, Global=N
- 测试通过率: N/N
- 构建状态: PASS/FAIL

## 改进项

| # | 改进项 | 类型 | 优先级 | 依据 | 预估工作量 |
|---|--------|------|--------|------|-----------|
| 1 | ... | bug/perf/feature/quality/process | P0/P1/P2 | 引用具体证据 | S/M/L |

## 详细说明

### IMP-001: [改进项标题]

- **类型**: bug | perf | feature | quality | process
- **优先级**: P0 | P1 | P2
- **问题描述**: 具体问题（引用文件名:行号 或 lesson ID）
- **改进方案**: 方案概要
- **预期收益**: 预期效果
- **auto-dev topic**: 可直��作为 auto-dev topic 的字符串（如需自动执行）
```

## Constraints

- 每个改进项必须引用具体证据（文件名:行号、lesson ID、测试输出片段）
- 优先级定义: P0=影响正确性, P1=影响效率或可维护性, P2=改善体验
- 最多产出 10 个改进项，按优先级排序
- 不要建议无关改动（如 README 美化、代码格式化）

---

完成后不需要做其他操作。直接完成任务即可。
