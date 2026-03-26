/**
 * orchestrator.ts — Step-function orchestrator for auto-dev.
 *
 * Exports `computeNextTask()` which is called once per step by the main agent.
 * Each call validates the previous step's artifacts, then returns the next
 * task prompt for the main agent to dispatch via Agent() subagent.
 *
 * No agent spawning happens here — the orchestrator only computes prompts.
 */

import { execFile } from "node:child_process";
import { readFile, stat, writeFile } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildRevisionPrompt,
  translateFailureToFeedback,
  containsFrameworkTerms,
  parseApproachPlan,
  extractOneLineReason,
  buildCircuitBreakPrompt,
} from "./orchestrator-prompts.js";
import type { ApproachEntry, FailedApproach } from "./orchestrator-prompts.js";
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
  /** Whether all phases are done */
  done: boolean;
  /** The current step (e.g. "1a", "3", "7") */
  step: string | null;
  /** Which agent to dispatch to */
  agent: string | null;
  /** The task prompt for the agent (framework-term-free) */
  prompt: string | null;
  /** Whether this is an escalation (iteration limit exceeded) */
  escalation?: {
    reason: string;
    lastFeedback: string;
  };
  /** When true, the prompt should be executed in a fresh subagent context (clean slate, no prior failure context) */
  freshContext?: boolean;
  /** Informational message */
  message: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_STEP_ITERATIONS = 3;
const MAX_APPROACH_FAILURES = 2;

const PHASE_SEQUENCE: Record<string, number[]> = {
  full: [1, 2, 3, 4, 5, 6, 7],
  quick: [3, 4, 5, 7],
  turbo: [3],
};

const STEP_AGENTS: Record<string, string> = {
  "1a": "auto-dev-architect",
  "1b": "auto-dev-reviewer",
  "1c": "auto-dev-architect",
  "2a": "auto-dev-architect",
  "2b": "auto-dev-reviewer",
  "2c": "auto-dev-architect",
  "3": "auto-dev-developer",
  "4a": "auto-dev-developer",
  "5a": "auto-dev-test-architect",
  "5b": "auto-dev-developer",
  "5c": "auto-dev-developer",
  "6": "auto-dev-acceptance-validator",
  "7": "auto-dev-reviewer",
};

/** Ordered step transitions (happy path) */
const STEP_ORDER = ["1a", "1b", "2a", "2b", "3", "4a", "5a", "5b", "6", "7"];

const ISOLATION_FOOTER = "\n\n---\n完成后不需要做其他操作。直接完成任务即可。\n";

const SKILLS_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..", "..", "skills", "auto-dev",
);

// ---------------------------------------------------------------------------
// Model Routing
// ---------------------------------------------------------------------------

export function getModel(phase: number, costMode: string): "opus" | "sonnet" {
  if (costMode === "beast") return "opus";
  if ([1, 3, 4].includes(phase)) return "opus"; // critical phases
  return "sonnet";
}

// ---------------------------------------------------------------------------
// File Helpers
// ---------------------------------------------------------------------------

export async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export async function readFileSafe(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf-8");
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Shell Helper
// ---------------------------------------------------------------------------

export function shell(
  cmd: string,
  cwd: string,
  timeout: number = 300_000,
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

// ---------------------------------------------------------------------------
// Prompt Rendering
// ---------------------------------------------------------------------------

export async function renderPrompt(
  promptFile: string,
  variables: Record<string, string>,
  extraContext?: string,
): Promise<string> {
  const renderer = new TemplateRenderer(SKILLS_DIR);
  const { renderedPrompt } = await renderer.render(
    promptFile,
    variables,
    extraContext,
  );
  return renderedPrompt + ISOLATION_FOOTER;
}

// ---------------------------------------------------------------------------
// Tribunal Result Parser
// ---------------------------------------------------------------------------

export function parseTribunalResult(toolResult: ToolResult): { passed: boolean; feedback: string } {
  const text = toolResult.content[0]?.text;
  if (!text) {
    return { passed: false, feedback: "Tribunal returned empty result." };
  }

  let parsed: { status: string; issues?: Array<{ description: string }>; message?: string };
  try {
    parsed = JSON.parse(text);
  } catch {
    return { passed: false, feedback: "Failed to parse tribunal result." };
  }

  if (parsed.status === "TRIBUNAL_PASS") {
    return { passed: true, feedback: "" };
  }

  if (parsed.status === "TRIBUNAL_FAIL" || parsed.status === "TRIBUNAL_OVERRIDDEN") {
    const detail = parsed.issues
      ? JSON.stringify(parsed.issues)
      : (parsed.message ?? "Tribunal failed.");
    const feedback = translateFailureToFeedback(
      parsed.status === "TRIBUNAL_FAIL" ? "TRIBUNAL_FAIL" : "TRIBUNAL_OVERRIDDEN",
      detail,
    );
    return { passed: false, feedback };
  }

  // TRIBUNAL_PENDING (crash)
  return {
    passed: false,
    feedback: translateFailureToFeedback("TRIBUNAL_FAIL", parsed.message ?? "Tribunal process crashed."),
  };
}

// ---------------------------------------------------------------------------
// Step State Helpers (raw JSON read/write for extra fields)
// ---------------------------------------------------------------------------

export interface ApproachState {
  stepId: string;
  approaches: ApproachEntry[];
  currentIndex: number;
  failedApproaches: FailedApproach[];
}

interface StepState {
  step: string | null;
  stepIteration: number;
  lastValidation: string | null;
  approachState: ApproachState | null;
}

export type ApproachAction =
  | { action: "CONTINUE"; approachState?: ApproachState; planFeedback?: string }
  | { action: "CIRCUIT_BREAK"; prompt: string; approachState: ApproachState; failedApproach: string; nextApproach: string }
  | { action: "ALL_EXHAUSTED" };

async function readStepState(stateFilePath: string): Promise<StepState> {
  try {
    const raw = JSON.parse(await readFile(stateFilePath, "utf-8"));
    return {
      step: raw.step ?? null,
      stepIteration: raw.stepIteration ?? 0,
      lastValidation: raw.lastValidation ?? null,
      approachState: raw.approachState ?? null,
    };
  } catch {
    return { step: null, stepIteration: 0, lastValidation: null, approachState: null };
  }
}

async function writeStepState(
  stateFilePath: string,
  updates: Partial<StepState>,
): Promise<void> {
  let raw: Record<string, unknown> = {};
  try {
    raw = JSON.parse(await readFile(stateFilePath, "utf-8"));
  } catch {
    // file doesn't exist or is corrupt — we'll just write what we have
  }
  Object.assign(raw, updates, { updatedAt: new Date().toISOString() });
  await writeFile(stateFilePath, JSON.stringify(raw, null, 2), "utf-8");
}

// ---------------------------------------------------------------------------
// Phase / Step Helpers
// ---------------------------------------------------------------------------

/** Extract the phase number from a step string (e.g. "1a" -> 1, "3" -> 3) */
export function phaseForStep(step: string): number {
  return parseInt(step.replace(/[a-z]/g, ""), 10);
}

/** Return the first sub-step for a given phase */
export function firstStepForPhase(phase: number): string {
  const map: Record<number, string> = {
    1: "1a", 2: "2a", 3: "3", 4: "4a", 5: "5a", 6: "6", 7: "7",
  };
  return map[phase] ?? String(phase);
}

/**
 * Compute the next step in sequence, skipping steps whose phase
 * is not in the mode's phase sequence.
 */
export function computeNextStep(currentStep: string, phases: number[]): string | null {
  const idx = STEP_ORDER.indexOf(currentStep);
  if (idx < 0) return null;

  for (let i = idx + 1; i < STEP_ORDER.length; i++) {
    const candidate = STEP_ORDER[i]!;
    const candidatePhase = phaseForStep(candidate);
    if (phases.includes(candidatePhase)) {
      return candidate;
    }
  }
  return null; // all done
}

// ---------------------------------------------------------------------------
// Circuit Breaker — approach failure handling
// ---------------------------------------------------------------------------

/** Extract the goal for a given step from plan.md */
async function getStepGoal(step: string, outputDir: string): Promise<string> {
  const planPath = join(outputDir, "plan.md");
  const content = await readFileSafe(planPath);
  if (!content) return `完成步骤 ${step} 的任务`;

  // Try to find a task section matching the step number
  const phase = parseInt(step.replace(/[a-z]/g, ""), 10);
  // Look for "## Task N:" or similar patterns
  const taskRegex = new RegExp(
    `## Task\\s+${phase}[^\\n]*\\n([\\s\\S]*?)(?=\\n## |$)`,
    "i",
  );
  const match = content.match(taskRegex);
  if (match) {
    // Extract the description line (first line after heading)
    const descLine = match[1].split("\n").map((l) => l.trim()).filter((l) => l.length > 0)[0];
    if (descLine) return descLine;
  }

  return `完成步骤 ${step} 的任务`;
}

export async function handleApproachFailure(
  stepState: StepState,
  step: string,
  outputDir: string,
  feedback: string,
): Promise<ApproachAction> {
  let approachState = stepState.approachState;

  // First failure with no approach state: try to parse approach-plan.md
  if (!approachState) {
    const planPath = join(outputDir, "approach-plan.md");
    const planContent = await readFileSafe(planPath);
    if (!planContent) {
      return { action: "CONTINUE" };
    }
    const approaches = parseApproachPlan(planContent);
    if (!approaches) {
      return {
        action: "CONTINUE",
        planFeedback: "你的 approach-plan.md 缺少备选方案。请补充至少 1 个与主方案技术路径有本质区别的备选方案（换参数/换 flag 不算，换工具/换思路才算）。",
      };
    }
    approachState = {
      stepId: step,
      approaches,
      currentIndex: 0,
      failedApproaches: [],
    };
  }

  // Increment current approach failCount
  const current = approachState.approaches[approachState.currentIndex];
  if (!current) {
    return { action: "ALL_EXHAUSTED" };
  }
  current.failCount++;

  // Below threshold: continue with revision
  if (current.failCount < MAX_APPROACH_FAILURES) {
    return { action: "CONTINUE", approachState };
  }

  // Threshold reached: circuit break current approach
  approachState.failedApproaches.push({
    id: current.id,
    summary: current.summary,
    failReason: extractOneLineReason(feedback),
  });
  approachState.currentIndex++;

  // Check if there are more approaches
  if (approachState.currentIndex >= approachState.approaches.length) {
    return { action: "ALL_EXHAUSTED" };
  }

  const next = approachState.approaches[approachState.currentIndex];
  const goal = await getStepGoal(step, outputDir);

  // Build clean prompt
  const prompt = buildCircuitBreakPrompt({
    goal,
    approach: next.summary,
    prohibited: approachState.failedApproaches,
    outputDir,
  });

  return {
    action: "CIRCUIT_BREAK",
    prompt,
    approachState,
    failedApproach: current.summary,
    nextApproach: next.summary,
  };
}

// ---------------------------------------------------------------------------
// Step Validation
// ---------------------------------------------------------------------------

export async function validateStep(
  step: string,
  outputDir: string,
  projectRoot: string,
  buildCmd: string,
  testCmd: string,
  sm: StateManager,
  state: StateJson,
  topic: string,
): Promise<{ passed: boolean; feedback: string }> {
  switch (step) {
    case "1a": {
      const designPath = join(outputDir, "design.md");
      const content = await readFileSafe(designPath);
      if (!content || content.length < 100) {
        return {
          passed: false,
          feedback: "design.md 不存在或内容不足（< 100 字符），请补充完整的设计方案。",
        };
      }
      return { passed: true, feedback: "" };
    }

    case "1b": {
      const reviewPath = join(outputDir, "design-review.md");
      const content = await readFileSafe(reviewPath);
      const validation = validatePhase1ReviewArtifact(content);
      if (!validation.valid) {
        return { passed: false, feedback: validation.errors.join(" ") };
      }
      if (content && /\bREJECT\b/i.test(content)) {
        const feedbackMatch = content.match(/##\s*(?:反馈|Feedback|问题|Issues)\s*\n([\s\S]*?)(?=\n##|$)/);
        const feedback = feedbackMatch?.[1]?.trim() ?? "设计审查未通过，请根据审查意见修订设计方案。";
        return { passed: false, feedback };
      }
      return { passed: true, feedback: "" };
    }

    case "2a": {
      const planPath = join(outputDir, "plan.md");
      const exists = await fileExists(planPath);
      if (!exists) {
        return { passed: false, feedback: "plan.md 不存在，请生成完整的实施计划。" };
      }
      return { passed: true, feedback: "" };
    }

    case "2b": {
      const reviewPath = join(outputDir, "plan-review.md");
      const content = await readFileSafe(reviewPath);
      const validation = validatePhase2ReviewArtifact(content);
      if (!validation.valid) {
        return { passed: false, feedback: validation.errors.join(" ") };
      }
      if (content && /\bREJECT\b/i.test(content)) {
        const feedbackMatch = content.match(/##\s*(?:反馈|Feedback|问题|Issues)\s*\n([\s\S]*?)(?=\n##|$)/);
        const feedback = feedbackMatch?.[1]?.trim() ?? "计划审查未通过，请根据审查意见修订实施计划。";
        return { passed: false, feedback };
      }
      return { passed: true, feedback: "" };
    }

    case "3": {
      // Build + test
      const buildResult = await shell(buildCmd, projectRoot);
      if (buildResult.exitCode !== 0) {
        return {
          passed: false,
          feedback: translateFailureToFeedback("BUILD_FAILED", buildResult.stdout + "\n" + buildResult.stderr),
        };
      }
      const testResult = await shell(testCmd, projectRoot);
      if (testResult.exitCode !== 0) {
        return {
          passed: false,
          feedback: translateFailureToFeedback("TEST_FAILED", testResult.stdout + "\n" + testResult.stderr),
        };
      }
      return { passed: true, feedback: "" };
    }

    case "4a": {
      // Build + test first
      const buildResult = await shell(buildCmd, projectRoot);
      if (buildResult.exitCode !== 0) {
        return {
          passed: false,
          feedback: translateFailureToFeedback("BUILD_FAILED", buildResult.stdout + "\n" + buildResult.stderr),
        };
      }
      const testResult = await shell(testCmd, projectRoot);
      if (testResult.exitCode !== 0) {
        return {
          passed: false,
          feedback: translateFailureToFeedback("TEST_FAILED", testResult.stdout + "\n" + testResult.stderr),
        };
      }
      // Then tribunal
      const tribunalResult = await executeTribunal(
        projectRoot, outputDir, 4, topic, "Phase 4 verify", sm, state,
      );
      return parseTribunalResult(tribunalResult);
    }

    case "5a": {
      // Just check that test design output exists (pass through)
      return { passed: true, feedback: "" };
    }

    case "5b": {
      // Run tests first
      const testResult = await shell(testCmd, projectRoot);
      if (testResult.exitCode !== 0) {
        return {
          passed: false,
          feedback: translateFailureToFeedback("TEST_FAILED", testResult.stdout + "\n" + testResult.stderr),
        };
      }
      // Then tribunal
      const tribunalResult = await executeTribunal(
        projectRoot, outputDir, 5, topic, "Phase 5 E2E test", sm, state,
      );
      return parseTribunalResult(tribunalResult);
    }

    case "6": {
      const tribunalResult = await executeTribunal(
        projectRoot, outputDir, 6, topic, "Phase 6 acceptance", sm, state,
      );
      return parseTribunalResult(tribunalResult);
    }

    case "7": {
      const tribunalResult = await executeTribunal(
        projectRoot, outputDir, 7, topic, "Phase 7 retrospective", sm, state,
      );
      return parseTribunalResult(tribunalResult);
    }

    default:
      return { passed: true, feedback: "" };
  }
}

// ---------------------------------------------------------------------------
// Build Task Prompt for Step
// ---------------------------------------------------------------------------

export async function buildTaskForStep(
  step: string,
  outputDir: string,
  projectRoot: string,
  topic: string,
  buildCmd: string,
  testCmd: string,
  feedback?: string,
): Promise<string> {
  const variables: Record<string, string> = {
    topic,
    output_dir: outputDir,
    project_root: projectRoot,
    build_cmd: buildCmd,
    test_cmd: testCmd,
  };

  // Revision steps (1c, 2c, 5c) — build revision prompt
  if (step === "1c" && feedback) {
    return buildRevisionPrompt({
      originalTask: `设计方案：${topic}`,
      feedback,
      artifacts: [join(outputDir, "design.md")],
    }) + ISOLATION_FOOTER;
  }

  if (step === "2c" && feedback) {
    return buildRevisionPrompt({
      originalTask: `实施计划：${topic}`,
      feedback,
      artifacts: [join(outputDir, "plan.md")],
    }) + ISOLATION_FOOTER;
  }

  if (step === "5c" && feedback) {
    return buildRevisionPrompt({
      originalTask: `测试实现：${topic}`,
      feedback,
      artifacts: [],
    }) + ISOLATION_FOOTER;
  }

  // Approach plan instruction for steps that may need circuit breaker
  const APPROACH_PLAN_STEPS = ["3", "4a", "5b"];
  const approachPlanInstruction = APPROACH_PLAN_STEPS.includes(step)
    ? `\n\n## 执行前：方案计划\n\n在开始编码/测试之前，先输出方案计划到 ${outputDir}/approach-plan.md：\n\n1. 主方案 + 1~2 个备选方案\n2. 每个方案标注方法、核心工具、风险\n3. 备选方案应与主方案在技术路径上有本质区别\n   （换参数/换 flag 不算，换工具/换思路才算）\n`
    : "";

  // Map steps to prompt templates
  const stepToTemplate: Record<string, string> = {
    "1a": "phase1-architect",
    "1b": "phase1-design-reviewer",
    "2a": "phase2-planner",
    "2b": "phase2-plan-reviewer",
    "5a": "phase5-test-architect",
    "5b": "phase5-test-developer",
    "6": "phase6-acceptance",
    "7": "phase7-retrospective",
  };

  // Step 3: implementation — special handling
  if (step === "3") {
    const planPath = join(outputDir, "plan.md");
    const planContent = await readFileSafe(planPath);

    if (!planContent) {
      // Turbo mode without plan.md — use topic directly
      return `请实现以下功能：${topic}\n\n项目根目录: ${projectRoot}` + approachPlanInstruction + ISOLATION_FOOTER;
    }

    const taskListStr = extractTaskList(planContent);
    const taskLines = taskListStr.split("\n").filter((l) => l.trim().length > 0);
    if (taskLines.length === 0) {
      taskLines.push("实现 plan.md 中描述的所有功能");
    }

    const allTasks = taskLines.join("\n");
    return `请完成以下任务：\n\n${allTasks}\n\n项目根目录: ${projectRoot}\n输出目录: ${outputDir}` + approachPlanInstruction + ISOLATION_FOOTER;
  }

  // Step 4a: implementation fix/verify
  if (step === "4a") {
    if (feedback) {
      return buildRevisionPrompt({
        originalTask: `代码验证：${topic}`,
        feedback,
        artifacts: [],
      }) + approachPlanInstruction + ISOLATION_FOOTER;
    }
    return `请检查并修复代码，确保编译和测试通过。\n\n项目根目录: ${projectRoot}` + approachPlanInstruction + ISOLATION_FOOTER;
  }

  const template = stepToTemplate[step];
  if (template) {
    const rendered = await renderPrompt(template, variables);
    return rendered + approachPlanInstruction;
  }

  // Fallback
  return `请完成步骤 ${step} 的任务。\n\n主题: ${topic}\n项目根目录: ${projectRoot}` + ISOLATION_FOOTER;
}

// ---------------------------------------------------------------------------
// computeNextTask — Main Step Function
// ---------------------------------------------------------------------------

export async function computeNextTask(
  projectRoot: string,
  topic: string,
): Promise<NextTaskResult> {
  // 1. Load state via StateManager
  const sm = new StateManager(projectRoot, topic);
  const state = await sm.loadAndValidate();

  const outputDir = sm.outputDir;
  const mode = state.mode;
  const phases = PHASE_SEQUENCE[mode] ?? [3];
  const buildCmd = state.stack.buildCmd;
  const testCmd = state.stack.testCmd;

  // 2. Read step state (extra fields not in Zod schema)
  const stepState = await readStepState(sm.stateFilePath);

  // 3. If no step: determine first phase, set step, return first task prompt
  if (!stepState.step) {
    const firstPhase = phases[0]!;
    const firstStep = firstStepForPhase(firstPhase);

    // Persist step state
    await writeStepState(sm.stateFilePath, {
      step: firstStep,
      stepIteration: 0,
      lastValidation: null,
    });

    // Also update phase in state.json via atomicUpdate
    await sm.atomicUpdate({ phase: firstPhase, status: "IN_PROGRESS" });

    const prompt = await buildTaskForStep(
      firstStep, outputDir, projectRoot, topic, buildCmd, testCmd,
    );

    return {
      done: false,
      step: firstStep,
      agent: STEP_AGENTS[firstStep] ?? null,
      prompt,
      message: `Starting step ${firstStep} (phase ${firstPhase}).`,
    };
  }

  // 4. Step exists — validate previous step's artifacts
  const currentStep = stepState.step;
  const currentIteration = stepState.stepIteration;

  const validation = await validateStep(
    currentStep, outputDir, projectRoot, buildCmd, testCmd, sm, state, topic,
  );

  if (!validation.passed) {
    // Circuit breaker: check approach failure before iteration limit
    const approachResult = await handleApproachFailure(
      stepState, currentStep, outputDir, validation.feedback,
    );

    if (approachResult.action === "CIRCUIT_BREAK") {
      // Reset stepIteration for new approach
      await writeStepState(sm.stateFilePath, {
        stepIteration: 0,
        lastValidation: "CIRCUIT_BREAK",
        approachState: approachResult.approachState,
      });

      return {
        done: false,
        step: currentStep,
        agent: STEP_AGENTS[currentStep] ?? null,
        prompt: approachResult.prompt,
        freshContext: true,
        message: `方案 "${approachResult.failedApproach}" 已熔断，切换到 "${approachResult.nextApproach}"。`,
      };
    }

    if (approachResult.action === "ALL_EXHAUSTED") {
      await writeStepState(sm.stateFilePath, {
        lastValidation: "ALL_APPROACHES_EXHAUSTED",
      });
      await sm.atomicUpdate({ status: "BLOCKED" });

      return {
        done: false,
        step: currentStep,
        agent: null,
        prompt: null,
        escalation: {
          reason: "all_approaches_exhausted",
          lastFeedback: validation.feedback,
        },
        message: `Step ${currentStep} 所有方案均已失败，需要人工介入。`,
      };
    }

    // CONTINUE: persist approachState if present, then check iteration limit
    if (approachResult.approachState) {
      await writeStepState(sm.stateFilePath, {
        approachState: approachResult.approachState,
      });
    }

    // Check iteration limit (skip if approachState exists — circuit breaker manages limits)
    const hasApproachState = !!(approachResult.approachState || stepState.approachState);
    if (!hasApproachState && currentIteration >= MAX_STEP_ITERATIONS) {
      // Escalation
      await writeStepState(sm.stateFilePath, {
        lastValidation: "ESCALATED",
      });
      await sm.atomicUpdate({ status: "BLOCKED" });

      return {
        done: false,
        step: currentStep,
        agent: null,
        prompt: null,
        escalation: {
          reason: "iteration_limit_exceeded",
          lastFeedback: validation.feedback,
        },
        message: `Step ${currentStep} exceeded maximum iterations (${MAX_STEP_ITERATIONS}). Escalating.`,
      };
    }

    // Return revision prompt, increment stepIteration
    const newIteration = currentIteration + 1;
    await writeStepState(sm.stateFilePath, {
      stepIteration: newIteration,
      lastValidation: "FAILED",
    });

    // Determine revision step (1b fail -> 1c, 2b fail -> 2c, else same step)
    let revisionStep = currentStep;
    if (currentStep === "1b") revisionStep = "1c";
    if (currentStep === "2b") revisionStep = "2c";
    if (currentStep === "5b") revisionStep = "5c";

    // For revision steps, update step state to the revision step
    if (revisionStep !== currentStep) {
      await writeStepState(sm.stateFilePath, {
        step: revisionStep,
        stepIteration: newIteration,
        lastValidation: "FAILED",
      });
    }

    // Append planFeedback from circuit breaker if approach-plan.md was malformed
    let combinedFeedback = validation.feedback;
    if (approachResult.action === "CONTINUE" && approachResult.planFeedback) {
      combinedFeedback += `\n\n${approachResult.planFeedback}`;
    }

    const prompt = await buildTaskForStep(
      revisionStep, outputDir, projectRoot, topic, buildCmd, testCmd, combinedFeedback,
    );

    // For review failures (1b, 2b), after revision go back to review step
    // The step stays as revision step; next call will validate and move back to review
    const effectiveStep = revisionStep !== currentStep ? revisionStep : currentStep;

    return {
      done: false,
      step: effectiveStep,
      agent: STEP_AGENTS[effectiveStep] ?? STEP_AGENTS[currentStep] ?? null,
      prompt,
      message: `Step ${currentStep} validation failed (iteration ${newIteration}/${MAX_STEP_ITERATIONS}). Revision needed.`,
    };
  }

  // 5. Validation passed — advance to next step
  const currentPhase = phaseForStep(currentStep);
  await internalCheckpoint(sm, state, currentPhase, "PASS", `Step ${currentStep} passed.`);

  const nextStep = computeNextStep(currentStep, phases);

  if (!nextStep) {
    // All steps done
    await writeStepState(sm.stateFilePath, {
      step: null,
      stepIteration: 0,
      lastValidation: "DONE",
    });
    await sm.atomicUpdate({ status: "COMPLETED" });

    return {
      done: true,
      step: null,
      agent: null,
      prompt: null,
      message: "All phases completed successfully.",
    };
  }

  // Set up next step
  const nextPhase = phaseForStep(nextStep);
  await writeStepState(sm.stateFilePath, {
    step: nextStep,
    stepIteration: 0,
    lastValidation: null,
    approachState: null,
  });
  await sm.atomicUpdate({ phase: nextPhase, status: "IN_PROGRESS" });

  const prompt = await buildTaskForStep(
    nextStep, outputDir, projectRoot, topic, buildCmd, testCmd,
  );

  return {
    done: false,
    step: nextStep,
    agent: STEP_AGENTS[nextStep] ?? null,
    prompt,
    message: `Step ${currentStep} passed. Advancing to step ${nextStep} (phase ${nextPhase}).`,
  };
}
