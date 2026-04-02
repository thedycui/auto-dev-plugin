/**
 * auto-dev MCP Server — Type Definitions
 *
 * All runtime schemas are defined with Zod v4.
 * TypeScript interfaces are inferred from schemas via `z.infer<>`.
 */

import { z } from "zod/v4";

// Re-export AC schema types for external consumers
export type {
  AcceptanceCriterion,
  AcceptanceCriteria,
  AssertionType,
} from "./ac-schema.js";

// ---------------------------------------------------------------------------
// Enums / Shared Literals
// ---------------------------------------------------------------------------

export const ModeSchema = z.enum(["full", "quick", "turbo"]);
export const ChangeTypeSchema = z.enum(["refactor", "bugfix", "feature", "config", "docs"]);

export const PhaseStatusSchema = z.enum([
  "IN_PROGRESS",
  "PASS",
  "NEEDS_REVISION",
  "BLOCKED",
  "COMPLETED",
  "REGRESS",
]);

export const OnConflictSchema = z.enum(["resume", "overwrite"]);

// ---------------------------------------------------------------------------
// StackInfo
// ---------------------------------------------------------------------------

export const StackInfoSchema = z.object({
  language: z.string(),
  buildCmd: z.string(),
  testCmd: z.string(),
  langChecklist: z.string(),
});

export type StackInfo = z.infer<typeof StackInfoSchema>;

// ---------------------------------------------------------------------------
// GitInfo
// ---------------------------------------------------------------------------

export const GitInfoSchema = z.object({
  currentBranch: z.string(),
  isDirty: z.boolean(),
  diffStat: z.string(),
});

export type GitInfo = z.infer<typeof GitInfoSchema>;

// ---------------------------------------------------------------------------
// LessonEntry
// ---------------------------------------------------------------------------

export const LessonEntrySchema = z.object({
  id: z.string().optional(),
  phase: z.number().int(),
  category: z.enum(["pitfall", "highlight", "process", "technical", "pattern", "iteration-limit", "tribunal"]),
  severity: z.enum(["critical", "important", "minor"]).optional(),
  lesson: z.string(),
  context: z.string().optional(),
  topic: z.string().optional(),
  reusable: z.boolean().optional(),
  appliedCount: z.number().int().optional(),
  lastAppliedAt: z.string().optional(),
  timestamp: z.string(),

  // Cross-project promotion tracking (self-evolution)
  sourceProject: z.string().optional(),
  promotedAt: z.string().optional(),
  promotionPath: z.enum(["local_to_project", "project_to_global"]).optional(),

  // Scoring & feedback fields (lessons-evolution)
  score: z.number().optional(),
  lastPositiveAt: z.string().optional(),
  feedbackHistory: z.array(z.object({
    verdict: z.enum(["helpful", "not_applicable", "incorrect"]),
    phase: z.number(),
    topic: z.string(),
    timestamp: z.string(),
  })).optional(),
  retired: z.boolean().optional(),
  retiredAt: z.string().optional(),
  retiredReason: z.enum(["displaced_by_new", "score_decayed", "manually_removed"]).optional(),
});

export type LessonEntry = z.infer<typeof LessonEntrySchema>;

// ---------------------------------------------------------------------------
// ApproachState — circuit breaker approach tracking
// ---------------------------------------------------------------------------

export const ApproachEntrySchema = z.object({
  id: z.string(),
  summary: z.string(),
  failCount: z.number().int(),
});

export type ApproachEntryType = z.infer<typeof ApproachEntrySchema>;

export const FailedApproachSchema = z.object({
  id: z.string(),
  summary: z.string(),
  failReason: z.string(),
});

export type FailedApproachType = z.infer<typeof FailedApproachSchema>;

export const ApproachStateSchema = z.object({
  stepId: z.string(),
  approaches: z.array(ApproachEntrySchema),
  currentIndex: z.number().int(),
  failedApproaches: z.array(FailedApproachSchema),
});

export type ApproachState = z.infer<typeof ApproachStateSchema>;

// ---------------------------------------------------------------------------
// StateJson — persisted in state.json
// ---------------------------------------------------------------------------

export const StateJsonSchema = z.object({
  topic: z.string(),
  mode: ModeSchema,
  phase: z.number().int(),
  task: z.number().int().optional(),
  iteration: z.number().int().optional(),
  status: PhaseStatusSchema,

  // Stack info
  stack: StackInfoSchema,

  // Paths
  outputDir: z.string(),
  projectRoot: z.string(),
  codeRoot: z.string().optional(),  // Actual code directory (defaults to projectRoot if not set)

  // Dirty flag — set when progress-log was written but state.json update failed
  dirty: z.boolean().optional(),

  // Behavior flags
  interactive: z.boolean().optional(),  // --interactive mode (default: false = fully automatic)
  dryRun: z.boolean().optional(),       // --dry-run mode (only Phase 1-2)
  skipE2e: z.boolean().optional(),      // --skip-e2e mode (skip Phase 5)
  skipSteps: z.array(z.string()).optional(),  // lightweight mode: skip specific steps (e.g. ["1b", "2b"])
  tdd: z.boolean().optional(),          // --tdd mode (RED-GREEN-REFACTOR in Phase 3)
  tddTaskStates: z.record(z.string(), z.object({
    status: z.enum(["PENDING", "RED_CONFIRMED", "GREEN_CONFIRMED"]),
    redTestFiles: z.array(z.string()).optional(),
    redExitCode: z.number().optional(),
    redFailType: z.enum(["compilation_error", "test_failure"]).optional(),
  })).optional(),
  brainstorm: z.boolean().optional(),   // --brainstorm mode (Phase 0 enabled)
  costMode: z.enum(["economy", "beast"]).optional(), // economy=按阶段选模型(默认), beast=全部最强模型

  // Design doc binding — tracks whether an external design doc was provided
  designDocSource: z.string().optional(),  // original path of the design doc
  designDocBound: z.boolean().optional(),  // true if design.md was copied from external source

  // Git baseline for accurate Phase 5 diff
  startCommit: z.string().optional(),

  // Regression count (max 2 regressions allowed)
  regressionCount: z.number().int().optional(),

  // Phase-level timing data
  phaseTimings: z.record(
    z.string(),
    z.object({
      startedAt: z.string(),
      completedAt: z.string().optional(),
      durationMs: z.number().optional(),
    })
  ).optional(),

  // Token usage tracking
  tokenUsage: z.object({
    total: z.number(),
    byPhase: z.record(z.string(), z.number()),
  }).optional(),

  // Injected lesson IDs for feedback tracking (lessons-evolution)
  injectedLessonIds: z.array(z.string()).optional(),

  // Injected global (cross-project) lesson IDs (self-evolution)
  injectedGlobalLessonIds: z.array(z.string()).optional(),

  // Tribunal submit counters per phase (tribunal feature)
  tribunalSubmits: z.record(z.string(), z.number()).optional(),

  // Step orchestrator state (persisted across auto_dev_next calls)
  step: z.string().nullable().optional(),
  stepIteration: z.number().int().optional(),
  lastValidation: z.string().nullable().optional(),
  approachState: z.any().nullable().optional(), // Complex nested object, validated at orchestrator level

  // Phase-level escalation counter (Issue #2: ESCALATE auto-regress)
  phaseEscalateCount: z.record(z.string(), z.number()).optional(),

  // Ship (Phase 8) — optional delivery verification
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
  shipRound: z.number().int().optional(),
  shipMaxRounds: z.number().int().optional(),

  // Timestamps
  startedAt: z.string(),
  updatedAt: z.string(),
});

export type StateJson = z.infer<typeof StateJsonSchema>;

/** TDD task state for a single task */
export interface TddTaskState {
  status: "PENDING" | "RED_CONFIRMED" | "GREEN_CONFIRMED";
  redTestFiles?: string[];
  redExitCode?: number;
  redFailType?: "compilation_error" | "test_failure";
}

// ---------------------------------------------------------------------------
// auto_dev_init
// ---------------------------------------------------------------------------

export const InitInputSchema = z.object({
  projectRoot: z.string(),
  topic: z.string(),
  mode: ModeSchema,
  startPhase: z.number().int().optional(),
  interactive: z.boolean().optional(),   // --interactive mode (replaces noConfirm)
  dryRun: z.boolean().optional(),        // --dry-run: only Phase 1-2
  skipE2e: z.boolean().optional(),      // --skip-e2e: skip Phase 5
  tdd: z.boolean().optional(),          // --tdd: RED-GREEN-REFACTOR in Phase 3
  brainstorm: z.boolean().optional(),   // --brainstorm: enable Phase 0
  onConflict: OnConflictSchema.optional(),
  // Ship (Phase 8) parameters
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
  shipMaxRounds: z.number().int().optional(),
});

export type InitInput = z.infer<typeof InitInputSchema>;

export const InitOutputSchema = z.object({
  outputDir: z.string(),
  stateFile: z.string(),
  resumed: z.boolean(),
  stack: StackInfoSchema,
  git: GitInfoSchema,
  variables: z.record(z.string(), z.string()),
});

export type InitOutput = z.infer<typeof InitOutputSchema>;

// ---------------------------------------------------------------------------
// auto_dev_render
// ---------------------------------------------------------------------------

export const RenderInputSchema = z.object({
  promptFile: z.string(),
  variables: z.record(z.string(), z.string()),
  extraContext: z.string().optional(),
});

export type RenderInput = z.infer<typeof RenderInputSchema>;

export const RenderOutputSchema = z.object({
  renderedPrompt: z.string(),
  warnings: z.array(z.string()),
});

export type RenderOutput = z.infer<typeof RenderOutputSchema>;

// ---------------------------------------------------------------------------
// auto_dev_checkpoint
// ---------------------------------------------------------------------------

export const CheckpointInputSchema = z.object({
  phase: z.number().int(),
  task: z.number().int().optional(),
  status: PhaseStatusSchema,
  summary: z.string().optional(),
  tokenEstimate: z.number().optional(),
  regressTo: z.number().int().min(1).max(5).optional(),
});

export type CheckpointInput = z.infer<typeof CheckpointInputSchema>;

// ---------------------------------------------------------------------------
// auto_dev_diff_check
// ---------------------------------------------------------------------------

export const DiffCheckInputSchema = z.object({
  expectedFiles: z.array(z.string()),
  baseCommit: z.string(),
});

export type DiffCheckInput = z.infer<typeof DiffCheckInputSchema>;

export const DiffCheckOutputSchema = z.object({
  actualFiles: z.array(z.string()),
  expectedButMissing: z.array(z.string()),
  unexpectedChanges: z.array(z.string()),
  diffStat: z.string(),
  isClean: z.boolean(),
});

export type DiffCheckOutput = z.infer<typeof DiffCheckOutputSchema>;

// ---------------------------------------------------------------------------
// auto_dev_preflight
// ---------------------------------------------------------------------------

export const PreflightInputSchema = z.object({
  projectRoot: z.string(),
  topic: z.string(),
  phase: z.number().int(),
});

export type PreflightInput = z.infer<typeof PreflightInputSchema>;

export const PreflightOutputSchema = z.object({
  ready: z.boolean(),
  checks: z.array(
    z.object({
      name: z.string(),
      passed: z.boolean(),
      message: z.string().optional(),
    }),
  ),
});

export type PreflightOutput = z.infer<typeof PreflightOutputSchema>;

// ---------------------------------------------------------------------------
// TribunalVerdict — returned by independent judge agent
// ---------------------------------------------------------------------------

/** Tribunal verdict returned by independent judge agent */
export interface TribunalVerdict {
  verdict: "PASS" | "FAIL";
  issues: Array<{
    severity: "P0" | "P1" | "P2";
    description: string;
    file?: string;
    suggestion?: string;
    acRef?: string;
  }>;
  advisory?: Array<{
    description: string;
    suggestion?: string;
  }>;
  traces?: Array<{
    source: string;
    status: "FIXED" | "NOT_FIXED" | "PARTIAL";
    evidence?: string;
  }>;
  passEvidence?: string[];
  raw: string;
}

// ---------------------------------------------------------------------------
// RetrospectiveAutoData — framework-generated, tamper-proof
// ---------------------------------------------------------------------------

/** Auto-generated retrospective data (framework-generated, tamper-proof) */
export interface RetrospectiveAutoData {
  rejectionCount: number;
  phaseTimings: Record<number, { startedAt: string; completedAt?: string; durationMs?: number }>;
  tribunalResults: Array<{ phase: number; verdict: string; issueCount: number }>;
  tribunalCrashes: Array<{
    phase: number;
    category?: string;
    exitCode?: string;
    retryable?: boolean;
    timestamp?: string;
  }>;
  submitRetries: Record<number, number>;
  tddGateStats?: {
    totalTasks: number;
    tddTasks: number;
    exemptTasks: number;
    redRejections: number;
    greenRejections: number;
  };
}
