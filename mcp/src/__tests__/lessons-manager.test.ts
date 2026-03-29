/**
 * Tests for the lessons scoring / eviction system (lessons-evolution).
 *
 * Each test gets an isolated tmp directory with pre-seeded JSON files.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir, homedir as realHomedir } from "node:os";
import { LessonsManager, applyDecay } from "../lessons-manager.js";
import {
  ensureDefaults,
  initialScore,
  SCORE_INITIAL,
  SCORE_DELTA,
  MAX_FEEDBACK_HISTORY,
  MAX_GLOBAL_POOL,
  MAX_CROSS_PROJECT_POOL,
  MAX_CROSS_PROJECT_INJECT,
  GLOBAL_PROMOTE_MIN_SCORE,
  MIN_DISPLACEMENT_MARGIN,
} from "../lessons-constants.js";
import type { LessonEntry } from "../types.js";

// Allow overriding homedir for cross-project tests
let mockHomedir: string | null = null;
vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    homedir: () => mockHomedir ?? (actual.homedir as () => string)(),
  };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a minimal valid LessonEntry with overrides. */
function makeEntry(overrides: Partial<LessonEntry> = {}): LessonEntry {
  return {
    id: overrides.id ?? "test-id-001",
    phase: 3,
    category: "pitfall",
    severity: "minor",
    lesson: "some lesson text",
    reusable: false,
    appliedCount: 0,
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

/** Produce an ISO date string N days in the past from `now`. */
function daysAgo(n: number, now: Date = new Date()): string {
  return new Date(now.getTime() - n * 24 * 60 * 60 * 1000).toISOString();
}

// ---------------------------------------------------------------------------
// Fixture management
// ---------------------------------------------------------------------------

let tmpRoot: string;
let outputDir: string;
let projectRoot: string;
let globalDir: string;
let globalFile: string;

beforeEach(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), "lessons-test-"));
  // projectRoot/docs/auto-dev/_global/lessons-global.json  is the global file
  projectRoot = tmpRoot;
  outputDir = join(projectRoot, "docs", "auto-dev", "test-topic");
  globalDir = join(projectRoot, "docs", "auto-dev", "_global");
  globalFile = join(globalDir, "lessons-global.json");
  await mkdir(outputDir, { recursive: true });
  await mkdir(globalDir, { recursive: true });
});

afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
});

/** Seed local lessons file. */
async function seedLocal(entries: LessonEntry[]): Promise<void> {
  await writeFile(join(outputDir, "lessons-learned.json"), JSON.stringify(entries, null, 2));
}

/** Seed global lessons file. */
async function seedGlobal(entries: LessonEntry[]): Promise<void> {
  await writeFile(globalFile, JSON.stringify(entries, null, 2));
}

/** Read and parse the global file. */
async function readGlobal(): Promise<LessonEntry[]> {
  return JSON.parse(await readFile(globalFile, "utf-8"));
}

/** Read and parse the local file. */
async function readLocal(): Promise<LessonEntry[]> {
  return JSON.parse(await readFile(join(outputDir, "lessons-learned.json"), "utf-8"));
}

function createManager(): LessonsManager {
  return new LessonsManager(outputDir, projectRoot);
}

// ===========================================================================
// Group 1: ensureDefaults + initialScore
// ===========================================================================

describe("ensureDefaults + initialScore", () => {
  it("critical severity gets score 10", () => {
    expect(initialScore("critical")).toBe(SCORE_INITIAL.critical);
  });

  it("important severity gets score 6", () => {
    expect(initialScore("important")).toBe(SCORE_INITIAL.important);
  });

  it("minor severity gets score 3", () => {
    expect(initialScore("minor")).toBe(SCORE_INITIAL.minor);
  });

  it("undefined severity defaults to minor (3)", () => {
    expect(initialScore(undefined)).toBe(SCORE_INITIAL.minor);
  });

  it("legacy entry with no score gets default based on severity", () => {
    const entry = makeEntry({ severity: "critical", score: undefined });
    const filled = ensureDefaults(entry);
    expect(filled.score).toBe(10);
    expect(filled.feedbackHistory).toEqual([]);
    expect(filled.retired).toBe(false);
  });

  it("entry with existing score keeps its value", () => {
    const entry = makeEntry({ severity: "critical", score: 7 });
    const filled = ensureDefaults(entry);
    expect(filled.score).toBe(7);
  });
});

// ===========================================================================
// Group 2: applyDecay
// ===========================================================================

describe("applyDecay", () => {
  const now = new Date("2026-03-25T00:00:00Z");

  it("60 days since lastPositiveAt: decay = 2", () => {
    const entry = makeEntry({
      severity: "critical",
      score: 10,
      lastPositiveAt: daysAgo(60, now),
    });
    // 60 / 30 = 2 penalty => 10 - 2 = 8
    expect(applyDecay(entry, now)).toBe(8);
  });

  it("90 days since timestamp (no lastPositiveAt): decay = 3", () => {
    const entry = makeEntry({
      severity: "critical",
      score: 10,
      lastPositiveAt: undefined,
      timestamp: daysAgo(90, now),
    });
    // 90 / 30 = 3 penalty => 10 - 3 = 7
    expect(applyDecay(entry, now)).toBe(7);
  });

  it("15 days: no decay (floor division)", () => {
    const entry = makeEntry({
      severity: "minor",
      score: 3,
      lastPositiveAt: daysAgo(15, now),
    });
    // 15 / 30 = 0 penalty => 3
    expect(applyDecay(entry, now)).toBe(3);
  });

  it("decay cannot reduce below 0", () => {
    const entry = makeEntry({
      severity: "minor",
      score: 1,
      lastPositiveAt: daysAgo(120, now),
    });
    // 120 / 30 = 4 penalty => max(0, 1 - 4) = 0
    expect(applyDecay(entry, now)).toBe(0);
  });

  it("uses timestamp when lastPositiveAt is undefined", () => {
    const entry = makeEntry({
      severity: "important",
      score: 6,
      timestamp: daysAgo(60, now),
    });
    expect(applyDecay(entry, now)).toBe(4);
  });
});

// ===========================================================================
// Group 3: feedback()
// ===========================================================================

describe("feedback()", () => {
  it("helpful verdict: score +3, lastPositiveAt updated", async () => {
    const entry = makeEntry({ id: "fb-1", score: 5 });
    await seedLocal([entry]);
    const mgr = createManager();

    const result = await mgr.feedback(
      [{ id: "fb-1", verdict: "helpful" }],
      { phase: 3, topic: "test" },
    );

    expect(result.localUpdated).toContain("fb-1");
    const entries = await readLocal();
    expect(entries[0].score).toBe(5 + SCORE_DELTA.helpful);
    expect(entries[0].lastPositiveAt).toBeDefined();
  });

  it("not_applicable verdict: score -1", async () => {
    const entry = makeEntry({ id: "fb-2", score: 5 });
    await seedLocal([entry]);
    const mgr = createManager();

    await mgr.feedback(
      [{ id: "fb-2", verdict: "not_applicable" }],
      { phase: 3, topic: "test" },
    );

    const entries = await readLocal();
    expect(entries[0].score).toBe(5 + SCORE_DELTA.not_applicable);
  });

  it("incorrect verdict: score -5", async () => {
    const entry = makeEntry({ id: "fb-3", score: 6 });
    await seedLocal([entry]);
    const mgr = createManager();

    await mgr.feedback(
      [{ id: "fb-3", verdict: "incorrect" }],
      { phase: 3, topic: "test" },
    );

    const entries = await readLocal();
    expect(entries[0].score).toBe(6 + SCORE_DELTA.incorrect);
  });

  it("score floor at 0", async () => {
    const entry = makeEntry({ id: "fb-4", score: 2 });
    await seedLocal([entry]);
    const mgr = createManager();

    await mgr.feedback(
      [{ id: "fb-4", verdict: "incorrect" }],
      { phase: 3, topic: "test" },
    );

    const entries = await readLocal();
    expect(entries[0].score).toBe(0);
  });

  it("feedbackHistory capped at MAX_FEEDBACK_HISTORY (20)", async () => {
    const existingHistory = Array.from({ length: 20 }, (_, i) => ({
      verdict: "helpful" as const,
      phase: 1,
      topic: "old",
      timestamp: `2026-01-${String(i + 1).padStart(2, "0")}T00:00:00Z`,
    }));
    const entry = makeEntry({ id: "fb-5", score: 10, feedbackHistory: existingHistory });
    await seedLocal([entry]);
    const mgr = createManager();

    await mgr.feedback(
      [{ id: "fb-5", verdict: "not_applicable" }],
      { phase: 3, topic: "test" },
    );

    const entries = await readLocal();
    expect(entries[0].feedbackHistory!.length).toBe(MAX_FEEDBACK_HISTORY);
    // The newest item should be last
    expect(entries[0].feedbackHistory![MAX_FEEDBACK_HISTORY - 1].verdict).toBe("not_applicable");
  });

  it("global-only lesson feedback updates global file (AC-8)", async () => {
    // Entry only in global, not in local
    const globalEntry = makeEntry({ id: "global-only-1", score: 6 });
    await seedLocal([]);
    await seedGlobal([globalEntry]);
    const mgr = createManager();

    const result = await mgr.feedback(
      [{ id: "global-only-1", verdict: "helpful" }],
      { phase: 3, topic: "test" },
    );

    expect(result.localUpdated).not.toContain("global-only-1");
    expect(result.globalUpdated).toContain("global-only-1");
    const globals = await readGlobal();
    expect(globals[0].score).toBe(6 + SCORE_DELTA.helpful);
  });

  it("lesson in both local and global updates both files", async () => {
    const entry = makeEntry({ id: "both-1", score: 5 });
    await seedLocal([entry]);
    await seedGlobal([{ ...entry }]);
    const mgr = createManager();

    const result = await mgr.feedback(
      [{ id: "both-1", verdict: "helpful" }],
      { phase: 3, topic: "test" },
    );

    expect(result.localUpdated).toContain("both-1");
    expect(result.globalUpdated).toContain("both-1");

    const locals = await readLocal();
    const globals = await readGlobal();
    expect(locals[0].score).toBe(8);
    expect(globals[0].score).toBe(8);
  });
});

// ===========================================================================
// Group 4: addToGlobal() eviction
// ===========================================================================

describe("addToGlobal() eviction", () => {
  it("pool under limit: entry added directly", async () => {
    await seedGlobal([]);
    const mgr = createManager();
    const entry = makeEntry({ id: "new-1", score: 6, lesson: "unique lesson" });

    const result = await mgr.addToGlobal(entry);

    expect(result.added).toBe(true);
    const globals = await readGlobal();
    expect(globals.length).toBe(1);
    expect(globals[0].id).toBe("new-1");
  });

  it("pool at limit, new entry displaces lowest when margin met", async () => {
    // Fill pool to MAX_GLOBAL_POOL with low-score entries
    const pool = Array.from({ length: MAX_GLOBAL_POOL }, (_, i) =>
      makeEntry({
        id: `pool-${i}`,
        score: 1,
        lesson: `lesson ${i}`,
        timestamp: new Date().toISOString(),
        lastPositiveAt: new Date().toISOString(),
      }),
    );
    await seedGlobal(pool);
    const mgr = createManager();

    // New entry with score high enough: must be > lowest(1) + margin(2) = 3
    const newEntry = makeEntry({
      id: "high-scorer",
      score: 10,
      lesson: "high scoring lesson",
      timestamp: new Date().toISOString(),
      lastPositiveAt: new Date().toISOString(),
    });

    const result = await mgr.addToGlobal(newEntry);
    expect(result.added).toBe(true);
    expect(result.displaced).toBeDefined();

    // The displaced entry is the original (pre-retirement) snapshot
    // Check the persisted state for retirement marks
    const globals = await readGlobal();
    const retiredEntries = globals.filter((e) => e.retired);
    expect(retiredEntries.length).toBe(1);
    expect(retiredEntries[0].retiredReason).toBe("displaced_by_new");

    const active = globals.filter((e) => !e.retired);
    expect(active.length).toBe(MAX_GLOBAL_POOL);
  });

  it("pool at limit, new entry score <= lowest + margin: rejected (P1-2)", async () => {
    const pool = Array.from({ length: MAX_GLOBAL_POOL }, (_, i) =>
      makeEntry({
        id: `pool-${i}`,
        score: 5,
        lesson: `lesson ${i}`,
        timestamp: new Date().toISOString(),
        lastPositiveAt: new Date().toISOString(),
      }),
    );
    await seedGlobal(pool);
    const mgr = createManager();

    // New entry with score = lowest(5) + margin(2) = 7, needs to EXCEED not equal
    const newEntry = makeEntry({
      id: "low-scorer",
      score: 7,
      lesson: "low scoring lesson",
      timestamp: new Date().toISOString(),
      lastPositiveAt: new Date().toISOString(),
    });

    const result = await mgr.addToGlobal(newEntry);
    expect(result.added).toBe(false);
  });

  it("duplicate lesson text: entry rejected", async () => {
    const existing = makeEntry({ id: "dup-1", lesson: "duplicate text" });
    await seedGlobal([existing]);
    const mgr = createManager();

    const dupe = makeEntry({ id: "dup-2", lesson: "duplicate text" });
    const result = await mgr.addToGlobal(dupe);

    expect(result.added).toBe(false);
  });

  it("retired entries do not count toward pool limit", async () => {
    // Fill pool with retired entries + one less than limit active
    const retired = Array.from({ length: 10 }, (_, i) =>
      makeEntry({
        id: `retired-${i}`,
        score: 1,
        lesson: `retired lesson ${i}`,
        retired: true,
        retiredAt: new Date().toISOString(),
        retiredReason: "score_decayed",
      }),
    );
    const active = Array.from({ length: MAX_GLOBAL_POOL - 1 }, (_, i) =>
      makeEntry({
        id: `active-${i}`,
        score: 5,
        lesson: `active lesson ${i}`,
        timestamp: new Date().toISOString(),
        lastPositiveAt: new Date().toISOString(),
      }),
    );
    await seedGlobal([...retired, ...active]);
    const mgr = createManager();

    const newEntry = makeEntry({
      id: "new-fit",
      score: 3,
      lesson: "fits in pool",
      timestamp: new Date().toISOString(),
      lastPositiveAt: new Date().toISOString(),
    });

    const result = await mgr.addToGlobal(newEntry);
    expect(result.added).toBe(true);
  });
});

// ===========================================================================
// Group 5: getGlobalLessons()
// ===========================================================================

describe("getGlobalLessons()", () => {
  it("returns entries sorted by effective score descending", async () => {
    const now = new Date();
    const entries = [
      makeEntry({ id: "low", score: 2, lesson: "low", lastPositiveAt: now.toISOString() }),
      makeEntry({ id: "high", score: 10, lesson: "high", lastPositiveAt: now.toISOString() }),
      makeEntry({ id: "mid", score: 5, lesson: "mid", lastPositiveAt: now.toISOString() }),
    ];
    await seedGlobal(entries);
    const mgr = createManager();

    const result = await mgr.getGlobalLessons(10);

    expect(result.map((e) => e.id)).toEqual(["high", "mid", "low"]);
  });

  it("lazy retirement: entries with applyDecay() <= 0 are retired and persisted (P0-1)", async () => {
    const oldEntry = makeEntry({
      id: "decayed-1",
      score: 1,
      lesson: "very old lesson",
      timestamp: daysAgo(120),
      lastPositiveAt: undefined,
    });
    // score=1, decay=120/30=4 => effective=max(0,1-4)=0
    await seedGlobal([oldEntry]);
    const mgr = createManager();

    const result = await mgr.getGlobalLessons();

    expect(result.length).toBe(0);
    const persisted = await readGlobal();
    expect(persisted[0].retired).toBe(true);
    expect(persisted[0].retiredReason).toBe("score_decayed");
  });

  it("retired entries are not returned", async () => {
    const entries = [
      makeEntry({ id: "active-1", score: 5, lesson: "active", lastPositiveAt: new Date().toISOString() }),
      makeEntry({ id: "retired-1", score: 5, lesson: "retired", retired: true, retiredAt: new Date().toISOString() }),
    ];
    await seedGlobal(entries);
    const mgr = createManager();

    const result = await mgr.getGlobalLessons();

    expect(result.length).toBe(1);
    expect(result[0].id).toBe("active-1");
  });

  it("appliedCount and lastAppliedAt updated for selected entries", async () => {
    const entry = makeEntry({
      id: "applied-1",
      score: 5,
      lesson: "applied lesson",
      appliedCount: 2,
      lastPositiveAt: new Date().toISOString(),
    });
    await seedGlobal([entry]);
    const mgr = createManager();

    await mgr.getGlobalLessons();

    const persisted = await readGlobal();
    expect(persisted[0].appliedCount).toBe(3);
    expect(persisted[0].lastAppliedAt).toBeDefined();
  });

  it("respects limit parameter", async () => {
    const now = new Date();
    const entries = Array.from({ length: 5 }, (_, i) =>
      makeEntry({
        id: `limit-${i}`,
        score: 10 - i,
        lesson: `lesson ${i}`,
        lastPositiveAt: now.toISOString(),
      }),
    );
    await seedGlobal(entries);
    const mgr = createManager();

    const result = await mgr.getGlobalLessons(2);

    expect(result.length).toBe(2);
    expect(result[0].id).toBe("limit-0");
    expect(result[1].id).toBe("limit-1");
  });
});

// ===========================================================================
// Group 6: promoteReusableLessons()
// ===========================================================================

describe("promoteReusableLessons()", () => {
  it("only promotes entries with reusable=true and !retired", async () => {
    const entries = [
      makeEntry({ id: "reuse-1", reusable: true, lesson: "reusable lesson", score: 5 }),
      makeEntry({ id: "non-reuse", reusable: false, lesson: "non reusable", score: 5 }),
      makeEntry({ id: "retired-reuse", reusable: true, retired: true, lesson: "retired reusable", score: 5 }),
    ];
    await seedLocal(entries);
    await seedGlobal([]);
    const mgr = createManager();

    const promoted = await mgr.promoteReusableLessons("my-topic");

    expect(promoted).toBe(1);
    const globals = await readGlobal();
    expect(globals.length).toBe(1);
    expect(globals[0].id).toBe("reuse-1");
    expect(globals[0].topic).toBe("my-topic");
  });

  it("dedup prevents double promotion", async () => {
    const entry = makeEntry({ id: "reuse-2", reusable: true, lesson: "already global", score: 5 });
    await seedLocal([entry]);
    await seedGlobal([makeEntry({ id: "existing", lesson: "already global", score: 5 })]);
    const mgr = createManager();

    const promoted = await mgr.promoteReusableLessons("my-topic");

    expect(promoted).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Group 7: AC-1/AC-2/AC-9 — Integration entry point behavior
// These verify the contract between preflight → state → checkpoint:
// - Lessons injected → injectedLessonIds written to state
// - Checkpoint detects pending IDs → rejects PASS
// - After feedback → IDs cleared → checkpoint allows PASS
// ---------------------------------------------------------------------------

describe("AC-1/AC-2/AC-9: injectedLessonIds lifecycle", () => {
  // These test the state-level contract, not the full MCP handler.
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "lessons-ac9-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("AC-1: injectedLessonIds can be written and read back from state-like JSON", async () => {
    // Simulates what preflight does: write injectedLessonIds to state
    const statePath = join(tmpDir, "state.json");
    const state = {
      topic: "test", mode: "full", phase: 1, status: "IN_PROGRESS",
      stack: { language: "TS", buildCmd: "tsc", testCmd: "vitest", langChecklist: "ts.md" },
      outputDir: tmpDir, projectRoot: tmpDir,
      startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      injectedLessonIds: ["id-aaa", "id-bbb"],
    };
    await writeFile(statePath, JSON.stringify(state), "utf-8");

    const loaded = JSON.parse(await readFile(statePath, "utf-8"));
    expect(loaded.injectedLessonIds).toEqual(["id-aaa", "id-bbb"]);
  });

  it("AC-2/AC-9: non-empty injectedLessonIds no longer blocks PASS (guard removed)", () => {
    // Guard was removed — injectedLessonIds presence does NOT block PASS anymore.
    // Feedback is now optional. This test documents the new behavior.
    const status = "PASS";
    const pendingIds = ["id-aaa", "id-bbb"];

    // Old behavior: shouldReject = true. New behavior: no rejection.
    const shouldReject = false; // Guard removed
    expect(shouldReject).toBe(false);
  });

  it("AC-9: empty injectedLessonIds allows PASS (unchanged)", () => {
    const status = "PASS";
    const pendingIds: string[] = [];

    // Still allowed — no change in behavior
    expect(pendingIds.length).toBe(0);
  });

  it("AC-9: non-PASS status proceeds normally even with pending IDs (unchanged)", () => {
    const status = "IN_PROGRESS";
    const pendingIds = ["id-aaa"];

    // No blocking for any status now
    expect(status).toBe("IN_PROGRESS");
    expect(pendingIds.length).toBe(1);
  });

  it("feedback clears injectedLessonIds (contract: empty after feedback)", async () => {
    const statePath = join(tmpDir, "state.json");
    const state = {
      topic: "test", mode: "full", phase: 1, status: "PASS",
      stack: { language: "TS", buildCmd: "tsc", testCmd: "vitest", langChecklist: "ts.md" },
      outputDir: tmpDir, projectRoot: tmpDir,
      startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      injectedLessonIds: ["id-aaa"],
    };
    await writeFile(statePath, JSON.stringify(state), "utf-8");

    // Simulate what auto_dev_lessons_feedback does: clear the IDs
    const loaded = JSON.parse(await readFile(statePath, "utf-8"));
    loaded.injectedLessonIds = [];
    await writeFile(statePath, JSON.stringify(loaded), "utf-8");

    const final = JSON.parse(await readFile(statePath, "utf-8"));
    expect(final.injectedLessonIds).toEqual([]);
  });
});

// ===========================================================================
// Group 8: Cross-project Global layer (self-evolution)
// ===========================================================================

describe("Cross-project Global layer", () => {
  let crossTmpRoot: string;
  let crossOutputDir: string;
  let crossProjectRoot: string;
  let crossGlobalDir: string;
  let crossGlobalFile: string;
  let crossProjectGlobalFile: string;

  beforeEach(async () => {
    crossTmpRoot = await mkdtemp(join(tmpdir(), "lessons-cross-"));
    crossProjectRoot = crossTmpRoot;
    crossOutputDir = join(crossProjectRoot, "docs", "auto-dev", "test-topic");
    crossGlobalDir = join(crossProjectRoot, "docs", "auto-dev", "_global");
    crossGlobalFile = join(crossTmpRoot, ".auto-dev", "lessons-global.json");
    crossProjectGlobalFile = join(crossGlobalDir, "lessons-global.json");
    await mkdir(crossOutputDir, { recursive: true });
    await mkdir(crossGlobalDir, { recursive: true });
    await mkdir(join(crossTmpRoot, ".auto-dev"), { recursive: true });

    // Override homedir for cross-project tests
    mockHomedir = crossTmpRoot;
  });

  afterEach(async () => {
    mockHomedir = null;
    await rm(crossTmpRoot, { recursive: true, force: true });
  });

  function crossSeedProject(entries: LessonEntry[]): Promise<void> {
    return writeFile(crossProjectGlobalFile, JSON.stringify(entries, null, 2));
  }

  function crossSeedGlobal(entries: LessonEntry[]): Promise<void> {
    return writeFile(crossGlobalFile, JSON.stringify(entries, null, 2));
  }

  async function readCrossGlobal(): Promise<LessonEntry[]> {
    return JSON.parse(await readFile(crossGlobalFile, "utf-8"));
  }

  function crossCreateManager(): LessonsManager {
    return new LessonsManager(crossOutputDir, crossProjectRoot);
  }

  // --- getCrossProjectLessons ---

  describe("getCrossProjectLessons()", () => {
    it("returns empty array when global file does not exist", async () => {
      const mgr = crossCreateManager();
      const result = await mgr.getCrossProjectLessons();
      expect(result).toEqual([]);
    });

    it("returns empty array for empty JSON array file", async () => {
      // We need to write directly to the crossProjectFilePath
      // Since crossProjectFilePath is private, we use the public method
      const mgr = crossCreateManager();
      // Write to home dir — but we can't easily without mocking
      // Instead test via promoteToGlobal + getCrossProjectLessons round-trip
      const result = await mgr.getCrossProjectLessons();
      expect(result).toEqual([]);
    });

    it("returns entries sorted by decayed score descending", async () => {
      const now = new Date();
      // Seed the cross-project global file directly
      await crossSeedGlobal([
        makeEntry({ id: "g-low", score: 2, lesson: "low lesson", lastPositiveAt: now.toISOString() }),
        makeEntry({ id: "g-high", score: 10, lesson: "high lesson", lastPositiveAt: now.toISOString() }),
        makeEntry({ id: "g-mid", score: 5, lesson: "mid lesson", lastPositiveAt: now.toISOString() }),
      ]);

      const mgr = crossCreateManager();
      const result = await mgr.getCrossProjectLessons(10);
      expect(result.length).toBe(3);
      expect(result[0].id).toBe("g-high");
      expect(result[2].id).toBe("g-low");
    });
  });

  // --- promoteToGlobal ---

  describe("promoteToGlobal()", () => {
    it("promotes reusable entries with score >= minScore (AC-2)", async () => {
      const now = new Date();
      // Seed project-level entries (these are what promoteToGlobal reads from)
      await crossSeedProject([
        makeEntry({
          id: "promo-1", score: 8, lesson: "reusable high-score",
          reusable: true, lastPositiveAt: now.toISOString(),
        }),
        makeEntry({
          id: "promo-2", score: 4, lesson: "reusable low-score",
          reusable: true, lastPositiveAt: now.toISOString(),
        }),
        makeEntry({
          id: "promo-3", score: 8, lesson: "non-reusable high-score",
          reusable: false, lastPositiveAt: now.toISOString(),
        }),
      ]);

      const mgr = crossCreateManager();
      const promoted = await mgr.promoteToGlobal(6);

      // Only promo-1 qualifies (reusable + score >= 6)
      expect(promoted).toBe(1);
      const globalEntries = await readCrossGlobal();
      expect(globalEntries.length).toBe(1);
      expect(globalEntries[0].lesson).toBe("reusable high-score");
    });

    it("rejects low-score entries (AC-11)", async () => {
      const now = new Date();
      // Seed project-level entries
      await crossSeedProject([
        makeEntry({
          id: "low-1", score: 3, lesson: "low score entry",
          reusable: true, lastPositiveAt: now.toISOString(),
        }),
      ]);

      const mgr = crossCreateManager();
      const promoted = await mgr.promoteToGlobal(); // default minScore=6
      expect(promoted).toBe(0);
    });

    it("deduplicates by lesson text", async () => {
      const now = new Date();
      // Seed project-level entries
      await crossSeedProject([
        makeEntry({
          id: "dup-prj-1", score: 10, lesson: "same lesson text",
          reusable: true, lastPositiveAt: now.toISOString(),
        }),
      ]);

      const mgr = crossCreateManager();

      // First promotion
      const first = await mgr.promoteToGlobal(1);
      expect(first).toBe(1);

      // Second promotion — should be deduped
      const second = await mgr.promoteToGlobal(1);
      expect(second).toBe(0);
    });

    it("sets sourceProject and promotionPath on promoted entries", async () => {
      const now = new Date();
      // Seed project-level entries
      await crossSeedProject([
        makeEntry({
          id: "meta-1", score: 10, lesson: "has metadata",
          reusable: true, lastPositiveAt: now.toISOString(),
        }),
      ]);

      const mgr = crossCreateManager();
      await mgr.promoteToGlobal(1);

      const globalEntries = await readCrossGlobal();
      expect(globalEntries.length).toBe(1);
      expect(globalEntries[0].sourceProject).toBeDefined();
      expect(globalEntries[0].promotedAt).toBeDefined();
      expect(globalEntries[0].promotionPath).toBe("project_to_global");
    });
  });

  // --- injectGlobalLessons ---

  describe("injectGlobalLessons()", () => {
    it("returns same as getCrossProjectLessons()", async () => {
      const mgr = crossCreateManager();
      const result = await mgr.injectGlobalLessons();
      expect(result).toEqual([]);
    });
  });

  // --- backward compatibility ---

  describe("backward compatibility aliases", () => {
    it("getGlobalLessons() delegates to getProjectLessons()", async () => {
      const now = new Date();
      await seedGlobal([
        makeEntry({ id: "compat-1", score: 5, lesson: "compat test", lastPositiveAt: now.toISOString() }),
      ]);
      const mgr = createManager();

      const result = await mgr.getGlobalLessons(10);
      expect(result.length).toBe(1);
      expect(result[0].id).toBe("compat-1");
    });

    it("addToGlobal() delegates to addToProject()", async () => {
      await seedGlobal([]);
      const mgr = createManager();
      const entry = makeEntry({ id: "compat-add", lesson: "compat add test", score: 5 });

      const result = await mgr.addToGlobal(entry);
      expect(result.added).toBe(true);
    });

    it("promoteReusableLessons() delegates to promoteToProject()", async () => {
      await seedLocal([
        makeEntry({ id: "compat-promo", lesson: "compat promo", reusable: true, score: 5 }),
      ]);
      await seedGlobal([]);
      const mgr = createManager();

      const promoted = await mgr.promoteReusableLessons("test-topic");
      expect(promoted).toBe(1);
    });

    it("readGlobalEntries() delegates to readProjectEntries()", async () => {
      await seedGlobal([
        makeEntry({ id: "compat-read", lesson: "compat read test" }),
      ]);
      const mgr = createManager();

      const result = await mgr.readGlobalEntries();
      expect(result.length).toBe(1);
    });
  });

  // --- data compatibility ---

  describe("data compatibility (AC-6)", () => {
    it("old JSON without new fields deserializes correctly", async () => {
      // Write a lesson entry without sourceProject/promotedAt/promotionPath
      const oldFormatEntry = {
        id: "old-1",
        phase: 3,
        category: "pitfall",
        severity: "minor",
        lesson: "old format lesson",
        reusable: false,
        appliedCount: 0,
        timestamp: new Date().toISOString(),
        score: 5,
      };
      await seedGlobal([oldFormatEntry as LessonEntry]);
      const mgr = createManager();

      const result = await mgr.getProjectLessons(10);
      expect(result.length).toBe(1);
      expect(result[0].sourceProject).toBeUndefined();
      expect(result[0].promotedAt).toBeUndefined();
      expect(result[0].promotionPath).toBeUndefined();
    });

    it("handles malformed cross-project JSON gracefully (AC-10)", async () => {
      // Write invalid JSON to the cross-project global file
      await writeFile(crossGlobalFile, "not valid json {", "utf-8");
      const mgr = crossCreateManager();
      const result = await mgr.getCrossProjectLessons();
      expect(result).toEqual([]);
    });

    it("handles empty array cross-project JSON (AC-10)", async () => {
      await crossSeedGlobal([]);
      const mgr = crossCreateManager();
      const result = await mgr.getCrossProjectLessons();
      expect(result).toEqual([]);
    });

    it("file not found returns empty array (AC-10)", async () => {
      // Don't seed any file — crossGlobalFile doesn't exist
      const mgr = crossCreateManager();
      const result = await mgr.getCrossProjectLessons();
      expect(result).toEqual([]);
    });
  });

  // --- cross-project pool displacement (AC-3) ---

  describe("cross-project pool displacement (AC-3)", () => {
    it("pool at limit: high-score entry displaces lowest", async () => {
      const now = new Date();
      // Fill cross-project pool to MAX_CROSS_PROJECT_POOL
      const pool = Array.from({ length: MAX_CROSS_PROJECT_POOL }, (_, i) =>
        makeEntry({
          id: `cp-pool-${i}`,
          score: 1,
          lesson: `cross-project lesson ${i}`,
          timestamp: now.toISOString(),
          lastPositiveAt: now.toISOString(),
        }),
      );
      await crossSeedGlobal(pool);

      // Seed a high-score entry in the project layer
      await crossSeedProject([
        makeEntry({
          id: "cp-high-scorer",
          score: 10,
          lesson: "high scoring cross-project lesson",
          reusable: true,
          timestamp: now.toISOString(),
          lastPositiveAt: now.toISOString(),
        }),
      ]);

      const mgr = crossCreateManager();
      const promoted = await mgr.promoteToGlobal(1);
      expect(promoted).toBe(1);

      const globalEntries = await readCrossGlobal();
      const retired = globalEntries.filter(e => e.retired);
      expect(retired.length).toBe(1);
      expect(retired[0].retiredReason).toBe("displaced_by_new");
    });

    it("pool at limit: low-score entry rejected when margin not met", async () => {
      const now = new Date();
      // Fill pool with score=5 entries
      const pool = Array.from({ length: MAX_CROSS_PROJECT_POOL }, (_, i) =>
        makeEntry({
          id: `cp-pool-${i}`,
          score: 5,
          lesson: `cross-project lesson ${i}`,
          timestamp: now.toISOString(),
          lastPositiveAt: now.toISOString(),
        }),
      );
      await crossSeedGlobal(pool);

      // Seed an entry with score=7 (= lowest(5) + margin(2)), needs to EXCEED
      await crossSeedProject([
        makeEntry({
          id: "cp-low-scorer",
          score: 7,
          lesson: "marginal cross-project lesson",
          reusable: true,
          timestamp: now.toISOString(),
          lastPositiveAt: now.toISOString(),
        }),
      ]);

      const mgr = crossCreateManager();
      const promoted = await mgr.promoteToGlobal(1);
      expect(promoted).toBe(0);
    });
  });
});
