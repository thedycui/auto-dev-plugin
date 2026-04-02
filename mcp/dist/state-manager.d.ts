/**
 * StateManager — auto-dev session state persistence layer.
 *
 * Responsibilities:
 *  - Detect output directory, read/write state.json with Zod validation
 *  - Atomic writes via write-to-temp-then-rename
 *  - Detect project tech stack from build files + stacks/*.md
 *  - Manage progress-log.md (append, checkpoint dedup)
 */
import type { StateJson, StackInfo } from "./types.js";
import type { NextDirective } from "./phase-enforcer.js";
export declare function extractDocSummary(content: string, maxLines: number): string;
export declare function extractTaskList(content: string): string;
/**
 * Returns the effort key for a given step.
 * Revision steps (1c, 2c, 5c) map to their parent review step.
 * All other steps map to themselves.
 */
export declare function effortKeyForStep(step: string): string;
/**
 * Returns a 16-character hex SHA-256 hash of the given content.
 * Returns "" for null input.
 */
export declare function hashContent(content: string | null): string;
export declare class StateManager {
    readonly projectRoot: string;
    readonly topic: string;
    readonly outputDir: string;
    readonly stateFilePath: string;
    readonly progressLogPath: string;
    /** In-memory copy of the latest persisted state. Available after init() or loadAndValidate(). */
    private state;
    /**
     * Async factory: resolve the correct outputDir for a topic.
     * - Scans `docs/auto-dev/` for an existing directory ending with `-{topic}` (or exact match for backward compat)
     * - If found → reuse (resume scenario)
     * - If not found → generate `YYYYMMDD-HHMM-{topic}` (new task)
     */
    static create(projectRoot: string, topic: string): Promise<StateManager>;
    /**
     * Scan `base` directory for a subdirectory matching the given topic.
     * Checks exact match (backward compat) then `*-{topic}` pattern.
     */
    private static findExistingTopicDir;
    constructor(projectRoot: string, topic: string, outputDirOverride?: string);
    /** Check whether the output directory already exists. */
    outputDirExists(): Promise<boolean>;
    /** Try to read and parse state.json. Returns null on any failure or validation error. */
    tryReadState(): Promise<StateJson | null>;
    /**
     * Read state.json, validate against Zod schema, and check the dirty flag.
     * Throws with a descriptive message when the file is missing, corrupt, or dirty.
     */
    loadAndValidate(): Promise<StateJson>;
    /**
     * Rebuild state.json from progress-log.md when state.json is corrupted or missing.
     */
    rebuildStateFromProgressLog(): Promise<StateJson>;
    /** Rename existing output dir to {dir}.bak.{timestamp}. Returns the backup path. */
    backupExistingDir(): Promise<string>;
    /** Scan project root for build files and resolve stack info from stacks/*.md. */
    detectStack(): Promise<StackInfo>;
    /** Create the output directory, write initial state.json (atomic) and progress-log header. */
    init(mode: "full" | "quick" | "turbo", stack: StackInfo, startPhase?: number): Promise<void>;
    /**
     * Write content to a temporary file, then rename to the target path.
     * POSIX rename is atomic on the same filesystem.
     */
    atomicWrite(filePath: string, content: string): Promise<void>;
    /**
     * Read current state.json, merge with `updates`, and write back atomically.
     * Also refreshes the in-memory state.
     */
    atomicUpdate(updates: Record<string, unknown>): Promise<void>;
    /** Return the in-memory state. Throws if init() or loadAndValidate() has not been called. */
    getFullState(): StateJson;
    /** Generate a CHECKPOINT HTML comment line. */
    getCheckpointLine(phase: number, task: number | undefined, status: string, summary?: string): string;
    /**
     * Check whether the last CHECKPOINT in progress-log.md has identical parameters.
     * Used for idempotency: if same → caller should skip the append.
     *
     * Optimization: for files larger than 4KB, only reads the last 4KB to find
     * the last CHECKPOINT. Falls back to full-file read if no CHECKPOINT found
     * in the tail (e.g. very long non-checkpoint content at the end).
     */
    isCheckpointDuplicate(phase: number, task: number | undefined, status: string, summary?: string): Promise<boolean>;
    /** Append content to progress-log.md (atomic via write-to-temp-then-rename). */
    appendToProgressLog(content: string): Promise<void>;
}
/**
 * Persist checkpoint state: write progress-log, update state.json atomically,
 * compute phase timings, and return the next directive.
 *
 * This function contains ONLY the commit/persistence logic. All pre-validation
 * checks (artifact validation, TDD, predecessor checks) remain in the caller.
 */
export declare function internalCheckpoint(sm: StateManager, state: StateJson, phase: number, status: string, summary?: string, task?: number, tokenEstimate?: number, opts?: {
    regressTo?: number;
}): Promise<{
    ok: boolean;
    nextDirective: NextDirective;
    stateUpdates: Record<string, unknown>;
    error?: string;
    message?: string;
}>;
