# 设计文档：Tribunal Prompt 内联优化

## 背景

当前 `runTribunal` 通过 `claude -p "读取 ${inputFile} 并按照检查清单逐条裁决"` 调用 tribunal agent。tribunal agent 需要先用 Read 工具读取 digest 文件（1+ turn），然后逐条分析（N turns）。当 digest 较大（Phase 4: 32KB/591行），总 turns 超过 claude CLI 默认限制，导致 `error_max_turns` 崩溃。

## 方案

将 digest 内容直接内联到 `-p` prompt 中，消除 Read 工具调用的 turn 开销。

### 改动点

1. `prepareTribunalInput` 返回值从 `string`（路径）改为 `{ digestPath: string; digestContent: string }`
2. `runTribunal` 第一个参数从 `inputFile: string` 改为 `digestContent: string`，prompt 内联 digest 内容
3. `runTribunalWithRetry` 同步变更签名
4. `executeTribunal` 调用链适配
5. 测试用例参数适配

### 不做的事

- 不移除 `--dangerously-skip-permissions`
- 不改变 digest 写文件逻辑（审计需要）
- 不改变 crossValidate/fallback 逻辑

## 验收标准

- AC-1: `runTribunal` 的 prompt 中直接包含 digest 内容，不再引用文件路径
- AC-2: `prepareTribunalInput` 返回 `{ digestPath, digestContent }` 结构
- AC-3: Build 通过，所有现有测试通过
