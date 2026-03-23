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
export declare function extractDocSummary(content: string, maxLines: number): string;
export declare function extractTaskList(content: string): string;
export declare class StateManager {
    readonly projectRoot: string;
    readonly topic: string;
    readonly outputDir: string;
    readonly stateFilePath: string;
    readonly progressLogPath: string;
    /** In-memory copy of the latest persisted state. Available after init() or loadAndValidate(). */
    private state;
    constructor(projectRoot: string, topic: string);
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
    init(mode: "full" | "quick", stack: StackInfo, startPhase?: number): Promise<void>;
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
     */
    isCheckpointDuplicate(phase: number, task: number | undefined, status: string, summary?: string): Promise<boolean>;
    /** Append content to progress-log.md (atomic via write-to-temp-then-rename). */
    appendToProgressLog(content: string): Promise<void>;
}
