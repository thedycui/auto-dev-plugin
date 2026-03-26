# 设计文档：分级快捷模式（turbo mode）

## 背景

当前 auto-dev 只有 full 和 quick 两种模式。对 ≤20 行的小改动，三次 tribunal 裁决占用 72% 时间。需要新增 turbo 模式，并支持自动模式选择。

## 方案

### 三级模式

| 模式 | 必需 Phase | Tribunal | 适用场景 |
|------|-----------|----------|---------|
| turbo | [3, 4] | 1 次 | ≤20 行、≤2 文件、无新接口 |
| quick | [3, 4, 5, 7] | 2 次 | 21-50 行、≤3 文件 |
| full | [1,2,3,4,5,6,7] | 4 次 | >50 行或跨模块 |

### 自动模式选择

在 SKILL.md 编排层指导主 Agent 根据任务描述自动估算改动范围并选择模式。用户可通过 --turbo/--quick/--full 显式覆盖。

## 改动范围

1. types.ts: ModeSchema 新增 "turbo"
2. phase-enforcer.ts: REQUIRED_PHASES_TURBO、computeNextDirective turbo 支持、validateCompletion turbo 支持
3. index.ts: auto_dev_init mode 参数新增 "turbo"
4. SKILL.md: 新增 turbo 模式说明 + 自动模式选择指南 + --turbo/--full flag
5. 测试适配

## 验收标准

- AC-1: mode: "turbo" 可在 auto_dev_init 中使用
- AC-2: turbo 模式只需 Phase 3 + Phase 4 PASS 即可 auto_dev_complete
- AC-3: computeNextDirective 在 turbo 模式 Phase 4 PASS 后返回 canDeclareComplete: true
- AC-4: 现有 full/quick 模式行为不变
- AC-5: SKILL.md 包含自动模式选择指南
- AC-6: Build 通过，所有现有测试通过
