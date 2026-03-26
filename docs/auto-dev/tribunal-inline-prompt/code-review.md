# Phase 4 代码审查报告 — tribunal-inline-prompt

**审查范围**：tribunal.ts, tribunal.test.ts
**审查日期**：2026-03-26

---

## P0：无

## P1：无

## P2：优化建议

### P2-1：prompt 字符串可能非常长

`runTribunal` 的 prompt 现在包含完整 digest 内容（最大 ~32KB）。通过 `execFile` 的 argv 传递，不受 shell `ARG_MAX` 限制。但如果未来 digest 增长到更大尺寸，可能需要考虑 stdin 管道方式传递。当前风险可控。

---

## 总结

**PASS**

改动量极小（~20 行实际变更），逻辑简单直接：
1. `prepareTribunalInput` 返回类型从 `string` 改为 `{ digestPath, digestContent }` — 正确
2. `runTribunal` 参数从文件路径改为 digest 内容，prompt 从"读取文件"改为内联内容 — 正确
3. `runTribunalWithRetry` 签名同步 — 正确
4. `executeTribunal` 调用链适配，crashed 路径不再需要 readFile — 正确
5. 测试用例参数从 `/fake/input.md` 改为 `"fake digest content"` — 正确

无 dead import，无类型错误，无逻辑风险。
