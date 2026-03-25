# 经验优胜劣汰：自动进化机制设计

> 日期: 2026-03-25
> 状态: 已评审修订 v2，待实现
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
- **AC-8**: 对全局经验（不在本地文件中）的反馈必须正确更新全局文件的 `score` 和 `feedbackHistory`
- **AC-9**: 如果 agent 跳过反馈直接 checkpoint PASS，checkpoint 必须硬拒绝（不只是 hint）
- **AC-10**: `promoteReusableLessons()` 必须使用新的 `addToGlobal()` 逻辑（含淘汰机制），不绕过

## 2. 评分模型

### 2.0 全局常量（P2-3 fix）

```typescript
// 所有可调参数集中定义
const SCORE_INITIAL = { critical: 10, important: 6, minor: 3 } as const;
const SCORE_DELTA = { helpful: 3, not_applicable: -1, incorrect: -5 } as const;
const DECAY_PERIOD_DAYS = 30;        // 每多少天扣 1 分
const MAX_GLOBAL_POOL = 50;          // 全局经验池上限
const MAX_GLOBAL_INJECT = 10;        // 单次注入上限
const MAX_FEEDBACK_HISTORY = 20;     // feedbackHistory 最大条目数（P2-1 fix）
const MIN_DISPLACEMENT_MARGIN = 2;   // 新经验替换旧经验的最小分差（P1-2 fix）
```

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

`checkpoint` 检测到 `state.json.injectedLessonIds` 不为空时，**硬拒绝 PASS**（不只是 hint）：

```typescript
// [P1-1 fix] 在 checkpoint 预验证阶段，PASS 时检查反馈是否已提交
if (status === "PASS") {
  const pendingIds = state.injectedLessonIds ?? [];
  if (pendingIds.length > 0) {
    // 硬拒绝：不写 progress-log，不更新 state.json
    return {
      error: "LESSON_FEEDBACK_REQUIRED",
      lessonFeedbackRequired: true,
      injectedLessonIds: pendingIds,
      feedbackInstruction: "必须先调用 auto_dev_lessons_feedback 对注入的经验逐条反馈，然后再 checkpoint PASS。",
      note: "Checkpoint rejected BEFORE writing state. No state pollution.",
    };
  }
}
```

> **[P1-4 fix]** 使用 `feedbackInstruction` 字段而非 `mandate`，避免与 `computeNextDirective` 的导航 mandate 冲突。

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
  const now = new Date().toISOString();

  // [P0-2 fix] 搜索本地 + 全局两个文件，确保全局经验的反馈不被丢弃
  const localEntries = await this.readEntries();
  const globalEntries = await this.readGlobalEntries();

  const localUpdated = new Set<string>();
  const globalUpdated = new Set<string>();

  for (const fb of feedbacks) {
    const delta = VERDICT_SCORES[fb.verdict];
    const historyEntry = { verdict: fb.verdict, phase: meta.phase, topic: meta.topic, timestamp: now };

    // 先在本地文件中查找
    const localEntry = localEntries.find(e => e.id === fb.id);
    if (localEntry) {
      localEntry.score = Math.max(0, (localEntry.score ?? initialScore(localEntry.severity)) + delta);
      if (fb.verdict === 'helpful') localEntry.lastPositiveAt = now;
      localEntry.feedbackHistory = [...(localEntry.feedbackHistory ?? []), historyEntry].slice(-20); // P2-1: cap at 20
      localUpdated.add(fb.id);
    }

    // 在全局文件中查找（无论本地是否找到，全局副本也需要同步更新）
    const globalEntry = globalEntries.find(e => e.id === fb.id && !e.retired);
    if (globalEntry) {
      globalEntry.score = Math.max(0, (globalEntry.score ?? initialScore(globalEntry.severity)) + delta);
      if (fb.verdict === 'helpful') globalEntry.lastPositiveAt = now;
      globalEntry.feedbackHistory = [...(globalEntry.feedbackHistory ?? []), historyEntry].slice(-20);
      globalUpdated.add(fb.id);
    }
  }

  // 分别写入，错误隔离（一个文件写入失败不影响另一个）
  if (localUpdated.size > 0) {
    await this.writeAtomic(localEntries, this.filePath).catch(() => {});
  }
  if (globalUpdated.size > 0) {
    await this.writeAtomic(globalEntries, this.globalFilePath()).catch(() => {});
  }
}
```

> **[P1-3 fix]** `syncFeedbackToGlobal()` 已废弃，不再需要。上述 `feedback()` 直接同时操作本地和全局文件，两者独立写入、错误隔离。

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

  // [P1-2 fix] 新经验必须比最低分高出 MIN_DISPLACEMENT_MARGIN 才能替换，
  // 防止无反馈历史的新经验轻易挤掉有实际使用记录的老经验
  const MIN_DISPLACEMENT_MARGIN = 2;
  if (entry.score > lowest.effectiveScore + MIN_DISPLACEMENT_MARGIN) {
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

  // [P0-1 fix] 惰性退休：衰减到 0 的经验立即标记 retired 并持久化，
  // 防止"幽灵条目"占据池名额
  let retiredCount = 0;
  for (const e of entries) {
    if (!e.retired && applyDecay(e, now) <= 0) {
      e.retired = true;
      e.retiredAt = now.toISOString();
      e.retiredReason = 'score_decayed';
      retiredCount++;
    }
  }

  // 过滤 retired + 应用衰减
  const active = entries
    .filter(e => !e.retired)
    .map(e => ({ ...e, score: applyDecay(e, now) }));

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

  // 持久化（包含 retired 标记和 appliedCount 更新）
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
- `score_decayed` — 分数衰减到 0（在 getGlobalLessons 中惰性标记并持久化）
- `manually_removed` — 用户手动删除（预留）

### 4.5 promoteReusableLessons 统一化（P1-5 fix）

> 现有 `promoteReusableLessons()` 在 Phase 7 retrospective 中批量推广 reusable 经验到全局。
> **必须改造为调用新的 `addToGlobal()`**，使其受淘汰机制约束。不能绕过 displacement 逻辑直接写入。

```typescript
async promoteReusableLessons(topic?: string): Promise<number> {
  const entries = await this.readEntries();
  let promoted = 0;
  for (const e of entries) {
    if (e.reusable && !e.retired) {
      const result = await this.addToGlobal(ensureDefaults(e)); // 走统一的淘汰逻辑
      if (result.added) promoted++;
    }
  }
  return promoted;
}
```

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
| `mcp/src/lessons-manager.ts` | 新增 `feedback()`, `applyDecay()`, `ensureDefaults()`；改造 `addToGlobal()`, `getGlobalLessons()`, `add()`, `promoteReusableLessons()`；**删除** `syncFeedbackToGlobal()`（P1-3 fix: feedback() 直接操作两个文件） | 中 |
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
