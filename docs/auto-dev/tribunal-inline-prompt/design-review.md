# Design Review: tribunal-inline-prompt

## 总体评价：PASS

改动范围极小（~30行，2文件），方案简单直接：将 digest 内容从"文件引用"改为"prompt 内联"。

## 检查结果

- [x] 方案解决了核心问题（消除 Read turn 开销）
- [x] 不引入新依赖
- [x] 向后兼容（digest 文件仍然写入，审计链完整）
- [x] 风险评估：prompt 长度（32KB）远在 CLI 限制和模型上下文窗口内
- [x] AC 覆盖核心改动点

## 无 P0/P1 问题
