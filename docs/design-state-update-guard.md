# auto_dev_state_update 状态转换守卫 — 设计文档

## 1. 问题

`auto_dev_state_update` 是一个无业务校验的低级工具，允许主 agent 任意修改 `phase` 和 `status`，包括：
- 直接将 phase 6 标记为 COMPLETED，跳过 IN_PROGRESS 和 acceptance-validator
- 向后跳过 phase（从 phase 4 直接到 phase 6）
- 将 status 设为 PASS/COMPLETED 而不经过 checkpoint 的 artifact 验证

`auto_dev_checkpoint` 有完善的门禁（phase-enforcer、artifact 验证），但主 agent 可以完全绕过它，只用 `state_update`。

## 2. 设计方案

在 `auto_dev_state_update` 中增加**状态转换守卫**，拒绝不合法的状态跳转。

### 2.1 核心规则

#### 规则 1：禁止跳过 phase
如果 `updates.phase` 存在且大于当前 `state.phase + 1`，拒绝更新。
- 允许：phase 3 → 4（前进一步）
- 允许：phase 3 → 3（同 phase 更新 task/status）
- 拒绝：phase 3 → 5（跳过 phase 4）

**例外**：允许回退（新 phase < 当前 phase），用于 NEEDS_REVISION 场景。

#### 规则 2：禁止未经 IN_PROGRESS 直接设 COMPLETED
如果 `updates.status === 'COMPLETED'` 且当前 `state.status !== 'IN_PROGRESS'` 且当前 `state.status !== 'PASS'`，拒绝更新。

#### 规则 3：Phase 前进时当前 phase 必须是 PASS
如果 `updates.phase > state.phase`（前进），且当前 `state.status !== 'PASS'`，拒绝更新。
- 必须先通过 checkpoint 将当前 phase 标为 PASS，才能前进到下一个 phase。

#### 规则 4：警告直接设 PASS（但不阻断）
如果 `updates.status === 'PASS'`，在返回结果中加入 warning，提示应使用 `auto_dev_checkpoint` 而非 `state_update`。
- 不阻断是因为有些场景（如手动恢复 dirty state）需要直接设 status。

### 2.2 返回值变化

当前返回：
```json
{ "ok": true, "updated": ["phase", "status"] }
```

新增拒绝场景返回：
```json
{ "ok": false, "error": "INVALID_TRANSITION", "message": "...", "current": { "phase": 3, "status": "IN_PROGRESS" }, "requested": { "phase": 5 } }
```

新增警告场景返回：
```json
{ "ok": true, "updated": ["status"], "warning": "建议使用 auto_dev_checkpoint 而非 state_update 来标记 PASS。" }
```

## 3. 改动范围

### 修改 `mcp/src/index.ts` — `auto_dev_state_update` tool handler

在 `atomicUpdate` 之前增加校验逻辑：

```ts
async ({ projectRoot, topic, updates }) => {
  const sm = new StateManager(projectRoot, topic);
  const current = await sm.loadAndValidate();

  // --- 状态转换守卫 ---
  const warnings: string[] = [];

  // 规则 1：禁止跳过 phase
  if (updates.phase !== undefined && updates.phase > current.phase + 1) {
    return textResult({
      ok: false,
      error: "INVALID_TRANSITION",
      message: `不能从 phase ${current.phase} 跳到 phase ${updates.phase}，最多前进一步。`,
      current: { phase: current.phase, status: current.status },
      requested: { phase: updates.phase },
    });
  }

  // 规则 2：COMPLETED 需要前置状态
  if (updates.status === "COMPLETED" && current.status !== "IN_PROGRESS" && current.status !== "PASS") {
    return textResult({
      ok: false,
      error: "INVALID_TRANSITION",
      message: `当前 status=${current.status}，不能直接设为 COMPLETED。需先经过 IN_PROGRESS 或 PASS。`,
      current: { phase: current.phase, status: current.status },
    });
  }

  // 规则 3：Phase 前进需当前 PASS
  if (updates.phase !== undefined && updates.phase > current.phase && current.status !== "PASS") {
    return textResult({
      ok: false,
      error: "INVALID_TRANSITION",
      message: `当前 phase ${current.phase} status=${current.status}，未通过不能前进到 phase ${updates.phase}。请先用 checkpoint 标记 PASS。`,
      current: { phase: current.phase, status: current.status },
      requested: { phase: updates.phase },
    });
  }

  // 规则 4：警告直接设 PASS
  if (updates.status === "PASS") {
    warnings.push("建议使用 auto_dev_checkpoint 而非 state_update 来标记 PASS，checkpoint 会执行 artifact 验证和 phase-enforcer 逻辑。");
  }

  await sm.atomicUpdate(updates);
  const result: Record<string, unknown> = { ok: true, updated: Object.keys(updates) };
  if (warnings.length > 0) result.warnings = warnings;
  return textResult(result);
},
```

## 4. 修改文件清单

| 文件 | 操作 | 预估行数 |
|---|---|---|
| `mcp/src/index.ts` | 修改 `auto_dev_state_update` handler | ~35 |
| **合计** | | **~35** |

## 5. 验收标准

- AC-1: phase 3 → phase 5 的 state_update 被拒绝，返回 `INVALID_TRANSITION` 错误
- AC-2: phase 前进（如 3→4）时，如果当前 status 不是 PASS，被拒绝
- AC-3: status 直接设为 COMPLETED 时，如果当前不是 IN_PROGRESS/PASS，被拒绝
- AC-4: status 设为 PASS 时，返回 warning 但不阻断
- AC-5: 正常操作（同 phase 更新 task、设 IN_PROGRESS、phase 回退）不受影响
- AC-6: 现有 build + test 通过
