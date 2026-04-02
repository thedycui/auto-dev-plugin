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
import { StateManager, extractTaskList } from "./state-manager.js";
import {
  validatePhase1ReviewArtifact,
  validatePhase2ReviewArtifact,
  isTddExemptTask,
  validateAcIntegrity,
} from "./phase-enforcer.js";
import { runStructuralAssertions } from "./ac-runner.js";
import { discoverAcBindings, validateAcBindingCoverage, runAcBoundTests } from "./ac-test-binding.js";
import { AcceptanceCriteriaSchema } from "./ac-schema.js";
import { evaluateTribunal } from "./tribunal.js";
import type { EvalTribunalResult } from "./tribunal.js";
import { TemplateRenderer } from "./template-renderer.js";
import type { StateJson } from "./types.js";

// ---------------------------------------------------------------------------
// Design Doc Compliance Check
// ---------------------------------------------------------------------------

/**
 * Check if an existing design.md already has the required sections for auto-dev.
 * Required: AC table (≥3 AC-N entries) + solution comparison (≥2 solutions).
 * If compliant, Phase 1a (architect rewrite) can be skipped — go straight to 1b (review).
 */
export function checkDesignDocCompliance(content: string): { compliant: boolean; missing: string[] } {
  const missing: string[] = [];

  // Check AC table: look for "AC-N" pattern (at least 3)
  const acMatches = content.match(/AC-\d+/g);
  if (!acMatches || acMatches.length < 3) {
    missing.push(`验收标准不足（需要 ≥3 条 AC-N，当前 ${acMatches?.length ?? 0} 条）`);
  }

  // Check solution comparison: look for "方案" with A/B/1/2 or comparison table
  const hasSolutionComparison =
    /方案\s*[A-Z12]|方案选型|方案对比|方案设计/.test(content) &&
    (content.includes("|") && /\|.*方案.*\|/.test(content));  // table with "方案"
  if (!hasSolutionComparison) {
    missing.push("缺少方案对比（需要 ≥2 个方案的对比表格）");
  }

  return { compliant: missing.length === 0, missing };
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TaskInfo {
  taskNumber: number;
  title: string;
  description: string;
  files: string[];
  dependencies: number[];
}

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
    digest?: string;
    digestHash?: string;
    digestPath?: string;
  };
  /** When true, the prompt should be executed in a fresh subagent context (clean slate, no prior failure context) */
  freshContext?: boolean;
  /** Mandatory instruction for the main agent — MUST be followed, not a suggestion */
  mandate?: string;
  /** Informational message */
  message: string;
  /** Last failure detail (feedback from validation) — populated on failure paths */
  lastFailureDetail?: string;
  /** Parsed task list from plan.md — only populated for step "3" */
  tasks?: TaskInfo[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_STEP_ITERATIONS = 3;
const MAX_APPROACH_FAILURES = 2;

export const PHASE_SEQUENCE: Record<string, number[]> = {
  full: [1, 2, 3, 4, 5, 6, 7],
  quick: [3, 4, 5, 7],
  turbo: [3],
};

const STEP_AGENTS: Record<string, string> = {
  "1a": "auto-dev:auto-dev-architect",
  "1b": "auto-dev:auto-dev-reviewer",
  "1c": "auto-dev:auto-dev-architect",
  "2a": "auto-dev:auto-dev-architect",
  "2b": "auto-dev:auto-dev-reviewer",
  "2c": "auto-dev:auto-dev-architect",
  "3": "auto-dev:auto-dev-developer",
  "4a": "auto-dev:auto-dev-developer",
  "5a": "auto-dev:auto-dev-test-architect",
  "5b": "auto-dev:auto-dev-developer",
  "5c": "auto-dev:auto-dev-developer",
  "6": "auto-dev:auto-dev-acceptance-validator",
  "7": "auto-dev:auto-dev-reviewer",
  "8a": "auto-dev:auto-dev-developer",
  "8b": "auto-dev:auto-dev-developer",
  "8c": "auto-dev:auto-dev-developer",
  "8d": "auto-dev:auto-dev-developer",
};

/** Ordered step transitions (happy path) */
const STEP_ORDER = ["1a", "1b", "2a", "2b", "3", "4a", "5a", "5b", "6", "7", "8a", "8b", "8c", "8d"];

/** Map revision steps back to their review counterparts for step progression */
const REVISION_TO_REVIEW: Record<string, string> = {
  "1c": "1b",
  "2c": "2b",
  "5c": "5b",
};

const ISOLATION_FOOTER = "\n\n---\n完成后不需要做其他操作。直接完成任务即可。\n";

const SKILLS_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..", "..", "skills", "auto-dev",
);

// ---------------------------------------------------------------------------
// Reset Validation
// ---------------------------------------------------------------------------

/**
 * Validate an auto_dev_reset request before mutating state.
 * Returns an error string if validation fails, or null if valid.
 */
export function validateResetRequest(
  state: { status: string; phase: number; mode: string },
  targetPhase: number,
  reason: string,
): string | null {
  if (state.status === "COMPLETED") {
    return "Cannot reset a COMPLETED project.";
  }
  if (targetPhase > state.phase) {
    return `targetPhase (${targetPhase}) must not exceed current phase (${state.phase}). Forward jumps are forbidden.`;
  }
  if (!reason || reason.trim() === "") {
    return "reason must be a non-empty string.";
  }
  const validPhases = PHASE_SEQUENCE[state.mode] ?? [];
  if (!validPhases.includes(targetPhase)) {
    return `targetPhase (${targetPhase}) is not in PHASE_SEQUENCE for mode "${state.mode}" (${validPhases.join(", ")}).`;
  }
  return null;
}

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

/** @deprecated No longer used — tribunal results handled directly via EvalTribunalResult */
export function parseTribunalResult(toolResult: { content: Array<{ type: string; text: string }> }): { passed: boolean; feedback: string } {
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

export interface OrchestratorContext {
  sm: InstanceType<typeof StateManager>;
  state: StateJson;
  outputDir: string;
  projectRoot: string;
  effectiveCodeRoot: string;
  topic: string;
  buildCmd: string;
  testCmd: string;
  phases: number[];
  skipSteps: string[];
  getExtraVars: (step: string) => Record<string, string> | undefined;
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
    1: "1a", 2: "2a", 3: "3", 4: "4a", 5: "5a", 6: "6", 7: "7", 8: "8a",
  };
  return map[phase] ?? String(phase);
}

/** Return the last sub-step for a given phase (used to advance past a completed phase) */
export function lastStepForPhase(phase: number): string {
  const map: Record<number, string> = {
    1: "1b", 2: "2b", 3: "3", 4: "4a", 5: "5b", 6: "6", 7: "7", 8: "8d",
  };
  return map[phase] ?? String(phase);
}

/**
 * Compute the next step in sequence, skipping steps whose phase
 * is not in the mode's phase sequence.
 */
export function computeNextStep(currentStep: string, phases: number[], skipSteps?: string[]): string | null {
  // Revision steps (1c/2c/5c) are not in STEP_ORDER — map them back to
  // their review counterpart so we can find the correct next step.
  const lookupStep = REVISION_TO_REVIEW[currentStep] ?? currentStep;
  const idx = STEP_ORDER.indexOf(lookupStep);
  if (idx < 0) return null;

  for (let i = idx + 1; i < STEP_ORDER.length; i++) {
    const candidate = STEP_ORDER[i]!;
    if (skipSteps?.includes(candidate)) continue;
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

/**
 * Run a command (build or test) and check if failure is pre-existing.
 * If the command fails but also fails at the baseline (startCommit),
 * it's a pre-existing issue — returns null (pass through).
 * If it's a new failure introduced by our changes, returns the failure result.
 */
async function checkBuildWithBaseline(
  cmd: string,
  projectRoot: string,
  startCommit: string | undefined,
  failType: string = "BUILD_FAILED",
): Promise<{ passed: false; feedback: string } | null> {
  const result = await shell(cmd, projectRoot);
  if (result.exitCode === 0) return null; // Success, no issue

  // Command failed — check if it was already broken before our changes.
  // Only attempt if startCommit exists and git stash succeeds (real git repo).
  if (startCommit) {
    const stashResult = await shell("git stash --include-untracked -q", projectRoot, 10_000);
    if (stashResult.exitCode === 0) {
      try {
        const baselineResult = await shell(cmd, projectRoot, 300_000);
        if (baselineResult.exitCode !== 0) {
          // Pre-existing failure — not caused by our changes, pass through
          return null;
        }
      } finally {
        await shell("git stash pop -q", projectRoot, 10_000);
      }
    }
    // git stash failed (no git repo, nothing to stash, etc.) — skip baseline check
  }

  return {
    passed: false,
    feedback: translateFailureToFeedback(failType, result.stdout + "\n" + result.stderr),
  };
}

// ---------------------------------------------------------------------------
// IMP-001: Extracted functions for computeNextTask refactoring
// These functions handle tribunal failure scenarios, reducing the complexity
// of the main computeNextTask function.
// ---------------------------------------------------------------------------

/**
 * Handle tribunal crash event — write detailed crash info to progress-log.
 * IMP-002 enhanced: writes full stderr to dedicated crash log file.
 */
async function handleTribunalCrash(
  ctx: OrchestratorContext,
  crashRaw: string | undefined,
): Promise<void> {
  const { sm, state, outputDir } = ctx;
  try {
    let crashEvent = `<!-- TRIBUNAL_CRASH phase=${state.phase} -->`;
    if (crashRaw) {
      const parsed = JSON.parse(crashRaw);
      if (parsed.crashInfo) {
        const ci = parsed.crashInfo;
        const timestamp = new Date().toISOString();
        crashEvent = `<!-- TRIBUNAL_CRASH phase=${state.phase} category="${ci.errorCategory}" exitCode="${ci.exitCode ?? "N/A"}" retryable="${ci.isRetryable}" timestamp="${timestamp}" -->`;
        if (ci.stderrSnippet) {
          const safeSnippet = ci.stderrSnippet
            .replace(/"/g, '&quot;')
            .replace(/--/g, '&#45;&#45;')
            .slice(0, 200);
          crashEvent += `\n<!-- TRIBUNAL_CRASH_STDERR snippet="${safeSnippet}" -->`;
        }
        if (ci.stderrFull) {
          const crashLogPath = join(outputDir, `.tribunal-crash-phase${state.phase}.log`);
          await writeFile(crashLogPath, `[${timestamp}] TRIBUNAL_CRASH category=${ci.errorCategory} exitCode=${ci.exitCode ?? "N/A"}\n\nSTDERR:\n${ci.stderrFull}\n\nERROR: ${ci.errMessage}\n`, "utf-8");
          crashEvent += `\n<!-- TRIBUNAL_CRASH_LOG path="${crashLogPath}" -->`;
        }
      }
    }
    await sm.appendToProgressLog(crashEvent);
  } catch { /* best-effort */ }
}

/**
 * Handle tribunal subagent request — delegate to subagent for tribunal execution.
 */
async function handleTribunalSubagent(
  ctx: OrchestratorContext,
  phaseKey: string,
  count: number,
  currentStep: string,
  tribunalResult: EvalTribunalResult,
): Promise<NextTaskResult> {
  const { sm, state } = ctx;
  await sm.atomicUpdate({
    tribunalSubmits: { ...(state.tribunalSubmits ?? {}), [phaseKey]: count },
  });
  return {
    done: false,
    step: currentStep,
    agent: null,
    prompt: null,
    escalation: {
      reason: "tribunal_subagent",
      lastFeedback: "裁决已委托给 subagent，请读取 digestPath 文件执行裁决后调用 auto_dev_tribunal_verdict 提交。",
      digest: tribunalResult.digest,
      digestHash: tribunalResult.digestHash,
      digestPath: tribunalResult.digestPath,
    },
    message: `Step ${currentStep} tribunal 委托给 subagent 执行。`,
  };
}

/**
 * Handle tribunal parse failure — return raw output for main agent to extract verdict.
 */
async function handleTribunalParseFailure(
  ctx: OrchestratorContext,
  phaseKey: string,
  count: number,
  currentStep: string,
  tribunalResult: EvalTribunalResult,
): Promise<NextTaskResult> {
  const { sm, state, outputDir } = ctx;
  // [FIX-4] Write rawOutput to file instead of returning inline (can be 2MB+, causes MCP overflow).
  let rawOutputRef = "";
  if (tribunalResult.rawOutput) {
    const rawOutputPath = join(outputDir, `tribunal-raw-phase${phaseKey}.txt`);
    await writeFile(rawOutputPath, tribunalResult.rawOutput, "utf-8");
    rawOutputRef = ` 原始输出已保存到 ${rawOutputPath}，请读取后提取 verdict 和 issues。`;
  }
  await sm.atomicUpdate({
    tribunalSubmits: { ...(state.tribunalSubmits ?? {}), [phaseKey]: count },
  });
  return {
    done: false,
    step: currentStep,
    agent: null,
    prompt: null,
    escalation: {
      reason: "tribunal_parse_failure",
      lastFeedback: `Tribunal 返回了裁决内容但 JSON 格式不合法。${rawOutputRef}然后调用 auto_dev_tribunal_verdict 提交。`,
      digestHash: tribunalResult.digestHash,
    },
    message: `Step ${currentStep} tribunal JSON 解析失败，原始输出已保存到文件。`,
  };
}

/**
 * Handle tribunal crash with fallback escalation.
 */
async function handleTribunalCrashEscalation(
  ctx: OrchestratorContext,
  phaseKey: string,
  count: number,
  currentStep: string,
  tribunalResult: EvalTribunalResult,
): Promise<NextTaskResult> {
  const { sm, state, outputDir } = ctx;
  await handleTribunalCrash(ctx, tribunalResult.crashRaw);
  // [FIX-4b] Write digest to file to avoid MCP overflow
  let digestRef = "";
  if (tribunalResult.digest) {
    const digestPath = join(outputDir, `tribunal-digest-phase${phaseKey}.txt`);
    await writeFile(digestPath, tribunalResult.digest, "utf-8");
    digestRef = ` Digest 已保存到 ${digestPath}`;
  }
  await sm.atomicUpdate({
    tribunalSubmits: { ...(state.tribunalSubmits ?? {}), [phaseKey]: count },
  });
  return {
    done: false,
    step: currentStep,
    agent: null,
    prompt: null,
    escalation: {
      reason: "tribunal_crashed",
      lastFeedback: `Tribunal 进程崩溃，需要 fallback 裁决。${digestRef}`,
      digestHash: tribunalResult.digestHash,
    },
    message: `Step ${currentStep} tribunal 崩溃，需要 fallback。`,
  };
}

/**
 * Handle tribunal escalation after 3 failures — regress to Phase 3 or BLOCKED.
 */
async function handleTribunalEscalation(
  ctx: OrchestratorContext,
  phaseKey: string,
  currentStep: string,
  feedback: string,
): Promise<NextTaskResult> {
  const { sm, state, outputDir, projectRoot, topic, buildCmd, testCmd } = ctx;
  const escCount = state.phaseEscalateCount?.[phaseKey] ?? 0;
  if (escCount >= 2) {
    console.error(`[orchestrator] tribunal escalation BLOCKED: step=${currentStep} phase=${phaseKey} escCount=${escCount + 1}`);
    await sm.atomicUpdate({ status: "BLOCKED" });
    return {
      done: false, step: currentStep, agent: null, prompt: null,
      escalation: {
        reason: "tribunal_max_escalations",
        lastFeedback: `Phase ${phaseKey} 已 ${escCount + 1} 次 ESCALATE，需要人工介入。`,
      },
      message: `Phase ${phaseKey} 多次 ESCALATE，BLOCKED。`,
    };
  }

  console.error(`[orchestrator] tribunal escalation regress: step=${currentStep} phase=${phaseKey} escCount=${escCount + 1}`);
  await sm.atomicUpdate({
    phase: 3, status: "IN_PROGRESS",
    step: "3", stepIteration: 0, lastValidation: "ESCALATE_REGRESS", approachState: null,
    tribunalSubmits: {},
    phaseEscalateCount: { ...(state.phaseEscalateCount ?? {}), [phaseKey]: escCount + 1 },
  });

  const prompt = await buildTaskForStep("3", outputDir, projectRoot, topic, buildCmd, testCmd, feedback, ctx.getExtraVars("3"));
  const planContent = await readFileSafe(join(outputDir, "plan.md"));
  const tasks = parseTaskList(planContent);
  return {
    done: false,
    step: "3",
    agent: STEP_AGENTS["3"] ?? null,
    prompt,
    tasks,
    message: `Phase ${phaseKey} tribunal 3 次未通过，回退到 Phase 3 修复。`,
  };
}

export async function validateStep(
  step: string,
  outputDir: string,
  projectRoot: string,
  buildCmd: string,
  testCmd: string,
  sm: StateManager,
  state: StateJson,
  topic: string,
): Promise<{ passed: boolean; feedback: string; tribunalResult?: EvalTribunalResult; regressToPhase?: number }> {
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
      if (content) {
        // Extract only the 结论 section to avoid false positives from historical/example text
        const conclusionMatch = content.match(/##\s*结论\s*\n([\s\S]*?)(?=\n##|$)/i);
        const conclusionText = conclusionMatch?.[1]?.trim() ?? "";
        if (/\b(?:REJECT|NEEDS_REVISION)\b/i.test(conclusionText)) {
          const feedbackMatch = content.match(/##\s*(?:反馈|Feedback|问题|Issues|P0|P1)\s*\n([\s\S]*?)(?=\n##|$)/i);
          const feedback = feedbackMatch?.[1]?.trim() ?? `设计审查未通过（结论：${conclusionText || "NEEDS_REVISION"}），请根据审查意见修订设计方案。`;
          return { passed: false, feedback };
        }
        if (!conclusionMatch) {
          // No 结论 section found — fall back to full-text scan but warn
          if (/\b(?:REJECT|NEEDS_REVISION)\b/i.test(content)) {
            return { passed: false, feedback: "design-review.md 缺少 ## 结论 段落，且正文包含 REJECT/NEEDS_REVISION 关键词。请确保 review 文件末尾有 '## 结论\\nPASS' 或 '## 结论\\nNEEDS_REVISION'。" };
          }
        }
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
      if (content) {
        // Extract only the 结论 section to avoid false positives from historical/example text
        const conclusionMatch = content.match(/##\s*结论\s*\n([\s\S]*?)(?=\n##|$)/i);
        const conclusionText = conclusionMatch?.[1]?.trim() ?? "";
        if (/\b(?:REJECT|NEEDS_REVISION)\b/i.test(conclusionText)) {
          const feedbackMatch = content.match(/##\s*(?:反馈|Feedback|问题|Issues|P0|P1)\s*\n([\s\S]*?)(?=\n##|$)/i);
          const feedback = feedbackMatch?.[1]?.trim() ?? `计划审查未通过（结论：${conclusionText || "NEEDS_REVISION"}），请根据审查意见修订实施计划。`;
          return { passed: false, feedback };
        }
        if (!conclusionMatch) {
          // No 结论 section found — fall back to full-text scan but warn
          if (/\b(?:REJECT|NEEDS_REVISION)\b/i.test(content)) {
            return { passed: false, feedback: "plan-review.md 缺少 ## 结论 段落，且正文包含 REJECT/NEEDS_REVISION 关键词。请确保 review 文件末尾有 '## 结论\\nPASS' 或 '## 结论\\nNEEDS_REVISION'。" };
          }
        }
      }
      return { passed: true, feedback: "" };
    }

    case "3": {
      // Build + test (with pre-existing failure detection)
      const buildFail3 = await checkBuildWithBaseline(buildCmd, projectRoot, state.startCommit);
      if (buildFail3) return buildFail3;
      const testFail3 = await checkBuildWithBaseline(testCmd, projectRoot, state.startCommit, "TEST_FAILED");
      if (testFail3) return testFail3;
      return { passed: true, feedback: "" };
    }

    case "4a": {
      // Build + test first (with pre-existing failure detection)
      const buildFail4 = await checkBuildWithBaseline(buildCmd, projectRoot, state.startCommit);
      if (buildFail4) return buildFail4;
      const testFail4 = await checkBuildWithBaseline(testCmd, projectRoot, state.startCommit, "TEST_FAILED");
      if (testFail4) return testFail4;
      // Tribunal (pure evaluation — no state side effects)
      const eval4 = await evaluateTribunal(projectRoot, outputDir, 4, topic, "Phase 4 verify", state.startCommit);
      return {
        passed: eval4.verdict === "PASS",
        feedback: eval4.verdict === "FAIL"
          ? eval4.issues.map(i => `[${i.severity}] ${i.description}`).join("\n")
          : "",
        tribunalResult: eval4,
      };
    }

    case "5a": {
      const hasTestCases = await fileExists(join(outputDir, "e2e-test-cases.md"));
      if (!hasTestCases) {
        return { passed: false, feedback: "e2e-test-cases.md 不存在。Phase 5a 要求输出测试用例设计文件。" };
      }
      return { passed: true, feedback: "" };
    }

    case "5b": {
      // Run tests first
      const testResult5 = await shell(testCmd, projectRoot);
      if (testResult5.exitCode !== 0) {
        return {
          passed: false,
          feedback: translateFailureToFeedback("TEST_FAILED", testResult5.stdout + "\n" + testResult5.stderr),
        };
      }
      const eval5 = await evaluateTribunal(projectRoot, outputDir, 5, topic, "Phase 5 E2E test", state.startCommit);
      return {
        passed: eval5.verdict === "PASS",
        feedback: eval5.verdict === "FAIL"
          ? eval5.issues.map(i => `[${i.severity}] ${i.description}`).join("\n")
          : "",
        tribunalResult: eval5,
      };
    }

    case "6": {
      // AC framework execution — runs before Tribunal
      const acJsonPath = join(outputDir, "acceptance-criteria.json");
      const effectiveCodeRoot = state.codeRoot ?? projectRoot;
      let acContent: string | null = null;
      try {
        acContent = await readFileSafe(acJsonPath);
      } catch { /* no AC JSON → legacy flow */ }

      if (acContent) {
        // 1. Hash integrity check (tamper detection)
        const progressLog = await readFileSafe(join(outputDir, "progress-log.md")) ?? "";
        const integrityResult = validateAcIntegrity(acContent, progressLog);
        if (!integrityResult.valid) {
          return {
            passed: false,
            feedback: `[BLOCKED] ${integrityResult.error}`,
          };
        }

        // 2. Parse AC JSON
        const acData = AcceptanceCriteriaSchema.parse(JSON.parse(acContent));

        // 3. Check test-bound AC binding coverage
        const bindings = await discoverAcBindings(effectiveCodeRoot, state.stack.language);
        const coverage = validateAcBindingCoverage(acData.criteria, bindings);
        if (coverage.missing.length > 0) {
          return {
            passed: false,
            feedback: `[BLOCKED] Test-bound AC missing bindings: ${coverage.missing.join(", ")}. ` +
              `Please go back to Phase 5 and add [AC-N] annotations to test code, ` +
              `or downgrade these ACs to manual in acceptance-criteria.json (requires Phase 1 re-approval).`,
          };
        }

        // 4. Run structural assertions (Layer 1)
        // Paths in acceptance-criteria.json are project-root-relative, not codeRoot-relative.
        const structuralResults = await runStructuralAssertions(
          acData.criteria,
          projectRoot,
          { buildCmd, testCmd },
        );

        // 5. Run test-bound tests (Layer 2)
        const testResults = await runAcBoundTests(bindings, effectiveCodeRoot, state.stack.language, testCmd);

        // 6. Write framework-ac-results.json
        const frameworkResults = {
          structural: structuralResults,
          testBound: Object.fromEntries(testResults),
          pendingManual: acData.criteria
            .filter((c) => c.layer === "manual")
            .map((c) => c.id),
          timestamp: new Date().toISOString(),
        };
        await writeFile(
          join(outputDir, "framework-ac-results.json"),
          JSON.stringify(frameworkResults, null, 2),
        );

        // 7. Check for failures — short-circuit if structural or test-bound FAIL
        const structuralFails = Object.entries(structuralResults)
          .filter(([, v]) => !v.passed).map(([id]) => id);
        const testFails = [...testResults.entries()]
          .filter(([, v]) => !v.passed).map(([id]) => id);

        if (structuralFails.length > 0 || testFails.length > 0) {
          return {
            passed: false,
            feedback: [
              structuralFails.length > 0 ? `Structural AC FAIL: ${structuralFails.join(", ")}` : "",
              testFails.length > 0 ? `Test-bound AC FAIL: ${testFails.join(", ")}` : "",
              "See framework-ac-results.json for details.",
            ].filter(Boolean).join("\n"),
          };
        }
      }

      // Proceed to Tribunal (handles manual AC + overall acceptance)
      const eval6 = await evaluateTribunal(projectRoot, outputDir, 6, topic, "Phase 6 acceptance", state.startCommit);
      return {
        passed: eval6.verdict === "PASS",
        feedback: eval6.verdict === "FAIL"
          ? eval6.issues.map(i => `[${i.severity}] ${i.description}`).join("\n")
          : "",
        tribunalResult: eval6,
      };
    }

    case "7": {
      // Phase 7 (retrospective) — no tribunal, just check retrospective.md exists
      const retroContent = await readFileSafe(join(outputDir, "retrospective.md"));
      if (!retroContent || retroContent.split("\n").length < 30) {
        return {
          passed: false,
          feedback: "retrospective.md 不存在或内容不足（< 30 行），请补充完整的复盘报告。",
        };
      }
      return { passed: true, feedback: "" };
    }

    // Phase 8: Ship (delivery verification) — no tribunal
    case "8a": {
      // Check all commits are pushed
      try {
        const gitResult = await shell("git log --oneline --branches --not --remotes", projectRoot, 10_000);
        if (gitResult.exitCode !== 0) {
          return { passed: false, feedback: `git 命令执行失败: ${gitResult.stderr}` };
        }
        const unpushed = gitResult.stdout.trim();
        if (unpushed.length > 0) {
          return { passed: false, feedback: `存在未 push 的 commit:\n${unpushed}\n请执行 git push 推送所有变更。` };
        }
      } catch (err) {
        return { passed: false, feedback: `git 命令执行异常: ${(err as Error).message}` };
      }
      return { passed: true, feedback: "" };
    }

    case "8b": {
      const buildResultContent = await readFileSafe(join(outputDir, "ship-build-result.md"));
      if (!buildResultContent || !buildResultContent.includes("SUCCEED")) {
        return {
          passed: false,
          feedback: "ship-build-result.md 不存在或不含 'SUCCEED'，请确认构建成功后写入结果。",
        };
      }
      return { passed: true, feedback: "" };
    }

    case "8c": {
      const deployResultContent = await readFileSafe(join(outputDir, "ship-deploy-result.md"));
      if (!deployResultContent || !deployResultContent.includes("SUCCEED")) {
        return {
          passed: false,
          feedback: "ship-deploy-result.md 不存在或不含 'SUCCEED'，请确认部署成功后写入结果。",
        };
      }
      return { passed: true, feedback: "" };
    }

    case "8d": {
      const verifyContent = await readFileSafe(join(outputDir, "ship-verify-result.md"));
      if (!verifyContent) {
        return { passed: false, feedback: "ship-verify-result.md 不存在，请完成远程验证后写入结果。" };
      }
      if (verifyContent.includes("PASS")) {
        return { passed: true, feedback: "" };
      }
      if (verifyContent.includes("CODE_BUG")) {
        return {
          passed: false,
          feedback: "远程验证发现代码问题（CODE_BUG），需要回退到 Phase 3 修复。",
          regressToPhase: 3,
        };
      }
      // ENV_ISSUE or other failure — no regress, escalate
      return {
        passed: false,
        feedback: "远程验证失败（ENV_ISSUE 或其他环境问题），需要人工介入排查环境。",
      };
    }

    default:
      return { passed: true, feedback: "" };
  }
}

// ---------------------------------------------------------------------------
// Build Task Prompt for Step
// ---------------------------------------------------------------------------

/**
 * Extract task details including completion criteria from plan.md.
 * Falls back to extractTaskList if parsing fails.
 */
function extractTaskDetails(planContent: string): string {
  // Match ## Task N: title ... - **完成标准**: ...
  const taskPattern = /^## Task \d+[：:].+(?:\n(?!## Task).)*/gm;
  const matches = planContent.match(taskPattern);
  
  if (!matches || matches.length === 0) {
    // Fallback to simple task list
    const taskList = extractTaskList(planContent);
    return taskList || "实现 plan.md 中描述的所有功能";
  }
  
  return matches.join("\n\n");
}

export async function buildTaskForStep(
  step: string,
  outputDir: string,
  projectRoot: string,
  topic: string,
  buildCmd: string,
  testCmd: string,
  feedback?: string,
  extraVars?: Record<string, string>,
): Promise<string> {
  const variables: Record<string, string> = {
    topic,
    output_dir: outputDir,
    project_root: projectRoot,
    build_cmd: buildCmd,
    test_cmd: testCmd,
    ...extraVars,
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
    "8a": "phase8-ship",
    "8b": "phase8-ship",
    "8c": "phase8-ship",
    "8d": "phase8-ship",
  };

  // Step 3: implementation — special handling
  if (step === "3") {
    const planPath = join(outputDir, "plan.md");
    const planContent = await readFileSafe(planPath);

    if (!planContent) {
      // Turbo mode without plan.md — use topic directly
      return `请实现以下功能：${topic}\n\n项目根目录: ${projectRoot}` + approachPlanInstruction + ISOLATION_FOOTER;
    }

    // Extract task details with completion criteria (task-level contract)
    const taskDetails = extractTaskDetails(planContent);

    // Include P0/P1 issues from plan-review.md so developer doesn't miss critical feedback
    let reviewSection = "";
    const planReviewContent = await readFileSafe(join(outputDir, "plan-review.md"));
    if (planReviewContent) {
      const p0p1Lines = planReviewContent
        .split("\n")
        .filter(line => /\b(P0|P1)\b/.test(line))
        .map(line => line.trim())
        .filter(Boolean);
      if (p0p1Lines.length > 0) {
        reviewSection = `\n\n**⚠ 计划审查 P0/P1 修订要求（必须在实现中落实）：**\n${p0p1Lines.map(l => `- ${l}`).join("\n")}\n`;
      }
    }

    return `请完成以下任务：\n\n${taskDetails}${reviewSection}\n\n项目根目录: ${projectRoot}\n输出目录: ${outputDir}\n\n` +
      `**重要：每完成一个 task，先验证其完成标准是否满足，再开始下一个。**` +
      approachPlanInstruction + ISOLATION_FOOTER;
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
// parseTaskList — parse plan.md task blocks for step "3" injection
// ---------------------------------------------------------------------------

/**
 * Parse plan.md content into a list of TaskInfo objects.
 * Splits on "## Task N" headers and extracts taskNumber, title, description,
 * files (from "新建:" / "修改:" lines), and dependencies (from "依赖: Task N" lines).
 * Returns [] on any parse failure or when planContent is null/empty.
 */
export function parseTaskList(planContent: string | null): TaskInfo[] {
  if (!planContent) return [];
  try {
    // Split on ## Task N headers
    const blocks = planContent.split(/(?=^## Task\s+\d+)/m).filter(b => b.trim().length > 0);
    const tasks: TaskInfo[] = [];

    for (const block of blocks) {
      const headerMatch = block.match(/^## Task\s+(\d+)[:\s]*(.*)/m);
      if (!headerMatch) continue;

      const taskNumber = parseInt(headerMatch[1], 10);
      const title = headerMatch[2]?.trim() ?? "";

      // Description: lines after the header line, before the first sub-section (###) or until end
      const bodyLines = block.split("\n").slice(1); // skip header line
      const descLines: string[] = [];
      for (const line of bodyLines) {
        if (/^###/.test(line)) break;
        descLines.push(line);
      }
      const description = descLines.join("\n").trim();

      // Files: lines matching "新建:" or "修改:" — extract paths
      const files: string[] = [];
      const fileRegex = /(?:新建|修改)[:：]\s*(.+)/g;
      let fileMatch: RegExpExecArray | null;
      while ((fileMatch = fileRegex.exec(block)) !== null) {
        // May be a comma-separated list or single path
        const raw = fileMatch[1].trim();
        for (const part of raw.split(/[,，]/)) {
          const p = part.trim().replace(/`/g, "");
          if (p.length > 0) files.push(p);
        }
      }

      // Dependencies: "依赖: Task N" or "依赖: Task N, Task M"
      const dependencies: number[] = [];
      const depRegex = /依赖[:：]\s*(.*)/g;
      let depMatch: RegExpExecArray | null;
      while ((depMatch = depRegex.exec(block)) !== null) {
        const raw = depMatch[1];
        const nums = raw.match(/\d+/g);
        if (nums) {
          for (const n of nums) {
            dependencies.push(parseInt(n, 10));
          }
        }
      }

      tasks.push({ taskNumber, title, description, files, dependencies });
    }

    return tasks;
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Extracted sub-functions for computeNextTask
// ---------------------------------------------------------------------------

/**
 * Handle the "no step" scenario: PASS advancement, design doc compliance skip, or normal startup.
 */
async function resolveInitialStep(
  ctx: OrchestratorContext,
  stepState: StepState,
): Promise<NextTaskResult> {
  const { sm, state, outputDir, projectRoot, topic, buildCmd, testCmd, phases, skipSteps, getExtraVars } = ctx;

  // When status === "PASS", the current phase was completed (e.g. by tribunal_verdict)
  // and we need to advance to the NEXT phase — not restart the current one.
  if (state.status === "PASS" && state.phase && phases.includes(state.phase)) {
    const completedPhase = state.phase;
    const lastStepOfCompleted = lastStepForPhase(completedPhase);
    const nextStep = computeNextStep(lastStepOfCompleted, phases, skipSteps);

    if (!nextStep) {
      await sm.atomicUpdate({
        step: null, stepIteration: 0, lastValidation: "DONE",
        status: "COMPLETED",
      });
      return {
        done: true, step: null, agent: null, prompt: null,
        message: "All phases completed successfully.",
      };
    }

    const nextPhase = phaseForStep(nextStep);
    await sm.atomicUpdate({
      step: nextStep, stepIteration: 0, lastValidation: null, approachState: null,
      phase: nextPhase, status: "IN_PROGRESS",
    });

    const prompt = await buildTaskForStep(
      nextStep, outputDir, projectRoot, topic, buildCmd, testCmd, undefined, getExtraVars(nextStep),
    );

    const result: NextTaskResult = {
      done: false,
      step: nextStep,
      agent: STEP_AGENTS[nextStep] ?? null,
      prompt,
      message: `Phase ${completedPhase} passed. Advancing to step ${nextStep} (phase ${nextPhase}).`,
    };
    if (nextStep === "3") {
      const planContent = await readFileSafe(join(outputDir, "plan.md"));
      result.tasks = parseTaskList(planContent);
    }
    return result;
  }

  // Normal startup: use state.phase if already mid-flow, otherwise the mode's first phase.
  const firstPhase = (state.phase && phases.includes(state.phase)) ? state.phase : phases[0]!;
  let firstStep = firstStepForPhase(firstPhase);

  // Skip Phase 1a if design doc already exists and is compliant
  if (firstStep === "1a" && state.designDocBound) {
    const designContent = await readFileSafe(join(outputDir, "design.md"));
    if (designContent && designContent.length >= 100) {
      const { compliant } = checkDesignDocCompliance(designContent);
      if (compliant) {
        firstStep = "1b";
        await sm.atomicUpdate({
          step: firstStep, stepIteration: 0, lastValidation: null,
          phase: firstPhase, status: "IN_PROGRESS",
        });
        const prompt = await buildTaskForStep(
          firstStep, outputDir, projectRoot, topic, buildCmd, testCmd, undefined, getExtraVars(firstStep),
        );
        return {
          done: false,
          step: firstStep,
          agent: STEP_AGENTS[firstStep] ?? null,
          prompt,
          message: `Design doc is compliant (has AC table + solution comparison). Skipping 1a, starting at 1b (review).`,
        };
      }
    }
  }

  // Single atomicUpdate: step + phase
  await sm.atomicUpdate({
    step: firstStep, stepIteration: 0, lastValidation: null,
    phase: firstPhase, status: "IN_PROGRESS",
  });

  const prompt = await buildTaskForStep(
    firstStep, outputDir, projectRoot, topic, buildCmd, testCmd, undefined, getExtraVars(firstStep),
  );

  const startupResult: NextTaskResult = {
    done: false,
    step: firstStep,
    agent: STEP_AGENTS[firstStep] ?? null,
    prompt,
    message: `Starting step ${firstStep} (phase ${firstPhase}).`,
  };
  if (firstStep === "3") {
    const planContent = await readFileSafe(join(outputDir, "plan.md"));
    startupResult.tasks = parseTaskList(planContent);
  }
  return startupResult;
}

/**
 * Handle phase regression (e.g. Phase 8 CODE_BUG -> regress to Phase 3).
 */
async function handlePhaseRegress(
  ctx: OrchestratorContext,
  currentStep: string,
  validation: { feedback: string; regressToPhase: number },
): Promise<NextTaskResult> {
  const { sm, state, outputDir, projectRoot, topic, buildCmd, testCmd } = ctx;
  const currentShipRound = (state.shipRound ?? 0) + 1;
  const maxRounds = state.shipMaxRounds ?? 5;
  if (currentShipRound >= maxRounds) {
    await sm.atomicUpdate({ status: "BLOCKED" });
    return {
      done: false, step: currentStep, agent: null, prompt: null,
      escalation: {
        reason: "ship_max_rounds",
        lastFeedback: validation.feedback,
      },
      message: `Ship 已达最大轮次 (${currentShipRound}/${maxRounds})，需要人工介入。`,
    };
  }

  console.error(`[orchestrator] phase regress: step=${currentStep} regressTo=${validation.regressToPhase} round=${currentShipRound}`);
  const regressStep = firstStepForPhase(validation.regressToPhase);
  await sm.atomicUpdate({
    phase: validation.regressToPhase,
    step: regressStep,
    stepIteration: 0,
    shipRound: currentShipRound,
    lastValidation: "SHIP_REGRESS",
    approachState: null,
    status: "IN_PROGRESS",
    lastFailureDetail: validation.feedback,
  });

  const prompt = await buildTaskForStep(
    regressStep, outputDir, projectRoot, topic, buildCmd, testCmd, validation.feedback,
  );
  return {
    done: false,
    step: regressStep,
    agent: STEP_AGENTS[regressStep] ?? null,
    prompt,
    message: `Step ${currentStep} 远程验证失败 (CODE_BUG)，回退到 Phase ${validation.regressToPhase} (round ${currentShipRound})。`,
  };
}

/**
 * Handle circuit breaker: approach failure, circuit break, all exhausted.
 * Returns { result, approachAction } — result is non-null if handled (CIRCUIT_BREAK / ALL_EXHAUSTED).
 */
async function handleCircuitBreaker(
  ctx: OrchestratorContext,
  stepState: StepState,
  currentStep: string,
  validation: { feedback: string },
): Promise<{ result: NextTaskResult | null; approachAction: ApproachAction }> {
  const { sm, outputDir } = ctx;
  const approachResult = await handleApproachFailure(
    stepState, currentStep, outputDir, validation.feedback,
  );

  if (approachResult.action === "CIRCUIT_BREAK") {
    console.error(`[orchestrator] circuit breaker: step=${currentStep} phase=${phaseForStep(currentStep)}`);
    await sm.atomicUpdate({
      stepIteration: 0, lastValidation: "CIRCUIT_BREAK",
      approachState: approachResult.approachState,
      lastFailureDetail: validation.feedback,
    });

    return {
      result: {
        done: false,
        step: currentStep,
        agent: STEP_AGENTS[currentStep] ?? null,
        prompt: approachResult.prompt,
        freshContext: true,
        lastFailureDetail: validation.feedback,
        message: `方案 "${approachResult.failedApproach}" 已熔断，切换到 "${approachResult.nextApproach}"。`,
      },
      approachAction: approachResult,
    };
  }

  if (approachResult.action === "ALL_EXHAUSTED") {
    await sm.atomicUpdate({
      lastValidation: "ALL_APPROACHES_EXHAUSTED", status: "BLOCKED",
      lastFailureDetail: validation.feedback,
    });

    return {
      result: {
        done: false, step: currentStep, agent: null, prompt: null,
        escalation: {
          reason: "all_approaches_exhausted",
          lastFeedback: validation.feedback,
        },
        lastFailureDetail: validation.feedback,
        message: `Step ${currentStep} 所有方案均已失败，需要人工介入。`,
      },
      approachAction: approachResult,
    };
  }

  // CONTINUE: persist approachState if present
  if (approachResult.approachState) {
    await sm.atomicUpdate({ approachState: approachResult.approachState });
  }

  return { result: null, approachAction: approachResult };
}

/**
 * Handle all validation failure branches: tribunal, phase regress, circuit breaker, iteration limit, revision.
 */
async function handleValidationFailure(
  ctx: OrchestratorContext,
  stepState: StepState,
  validation: { passed: boolean; feedback: string; tribunalResult?: EvalTribunalResult; regressToPhase?: number },
): Promise<NextTaskResult> {
  const { sm, state, outputDir, projectRoot, topic, buildCmd, testCmd, getExtraVars } = ctx;
  const currentStep = stepState.step!;
  const currentIteration = stepState.stepIteration;

  // --- Tribunal FAIL: handle counter + ESCALATE ---
  if (validation.tribunalResult) {
    const phaseKey = String(phaseForStep(currentStep));
    const submits = state.tribunalSubmits ?? {};
    const count = (submits[phaseKey] ?? 0) + 1;

    if (validation.tribunalResult.subagentRequested) {
      return handleTribunalSubagent(ctx, phaseKey, count, currentStep, validation.tribunalResult);
    }

    if (validation.tribunalResult.rawParseFailure && validation.tribunalResult.rawOutput) {
      return handleTribunalParseFailure(ctx, phaseKey, count, currentStep, validation.tribunalResult);
    }

    if (validation.tribunalResult.crashed) {
      console.error(`[orchestrator] tribunal crashed: step=${currentStep} phase=${phaseKey}`);
      return handleTribunalCrashEscalation(ctx, phaseKey, count, currentStep, validation.tribunalResult);
    }

    if (count >= 3) {
      console.error(`[orchestrator] tribunal failure limit reached: step=${currentStep} phase=${phaseKey} count=${count}`);
      return handleTribunalEscalation(ctx, phaseKey, currentStep, validation.feedback);
    }

    // Tribunal FAIL but under limit — increment counter and return revision
    await sm.atomicUpdate({
      stepIteration: currentIteration + 1, lastValidation: "FAILED",
      tribunalSubmits: { ...submits, [phaseKey]: count },
      lastFailureDetail: validation.feedback,
    });

    const prompt = await buildTaskForStep(
      currentStep, outputDir, projectRoot, topic, buildCmd, testCmd, validation.feedback, getExtraVars(currentStep),
    );
    return {
      done: false,
      step: currentStep,
      agent: STEP_AGENTS[currentStep] ?? null,
      prompt,
      lastFailureDetail: validation.feedback,
      message: `Step ${currentStep} tribunal FAIL (attempt ${count}/3). Revision needed.`,
    };
  }

  // --- regressToPhase handling (Phase 8 CODE_BUG -> regress to Phase 3) ---
  if (validation.regressToPhase !== undefined) {
    return handlePhaseRegress(ctx, currentStep, { feedback: validation.feedback, regressToPhase: validation.regressToPhase });
  }

  // --- Non-tribunal failure: circuit breaker + iteration logic ---
  const { result: circuitResult, approachAction: approachResult } = await handleCircuitBreaker(ctx, stepState, currentStep, validation);
  if (circuitResult) return circuitResult;

  // Check iteration limit (skip if approachState exists)
  const hasApproachState = !!(
    (approachResult.action === "CONTINUE" && approachResult.approachState) || stepState.approachState
  );
  if (!hasApproachState && currentIteration >= MAX_STEP_ITERATIONS) {
    await sm.atomicUpdate({
      lastValidation: "ESCALATED", status: "BLOCKED",
    });
    return {
      done: false, step: currentStep, agent: null, prompt: null,
      escalation: {
        reason: "iteration_limit_exceeded",
        lastFeedback: validation.feedback,
      },
      message: `Step ${currentStep} exceeded maximum iterations (${MAX_STEP_ITERATIONS}). Escalating.`,
    };
  }

  // Return revision prompt
  const newIteration = currentIteration + 1;

  // Determine revision step (1b fail -> 1c, 2b fail -> 2c, etc)
  let revisionStep = currentStep;
  if (currentStep === "1b") revisionStep = "1c";
  if (currentStep === "2b") revisionStep = "2c";
  if (currentStep === "5b") revisionStep = "5c";

  const effectiveStep = revisionStep !== currentStep ? revisionStep : currentStep;
  await sm.atomicUpdate({
    step: effectiveStep, stepIteration: newIteration, lastValidation: "FAILED",
    lastFailureDetail: validation.feedback,
  });

  let combinedFeedback = validation.feedback;
  if (approachResult.action === "CONTINUE" && approachResult.planFeedback) {
    combinedFeedback += `\n\n${approachResult.planFeedback}`;
  }

  const prompt = await buildTaskForStep(
    effectiveStep, outputDir, projectRoot, topic, buildCmd, testCmd, combinedFeedback, getExtraVars(effectiveStep),
  );

  return {
    done: false,
    step: effectiveStep,
    agent: STEP_AGENTS[effectiveStep] ?? STEP_AGENTS[currentStep] ?? null,
    prompt,
    lastFailureDetail: validation.feedback,
    message: `Step ${currentStep} validation failed (iteration ${newIteration}/${MAX_STEP_ITERATIONS}). Revision needed.`,
  };
}

/**
 * Handle validation passed: progress log, TDD gate, step advancement or completion.
 */
async function advanceToNextStep(
  ctx: OrchestratorContext,
  currentStep: string,
  validation: { passed: boolean; feedback: string; tribunalResult?: EvalTribunalResult; regressToPhase?: number },
): Promise<NextTaskResult> {
  const { sm, state, outputDir, projectRoot, topic, buildCmd, testCmd, phases, skipSteps, getExtraVars } = ctx;
  const currentPhase = phaseForStep(currentStep);

  // [FIX-1] Revision steps (1c/2c/5c) are not in STEP_ORDER.
  // When a revision step passes, go back to the parent step for re-validation
  // instead of calling computeNextStep (which would return null → premature done=true).
  const REVISION_TO_PARENT: Record<string, string> = { "1c": "1b", "2c": "2b", "5c": "5b" };
  const parentStep = REVISION_TO_PARENT[currentStep];
  if (parentStep) {
    await sm.appendToProgressLog(
      "\n" + sm.getCheckpointLine(currentPhase, undefined, "PASS", `Revision step ${currentStep} passed. Re-validating ${parentStep}.`) + "\n",
    );
    await sm.atomicUpdate({
      step: parentStep, stepIteration: 0, lastValidation: null, approachState: null,
    });
    return {
      done: false,
      step: parentStep,
      agent: null,
      prompt: null,
      message: `Revision step ${currentStep} completed. Re-validating parent step ${parentStep}.`,
    };
  }

  // Write progress-log checkpoint (audit only)
  await sm.appendToProgressLog(
    "\n" + sm.getCheckpointLine(currentPhase, undefined, "PASS", `Step ${currentStep} passed.`) + "\n",
  );

  // Reset tribunal counter on PASS
  const tribunalUpdates: Record<string, unknown> = {};
  if (validation.tribunalResult) {
    const phaseKey = String(currentPhase);
    tribunalUpdates.tribunalSubmits = { ...(state.tribunalSubmits ?? {}), [phaseKey]: 0 };
  }

  const nextStep = computeNextStep(currentStep, phases, skipSteps);

  // TDD global gate: block Phase 3 -> Phase 4 transition if not all tasks are GREEN_CONFIRMED
  if (nextStep && state.tdd === true && phaseForStep(currentStep) === 3 && phaseForStep(nextStep) >= 4) {
    const planContent = await readFileSafe(join(outputDir, "plan.md"));
    if (planContent) {
      const taskMatches = planContent.match(/^## Task\s+(\d+)/gm) ?? [];
      const taskNums = taskMatches.map(m => parseInt(m.replace(/^## Task\s+/, ""), 10));
      let nonExemptCount = 0;
      let greenCount = 0;
      for (const t of taskNums) {
        const exempt = await isTddExemptTask(outputDir, t);
        if (!exempt) {
          nonExemptCount++;
          if (state.tddTaskStates?.[String(t)]?.status === "GREEN_CONFIRMED") {
            greenCount++;
          }
        }
      }
      if (nonExemptCount > 0 && greenCount < nonExemptCount) {
        return {
          done: false,
          step: currentStep,
          agent: null,
          prompt: null,
          message: `TDD_GATE_GLOBAL_INCOMPLETE: ${greenCount}/${nonExemptCount} non-exempt tasks are GREEN_CONFIRMED. All must pass before Phase 4.`,
        };
      }
    }
  }

  if (!nextStep) {
    // All steps done — single atomicUpdate
    await sm.atomicUpdate({
      step: null, stepIteration: 0, lastValidation: "DONE",
      status: "COMPLETED",
      ...tribunalUpdates,
    });

    return {
      done: true,
      step: null,
      agent: null,
      prompt: null,
      message: "All phases completed successfully.",
    };
  }

  // Advance to next step — single atomicUpdate
  const nextPhase = phaseForStep(nextStep);
  await sm.atomicUpdate({
    step: nextStep, stepIteration: 0, lastValidation: null, approachState: null,
    lastFailureDetail: null,
    phase: nextPhase, status: "IN_PROGRESS",
    ...tribunalUpdates,
  });

  const prompt = await buildTaskForStep(
    nextStep, outputDir, projectRoot, topic, buildCmd, testCmd, undefined, getExtraVars(nextStep),
  );

  const advanceResult: NextTaskResult = {
    done: false,
    step: nextStep,
    agent: STEP_AGENTS[nextStep] ?? null,
    prompt,
    message: `Step ${currentStep} passed. Advancing to step ${nextStep} (phase ${nextPhase}).`,
  };
  if (nextStep === "3") {
    const planContent = await readFileSafe(join(outputDir, "plan.md"));
    advanceResult.tasks = parseTaskList(planContent);
  }
  return advanceResult;
}

// ---------------------------------------------------------------------------
// computeNextTask — Main Step Function
// ---------------------------------------------------------------------------

export async function computeNextTask(
  projectRoot: string,
  topic: string,
): Promise<NextTaskResult> {
  // 1. Load state via StateManager (use create() to resolve timestamp-prefixed dirs)
  const sm = await StateManager.create(projectRoot, topic);
  const state = await sm.loadAndValidate();

  const outputDir = sm.outputDir;
  const mode = state.mode;
  let phases = PHASE_SEQUENCE[mode] ?? [3];
  if (state.skipE2e === true) {
    phases = phases.filter(p => p !== 5);
  }
  if (state.ship === true) {
    phases = [...phases, 8];
  }
  const buildCmd = state.stack.buildCmd;
  const testCmd = state.stack.testCmd;
  const skipSteps = state.skipSteps ?? [];
  // codeRoot: actual directory where code lives (may differ from projectRoot for skill projects)
  const effectiveCodeRoot = state.codeRoot ?? projectRoot;

  // Ship extra variables for Phase 8 prompt rendering
  const shipExtraVars: Record<string, string> | undefined = state.ship === true
    ? {
        substep: "",  // will be overridden per call
        deployTarget: state.deployTarget ?? "",
        deployBranch: state.deployBranch ?? "",
        deployEnv: state.deployEnv ?? "green",
        verifyMethod: state.verifyMethod ?? "",
        verifyEndpoint: state.verifyConfig?.endpoint ?? "",
        verifyExpectedPattern: state.verifyConfig?.expectedPattern ?? "",
        verifyLogPath: state.verifyConfig?.logPath ?? "",
        verifyLogKeyword: state.verifyConfig?.logKeyword ?? "",
        verifySshHost: state.verifyConfig?.sshHost ?? "",
      }
    : undefined;

  /** Build extraVars for a specific step, adding substep for Phase 8 */
  function getExtraVars(step: string): Record<string, string> | undefined {
    if (shipExtraVars && step.startsWith("8")) {
      return { ...shipExtraVars, substep: step };
    }
    return undefined;
  }

  // Build orchestrator context for extracted sub-functions
  const ctx: OrchestratorContext = {
    sm, state, outputDir, projectRoot, effectiveCodeRoot,
    topic, buildCmd, testCmd, phases, skipSteps, getExtraVars,
  };

  // 2. Read step state
  const stepState = await readStepState(sm.stateFilePath);

  // 3. If no step: determine first phase, set step, return first task prompt
  if (!stepState.step) {
    return resolveInitialStep(ctx, stepState);
  }

  // 4. Step exists — validate previous step's artifacts
  const currentStep = stepState.step;

  const validation = await validateStep(
    currentStep, outputDir, effectiveCodeRoot, buildCmd, testCmd, sm, state, topic,
  );

  if (!validation.passed) {
    return handleValidationFailure(ctx, stepState, validation);
  }

  // 5. Validation passed — advance to next step
  return advanceToNextStep(ctx, currentStep, validation);
}
