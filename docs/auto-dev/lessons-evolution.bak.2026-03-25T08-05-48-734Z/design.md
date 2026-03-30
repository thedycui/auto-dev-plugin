# 经验优胜劣汰：自动进化机制设计

> 日期: 2026-03-25
> 状态: 已评审通过，待实现
> 目标项目: auto-dev-plugin (`~/.claude/plugins/auto-dev-plugin`)

## 1. 背景与目标

### 1.1 问题

当前 auto-dev 的经验系统是"只进不出"模式：
- 经验写入后只有 `appliedCount` 递增，没有好坏区分
- 过期机制仅靠"30 天 + 0 次使用"的被动清理
- 错误或不适用的经验无法被降权或淘汰
- 经验池会无限膨胀，注入质量持续下降

### 1.2 目标

建立经验的闭环反馈机制：
- Agent 执行 Phase 后对注入的经验给出显式反馈
- 好用的经验涨分、持续留存
- 不好用的经验扣分、逐步淘汰
- 无人问津的经验自然衰减、被新经验挤出

### 1.3 核心原则

- **闭环反馈**：注入 → 使用 → 反馈 → 评分 → 排序/淘汰
- **强制执行**：反馈嵌入 checkpoint 流程，不依赖 agent 自觉
- **向后兼容**：现有 lessons JSON 文件缺失新字段时用默认值
- **可观测**：淘汰的经验标记 retired 而非物理删除，保留完整历史

### 1.4 验收标准

- **AC-1**: `preflight` 注入经验时，`state.json` 中记录 `injectedLessonIds`
- **AC-2**: `checkpoint` 检测到 `injectedLessonIds` 不为空时，返回 `lessonFeedbackRequired: true`
- **AC-3**: `auto_dev_lessons_feedback` 工具接收批量反馈，正确更新每条经验的 `score` 和 `feedbackHistory`
- **AC-4**: 正面反馈（helpful）使 score +3，负面反馈（not_applicable）使 score -1，错误反馈（incorrect）使 score -5
- **AC-5**: 全局经验池超过 50 条时，新经验写入触发淘汰（分数最低的被标记 retired）
- **AC-6**: 读取全局经验时，自动应用时间衰减（每 30 天未正面反馈扣 1 分），retired 经验不被注入
- **AC-7**: 现有的 `lessons-learned.json` 和 `lessons-global.json` 文件无需迁移，缺失字段自动补默认值

## 2. 评分模型

### 2.1 初始分

| severity | 初始 score |
|----------|-----------|
| critical | 10 |
| important | 6 |
| minor | 3 |

### 2.2 反馈加减分

| verdict | 分数变化 | 说明 |
|---------|---------|------|
| `helpful` | +3 | 经验帮助 agent 避免了问题 |
| `not_applicable` | -1 | 经验与当前场景不相关（轻微扣分，可能换个场景就有用） |
| `incorrect` | -5 | 经验内容有误或已过时（重度扣分） |

### 2.3 时间衰减

```typescript
function applyDecay(entry: LessonEntry): number {
  const referenceDate = entry.lastPositiveAt ?? entry.timestamp;
  const daysSincePositive = daysBetween(referenceDate, now);
  const decayPenalty = Math.floor(daysSincePositive / 30); // 每 30 天扣 1 分
  return Math.max(0, entry.score - decayPenalty);
}
```

- 衰减以最后一次正面反馈时间为基准
- 从未收到正面反馈的经验以创建时间为基准
- 分数下限为 0

### 2.4 经验生命周期示例

```
Day 0:  critical 经验写入，score = 10
Day 15: Phase 3 注入，agent 反馈 helpful → score = 13, lastPositiveAt = Day 15
Day 30: Phase 1 注入，agent 反馈 not_applicable → score = 12
Day 45: 衰减触发（距 lastPositiveAt 30 天）→ score = 11
Day 60: Phase 4 注入，agent 反馈 helpful → score = 14, lastPositiveAt = Day 60
...

另一条 minor 经验:
Day 0:  写入，score = 3
Day 30: 无人使用，衰减 → score = 2
Day 60: 衰减 → score = 1
Day 90: 衰减 → score = 0 → 被新经验挤出，标记 retired
```

## 3. 反馈流程

### 3.1 注入时记录

`preflight` 生成 `suggestedPrompt` 时（现有逻辑在 `index.ts` 第 616-639 行），注入经验后将 ID 列表写入 `state.json`：

```typescript
// preflight 中，注入经验后
const injectedIds = selected.map(e => e.id);
await sm.atomicUpdate({ injectedLessonIds: injectedIds });
```

注入到 prompt 中的经验文本也附带 ID，方便 agent 对照反馈：

```markdown
## 历史教训（自动注入，请在本次执行中避免重蹈覆辙）

- [id:e2c94c80] [pitfall] 跨组件的文件路径必须在 code review 中逐一比对
- [id:4d50ae10] [pitfall] Zod enum 校验会拒绝未声明的状态值

> Phase 完成后请对以上经验逐条反馈（helpful / not_applicable / incorrect）
```

### 3.2 checkpoint 强制反馈

`checkpoint` 检测到 `state.json.injectedLessonIds` 不为空时：

```json
{
  "ok": true,
  "lessonFeedbackRequired": true,
  "injectedLessonIds": ["e2c94c80-512", "4d50ae10-a6c"],
  "mandate": "请调用 auto_dev_lessons_feedback 对注入的经验逐条反馈后再继续。"
}
```

### 3.3 Agent 调用反馈工具

```typescript
auto_dev_lessons_feedback({
  projectRoot: "/path/to/project",
  topic: "session-bridge",
  feedbacks: [
    { id: "e2c94c80-512", verdict: "helpful" },
    { id: "4d50ae10-a6c", verdict: "not_applicable" }
  ]
})
```

### 3.4 反馈处理

`LessonsManager.feedback()` 方法：

```typescript
async feedback(
  feedbacks: Array<{ id: string; verdict: Verdict }>,
  meta: { phase: number; topic: string }
): Promise<void> {
  const VERDICT_SCORES = { helpful: 3, not_applicable: -1, incorrect: -5 };

  // 1. 更新本地 lessons-learned.json
  const entries = await this.readEntries();
  for (const fb of feedbacks) {
    const entry = entries.find(e => e.id === fb.id);
    if (!entry) continue;

    // 更新 score
    const delta = VERDICT_SCORES[fb.verdict];
    entry.score = Math.max(0, (entry.score ?? initialScore(entry.severity)) + delta);

    // 记录正面反馈时间
    if (fb.verdict === 'helpful') {
      entry.lastPositiveAt = new Date().toISOString();
    }

    // 追加 feedbackHistory
    entry.feedbackHistory = entry.feedbackHistory ?? [];
    entry.feedbackHistory.push({
      verdict: fb.verdict,
      phase: meta.phase,
      topic: meta.topic,
      timestamp: new Date().toISOString(),
    });
  }
  await this.writeAtomic(entries, this.filePath);

  // 2. 同步更新全局 lessons-global.json（对 reusable 经验）
  await this.syncFeedbackToGlobal(feedbacks, meta);
}
```

### 3.5 清空标记

反馈完成后，清空 `state.json` 中的 `injectedLessonIds`：

```typescript
// auto_dev_lessons_feedback 工具末尾
await sm.atomicUpdate({ injectedLessonIds: [] });
```

### 3.6 完整流程图

```
preflight
  ├── 读取经验（getGlobalLessons + get）
  ├── 过滤 retired，应用衰减排序，取 top N
  ├── 注入到 suggestedPrompt（含 ID）
  └── 写入 injectedLessonIds 到 state.json
         ↓
agent 执行 Phase（经验作为上下文参考）
         ↓
checkpoint
  ├── 检测 injectedLessonIds 不为空
  └── 返回 lessonFeedbackRequired: true + mandate
         ↓
agent 调用 auto_dev_lessons_feedback（批量）
  ├── 更新每条经验的 score + feedbackHistory
  ├── 同步到 global（如果 reusable）
  └── 清空 injectedLessonIds
         ↓
流程继续（下一个 Phase 或完成）
```

## 4. 淘汰机制

### 4.1 全局经验池上限

```typescript
const MAX_GLOBAL_POOL = 50; // 可配置
```

### 4.2 淘汰触发

每次 `addToGlobal()` 写入新经验时检查：

```typescript
async addToGlobal(entry: LessonEntry): Promise<{ added: boolean; displaced?: LessonEntry }> {
  let entries = await this.readGlobalEntries();

  // 去重
  if (entries.some(e => e.lesson === entry.lesson && !e.retired)) return { added: false };

  // 应用衰减计算实时分数
  const now = new Date();
  const scoredEntries = entries
    .filter(e => !e.retired)
    .map(e => ({ entry: e, effectiveScore: applyDecay(e, now) }));

  if (scoredEntries.length < MAX_GLOBAL_POOL) {
    // 池未满，直接写入
    entries.push(entry);
    await this.writeAtomic(entries, this.globalFilePath());
    return { added: true };
  }

  // 池已满，找分数最低的
  scoredEntries.sort((a, b) => a.effectiveScore - b.effectiveScore);
  const lowest = scoredEntries[0];

  if (entry.score > lowest.effectiveScore) {
    // 新经验挤掉旧经验
    lowest.entry.retired = true;
    lowest.entry.retiredAt = now.toISOString();
    lowest.entry.retiredReason = 'displaced_by_new';
    entries.push(entry);
    await this.writeAtomic(entries, this.globalFilePath());
    return { added: true, displaced: lowest.entry };
  }

  // 新经验分不够，拒绝写入
  return { added: false };
}
```

### 4.3 读取时过滤

`getGlobalLessons()` 改造：

```typescript
async getGlobalLessons(limit: number = MAX_GLOBAL_INJECT): Promise<LessonEntry[]> {
  const entries = await this.readGlobalEntries();
  const now = new Date();

  // 过滤 retired + 应用衰减
  const active = entries
    .filter(e => !e.retired)
    .map(e => ({ ...e, score: applyDecay(e, now) }))
    .filter(e => e.score > 0); // 衰减到 0 的也不注入

  // 按 score 降序排序
  active.sort((a, b) => b.score - a.score);

  // 取 top N
  const selected = active.slice(0, limit);

  // 更新 appliedCount
  const selectedIds = new Set(selected.map(e => e.id));
  const nowStr = new Date().toISOString();
  for (const e of entries) {
    if (selectedIds.has(e.id)) {
      e.appliedCount = (e.appliedCount ?? 0) + 1;
      e.lastAppliedAt = nowStr;
    }
  }
  await this.writeAtomic(entries, this.globalFilePath());

  return selected;
}
```

### 4.4 retired 记录

被淘汰的经验保留在 JSON 文件中，标记：

```json
{
  "id": "abc123",
  "lesson": "...",
  "score": 0,
  "retired": true,
  "retiredAt": "2026-04-25T10:00:00Z",
  "retiredReason": "displaced_by_new",
  "feedbackHistory": [...]
}
```

`retiredReason` 枚举：
- `displaced_by_new` — 被更高分的新经验挤出
- `score_decayed` — 分数衰减到 0（在 getGlobalLessons 中惰性标记）
- `manually_removed` — 用户手动删除（预留）

## 5. 数据模型变更

### 5.1 LessonEntry 新增字段

```typescript
// types.ts LessonEntrySchema 新增
score: z.number().optional(),
lastPositiveAt: z.string().optional(),
feedbackHistory: z.array(z.object({
  verdict: z.enum(['helpful', 'not_applicable', 'incorrect']),
  phase: z.number(),
  topic: z.string(),
  timestamp: z.string(),
})).optional(),
retired: z.boolean().optional(),
retiredAt: z.string().optional(),
retiredReason: z.enum(['displaced_by_new', 'score_decayed', 'manually_removed']).optional(),
```

### 5.2 StateJson 新增字段

```typescript
// types.ts StateJsonSchema 新增
injectedLessonIds: z.array(z.string()).optional(),
```

### 5.3 向后兼容

所有新字段均为 `optional`。读取时缺失字段用默认值：

```typescript
function ensureDefaults(entry: LessonEntry): LessonEntry {
  return {
    ...entry,
    score: entry.score ?? initialScore(entry.severity),
    feedbackHistory: entry.feedbackHistory ?? [],
    retired: entry.retired ?? false,
    lastPositiveAt: entry.lastPositiveAt ?? undefined,
  };
}

function initialScore(severity?: string): number {
  switch (severity) {
    case 'critical': return 10;
    case 'important': return 6;
    default: return 3;
  }
}
```

## 6. 改动范围

| 文件 | 改动内容 | 工作量 |
|------|---------|-------|
| `mcp/src/types.ts` | LessonEntry 新增 6 个字段 + StateJson 新增 injectedLessonIds | 小 |
| `mcp/src/lessons-manager.ts` | 新增 `feedback()`, `applyDecay()`, `syncFeedbackToGlobal()`, `ensureDefaults()`；改造 `addToGlobal()`, `getGlobalLessons()`, `add()` | 中 |
| `mcp/src/index.ts` | 新增 `auto_dev_lessons_feedback` MCP 工具；`preflight` 写入 injectedLessonIds；`checkpoint` 检测并返回 lessonFeedbackRequired | 中 |
| `skills/auto-dev/SKILL.md` | 更新流程说明，Phase 结束时增加经验反馈步骤 | 小 |
| `mcp/src/__tests__/lessons-manager.test.ts` | 新增评分、衰减、淘汰、反馈相关测试 | 中 |

## 7. 实现优先级

| 阶段 | 内容 | 依赖 |
|------|------|------|
| P0 | LessonEntry 类型扩展 + ensureDefaults 向后兼容 | 无 |
| P1 | 评分模型：add() 初始化 score + applyDecay() | P0 |
| P2 | feedback() 方法 + auto_dev_lessons_feedback MCP 工具 | P1 |
| P3 | preflight 注入时写 injectedLessonIds + checkpoint 强制反馈 | P2 |
| P4 | 淘汰机制：addToGlobal() 改造 + retired 标记 | P1 |
| P5 | getGlobalLessons() 改造（过滤 retired + 衰减排序） | P1 |
| P6 | SKILL.md 更新 + 单元测试 | P3, P4, P5 |
