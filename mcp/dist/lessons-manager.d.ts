import type { LessonEntry } from "./types.js";
export declare function applyDecay(entry: LessonEntry, now?: Date): number;
export declare class LessonsManager {
    private readonly filePath;
    readonly outputDir: string;
    private readonly projectRoot;
    constructor(outputDir: string, projectRoot?: string);
    add(phase: number, category: string, lesson: string, context?: string, options?: {
        severity?: string;
        reusable?: boolean;
        topic?: string;
    }): Promise<void>;
    get(phase?: number, category?: string): Promise<LessonEntry[]>;
    feedback(feedbacks: Array<{
        id: string;
        verdict: "helpful" | "not_applicable" | "incorrect";
    }>, meta: {
        phase: number;
        topic: string;
    }): Promise<{
        localUpdated: string[];
        globalUpdated: string[];
    }>;
    getProjectLessons(limit?: number): Promise<LessonEntry[]>;
    promoteToProject(topic: string): Promise<number>;
    private projectFilePath;
    addToProject(entry: LessonEntry): Promise<{
        added: boolean;
        displaced?: LessonEntry;
    }>;
    private readEntries;
    readProjectEntries(): Promise<LessonEntry[]>;
    /** @deprecated Use getProjectLessons() */
    getGlobalLessons(limit?: number): Promise<LessonEntry[]>;
    /** @deprecated Use addToProject() */
    addToGlobal(entry: LessonEntry): Promise<{
        added: boolean;
        displaced?: LessonEntry;
    }>;
    /** @deprecated Use promoteToProject() */
    promoteReusableLessons(topic: string): Promise<number>;
    /** @deprecated Use readProjectEntries() */
    readGlobalEntries(): Promise<LessonEntry[]>;
    private crossProjectFilePath;
    getCrossProjectLessons(limit?: number): Promise<LessonEntry[]>;
    promoteToGlobal(minScore?: number): Promise<number>;
    injectGlobalLessons(): Promise<LessonEntry[]>;
    private addToCrossProject;
    private readCrossProjectEntries;
    private readEntriesFrom;
    /**
     * Generic "get lessons from pool" — shared logic for getProjectLessons and
     * getCrossProjectLessons. Performs lazy retirement, scoring, selection,
     * appliedCount update, and write-back.
     */
    private getLessonsFromPool;
    /**
     * Generic "add to pool" — shared logic for addToProject and addToCrossProject.
     * Performs dedup (exact match + prefix match on first 60 chars), pool-full
     * displacement, and write-back.
     */
    private addToPool;
    private writeAtomic;
}
