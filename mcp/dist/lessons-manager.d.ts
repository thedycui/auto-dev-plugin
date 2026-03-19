import type { LessonEntry } from "./types.js";
export declare class LessonsManager {
    private readonly filePath;
    constructor(outputDir: string);
    add(phase: number, category: string, lesson: string, context?: string): Promise<void>;
    get(phase?: number, category?: string): Promise<LessonEntry[]>;
    private readEntries;
    private writeAtomic;
}
