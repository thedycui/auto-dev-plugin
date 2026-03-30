# 工作总结 — 2026-03-13

## 1. 工作产出总览

| 指标 | 数值 |
|------|------|
| 活跃项目数 | 1 |
| Git 提交数 | 13 |
| 代码变更量 | +16094 / -234 行 |

## 2. 主要工作内容

### 2.1 Batch 4 双轨 E2E 测试（真实 Dubbo 服务）
- 完成内容：对接真实 MSE Zookeeper + Nacos，62 个任务双轨测试，61 PASS / 0 FAIL / 1 ERROR，309/309 页面匹配，文本 100% 一致，新路径平均快 5.8%
- 相关提交：`32e11d83b` test: Batch 4 dual-track E2E — 61/62 pass against live Dubbo services

### 2.2 Batch 5 AI 全链路 E2E + Batch 6 回归基线
- 完成内容：Batch 5 使用真实 GLM-4V-Flash API 5/5 通过；Batch 6 记录 9 种任务类型的回归基线（245 用例，99.6% 通过率）；修复 taskId 列名错误（queue record PK vs. business task ID）
- 相关提交：`8825770fb` docs: update test report with Batch 5 results / `4a8d76fa7` test: Batch 6 regression baselines / `14dcf9586` docs: update test report with Batch 6 baseline results

### 2.3 测试修复与适配器扩展
- 完成内容：修复 Batch 3 渲染引擎测试（152 通过），新增 ExamReport、LayerReport 适配器测试和 HomeWork 双轨 E2E 测试
- 相关提交：`a6accaaed` test: fix Batch 3 render engine tests (152 pass) / `5a3057a54` test: add ExamReport, LayerReport adapter tests

### 2.4 macOS 兼容性修复 + PRD 文档生成
- 完成内容：Chrome user-data-dir 改为 macOS 兼容路径；逆向生成 10 个模块的 PRD 文档，含演示视频脚本和架构图
- 相关提交：`89e877f77` fix: configurable Chrome user-data-dir for macOS compatibility / `1140c8dae` docs: add PRD documents for 10 modules

## 3. 经验教训
- task_queue_his.id 是队列记录的主键，不是业务 taskId，查询时需使用 taskId 列
- glm-4v-flash 模型 max_tokens 上限为 1024，需注意截断风险
- DualTrackCompareService.selectGenerator() 需改为 protected 以支持测试可替换
