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
    getGlobalLessons(limit?: number): Promise<LessonEntry[]>;
    promoteReusableLessons(topic: string): Promise<number>;
    private globalFilePath;
    addToGlobal(entry: LessonEntry): Promise<{
        added: boolean;
        displaced?: LessonEntry;
    }>;
    private readEntries;
    readGlobalEntries(): Promise<LessonEntry[]>;
    private writeAtomic;
}
