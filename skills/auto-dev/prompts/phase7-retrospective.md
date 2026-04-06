# 深度复盘报告

分析本次 auto-dev session 的完整执行过程，产出一份**诚实、深度**的复盘报告。

## 输入

阅读以下文件（全部必读，不存在的跳过）：
- `{output_dir}/progress-log.md` — 完整执行日志
- `{output_dir}/design.md` — 设计文档
- `{output_dir}/design-review.md` — 设计审查结果
- `{output_dir}/plan.md` — 实施计划
- `{output_dir}/plan-review.md` — 计划审查结果
- `{output_dir}/code-review.md` — 代码审查结果
- `{output_dir}/e2e-test-cases.md` — 测试用例
- `{output_dir}/e2e-test-results.md` — 测试结果
- `{output_dir}/acceptance-report.md` — 验收报告

读取实际代码和测试文件来交叉验证（不能只看报告就下结论）。

## 分析维度

### 1. 诚实度审计

逐项检查以下问题，每项给出 PASS / FAIL / PARTIAL 结论和具体证据。

#### 1.1 跳过阶段
- progress-log.md 检查：所有阶段是否都有执行记录？
- 是否有阶段直接完成而没有实际执行过程？
- design-review/plan-review.md 是否存在且非空？

#### 1.2 执行过程完整性
- progress-log.md 中是否有重复执行同一阶段的记录？
- 配置一致性：实际执行的 testCmd/buildCmd 是否与初始配置一致
- 是否有阶段被拒绝后重新执行的痕迹？

#### 1.3 review 和测试真实性
- design-review.md 是否包含具体的文件路径和行号引用？还是泛泛而谈？
- code-review.md 是否包含 grep 搜索证据和 Doormant Path Analysis？P0/P1 问题是否被真实修复了？
- e2e-test-results.md 测试是真实执行的还是编造的？检查 surefire/jest 等测试框架输出
- 测试文件是否存在？测试断言是否有意义？

#### 1.4 TDD 合规性
- INIT 标记中 tdd 是否启用
- 如果 TDD 启用：是否有 RED → GREEN → REFACTOR 的 commit 记录？还是先写实现后补测试？
- git log 中测试 commit 和实现 commit 的顺序是什么？

#### 1.5 作弊行为
- 是否修改了 state.json 中的 testCmd/buildCmd？
- 是否 @Disabled 或 skip 了预存测试来让测试通过？
- 是否跳过了 TDD 流程？
- agent 产出的代码是否被逐一审查，还是直接信任？

### 2. 踩坑记录

- 哪些 Phase 触发了 NEEDS_REVISION？原因是什么？
- 有没有 BLOCKED 的任务？为什么被阻塞？
- 代码审查发现了哪些 P0/P1 问题？是否都被修复了？
- 测试失败的根因是什么？

### 3. 亮点

- 哪些 Phase 一次通过？说明设计/计划做得好
- 哪些设计决策被验收确认？
- 有没有特别高效的代码模式？

### 4. 流程改进

- 哪些 Phase 耗时过长？为什么？
- 迭代次数是否合理？有没有不必要的来回？
- 主 agent 和 subagent 之间的协调是否高效？
- 有没有本可以并行但串行执行的任务？

### 5. 技术经验

- 这个项目/技术栈有什么特殊注意点？
- 依赖/API 有什么坑？
- 编译/测试环境有什么问题？
- 对于 **跨项目通用** 的技术经验，标记 `reusable: true`
完成后不需要做其他操作
