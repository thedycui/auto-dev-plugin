# 设计文档：auto-dev + ship-loop 交付集成

## 1. 背景与动机

auto-dev 的输出是**本地通过测试的代码**，ship-loop 的输入是**需要部署验证的代码**。目前需要用户手动衔接：先 `/auto-dev` 再 `/ship-loop`。

**目标**：一条命令 `/auto-dev topic=xxx ship=true` 从需求到测试环境验证通过，全程自动。

## 2. 方案选型

| 方案 | 描述 | 优点 | 缺点 |
|------|------|------|------|
| A: 串行衔接 | auto-dev 完成后提示用户手动调 ship-loop | 零开发 | 需人工介入，不是真正的闭环 |
| **B: Phase 8** | auto-dev 新增可选 Phase 8，内嵌 ship-loop 逻辑 | 一条命令到上线，完整审计 | 需修改 orchestrator + 新增 step |
| C: 双向联动 | ship-loop 发现 bug 自动创建 auto-dev 修复 | 全自动修复 | 嵌套闭环，容易死循环 |

**选择方案 B**，理由：用户体验最好，架构改动可控，与现有 orchestrator 一致。

## 3. 整体架构

```
Phase 1-4:  设计 → 计划 → 实现 → 审查     (现有，不改)
Phase 5:    E2E 测试                        (现有，不改)
Phase 6:    验收                            (现有，不改)
Phase 7:    复盘                            (现有，不改)
Phase 8:    交付验证 (ship)                  (新增，可选)
  ├── Step 8a: commit + push
  ├── Step 8b: build + 轮询
  ├── Step 8c: deploy + 等待启动
  └── Step 8d: 远程验证 + 看日志
```

### 激活条件

Phase 8 仅在以下条件下激活：
- init 时传入 `ship=true`（显式激活）
- **且**提供了 `deployTarget`（DevOps 组件名）和 `deployBranch`（部署分支）

不激活时，Phase 7 完成后直接 COMPLETED，行为与现有完全一致。

### 失败回退

Phase 8 某步失败时：
- 构建失败 → 分析日志 → 修代码 → 重试 step 8a-8b（Phase 8 内部循环，不回退 Phase）
- 部署失败 → 分析日志 → 重试 step 8c
- 远程验证失败 → 分析日志：
  - 如果是代码 bug → 回退到 Phase 3 修代码 → 重新走 Phase 4-8
  - 如果是环境问题 → ESCALATE 给用户

最大轮次：Phase 8 内部最多 5 轮（与 ship-loop 默认一致），超过则 ESCALATE。

## 4. 改动范围

### 4.1 types.ts — state.json 新增字段

```typescript
// 新增 ship 相关字段
ship: z.boolean().optional(),               // 是否启用 Phase 8 交付验证
deployTarget: z.string().optional(),        // DevOps 组件名 (如 "xxt-dubbo-words")
deployBranch: z.string().optional(),        // 部署分支 (如 "common-test")
deployEnv: z.string().optional(),           // 目标环境 (如 "green")
verifyMethod: z.enum(["api", "log", "test", "combined"]).optional(),
verifyConfig: z.object({                    // 验证配置
  endpoint: z.string().optional(),          // API endpoint
  expectedPattern: z.string().optional(),   // 预期返回匹配
  logPath: z.string().optional(),           // 日志路径
  logKeyword: z.string().optional(),        // 日志关键词
  sshHost: z.string().optional(),           // SSH 主机
}).optional(),
shipRound: z.number().int().optional(),     // 当前交付轮次
shipMaxRounds: z.number().int().optional(), // 最大轮次 (默认 5)
```

### 4.2 orchestrator.ts — Phase 8 步骤定义

```typescript
// PHASE_SEQUENCE 修改
const PHASE_SEQUENCE: Record<string, number[]> = {
  full: [1, 2, 3, 4, 5, 6, 7],     // 不变
  quick: [3, 4, 5, 7],              // 不变
  turbo: [3],                       // 不变
};
// Phase 8 不写入静态 PHASE_SEQUENCE，而是动态追加：
// computeNextTask 中：
let phases = PHASE_SEQUENCE[mode] ?? [3];
if (state.skipE2e === true) phases = phases.filter(p => p !== 5);
if (state.ship === true) phases = [...phases, 8];  // 动态追加

// STEP_ORDER 修改
const STEP_ORDER = [
  "1a", "1b", "2a", "2b", "3", "4a", "5a", "5b", "6", "7",
  "8a", "8b", "8c", "8d",  // 新增
];

// STEP_AGENTS 新增
"8a": "auto-dev-developer",    // commit + push
"8b": "auto-dev-developer",    // build + 轮询（调 devops MCP）
"8c": "auto-dev-developer",    // deploy + 等待
"8d": "auto-dev-developer",    // 远程验证 + 看日志

// firstStepForPhase 新增
8: "8a",
```

### 4.3 orchestrator.ts — Step 8a-8d 验证逻辑

```typescript
case "8a": {
  // 验证：git status 确认已 commit + push
  // 检查 git log --branches --not --remotes 是否为空
  const unpushed = await shell("git log --oneline --branches --not --remotes", projectRoot);
  if (unpushed.stdout.trim()) {
    return { passed: false, feedback: "有未 push 的 commit，请先 push" };
  }
  return { passed: true, feedback: "" };
}

case "8b": {
  // 验证：检查 outputDir/ship-build-result.md 存在且包含 "SUCCEED"
  const buildResult = await readFileSafe(join(outputDir, "ship-build-result.md"));
  if (!buildResult || !buildResult.includes("SUCCEED")) {
    return { passed: false, feedback: "构建未成功，请检查构建日志" };
  }
  return { passed: true, feedback: "" };
}

case "8c": {
  // 验证：检查 outputDir/ship-deploy-result.md 存在且包含 "SUCCEED"
  const deployResult = await readFileSafe(join(outputDir, "ship-deploy-result.md"));
  if (!deployResult || !deployResult.includes("SUCCEED")) {
    return { passed: false, feedback: "部署未成功，请检查部署日志" };
  }
  return { passed: true, feedback: "" };
}

case "8d": {
  // 验证：检查 outputDir/ship-verify-result.md 存在且包含 "PASS"
  const verifyResult = await readFileSafe(join(outputDir, "ship-verify-result.md"));
  if (!verifyResult || !verifyResult.includes("PASS")) {
    return { passed: false, feedback: "远程验证未通过" };
  }
  return { passed: true, feedback: "" };
}
```

### 4.4 orchestrator.ts — Phase 8 回退逻辑

Phase 8 的失败处理与 Phase 3-4 不同：

- **8a/8b 失败**（push/构建问题）：在 Phase 8 内部重试，不回退 Phase
- **8c 失败**（部署问题）：在 Phase 8 内部重试
- **8d 失败**（验证发现代码 bug）：回退到 Phase 3，走完整 3→4→...→8

```typescript
// 在 validateStep 的 case "8d" 失败分支中：
if (verifyResult && verifyResult.includes("CODE_BUG")) {
  // 代码问题 → 回退到 Phase 3
  return {
    passed: false,
    feedback: verifyResult,
    regressToPhase: 3,  // 新增字段，orchestrator 识别后回退
  };
}
```

orchestrator 在处理验证失败时，检查 `regressToPhase`：

```typescript
if (validation.regressToPhase) {
  const regressStep = firstStepForPhase(validation.regressToPhase);
  await writeStepState(sm.stateFilePath, {
    step: regressStep,
    stepIteration: 0,
    lastValidation: "SHIP_REGRESS",
  });
  await sm.atomicUpdate({
    phase: validation.regressToPhase,
    status: "IN_PROGRESS",
    shipRound: (state.shipRound ?? 0) + 1,
  });
  // 检查最大轮次
  if ((state.shipRound ?? 0) + 1 >= (state.shipMaxRounds ?? 5)) {
    return { done: false, step: null, agent: null, prompt: null,
      escalation: { reason: "ship_max_rounds", feedback: "..." } };
  }
  // 返回 Phase 3 的 prompt
  return buildTaskForStep(regressStep, ...);
}
```

### 4.5 prompts/ — 新增 Phase 8 prompt 模板

新建 `skills/auto-dev/prompts/phase8-ship.md`：

```markdown
# Phase 8: 交付验证

## 任务

将代码部署到测试环境并验证功能正常。

## 上下文

- 组件: {{deployTarget}}
- 分支: {{deployBranch}}
- 环境: {{deployEnv}}
- 验证方式: {{verifyMethod}}
{{#if verifyConfig.endpoint}}
- API: {{verifyConfig.endpoint}}
- 预期: {{verifyConfig.expectedPattern}}
{{/if}}
{{#if verifyConfig.logPath}}
- 日志: {{verifyConfig.logPath}}
- 关键词: {{verifyConfig.logKeyword}}
{{/if}}

## Step 8a: Commit + Push

1. `git add` 所有改动文件
2. `git commit -m "feat({{topic}}): ..."`
3. 取消代理后 push: `unset https_proxy; unset http_proxy; git push origin {{deployBranch}}`
4. 确认 push 成功

## Step 8b: 构建

1. 调用 `mcp__devops__devops_build_and_deploy("{{deployTarget}}", "{{deployBranch}}")`
2. 每 30 秒调用 `mcp__devops__devops_status("{{deployTarget}}")` 轮询
3. 最多等 10 分钟
4. 成功 → 将结果写入 `ship-build-result.md`
5. 失败 → 调用 `mcp__devops__devops_build_log` 分析原因，修复后重试

## Step 8c: 部署

1. 调用 `mcp__devops__devops_deploy("{{deployTarget}}", "{{deployEnv}}")`
2. 每 20 秒轮询状态，最多 5 分钟
3. 成功后等待 45 秒让服务启动
4. 将结果写入 `ship-deploy-result.md`

## Step 8d: 远程验证

{{#if verifyMethod == "api"}}
通过 SSH 在服务器上 curl 验证：
```bash
curl -s "{{verifyConfig.endpoint}}" | grep "{{verifyConfig.expectedPattern}}"
```
{{/if}}
{{#if verifyMethod == "log"}}
SSH 到服务器检查日志：
```bash
grep "{{verifyConfig.logKeyword}}" {{verifyConfig.logPath}} | tail -20
```
{{/if}}

验证通过 → 写入 `ship-verify-result.md`（含 "PASS"）
验证失败 → 写入 `ship-verify-result.md`（含 "CODE_BUG" 或 "ENV_ISSUE"），分析原因
```

### 4.6 index.ts — auto_dev_init 新增参数

```typescript
// auto_dev_init 参数新增
ship: z.boolean().optional(),
deployTarget: z.string().optional(),
deployBranch: z.string().optional(),
deployEnv: z.string().optional(),
verifyMethod: z.enum(["api", "log", "test", "combined"]).optional(),
verifyConfig: z.object({
  endpoint: z.string().optional(),
  expectedPattern: z.string().optional(),
  logPath: z.string().optional(),
  logKeyword: z.string().optional(),
  sshHost: z.string().optional(),
}).optional(),
shipMaxRounds: z.number().optional(),

// behaviorUpdates 新增
if (ship) {
  behaviorUpdates["ship"] = true;
  if (!deployTarget) {
    return textResult({ error: "MISSING_DEPLOY_TARGET",
      message: "ship=true 需要提供 deployTarget（DevOps 组件名）" });
  }
  behaviorUpdates["deployTarget"] = deployTarget;
  behaviorUpdates["deployBranch"] = deployBranch ?? git.currentBranch;
  behaviorUpdates["deployEnv"] = deployEnv ?? "green";
  if (verifyMethod) behaviorUpdates["verifyMethod"] = verifyMethod;
  if (verifyConfig) behaviorUpdates["verifyConfig"] = verifyConfig;
  behaviorUpdates["shipMaxRounds"] = shipMaxRounds ?? 5;
  behaviorUpdates["shipRound"] = 0;
}

// INIT marker 新增 ship 字段
` ship=${ship === true}`
```

### 4.7 phase-enforcer.ts — Phase 8 纳入完成验证

```typescript
// PHASE_META 新增
8: { name: "SHIP", description: "交付验证" },

// REQUIRED_PHASES 不改 — Phase 8 是可选的
// validateCompletion 修改：
const requiredPhases = skipE2e
  ? basePhases.filter((p) => p !== 5)
  : basePhases;
// 如果 ship=true，追加 Phase 8
if (state.ship === true) {
  requiredPhases.push(8);
}
```

注意：`validateCompletion` 目前不接收完整 state，只接收 `mode`/`isDryRun`/`skipE2e`。需要新增 `ship` 参数。

### 4.8 tribunal — Phase 8 不需要 tribunal

Phase 8 的验证是硬数据驱动的（构建成功/部署成功/远程验证通过），不需要 LLM 裁决。与 Phase 7（复盘）类似，Phase 8 在 `auto_dev_submit` 中直接处理：

```typescript
// index.ts auto_dev_submit 新增
if (phase === 8) {
  // Phase 8 直接 PASS，不走 tribunal
  const ckptSummary = `[SHIP] 交付验证完成。${summary}`;
  await internalCheckpoint(sm, state, phase, "PASS", ckptSummary);
  return textResult({
    status: "TRIBUNAL_PASS",
    phase,
    nextPhase: null,
    mandate: "交付完成，所有阶段通过。",
    message: "Phase 8 交付验证通过，无需独立裁决。",
  });
}
```

### 4.9 SKILL.md — 更新使用文档

```markdown
### 1. 初始化

auto_dev_init(projectRoot, topic, ..., ship?, deployTarget?, deployBranch?, ...)

- `ship` — 启用 Phase 8 交付验证（默认 false）
- `deployTarget` — DevOps 组件名（ship=true 时必填）
- `deployBranch` — 部署分支（默认当前分支）
- `deployEnv` — 目标环境（默认 "green"）
```

## 5. 不改动的部分

- Phase 1-7 全部不改
- 现有测试全部不改
- ship-loop skill 本身不改（仍可独立使用）
- tribunal 机制不改（Phase 8 不走 tribunal）

## 6. 数据流

```
auto_dev_init(ship=true, deployTarget="app", deployBranch="common-test")
  │
  ▼
Phase 1-7 (正常流程)
  │
  ▼ Phase 7 PASS
  │
orchestrator: phases 包含 8 → computeNextStep("7", [..., 8]) → "8a"
  │
  ▼
Step 8a: agent commit+push → 验证 git 无 unpushed → PASS
  │
  ▼
Step 8b: agent 调 devops_build_and_deploy → 轮询 → 写 ship-build-result.md → 验证 → PASS
  │
  ▼
Step 8c: agent 调 devops_deploy → 轮询 → 等启动 → 写 ship-deploy-result.md → 验证 → PASS
  │
  ▼
Step 8d: agent SSH 验证 → 写 ship-verify-result.md → 验证 → PASS
  │
  ▼
auto_dev_complete → Phase 8 已 PASS → COMPLETED
```

失败路径（8d 发现代码 bug）：

```
Step 8d FAIL (CODE_BUG)
  │
  ▼ regressToPhase=3, shipRound++
  │
Step 3: 修代码 → Step 4a: 审查 → ... → Step 8a: 重新 push → ... → Step 8d: 再验证
  │
  ▼ shipRound < shipMaxRounds?
  ├── 是 → 继续
  └── 否 → ESCALATE 给用户
```

## 7. 风险与缓解

| 风险 | 缓解措施 |
|------|---------|
| Phase 8 回退到 Phase 3 后死循环 | shipMaxRounds 限制（默认 5），超过 ESCALATE |
| DevOps MCP 不可用 | 构建/部署超时后 ESCALATE，不阻塞 |
| 远程验证误判 CODE_BUG vs ENV_ISSUE | prompt 引导 agent 区分，ENV_ISSUE 直接 ESCALATE 不回退 |
| 分支冲突（push 失败） | Step 8a agent 负责处理 merge conflict，失败则 ESCALATE |
| Phase 8 引入的字段污染现有 state | 所有新字段 optional，不影响未启用 ship 的 session |

## 8. 改动文件清单

| 文件 | 改动类型 | 改动内容 |
|------|---------|---------|
| `mcp/src/types.ts` | 修改 | StateJsonSchema 新增 ship 相关字段 |
| `mcp/src/orchestrator.ts` | 修改 | STEP_ORDER、STEP_AGENTS、firstStepForPhase 新增 8a-8d；validateStep 新增 case；computeNextTask 动态追加 Phase 8；回退逻辑 |
| `mcp/src/index.ts` | 修改 | auto_dev_init 新增参数；auto_dev_submit Phase 8 处理；auto_dev_complete 验证 Phase 8 |
| `mcp/src/phase-enforcer.ts` | 修改 | PHASE_META 新增 8；validateCompletion 新增 ship 参数 |
| `skills/auto-dev/prompts/phase8-ship.md` | 新建 | Phase 8 prompt 模板 |
| `skills/auto-dev/SKILL.md` | 修改 | 新增 ship 参数说明 |
| `mcp/src/__tests__/orchestrator.test.ts` | 修改 | Phase 8 步骤推进、skipE2e+ship 组合、回退逻辑测试 |
| `mcp/src/__tests__/improvements.test.ts` | 修改 | validateCompletion 新增 ship 参数测试 |

## 9. 预估改动量

- 源代码：~300 行
- 测试代码：~200 行
- prompt 模板：~80 行
- 总计：~580 行

不属于小任务快捷模式范围，需要走 auto-dev 全流程。
