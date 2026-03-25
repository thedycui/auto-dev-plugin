/**
 * auto-dev MCP Server — Entry point.
 *
 * Registers all 11 MCP tools and starts the stdio transport.
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
import { computeNextDirective, validateCompletion, validatePhase5Artifacts, validatePhase6Artifacts, countTestFiles, checkIterationLimit } from "./phase-enforcer.js";
import { extractDocSummary, extractTaskList } from "./state-manager.js";
import { runRetrospective } from "./retrospective.js";

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
    tdd: z.boolean().optional(),
    brainstorm: z.boolean().optional(),
    onConflict: z.enum(["resume", "overwrite"]).optional(),
  },
  async ({ projectRoot, topic, mode, startPhase, interactive, dryRun, skipE2e, tdd, brainstorm, onConflict }) => {
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
        let state: StateJson;
        try {
          state = await sm.loadAndValidate();
        } catch (err) {
          const errMsg = (err as Error).message;
          if (errMsg.includes("dirty")) {
            // Try clearing dirty flag then re-validate
            try {
              const raw = JSON.parse(await readFile(sm.stateFilePath, "utf-8"));
              raw.dirty = false;
              raw.updatedAt = new Date().toISOString();
              await sm.atomicWrite(sm.stateFilePath, JSON.stringify(raw, null, 2));
              state = await sm.loadAndValidate();
            } catch {
              // dirty fix also failed — degrade to rebuild
              state = await sm.rebuildStateFromProgressLog();
            }
          } else {
            // state.json corrupted/missing — rebuild from progress-log
            state = await sm.rebuildStateFromProgressLog();
          }
        }

        // Parse progress-log for last Phase 3 task (for task-level resume)
        let resumeTask: number | undefined;
        let resumeTaskStatus: string | undefined;
        try {
          const log = await readFile(sm.progressLogPath, "utf-8");
          const taskRegex = /CHECKPOINT phase=3 task=(\d+) status=(\w+)/g;
          let match;
          while ((match = taskRegex.exec(log)) !== null) {
            resumeTask = parseInt(match[1]!, 10);
            resumeTaskStatus = match[2]!;
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

    // Create a lightweight git tag as rollback anchor (best-effort, non-blocking)
    try {
      const { execFile: execFileSync } = await import("node:child_process");
      await new Promise<void>((resolve) => {
        const tagName = `auto-dev/${topic}/start`;
        // Force-create tag in case a previous session left one
        execFileSync("git", ["tag", "-f", tagName], { cwd: projectRoot }, () => resolve());
      });
    } catch { /* git tag failed — non-fatal, continue */ }

    // Persist behavior flags and startCommit to state
    const behaviorUpdates: Record<string, unknown> = { startCommit };
    if (interactive) behaviorUpdates["interactive"] = true;
    if (dryRun) behaviorUpdates["dryRun"] = true;
    if (skipE2e) behaviorUpdates["skipE2e"] = true;
    behaviorUpdates["tdd"] = tdd !== false;  // TDD on by default, --no-tdd to disable
    if (brainstorm) behaviorUpdates["brainstorm"] = true;
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
    status: z.enum(["IN_PROGRESS", "PASS", "NEEDS_REVISION", "BLOCKED", "COMPLETED", "REGRESS"]),
    summary: z.string().optional(),
    tokenEstimate: z.number().optional(),
    regressTo: z.number().int().min(1).max(5).optional(),
  },
  async ({ projectRoot, topic, phase, task, status: rawStatus, summary: rawSummary, tokenEstimate, regressTo }) => {
    let status: string = rawStatus;
    let summary: string | undefined = rawSummary;
    const sm = new StateManager(projectRoot, topic);
    const state = await sm.loadAndValidate();

    // Idempotency check
    if (await sm.isCheckpointDuplicate(phase, task, status, summary)) {
      return textResult({ idempotent: true, message: "Checkpoint already exists with same params, skipped." });
    }

    // [P0-1 fix] REGRESS validation BEFORE any state mutation
    if (status === "REGRESS") {
      if (!regressTo) {
        return textResult({ error: "REGRESS requires regressTo parameter" });
      }
      if (regressTo >= phase) {
        return textResult({ error: `regressTo(${regressTo}) must be < current phase(${phase})` });
      }
      // Regression limit check consolidated in computeNextDirective (phase-enforcer.ts)
      // Only pre-check regressTo validity here, not count
    }

    // Iteration limit check for NEEDS_REVISION
    if (status === "NEEDS_REVISION") {
      const newIteration = (state.iteration ?? 0) + 1;
      const iterCheck = checkIterationLimit(phase, newIteration, state.interactive ?? false);

      if (iterCheck.action === "BLOCK") {
        // [P1-2 fix] Persist iteration even on BLOCK so it's sticky
        await sm.atomicUpdate({ iteration: newIteration });
        // Record lesson so future phases can learn from this
        const lessons = new LessonsManager(sm.outputDir);
        await lessons.add(phase, "iteration-limit", iterCheck.message);
        return textResult({
          status: "BLOCKED",
          message: iterCheck.message,
          mandate: `[BLOCKED] ${iterCheck.message} 请用户决定是否继续。`,
        });
      }
    }

    // 1. Append to progress-log (first, per design: progress-log before state.json)
    const line = sm.getCheckpointLine(phase, task, status, summary);
    await sm.appendToProgressLog("\n" + line + "\n");

    // 2. Update state.json atomically
    const stateUpdates: Record<string, unknown> = { phase, status };
    if (task !== undefined) stateUpdates["task"] = task;

    // Iteration tracking for NEEDS_REVISION (after potential FORCE_PASS override)
    if (status === "NEEDS_REVISION") {
      stateUpdates["iteration"] = (state.iteration ?? 0) + 1;
    } else if (status === "PASS" || status === "COMPLETED") {
      stateUpdates["iteration"] = 0;
    }

    // REGRESS state updates (validation already done above)
    if (status === "REGRESS") {
      const newRegressionCount = (state.regressionCount ?? 0) + 1;
      stateUpdates["regressionCount"] = newRegressionCount;
      stateUpdates["iteration"] = 0;
    }

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

    // 3.8 TDD Iron Law verification — check commit history for RED-GREEN pattern
    if (phase === 3 && status === "PASS" && state.tdd === true) {
      try {
        const { execFile: execFileTdd } = await import("node:child_process");
        const taskStartCommit = state.startCommit ?? "HEAD~20";
        const commitLog = await new Promise<string>((resolve) => {
          execFileTdd("git", ["log", "--oneline", taskStartCommit + "..HEAD"], { cwd: projectRoot }, (err, stdout) => {
            resolve(err ? "" : (stdout || ""));
          });
        });
        // Check for RED commits (test-first pattern)
        const hasRedCommit = /RED|red|failing test|add.*test/i.test(commitLog);
        const hasGreenCommit = /GREEN|green|implement|pass/i.test(commitLog);
        if (!hasRedCommit && commitLog.trim().length > 0) {
          // TDD violation: implementation without RED commit
          const warnings = state.tddWarnings ?? [];
          warnings.push(`Task ${task ?? "?"}: no RED commit found in history. TDD Iron Law may have been violated.`);
          await sm.atomicUpdate({ tddWarnings: warnings });
        }
      } catch { /* git log failed, skip TDD check */ }
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
          // --diff-filter=AM: committed/staged test files
          execFileAsync("git", ["diff", "--name-only", "--diff-filter=AM", baseCommit, "HEAD"], { cwd: projectRoot }, (err, stdout) => {
            if (err) resolve("");
            else {
              // Also check untracked files (developer may not have git-added yet)
              execFileAsync("git", ["ls-files", "--others", "--exclude-standard"], { cwd: projectRoot }, (err2, stdout2) => {
                const committed = stdout || "";
                const untracked = err2 ? "" : (stdout2 || "");
                resolve(committed + "\n" + untracked);
              });
            }
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
    // [P1-3 fix] Pass updated regressionCount so limit check uses current value
    const stateForDirective = status === "REGRESS"
      ? { ...state, regressionCount: (state.regressionCount ?? 0) + 1 }
      : state;
    const nextDirective = computeNextDirective(phase, status, stateForDirective, regressTo);

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
    if (phase >= 3) {
      await fileCheck("plan_md", join(outputDir, "plan.md"));
      // Validate plan contains at least one task marker
      try {
        const planContent = await readFile(join(outputDir, "plan.md"), "utf-8");
        if (!/##\s*Task\s+\d|###\s*Task\s+\d|\d+\./m.test(planContent)) {
          checks.push({ name: "plan_has_tasks", passed: false, message: "plan.md does not contain recognizable task markers (## Task N or numbered list)" });
        } else {
          checks.push({ name: "plan_has_tasks", passed: true, message: "plan.md contains task markers" });
        }
      } catch { /* already checked file exists above */ }
    }
    if (phase >= 5) await fileCheck("code_review_md", join(outputDir, "code-review.md"));
    if (phase >= 6) await fileCheck("e2e_test_results_md", join(outputDir, "e2e-test-results.md"));

    const ready = checks.every((c) => c.passed);
    const result: Record<string, unknown> = { ready, checks };

    // Auto-render suggested prompt when ready
    if (ready) {
      const phasePromptMap: Record<number, { promptFile: string; agent: string }> = {
        0: { promptFile: "phase0-brainstorm", agent: "auto-dev-architect" },
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

          // Build extraContext: lessons + design summary + plan tasks
          let extraContext = "";

          // 1. Inject lessons learned (all phases — avoid repeating past mistakes)
          try {
            const lessonsManager = new LessonsManager(sm.outputDir, projectRoot);
            const lessons = await lessonsManager.get(phase);
            if (lessons.length > 0) {
              extraContext += `## 历史教训（自动注入，请在本次执行中避免重蹈覆辙）\n\n`;
              for (const l of lessons) {
                extraContext += `- [${l.category}] ${l.lesson}\n`;
              }
              extraContext += "\n";
            }
          } catch { /* lessons file not found, skip */ }

          // 1b. Inject global lessons (cross-topic reusable experience)
          try {
            const globalLessons = await new LessonsManager(sm.outputDir, projectRoot).getGlobalLessons(10);
            if (globalLessons.length > 0) {
              extraContext += `## 全局经验（跨项目积累，自动注入）\n\n`;
              for (const l of globalLessons) {
                extraContext += `- [${l.category}${l.severity ? `/${l.severity}` : ""}] ${l.lesson}${l.topic ? ` (来自: ${l.topic})` : ""}\n`;
              }
              extraContext += "\n";
            }
          } catch { /* global lessons not found, skip */ }

          // 1c. Inject Phase 3 task-level resume info
          if (phase === 3 && state.task && state.task > 0) {
            extraContext += `## 任务恢复信息（自动注入）\n\n`;
            extraContext += `上次 session 执行到 Task ${state.task}。请从 Task ${state.task + 1} 开始继续，跳过已完成的 Task 1-${state.task}。\n\n`;
          }

          // 1d. Inject brainstorm notes into Phase 1 (if Phase 0 was run)
          if (phase === 1) {
            try {
              const brainstormNotes = await readFile(join(outputDir, "brainstorm-notes.md"), "utf-8");
              extraContext += `## Brainstorm 结论（Phase 0 产出，自动注入）\n\n${brainstormNotes.slice(0, 2000)}\n\n`;
            } catch { /* no brainstorm notes, skip */ }
          }

          // 1d. Inject TDD flag into Phase 3
          if (phase === 3 && state.tdd) {
            extraContext += `## TDD 模式已启用\n\ntdd_mode = "enabled"\n请严格遵循 RED-GREEN-REFACTOR 循环。\n\n`;
          }

          // 2. Inject design summary and plan task list for Phase 3+
          if (phase >= 3) {
            try {
              const designContent = await readFile(join(outputDir, "design.md"), "utf-8");
              const designSummary = extractDocSummary(designContent, 80);
              extraContext += `## 设计摘要（自动注入）\n\n${designSummary}\n\n`;
            } catch { /* design.md not found, skip */ }

            if (phase === 3) {
              try {
                const planContent = await readFile(join(outputDir, "plan.md"), "utf-8");
                const taskList = extractTaskList(planContent);
                extraContext += `## 任务列表（自动注入）\n\n${taskList}\n\n`;
              } catch { /* plan.md not found, skip */ }
            }
          }

          const rendered = await renderer.render(mapping.promptFile, variables, extraContext || undefined);
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
    severity: z.string().optional(),
    reusable: z.boolean().optional(),
  },
  async ({ projectRoot, topic, phase, category, lesson, context, severity, reusable }) => {
    const sm = new StateManager(projectRoot, topic);
    const lessons = new LessonsManager(sm.outputDir);
    await lessons.add(phase, category, lesson, context, { severity, topic, reusable });
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

    // === Verification gate: run actual build + test ===
    const buildCmd = state.stack?.buildCmd;
    const testCmd = state.stack?.testCmd;
    if (buildCmd) {
      try {
        const { execFile } = await import("node:child_process");
        const buildResult = await new Promise<{ success: boolean; stderr: string }>((resolve) => {
          execFile("sh", ["-c", buildCmd], { cwd: projectRoot, timeout: 120_000 }, (err, _stdout, stderr) => {
            resolve({ success: !err, stderr: stderr?.slice(0, 500) ?? "" });
          });
        });
        if (!buildResult.success) {
          return textResult({
            error: "BUILD_FAILED_AT_COMPLETION",
            canComplete: false,
            message: `所有 Phase 已 PASS，但最终构建失败。请修复后重新调用 auto_dev_complete。\n${buildResult.stderr}`,
            mandate: "[BLOCKED] 构建失败，禁止宣称完成。",
          });
        }
      } catch { /* build command execution failed — non-fatal, continue */ }
    }
    if (testCmd) {
      try {
        const { execFile } = await import("node:child_process");
        const testResult = await new Promise<{ success: boolean; stderr: string }>((resolve) => {
          execFile("sh", ["-c", testCmd], { cwd: projectRoot, timeout: 300_000 }, (err, _stdout, stderr) => {
            resolve({ success: !err, stderr: stderr?.slice(0, 500) ?? "" });
          });
        });
        if (!testResult.success) {
          return textResult({
            error: "TESTS_FAILED_AT_COMPLETION",
            canComplete: false,
            message: `所有 Phase 已 PASS，但最终测试失败。请修复后重新调用 auto_dev_complete。\n${testResult.stderr}`,
            mandate: "[BLOCKED] 测试失败，禁止宣称完成。",
          });
        }
      } catch { /* test command execution failed — non-fatal, continue */ }
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

    const tokenUsage = state.tokenUsage ?? { total: 0, byPhase: {} };

    // Generate summary.md
    try {
      const PHASE_NAMES: Record<string, string> = {
        "0": "BRAINSTORM", "1": "DESIGN", "2": "PLAN", "3": "EXECUTE", "4": "VERIFY", "5": "E2E_TEST", "6": "ACCEPTANCE",
      };
      const timingRows = timingSummary
        .map(t => `| Phase ${t.phase} (${PHASE_NAMES[String(t.phase)] ?? "?"}) | ${t.durationStr} |`)
        .join("\n");
      const tokenRows = Object.entries(tokenUsage.byPhase)
        .map(([p, tok]) => `| Phase ${p} | ~${tok.toLocaleString()} |`)
        .join("\n");

      const summaryContent =
        `# auto-dev 完成摘要\n\n` +
        `**Topic**: ${state.topic}  \n` +
        `**Mode**: ${state.mode}${state.skipE2e ? " (skip-e2e)" : ""}  \n` +
        `**Started**: ${state.startedAt}  \n` +
        `**Completed**: ${new Date().toISOString()}  \n\n` +
        `## Phase 耗时\n\n` +
        `| Phase | 耗时 |\n|-------|------|\n${timingRows || "| — | — |"}\n\n` +
        `## Token 消耗（估算）\n\n` +
        `| Phase | Token |\n|-------|-------|\n${tokenRows || "| — | — |"}\n` +
        `| **合计** | **~${tokenUsage.total.toLocaleString()}** |\n\n` +
        `## 关键产出文件\n\n` +
        `- \`design.md\` — 架构设计\n` +
        `- \`plan.md\` — 实施计划\n` +
        `- \`code-review.md\` — 代码审查报告\n` +
        (state.skipE2e ? "" : `- \`e2e-test-results.md\` — E2E 测试结果\n`) +
        `- \`acceptance-report.md\` — 验收报告\n` +
        `- \`progress-log.md\` — 完整执行日志\n\n` +
        `> 如需回滚至 init 状态：\`git reset --hard auto-dev/${state.topic}/start\`\n`;

      await sm.atomicWrite(join(sm.outputDir, "summary.md"), summaryContent);
    } catch { /* summary.md generation failed — non-fatal */ }

    // Phase 7: RETROSPECTIVE — auto-extract lessons for self-evolution
    let retrospectiveResult: { lessonsExtracted: number; globalPromoted: number; retrospectivePath: string } | null = null;
    try {
      retrospectiveResult = await runRetrospective(state, sm.outputDir, projectRoot);
    } catch (e) {
      // Retrospective failed — non-fatal, log but don't block completion
    }

    return textResult({
      canComplete: true,
      passedPhases: validation.passedPhases,
      message: validation.message,
      status: "COMPLETED",
      timingSummary,
      tokenUsage,
      retrospective: retrospectiveResult,
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
