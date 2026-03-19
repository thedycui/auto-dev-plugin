import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { randomUUID } from "node:crypto";
export class LessonsManager {
    filePath;
    constructor(outputDir) {
        this.filePath = join(outputDir, "lessons-learned.json");
    }
    async add(phase, category, lesson, context) {
        const entries = await this.readEntries();
        const entry = {
            phase,
            category,
            lesson,
            ...(context !== undefined ? { context } : {}),
            timestamp: new Date().toISOString(),
        };
        entries.push(entry);
        await this.writeAtomic(entries);
    }
    async get(phase, category) {
        const entries = await this.readEntries();
        return entries.filter((e) => {
            if (phase !== undefined && e.phase !== phase)
                return false;
            if (category !== undefined && e.category !== category)
                return false;
            return true;
        });
    }
    async readEntries() {
        try {
            const raw = await readFile(this.filePath, "utf-8");
            return JSON.parse(raw);
        }
        catch {
            return [];
        }
    }
    async writeAtomic(entries) {
        const dir = dirname(this.filePath);
        await mkdir(dir, { recursive: true });
        const tmpPath = join(dir, `.lessons-learned.${randomUUID()}.tmp`);
        await writeFile(tmpPath, JSON.stringify(entries, null, 2) + "\n", "utf-8");
        await rename(tmpPath, this.filePath);
    }
}
//# sourceMappingURL=lessons-manager.js.map