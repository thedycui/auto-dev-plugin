# Implementation Plan: tribunal-inline-prompt

## Task 1: prepareTribunalInput 返回值变更
- **文件**: mcp/src/tribunal.ts
- **描述**: 返回 `{ digestPath: string; digestContent: string }` 而非 `string`
- **依赖**: 无
- **TDD**: skip

## Task 2: runTribunal 参数变更 + prompt 内联
- **文件**: mcp/src/tribunal.ts
- **描述**: 第一个参数从 `inputFile` 改为 `digestContent`，prompt 改为内联内容
- **依赖**: 无
- **TDD**: skip

## Task 3: runTribunalWithRetry 签名同步
- **文件**: mcp/src/tribunal.ts
- **描述**: 第一个参数从 `inputFile` 改为 `digestContent`
- **依赖**: Task 2
- **TDD**: skip

## Task 4: executeTribunal 调用链适配
- **文件**: mcp/src/tribunal.ts
- **描述**: 适配 prepareTribunalInput 新返回值，传 digestContent 给 runTribunalWithRetry，crashed 路径直接使用已有 digestContent
- **依赖**: Task 1, 3
- **TDD**: skip

## Task 5: 测试适配
- **文件**: mcp/src/__tests__/tribunal.test.ts
- **描述**: runTribunal/runTribunalWithRetry 测试用例第一个参数从文件路径改为 digest 内容字符串
- **依赖**: Task 2, 3
- **TDD**: skip

## Task 6: Build + Test 验证
- **依赖**: Task 1-5
- **TDD**: skip
