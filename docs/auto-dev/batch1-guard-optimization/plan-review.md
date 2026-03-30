# 计划审查报告: batch1-guard-optimization

> 审查日期: 2026-03-26
> 审查对象: `docs/auto-dev/batch1-guard-optimization/plan.md`
> 对照文档: `docs/auto-dev/batch1-guard-optimization/design.md`

---

## A. 覆盖度（设计 vs 计划逐项核对）

| 设计章节 | 设计功能点 | 对应 Task | 覆盖? |
|----------|-----------|-----------|-------|
| 4.1 改动 A | 删除 checkpoint 守卫 (index.ts:424-436) | Task 1 | OK |
| 4.1 改动 B | Phase 7 自动清理 injectedLessonIds | Task 4 | OK |
| 4.1 改动 C | 更新 lessons_feedback 工具描述 | Task 3 | OK |
| 4.1 改动 D | 删除 preflight 中的反馈提示文本 | Task 2 | OK |
| 4.1 测试更新 | lessons-manager.test.ts 修改 + 新增测试 | Task 5 | OK |
| 4.2 | auto_dev_complete 状态一致性检测 | Task 6 | OK |
| 4.2 测试 | 正向 + 负向测试 | Task 7 | OK |
| 4.3 改动 A | Schema 新增 advisory + acRef (optional) | Task 8 | OK |
| 4.3 改动 B | auto-override 逻辑 (含 acRef 降级) | Task 9 | OK |
| 4.3 改动 C | checklist 范围约束文本 | Task 10 | OK |
| 4.3 改动 D | prompt 范围限制说明 | Task 11 | OK |
| 4.3 测试 | tribunal schema + override + checklist 测试 | Task 14 | OK |
| 4.4 改动 0 | types.ts category 枚举新增 "tribunal" | Task 12 | OK |
| 4.4 主改动 | tribunal lessons 注入 | Task 13 | OK |
| 4.4 测试 | lessons 注入测试 | Task 14 | OK |

**结论: 设计文档中的所有功能点均有对应 task，覆盖完整。**

---

## B. 任务粒度（Independent, Small, Testable）

- Task 1-4 (Issue #9 的四个改动): 拆分合理，每个改动独立且小。
- Task 6 (Issue #5): 独立，约 15 行，可测试。
- Task 8-11 (Issue #10 的四个改动): 拆分合理。Task 9 依赖 Task 8，合理。
- Task 12-13 (Tribunal 校准): Task 13 依赖 Task 12，合理。
- Task 14 (统一测试 task): 依赖 Task 8-13 全部完成。
- Task 15 (全量验证): 正确放在最后。

**无粒度问题。**

---

## C. 依赖关系

依赖图:
```
Task 1 ──┐
Task 4 ──┤── Task 5
         │
Task 6 ──── Task 7
         │
Task 8 ──── Task 9 ──┐
Task 10 ─────────────┤
Task 11 ─────────────┤── Task 14
Task 12 ──── Task 13 ┘
         │
Task 1-14 ──── Task 15
```

- 所有依赖均显式标注。
- 无循环依赖。
- 依赖方向正确（schema 先于 override 逻辑，枚举先于 lessons 注入）。

**无依赖问题。**

---

## D. 任务描述质量

逐项检查每个 task 是否包含：文件路径、改动描述、完成标准。

| Task | 文件路径 | 改动描述 | 完成标准 | 评价 |
|------|---------|---------|---------|------|
| 1 | OK | OK | OK | - |
| 2 | OK | OK | OK | - |
| 3 | OK | OK | OK | - |
| 4 | OK | OK | OK | - |
| 5 | OK | OK | OK | - |
| 6 | OK | OK | OK | - |
| 7 | OK | OK | OK | - |
| 8 | OK | OK | OK | - |
| 9 | OK | OK | OK | 描述详细，包含 tribunalLog const->let 注意事项 |
| 10 | OK | OK | OK | - |
| 11 | OK | OK | OK | - |
| 12 | OK | OK | OK | - |
| 13 | OK | OK | OK | - |
| 14 | OK | OK | OK | - |
| 15 | OK（无修改） | OK | OK | - |

**描述质量良好，包含具体行号和代码位置。**

---

## E. 完整性

- [x] 包含测试任务（Task 5, 7, 14）
- [x] 包含全量验证（Task 15）
- [x] 任务顺序合理（功能实现在前，测试在后，全量验证最后）
- [x] 与设计文档的文件影响矩阵（第 5 节）一致

---

## Issues

### P2: Task 1-4 可合并为单个 Task

Task 1-4 都属于 Issue #9（删除 lessons 守卫），改动总量约 25 行，分散在同一个文件 `index.ts` 中。拆成 4 个 task 增加了切换开销，且它们之间没有真正的独立性（都是同一个功能的不同方面）。建议合并为 1 个 task，完成标准合并为 AC-1/AC-2/AC-3/AC-4 全覆盖。

不过考虑到当前拆分也能正常执行且不会引发错误，标记为 P2。

### P2: Task 14 依赖过多，可能导致阻塞

Task 14 依赖 Task 8-13 共 6 个 task 全部完成。如果其中任何一个 task 延迟，所有测试都被阻塞。考虑将 schema 测试（对应 Task 8）和 auto-override 测试（对应 Task 9）拆分出来作为独立测试 task，在对应实现 task 完成后立即验证。

不过这只影响执行效率，不影响正确性，标记为 P2。

---

## 总结

**PASS**

计划完整覆盖设计文档的所有功能点和测试需求。Task 粒度合理（略偏细但可接受），依赖关系正确且无循环，描述质量良好（包含文件路径、行号、完成标准）。两个 P2 优化建议不阻塞执行。
