# 验收报告: lessons-evolution

> Date: 2026-03-25
> Validator: auto-dev-acceptance-validator
> Design: docs/auto-dev/lessons-evolution/design.md (Section 1.4)
> Test run: 92/92 passed (vitest 3.2.4, 3.19s)

## 验收结果

| AC | 描述 | 验证方式 | 结果 | 证据 |
|----|------|---------|------|------|
| AC-1 | preflight 注入经验时，state.json 中记录 injectedLessonIds | 代码审查 + 单元测试 | PASS | index.ts:750 `await sm.atomicUpdate({ injectedLessonIds: injectedIds })` -- preflight 在注入 local+global 经验后写入 IDs; types.ts:138 StateJsonSchema 定义 `injectedLessonIds: z.array(z.string()).optional()`; tests #31, #35 验证写入和清空 |
| AC-2 | checkpoint 检测 injectedLessonIds 不为空时返回 lessonFeedbackRequired: true | 代码审查 + 单元测试 | PASS | index.ts:356-367 checkpoint 在 status=PASS 时检查 `state.injectedLessonIds`, 非空则返回 `{ error: "LESSON_FEEDBACK_REQUIRED", lessonFeedbackRequired: true }`; test #32 验证 |
| AC-3 | auto_dev_lessons_feedback 工具接收批量反馈，正确更新 score 和 feedbackHistory | 代码审查 + 单元测试 | PASS | lessons-manager.ts:73-131 `feedback()` 方法遍历 feedbacks 数组，对 local/global 条目同时更新 score(+delta) 和 feedbackHistory(append+slice); index.ts:889-917 MCP 工具定义接受 `feedbacks: Array<{id, verdict}>`; tests #12-16, #18 验证 |
| AC-4 | helpful +3, not_applicable -1, incorrect -5 | 代码审查 + 单元测试 | PASS | lessons-constants.ts:8 `SCORE_DELTA = { helpful: 3, not_applicable: -1, incorrect: -5 }`; lessons-manager.ts:88 `delta = SCORE_DELTA[fb.verdict]`; tests #12 (helpful +3=8), #13 (not_applicable -1=4), #14 (incorrect -5=1) 全部验证 |
| AC-5 | 全局经验池超过 50 条时新经验写入触发淘汰 | 代码审查 + 单元测试 | PASS | lessons-constants.ts:10 `MAX_GLOBAL_POOL = 50`; lessons-manager.ts:187-235 `addToGlobal()` 检查 active.length < MAX_GLOBAL_POOL, 满则找最低分, 新分须超过 lowest+MIN_DISPLACEMENT_MARGIN(2) 才替换, 被替换者标记 `retired: true, retiredReason: "displaced_by_new"`; tests #19-23 验证(pool under limit, displacement with margin, below margin rejected, dedup, retired don't count) |
| AC-6 | 时间衰减(30d/-1pt), retired 不注入, score_decayed 持久化 | 代码审查 + 单元测试 | PASS | lessons-manager.ts:14-20 `applyDecay()` 以 lastPositiveAt/timestamp 为基准, 每30天扣1分, floor 0; lessons-manager.ts:134-168 `getGlobalLessons()` 惰性退休 applyDecay<=0 的条目, 标记 `retiredReason: "score_decayed"`, 写回文件; 过滤 retired 后按 score desc 排序返回 top N; tests #7-11 (decay), #24-28 (sort, lazy retirement, filter, appliedCount, limit) 验证 |
| AC-7 | 向后兼容, 缺失字段自动补默认值 | 代码审查 + 单元测试 | PASS | types.ts:70-80 所有新字段均为 `.optional()`; lessons-constants.ts:29-36 `ensureDefaults()` 补 score/feedbackHistory/retired; lessons-manager.ts:98 feedback 中 `entry.score ?? initialScore(entry.severity)` 兜底; tests #1-6 验证(critical=10, important=6, minor=3, undefined=3, legacy gets default, existing preserved) |
| AC-8 | 全局经验(不在本地)的反馈正确更新全局文件 | 代码审查 + 单元测试 | PASS | lessons-manager.ts:109-120 feedback() 在 globalMap 中查找并独立更新; lessons-manager.ts:127-128 globalUpdated>0 时单独写入全局文件; test #17 (global-only feedback) 和 #18 (dual-file feedback) 验证 |
| AC-9 | agent 跳过反馈直接 checkpoint PASS 时硬拒绝 | 代码审查 + 单元测试 | PASS | index.ts:356-367 checkpoint 在 PASS 时检查 pendingIds, 非空则 return error 对象(不写 progress-log, 不更新 state); tests #32 (pending IDs block PASS), #33 (empty IDs allow PASS), #34 (non-PASS not blocked) 验证 |
| AC-10 | promoteReusableLessons 使用 addToGlobal (含淘汰机制) | 代码审查 + 单元测试 | PASS | lessons-manager.ts:171-181 `promoteReusableLessons()` 对 reusable && !retired 的条目调用 `this.addToGlobal(ensureDefaults({...e, topic}))`, 走统一淘汰逻辑; tests #29 (promote reusable only, topic set) 和 #30 (dedup prevents double promote) 验证 |

## SKILL.md 更新确认

SKILL.md (skills/auto-dev/SKILL.md) 已更新:
- 驱动循环中新增 `auto_dev_lessons_feedback(feedbacks)` 步骤 (line 35)
- 重要约束中详述三种 verdict 和 checkpoint 拒绝逻辑 (lines 44-48)

## 测试覆盖

- lessons-manager.test.ts: 35 tests, ALL PASS
- 全套: 7 test files, 92 tests, ALL PASS
- 每个 AC 至少有 2 个测试用例覆盖

## 总结

通过率: **10/10 PASS, 0 FAIL, 0 SKIP**

结论: **PASS**
