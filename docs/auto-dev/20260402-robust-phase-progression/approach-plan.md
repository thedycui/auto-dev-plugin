# 方案计划：robust-phase-progression 覆盖缺口测试

日期：2026-04-02

## 当前状态

- `npm test`：**729 个测试全部通过（29 个测试文件）**
- 覆盖缺口：AC-2 和 AC-12 无对应测试

## 覆盖缺口

根据 e2e-test-cases.md 的 AC 绑定矩阵，以下测试需要新增：

| AC | 缺口 | TC |
|----|------|-----|
| AC-2 | `auto_dev_complete` 的 worktree merge+cleanup 序列 | TC-2 |
| AC-12 | `auto_dev_init` resume 路径的 worktree 复用和重建 | TC-13, TC-14 |

---

## 主方案（选用）

### 方案 A：Mock MCP SDK，捕获 tool handler，直接调用

**方法**：
1. 新建 `mcp/src/__tests__/worktree-handlers.test.ts`
2. 在 `vi.mock("@modelcontextprotocol/sdk/server/mcp.js", ...)` 中创建一个收集 handler 的 mock McpServer
3. 同时 mock `server/stdio.js`（拦截 main() 中的 StdioServerTransport + server.connect）
4. Import `../index.js` — 触发所有 `server.tool(...)` 调用，handlers 被收集到 Map
5. 从 Map 取出 `auto_dev_complete` / `auto_dev_init` 的 handler 直接调用
6. Mock `node:child_process.execFile` 拦截 git 命令序列并断言

**核心工具**：vitest + vi.mock + execFile 拦截

**优点**：
- 真正测试 index.ts 中的实现逻辑，不是替代品
- 与现有 worktree-integration.test.ts 的 mock 模式一致
- 满足"至少新增 1 个测试文件"硬性要求

**风险**：
- index.ts import 有大量依赖，需要 mock 所有相关模块避免 crash
- `main()` 会在 import 时调用 `server.connect()`，需要 mock McpServer.connect 为 no-op

---

## 备选方案 B：提取 worktree 逻辑为独立函数，测试函数

**方法**：将 worktree merge/cleanup 逻辑提取到独立函数

**缺点**：需要修改 index.ts，超出测试任务范围

**结论**：不采用

---

## 备选方案 C：在现有文件中通过 computeNextTask 间接覆盖

**缺点**：AC-2 和 AC-12 的逻辑在 index.ts handler 中，computeNextTask 不经过这段代码，无法真正验证

**结论**：不采用

---

## 执行步骤

1. 写 `approach-plan.md`（当前文档）
2. 新建 `mcp/src/__tests__/worktree-handlers.test.ts`，包含：
   - `describe("AC-2: auto_dev_complete worktree merge and cleanup")` — TC-2
   - `describe("AC-12: worktree resume — reuse or rebuild")` — TC-13, TC-14
3. 运行 `npm test` 确认全部通过
4. 写 `e2e-test-results.md`
