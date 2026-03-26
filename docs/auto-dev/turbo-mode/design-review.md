# Design Review: turbo-mode

## 总体评价：PASS

## 检查结果

- [x] 三级模式设计清晰，各模式的必需 Phase 列表明确
- [x] turbo 模式保留 Phase 4（代码审查 tribunal）作为最低质量门禁，合理
- [x] 自动模式选择放在 SKILL.md 编排层，不增加 MCP 工具复杂度
- [x] 用户可通过 --turbo/--quick/--full 显式覆盖，灵活性足够
- [x] 向后兼容：现有 full/quick 模式行为不变
- [x] 改动范围完整：types.ts、phase-enforcer.ts、index.ts、SKILL.md、测试

## P1: computeNextDirective 中 turbo 模式的 Phase 跳转逻辑需明确

turbo 模式必需 Phase 为 [3, 4]。当 startPhase=3 时，Phase 3 PASS 后 computeNextDirective 返回 nextPhase=4。Phase 4 PASS 后需要返回 canDeclareComplete=true。

当前逻辑是 `let nextPhase = currentPhase + 1`，然后检查 `nextPhase > maxPhase`。turbo 模式需要修改 maxPhase 或在 nextPhase=5 时检查 turbo 模式直接返回 canDeclareComplete。

建议：在 computeNextDirective 中，turbo 模式时 maxPhase=4（而非 7），这样 Phase 4 PASS 后 nextPhase=5 > maxPhase=4，自然返回 canDeclareComplete=true。

## 无 P0 问题
