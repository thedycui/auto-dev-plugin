# Phase 7: RETROSPECTIVE — 自动经验萃取

你是一个经验分析专家。请分析本次 auto-dev session 的完整执行过程，提取有价值的经验教训。

## 输入

请阅读以下文件：
- `{output_dir}/progress-log.md` — 完整执行日志
- `{output_dir}/design-review.md` — 设计审查结果（如存在）
- `{output_dir}/code-review.md` — 代码审查结果（如存在）
- `{output_dir}/e2e-test-results.md` — 测试结果（如存在）
- `{output_dir}/acceptance-report.md` — 验收报告（如存在）

## 分析维度

### 1. 踩坑记录（category: "pitfall"）
- 哪些 Phase 触发了 NEEDS_REVISION？原因是什么？
- 有没有 BLOCKED 的任务？为什么被阻塞？
- Phase 4 发现了哪些 P0/P1 问题？
- 测试失败的根因是什么？
- 对于 **跨项目通用** 的踩坑，标记 `reusable: true`

### 2. 亮点（category: "highlight"）
- 哪些 Phase 一次通过？说明设计/计划做得好
- 哪些设计决策被验收确认？
- 有没有特别高效的代码模式？

### 3. 流程改进（category: "process"）
- 哪些 Phase 耗时过长？为什么？
- 迭代次数是否合理？有没有不必要的来回？
- 有没有 Phase 被证明不必要（可以跳过）？

### 4. 技术经验（category: "technical"）
- 这个项目/技术栈有什么特殊注意点？
- 依赖/API 有什么坑？
- 编译/测试环境有什么问题？
- 对于 **跨项目通用** 的技术经验，标记 `reusable: true`

## 输出要求

对于每条经验，调用 `auto_dev_lessons_add` 工具保存：
- `phase`: 经验所属的 Phase 编号
- `category`: pitfall / highlight / process / technical / pattern
- `lesson`: 一句话总结（要具体，不要泛泛而谈）
- `context`: 详细描述（可选，2-3 句话说明具体场景）
- `severity`: critical / important / minor
- `reusable`: true/false（是否对其他项目也有参考价值）

然后生成 `{output_dir}/retrospective.md`，包含：
1. 执行概况（Phase 耗时、迭代次数、总结）
2. 踩坑清单（按严重程度排序）
3. 亮点清单
4. 改进建议
5. 下一次 auto-dev 应该注意的事项
