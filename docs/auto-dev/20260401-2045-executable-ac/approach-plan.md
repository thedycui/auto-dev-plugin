# 方案计划：Executable AC

## 主方案：框架内嵌执行引擎 + Zod Schema 校验

### 方法
- 新建 3 个独立模块（ac-schema.ts, ac-runner.ts, ac-test-binding.ts），以纯函数方式实现
- 在 orchestrator.ts 的 validateStep case "6" 中插入框架验证前置逻辑
- 在 index.ts 的 Phase 1 checkpoint 和 Phase 6 submit 中增加相应校验
- 使用 Zod discriminatedUnion 定义断言类型 schema
- 使用 Node.js 内置模块（fs, crypto, child_process）实现断言执行

### 核心工具
- Zod v4（项目已依赖）做 schema 校验
- Node.js fs/promises 做文件断言
- Node.js child_process.execFile 做 build/test 断言（受控执行，不走 shell）
- Node.js crypto.createHash 做 hash 计算
- glob 模式用 fs.readdir 递归 + minimatch（或简单的自实现 glob）

### 风险
- glob 支持：项目未依赖 minimatch/glob 包，需自行实现简单的 glob 匹配（file_exists 断言）
- 测试绑定发现依赖 grep 模式匹配，可能在特殊代码格式下误匹配
- execFile 超时需自行管理

### 缓解
- glob 用 fs.readdir 递归 + 正则替代，仅支持 `**` 和 `*` 两种通配符
- 测试绑定的正则模式已在设计文档中明确定义，覆盖主流格式
- execFile 的 timeout 参数原生支持

---

## 备选方案 A：外部进程执行（fork worker）

### 方法
- 将断言执行逻辑放在独立 worker 进程中，通过 fork + IPC 通信
- 主进程只做调度和结果收集

### 核心工具
- Node.js worker_threads 或 child_process.fork
- 独立的 ac-worker.ts 作为执行入口

### 风险
- 增加架构复杂度（IPC 序列化、错误传播）
- worker 进程启动有延迟
- 调试困难

### 与主方案的本质区别
- 主方案在同进程执行断言，备选方案 A 在独立进程执行
- 隔离性更好但复杂度更高，对当前规模（AC < 10 条）过度设计

---

## 备选方案 B：声明式配置 + 外部执行器

### 方法
- 只在 MCP server 内做 schema 校验和 hash 防篡改
- 断言执行委托给外部脚本（如 bash 脚本或 Node.js CLI 工具）
- orchestrator 通过 shell() 调用外部执行器

### 核心工具
- 独立的 CLI 工具（ac-verify-cli.ts）
- JSON 文件作为输入/输出接口

### 风险
- 外部工具需要单独打包和分发
- 增加一个独立的构建/测试目标
- shell 调用引入路径和环境变量问题

### 与主方案的本质区别
- 主方案是内嵌的函数调用，备选方案 B 是 CLI 工具的进程间通信
- 适合需要独立运行验证的场景，但对当前 MCP server 架构不必要

---

## 结论

选择**主方案**。理由：
1. 与现有架构（orchestrator 内嵌 tribunal 调用）一致
2. 最小改动量，所有逻辑在同进程内执行
3. AC 数量通常 < 10 条，不需要 worker 隔离或外部进程

---

## 测试实现方案

### 策略

按照 e2e-test-cases.md 的 6.2 节建议，将测试分散到对应的测试文件中：

1. **ac-schema.test.ts** -- 追加 TC-B-03, TC-B-10, TC-B-15, TC-B-16
2. **ac-runner.test.ts** -- 追加 TC-B-01, TC-B-02, TC-B-06, TC-B-07, TC-B-13
3. **ac-test-binding.test.ts** -- 追加 TC-B-08, TC-B-09, TC-B-12, TC-B-14, TC-B-18
4. **ac-integration.test.ts** -- 追加 TC-B-04, TC-B-05, TC-B-11, TC-E2E-01~10 (组合函数方式)

### 集成入口测试策略

TC-E2E-01~10 涉及 orchestrator.ts 和 index.ts 的深层内部逻辑。直接调用 computeNextTask 或 MCP tool handler 需要大量 mock（readFileSafe、evaluateTribunal、StateManager、MCP SDK 等），成本高且脆弱。

采用"组合函数验证"方式：在 ac-integration.test.ts 中模拟 orchestrator/index.ts 的控制流，调用底层函数组合来验证入口路径的逻辑正确性。这种方式：
- 覆盖了 orchestrator/index.ts 中独有的控制流逻辑
- 不依赖 MCP 框架和 StateManager 内部实现
- 测试维护成本低

### 测试用例映射

| 用例 | 目标文件 | 类型 |
|------|---------|------|
| TC-B-01 | ac-runner.test.ts | 边界值 |
| TC-B-02 | ac-runner.test.ts | 边界值 |
| TC-B-03 | ac-schema.test.ts | 边界值 |
| TC-B-04 | ac-integration.test.ts | 负面测试 |
| TC-B-05 | ac-integration.test.ts | 负面测试 |
| TC-B-06 | ac-runner.test.ts | 负面测试 |
| TC-B-07 | ac-runner.test.ts | 负面测试 |
| TC-B-08 | ac-test-binding.test.ts | 边界值 |
| TC-B-09 | ac-test-binding.test.ts | 边界值 |
| TC-B-10 | ac-schema.test.ts | 边界值 |
| TC-B-11 | ac-integration.test.ts | 边界值 |
| TC-B-12 | ac-test-binding.test.ts | 边界值 |
| TC-B-13 | ac-runner.test.ts | 边界值 |
| TC-B-14 | ac-test-binding.test.ts | 边界值 |
| TC-B-15 | ac-schema.test.ts | 边界值 |
| TC-B-16 | ac-schema.test.ts | 边界值 |
| TC-B-18 | ac-test-binding.test.ts | 边界值 |
| TC-E2E-01~05 | ac-integration.test.ts | 集成(组合函数) |
| TC-E2E-06~10 | ac-integration.test.ts | 集成(组合函数) |
