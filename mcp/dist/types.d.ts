/**
 * auto-dev MCP Server — Type Definitions
 *
 * All runtime schemas are defined with Zod v4.
 * TypeScript interfaces are inferred from schemas via `z.infer<>`.
 */
import { z } from "zod/v4";
export declare const ModeSchema: z.ZodEnum<{
    full: "full";
    quick: "quick";
}>;
export declare const PhaseStatusSchema: z.ZodEnum<{
    IN_PROGRESS: "IN_PROGRESS";
    PASS: "PASS";
    NEEDS_REVISION: "NEEDS_REVISION";
    BLOCKED: "BLOCKED";
    COMPLETED: "COMPLETED";
    REGRESS: "REGRESS";
}>;
export declare const OnConflictSchema: z.ZodEnum<{
    resume: "resume";
    overwrite: "overwrite";
}>;
export declare const StackInfoSchema: z.ZodObject<{
    language: z.ZodString;
    buildCmd: z.ZodString;
    testCmd: z.ZodString;
    langChecklist: z.ZodString;
}, z.core.$strip>;
export type StackInfo = z.infer<typeof StackInfoSchema>;
export declare const GitInfoSchema: z.ZodObject<{
    currentBranch: z.ZodString;
    isDirty: z.ZodBoolean;
    diffStat: z.ZodString;
}, z.core.$strip>;
export type GitInfo = z.infer<typeof GitInfoSchema>;
export declare const LessonEntrySchema: z.ZodObject<{
    id: z.ZodOptional<z.ZodString>;
    phase: z.ZodNumber;
    category: z.ZodEnum<{
        pitfall: "pitfall";
        highlight: "highlight";
        process: "process";
        technical: "technical";
        pattern: "pattern";
        "iteration-limit": "iteration-limit";
    }>;
    severity: z.ZodOptional<z.ZodEnum<{
        critical: "critical";
        important: "important";
        minor: "minor";
    }>>;
    lesson: z.ZodString;
    context: z.ZodOptional<z.ZodString>;
    topic: z.ZodOptional<z.ZodString>;
    reusable: z.ZodOptional<z.ZodBoolean>;
    appliedCount: z.ZodOptional<z.ZodNumber>;
    lastAppliedAt: z.ZodOptional<z.ZodString>;
    timestamp: z.ZodString;
    score: z.ZodOptional<z.ZodNumber>;
    lastPositiveAt: z.ZodOptional<z.ZodString>;
    feedbackHistory: z.ZodOptional<z.ZodArray<z.ZodObject<{
        verdict: z.ZodEnum<{
            helpful: "helpful";
            not_applicable: "not_applicable";
            incorrect: "incorrect";
        }>;
        phase: z.ZodNumber;
        topic: z.ZodString;
        timestamp: z.ZodString;
    }, z.core.$strip>>>;
    retired: z.ZodOptional<z.ZodBoolean>;
    retiredAt: z.ZodOptional<z.ZodString>;
    retiredReason: z.ZodOptional<z.ZodEnum<{
        displaced_by_new: "displaced_by_new";
        score_decayed: "score_decayed";
        manually_removed: "manually_removed";
    }>>;
}, z.core.$strip>;
export type LessonEntry = z.infer<typeof LessonEntrySchema>;
export declare const StateJsonSchema: z.ZodObject<{
    topic: z.ZodString;
    mode: z.ZodEnum<{
        full: "full";
        quick: "quick";
    }>;
    phase: z.ZodNumber;
    task: z.ZodOptional<z.ZodNumber>;
    iteration: z.ZodOptional<z.ZodNumber>;
    status: z.ZodEnum<{
        IN_PROGRESS: "IN_PROGRESS";
        PASS: "PASS";
        NEEDS_REVISION: "NEEDS_REVISION";
        BLOCKED: "BLOCKED";
        COMPLETED: "COMPLETED";
        REGRESS: "REGRESS";
    }>;
    stack: z.ZodObject<{
        language: z.ZodString;
        buildCmd: z.ZodString;
        testCmd: z.ZodString;
        langChecklist: z.ZodString;
    }, z.core.$strip>;
    outputDir: z.ZodString;
    projectRoot: z.ZodString;
    dirty: z.ZodOptional<z.ZodBoolean>;
    interactive: z.ZodOptional<z.ZodBoolean>;
    dryRun: z.ZodOptional<z.ZodBoolean>;
    skipE2e: z.ZodOptional<z.ZodBoolean>;
    tdd: z.ZodOptional<z.ZodBoolean>;
    tddWarnings: z.ZodOptional<z.ZodArray<z.ZodString>>;
    brainstorm: z.ZodOptional<z.ZodBoolean>;
    startCommit: z.ZodOptional<z.ZodString>;
    regressionCount: z.ZodOptional<z.ZodNumber>;
    phaseTimings: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodObject<{
        startedAt: z.ZodString;
        completedAt: z.ZodOptional<z.ZodString>;
        durationMs: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strip>>>;
    tokenUsage: z.ZodOptional<z.ZodObject<{
        total: z.ZodNumber;
        byPhase: z.ZodRecord<z.ZodString, z.ZodNumber>;
    }, z.core.$strip>>;
    injectedLessonIds: z.ZodOptional<z.ZodArray<z.ZodString>>;
    startedAt: z.ZodString;
    updatedAt: z.ZodString;
}, z.core.$strip>;
export type StateJson = z.infer<typeof StateJsonSchema>;
export declare const InitInputSchema: z.ZodObject<{
    projectRoot: z.ZodString;
    topic: z.ZodString;
    mode: z.ZodEnum<{
        full: "full";
        quick: "quick";
    }>;
    startPhase: z.ZodOptional<z.ZodNumber>;
    interactive: z.ZodOptional<z.ZodBoolean>;
    dryRun: z.ZodOptional<z.ZodBoolean>;
    skipE2e: z.ZodOptional<z.ZodBoolean>;
    tdd: z.ZodOptional<z.ZodBoolean>;
    tddWarnings: z.ZodOptional<z.ZodArray<z.ZodString>>;
    brainstorm: z.ZodOptional<z.ZodBoolean>;
    onConflict: z.ZodOptional<z.ZodEnum<{
        resume: "resume";
        overwrite: "overwrite";
    }>>;
}, z.core.$strip>;
export type InitInput = z.infer<typeof InitInputSchema>;
export declare const InitOutputSchema: z.ZodObject<{
    outputDir: z.ZodString;
    stateFile: z.ZodString;
    resumed: z.ZodBoolean;
    stack: z.ZodObject<{
        language: z.ZodString;
        buildCmd: z.ZodString;
        testCmd: z.ZodString;
        langChecklist: z.ZodString;
    }, z.core.$strip>;
    git: z.ZodObject<{
        currentBranch: z.ZodString;
        isDirty: z.ZodBoolean;
        diffStat: z.ZodString;
    }, z.core.$strip>;
    variables: z.ZodRecord<z.ZodString, z.ZodString>;
}, z.core.$strip>;
export type InitOutput = z.infer<typeof InitOutputSchema>;
export declare const RenderInputSchema: z.ZodObject<{
    promptFile: z.ZodString;
    variables: z.ZodRecord<z.ZodString, z.ZodString>;
    extraContext: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type RenderInput = z.infer<typeof RenderInputSchema>;
export declare const RenderOutputSchema: z.ZodObject<{
    renderedPrompt: z.ZodString;
    warnings: z.ZodArray<z.ZodString>;
}, z.core.$strip>;
export type RenderOutput = z.infer<typeof RenderOutputSchema>;
export declare const CheckpointInputSchema: z.ZodObject<{
    phase: z.ZodNumber;
    task: z.ZodOptional<z.ZodNumber>;
    status: z.ZodEnum<{
        IN_PROGRESS: "IN_PROGRESS";
        PASS: "PASS";
        NEEDS_REVISION: "NEEDS_REVISION";
        BLOCKED: "BLOCKED";
        COMPLETED: "COMPLETED";
        REGRESS: "REGRESS";
    }>;
    summary: z.ZodOptional<z.ZodString>;
    tokenEstimate: z.ZodOptional<z.ZodNumber>;
    regressTo: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
export type CheckpointInput = z.infer<typeof CheckpointInputSchema>;
export declare const DiffCheckInputSchema: z.ZodObject<{
    expectedFiles: z.ZodArray<z.ZodString>;
    baseCommit: z.ZodString;
}, z.core.$strip>;
export type DiffCheckInput = z.infer<typeof DiffCheckInputSchema>;
export declare const DiffCheckOutputSchema: z.ZodObject<{
    actualFiles: z.ZodArray<z.ZodString>;
    expectedButMissing: z.ZodArray<z.ZodString>;
    unexpectedChanges: z.ZodArray<z.ZodString>;
    diffStat: z.ZodString;
    isClean: z.ZodBoolean;
}, z.core.$strip>;
export type DiffCheckOutput = z.infer<typeof DiffCheckOutputSchema>;
export declare const PreflightInputSchema: z.ZodObject<{
    projectRoot: z.ZodString;
    topic: z.ZodString;
    phase: z.ZodNumber;
}, z.core.$strip>;
export type PreflightInput = z.infer<typeof PreflightInputSchema>;
export declare const PreflightOutputSchema: z.ZodObject<{
    ready: z.ZodBoolean;
    checks: z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        passed: z.ZodBoolean;
        message: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type PreflightOutput = z.infer<typeof PreflightOutputSchema>;
