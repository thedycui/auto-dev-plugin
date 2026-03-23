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
import { LessonsManager } from "./lessons-manager.js";
import { computeNextDirective, validateCompletion, validatePhase5Artifacts, validatePhase6Artifacts, countTestFiles } from "./phase-enforcer.js";
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
/** Resolve the plugin root directory (two levels up from mcp/src/). */
function pluginRoot() {
    return resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
}
/** Default skills directory inside the plugin. */
function defaultSkillsDir() {
    return resolve(pluginRoot(), "skills", "auto-dev");
}
function textResult(data) {
    return {
        content: [{ type: "text", text: typeof data === "string" ? data : JSON.stringify(data) }],
    };
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
server.tool("auto_dev_init", "Initialize auto-dev session: create work dir, detect tech stack, init state. If directory exists, onConflict controls behavior (resume/overwrite).", {
    projectRoot: z.string(),
    topic: z.string(),
    mode: z.enum(["full", "quick"]),
    startPhase: z.number().optional(),
    interactive: z.boolean().optional(),
    dryRun: z.boolean().optional(),
    onConflict: z.enum(["resume", "overwrite"]).optional(),
}, async ({ projectRoot, topic, mode, startPhase, interactive, dryRun, onConflict }) => {
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
            });
        }
        if (onConflict === "overwrite") {
            await sm.backupExistingDir();
        }
    }
    const stack = await sm.detectStack();
    const git = await new GitManager(projectRoot).getStatus();
    await sm.init(mode, stack, startPhase);
    // Persist behavior flags to state
    const behaviorUpdates = {};
    if (interactive)
        behaviorUpdates["interactive"] = true;
    if (dryRun)
        behaviorUpdates["dryRun"] = true;
    if (Object.keys(behaviorUpdates).length > 0) {
        await sm.atomicUpdate(behaviorUpdates);
    }
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
});
// ===========================================================================
// 2. auto_dev_state_get
// ===========================================================================
server.tool("auto_dev_state_get", "Read current auto-dev state with schema validation. Reports dirty/corrupted state clearly.", {
    projectRoot: z.string(),
    topic: z.string(),
}, async ({ projectRoot, topic }) => {
    const sm = new StateManager(projectRoot, topic);
    const state = await sm.loadAndValidate();
    return textResult(state);
});
// ===========================================================================
// 3. auto_dev_state_update
// ===========================================================================
server.tool("auto_dev_state_update", "Update state fields (phase, task, iteration, etc.) with atomic write.", {
    projectRoot: z.string(),
    topic: z.string(),
    updates: z.object({
        phase: z.number().optional(),
        task: z.number().optional(),
        iteration: z.number().optional(),
        status: z.enum(["IN_PROGRESS", "PASS", "NEEDS_REVISION", "BLOCKED", "COMPLETED"]).optional(),
        dirty: z.boolean().optional(),
        interactive: z.boolean().optional(),
        dryRun: z.boolean().optional(),
    }),
}, async ({ projectRoot, topic, updates }) => {
    const sm = new StateManager(projectRoot, topic);
    const current = await sm.loadAndValidate();
    const warnings = [];
    // Guard 1: 禁止跳过 phase（允许回退，允许同 phase 更新）
    if (updates.phase !== undefined && updates.phase > current.phase + 1) {
        return textResult({
            ok: false,
            error: "INVALID_TRANSITION",
            message: `不能从 phase ${current.phase} 跳到 phase ${updates.phase}，最多前进一步。`,
            current: { phase: current.phase, status: current.status },
            requested: { phase: updates.phase },
        });
    }
    // Guard 2: Phase 前进时当前 phase 必须是 PASS
    if (updates.phase !== undefined && updates.phase > current.phase && current.status !== "PASS") {
        return textResult({
            ok: false,
            error: "INVALID_TRANSITION",
            message: `当前 phase ${current.phase} status=${current.status}，未通过不能前进到 phase ${updates.phase}。请先用 auto_dev_checkpoint 标记 PASS。`,
            current: { phase: current.phase, status: current.status },
            requested: { phase: updates.phase },
        });
    }
    // Guard 3: COMPLETED 需要前置状态（IN_PROGRESS 或 PASS）
    if (updates.status === "COMPLETED" && current.status !== "IN_PROGRESS" && current.status !== "PASS") {
        return textResult({
            ok: false,
            error: "INVALID_TRANSITION",
            message: `当前 status=${current.status}，不能直接设为 COMPLETED。需先经过 IN_PROGRESS 或 PASS。`,
            current: { phase: current.phase, status: current.status },
        });
    }
    // Guard 4: 直接设 PASS 时警告（不阻断，但提示应使用 checkpoint）
    if (updates.status === "PASS") {
        warnings.push("建议使用 auto_dev_checkpoint 而非 state_update 来标记 PASS，" +
            "checkpoint 会执行 artifact 验证和 phase-enforcer 逻辑。");
    }
    await sm.atomicUpdate(updates);
    const result = { ok: true, updated: Object.keys(updates) };
    if (warnings.length > 0)
        result.warnings = warnings;
    return textResult(result);
});
// ===========================================================================
// 4. auto_dev_checkpoint
// ===========================================================================
server.tool("auto_dev_checkpoint", "Write structured checkpoint to progress-log and update state.json. Idempotent: same params won't duplicate entries. Atomic: uses write-to-temp-then-rename.", {
    projectRoot: z.string(),
    topic: z.string(),
    phase: z.number(),
    task: z.number().optional(),
    status: z.enum(["IN_PROGRESS", "PASS", "NEEDS_REVISION", "BLOCKED", "COMPLETED"]),
    summary: z.string().optional(),
}, async ({ projectRoot, topic, phase, task, status, summary }) => {
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
    const stateUpdates = { phase, status };
    if (task !== undefined)
        stateUpdates["task"] = task;
    try {
        await sm.atomicUpdate(stateUpdates);
    }
    catch (err) {
        // progress-log written but state.json failed → mark dirty
        // Direct write to mark dirty — do not go through atomicUpdate
        try {
            const current = JSON.parse(await readFile(sm.stateFilePath, "utf-8"));
            current.dirty = true;
            current.updatedAt = new Date().toISOString();
            await writeFile(sm.stateFilePath, JSON.stringify(current, null, 2), "utf-8");
        }
        catch {
            // Last resort: state.json.tmp preserved for manual recovery
        }
        return textResult({
            error: "STATE_UPDATE_FAILED",
            message: `Progress-log updated but state.json write failed: ${err.message}. State marked as dirty.`,
        });
    }
    // 3. Create BLOCKED.md if status is BLOCKED
    if (status === "BLOCKED") {
        const blockedContent = `# BLOCKED\n\n**Phase**: ${phase}\n${task !== undefined ? `**Task**: ${task}\n` : ""}**Summary**: ${summary ?? "No summary"}\n**Timestamp**: ${new Date().toISOString()}\n`;
        await sm.atomicWrite(join(sm.outputDir, "BLOCKED.md"), blockedContent);
    }
    // 4. Phase 5/6 artifact validation — prevent skipping tests or acceptance
    if (phase === 5 && status === "PASS") {
        // Check for new test files via git
        let testFileCount = 0;
        try {
            const git = new GitManager(projectRoot);
            const progressLog = await readFile(join(sm.outputDir, "progress-log.md"), "utf-8").catch(() => "");
            // Extract Phase 3 start commit from progress-log (first Phase 3 checkpoint)
            const phase3Match = /CHECKPOINT phase=3.*?timestamp=/g.exec(progressLog);
            // Use git diff to find new files since init
            const { execFile: execFileAsync } = await import("node:child_process");
            const diffOutput = await new Promise((resolve, reject) => {
                execFileAsync("git", ["diff", "--name-only", "--diff-filter=A", "HEAD~20", "HEAD"], { cwd: projectRoot }, (err, stdout) => {
                    if (err)
                        resolve("");
                    else
                        resolve(stdout);
                });
            });
            const newFiles = diffOutput.trim().split("\n").filter(f => f.length > 0);
            testFileCount = countTestFiles(newFiles);
        }
        catch { /* ignore git errors */ }
        let resultsContent = null;
        try {
            resultsContent = await readFile(join(sm.outputDir, "e2e-test-results.md"), "utf-8");
        }
        catch { /* file doesn't exist */ }
        const phase5Validation = await validatePhase5Artifacts(sm.outputDir, testFileCount, resultsContent);
        if (!phase5Validation.valid) {
            return textResult({
                error: "PHASE5_ARTIFACTS_MISSING",
                ...phase5Validation,
            });
        }
    }
    if (phase === 6 && status === "PASS") {
        let reportContent = null;
        try {
            reportContent = await readFile(join(sm.outputDir, "acceptance-report.md"), "utf-8");
        }
        catch { /* file doesn't exist */ }
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
});
// ===========================================================================
// 5. auto_dev_render
// ===========================================================================
server.tool("auto_dev_render", "Render a prompt template with variable substitution and checklist injection.", {
    promptFile: z.string(),
    variables: z.record(z.string(), z.string()),
    extraContext: z.string().optional(),
    skillsDir: z.string().optional(),
}, async ({ promptFile, variables, extraContext, skillsDir }) => {
    const renderer = new TemplateRenderer(skillsDir ?? defaultSkillsDir());
    const result = await renderer.render(promptFile, variables, extraContext);
    return textResult(result);
});
// ===========================================================================
// 6. auto_dev_preflight
// ===========================================================================
server.tool("auto_dev_preflight", "Pre-flight check: verify prerequisites for a phase (required files exist, git is clean, etc.).", {
    projectRoot: z.string(),
    topic: z.string(),
    phase: z.number(),
}, async ({ projectRoot, topic, phase }) => {
    const sm = new StateManager(projectRoot, topic);
    const checks = [];
    // Common checks
    const gitManager = new GitManager(projectRoot);
    try {
        const gitInfo = await gitManager.getStatus();
        checks.push({ name: "git_status", passed: true, message: `Branch: ${gitInfo.currentBranch}` });
    }
    catch {
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
    const fileCheck = async (name, filePath) => {
        try {
            await stat(filePath);
            checks.push({ name, passed: true });
        }
        catch {
            checks.push({ name, passed: false, message: `Required file missing: ${filePath}` });
        }
    };
    if (phase >= 2)
        await fileCheck("design_md", join(outputDir, "design.md"));
    if (phase >= 3)
        await fileCheck("plan_md", join(outputDir, "plan.md"));
    if (phase >= 5)
        await fileCheck("code_review_md", join(outputDir, "code-review.md"));
    if (phase >= 6)
        await fileCheck("e2e_test_results_md", join(outputDir, "e2e-test-results.md"));
    const ready = checks.every((c) => c.passed);
    return textResult({ ready, checks });
});
// ===========================================================================
// 7. auto_dev_diff_check
// ===========================================================================
server.tool("auto_dev_diff_check", "Compare expected files from plan vs actual git changes, report discrepancies.", {
    projectRoot: z.string(),
    expectedFiles: z.array(z.string()),
    baseCommit: z.string(),
}, async ({ projectRoot, expectedFiles, baseCommit }) => {
    const git = new GitManager(projectRoot);
    const result = await git.diffCheck(expectedFiles, baseCommit);
    return textResult(result);
});
// ===========================================================================
// 8. auto_dev_git_rollback
// ===========================================================================
server.tool("auto_dev_git_rollback", "Rollback changes for a specific task using git diff --name-only for precise file-level rollback.", {
    projectRoot: z.string(),
    baseCommit: z.string(),
    files: z.array(z.string()).optional(),
}, async ({ projectRoot, baseCommit, files }) => {
    const git = new GitManager(projectRoot);
    const result = await git.rollback(baseCommit, files);
    return textResult(result);
});
// ===========================================================================
// 9. auto_dev_lessons_add
// ===========================================================================
server.tool("auto_dev_lessons_add", "Record a lesson learned from the current auto-dev session.", {
    projectRoot: z.string(),
    topic: z.string(),
    phase: z.number(),
    category: z.string(),
    lesson: z.string(),
    context: z.string().optional(),
}, async ({ projectRoot, topic, phase, category, lesson, context }) => {
    const sm = new StateManager(projectRoot, topic);
    const lessons = new LessonsManager(sm.outputDir);
    await lessons.add(phase, category, lesson, context);
    return textResult({ success: true, message: "Lesson recorded." });
});
// ===========================================================================
// 10. auto_dev_lessons_get
// ===========================================================================
server.tool("auto_dev_lessons_get", "Get historical lessons for a specific phase to inject into prompts.", {
    projectRoot: z.string(),
    topic: z.string(),
    phase: z.number().optional(),
    category: z.string().optional(),
}, async ({ projectRoot, topic, phase, category }) => {
    const sm = new StateManager(projectRoot, topic);
    const lessons = new LessonsManager(sm.outputDir);
    const entries = await lessons.get(phase, category);
    return textResult(entries);
});
// ===========================================================================
// 11. auto_dev_complete (Phase Completion Gate)
// ===========================================================================
server.tool("auto_dev_complete", "Completion gate: validates ALL required phases have PASS status before allowing the session to be declared complete. MUST be called before telling the user that auto-dev is finished. Will REJECT if any phase was skipped.", {
    projectRoot: z.string(),
    topic: z.string(),
}, async ({ projectRoot, topic }) => {
    const sm = new StateManager(projectRoot, topic);
    const state = await sm.loadAndValidate();
    // Read progress-log to find all passed phases
    const progressLogPath = join(sm.outputDir, "progress-log.md");
    let progressLogContent = "";
    try {
        progressLogContent = await readFile(progressLogPath, "utf-8");
    }
    catch {
        return textResult({
            error: "PROGRESS_LOG_MISSING",
            message: "progress-log.md not found. Cannot validate completion.",
            canComplete: false,
        });
    }
    const validation = validateCompletion(progressLogContent, state.mode, state.dryRun === true);
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
    const completeLine = sm.getCheckpointLine(state.phase, undefined, "COMPLETED", "All required phases passed. Session complete.");
    await sm.appendToProgressLog("\n" + completeLine + "\n");
    await sm.atomicUpdate({ status: "COMPLETED" });
    return textResult({
        canComplete: true,
        passedPhases: validation.passedPhases,
        message: validation.message,
        status: "COMPLETED",
    });
});
// ===========================================================================
// Start server
// ===========================================================================
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
}
main().catch((err) => {
    console.error("auto-dev MCP Server failed to start:", err);
    process.exit(1);
});
//# sourceMappingURL=index.js.map