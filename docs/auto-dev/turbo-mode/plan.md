# Implementation Plan: turbo-mode

## Task 1: types.ts — ModeSchema 新增 turbo
- **文件**: mcp/src/types.ts
- **描述**: ModeSchema 从 `z.enum(["full", "quick"])` 改为 `z.enum(["full", "quick", "turbo"])`
- **依赖**: 无

## Task 2: phase-enforcer.ts — REQUIRED_PHASES_TURBO + computeNextDirective + validateCompletion
- **文件**: mcp/src/phase-enforcer.ts
- **描述**: 新增 `REQUIRED_PHASES_TURBO = [3, 4]`。computeNextDirective 中 turbo 模式 maxPhase=4。validateCompletion 中 turbo 模式使用 REQUIRED_PHASES_TURBO。
- **依赖**: Task 1

## Task 3: index.ts — auto_dev_init mode 参数
- **文件**: mcp/src/index.ts
- **描述**: auto_dev_init 的 mode 参数 z.enum 新增 "turbo"
- **依赖**: Task 1

## Task 4: SKILL.md — turbo 模式说明 + 自动模式选择 + 新 flag
- **文件**: skills/auto-dev/SKILL.md
- **描述**: 新增 Turbo Mode 章节说明，新增自动模式选择指南（估算规则），args 解析支持 --turbo 和 --full flag
- **依赖**: 无

## Task 5: Build + Test 验证
- **依赖**: Task 1-4
