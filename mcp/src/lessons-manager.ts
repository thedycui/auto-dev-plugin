import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import type { LessonEntry } from "./types.js";

export class LessonsManager {
  private readonly filePath: string;

  constructor(outputDir: string) {
    this.filePath = join(outputDir, "lessons-learned.json");
  }

  async add(
    phase: number,
    category: string,
    lesson: string,
    context?: string,
  ): Promise<void> {
    const entries = await this.readEntries();
    const entry: LessonEntry = {
      phase,
      category,
      lesson,
      ...(context !== undefined ? { context } : {}),
      timestamp: new Date().toISOString(),
    };
    entries.push(entry);
    await this.writeAtomic(entries);
  }

  async get(phase?: number, category?: string): Promise<LessonEntry[]> {
    const entries = await this.readEntries();
    return entries.filter((e) => {
      if (phase !== undefined && e.phase !== phase) return false;
      if (category !== undefined && e.category !== category) return false;
      return true;
    });
  }

  private async readEntries(): Promise<LessonEntry[]> {
    try {
      const raw = await readFile(this.filePath, "utf-8");
      return JSON.parse(raw) as LessonEntry[];
    } catch {
      return [];
    }
  }

  private async writeAtomic(entries: LessonEntry[]): Promise<void> {
    const dir = dirname(this.filePath);
    await mkdir(dir, { recursive: true });
    const tmpPath = join(dir, `.lessons-learned.${randomUUID()}.tmp`);
    await writeFile(tmpPath, JSON.stringify(entries, null, 2) + "\n", "utf-8");
    await rename(tmpPath, this.filePath);
  }
}
