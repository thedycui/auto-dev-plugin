import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { randomUUID } from "node:crypto";
const GLOBAL_DIR = "docs/auto-dev/_global";
const GLOBAL_FILE = "lessons-global.json";
const MAX_GLOBAL_INJECT = 10;
const STALE_DAYS = 30;
export class LessonsManager {
    filePath;
    outputDir;
    projectRoot;
    constructor(outputDir, projectRoot) {
        this.outputDir = outputDir;
        this.filePath = join(outputDir, "lessons-learned.json");
        this.projectRoot = projectRoot ?? dirname(dirname(outputDir));
    }
    async add(phase, category, lesson, context, options) {
        const entries = await this.readEntries();
        const entry = {
            id: randomUUID().slice(0, 12),
            phase,
            category: category,
            severity: options?.severity ?? "minor",
            lesson,
            ...(context !== undefined ? { context } : {}),
            topic: options?.topic,
            reusable: options?.reusable ?? false,
            appliedCount: 0,
            lastAppliedAt: undefined,
            timestamp: new Date().toISOString(),
        };
        entries.push(entry);
        await this.writeAtomic(entries, this.filePath);
        if (entry.reusable) {
            await this.addToGlobal(entry);
        }
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
    async getGlobalLessons(limit = MAX_GLOBAL_INJECT) {
        const globalPath = this.globalFilePath();
        let entries;
        try {
            const raw = await readFile(globalPath, "utf-8");
            entries = JSON.parse(raw);
        }
        catch {
            return [];
        }
        const now = Date.now();
        const cutoff = STALE_DAYS * 24 * 60 * 60 * 1000;
        entries = entries.filter((e) => {
            const age = now - new Date(e.timestamp).getTime();
            return !(age > cutoff && (!e.appliedCount || e.appliedCount === 0));
        });
        const severityOrder = { critical: 0, important: 1, minor: 2 };
        entries.sort((a, b) => {
            const sa = severityOrder[a.severity ?? "minor"] ?? 2;
            const sb = severityOrder[b.severity ?? "minor"] ?? 2;
            if (sa !== sb)
                return sa - sb;
            return (b.appliedCount ?? 0) - (a.appliedCount ?? 0);
        });
        const selected = entries.slice(0, limit);
        const selectedIds = new Set(selected.map((e) => e.id));
        const nowStr = new Date().toISOString();
        for (const e of entries) {
            if (selectedIds.has(e.id)) {
                e.appliedCount = (e.appliedCount ?? 0) + 1;
                e.lastAppliedAt = nowStr;
            }
        }
        await this.writeAtomic(entries, globalPath);
        return selected;
    }
    async promoteReusableLessons(topic) {
        const entries = await this.readEntries();
        const reusable = entries.filter((e) => e.reusable);
        if (reusable.length === 0)
            return 0;
        const globalPath = this.globalFilePath();
        let globalEntries;
        try {
            const raw = await readFile(globalPath, "utf-8");
            globalEntries = JSON.parse(raw);
        }
        catch {
            globalEntries = [];
        }
        const existing = new Set(globalEntries.map((e) => e.lesson));
        let added = 0;
        for (const entry of reusable) {
            if (!existing.has(entry.lesson)) {
                globalEntries.push({ ...entry, topic });
                existing.add(entry.lesson);
                added++;
            }
        }
        if (added > 0)
            await this.writeAtomic(globalEntries, globalPath);
        return added;
    }
    globalFilePath() {
        return join(this.projectRoot, GLOBAL_DIR, GLOBAL_FILE);
    }
    async addToGlobal(entry) {
        const globalPath = this.globalFilePath();
        let entries;
        try {
            const raw = await readFile(globalPath, "utf-8");
            entries = JSON.parse(raw);
        }
        catch {
            entries = [];
        }
        if (entries.some((e) => e.lesson === entry.lesson))
            return;
        entries.push(entry);
        await this.writeAtomic(entries, globalPath);
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
    async writeAtomic(entries, targetPath) {
        const dir = dirname(targetPath);
        await mkdir(dir, { recursive: true });
        const tmpPath = join(dir, `.lessons.${randomUUID().slice(0, 8)}.tmp`);
        await writeFile(tmpPath, JSON.stringify(entries, null, 2) + "\n", "utf-8");
        await rename(tmpPath, targetPath);
    }
}
//# sourceMappingURL=lessons-manager.js.map