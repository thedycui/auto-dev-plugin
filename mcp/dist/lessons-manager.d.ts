import type { LessonEntry } from "./types.js";
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
    getGlobalLessons(limit?: number): Promise<LessonEntry[]>;
    promoteReusableLessons(topic: string): Promise<number>;
    private globalFilePath;
    private addToGlobal;
    private readEntries;
    private writeAtomic;
}
