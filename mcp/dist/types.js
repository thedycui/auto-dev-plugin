/**
 * auto-dev MCP Server — Type Definitions
 *
 * All runtime schemas are defined with Zod v4.
 * TypeScript interfaces are inferred from schemas via `z.infer<>`.
 */
import { z } from "zod/v4";
// ---------------------------------------------------------------------------
// Enums / Shared Literals
// ---------------------------------------------------------------------------
export const ModeSchema = z.enum(["full", "quick"]);
export const PhaseStatusSchema = z.enum([
    "IN_PROGRESS",
    "PASS",
    "NEEDS_REVISION",
    "BLOCKED",
    "COMPLETED",
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
// ---------------------------------------------------------------------------
// GitInfo
// ---------------------------------------------------------------------------
export const GitInfoSchema = z.object({
    currentBranch: z.string(),
    isDirty: z.boolean(),
    diffStat: z.string(),
});
// ---------------------------------------------------------------------------
// LessonEntry
// ---------------------------------------------------------------------------
export const LessonEntrySchema = z.object({
    phase: z.number().int(),
    category: z.string(),
    lesson: z.string(),
    context: z.string().optional(),
    timestamp: z.string(),
});
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
    // Dirty flag — set when progress-log was written but state.json update failed
    dirty: z.boolean().optional(),
    // Behavior flags
    interactive: z.boolean().optional(), // --interactive mode (default: false = fully automatic)
    dryRun: z.boolean().optional(), // --dry-run mode (only Phase 1-2)
    skipE2e: z.boolean().optional(), // --skip-e2e mode (skip Phase 5)
    // Git baseline for accurate Phase 5 diff
    startCommit: z.string().optional(),
    // Phase-level timing data
    phaseTimings: z.record(z.string(), z.object({
        startedAt: z.string(),
        completedAt: z.string().optional(),
        durationMs: z.number().optional(),
    })).optional(),
    // Token usage tracking
    tokenUsage: z.object({
        total: z.number(),
        byPhase: z.record(z.string(), z.number()),
    }).optional(),
    // Timestamps
    startedAt: z.string(),
    updatedAt: z.string(),
});
// ---------------------------------------------------------------------------
// auto_dev_init
// ---------------------------------------------------------------------------
export const InitInputSchema = z.object({
    projectRoot: z.string(),
    topic: z.string(),
    mode: ModeSchema,
    startPhase: z.number().int().optional(),
    interactive: z.boolean().optional(), // --interactive mode (replaces noConfirm)
    dryRun: z.boolean().optional(), // --dry-run: only Phase 1-2
    skipE2e: z.boolean().optional(), // --skip-e2e: skip Phase 5
    onConflict: OnConflictSchema.optional(),
});
export const InitOutputSchema = z.object({
    outputDir: z.string(),
    stateFile: z.string(),
    resumed: z.boolean(),
    stack: StackInfoSchema,
    git: GitInfoSchema,
    variables: z.record(z.string(), z.string()),
});
// ---------------------------------------------------------------------------
// auto_dev_render
// ---------------------------------------------------------------------------
export const RenderInputSchema = z.object({
    promptFile: z.string(),
    variables: z.record(z.string(), z.string()),
    extraContext: z.string().optional(),
});
export const RenderOutputSchema = z.object({
    renderedPrompt: z.string(),
    warnings: z.array(z.string()),
});
// ---------------------------------------------------------------------------
// auto_dev_checkpoint
// ---------------------------------------------------------------------------
export const CheckpointInputSchema = z.object({
    phase: z.number().int(),
    task: z.number().int().optional(),
    status: PhaseStatusSchema,
    summary: z.string().optional(),
    tokenEstimate: z.number().optional(),
});
// ---------------------------------------------------------------------------
// auto_dev_diff_check
// ---------------------------------------------------------------------------
export const DiffCheckInputSchema = z.object({
    expectedFiles: z.array(z.string()),
    baseCommit: z.string(),
});
export const DiffCheckOutputSchema = z.object({
    actualFiles: z.array(z.string()),
    expectedButMissing: z.array(z.string()),
    unexpectedChanges: z.array(z.string()),
    diffStat: z.string(),
    isClean: z.boolean(),
});
// ---------------------------------------------------------------------------
// auto_dev_preflight
// ---------------------------------------------------------------------------
export const PreflightInputSchema = z.object({
    projectRoot: z.string(),
    topic: z.string(),
    phase: z.number().int(),
});
export const PreflightOutputSchema = z.object({
    ready: z.boolean(),
    checks: z.array(z.object({
        name: z.string(),
        passed: z.boolean(),
        message: z.string().optional(),
    })),
});
//# sourceMappingURL=types.js.map