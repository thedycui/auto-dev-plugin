# Implementation Plan: auto-dev-self-improve-round6

**日期**: 2026-04-04
**改动类型**: bugfix + optimization
**预估工时**: 1~2 小时
**任务总数**: 8

---

## Task 1: 新增 promptLessonsFeedbackSimplified 函数
- **描述**: 在 `index.ts` 中新增 `promptLessonsFeedbackSimplified` 函数，用于在 Phase 7 完成时输出 Lessons 反馈提示
- **文件**:
  - `mcp/src/index.ts`
- **依赖**: 无
- **完成标准**:
  - 函数签名符合设计文档：`async function promptLessonsFeedbackSimplified(projectRoot: string, topic: string): Promise<void>`
  - 函数能正确读取 `injectedLessonIds` 和 `injectedGlobalLessonIds`
  - 无 Lessons 注入时直接返回，不输出任何内容
  - 有 Lessons 注入时生成格式化的反馈提示（包含 Lessons ID 列表和快捷反馈命令模板）

---

## Task 2: 修改 auto_dev_submit Phase 7 分支调用反馈提示函数
- **描述**: 修改 `auto_dev_submit` 工具的 Phase 7 分支，在清空 `injectedLessonIds` 之前调用 `promptLessonsFeedbackSimplified` 函数
- **文件**:
  - `mcp/src/index.ts`
- **依赖**: Task 1
- **完成标准**:
  - 在 `generateRetrospectiveData(outputDir)` 之后、`atomicUpdate({ injectedLessonIds: [] })` 之前添加反馈提示调用
  - 仅当有 Lessons 注入时才调用反馈提示函数
  - 清空 `injectedLessonIds` 的逻辑保持不变

---

## Task 3: 验证 Phase 7 反馈提示终端输出（集成测试）
- **描述**: 编写集成测试验证 Phase 7 完成时终端输出 Lessons 反馈提示
- **文件**:
  - `mcp/src/__tests__/lessons-round6-unit.test.ts`（新建）
  - 使用 Vitest 测试框架（与现有测试保持一致）
  - 参考 `tribunal.test.ts` 的集成测试模式（模拟 console.log 输出）
- **依赖**: Task 2
- **完成标准**:
  - 测试用例创建模拟的 Phase 7 session（包含 `injectedLessonIds`）
  - 使用 `vi.spyOn(console, 'log')` 捕获终端输出
  - 验证调用反馈提示函数后终端输出包含 Lessons ID 列表
  - 验证输出包含 `auto_dev_lessons_feedback` 命令模板

---

## Task 4: 验证 Phase 7 反馈提示写入 progress-log.md（单元测试）
- **描述**: 编写单元测试验证反馈提示正确追加到 progress-log.md
- **文件**:
  - `mcp/src/__tests__/lessons-round6-unit.test.ts`
- **依赖**: Task 2
- **完成标准**:
  - 使用 `mkdtemp` 创建临时测试目录（与现有测试模式一致）
  - 测试用例验证 `progress-log.md` 包含 `<!-- LESSONS_FEEDBACK -->` 标记
  - 使用 `readFile` 验证反馈提示内容包含 Lessons ID 列表和快捷命令模板
  - 验证追加操作不破坏 progress-log.md 原有内容（通过预先写入内容，追加后读取完整文件验证）

---

## Task 5: 验证无 Lessons 注入时不输出反馈提示（单元测试）
- **描述**: 编写单元测试验证无 Lessons 注入时不输出任何反馈提示
- **文件**:
  - `mcp/src/__tests__/lessons-round6-unit.test.ts`
- **依赖**: Task 1
- **完成标准**:
  - 测试用例模拟无 Lessons 注入的 session（`injectedLessonIds` 和 `injectedGlobalLessonIds` 均为空）
  - 使用 `vi.spyOn(console, 'log')` 验证终端无任何反馈提示输出
  - 验证 progress-log.md 文件未被创建或修改（通过 `access` 或文件不存在检查）

---

## Task 6: 优化 Phase 7-retrospective.md prompt 模板
- **描述**: 简化 `phase7-retrospective.md` 模板，减少冗余说明，压缩示例代码
- **文件**:
  - `skills/auto-dev/prompts/phase7-retrospective.md`
- **依赖**: 无
- **优化原则**:
  - 移除冗余的说明性文字（如"请..."、"需要..."等重复性引导语）
  - 使用项目符号和代码块替代长段落描述
  - 压缩示例代码，保留核心结构
  - 保持指令清晰，不牺牲可读性
- **完成标准**:
  - Prompt 字符数减少 20-30%（从 5861 字符减少到 ~4100 字符）
  - 使用 `wc -c` 命令验证优化后的字符数
  - 保留所有必要的指令和格式要求（逐条检查设计文档中的指令是否保留）

---

## Task 7: 优化 Phase 5-test-architect.md prompt 模板
- **描述**: 简化 `phase5-test-architect.md` 模板，减少冗余说明
- **文件**:
  - `skills/auto-dev/prompts/phase5-test-architect.md`
- **依赖**: Task 6（优化原则参考 Task 6，确保两个 prompt 的优化风格一致）
- **优化原则**:
  - 参考 Task 6 的优化原则，保持两个 prompt 的优化风格一致
  - 移除冗余的说明性文字
  - 使用更简洁的指令格式（如 imperative 语句而非描述性语句）
  - 保持测试要求和规则的完整性
- **完成标准**:
  - Prompt 字符数减少 20-30%（从 5551 字符减少到 ~3900 字符）
  - 使用 `wc -c` 命令验证优化后的字符数
  - 保留所有必要的测试要求和规则（逐条检查设计文档中的要求是否保留）

---

## Task 8: 验证 Token 成本优化效果（集成测试）
- **描述**: 运行完整 auto-dev 流程，对比优化前后的 token 消耗
- **文件**:
  - 现有集成测试框架
- **依赖**: Task 6, Task 7
- **完成标准**:
  - 执行完整的 auto-dev 流程（至少包含 Phase 5 和 Phase 7）
  - 记录 prompt 长度减少百分比：使用 `wc -c` 统计优化前后 prompt 文件字符数，计算减少百分比（目标 20-30%）
  - 对比优化前后的 token 消耗：
    - 使用相同输入参数（相同的 project、topic、phase）执行 Phase 5 和 Phase 7
    - 记录优化前后 agent 调用次数（通过 orchestrator 日志）
    - 记录优化前后每次 agent 调用的 prompt token 数（通过 API 日志或日志文件）
    - 计算总 token 消耗减少百分比
  - 确认优化不影响功能正确性：运行现有测试套件，验证所有测试通过

---

## 任务依赖关系

```
Task 1 → Task 2 → Task 3
                ↓
               Task 4
                ↓
               Task 5

Task 6 → Task 7 → Task 8
```

**关键路径**:
```
Task 1 → Task 2 → Task 3 → Task 4 → Task 5 → Task 6 → Task 7 → Task 8
```

**并行任务**:
- 无（Task 7 依赖 Task 6 的优化原则）

**依赖说明**:
- Task 7 依赖 Task 6：Task 7 参考 Task 6 的优化原则，确保两个 prompt 的优化风格一致
- Task 8 依赖 Task 6 和 Task 7：需要两个 prompt 都优化完成后才能进行对比测试

---

## 总结

- **任务总数**: 8
- **关键路径长度**: 8 个 Task（Task 1 → Task 2 → Task 3 → Task 4 → Task 5 → Task 6 → Task 7 → Task 8）
- **预估总工时**: 1~2 小时
- **核心改进**:
  - R6-1: Phase 7 自动提示 Lessons 反馈（~50 行）
  - R6-2: Token 成本优化（~40 行）
- **测试覆盖**: 3 个单元测试 + 1 个集成测试（使用 Vitest 框架，与现有测试保持一致）
- **测试文件路径**: `mcp/src/__tests__/lessons-round6-unit.test.ts`（新建）
- **优化验证方法**:
  - Prompt 长度对比：使用 `wc -c` 命令统计优化前后字符数，计算减少百分比
  - Token 消耗对比：使用相同输入参数执行 Phase 5/7，记录 agent 调用次数和 prompt token 数
