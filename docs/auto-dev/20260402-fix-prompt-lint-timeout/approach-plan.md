# 方案计划：修复 prompt-lint 测试超时

> 任务：fix-prompt-lint-timeout（修复 prompt-lint.test.ts 偶发超时）
> 日期：2026-04-02

---

## 问题描述

`prompt-lint.test.ts` 中的两个测试用例使用 vitest 默认 5000ms 超时，而测试需要读取 14 个 .md 文件并对每个文件执行多个正则匹配。在 IO 压力大或机器性能低时，sequential `for...of` 读取可能超出 5000ms，导致偶发性超时失败。

---

## 主方案：增加测试用例超时时间（推荐）

**方法**：为两个 `it()` 调用添加第三个参数 `15000`（15 秒），将超时从默认 5000ms 提高到 15000ms。

```ts
it("no prompt file contains framework-specific terms", async () => {
  // ...
}, 15000);
```

**核心优势**：改动极小（仅 2 行），不改变任何功能逻辑，不改变测试覆盖面，零误报风险。14 个文件的 IO + 正则扫描在任何合理负载下均远低于 15 秒。

**风险**：极低。

---

## 备选方案一：并行读取文件（Promise.all）

**方法**：将 `for...of` 顺序读取改为 `Promise.all` 并行读取所有文件，减少总 IO 等待时间。

```ts
const contents = await Promise.all(
  mdFiles.map((f) => readFile(join(PROMPTS_DIR, f), "utf-8"))
);
for (let i = 0; i < mdFiles.length; i++) {
  const content = contents[i];
  // regex matching...
}
```

**与主方案的本质区别**：改变了测试的执行模型（并发 IO vs 顺序 IO），实际修改了功能逻辑代码结构，有引入 race condition 或 edge case 的潜在风险。此外若文件数量大幅增加，并发 fd 数量可能触达系统限制。

**风险**：低，但不如主方案简洁。

---

## 备选方案二：缩小扫描范围（仅扫描 git 变更文件）

**方法**：通过 `child_process.execSync('git diff --name-only HEAD')` 获取变更文件列表，仅对变更中涉及的 prompt 文件执行扫描，跳过未改动文件。

**与主方案的本质区别**：从根本上减少扫描数量，而非提高超时阈值；但这改变了测试的覆盖逻辑——CI 全量检出时 git diff 为空，会导致测试成为空操作，实际上降低了测试有效性（false pass）。

**风险**：中。在 CI 环境可能导致漏检，不推荐。

---

## 实际执行方案

采用**主方案**：

1. 在 `mcp/src/__tests__/prompt-lint.test.ts` 的两个 `it()` 调用末尾添加 `15000` 超时参数
2. 运行 `npm test` 验证全部 695 个测试通过
