# Step Orchestrator Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the long-running `auto_dev_orchestrate` MCP tool (which spawns crippled `claude -p` agents) with a stateful step-function `auto_dev_next` that returns one task at a time for the main agent to dispatch via `Agent()` subagents with full capabilities.

**Architecture:** Rewrite `orchestrator.ts` from a loop (`runOrchestrator`) to a step function (`computeNextTask`) that reads state, validates the previous step's artifacts, and returns the next task prompt. The main agent calls `auto_dev_next` in a simple loop, dispatching each task to an `Agent()` subagent. The subagent has full tool access (Read/Write/Bash/Grep) but receives only a pure task prompt with zero framework terminology.

**Tech Stack:** TypeScript, MCP SDK, Vitest, existing phase-enforcer/tribunal/state-manager modules

---

### Task 1: Rewrite orchestrator.ts as a step function

**Files:**
- Modify: `mcp/src/orchestrator.ts` (full rewrite — keep helpers, replace loop with step function)
- Modify: `mcp/src/__tests__/orchestrator.test.ts` (rewrite tests for new API)

**Step 1: Write the failing test**

Replace the contents of `mcp/src/__tests__/orchestrator.test.ts` with:

```typescript
/**
 * Tests for orchestrator.ts — step function (computeNextTask).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { containsFrameworkTerms } from "../orchestrator-prompts.js";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockExecFile = vi.fn();
vi.mock("node:child_process", () => ({
  execFile: (...args: unknown[]) => mockExecFile(...args),
  exec: vi.fn(),
}));

const mockExecuteTribunal = vi.fn();
vi.mock("../tribunal.js", () => ({
  executeTribunal: (...args: unknown[]) => mockExecuteTribunal(...args),
}));

const mockLoadAndValidate = vi.fn();
const mockInternalCheckpoint = vi.fn();
const mockAtomicUpdate = vi.fn();
vi.mock("../state-manager.js", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    StateManager: class MockStateManager {
      projectRoot: string;
      topic: string;
      outputDir: string;
      constructor(projectRoot: string, topic: string) {
        this.projectRoot = projectRoot;
        this.topic = topic;
        this.outputDir = `/tmp/test/docs/auto-dev/${topic}`;
      }
      loadAndValidate = mockLoadAndValidate;
      atomicUpdate = mockAtomicUpdate;
      outputDirExists = vi.fn().mockResolvedValue(true);
    },
    internalCheckpoint: (...args: unknown[]) => mockInternalCheckpoint(...args),
    extractTaskList: actual.extractTaskList,
  };
});

// Mock fs for artifact checks
const mockReadFile = vi.fn();
const mockStat = vi.fn();
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    readFile: (...args: unknown[]) => mockReadFile(...args),
    stat: (...args: unknown[]) => mockStat(...args),
  };
});

// Mock template-renderer
vi.mock("../template-renderer.js", () => ({
  TemplateRenderer: class {
    render = vi.fn().mockResolvedValue({
      renderedPrompt: "Rendered task prompt without framework terms",
    });
  },
}));

import { computeNextTask } from "../orchestrator.js";
import type { NextTaskResult } from "../orchestrator.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeState(overrides: Record<string, unknown> = {}) {
  return {
    projectRoot: "/tmp/test",
    topic: "test-topic",
    mode: "full",
    phase: 1,
    status: "IN_PROGRESS",
    iteration: 0,
    stack: { language: "java", buildCmd: "mvn compile", testCmd: "mvn test", langChecklist: "" },
    startCommit: "abc123",
    costMode: "beast",
    step: null,
    stepIteration: 0,
    ...overrides,
  };
}

describe("computeNextTask", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadAndValidate.mockResolvedValue(makeState());
    mockInternalCheckpoint.mockResolvedValue({ ok: true, nextDirective: { mandate: "" } });
    mockAtomicUpdate.mockResolvedValue(undefined);
    mockStat.mockRejectedValue(new Error("ENOENT")); // files don't exist by default
    mockReadFile.mockRejectedValue(new Error("ENOENT"));
  });

  it("returns design task on first call (full mode, no design.md)", async () => {
    const result = await computeNextTask("/tmp/test", "test-topic");
    expect(result.done).toBe(false);
    expect(result.task).toBeDefined();
    expect(result.agentType).toBe("auto-dev-architect");
    expect(containsFrameworkTerms(result.task!)).toBe(false);
  });

  it("returns design review task when design.md exists", async () => {
    mockLoadAndValidate.mockResolvedValue(makeState({ step: "1a" }));
    mockStat.mockResolvedValue({ size: 200 }); // design.md exists
    mockReadFile.mockResolvedValue("# Design\n\nLong enough content " + "x".repeat(100));

    const result = await computeNextTask("/tmp/test", "test-topic");
    expect(result.done).toBe(false);
    expect(result.agentType).toBe("auto-dev-reviewer");
  });

  it("turbo mode returns implementation task without plan.md", async () => {
    mockLoadAndValidate.mockResolvedValue(makeState({ mode: "turbo", phase: 3, step: null }));

    const result = await computeNextTask("/tmp/test", "test-topic");
    expect(result.done).toBe(false);
    expect(result.task).toBeDefined();
    expect(result.task).toContain("test-topic");
    expect(result.agentType).toBe("auto-dev-developer");
  });

  it("returns escalation when stepIteration exceeds max", async () => {
    mockLoadAndValidate.mockResolvedValue(makeState({ step: "1a", stepIteration: 4 }));

    const result = await computeNextTask("/tmp/test", "test-topic");
    expect(result.done).toBe(false);
    expect(result.task).toBeUndefined();
    expect(result.escalation).toBeDefined();
    expect(result.escalation!.reason).toContain("迭代");
  });

  it("returns done=true when all phases complete", async () => {
    const phases = [1, 2, 3, 4, 5, 6, 7];
    mockLoadAndValidate.mockResolvedValue(makeState({
      phase: 7,
      status: "PASS",
      step: "done",
    }));

    const result = await computeNextTask("/tmp/test", "test-topic");
    expect(result.done).toBe(true);
    expect(result.summary).toBeDefined();
  });

  it("prompt never contains framework terms", async () => {
    const result = await computeNextTask("/tmp/test", "test-topic");
    if (result.task) {
      expect(containsFrameworkTerms(result.task)).toBe(false);
    }
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/admin/.claude/plugins/auto-dev-plugin/mcp && npx vitest run src/__tests__/orchestrator.test.ts`
Expected: FAIL — `computeNextTask` is not exported from `../orchestrator.js`

**Step 3: Rewrite orchestrator.ts**

Replace the entire file contents of `mcp/src/orchestrator.ts`:

```typescript
/**
 * orchestrator.ts — Step-function orchestrator for invisible framework.
 *
 * Instead of running a loop internally (strategy A), this module exposes
 * a single `computeNextTask()` function that:
 *   1. Reads current state
 *   2. Validates previous step's artifacts
 *   3. Returns the next task prompt for a subagent
 *
 * The main agent calls `auto_dev_next` MCP tool in a simple loop,
 * dispatching each task to an Agent() subagent with full capabilities.
 * Subagents receive pure task prompts with ZERO framework terminology.
 */

import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildRevisionPrompt,
  translateFailureToFeedback,
  containsFrameworkTerms,
} from "./orchestrator-prompts.js";
import { StateManager, internalCheckpoint, extractTaskList } from "./state-manager.js";
import {
  validatePhase1ReviewArtifact,
  validatePhase2ReviewArtifact,
} from "./phase-enforcer.js";
import { executeTribunal } from "./tribunal.js";
import type { ToolResult } from "./tribunal.js";
import { TemplateRenderer } from "./template-renderer.js";
import type { StateJson } from "./types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NextTaskResult {
  done: boolean;
  task?: string;
  agentType?: string;
  model?: "opus" | "sonnet";
  escalation?: {
    reason: string;
    feedback: string;
  };
  summary?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_STEP_ITERATIONS = 3;

const ISOLATION_FOOTER = "\n\n---\n完成后不需要做其他操作。直接完成任务即可。\n";

const SKILLS_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..", "..", "skills", "auto-dev",
);

/** Phase sequences by mode */
const PHASE_SEQUENCE: Record<string, number[]> = {
  full: [1, 2, 3, 4, 5, 6, 7],
  quick: [3, 4, 5, 7],
  turbo: [3],
};

/** Agent type for each sub-step */
const STEP_AGENTS: Record<string, string> = {
  "1a": "auto-dev-architect",
  "1b": "auto-dev-reviewer",
  "1c": "auto-dev-architect",       // revision
  "2a": "auto-dev-architect",
  "2b": "auto-dev-reviewer",
  "2c": "auto-dev-architect",       // revision
  "3":  "auto-dev-developer",
  "4a": "auto-dev-developer",       // fix task (if tribunal fails)
  "5a": "auto-dev-test-architect",
  "5b": "auto-dev-developer",       // test implementation
  "5c": "auto-dev-developer",       // fix task
  "6":  "auto-dev-acceptance-validator",
  "7":  "auto-dev-reviewer",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getModel(phase: number, costMode: string): "opus" | "sonnet" {
  if (costMode === "beast") return "opus";
  if ([1, 3, 4].includes(phase)) return "opus";
  return "sonnet";
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function readFileSafe(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf-8");
  } catch {
    return null;
  }
}

function shell(
  cmd: string,
  cwd: string,
  timeout = 300_000,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    execFile("sh", ["-c", cmd], {
      cwd,
      timeout,
      maxBuffer: 5 * 1024 * 1024,
    }, (err, stdout, stderr) => {
      const exitCode = err ? ((err as any).code ?? 1) : 0;
      resolve({
        stdout: stdout || "",
        stderr: stderr || "",
        exitCode: typeof exitCode === "number" ? exitCode : 1,
      });
    });
  });
}

async function renderPrompt(
  promptFile: string,
  topic: string,
  outputDir: string,
  projectRoot: string,
  buildCmd: string,
  testCmd: string,
  extraContext?: string,
): Promise<string> {
  const renderer = new TemplateRenderer(SKILLS_DIR);
  const variables: Record<string, string> = {
    topic, output_dir: outputDir, project_root: projectRoot,
    build_cmd: buildCmd, test_cmd: testCmd,
  };
  const { renderedPrompt } = await renderer.render(promptFile, variables, extraContext);
  return renderedPrompt + ISOLATION_FOOTER;
}

function parseTribunalResult(toolResult: ToolResult): { passed: boolean; feedback?: string } {
  const text = toolResult.content[0]?.text;
  if (!text) return { passed: false, feedback: "验证返回空结果。" };

  let parsed: { status: string; issues?: Array<{ description: string }>; message?: string };
  try {
    parsed = JSON.parse(text);
  } catch {
    return { passed: false, feedback: "验证结果解析失败。" };
  }

  if (parsed.status === "TRIBUNAL_PASS") return { passed: true };

  const detail = parsed.issues
    ? JSON.stringify(parsed.issues)
    : (parsed.message ?? "验证未通过。");
  const errorCode = parsed.status === "TRIBUNAL_OVERRIDDEN" ? "TRIBUNAL_OVERRIDDEN" : "TRIBUNAL_FAIL";
  return { passed: false, feedback: translateFailureToFeedback(errorCode, detail) };
}

// ---------------------------------------------------------------------------
// Step: determine first sub-step for a phase
// ---------------------------------------------------------------------------

function firstStepForPhase(phase: number): string {
  switch (phase) {
    case 1: return "1a";
    case 2: return "2a";
    case 3: return "3";
    case 4: return "4a";
    case 5: return "5a";
    case 6: return "6";
    case 7: return "7";
    default: return `${phase}`;
  }
}

function phaseForStep(step: string): number {
  return parseInt(step.charAt(0), 10);
}

// ---------------------------------------------------------------------------
// computeNextTask — The step function
// ---------------------------------------------------------------------------

/**
 * Stateful step function: reads current state, validates previous step's
 * artifacts, returns the next task prompt.
 *
 * Called repeatedly by the main agent in a loop:
 *   while (!result.done) { dispatch(result.task); result = next(); }
 */
export async function computeNextTask(
  projectRoot: string,
  topic: string,
): Promise<NextTaskResult> {
  const sm = new StateManager(projectRoot, topic);
  const state = await sm.loadAndValidate();
  const outputDir = sm.outputDir;
  const mode = state.mode ?? "full";
  const costMode = state.costMode ?? "beast";
  const buildCmd = state.stack?.buildCmd ?? "echo 'no build'";
  const testCmd = state.stack?.testCmd ?? "echo 'no test'";
  const skipE2e = state.skipE2e === true;

  // Determine phase sequence
  let phases = PHASE_SEQUENCE[mode] ?? PHASE_SEQUENCE.full;
  if (skipE2e) phases = phases.filter((p) => p !== 5);

  // Current step state
  let step: string | null = state.step ?? null;
  let stepIteration: number = state.stepIteration ?? 0;

  // === First call: no step yet → start first phase ===
  if (!step) {
    const firstPhase = phases[0]!;
    step = firstStepForPhase(firstPhase);
    await sm.atomicUpdate({ step, stepIteration: 0, phase: firstPhase, status: "IN_PROGRESS" });
    await internalCheckpoint(sm, state, firstPhase, "IN_PROGRESS");
    return buildTaskForStep(step, topic, outputDir, projectRoot, buildCmd, testCmd, costMode);
  }

  // === Check iteration limit ===
  if (stepIteration >= MAX_STEP_ITERATIONS) {
    return {
      done: false,
      escalation: {
        reason: `迭代次数耗尽（${stepIteration}/${MAX_STEP_ITERATIONS}）`,
        feedback: state.lastValidation?.feedback ?? "多次修订仍未通过验证。",
      },
    };
  }

  // === Validate previous step's output ===
  const validation = await validateStep(step, outputDir, projectRoot, buildCmd, testCmd, sm, state);

  if (!validation.passed) {
    // Increment iteration and return revision task
    const newIteration = stepIteration + 1;
    await sm.atomicUpdate({ stepIteration: newIteration, lastValidation: { passed: false, feedback: validation.feedback } });

    if (newIteration >= MAX_STEP_ITERATIONS) {
      return {
        done: false,
        escalation: {
          reason: `迭代次数耗尽（${newIteration}/${MAX_STEP_ITERATIONS}）`,
          feedback: validation.feedback ?? "多次修订仍未通过验证。",
        },
      };
    }

    const revisionPrompt = buildRevisionPrompt({
      originalTask: `任务: ${topic}`,
      feedback: validation.feedback ?? "请根据反馈修订。",
      artifacts: validation.artifacts ?? [],
    });
    return {
      done: false,
      task: revisionPrompt + ISOLATION_FOOTER,
      agentType: STEP_AGENTS[step] ?? "auto-dev-developer",
      model: getModel(phaseForStep(step), costMode),
    };
  }

  // === Validation passed → advance to next step ===
  const nextStep = computeNextStep(step, phases, outputDir, mode);

  if (!nextStep) {
    // All phases complete — write final checkpoint
    const lastPhase = phases[phases.length - 1]!;
    await internalCheckpoint(sm, await sm.loadAndValidate(), lastPhase, "PASS");
    await sm.atomicUpdate({ step: "done", status: "PASS" });
    return { done: true, summary: `所有阶段已完成。主题: ${topic}` };
  }

  // Write checkpoint if phase changed
  const prevPhase = phaseForStep(step);
  const nextPhase = phaseForStep(nextStep);
  if (nextPhase !== prevPhase) {
    await internalCheckpoint(sm, await sm.loadAndValidate(), prevPhase, "PASS");
    await internalCheckpoint(sm, await sm.loadAndValidate(), nextPhase, "IN_PROGRESS");
  }

  await sm.atomicUpdate({ step: nextStep, stepIteration: 0, phase: nextPhase, status: "IN_PROGRESS" });
  return buildTaskForStep(nextStep, topic, outputDir, projectRoot, buildCmd, testCmd, costMode);
}

// ---------------------------------------------------------------------------
// buildTaskForStep — Render the prompt for a given step
// ---------------------------------------------------------------------------

async function buildTaskForStep(
  step: string,
  topic: string,
  outputDir: string,
  projectRoot: string,
  buildCmd: string,
  testCmd: string,
  costMode: string,
): Promise<NextTaskResult> {
  const phase = phaseForStep(step);
  let prompt: string;
  let extraContext = "";

  // Inject design/plan summaries for later phases
  if (phase >= 3) {
    const designContent = await readFileSafe(join(outputDir, "design.md"));
    if (designContent) {
      const summary = designContent.split("\n").slice(0, 80).join("\n");
      extraContext += `## 设计摘要\n\n${summary}\n\n`;
    }
  }

  switch (step) {
    case "1a":
      prompt = await renderPrompt("phase1-architect", topic, outputDir, projectRoot, buildCmd, testCmd);
      break;
    case "1b":
      prompt = await renderPrompt("phase1-design-reviewer", topic, outputDir, projectRoot, buildCmd, testCmd);
      break;
    case "2a":
      prompt = await renderPrompt("phase2-planner", topic, outputDir, projectRoot, buildCmd, testCmd, extraContext);
      break;
    case "2b":
      prompt = await renderPrompt("phase2-plan-reviewer", topic, outputDir, projectRoot, buildCmd, testCmd);
      break;
    case "3": {
      // Parse tasks from plan.md, or use topic as single task for turbo
      const planContent = await readFileSafe(join(outputDir, "plan.md"));
      if (planContent) {
        const taskListStr = extractTaskList(planContent);
        prompt = `请按照以下实施计划完成所有任务：\n\n${taskListStr}\n\n项目根目录: ${projectRoot}\n设计文档: ${outputDir}/design.md\n完整计划: ${outputDir}/plan.md` + ISOLATION_FOOTER;
      } else {
        // Turbo mode — no plan.md, use topic directly
        prompt = `请实现以下功能：${topic}\n\n项目根目录: ${projectRoot}` + ISOLATION_FOOTER;
      }
      if (extraContext) prompt = extraContext + "\n" + prompt;
      break;
    }
    case "5a":
      prompt = await renderPrompt("phase5-test-architect", topic, outputDir, projectRoot, buildCmd, testCmd, extraContext);
      break;
    case "5b":
      prompt = await renderPrompt("phase5-test-developer", topic, outputDir, projectRoot, buildCmd, testCmd, extraContext);
      break;
    case "6":
      prompt = await renderPrompt("phase6-acceptance", topic, outputDir, projectRoot, buildCmd, testCmd, extraContext);
      break;
    case "7":
      prompt = await renderPrompt("phase7-retrospective", topic, outputDir, projectRoot, buildCmd, testCmd, extraContext);
      break;
    default:
      // Fix task for tribunal phases (4a, 5c, etc.)
      prompt = `请根据之前的反馈修复代码问题。\n\n项目根目录: ${projectRoot}` + ISOLATION_FOOTER;
      break;
  }

  return {
    done: false,
    task: prompt,
    agentType: STEP_AGENTS[step] ?? "auto-dev-developer",
    model: getModel(phase, costMode),
  };
}

// ---------------------------------------------------------------------------
// validateStep — Check if previous step produced valid artifacts
// ---------------------------------------------------------------------------

async function validateStep(
  step: string,
  outputDir: string,
  projectRoot: string,
  buildCmd: string,
  testCmd: string,
  sm: StateManager,
  state: StateJson,
): Promise<{ passed: boolean; feedback?: string; artifacts?: string[] }> {
  switch (step) {
    case "1a": {
      // Check design.md exists and has content
      const content = await readFileSafe(join(outputDir, "design.md"));
      if (!content || content.length < 100) {
        return { passed: false, feedback: "设计文档不存在或内容不足。请生成完整的设计方案。", artifacts: [join(outputDir, "design.md")] };
      }
      return { passed: true };
    }

    case "1b": {
      // Check design-review.md exists and parse verdict
      const content = await readFileSafe(join(outputDir, "design-review.md"));
      const validation = validatePhase1ReviewArtifact(content);
      if (!validation.valid) {
        return { passed: false, feedback: validation.errors.join(" ") };
      }
      if (content && /\bREJECT\b/i.test(content)) {
        const feedbackMatch = content.match(/##\s*(?:反馈|Feedback|问题|Issues)\s*\n([\s\S]*?)(?=\n##|$)/);
        return { passed: false, feedback: feedbackMatch?.[1]?.trim() ?? "设计审查未通过。", artifacts: [join(outputDir, "design.md")] };
      }
      return { passed: true };
    }

    case "2a": {
      const exists = await fileExists(join(outputDir, "plan.md"));
      if (!exists) {
        return { passed: false, feedback: "实施计划不存在。请生成完整计划。", artifacts: [join(outputDir, "plan.md")] };
      }
      return { passed: true };
    }

    case "2b": {
      const content = await readFileSafe(join(outputDir, "plan-review.md"));
      const validation = validatePhase2ReviewArtifact(content);
      if (!validation.valid) {
        return { passed: false, feedback: validation.errors.join(" ") };
      }
      if (content && /\bREJECT\b/i.test(content)) {
        const feedbackMatch = content.match(/##\s*(?:反馈|Feedback|问题|Issues)\s*\n([\s\S]*?)(?=\n##|$)/);
        return { passed: false, feedback: feedbackMatch?.[1]?.trim() ?? "计划审查未通过。", artifacts: [join(outputDir, "plan.md")] };
      }
      return { passed: true };
    }

    case "3": {
      // Run build + test
      const buildResult = await shell(buildCmd, projectRoot);
      if (buildResult.exitCode !== 0) {
        return { passed: false, feedback: translateFailureToFeedback("BUILD_FAILED", buildResult.stderr.slice(0, 2000)) };
      }
      const testResult = await shell(testCmd, projectRoot);
      if (testResult.exitCode !== 0) {
        return { passed: false, feedback: translateFailureToFeedback("TEST_FAILED", testResult.stderr.slice(0, 2000)) };
      }
      return { passed: true };
    }

    case "4a":
    case "5a":
    case "5b":
    case "5c":
    case "6":
    case "7": {
      // Tribunal phases: run tribunal
      const phase = phaseForStep(step);
      // For phase 4, also run build+test first
      if (phase === 4) {
        const buildResult = await shell(buildCmd, projectRoot);
        if (buildResult.exitCode !== 0) {
          return { passed: false, feedback: translateFailureToFeedback("BUILD_FAILED", buildResult.stderr.slice(0, 2000)) };
        }
        const testResult = await shell(testCmd, projectRoot);
        if (testResult.exitCode !== 0) {
          return { passed: false, feedback: translateFailureToFeedback("TEST_FAILED", testResult.stderr.slice(0, 2000)) };
        }
      }
      // For phase 5, run tests
      if (phase === 5) {
        const testResult = await shell(testCmd, projectRoot);
        if (testResult.exitCode !== 0) {
          return { passed: false, feedback: translateFailureToFeedback("TEST_FAILED", testResult.stderr.slice(0, 2000)) };
        }
      }
      const tribunalResult = await executeTribunal(projectRoot, outputDir, phase, state.topic, `Step ${step}`, sm, state);
      return parseTribunalResult(tribunalResult);
    }

    default:
      return { passed: true };
  }
}

// ---------------------------------------------------------------------------
// computeNextStep — Determine what comes after the current step
// ---------------------------------------------------------------------------

function computeNextStep(
  currentStep: string,
  phases: number[],
  outputDir: string,
  mode: string,
): string | null {
  const transitions: Record<string, string | null> = {
    "1a": "1b",       // design → review
    "1b": "2a",       // review passed → plan
    "2a": "2b",       // plan → review
    "2b": "3",        // review passed → implement
    "3":  "4a",       // implement → verify (tribunal)
    "4a": "5a",       // verify passed → e2e test design
    "5a": "5b",       // test design → test implement
    "5b": "6",        // test implement → acceptance (tribunal)
    "6":  "7",        // acceptance passed → retrospective
    "7":  null,       // retrospective passed → done
  };

  let next = transitions[currentStep] ?? null;

  // Skip phases not in this mode's sequence
  while (next !== null) {
    const nextPhase = phaseForStep(next);
    if (phases.includes(nextPhase)) break;
    // Skip to next transition
    next = transitions[next] ?? null;
  }

  return next;
}
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/admin/.claude/plugins/auto-dev-plugin/mcp && npx vitest run src/__tests__/orchestrator.test.ts`
Expected: PASS

**Step 5: Run all tests for regression**

Run: `cd /Users/admin/.claude/plugins/auto-dev-plugin/mcp && npx vitest run`
Expected: All 266+ tests PASS

**Step 6: Commit**

```bash
cd /Users/admin/.claude/plugins/auto-dev-plugin
git add mcp/src/orchestrator.ts mcp/src/__tests__/orchestrator.test.ts
git commit -m "refactor: rewrite orchestrator as step function (computeNextTask)"
```

---

### Task 2: Replace auto_dev_orchestrate with auto_dev_next in index.ts

**Files:**
- Modify: `mcp/src/index.ts:1600-1628` (replace tool registration)

**Step 1: Replace the tool registration**

In `mcp/src/index.ts`, replace the `auto_dev_orchestrate` section (lines 1600-1628) with:

```typescript
// ===========================================================================
// 16. auto_dev_next (Step Orchestrator — Invisible Framework)
// ===========================================================================

import { computeNextTask } from "./orchestrator.js";

server.tool(
  "auto_dev_next",
  "Get the next task in the autonomous development loop. Returns a task prompt for a subagent, or done=true when complete. Call in a loop: dispatch Agent(task) then call next again.",
  {
    projectRoot: z.string(),
    topic: z.string(),
  },
  async ({ projectRoot, topic }) => {
    const result = await computeNextTask(projectRoot, topic);
    return textResult(result);
  },
);
```

Also update the import at the top of the file — replace `import { runOrchestrator } from "./orchestrator.js"` with `import { computeNextTask } from "./orchestrator.js"`.

**Step 2: Build to verify compilation**

Run: `cd /Users/admin/.claude/plugins/auto-dev-plugin/mcp && npm run build`
Expected: No errors

**Step 3: Commit**

```bash
cd /Users/admin/.claude/plugins/auto-dev-plugin
git add mcp/src/index.ts
git commit -m "feat: replace auto_dev_orchestrate with auto_dev_next step function"
```

---

### Task 3: Update SKILL.md for the next-loop pattern

**Files:**
- Modify: `skills/auto-dev/SKILL.md`

**Step 1: Write the new SKILL.md**

Replace the entire content of `skills/auto-dev/SKILL.md`:

```markdown
---
name: auto-dev
description: "自治开发循环 — 从设计到测试通过的全自动闭环。支持自审迭代，最小化人工介入。Use when user says /auto-dev, asks for autonomous development, wants a full dev loop (design -> plan -> implement -> verify -> e2e test), or mentions '自治开发', '自动开发循环', '全自动闭环', 'autonomous dev', 'auto implement'. Also use when user provides a design doc and wants it implemented end-to-end without manual intervention."
---

# auto-dev 自治开发

## 使用方式

### 1. 初始化

```
auto_dev_init(projectRoot, topic, mode?, skipE2e?, tdd?, costMode?, onConflict?)
```

- `mode` — `full`（默认）/ `quick`（跳过设计计划）/ `turbo`（仅实现）
- `costMode` — `beast`（默认，全部最强模型）/ `economy`（按阶段选模型）
- `onConflict` — `resume`（恢复上次）/ `overwrite`（覆盖重来）

### 2. 循环执行

```
result = auto_dev_next(projectRoot, topic)
while !result.done:
  if result.task:
    Agent(subagent_type=result.agentType, prompt=result.task, model=result.model)
  elif result.escalation:
    告知用户: result.escalation.reason + result.escalation.feedback
    等待用户决定后继续或终止
    break
  result = auto_dev_next(projectRoot, topic)
```

每次调用 `auto_dev_next`：
- 框架验证上一步产出（编译、测试、文档审查等）
- 返回下一个任务的 prompt 和建议的 agent 类型
- 你用 Agent() 派发 subagent 执行，subagent 有完整的工具能力

### 3. 查看状态

```
auto_dev_state_get(projectRoot, topic)
```

### 旧版模式

旧版 agent 驱动模式见 `SKILL.legacy.md`。
```

**Step 2: Verify line count**

Run: `wc -l /Users/admin/.claude/plugins/auto-dev-plugin/skills/auto-dev/SKILL.md`
Expected: < 50 lines

**Step 3: Verify no framework terms leak**

Run: `cd /Users/admin/.claude/plugins/auto-dev-plugin/mcp && npx vitest run src/__tests__/prompt-lint.test.ts`
Expected: PASS (SKILL.md is not in prompts dir, so lint test still passes)

**Step 4: Commit**

```bash
cd /Users/admin/.claude/plugins/auto-dev-plugin
git add skills/auto-dev/SKILL.md
git commit -m "feat: update SKILL.md for auto_dev_next loop pattern"
```

---

### Task 4: Build, full regression, and final verification

**Files:** None (verification only)

**Step 1: Build**

Run: `cd /Users/admin/.claude/plugins/auto-dev-plugin/mcp && npm run build`
Expected: Clean compilation

**Step 2: Run all tests**

Run: `cd /Users/admin/.claude/plugins/auto-dev-plugin/mcp && npx vitest run`
Expected: All tests PASS

**Step 3: Verify auto_dev_next is registered**

Run: `grep -n "auto_dev_next" /Users/admin/.claude/plugins/auto-dev-plugin/mcp/src/index.ts`
Expected: Tool registration line

**Step 4: Verify auto_dev_orchestrate is gone**

Run: `grep -n "auto_dev_orchestrate" /Users/admin/.claude/plugins/auto-dev-plugin/mcp/src/index.ts`
Expected: No matches

**Step 5: Verify SKILL.md line count**

Run: `wc -l /Users/admin/.claude/plugins/auto-dev-plugin/skills/auto-dev/SKILL.md`
Expected: < 50

**Step 6: Commit dist files and push**

```bash
cd /Users/admin/.claude/plugins/auto-dev-plugin/mcp && npm run build
cd /Users/admin/.claude/plugins/auto-dev-plugin
git add -f mcp/dist/orchestrator.js mcp/dist/orchestrator.js.map mcp/dist/index.js mcp/dist/index.js.map
git commit -m "chore: rebuild dist for step orchestrator"
git push origin master
```
