/**
 * StateManager — auto-dev session state persistence layer.
 *
 * Responsibilities:
 *  - Detect output directory, read/write state.json with Zod validation
 *  - Atomic writes via write-to-temp-then-rename
 *  - Detect project tech stack from build files + stacks/*.md
 *  - Manage progress-log.md (append, checkpoint dedup)
 */

import { readFile, writeFile, rename, mkdir, stat } from "node:fs/promises";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { StateJsonSchema } from "./types.js";
import type { StateJson, StackInfo } from "./types.js";
import { computeNextDirective } from "./phase-enforcer.js";
import type { NextDirective } from "./phase-enforcer.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATE_FILE = "state.json";
const PROGRESS_LOG = "progress-log.md";
const OUTPUT_BASE = "docs/auto-dev";

/** Build-file detection order (first match wins). */
const STACK_DETECTION: Array<{ file: string; stackFile: string }> = [
  { file: "pom.xml", stackFile: "java-maven.md" },
  { file: "build.gradle", stackFile: "java-gradle.md" },
  { file: "package.json", stackFile: "node-npm.md" },
  { file: "pyproject.toml", stackFile: "python.md" },
  { file: "requirements.txt", stackFile: "python.md" },
];

/** Directories to search for stacks/*.md (in priority order). */
function stackSearchPaths(): string[] {
  // __dirname resolves to mcp/src at compile-time; the plugin root is two levels up.
  const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
  return [
    join(pluginRoot, "skills", "auto-dev", "stacks"),
    join(homedir(), ".claude", "skills", "auto-dev", "stacks"),
  ];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function parseHeaderField(content: string, field: string): string | null {
  const regex = new RegExp(`>\\s*${field}:\\s*(.+?)\\s*$`, "m");
  const match = content.match(regex);
  return match?.[1] ? match[1].trim() : null;
}

function parseAllCheckpoints(content: string): Array<{ phase: number; status: string }> {
  const results: Array<{ phase: number; status: string }> = [];
  const regex = /<!-- CHECKPOINT phase=(\d+).*?status=(\S+)/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    results.push({ phase: parseInt(match[1]!, 10), status: match[2]! });
  }
  return results;
}

export function extractDocSummary(content: string, maxLines: number): string {
  // 优先查找 ## 概述 或 ## Summary 段落
  const sectionMatch = content.match(/## (?:概述|Summary)\s*\n([\s\S]*?)(?=\n## |$)/);
  if (sectionMatch) {
    return sectionMatch[1]!.trim();
  }
  // 找不到概述段落，取前 maxLines 行
  const lines = content.split("\n");
  return lines.slice(0, maxLines).join("\n").trim();
}

export function extractTaskList(content: string): string {
  const lines = content.split("\n");
  const taskLines = lines.filter((line) =>
    /^###\s+Task\s+\d+/.test(line) ||
    /^-\s+\[[ x]\]\s+Task\s+\d+/i.test(line) ||
    /^##\s+Task\s+\d+/.test(line)
  );
  return taskLines.join("\n").trim();
}

/**
 * Parse a stacks/*.md file and extract the `## Variables` key-value pairs.
 *
 * Expected format inside the file:
 * ```
 * ## Variables
 * - language: TypeScript/JavaScript
 * - build_cmd: npm run build
 * ```
 */
function parseStackVariables(content: string): Record<string, string> {
  const vars: Record<string, string> = {};
  const sectionMatch = content.match(/## Variables\s*\n([\s\S]*?)(?=\n## |\n$|$)/);
  if (!sectionMatch) return vars;

  const lines = sectionMatch[1]!.split("\n");
  for (const line of lines) {
    const m = line.match(/^-\s+(\w+):\s*(.+)$/);
    if (m && m[1] && m[2]) {
      vars[m[1]] = m[2].trim();
    }
  }
  return vars;
}

// ---------------------------------------------------------------------------
// StateManager
// ---------------------------------------------------------------------------

export class StateManager {
  readonly projectRoot: string;
  readonly topic: string;
  readonly outputDir: string;
  readonly stateFilePath: string;
  readonly progressLogPath: string;

  /** In-memory copy of the latest persisted state. Available after init() or loadAndValidate(). */
  private state: StateJson | null = null;

  constructor(projectRoot: string, topic: string) {
    this.projectRoot = resolve(projectRoot);
    this.topic = topic;
    this.outputDir = join(this.projectRoot, OUTPUT_BASE, topic);
    this.stateFilePath = join(this.outputDir, STATE_FILE);
    this.progressLogPath = join(this.outputDir, PROGRESS_LOG);
  }

  // -----------------------------------------------------------------------
  // Directory / read helpers
  // -----------------------------------------------------------------------

  /** Check whether the output directory already exists. */
  async outputDirExists(): Promise<boolean> {
    return fileExists(this.outputDir);
  }

  /** Try to read and parse state.json. Returns null on any failure or validation error. */
  async tryReadState(): Promise<StateJson | null> {
    try {
      const raw = await readFile(this.stateFilePath, "utf-8");
      const parsed = JSON.parse(raw);
      const result = StateJsonSchema.safeParse(parsed);
      return result.success ? result.data : null;
    } catch {
      return null;
    }
  }

  /**
   * Read state.json, validate against Zod schema, and check the dirty flag.
   * Throws with a descriptive message when the file is missing, corrupt, or dirty.
   */
  async loadAndValidate(): Promise<StateJson> {
    let raw: string;
    try {
      raw = await readFile(this.stateFilePath, "utf-8");
    } catch (err) {
      throw new Error(
        `Failed to read state file at ${this.stateFilePath}: ${(err as Error).message}. ` +
          "You may need to re-run auto_dev_init to create a fresh state.",
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new Error(
        `state.json at ${this.stateFilePath} contains invalid JSON: ${(err as Error).message}. ` +
          "Delete the file and re-run auto_dev_init.",
      );
    }

    const result = StateJsonSchema.safeParse(parsed);
    if (!result.success) {
      throw new Error(
        `state.json at ${this.stateFilePath} failed schema validation: ${result.error.message}. ` +
          "Delete the file and re-run auto_dev_init.",
      );
    }

    const validated = result.data;

    if (validated.dirty) {
      throw new Error(
        `state.json at ${this.stateFilePath} is marked dirty — a previous write to progress-log ` +
          "succeeded but the state.json update failed. Review state.json.tmp (if present) and " +
          "progress-log.md, fix the state manually, then remove the dirty flag.",
      );
    }

    this.state = validated;
    return validated;
  }

  /**
   * Rebuild state.json from progress-log.md when state.json is corrupted or missing.
   */
  async rebuildStateFromProgressLog(): Promise<StateJson> {
    const content = await readFile(this.progressLogPath, "utf-8");

    // 1. Parse header
    const startedAt = parseHeaderField(content, "Started") ?? new Date().toISOString();
    const modeStr = parseHeaderField(content, "Mode") ?? "full";
    const mode = (modeStr === "quick" ? "quick" : "full") as "full" | "quick";

    // 2. Parse all CHECKPOINTs to get last phase/status
    const checkpoints = parseAllCheckpoints(content);
    const last = checkpoints[checkpoints.length - 1];
    const phase = last?.phase ?? 1;
    const rawStatus = last?.status ?? "IN_PROGRESS";
    // [P1-5 fix] Validate status against PhaseStatusSchema, fallback to IN_PROGRESS
    const validStatuses = ["IN_PROGRESS", "PASS", "NEEDS_REVISION", "BLOCKED", "COMPLETED", "REGRESS"];
    const status = validStatuses.includes(rawStatus) ? rawStatus : "IN_PROGRESS";

    // 3. Re-detect stack from filesystem
    const stack = await this.detectStack();

    // 4. Assemble StateJson
    const rebuilt: StateJson = {
      topic: this.topic,
      mode,
      phase,
      status: status as StateJson["status"],
      stack,
      outputDir: this.outputDir,
      projectRoot: this.projectRoot,
      startedAt,
      updatedAt: new Date().toISOString(),
    };

    // 5. Write state.json (no dirty flag — this is a fresh rebuild)
    await this.atomicWrite(this.stateFilePath, JSON.stringify(rebuilt, null, 2));
    this.state = rebuilt;
    return rebuilt;
  }

  // -----------------------------------------------------------------------
  // Backup
  // -----------------------------------------------------------------------

  /** Rename existing output dir to {dir}.bak.{timestamp}. Returns the backup path. */
  async backupExistingDir(): Promise<string> {
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const backupPath = `${this.outputDir}.bak.${ts}`;
    try {
      await rename(this.outputDir, backupPath);
    } catch (err) {
      throw new Error(
        `Failed to backup directory ${this.outputDir} to ${backupPath}: ${(err as Error).message}`,
      );
    }
    return backupPath;
  }

  // -----------------------------------------------------------------------
  // Stack detection
  // -----------------------------------------------------------------------

  /** Scan project root for build files and resolve stack info from stacks/*.md. */
  async detectStack(): Promise<StackInfo> {
    // 1. Find the first matching build file
    let matchedStackFile: string | undefined;
    for (const entry of STACK_DETECTION) {
      if (await fileExists(join(this.projectRoot, entry.file))) {
        matchedStackFile = entry.stackFile;
        break;
      }
    }

    if (!matchedStackFile) {
      throw new Error(
        `Could not detect tech stack in ${this.projectRoot}. ` +
          "Expected one of: pom.xml, build.gradle, package.json, pyproject.toml, requirements.txt",
      );
    }

    // 2. Locate the stacks/*.md file
    let stackContent: string | undefined;
    for (const dir of stackSearchPaths()) {
      const candidate = join(dir, matchedStackFile);
      try {
        stackContent = await readFile(candidate, "utf-8");
        break;
      } catch {
        // try next path
      }
    }

    if (stackContent === undefined) {
      throw new Error(
        `Stack definition file ${matchedStackFile} not found in any stacks directory. ` +
          `Searched: ${stackSearchPaths().join(", ")}`,
      );
    }

    // 3. Parse variables
    const vars = parseStackVariables(stackContent);

    const language = vars["language"];
    const buildCmd = vars["build_cmd"];
    const testCmd = vars["test_cmd"];
    const langChecklist = vars["lang_checklist"];

    if (!language || !buildCmd || !testCmd || !langChecklist) {
      throw new Error(
        `Stack file ${matchedStackFile} is missing required variables. ` +
          `Found: ${JSON.stringify(vars)}. ` +
          "Required: language, build_cmd, test_cmd, lang_checklist",
      );
    }

    return { language, buildCmd, testCmd, langChecklist };
  }

  // -----------------------------------------------------------------------
  // Initialisation
  // -----------------------------------------------------------------------

  /** Create the output directory, write initial state.json (atomic) and progress-log header. */
  async init(mode: "full" | "quick" | "turbo", stack: StackInfo, startPhase?: number): Promise<void> {
    await mkdir(this.outputDir, { recursive: true });

    const now = new Date().toISOString();
    const initial: StateJson = {
      topic: this.topic,
      mode,
      phase: startPhase ?? 1,
      status: "IN_PROGRESS",
      stack,
      outputDir: this.outputDir,
      projectRoot: this.projectRoot,
      startedAt: now,
      updatedAt: now,
    };

    await this.atomicWrite(this.stateFilePath, JSON.stringify(initial, null, 2));
    this.state = initial;

    // Create progress-log.md header
    const header =
      `# auto-dev progress-log: ${this.topic}\n\n` +
      `> Started: ${now}  \n` +
      `> Mode: ${mode}  \n` +
      `> Stack: ${stack.language}\n\n`;
    await this.atomicWrite(this.progressLogPath, header);
  }

  // -----------------------------------------------------------------------
  // Atomic write primitives
  // -----------------------------------------------------------------------

  /**
   * Write content to a temporary file, then rename to the target path.
   * POSIX rename is atomic on the same filesystem.
   */
  async atomicWrite(filePath: string, content: string): Promise<void> {
    const tmpPath = `${filePath}.tmp`;
    try {
      await writeFile(tmpPath, content, "utf-8");
    } catch (err) {
      throw new Error(
        `Failed to write temporary file ${tmpPath}: ${(err as Error).message}`,
      );
    }
    try {
      await rename(tmpPath, filePath);
    } catch (err) {
      // Leave .tmp in place for manual recovery
      throw new Error(
        `Atomic rename from ${tmpPath} to ${filePath} failed: ${(err as Error).message}. ` +
          `The temporary file ${tmpPath} has been preserved for recovery.`,
      );
    }
  }

  /**
   * Read current state.json, merge with `updates`, and write back atomically.
   * Also refreshes the in-memory state.
   */
  async atomicUpdate(updates: Record<string, unknown>): Promise<void> {
    const current = await this.loadAndValidate();
    const merged = { ...current, ...updates, updatedAt: new Date().toISOString() };

    // Validate the merged object before persisting
    const result = StateJsonSchema.safeParse(merged);
    if (!result.success) {
      throw new Error(
        `Merged state failed schema validation: ${result.error.message}. ` +
          `Updates: ${JSON.stringify(updates)}`,
      );
    }

    await this.atomicWrite(this.stateFilePath, JSON.stringify(result.data, null, 2));
    this.state = result.data;
  }

  // -----------------------------------------------------------------------
  // State accessor
  // -----------------------------------------------------------------------

  /** Return the in-memory state. Throws if init() or loadAndValidate() has not been called. */
  getFullState(): StateJson {
    if (!this.state) {
      throw new Error(
        "State not loaded. Call init() or loadAndValidate() before getFullState().",
      );
    }
    return this.state;
  }

  // -----------------------------------------------------------------------
  // Checkpoint helpers
  // -----------------------------------------------------------------------

  /** Generate a CHECKPOINT HTML comment line. */
  getCheckpointLine(
    phase: number,
    task: number | undefined,
    status: string,
    summary?: string,
  ): string {
    const ts = new Date().toISOString();
    const taskPart = task !== undefined ? ` task=${task}` : "";
    const summaryPart = summary ? ` summary="${summary}"` : "";
    return `<!-- CHECKPOINT phase=${phase}${taskPart} status=${status}${summaryPart} timestamp=${ts} -->`;
  }

  /**
   * Check whether the last CHECKPOINT in progress-log.md has identical parameters.
   * Used for idempotency: if same → caller should skip the append.
   */
  async isCheckpointDuplicate(
    phase: number,
    task: number | undefined,
    status: string,
    summary?: string,
  ): Promise<boolean> {
    let content: string;
    try {
      content = await readFile(this.progressLogPath, "utf-8");
    } catch {
      return false; // file doesn't exist → not a duplicate
    }

    // Find the last CHECKPOINT line
    const checkpointRegex = /<!-- CHECKPOINT (.+?) -->/g;
    let lastMatch: RegExpExecArray | null = null;
    let m: RegExpExecArray | null;
    while ((m = checkpointRegex.exec(content)) !== null) {
      lastMatch = m;
    }
    if (!lastMatch) return false;

    const attrs = lastMatch[1] ?? "";

    // Parse attributes from the last checkpoint
    const phaseMatch = attrs.match(/phase=(\d+)/);
    const taskMatch = attrs.match(/task=(\d+)/);
    const statusMatch = attrs.match(/status=(\S+)/);
    const summaryMatch = attrs.match(/summary="([^"]*)"/);

    const lastPhase = phaseMatch?.[1] ? parseInt(phaseMatch[1], 10) : null;
    const lastTask = taskMatch?.[1] ? parseInt(taskMatch[1], 10) : undefined;
    const lastStatus = statusMatch?.[1] ?? null;
    const lastSummary = summaryMatch?.[1] ?? undefined;

    return (
      lastPhase === phase &&
      lastTask === task &&
      lastStatus === status &&
      lastSummary === (summary ?? undefined)
    );
  }

  /** Append content to progress-log.md (atomic via write-to-temp-then-rename). */
  async appendToProgressLog(content: string): Promise<void> {
    let existing: string;
    try {
      existing = await readFile(this.progressLogPath, "utf-8");
    } catch (err) {
      throw new Error(
        `Failed to read progress-log at ${this.progressLogPath}: ${(err as Error).message}`,
      );
    }

    await this.atomicWrite(this.progressLogPath, existing + content);
  }
}

// ---------------------------------------------------------------------------
// internalCheckpoint — extracted commit logic from checkpoint handler
// ---------------------------------------------------------------------------

/**
 * Persist checkpoint state: write progress-log, update state.json atomically,
 * compute phase timings, and return the next directive.
 *
 * This function contains ONLY the commit/persistence logic. All pre-validation
 * checks (artifact validation, TDD, predecessor checks) remain in the caller.
 */
export async function internalCheckpoint(
  sm: StateManager,
  state: StateJson,
  phase: number,
  status: string,
  summary?: string,
  task?: number,
  tokenEstimate?: number,
  opts?: {
    regressTo?: number;
  },
): Promise<{
  ok: boolean;
  nextDirective: NextDirective;
  stateUpdates: Record<string, unknown>;
  error?: string;
  message?: string;
}> {
  const regressTo = opts?.regressTo;

  // 1. Prepare state updates (computed in memory, not yet written)
  const stateUpdates: Record<string, unknown> = { phase, status };
  if (task !== undefined) stateUpdates["task"] = task;

  if (status === "NEEDS_REVISION") {
    stateUpdates["iteration"] = (state.iteration ?? 0) + 1;
  } else if (status === "PASS" || status === "COMPLETED") {
    stateUpdates["iteration"] = 0;
  }

  if (status === "REGRESS") {
    const newRegressionCount = (state.regressionCount ?? 0) + 1;
    stateUpdates["regressionCount"] = newRegressionCount;
    stateUpdates["iteration"] = 0;
  }

  // Phase timing
  const timings = { ...(state.phaseTimings ?? {}) };
  const phaseKey = String(phase);
  if (status === "IN_PROGRESS") {
    timings[phaseKey] = { startedAt: new Date().toISOString() };
  } else if (status === "PASS" || status === "BLOCKED" || status === "COMPLETED") {
    const existing = timings[phaseKey];
    if (existing?.startedAt) {
      const now = new Date();
      existing.completedAt = now.toISOString();
      existing.durationMs = now.getTime() - new Date(existing.startedAt).getTime();
    }
  }
  stateUpdates["phaseTimings"] = timings;

  // Token usage
  if (tokenEstimate !== undefined) {
    const usage = { ...(state.tokenUsage ?? { total: 0, byPhase: {} }) };
    usage.total += tokenEstimate;
    const pk = String(phase);
    usage.byPhase = { ...usage.byPhase };
    usage.byPhase[pk] = (usage.byPhase[pk] ?? 0) + tokenEstimate;
    stateUpdates["tokenUsage"] = usage;
  }

  // 2. Write progress-log (first)
  const line = sm.getCheckpointLine(phase, task, status, summary);
  await sm.appendToProgressLog("\n" + line + "\n");

  // 3. Write state.json (second)
  try {
    await sm.atomicUpdate(stateUpdates);
  } catch (err) {
    // progress-log written but state.json failed -> mark dirty
    try {
      const current = JSON.parse(await readFile(sm.stateFilePath, "utf-8"));
      current.dirty = true;
      current.updatedAt = new Date().toISOString();
      await writeFile(sm.stateFilePath, JSON.stringify(current, null, 2), "utf-8");
    } catch {
      // Last resort: state.json.tmp preserved for manual recovery
    }
    // Return a failed result with directive pointing to current phase
    const fallbackDirective = computeNextDirective(phase, "BLOCKED", state);
    return {
      ok: false,
      nextDirective: fallbackDirective,
      stateUpdates,
      error: "STATE_UPDATE_FAILED",
      message: `Progress-log updated but state.json write failed: ${(err as Error).message}. State marked as dirty.`,
    };
  }

  // 4. Post-commit side effects (non-critical, failures don't rollback)
  if (status === "BLOCKED") {
    const blockedContent = `# BLOCKED\n\n**Phase**: ${phase}\n${task !== undefined ? `**Task**: ${task}\n` : ""}**Summary**: ${summary ?? "No summary"}\n**Timestamp**: ${new Date().toISOString()}\n`;
    await sm.atomicWrite(join(sm.outputDir, "BLOCKED.md"), blockedContent);
  }

  // 5. Compute next phase directive
  // [P1-3 fix] Pass updated regressionCount so limit check uses current value
  const stateForDirective = status === "REGRESS"
    ? { ...state, regressionCount: (state.regressionCount ?? 0) + 1 }
    : state;
  const nextDirective = computeNextDirective(phase, status, stateForDirective, regressTo);

  return { ok: true, nextDirective, stateUpdates };
}
