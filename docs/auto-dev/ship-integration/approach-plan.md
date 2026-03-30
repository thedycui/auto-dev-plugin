# 方案计划：ship-integration (Phase 8)

## 主方案：按设计文档 Phase 8 内嵌实现

- **方法**: 严格按照设计文档方案 A，在 orchestrator 中原生新增 Phase 8（8a-8d），所有变更集中在 types.ts / orchestrator.ts / phase-enforcer.ts / index.ts 四个源文件 + 新建 prompt 模板 + 新建测试文件
- **核心工具**: Zod v4 schema 扩展、orchestrator STEP_ORDER/validateStep switch-case、TemplateRenderer
- **风险**:
  - regressToPhase 是首次激活的休眠路径，需要在 computeNextTask 的 non-tribunal failure 分支之前插入新处理逻辑（P0-1）
  - computeNextDirective maxPhase 硬编码需同步修改（P0-2）
  - Step 8a 引入首个 shell 命令到 validateStep，需处理 git 命令失败场景

## 备选方案 A：validateStep 8a-8d 抽离为独立函数

- **方法**: 将 Phase 8 的 4 个 validateStep case 抽离为独立的 `validateShipStep(step, outputDir, projectRoot)` 函数，在 validateStep default 分支中调用。避免在 validateStep 的 switch-case 中增加过多代码
- **核心工具**: 同主方案，但 validateStep 改为委托模式
- **风险**:
  - 增加一层间接调用，与现有 Phase 1-7 的内联 case 风格不一致
  - 测试需要额外 mock 新函数
  - 收益不大（只增加 4 个 case，代码量可控）

## 备选方案 B：Phase 8 作为独立模块 ship-orchestrator.ts

- **方法**: 新建 `mcp/src/ship-orchestrator.ts`，包含 Phase 8 的所有步骤定义、验证逻辑和 prompt 构建。orchestrator.ts 在 Phase 7 完成后委托给 ship-orchestrator 接管
- **核心工具**: 独立模块 + 委托模式
- **风险**:
  - 两个 orchestrator 之间需要协调 state 读写，增加复杂度
  - 回退到 Phase 3 需要跨模块通信
  - 与设计文档的 "Phase 8 作为原生阶段" 理念冲突
  - 测试复杂度翻倍

## 选择

选择**主方案**。理由：与现有代码风格完全一致，改动集中且可控，P0 问题有明确修复路径，无需引入新的架构概念。
