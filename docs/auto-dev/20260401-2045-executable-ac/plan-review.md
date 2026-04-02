# Plan Review（第二轮）

> 基于第一轮 review 修订后的计划重新审查。

## 第一轮问题修复验证

| 编号 | 级别 | 问题 | 修复方式 | 状态 |
|------|------|------|---------|------|
| P0-1 | P0 | phase-enforcer.ts 改动未覆盖 | 新增 Task 6a，含 validateAcJson() 和 validateAcIntegrity() | **已修复** |
| P0-2 | P0 | index.ts Phase 6 兜底路径遗漏 | 新增 Task 7a，覆盖 auto_dev_submit(phase=6) handler | **已修复** |
| P1-1 | P1 | Phase 6 preflight 绑定覆盖率检查未体现 | Task 7 描述显式包含 validateAcBindingCoverage() 及 BLOCKED 逻辑 | **已修复** |
| P1-2 | P1 | test-bound AC 降级策略未体现 | Task 7 描述增加"或允许降级为 manual 并记录降级原因" | **已修复** |
| P1-3 | P1 | Task 4 缺少 ac-schema.test.ts | Task 4 文件列表新增 ac-schema.test.ts | **已修复** |
| P1-4 | P1 | Task 11 未覆盖 index.ts 兜底路径 | Task 11 新增第 6 个场景覆盖 index.ts 兜底路径 | **已修复** |

## P0 (阻塞性问题)

无。

## P1 (重要问题)

无。

## P2 (优化建议，不阻塞)

- **Task 6 与 Task 6a 描述存在轻微不一致**：Task 6 描述中仍保留了内联实现的措辞（"尝试读取...schema 校验...manual 占比检查..."），而 Task 6a 的完成标准要求"Task 6 的 index.ts 中 Phase 1 校验逻辑调用 validateAcJson() 而非内联实现"。实现时应以 Task 6a 的完成标准为准（调用函数而非内联），但不影响功能正确性。
- **Task 9 粒度偏大**（沿用第一轮 P2）：同时修改 3 个 prompt 文件，建议拆为子任务以便独立验证。
- **Task 12 的编译验证可前移**（沿用第一轮 P2）：建议在 Task 7 完成后做一次增量编译验证。
- **Task 2 的 build_succeeds/test_passes 安全性约束**（沿用第一轮 P2）：建议在完成标准中明确命令白名单。

## Coverage Matrix

| 设计章节/功能点 | 对应任务 | 覆盖状态 |
|----------------|---------|---------|
| 二、AC 分类（三层定义） | Task 1 | OK |
| 三、Layer 1 断言类型白名单（7 种） | Task 1, Task 2 | OK |
| 三、AC 结构化文件格式（JSON schema） | Task 1 | OK |
| 三、防篡改机制（Phase 1 hash 写入） | Task 6, Task 6a | OK |
| 三、防篡改机制（Phase 6 hash 校验） | Task 7, Task 6a | OK |
| 四、AC 标注规范（Java/TS/Python） | Task 3 | OK |
| 四、绑定发现机制（grep 扫描） | Task 3 | OK |
| 四、绑定完整性检查（validateAcBindingCoverage） | Task 3（定义），Task 7（preflight 调用） | OK |
| 四、测试运行（buildTargetedTestCommand） | Task 3 | OK |
| 四、missing AC 降级策略 | Task 7（降级为 manual 并记录原因） | OK |
| 五、Phase 6 完整流程（6 步） | Task 7, Task 7a | OK |
| 六、Phase 1 Architect prompt 改动 | Task 9 | OK |
| 六、Design Review checklist 改动 | Task 10 | OK |
| 六、Phase 5 Test Architect prompt 改动 | Task 9 | OK |
| 六、Phase 6 Acceptance Validator 改动 | Task 10 | OK |
| 六、Phase 6 Acceptance prompt 改动 | Task 9 | OK |
| 七、Tribunal checklist 改动 | Task 8 | OK |
| 八、Phase 1 checkpoint AC JSON 校验 | Task 6, Task 6a | OK |
| 八、Phase 6 orchestrator 框架自动执行 | Task 7 | OK |
| 八、Phase 6 index.ts 兜底路径 | Task 7a | OK |
| 八、phase-enforcer.ts 改动 | Task 6a | OK |
| 八、types.ts re-export | Task 6 | OK |
| 八、新增文件（ac-schema/ac-runner/ac-test-binding） | Task 1, 2, 3 | OK |
| 八、测试文件 | Task 4, 5 | OK |
| 九、向后兼容（无 AC JSON 退化） | Task 6, Task 7, Task 7a | OK |
| SKILL.md 更新 | Task 12 | OK |
| 单元测试 | Task 4, 5 | OK |
| 集成测试 | Task 11 | OK |

## 结论

**PASS**

第一轮的 2 个 P0 和 4 个 P1 问题均已修复到位，无新增阻塞性或重要问题。计划与设计文档的 Coverage Matrix 全部为 OK，关键路径标注合理（Task 1 → Task 3 → Task 5 → Task 7 → Task 7a → Task 11 → Task 12），任务依赖关系正确。可以进入实现阶段。
