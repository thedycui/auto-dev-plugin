/**
 * Tests for retrospective-data.ts: extractTribunalCrashes, extractPhaseTimings,
 * extractSubmitRetries, and generateRetrospectiveData integration.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  extractTribunalCrashes,
  extractPhaseTimings,
  extractSubmitRetries,
  generateRetrospectiveData,
} from "../retrospective-data.js";

// ---------------------------------------------------------------------------
// Fixture management
// ---------------------------------------------------------------------------

let tmpRoot: string;
let outputDir: string;

beforeEach(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), "retro-data-test-"));
  outputDir = join(tmpRoot, "output");
  await mkdir(outputDir, { recursive: true });
});

afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
});

// ===========================================================================
// extractTribunalCrashes
// ===========================================================================

describe("extractTribunalCrashes", () => {
  it("parses simple format: <!-- TRIBUNAL_CRASH phase=N -->", () => {
    const log = `some text\n<!-- TRIBUNAL_CRASH phase=4 -->\nmore text`;
    const result = extractTribunalCrashes(log);
    expect(result).toEqual([{ phase: 4 }]);
  });

  it("parses full format with all attributes", () => {
    const log = `<!-- TRIBUNAL_CRASH phase=5 category="TIMEOUT" exitCode="124" retryable="true" timestamp="2026-03-30T10:00:00Z" -->`;
    const result = extractTribunalCrashes(log);
    expect(result).toEqual([{
      phase: 5,
      category: "TIMEOUT",
      exitCode: "124",
      retryable: true,
      timestamp: "2026-03-30T10:00:00Z",
    }]);
  });

  it("parses retryable=false correctly", () => {
    const log = `<!-- TRIBUNAL_CRASH phase=3 retryable="false" -->`;
    const result = extractTribunalCrashes(log);
    expect(result).toHaveLength(1);
    expect(result[0].retryable).toBe(false);
  });

  it("parses multiple crashes in mixed event log", () => {
    const log = [
      `<!-- CHECKPOINT phase=3 status=PASS timestamp=2026-03-30T09:00:00Z -->`,
      `<!-- TRIBUNAL_CRASH phase=4 -->`,
      `<!-- CHECKPOINT phase=4 status=NEEDS_REVISION timestamp=2026-03-30T10:00:00Z -->`,
      `<!-- TRIBUNAL_CRASH phase=5 category="OOM" exitCode="137" retryable="false" timestamp="2026-03-30T11:00:00Z" -->`,
    ].join("\n");
    const result = extractTribunalCrashes(log);
    expect(result).toHaveLength(2);
    expect(result[0].phase).toBe(4);
    expect(result[1].phase).toBe(5);
    expect(result[1].category).toBe("OOM");
  });

  it("returns empty array for empty input", () => {
    expect(extractTribunalCrashes("")).toEqual([]);
  });

  it("returns empty array when no TRIBUNAL_CRASH events exist", () => {
    const log = `<!-- CHECKPOINT phase=3 status=PASS timestamp=2026-03-30T09:00:00Z -->`;
    expect(extractTribunalCrashes(log)).toEqual([]);
  });
});

// ===========================================================================
// extractPhaseTimings
// ===========================================================================

describe("extractPhaseTimings", () => {
  it("parses standard CHECKPOINT without task", () => {
    const log = `<!-- CHECKPOINT phase=1 status=IN_PROGRESS timestamp=2026-03-30T08:00:00Z -->
<!-- CHECKPOINT phase=1 status=PASS timestamp=2026-03-30T09:00:00Z -->`;
    const result = extractPhaseTimings(log);
    expect(result[1]).toBeDefined();
    expect(result[1].startedAt).toBe("2026-03-30T08:00:00Z");
    expect(result[1].completedAt).toBe("2026-03-30T09:00:00Z");
    expect(result[1].durationMs).toBe(3600000);
  });

  it("parses CHECKPOINT with task=N attribute (AC-3)", () => {
    const log = `<!-- CHECKPOINT phase=3 task=11 status=PASS summary="Task 11 done" timestamp=2026-03-30T10:00:00Z -->`;
    const result = extractPhaseTimings(log);
    expect(result[3]).toBeDefined();
    expect(result[3].completedAt).toBe("2026-03-30T10:00:00Z");
  });

  it("parses summary with Chinese characters, parentheses, and slashes (AC-4)", () => {
    const log = `<!-- CHECKPOINT phase=2 status=PASS summary="设计完成(v2/final)" timestamp=2026-03-30T11:00:00Z -->`;
    const result = extractPhaseTimings(log);
    expect(result[2]).toBeDefined();
    expect(result[2].completedAt).toBe("2026-03-30T11:00:00Z");
  });

  it("handles summary containing status= substring without mis-matching", () => {
    const log = `<!-- CHECKPOINT phase=3 status=PASS summary="set status=DONE for all" timestamp=2026-03-30T12:00:00Z -->`;
    const result = extractPhaseTimings(log);
    expect(result[3]).toBeDefined();
    expect(result[3].completedAt).toBe("2026-03-30T12:00:00Z");
  });

  it("handles summary containing timestamp= substring without mis-matching", () => {
    const log = `<!-- CHECKPOINT phase=4 status=PASS summary="wrote timestamp=xyz to file" timestamp=2026-03-30T13:00:00Z -->`;
    const result = extractPhaseTimings(log);
    expect(result[4]).toBeDefined();
    expect(result[4].completedAt).toBe("2026-03-30T13:00:00Z");
  });

  it("returns empty object for empty input", () => {
    expect(extractPhaseTimings("")).toEqual({});
  });

  it("handles CHECKPOINT without summary", () => {
    const log = `<!-- CHECKPOINT phase=5 status=COMPLETED timestamp=2026-03-30T14:00:00Z -->`;
    const result = extractPhaseTimings(log);
    expect(result[5]).toBeDefined();
    expect(result[5].completedAt).toBe("2026-03-30T14:00:00Z");
  });
});

// ===========================================================================
// extractSubmitRetries
// ===========================================================================

describe("extractSubmitRetries", () => {
  it("counts PASS checkpoints per phase", () => {
    const log = [
      `<!-- CHECKPOINT phase=3 status=PASS timestamp=2026-03-30T09:00:00Z -->`,
      `<!-- CHECKPOINT phase=3 status=PASS summary="retry" timestamp=2026-03-30T10:00:00Z -->`,
      `<!-- CHECKPOINT phase=4 status=PASS timestamp=2026-03-30T11:00:00Z -->`,
    ].join("\n");
    const result = extractSubmitRetries(log);
    expect(result[3]).toBe(2);
    expect(result[4]).toBe(1);
  });

  it("counts PASS with task attribute", () => {
    const log = `<!-- CHECKPOINT phase=3 task=5 status=PASS summary="done" timestamp=2026-03-30T09:00:00Z -->`;
    const result = extractSubmitRetries(log);
    expect(result[3]).toBe(1);
  });

  it("returns empty for no PASS", () => {
    const log = `<!-- CHECKPOINT phase=1 status=IN_PROGRESS timestamp=2026-03-30T08:00:00Z -->`;
    expect(extractSubmitRetries(log)).toEqual({});
  });
});

// ===========================================================================
// generateRetrospectiveData integration
// ===========================================================================

describe("generateRetrospectiveData", () => {
  it("includes Tribunal Crashes in output markdown when crashes exist (AC-5)", async () => {
    const progressLog = [
      `# auto-dev progress-log: test\n`,
      `<!-- CHECKPOINT phase=3 status=PASS timestamp=2026-03-30T09:00:00Z -->`,
      `<!-- TRIBUNAL_CRASH phase=4 category="TIMEOUT" exitCode="124" retryable="true" timestamp="2026-03-30T10:00:00Z" -->`,
    ].join("\n");
    await writeFile(join(outputDir, "progress-log.md"), progressLog);
    // state.json needed by extractTddGateStats
    await writeFile(join(outputDir, "state.json"), JSON.stringify({}));

    const data = await generateRetrospectiveData(outputDir);

    expect(data.tribunalCrashes).toHaveLength(1);
    expect(data.tribunalCrashes[0].phase).toBe(4);
    expect(data.tribunalCrashes[0].category).toBe("TIMEOUT");

    const md = await readFile(join(outputDir, "retrospective-data.md"), "utf-8");
    expect(md).toContain("## Tribunal Crashes");
    expect(md).toContain("TIMEOUT");
  });

  it("shows placeholder when no crashes exist", async () => {
    const progressLog = `# auto-dev progress-log: test\n<!-- CHECKPOINT phase=1 status=PASS timestamp=2026-03-30T08:00:00Z -->`;
    await writeFile(join(outputDir, "progress-log.md"), progressLog);
    await writeFile(join(outputDir, "state.json"), JSON.stringify({}));

    const data = await generateRetrospectiveData(outputDir);

    expect(data.tribunalCrashes).toEqual([]);

    const md = await readFile(join(outputDir, "retrospective-data.md"), "utf-8");
    expect(md).toContain("No tribunal crashes recorded.");
  });

  it("returns tribunalCrashes: [] for empty progress-log (AC-12)", async () => {
    await writeFile(join(outputDir, "progress-log.md"), "");
    await writeFile(join(outputDir, "state.json"), JSON.stringify({}));

    const data = await generateRetrospectiveData(outputDir);
    expect(data.tribunalCrashes).toEqual([]);
  });

  it("returns tribunalCrashes: [] when progress-log does not exist (AC-12)", async () => {
    await writeFile(join(outputDir, "state.json"), JSON.stringify({}));

    const data = await generateRetrospectiveData(outputDir);
    expect(data.tribunalCrashes).toEqual([]);
  });
});
