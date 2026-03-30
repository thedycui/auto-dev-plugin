/**
 * Tests for StateManager.isCheckpointDuplicate() — tail-read optimization.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { StateManager } from "../state-manager.js";

// ---------------------------------------------------------------------------
// Fixture management
// ---------------------------------------------------------------------------

let tmpRoot: string;
let outputDir: string;
let sm: StateManager;

beforeEach(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), "checkpoint-test-"));
  outputDir = join(tmpRoot, "docs", "auto-dev", "test-topic");
  await mkdir(outputDir, { recursive: true });
  sm = new StateManager(tmpRoot, "test-topic", outputDir);
});

afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
});

// ===========================================================================
// Small file (< 4KB) — standard behavior
// ===========================================================================

describe("isCheckpointDuplicate — small file (< 4KB)", () => {
  it("returns true when last checkpoint matches (AC-7)", async () => {
    const content = [
      "# progress-log\n",
      `<!-- CHECKPOINT phase=3 status=PASS summary="done" timestamp=2026-03-30T10:00:00Z -->`,
    ].join("\n");
    await writeFile(join(outputDir, "progress-log.md"), content);

    const result = await sm.isCheckpointDuplicate(3, undefined, "PASS", "done");
    expect(result).toBe(true);
  });

  it("returns false when phase differs", async () => {
    const content = `<!-- CHECKPOINT phase=3 status=PASS timestamp=2026-03-30T10:00:00Z -->`;
    await writeFile(join(outputDir, "progress-log.md"), content);

    const result = await sm.isCheckpointDuplicate(4, undefined, "PASS");
    expect(result).toBe(false);
  });

  it("returns false when status differs", async () => {
    const content = `<!-- CHECKPOINT phase=3 status=PASS timestamp=2026-03-30T10:00:00Z -->`;
    await writeFile(join(outputDir, "progress-log.md"), content);

    const result = await sm.isCheckpointDuplicate(3, undefined, "NEEDS_REVISION");
    expect(result).toBe(false);
  });

  it("returns true when task matches", async () => {
    const content = `<!-- CHECKPOINT phase=3 task=5 status=PASS summary="task5" timestamp=2026-03-30T10:00:00Z -->`;
    await writeFile(join(outputDir, "progress-log.md"), content);

    const result = await sm.isCheckpointDuplicate(3, 5, "PASS", "task5");
    expect(result).toBe(true);
  });

  it("returns false when no checkpoints exist", async () => {
    await writeFile(join(outputDir, "progress-log.md"), "# empty log\n");

    const result = await sm.isCheckpointDuplicate(1, undefined, "PASS");
    expect(result).toBe(false);
  });
});

// ===========================================================================
// File does not exist
// ===========================================================================

describe("isCheckpointDuplicate — file not found", () => {
  it("returns false when progress-log.md does not exist", async () => {
    const result = await sm.isCheckpointDuplicate(1, undefined, "PASS");
    expect(result).toBe(false);
  });
});

// ===========================================================================
// Large file (> 4KB) — tail-read optimization
// ===========================================================================

describe("isCheckpointDuplicate — large file (> 4KB)", () => {
  it("reads only tail and correctly finds last checkpoint (AC-6)", async () => {
    // Build a file > 4KB with padding, then a checkpoint at the end
    const padding = "x".repeat(5000) + "\n";
    const earlyCheckpoint = `<!-- CHECKPOINT phase=1 status=IN_PROGRESS timestamp=2026-03-30T08:00:00Z -->\n`;
    const lastCheckpoint = `<!-- CHECKPOINT phase=3 status=PASS summary="final" timestamp=2026-03-30T12:00:00Z -->\n`;
    const content = padding + earlyCheckpoint + padding + lastCheckpoint;
    await writeFile(join(outputDir, "progress-log.md"), content);

    // Should match the last checkpoint
    const result = await sm.isCheckpointDuplicate(3, undefined, "PASS", "final");
    expect(result).toBe(true);

    // Should NOT match the early checkpoint
    const result2 = await sm.isCheckpointDuplicate(1, undefined, "IN_PROGRESS");
    expect(result2).toBe(false);
  });

  it("falls back to full read when tail has no CHECKPOINT", async () => {
    // Checkpoint at beginning, then > 4KB of non-checkpoint content
    const checkpoint = `<!-- CHECKPOINT phase=2 status=PASS timestamp=2026-03-30T09:00:00Z -->\n`;
    const padding = "y".repeat(6000) + "\n";
    const content = checkpoint + padding;
    await writeFile(join(outputDir, "progress-log.md"), content);

    // Should still find it via fallback
    const result = await sm.isCheckpointDuplicate(2, undefined, "PASS");
    expect(result).toBe(true);
  });
});
