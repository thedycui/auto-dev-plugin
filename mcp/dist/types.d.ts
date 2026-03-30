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
    turbo: "turbo";
}>;
export declare const ChangeTypeSchema: z.ZodEnum<{
    refactor: "refactor";
    bugfix: "bugfix";
    feature: "feature";
    config: "config";
    docs: "docs";
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
        tribunal: "tribunal";
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
    sourceProject: z.ZodOptional<z.ZodString>;
    promotedAt: z.ZodOptional<z.ZodString>;
    promotionPath: z.ZodOptional<z.ZodEnum<{
        local_to_project: "local_to_project";
        project_to_global: "project_to_global";
    }>>;
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
        turbo: "turbo";
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
    skipSteps: z.ZodOptional<z.ZodArray<z.ZodString>>;
    tdd: z.ZodOptional<z.ZodBoolean>;
    tddTaskStates: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodObject<{
        status: z.ZodEnum<{
            PENDING: "PENDING";
            RED_CONFIRMED: "RED_CONFIRMED";
            GREEN_CONFIRMED: "GREEN_CONFIRMED";
        }>;
        redTestFiles: z.ZodOptional<z.ZodArray<z.ZodString>>;
        redExitCode: z.ZodOptional<z.ZodNumber>;
        redFailType: z.ZodOptional<z.ZodEnum<{
            compilation_error: "compilation_error";
            test_failure: "test_failure";
        }>>;
    }, z.core.$strip>>>;
    brainstorm: z.ZodOptional<z.ZodBoolean>;
    costMode: z.ZodOptional<z.ZodEnum<{
        economy: "economy";
        beast: "beast";
    }>>;
    designDocSource: z.ZodOptional<z.ZodString>;
    designDocBound: z.ZodOptional<z.ZodBoolean>;
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
    injectedGlobalLessonIds: z.ZodOptional<z.ZodArray<z.ZodString>>;
    tribunalSubmits: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodNumber>>;
    step: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    stepIteration: z.ZodOptional<z.ZodNumber>;
    lastValidation: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    approachState: z.ZodOptional<z.ZodNullable<z.ZodAny>>;
    phaseEscalateCount: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodNumber>>;
    ship: z.ZodOptional<z.ZodBoolean>;
    deployTarget: z.ZodOptional<z.ZodString>;
    deployBranch: z.ZodOptional<z.ZodString>;
    deployEnv: z.ZodOptional<z.ZodString>;
    verifyMethod: z.ZodOptional<z.ZodEnum<{
        api: "api";
        log: "log";
        test: "test";
        combined: "combined";
    }>>;
    verifyConfig: z.ZodOptional<z.ZodObject<{
        endpoint: z.ZodOptional<z.ZodString>;
        expectedPattern: z.ZodOptional<z.ZodString>;
        logPath: z.ZodOptional<z.ZodString>;
        logKeyword: z.ZodOptional<z.ZodString>;
        sshHost: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
    shipRound: z.ZodOptional<z.ZodNumber>;
    shipMaxRounds: z.ZodOptional<z.ZodNumber>;
    startedAt: z.ZodString;
    updatedAt: z.ZodString;
}, z.core.$strip>;
export type StateJson = z.infer<typeof StateJsonSchema>;
/** TDD task state for a single task */
export interface TddTaskState {
    status: "PENDING" | "RED_CONFIRMED" | "GREEN_CONFIRMED";
    redTestFiles?: string[];
    redExitCode?: number;
    redFailType?: "compilation_error" | "test_failure";
}
export declare const InitInputSchema: z.ZodObject<{
    projectRoot: z.ZodString;
    topic: z.ZodString;
    mode: z.ZodEnum<{
        full: "full";
        quick: "quick";
        turbo: "turbo";
    }>;
    startPhase: z.ZodOptional<z.ZodNumber>;
    interactive: z.ZodOptional<z.ZodBoolean>;
    dryRun: z.ZodOptional<z.ZodBoolean>;
    skipE2e: z.ZodOptional<z.ZodBoolean>;
    tdd: z.ZodOptional<z.ZodBoolean>;
    brainstorm: z.ZodOptional<z.ZodBoolean>;
    onConflict: z.ZodOptional<z.ZodEnum<{
        resume: "resume";
        overwrite: "overwrite";
    }>>;
    ship: z.ZodOptional<z.ZodBoolean>;
    deployTarget: z.ZodOptional<z.ZodString>;
    deployBranch: z.ZodOptional<z.ZodString>;
    deployEnv: z.ZodOptional<z.ZodString>;
    verifyMethod: z.ZodOptional<z.ZodEnum<{
        api: "api";
        log: "log";
        test: "test";
        combined: "combined";
    }>>;
    verifyConfig: z.ZodOptional<z.ZodObject<{
        endpoint: z.ZodOptional<z.ZodString>;
        expectedPattern: z.ZodOptional<z.ZodString>;
        logPath: z.ZodOptional<z.ZodString>;
        logKeyword: z.ZodOptional<z.ZodString>;
        sshHost: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
    shipMaxRounds: z.ZodOptional<z.ZodNumber>;
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
/** Auto-generated retrospective data (framework-generated, tamper-proof) */
export interface RetrospectiveAutoData {
    rejectionCount: number;
    phaseTimings: Record<number, {
        startedAt: string;
        completedAt?: string;
        durationMs?: number;
    }>;
    tribunalResults: Array<{
        phase: number;
        verdict: string;
        issueCount: number;
    }>;
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
