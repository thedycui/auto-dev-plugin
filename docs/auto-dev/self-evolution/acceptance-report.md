# 验收报告: auto-dev 自进化 (self-evolution)

**验收日期**: 2026-03-29
**Design 文档**: `docs/auto-dev/self-evolution/design.md` Section 7
**测试套件**: 3 files, 60 tests, 0 failures

| AC | 描述 | 验证方式 | 结果 | 证据 |
|----|------|---------|------|------|
| AC-1 | `getCrossProjectLessons()` 从 `~/.auto-dev/lessons-global.json` 读取, 按 decayed score 降序返回 top-N (默认 N=15), 文件不存在时返回空数组 | 代码审查 + 单元测试 | PASS | `lessons-manager.ts:285-319` — 方法实现, 默认 limit=MAX_CROSS_PROJECT_INJECT(15). `lessons-manager.test.ts:722-753` — "returns empty array when global file does not exist", "returns entries sorted by decayed score descending" |
| AC-2 | `promoteToGlobal()` 将 Project 层中 reusable=true 且 applyDecay>=6 的条目写入 Global, 去重, 返回晋升数量 | 代码审查 + 单元测试 + E2E | PASS | `lessons-manager.ts:322-345` — 实现. `lessons-manager.test.ts:758-841` — "promotes reusable entries with score >= minScore (AC-2)", "deduplicates by lesson text", "sets sourceProject and promotionPath". `self-evolution-e2e.test.ts:53-89` — full pipeline E2E |
| AC-3 | Global 层 pool 满 (100条) 时, 新条目的 decayed score 超过最低分 + MIN_DISPLACEMENT_MARGIN 才能淘汰, 否则拒绝 | 代码审查 + 单元测试 | PASS | `lessons-manager.ts:351-398` — addToCrossProject displacement 逻辑, MAX_CROSS_PROJECT_POOL=100. `lessons-manager.test.ts:950-1017` — "pool at limit: high-score entry displaces lowest", "pool at limit: low-score entry rejected when margin not met" |
| AC-4 | `auto_dev_init()` 调用 `injectGlobalLessons()`, 将 lesson IDs 写入 `state.injectedGlobalLessonIds` | 代码审查 + E2E | PASS | `index.ts:1284-1307` — init 流程中调用 injectGlobalLessons(), 收集 ID 并通过 atomicUpdate 写入 injectedGlobalLessonIds. `types.ts:157` — StateJsonSchema 包含 injectedGlobalLessonIds 字段. `self-evolution-e2e.test.ts:91-112` — cross-project injection E2E |
| AC-5 | Phase 7 Retrospective 完成后自动调用 `promoteToGlobal()` | 代码审查 + E2E | PASS | `retrospective.ts:96-99` — `crossProjectPromoted = await lessons.promoteToGlobal()`. `self-evolution-e2e.test.ts:135-175` — "retrospective integration: promoteToGlobal called during retrospective", 验证 crossProjectPromoted >= 1 且 Global 文件包含正确条目 |
| AC-6 | `LessonEntry` 新增 sourceProject/promotedAt/promotionPath 均为 optional, 旧 JSON 无需迁移 | 代码审查 + 单元测试 + E2E | PASS | `types.ts:71-73` — 三个字段均标记 `.optional()`. `lessons-manager.test.ts:901-923` — "old JSON without new fields deserializes correctly", 验证旧格式条目的新字段为 undefined. `self-evolution-e2e.test.ts:177-208` — "data compatibility: old-format entries survive full pipeline" |
| AC-7 | self-assess.md 可被 `TemplateRenderer.render()` 正确渲染 | 代码审查 + 单元测试 | PASS | `skills/auto-dev/prompts/self-assess.md` — 模板文件存在, 使用 `{project_root}` 和 `{output_dir}` 变量. `template-renderer.test.ts:12-27` — "AC-7: self-assess.md renders with project_root and output_dir variables", 验证变量替换成功且无关键 warnings |
| AC-8 | Self-Assess 执行后产出 improvement-candidates.md, 含 title/type/priority/evidence | 运行验证 | SKIP | 需要实际执行 Self-Assess (启动 Claude 会话), 无法在单元测试中验证. self-assess.md prompt 模板中明确定义了输出格式要求 (��� 54-68), 但实际产出依赖 LLM 运行时行为 |
| AC-9 | 旧方法名通过别名导出仍可调用, 编译通过, 测试全 PASS | 代码审查 + 单元测试 + E2E + 构建 | PASS | `lessons-manager.ts:261-275` — getGlobalLessons/addToGlobal/promoteReusableLessons/readGlobalEntries 四个别名均有 `@deprecated` 标记并委托到新方法. `lessons-manager.test.ts:855-897` — 四个别名均有专门测试. `self-evolution-e2e.test.ts:114-133` — E2E 验证旧方法名端到端可用. e2e-test-results.md: "tsc --noEmit: clean (0 errors)", "490 tests, 0 failures" |
| AC-10 | 空 Global 文件返回空数组; 格式异常文件返回空数组, 不抛异常 | 代码审查 + 单元测试 | PASS | `lessons-manager.ts:401-408` — readCrossProjectEntries 的 catch 块返回 []. `lessons-manager.test.ts:925-945` — "handles malformed cross-project JSON gracefully (AC-10)", "handles empty array cross-project JSON (AC-10)", "file not found returns empty array (AC-10)" — 三个正向/负向测试 |
| AC-11 | `promoteToGlobal()` 对 applyDecay < 6 的条目不晋升, 返回 0 | 代码审查 + 单元测试 | PASS | `lessons-manager.ts:331` — `if (applyDecay(e, now) < minScore) continue;`. `lessons-manager.test.ts:786-799` — "rejects low-score entries (AC-11)", score=3 entry 不被晋升, promoted=0 |

## 总结

**通过率**: 10/11 PASS, 0 FAIL, 1 SKIP

| 状态 | 数量 | AC 编号 |
|------|------|---------|
| PASS | 10 | AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-7, AC-9, AC-10, AC-11 |
| FAIL | 0 | — |
| SKIP | 1 | AC-8 |

**AC-8 SKIP 原因**: Self-Assess 的实际产出验证需要启动 Claude 会话 (Ephemeral Proxy) 执行 LLM 推理, 属于集成/运行时验证, 无法在单元测试或本地自动化中完成. prompt 模板本身的渲染已通过 AC-7 验证.

**结论**: PASS (所有可自动验证的 AC 全部通过; 唯一 SKIP 项需要集成环境)
