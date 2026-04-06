import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { join, dirname, basename } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import type { LessonEntry } from './types.js';
import {
  MAX_GLOBAL_INJECT,
  MAX_GLOBAL_POOL,
  MIN_DISPLACEMENT_MARGIN,
  DECAY_PERIOD_DAYS,
  SCORE_DELTA,
  MAX_FEEDBACK_HISTORY,
  MAX_CROSS_PROJECT_POOL,
  MAX_CROSS_PROJECT_INJECT,
  GLOBAL_PROMOTE_MIN_SCORE,
  initialScore,
  ensureDefaults,
} from './lessons-constants.js';

const GLOBAL_DIR = 'docs/auto-dev/_global';
const GLOBAL_FILE = 'lessons-global.json';

// ---------------------------------------------------------------------------
// Scoring: time-based decay
// ---------------------------------------------------------------------------

export function applyDecay(entry: LessonEntry, now: Date = new Date()): number {
  const refDateStr = entry.lastPositiveAt ?? entry.timestamp;
  const refDate = new Date(refDateStr);
  const daysSince = (now.getTime() - refDate.getTime()) / (1000 * 60 * 60 * 24);
  const decayPenalty = Math.floor(daysSince / DECAY_PERIOD_DAYS);
  return Math.max(
    0,
    (entry.score ?? initialScore(entry.severity)) - decayPenalty
  );
}

export class LessonsManager {
  private readonly filePath: string;
  readonly outputDir: string;
  private readonly projectRoot: string;

  constructor(outputDir: string, projectRoot?: string) {
    this.outputDir = outputDir;
    this.filePath = join(outputDir, 'lessons-learned.json');
    this.projectRoot = projectRoot ?? dirname(dirname(outputDir));
  }

  async add(
    phase: number,
    category: string,
    lesson: string,
    context?: string,
    options?: { severity?: string; reusable?: boolean; topic?: string }
  ): Promise<void> {
    const entries = await this.readEntries();
    const severity = (options?.severity as LessonEntry['severity']) ?? 'minor';
    const entry: LessonEntry = {
      id: randomUUID().slice(0, 12),
      phase,
      category: category as LessonEntry['category'],
      severity,
      lesson,
      ...(context !== undefined ? { context } : {}),
      topic: options?.topic,
      reusable: options?.reusable ?? false,
      appliedCount: 0,
      lastAppliedAt: undefined,
      timestamp: new Date().toISOString(),
      score: initialScore(severity),
    };
    entries.push(entry);
    await this.writeAtomic(entries, this.filePath);

    if (entry.reusable) {
      await this.addToProject(entry); // result intentionally ignored for add() caller
    }
  }

  async get(phase?: number, category?: string): Promise<LessonEntry[]> {
    const entries = await this.readEntries();
    return entries.filter(e => {
      if (phase !== undefined && e.phase !== phase) return false;
      if (category !== undefined && e.category !== category) return false;
      return true;
    });
  }

  async feedback(
    feedbacks: Array<{
      id: string;
      verdict: 'helpful' | 'not_applicable' | 'incorrect';
    }>,
    meta: { phase: number; topic: string }
  ): Promise<{ localUpdated: string[]; globalUpdated: string[] }> {
    const localEntries = await this.readEntries();
    const globalEntries = await this.readProjectEntries();

    const localMap = new Map(localEntries.map(e => [e.id, e]));
    const globalMap = new Map(globalEntries.map(e => [e.id, e]));

    const nowStr = new Date().toISOString();
    const localUpdated: string[] = [];
    const globalUpdated: string[] = [];

    for (const fb of feedbacks) {
      const delta = SCORE_DELTA[fb.verdict];
      const historyItem = {
        verdict: fb.verdict,
        phase: meta.phase,
        topic: meta.topic,
        timestamp: nowStr,
      };

      const localEntry = localMap.get(fb.id);
      if (localEntry) {
        localEntry.score = Math.max(
          0,
          (localEntry.score ?? initialScore(localEntry.severity)) + delta
        );
        localEntry.feedbackHistory = [
          ...(localEntry.feedbackHistory ?? []),
          historyItem,
        ].slice(-MAX_FEEDBACK_HISTORY);
        if (fb.verdict === 'helpful') {
          localEntry.lastPositiveAt = nowStr;
        }
        localUpdated.push(fb.id);
      }

      const globalEntry = globalMap.get(fb.id);
      if (globalEntry) {
        globalEntry.score = Math.max(
          0,
          (globalEntry.score ?? initialScore(globalEntry.severity)) + delta
        );
        globalEntry.feedbackHistory = [
          ...(globalEntry.feedbackHistory ?? []),
          historyItem,
        ].slice(-MAX_FEEDBACK_HISTORY);
        if (fb.verdict === 'helpful') {
          globalEntry.lastPositiveAt = nowStr;
        }
        globalUpdated.push(fb.id);
      }
    }

    // Write local and global independently with error isolation
    if (localUpdated.length > 0) {
      await this.writeAtomic(localEntries, this.filePath).catch(e => {
        console.error(
          `[lessons] writeAtomic local failed: ${(e as Error).message}`
        );
      });
    }
    if (globalUpdated.length > 0) {
      await this.writeAtomic(globalEntries, this.projectFilePath()).catch(e => {
        console.error(
          `[lessons] writeAtomic project failed: ${(e as Error).message}`
        );
      });
    }

    return { localUpdated, globalUpdated };
  }

  async getProjectLessons(
    limit: number = MAX_GLOBAL_INJECT
  ): Promise<LessonEntry[]> {
    return this.getLessonsFromPool(this.projectFilePath(), limit);
  }

  async promoteToProject(topic: string): Promise<number> {
    const entries = await this.readEntries();
    let promoted = 0;
    for (const e of entries) {
      if (e.reusable && !e.retired) {
        const result = await this.addToProject(ensureDefaults({ ...e, topic }));
        if (result.added) promoted++;
      }
    }
    return promoted;
  }

  private projectFilePath(): string {
    return join(this.projectRoot, GLOBAL_DIR, GLOBAL_FILE);
  }

  async addToProject(
    entry: LessonEntry
  ): Promise<{ added: boolean; displaced?: LessonEntry }> {
    return this.addToPool(this.projectFilePath(), entry, MAX_GLOBAL_POOL);
  }

  private async readEntries(): Promise<LessonEntry[]> {
    try {
      const raw = await readFile(this.filePath, 'utf-8');
      return JSON.parse(raw) as LessonEntry[];
    } catch {
      return [];
    }
  }

  async readProjectEntries(): Promise<LessonEntry[]> {
    return this.readEntriesFrom(this.projectFilePath());
  }

  // -------------------------------------------------------------------------
  // Backward-compatible aliases (self-evolution rename)
  // -------------------------------------------------------------------------

  /** @deprecated Use getProjectLessons() */
  async getGlobalLessons(limit?: number): Promise<LessonEntry[]> {
    return this.getProjectLessons(limit);
  }
  /** @deprecated Use addToProject() */
  async addToGlobal(
    entry: LessonEntry
  ): Promise<{ added: boolean; displaced?: LessonEntry }> {
    return this.addToProject(entry);
  }
  /** @deprecated Use promoteToProject() */
  async promoteReusableLessons(topic: string): Promise<number> {
    return this.promoteToProject(topic);
  }
  /** @deprecated Use readProjectEntries() */
  async readGlobalEntries(): Promise<LessonEntry[]> {
    return this.readProjectEntries();
  }

  // -------------------------------------------------------------------------
  // Cross-project Global layer (self-evolution)
  // -------------------------------------------------------------------------

  private crossProjectFilePath(): string {
    return join(homedir(), '.auto-dev', 'lessons-global.json');
  }

  async getCrossProjectLessons(
    limit: number = MAX_CROSS_PROJECT_INJECT
  ): Promise<LessonEntry[]> {
    return this.getLessonsFromPool(this.crossProjectFilePath(), limit);
  }

  async promoteToGlobal(
    minScore: number = GLOBAL_PROMOTE_MIN_SCORE
  ): Promise<number> {
    const projectEntries = await this.readProjectEntries();
    const now = new Date();
    const nowStr = now.toISOString();
    const projectName = basename(this.projectRoot);
    let promoted = 0;

    for (const e of projectEntries) {
      if (!e.reusable || e.retired) continue;
      if (applyDecay(e, now) < minScore) continue;

      const globalEntry: LessonEntry = {
        ...ensureDefaults(e),
        sourceProject: projectName,
        promotedAt: nowStr,
        promotionPath: 'project_to_global',
      };

      const result = await this.addToCrossProject(globalEntry);
      if (result.added) promoted++;
    }

    return promoted;
  }

  async injectGlobalLessons(): Promise<LessonEntry[]> {
    return this.getCrossProjectLessons();
  }

  private async addToCrossProject(
    entry: LessonEntry
  ): Promise<{ added: boolean; displaced?: LessonEntry }> {
    return this.addToPool(
      this.crossProjectFilePath(),
      entry,
      MAX_CROSS_PROJECT_POOL
    );
  }

  private async readCrossProjectEntries(): Promise<LessonEntry[]> {
    return this.readEntriesFrom(this.crossProjectFilePath());
  }

  // -------------------------------------------------------------------------
  // Generic pool operations (DRY: shared by project + cross-project layers)
  // -------------------------------------------------------------------------

  private async readEntriesFrom(filePath: string): Promise<LessonEntry[]> {
    try {
      const raw = await readFile(filePath, 'utf-8');
      return JSON.parse(raw) as LessonEntry[];
    } catch {
      return [];
    }
  }

  /**
   * Generic "get lessons from pool" — shared logic for getProjectLessons and
   * getCrossProjectLessons. Performs lazy retirement, scoring, selection,
   * appliedCount update, and write-back.
   */
  private async getLessonsFromPool(
    filePath: string,
    limit: number
  ): Promise<LessonEntry[]> {
    const allEntries = await this.readEntriesFrom(filePath);
    if (allEntries.length === 0) return [];

    const now = new Date();
    const nowStr = now.toISOString();

    // Lazy retirement pass: retire non-retired entries whose decayed score <= 0
    for (const e of allEntries) {
      if (!e.retired && applyDecay(e, now) <= 0) {
        e.retired = true;
        e.retiredAt = nowStr;
        e.retiredReason = 'score_decayed';
      }
    }

    // Filter out retired, compute effective score, sort by score desc
    const active = allEntries
      .filter(e => !e.retired)
      .map(e => ({ ...e, score: applyDecay(e, now) }))
      .sort((a, b) => b.score - a.score);

    const selected = active.slice(0, limit);
    const selectedIds = new Set(selected.map(e => e.id));

    // Update appliedCount and lastAppliedAt on the full array for persistence
    for (const e of allEntries) {
      if (selectedIds.has(e.id)) {
        e.appliedCount = (e.appliedCount ?? 0) + 1;
        e.lastAppliedAt = nowStr;
      }
    }

    await this.writeAtomic(allEntries, filePath);
    return selected;
  }

  /**
   * Generic "add to pool" — shared logic for addToProject and addToCrossProject.
   * Performs dedup (exact match + prefix match on first 60 chars), pool-full
   * displacement, and write-back.
   */
  private async addToPool(
    filePath: string,
    entry: LessonEntry,
    poolMax: number
  ): Promise<{ added: boolean; displaced?: LessonEntry }> {
    const entries = await this.readEntriesFrom(filePath);
    const DEDUP_PREFIX_LEN = 60;

    // Dedup: exact match OR prefix match (first 60 chars of shorter text)
    const isDuplicate = entries.some(e => {
      if (e.retired) return false;
      if (e.lesson === entry.lesson) return true;
      const shorter =
        e.lesson.length <= entry.lesson.length ? e.lesson : entry.lesson;
      const longer =
        e.lesson.length <= entry.lesson.length ? entry.lesson : e.lesson;
      if (shorter.length >= DEDUP_PREFIX_LEN) {
        const prefix = shorter.slice(0, DEDUP_PREFIX_LEN);
        return longer.startsWith(prefix);
      }
      return false;
    });

    if (isDuplicate) {
      return { added: false };
    }

    const now = new Date();
    const active = entries.filter(e => !e.retired);

    if (active.length < poolMax) {
      entries.push(entry);
      await this.writeAtomic(entries, filePath);
      return { added: true };
    }

    // Pool full — find lowest effective-score active entry
    let lowestIdx = -1;
    let lowestScore = Infinity;
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i]!;
      if (e.retired) continue;
      const es = applyDecay(e, now);
      if (es < lowestScore) {
        lowestScore = es;
        lowestIdx = i;
      }
    }

    const newScore = applyDecay(entry, now);

    // New entry must exceed lowest + margin to displace
    if (newScore <= lowestScore + MIN_DISPLACEMENT_MARGIN) {
      return { added: false };
    }

    // Displace the lowest entry
    const displaced = entries[lowestIdx]!;
    entries[lowestIdx] = {
      ...displaced,
      retired: true,
      retiredAt: now.toISOString(),
      retiredReason: 'displaced_by_new',
    };
    entries.push(entry);
    await this.writeAtomic(entries, filePath);
    return { added: true, displaced };
  }

  private async writeAtomic(
    entries: LessonEntry[],
    targetPath: string
  ): Promise<void> {
    const dir = dirname(targetPath);
    await mkdir(dir, { recursive: true });
    const tmpPath = join(dir, `.lessons.${randomUUID().slice(0, 8)}.tmp`);
    await writeFile(tmpPath, JSON.stringify(entries, null, 2) + '\n', 'utf-8');
    await rename(tmpPath, targetPath);
  }
}
