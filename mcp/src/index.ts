/**
 * auto-dev MCP Server — Entry point.
 *
 * Registers all 10 MCP tools and starts the stdio transport.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod/v4";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFile, writeFile, stat } from "node:fs/promises";

import { StateManager } from "./state-manager.js";
import { TemplateRenderer } from "./template-renderer.js";
import { GitManager } from "./git-manager.js";
import type { StateJson } from "./types.js";
import { LessonsManager } from "./lessons-manager.js";
import { computeNextDirective, validateCompletion, validatePhase5Artifacts, validatePhase6Artifacts, countTestFiles } from "./phase-enforcer.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Resolve the plugin root directory (two levels up from mcp/src/). */
function pluginRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
}

/** Default skills directory inside the plugin. */
function defaultSkillsDir(): string {
  return resolve(pluginRoot(), "skills", "auto-dev");
}

function textResult(data: unknown): { content: Array<{ type: "text"; text: string }> } {
  return {
    content: [{ type: "text" as const, text: typeof data === "string" ? data : JSON.stringify(data) }],
  };
}

function buildVariablesFromState(state: StateJson, branch?: string): Record<string, string> {
  return {
    topic: state.topic,
    language: state.stack.language,
    build_cmd: state.stack.buildCmd,
    test_cmd: state.stack.testCmd,
    lang_checklist: state.stack.langChecklist,
    output_dir: state.outputDir,
    project_root: state.projectRoot,
    branch: branch ?? "unknown",
  };
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

const server = new McpServer({
  name: "auto-dev",
  version: "5.0.0",
});

// ===========================================================================
// 1. auto_dev_init
// ===========================================================================

server.tool(
  "auto_dev_init",
  "Initialize auto-dev session: create work dir, detect tech stack, init state. If directory exists, onConflict controls behavior (resume/overwrite).",
  {
    projectRoot: z.string(),
    topic: z.string(),
    mode: z.enum(["full", "quick"]),
    startPhase: z.number().optional(),
    interactive: z.boolean().optional(),
    dryRun: z.boolean().optional(),
    skipE2e: z.boolean().optional(),
    onConflict: z.enum(["resume", "overwrite"]).optional(),
  },
  async ({ projectRoot, topic, mode, startPhase, interactive, dryRun, skipE2e, onConflict }) => {
    const sm = new StateManager(projectRoot, topic);

    // Handle existing directory
    if (await sm.outputDirExists()) {
      if (!onConflict) {
        return textResult({
          error: "OUTPUT_DIR_EXISTS",
          message: `docs/auto-dev/${topic} exists. Use onConflict='resume' or 'overwrite'.`,
        });
      }
      if (onConflict === "resume") {
        const state = await sm.loadAndValidate();

        // Parse progress-log for last Phase 3 task (for task-level resume)
        let resumeTask: number | undefined;
        let resumeTaskStatus: string | undefined;
        try {
          const log = await readFile(sm.progressLogPath, "utf-8");
          const taskRegex = /CHECKPOINT phase=3 task=(\d+) status=(\w+)/g;
          let match;
          while ((match = taskRegex.exec(log)) !== null) {
            resumeTask = parseInt(match[1], 10);
            resumeTaskStatus = match[2];
          }
        } catch { /* no progress log yet */ }

        return textResult({
          projectRoot: state.projectRoot,
          outputDir: sm.outputDir,
          resumed: true,
          topic: state.topic,
          mode: state.mode,
          phase: state.phase,
          status: state.status,
          language: state.stack.language,
          buildCmd: state.stack.buildCmd,
          testCmd: state.stack.testCmd,
          langChecklist: state.stack.langChecklist,
          resumeTask,
          resumeTaskStatus,
        });
      }
      if (onConflict === "overwrite") {
        await sm.backupExistingDir();
      }
    }

    const stack = await sm.detectStack();
    const gitManager = new GitManager(projectRoot);
    const git = await gitManager.getStatus();
    const startCommit = await gitManager.getHeadCommit();
    await sm.init(mode, stack, startPhase);

    // Persist behavior flags and startCommit to state
    const behaviorUpdates: Record<string, unknown> = { startCommit };
    if (interactive) behaviorUpdates["interactive"] = true;
    if (dryRun) behaviorUpdates["dryRun"] = true;
    if (skipE2e) behaviorUpdates["skipE2e"] = true;
    await sm.atomicUpdate(behaviorUpdates);

    const state = sm.getFullState();
    return textResult({
      projectRoot: state.projectRoot,
      outputDir: sm.outputDir,
      resumed: false,
      topic: state.topic,
      mode: state.mode,
      language: stack.language,
      buildCmd: stack.buildCmd,
      testCmd: stack.testCmd,
      langChecklist: stack.langChecklist,
      branch: git.currentBranch,
      dirty: git.isDirty,
    });
  },
);

// ===========================================================================
// 2. auto_dev_state_get
// ===========================================================================

server.tool(
  "auto_dev_state_get",
  "Read current auto-dev state with schema validation. Reports dirty/corrupted state clearly.",
  {
    projectRoot: z.string(),
    topic: z.string(),
  },
  async ({ projectRoot, topic }) => {
    const sm = new StateManager(projectRoot, topic);
    const state = await sm.loadAndValidate();
    return textResult(state);
  },
);

// ===========================================================================
// 3. auto_dev_state_update
// ===========================================================================

server.tool(
  "auto_dev_state_update",
  "Update auxiliary state fields (task, iteration, flags). Phase/status changes MUST go through auto_dev_checkpoint.",
  {
    projectRoot: z.string(),
    topic: z.string(),
    updates: z.object({
      task: z.number().optional(),
      iteration: z.number().optional(),
      dirty: z.boolean().optional(),
      interactive: z.boolean().optional(),
      dryRun: z.boolean().optional(),
    }),
  },
  async ({ projectRoot, topic, updates }) => {
    const sm = new StateManager(projectRoot, topic);
    await sm.atomicUpdate(updates);
    return textResult({ ok: true, updated: Object.keys(updates) });
  },
);

// ===========================================================================
// 4. auto_dev_checkpoint
// ===========================================================================

server.tool(
  "auto_dev_checkpoint",
  "Write structured checkpoint to progress-log and update state.json. Idempotent: same params won't duplicate entries. Atomic: uses write-to-temp-then-rename.",
  {
    projectRoot: z.string(),
    topic: z.string(),
    phase: z.number(),
    task: z.number().optional(),
    status: z.enum(["IN_PROGRESS", "PASS", "NEEDS_REVISION", "BLOCKED", "COMPLETED"]),
    summary: z.string().optional(),
    tokenEstimate: z.number().optional(),
  },
  async ({ projectRoot, topic, phase, task, status, summary, tokenEstimate }) => {
    const sm = new StateManager(projectRoot, topic);
    const state = await sm.loadAndValidate();

    // Idempotency check
    if (await sm.isCheckpointDuplicate(phase, task, status, summary)) {
      return textResult({ idempotent: true, message: "Checkpoint already exists with same params, skipped." });
    }

    // 1. Append to progress-log (first, per design: progress-log before state.json)
    const line = sm.getCheckpointLine(phase, task, status, summary);
    await sm.appendToProgressLog("\n" + line + "\n");

    // 2. Update state.json atomically
    const stateUpdates: Record<string, unknown> = { phase, status };
    if (task !== undefined) stateUpdates["task"] = task;

    // Phase timing tracking
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

    // Token usage tracking
    if (tokenEstimate !== undefined) {
      const usage = { ...(state.tokenUsage ?? { total: 0, byPhase: {} }) };
      usage.total += tokenEstimate;
      const pk = String(phase);
      usage.byPhase = { ...usage.byPhase };
      usage.byPhase[pk] = (usage.byPhase[pk] ?? 0) + tokenEstimate;
      stateUpdates["tokenUsage"] = usage;
    }

    try {
      await sm.atomicUpdate(stateUpdates);
    } catch (err) {
      // progress-log written but state.json failed → mark dirty
      // Direct write to mark dirty — do not go through atomicUpdate
      try {
        const current = JSON.parse(await readFile(sm.stateFilePath, "utf-8"));
        current.dirty = true;
        current.updatedAt = new Date().toISOString();
        await writeFile(sm.stateFilePath, JSON.stringify(current, null, 2), "utf-8");
      } catch {
        // Last resort: state.json.tmp preserved for manual recovery
      }
      return textResult({
        error: "STATE_UPDATE_FAILED",
        message: `Progress-log updated but state.json write failed: ${(err as Error).message}. State marked as dirty.`,
      });
    }

    // 3. Create BLOCKED.md if status is BLOCKED
    if (status === "BLOCKED") {
      const blockedContent = `# BLOCKED\n\n**Phase**: ${phase}\n${task !== undefined ? `**Task**: ${task}\n` : ""}**Summary**: ${summary ?? "No summary"}\n**Timestamp**: ${new Date().toISOString()}\n`;
      await sm.atomicWrite(join(sm.outputDir, "BLOCKED.md"), blockedContent);
    }

    // 4. Phase 5/6 artifact validation — prevent skipping tests or acceptance
    if (phase === 5 && status === "PASS" && state.skipE2e !== true) {
      // Check for new test files via git
      let testFileCount = 0;
      try {
        const git = new GitManager(projectRoot);
        const progressLog = await readFile(join(sm.outputDir, "progress-log.md"), "utf-8").catch(() => "");
        // Extract Phase 3 start commit from progress-log (first Phase 3 checkpoint)
        const phase3Match = /CHECKPOINT phase=3.*?timestamp=/g.exec(progressLog);
        // Use git diff to find new files since init
        const { execFile: execFileAsync } = await import("node:child_process");
        const diffOutput = await new Promise<string>((resolve, reject) => {
          const baseCommit = state.startCommit ?? "HEAD~20";
          execFileAsync("git", ["diff", "--name-only", "--diff-filter=A", baseCommit, "HEAD"], { cwd: projectRoot }, (err, stdout) => {
            if (err) resolve("");
            else resolve(stdout);
          });
        });
        const newFiles = diffOutput.trim().split("\n").filter(f => f.length > 0);
        testFileCount = countTestFiles(newFiles);
      } catch { /* ignore git errors */ }

      let resultsContent: string | null = null;
      try {
        resultsContent = await readFile(join(sm.outputDir, "e2e-test-results.md"), "utf-8");
      } catch { /* file doesn't exist */ }

      const phase5Validation = await validatePhase5Artifacts(sm.outputDir, testFileCount, resultsContent);
      if (!phase5Validation.valid) {
        return textResult({
          error: "PHASE5_ARTIFACTS_MISSING",
          ...phase5Validation,
        });
      }
    }

    if (phase === 6 && status === "PASS") {
      let reportContent: string | null = null;
      try {
        reportContent = await readFile(join(sm.outputDir, "acceptance-report.md"), "utf-8");
      } catch { /* file doesn't exist */ }

      const phase6Validation = validatePhase6Artifacts(reportContent);
      if (!phase6Validation.valid) {
        return textResult({
          error: "PHASE6_ARTIFACTS_MISSING",
          ...phase6Validation,
        });
      }
    }

    // 5. Compute next phase directive — forces Claude to continue to next phase
    const nextDirective = computeNextDirective(phase, status, state);

    return textResult({ ok: true, ...nextDirective });
  },
);

// ===========================================================================
// 5. auto_dev_render
// ===========================================================================

server.tool(
  "auto_dev_render",
  "Render a prompt template with variable substitution and checklist injection.",
  {
    promptFile: z.string(),
    variables: z.record(z.string(), z.string()),
    extraContext: z.string().optional(),
    skillsDir: z.string().optional(),
  },
  async ({ promptFile, variables, extraContext, skillsDir }) => {
    const renderer = new TemplateRenderer(skillsDir ?? defaultSkillsDir());
    const result = await renderer.render(promptFile, variables, extraContext);
    return textResult(result);
  },
);

// ===========================================================================
// 6. auto_dev_preflight
// ===========================================================================

server.tool(
  "auto_dev_preflight",
  "Pre-flight check: verify prerequisites for a phase (required files exist, git is clean, etc.).",
  {
    projectRoot: z.string(),
    topic: z.string(),
    phase: z.number(),
  },
  async ({ projectRoot, topic, phase }) => {
    const sm = new StateManager(projectRoot, topic);

    const checks: Array<{ name: string; passed: boolean; message?: string }> = [];

    // Common checks
    const gitManager = new GitManager(projectRoot);
    try {
      const gitInfo = await gitManager.getStatus();
      checks.push({ name: "git_status", passed: true, message: `Branch: ${gitInfo.currentBranch}` });
    } catch {
      checks.push({ name: "git_status", passed: false, message: "Not a git repository or git error" });
    }

    const outputExists = await sm.outputDirExists();
    checks.push({
      name: "progress_log_writable",
      passed: outputExists,
      message: outputExists ? "Output dir exists" : "Output dir missing — run auto_dev_init first",
    });

    // Phase-specific checks
    const outputDir = sm.outputDir;
    const fileCheck = async (name: string, filePath: string): Promise<void> => {
      try {
        await stat(filePath);
        checks.push({ name, passed: true });
      } catch {
        checks.push({ name, passed: false, message: `Required file missing: ${filePath}` });
      }
    };

    if (phase >= 2) await fileCheck("design_md", join(outputDir, "design.md"));
    if (phase >= 3) await fileCheck("plan_md", join(outputDir, "plan.md"));
    if (phase >= 5) await fileCheck("code_review_md", join(outputDir, "code-review.md"));
    if (phase >= 6) await fileCheck("e2e_test_results_md", join(outputDir, "e2e-test-results.md"));

    const ready = checks.every((c) => c.passed);
    const result: Record<string, unknown> = { ready, checks };

    // Auto-render suggested prompt when ready
    if (ready) {
      const phasePromptMap: Record<number, { promptFile: string; agent: string }> = {
        1: { promptFile: "phase1-architect", agent: "auto-dev-architect" },
        2: { promptFile: "phase2-planner", agent: "auto-dev-architect" },
        3: { promptFile: "phase3-developer", agent: "auto-dev-developer" },
        4: { promptFile: "phase4-full-reviewer", agent: "auto-dev-reviewer" },
        5: { promptFile: "phase5-test-architect", agent: "auto-dev-test-architect" },
        6: { promptFile: "phase6-acceptance", agent: "auto-dev-acceptance-validator" },
      };
      const mapping = phasePromptMap[phase];
      if (mapping) {
        try {
          const state = await sm.loadAndValidate();
          const gitInfo = await new GitManager(projectRoot).getStatus();
          const variables = buildVariablesFromState(state, gitInfo.currentBranch);
          const renderer = new TemplateRenderer(defaultSkillsDir());
          const rendered = await renderer.render(mapping.promptFile, variables);
          result.suggestedPrompt = rendered.renderedPrompt;
          result.suggestedAgent = mapping.agent;
        } catch { /* prompt file not found or render error, skip */ }
      }
    }

    return textResult(result);
  },
);

// ===========================================================================
// 7. auto_dev_diff_check
// ===========================================================================

server.tool(
  "auto_dev_diff_check",
  "Compare expected files from plan vs actual git changes, report discrepancies.",
  {
    projectRoot: z.string(),
    expectedFiles: z.array(z.string()),
    baseCommit: z.string(),
  },
  async ({ projectRoot, expectedFiles, baseCommit }) => {
    const git = new GitManager(projectRoot);
    const result = await git.diffCheck(expectedFiles, baseCommit);
    return textResult(result);
  },
);

// ===========================================================================
// 8. auto_dev_git_rollback
// ===========================================================================

server.tool(
  "auto_dev_git_rollback",
  "Rollback changes for a specific task using git diff --name-only for precise file-level rollback.",
  {
    projectRoot: z.string(),
    baseCommit: z.string(),
    files: z.array(z.string()).optional(),
  },
  async ({ projectRoot, baseCommit, files }) => {
    const git = new GitManager(projectRoot);
    const result = await git.rollback(baseCommit, files);
    return textResult(result);
  },
);

// ===========================================================================
// 9. auto_dev_lessons_add
// ===========================================================================

server.tool(
  "auto_dev_lessons_add",
  "Record a lesson learned from the current auto-dev session.",
  {
    projectRoot: z.string(),
    topic: z.string(),
    phase: z.number(),
    category: z.string(),
    lesson: z.string(),
    context: z.string().optional(),
  },
  async ({ projectRoot, topic, phase, category, lesson, context }) => {
    const sm = new StateManager(projectRoot, topic);
    const lessons = new LessonsManager(sm.outputDir);
    await lessons.add(phase, category, lesson, context);
    return textResult({ success: true, message: "Lesson recorded." });
  },
);

// ===========================================================================
// 10. auto_dev_lessons_get
// ===========================================================================

server.tool(
  "auto_dev_lessons_get",
  "Get historical lessons for a specific phase to inject into prompts.",
  {
    projectRoot: z.string(),
    topic: z.string(),
    phase: z.number().optional(),
    category: z.string().optional(),
  },
  async ({ projectRoot, topic, phase, category }) => {
    const sm = new StateManager(projectRoot, topic);
    const lessons = new LessonsManager(sm.outputDir);
    const entries = await lessons.get(phase, category);
    return textResult(entries);
  },
);


// ===========================================================================
// 11. auto_dev_complete (Phase Completion Gate)
// ===========================================================================

server.tool(
  "auto_dev_complete",
  "Completion gate: validates ALL required phases have PASS status before allowing the session to be declared complete. MUST be called before telling the user that auto-dev is finished. Will REJECT if any phase was skipped.",
  {
    projectRoot: z.string(),
    topic: z.string(),
  },
  async ({ projectRoot, topic }) => {
    const sm = new StateManager(projectRoot, topic);
    const state = await sm.loadAndValidate();

    // Read progress-log to find all passed phases
    const progressLogPath = join(sm.outputDir, "progress-log.md");
    let progressLogContent = "";
    try {
      progressLogContent = await readFile(progressLogPath, "utf-8");
    } catch {
      return textResult({
        error: "PROGRESS_LOG_MISSING",
        message: "progress-log.md not found. Cannot validate completion.",
        canComplete: false,
      });
    }

    const validation = validateCompletion(
      progressLogContent,
      state.mode,
      state.dryRun === true,
      state.skipE2e === true,
    );

    if (!validation.canComplete) {
      return textResult({
        error: "INCOMPLETE",
        canComplete: false,
        passedPhases: validation.passedPhases,
        missingPhases: validation.missingPhases,
        message: validation.message,
        mandate: "[BLOCKED] " + validation.message + " 禁止向用户宣称任务完成。",
      });
    }

    // All phases passed — mark as COMPLETED
    const completeLine = sm.getCheckpointLine(
      state.phase, undefined, "COMPLETED",
      "All required phases passed. Session complete."
    );
    await sm.appendToProgressLog("\n" + completeLine + "\n");
    await sm.atomicUpdate({ status: "COMPLETED" });

    // Timing summary
    const timingSummary = Object.entries(state.phaseTimings ?? {}).map(([p, t]) => ({
      phase: parseInt(p),
      durationMs: t.durationMs,
      durationStr: t.durationMs ? formatDuration(t.durationMs) : "unknown",
    }));

    return textResult({
      canComplete: true,
      passedPhases: validation.passedPhases,
      message: validation.message,
      status: "COMPLETED",
      timingSummary,
      tokenUsage: state.tokenUsage ?? { total: 0, byPhase: {} },
    });
  },
);

// ===========================================================================
// Start server
// ===========================================================================

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("auto-dev MCP Server failed to start:", err);
  process.exit(1);
});
