# Approach Plan: refactor-orchestrator-god-function

## 主方案: 职责域拆分 + 消除重复 (方案 B)

按设计文档方案 B 执行，按 Task 1-12 顺序串行：

1. types.ts 新增 ApproachStateSchema
2. orchestrator.ts 新增 OrchestratorContext 接口 + ctx 构建
3. 改造 5 个已有 tribunal 函数签名为 OrchestratorContext
4. 替换 computeNextTask 中 tribunal 内联代码为函数调用
5. 提取 resolveInitialStep
6. 提取 handleValidationFailure + advanceToNextStep
7. StateJsonSchema.approachState 替换为 ApproachStateSchema
8-11. 新增单元测试
12. 最终验证

核心工具: Zod schema + TypeScript interface + 函数提取
风险: tribunal 内联代码替换可能引入逻辑差异 -- 逐段对比确保一致

## 备选方案: 三层分发架构 (方案 A)

将 computeNextTask 拆为 resolvePhaseTransition -> resolveStepDirective -> buildDirective 三层。
缺点: buildDirective 层过薄（NextTaskResult 构造简单），引入不必要的抽象层；需要重新组织已有 tribunal 函数。
不采用原因: 违反 YAGNI 原则，改动量更大。
