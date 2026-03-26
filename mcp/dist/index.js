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
import { StateManager, internalCheckpoint } from "./state-manager.js";
import { TemplateRenderer } from "./template-renderer.js";
import { GitManager } from "./git-manager.js";
import { LessonsManager } from "./lessons-manager.js";
import { validateCompletion, validatePhase5Artifacts, validatePhase6Artifacts, validatePhase7Artifacts, countTestFiles, checkIterationLimit, validatePredecessor, parseInitMarker, validatePhase1ReviewArtifact, validatePhase2ReviewArtifact, isTddExemptTask } from "./phase-enforcer.js";
import { validateRedPhase, buildTestCommand, TDD_TIMEOUTS } from "./tdd-gate.js";
import { extractDocSummary, extractTaskList } from "./state-manager.js";
import { runRetrospective } from "./retrospective.js";
import { TRIBUNAL_PHASES } from "./tribunal-schema.js";
import { executeTribunal } from "./tribunal.js";
import { getClaudePath } from "./tribunal.js";
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
function buildVariablesFromState(state, branch) {
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
function formatDuration(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    if (hours > 0)
        return `${hours}h ${minutes % 60}m`;
    if (minutes > 0)
        return `${minutes}m ${seconds % 60}s`;
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
server.tool("auto_dev_init", "Initialize auto-dev session: create work dir, detect tech stack, init state. If directory exists, onConflict controls behavior (resume/overwrite).", {
    projectRoot: z.string(),
    topic: z.string(),
    mode: z.enum(["full", "quick"]),
    startPhase: z.number().optional(),
    interactive: z.boolean().optional(),
    dryRun: z.boolean().optional(),
    skipE2e: z.boolean().optional(),
    tdd: z.boolean().optional(),
    brainstorm: z.boolean().optional(),
    costMode: z.enum(["economy", "beast"]).optional(),
    onConflict: z.enum(["resume", "overwrite"]).optional(),
}, async ({ projectRoot, topic, mode, startPhase, interactive, dryRun, skipE2e, tdd, brainstorm, costMode, onConflict }) => {
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
            let state;
            try {
                state = await sm.loadAndValidate();
            }
            catch (err) {
                const errMsg = err.message;
                if (errMsg.includes("dirty")) {
                    // Try clearing dirty flag then re-validate
                    try {
                        const raw = JSON.parse(await readFile(sm.stateFilePath, "utf-8"));
                        raw.dirty = false;
                        raw.updatedAt = new Date().toISOString();
                        await sm.atomicWrite(sm.stateFilePath, JSON.stringify(raw, null, 2));
                        state = await sm.loadAndValidate();
                    }
                    catch {
                        // dirty fix also failed — degrade to rebuild
                        state = await sm.rebuildStateFromProgressLog();
                    }
                }
                else {
                    // state.json corrupted/missing — rebuild from progress-log
                    state = await sm.rebuildStateFromProgressLog();
                }
            }
            // Parse progress-log for last Phase 3 task (for task-level resume)
            let resumeTask;
            let resumeTaskStatus;
            try {
                const log = await readFile(sm.progressLogPath, "utf-8");
                const taskRegex = /CHECKPOINT phase=3 task=(\d+) status=(\w+)/g;
                let match;
                while ((match = taskRegex.exec(log)) !== null) {
                    resumeTask = parseInt(match[1], 10);
                    resumeTaskStatus = match[2];
                }
            }
            catch { /* no progress log yet */ }
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
        await new Promise((resolve) => {
            const tagName = `auto-dev/${topic}/start`;
            // Force-create tag in case a previous session left one
            execFileSync("git", ["tag", "-f", tagName], { cwd: projectRoot }, () => resolve());
        });
    }
    catch { /* git tag failed — non-fatal, continue */ }
    // Persist behavior flags and startCommit to state
    const behaviorUpdates = { startCommit };
    if (interactive)
        behaviorUpdates["interactive"] = true;
    if (dryRun)
        behaviorUpdates["dryRun"] = true;
    if (skipE2e)
        behaviorUpdates["skipE2e"] = true;
    behaviorUpdates["tdd"] = tdd !== false; // TDD on by default, --no-tdd to disable
    if (brainstorm)
        behaviorUpdates["brainstorm"] = true;
    behaviorUpdates["costMode"] = costMode ?? "beast"; // beast=全部最强(默认), economy=按阶段选模型
    await sm.atomicUpdate(behaviorUpdates);
    // Write immutable INIT marker to progress-log with original commands and integrity hash.
    // This is the single source of truth for auto_dev_complete — agent cannot tamper
    // because progress-log is append-only from the framework's perspective, and the
    // hash covers the critical fields.
    const initFields = {
        buildCmd: stack.buildCmd,
        testCmd: stack.testCmd,
        skipE2e: skipE2e === true,
        mode,
    };
    const { createHash } = await import("node:crypto");
    const integrityHash = createHash("sha256")
        .update(JSON.stringify(initFields) + startCommit)
        .digest("hex")
        .slice(0, 16);
    // Count @Disabled/@Ignore/skip tests at init time as baseline
    // Agent adding new @Disabled to pass tests will be detected at complete time
    let disabledTestCount = 0;
    try {
        const { execFile: execFileCount } = await import("node:child_process");
        const countOutput = await new Promise((resolve) => {
            execFileCount("grep", ["-r", "-c", "-E", "@Disabled|@Ignore|@pytest.mark.skip|it\\.skip\\(|xit\\(|xdescribe\\(", projectRoot + "/src"], { timeout: 15_000 }, (err, stdout) => {
                resolve(err ? "" : (stdout || ""));
            });
        });
        // grep -c returns "filename:count" per file, sum all counts
        for (const line of countOutput.trim().split("\n")) {
            const match = line.match(/:(\d+)$/);
            if (match)
                disabledTestCount += parseInt(match[1], 10);
        }
    }
    catch { /* grep failed, count stays 0 */ }
    const initMarker = `<!-- INIT buildCmd="${stack.buildCmd}" testCmd="${stack.testCmd}"` +
        ` skipE2e=${skipE2e === true} mode=${mode}` +
        ` integrity=${integrityHash} disabledTests=${disabledTestCount} -->`;
    await sm.appendToProgressLog("\n" + initMarker + "\n");
    // Health check: verify claude CLI availability for tribunal phases
    let tribunalReady = false;
    let tribunalWarning;
    try {
        await getClaudePath();
        tribunalReady = true;
    }
    catch {
        tribunalWarning = "claude CLI not found — tribunal phases (independent judge) will not be available. Install @anthropic-ai/claude-code or set TRIBUNAL_CLAUDE_PATH.";
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
        tribunalReady,
        ...(tribunalWarning ? { tribunalWarning } : {}),
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
server.tool("auto_dev_state_update", "Update auxiliary state fields (task, iteration, flags). Phase/status changes MUST go through auto_dev_checkpoint.", {
    projectRoot: z.string(),
    topic: z.string(),
    updates: z.object({
        task: z.number().optional(),
        iteration: z.number().optional(),
        dirty: z.boolean().optional(),
        interactive: z.boolean().optional(),
        dryRun: z.boolean().optional(),
    }),
}, async ({ projectRoot, topic, updates }) => {
    const sm = new StateManager(projectRoot, topic);
    await sm.atomicUpdate(updates);
    return textResult({ ok: true, updated: Object.keys(updates) });
});
// ===========================================================================
// 4. auto_dev_checkpoint
// ===========================================================================
server.tool("auto_dev_checkpoint", "Write structured checkpoint to progress-log and update state.json. Idempotent: same params won't duplicate entries. Atomic: uses write-to-temp-then-rename.", {
    projectRoot: z.string(),
    topic: z.string(),
    phase: z.number(),
    task: z.number().optional(),
    status: z.enum(["IN_PROGRESS", "PASS", "NEEDS_REVISION", "BLOCKED", "COMPLETED", "REGRESS"]),
    summary: z.string().optional(),
    tokenEstimate: z.number().optional(),
    regressTo: z.number().int().min(1).max(5).optional(),
}, async ({ projectRoot, topic, phase, task, status: rawStatus, summary: rawSummary, tokenEstimate, regressTo }) => {
    let status = rawStatus;
    let summary = rawSummary;
    const sm = new StateManager(projectRoot, topic);
    const state = await sm.loadAndValidate();
    // Idempotency check
    if (await sm.isCheckpointDuplicate(phase, task, status, summary)) {
        return textResult({ idempotent: true, message: "Checkpoint already exists with same params, skipped." });
    }
    // Guard A: COMPLETED status is reserved for auto_dev_complete only
    if (status === "COMPLETED") {
        return textResult({
            error: "INVALID_STATUS",
            message: "COMPLETED 状态不能通过 checkpoint 设置。必须调用 auto_dev_complete() 完成。",
            mandate: "[BLOCKED] 禁止通过 checkpoint 设置 COMPLETED。唯一的完成方式是调用 auto_dev_complete。",
        });
    }
    // Guard B: PASS requires predecessor phase to be PASS (prevent phase skipping)
    if (status === "PASS") {
        const progressLogPath = join(sm.outputDir, "progress-log.md");
        const progressLogContent = await readFile(progressLogPath, "utf-8").catch(() => "");
        const predCheck = validatePredecessor(phase, progressLogContent, state.mode, state.skipE2e === true);
        if (!predCheck.valid) {
            return textResult({
                error: "PREDECESSOR_NOT_PASSED",
                message: predCheck.error,
                mandate: `[BLOCKED] ${predCheck.error}`,
            });
        }
    }
    // Guard C: Tribunal phases (4/5/6/7) cannot be directly marked PASS via checkpoint
    if (TRIBUNAL_PHASES.includes(phase) && status === "PASS") {
        return textResult({
            error: "TRIBUNAL_REQUIRED",
            message: `Phase ${phase} 需要通过独立裁决才能 PASS。请调用 auto_dev_submit(phase=${phase}) 提交审查。`,
            mandate: "禁止主 Agent 直接标记裁决 Phase 为 PASS。必须通过 auto_dev_submit。",
        });
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
    // ===================================================================
    // PRE-VALIDATION PHASE — all checks BEFORE any state mutation
    // Artifact validation must happen before writing to progress-log
    // or state.json, so failed checks don't pollute formal state.
    // ===================================================================
    // Guard: lesson feedback must be submitted before PASS
    if (status === "PASS") {
        const pendingIds = state.injectedLessonIds ?? [];
        if (pendingIds.length > 0) {
            return textResult({
                error: "LESSON_FEEDBACK_REQUIRED",
                lessonFeedbackRequired: true,
                injectedLessonIds: pendingIds,
                feedbackInstruction: "必须先调用 auto_dev_lessons_feedback 对注入的经验逐条反馈，然后再 checkpoint PASS。",
                note: "Checkpoint rejected BEFORE writing state. No state pollution.",
            });
        }
    }
    // Phase 1 review artifact pre-validation: design-review.md must exist
    if (phase === 1 && status === "PASS") {
        let reviewContent = null;
        try {
            reviewContent = await readFile(join(sm.outputDir, "design-review.md"), "utf-8");
        }
        catch { /* file doesn't exist */ }
        const phase1Validation = validatePhase1ReviewArtifact(reviewContent);
        if (!phase1Validation.valid) {
            return textResult({
                error: "PHASE1_REVIEW_MISSING",
                ...phase1Validation,
                note: "Checkpoint rejected BEFORE writing state. No state pollution.",
            });
        }
    }
    // Phase 2 review artifact pre-validation: plan-review.md must exist
    if (phase === 2 && status === "PASS") {
        let reviewContent = null;
        try {
            reviewContent = await readFile(join(sm.outputDir, "plan-review.md"), "utf-8");
        }
        catch { /* file doesn't exist */ }
        const phase2Validation = validatePhase2ReviewArtifact(reviewContent);
        if (!phase2Validation.valid) {
            return textResult({
                error: "PHASE2_REVIEW_MISSING",
                ...phase2Validation,
                note: "Checkpoint rejected BEFORE writing state. No state pollution.",
            });
        }
    }
    // Phase 5 artifact pre-validation + ACTUAL test execution
    if (phase === 5 && status === "PASS" && state.skipE2e !== true) {
        // 5a. Check test files and implementation files exist
        let testFileCount = 0;
        let implFileCount = 0;
        try {
            const { execFile: execFileAsync } = await import("node:child_process");
            const diffOutput = await new Promise((resolve) => {
                const baseCommit = state.startCommit ?? "HEAD~20";
                execFileAsync("git", ["diff", "--name-only", "--diff-filter=AM", baseCommit, "HEAD"], { cwd: projectRoot }, (err, stdout) => {
                    if (err)
                        resolve("");
                    else {
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
            // Count new implementation files (non-test source files)
            const implPatterns = [/\.java$/, /\.ts$/, /\.js$/, /\.py$/, /\.go$/, /\.rs$/, /\.kt$/];
            const testPatterns = [/[Tt]est\.(java|py|ts|js|kt|go|rs)$/, /\.test\.(ts|js|tsx|jsx)$/, /\.spec\.(ts|js|tsx|jsx)$/, /_test\.(go|py)$/, /tests?\//i];
            implFileCount = newFiles.filter(f => implPatterns.some(p => p.test(f)) && !testPatterns.some(p => p.test(f))).length;
        }
        catch { /* ignore git errors */ }
        let resultsContent = null;
        try {
            resultsContent = await readFile(join(sm.outputDir, "e2e-test-results.md"), "utf-8");
        }
        catch { /* file doesn't exist */ }
        const phase5Validation = await validatePhase5Artifacts(sm.outputDir, testFileCount, resultsContent, implFileCount);
        if (!phase5Validation.valid) {
            return textResult({
                error: "PHASE5_ARTIFACTS_MISSING",
                ...phase5Validation,
                note: "Checkpoint rejected BEFORE writing state. No state pollution.",
            });
        }
        // 5b. ACTUALLY RUN testCmd — framework executes tests, not the agent
        // Read original testCmd from INIT marker (tamper-proof)
        const progressLog = await readFile(join(sm.outputDir, "progress-log.md"), "utf-8").catch(() => "");
        const initData = parseInitMarker(progressLog);
        const testCmd = initData?.testCmd ?? state.stack?.testCmd;
        if (testCmd) {
            try {
                const { execFile: execFileTest } = await import("node:child_process");
                const testResult = await new Promise((resolve) => {
                    execFileTest("sh", ["-c", testCmd], { cwd: projectRoot, timeout: 300_000 }, (err, _stdout, stderr) => {
                        resolve({ success: !err, stderr: stderr?.slice(0, 500) ?? "" });
                    });
                });
                if (!testResult.success) {
                    return textResult({
                        error: "PHASE5_TESTS_FAILED",
                        message: `Phase 5 checkpoint 被拒绝：框架实际执行 testCmd 失败。` +
                            `\n命令: ${testCmd}\n错误: ${testResult.stderr}`,
                        mandate: "[BLOCKED] 测试未通过。框架已自行执行 testCmd 验证。禁止伪造测试结果。",
                        note: "Checkpoint rejected BEFORE writing state. No state pollution.",
                    });
                }
            }
            catch (err) {
                return textResult({
                    error: "PHASE5_TEST_EXECUTION_ERROR",
                    message: `框架执行 testCmd 时出错: ${err.message}`,
                    note: "Checkpoint rejected BEFORE writing state. No state pollution.",
                });
            }
        }
    }
    // Phase 6 artifact pre-validation
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
                note: "Checkpoint rejected BEFORE writing state. No state pollution.",
            });
        }
    }
    // Phase 7 artifact pre-validation: retrospective.md must exist and be substantial
    if (phase === 7 && status === "PASS") {
        let retroContent = null;
        try {
            retroContent = await readFile(join(sm.outputDir, "retrospective.md"), "utf-8");
        }
        catch { /* file doesn't exist */ }
        const retroValidation = validatePhase7Artifacts(retroContent);
        if (!retroValidation.valid) {
            return textResult({
                error: "PHASE7_RETROSPECTIVE_MISSING",
                ...retroValidation,
                note: "Checkpoint rejected BEFORE writing state. No state pollution.",
            });
        }
    }
    // TDD Gate: verify RED+GREEN for each task (replaces old Iron Law)
    if (phase === 3 && status === "PASS" && state.tdd === true && task != null) {
        const isExempt = await isTddExemptTask(sm.outputDir, task);
        if (!isExempt) {
            const tddState = state.tddTaskStates?.[String(task)];
            if (tddState?.status !== "GREEN_CONFIRMED") {
                return textResult({
                    error: "TDD_GATE_INCOMPLETE",
                    message: `Task ${task} 未完成 TDD RED-GREEN 流程。` +
                        (tddState?.status === "RED_CONFIRMED"
                            ? "RED 已确认，但 GREEN 尚未完成。请先调用 auto_dev_task_green。"
                            : "RED 尚未完成。请先调用 auto_dev_task_red。"),
                    mandate: "[BLOCKED] TDD 模式下，checkpoint PASS 要求 RED+GREEN 均已确认。",
                    note: "Checkpoint rejected BEFORE writing state. No state pollution.",
                });
            }
        }
    }
    // ===================================================================
    // COMMIT PHASE — all pre-validations passed, now persist state
    // ===================================================================
    const result = await internalCheckpoint(sm, state, phase, status, summary, task, tokenEstimate, {
        tddWarning: null,
        regressTo,
    });
    if (!result.ok) {
        return textResult({
            error: result.error,
            message: result.message,
        });
    }
    return textResult({ ok: true, ...result.nextDirective });
});
// ===========================================================================
// 4b. auto_dev_task_red (TDD RED phase gate)
// ===========================================================================
server.tool("auto_dev_task_red", "TDD RED phase: validate that only test files were changed and tests fail. Must be called before auto_dev_task_green.", {
    projectRoot: z.string(),
    topic: z.string(),
    task: z.number(),
    testFiles: z.array(z.string()),
}, async ({ projectRoot, topic, task, testFiles }) => {
    const sm = new StateManager(projectRoot, topic);
    const state = await sm.loadAndValidate();
    // Verify phase=3, status=IN_PROGRESS, tdd=true
    if (state.phase !== 3 || state.status !== "IN_PROGRESS") {
        return textResult({
            error: "INVALID_PHASE",
            message: `auto_dev_task_red 只能在 Phase 3 IN_PROGRESS 状态下调用。当前: phase=${state.phase}, status=${state.status}`,
        });
    }
    if (state.tdd !== true) {
        return textResult({
            error: "TDD_NOT_ENABLED",
            message: "TDD 模式未启用。请在 auto_dev_init 时设置 tdd=true。",
        });
    }
    // Check task not already RED_CONFIRMED or GREEN_CONFIRMED
    const taskKey = String(task);
    const existingState = state.tddTaskStates?.[taskKey];
    if (existingState?.status === "RED_CONFIRMED" || existingState?.status === "GREEN_CONFIRMED") {
        return textResult({
            error: "TASK_ALREADY_CONFIRMED",
            message: `Task ${task} 已处于 ${existingState.status} 状态，无需重复调用 auto_dev_task_red。`,
        });
    }
    // Get changed files via git
    let changedFiles = [];
    try {
        const { execFile: execFileGit } = await import("node:child_process");
        // Include unstaged, staged, AND untracked files (prevent bypass via git add)
        const diffUnstaged = await new Promise((resolve) => {
            execFileGit("git", ["diff", "--name-only", "HEAD"], { cwd: projectRoot }, (err, stdout) => {
                resolve(err ? "" : (stdout || ""));
            });
        });
        const diffStaged = await new Promise((resolve) => {
            execFileGit("git", ["diff", "--name-only", "--cached"], { cwd: projectRoot }, (err, stdout) => {
                resolve(err ? "" : (stdout || ""));
            });
        });
        const untrackedOutput = await new Promise((resolve) => {
            execFileGit("git", ["ls-files", "--others", "--exclude-standard"], { cwd: projectRoot }, (err, stdout) => {
                resolve(err ? "" : (stdout || ""));
            });
        });
        changedFiles = (diffUnstaged + "\n" + diffStaged + "\n" + untrackedOutput).trim().split("\n").filter(f => f.length > 0);
        // Deduplicate (a file can appear in both unstaged and staged)
        changedFiles = [...new Set(changedFiles)];
    }
    catch { /* git command failed */ }
    // Validate RED phase: no impl files, at least one test file changed
    const validation = validateRedPhase(changedFiles, testFiles);
    if (!validation.valid) {
        return textResult({
            status: "REJECTED",
            error: "RED_VALIDATION_FAILED",
            message: validation.error,
        });
    }
    // Build and execute test command
    const testCmd = buildTestCommand(state.stack.language, testFiles, projectRoot);
    if (!testCmd) {
        return textResult({
            error: "NO_TEST_COMMAND",
            message: `无法为语言 "${state.stack.language}" 生成测试命令。`,
        });
    }
    let exitCode = 0;
    let stderr = "";
    try {
        const { execFile: execFileTest } = await import("node:child_process");
        const result = await new Promise((resolve) => {
            execFileTest("sh", ["-c", testCmd], { cwd: projectRoot, timeout: TDD_TIMEOUTS.red }, (err, _stdout, stderrOut) => {
                const code = err ? err.code ?? 1 : 0;
                resolve({ code, stderr: stderrOut?.slice(0, 1000) ?? "" });
            });
        });
        exitCode = result.code;
        stderr = result.stderr;
    }
    catch (err) {
        return textResult({
            error: "TEST_EXECUTION_ERROR",
            message: `测试执行出错: ${err.message}`,
        });
    }
    if (exitCode === 0) {
        // Tests pass — not a valid RED
        return textResult({
            status: "REJECTED",
            error: "TESTS_PASS_NOT_RED",
            message: "RED 阶段要求测试失败，但测试全部通过。请确保测试引用了尚未实现的代码。",
            testCmd,
        });
    }
    // Tests fail — RED_CONFIRMED
    const redFailType = /cannot find symbol|compilation error|SyntaxError|ModuleNotFoundError|ImportError|Cannot find module|TS\d{4}/i.test(stderr)
        ? "compilation_error"
        : "test_failure";
    // Write tddTaskStates
    const tddTaskStates = { ...(state.tddTaskStates ?? {}) };
    tddTaskStates[taskKey] = {
        status: "RED_CONFIRMED",
        redTestFiles: testFiles,
        redExitCode: exitCode,
        redFailType,
    };
    await sm.atomicUpdate({ tddTaskStates });
    return textResult({
        status: "RED_CONFIRMED",
        task,
        testCmd,
        exitCode,
        failType: redFailType,
        message: `Task ${task} RED 确认：测试失败（${redFailType}）。请实现代码后调用 auto_dev_task_green。`,
    });
});
// ===========================================================================
// 4c. auto_dev_task_green (TDD GREEN phase gate)
// ===========================================================================
server.tool("auto_dev_task_green", "TDD GREEN phase: verify that tests now pass after implementation. Requires prior RED_CONFIRMED.", {
    projectRoot: z.string(),
    topic: z.string(),
    task: z.number(),
}, async ({ projectRoot, topic, task }) => {
    const sm = new StateManager(projectRoot, topic);
    const state = await sm.loadAndValidate();
    // Verify phase=3, status=IN_PROGRESS, tdd=true
    if (state.phase !== 3 || state.status !== "IN_PROGRESS") {
        return textResult({
            error: "INVALID_PHASE",
            message: `auto_dev_task_green 只能在 Phase 3 IN_PROGRESS 状态下调用。当前: phase=${state.phase}, status=${state.status}`,
        });
    }
    if (state.tdd !== true) {
        return textResult({
            error: "TDD_NOT_ENABLED",
            message: "TDD 模式未启用。",
        });
    }
    // Verify task is RED_CONFIRMED
    const taskKey = String(task);
    const taskState = state.tddTaskStates?.[taskKey];
    if (taskState?.status !== "RED_CONFIRMED") {
        return textResult({
            status: "REJECTED",
            error: "NOT_RED_CONFIRMED",
            message: `Task ${task} 尚未完成 RED 阶段（当前状态: ${taskState?.status ?? "无记录"}）。请先调用 auto_dev_task_red。`,
        });
    }
    // Get test files from RED phase
    const redTestFiles = taskState.redTestFiles ?? [];
    if (redTestFiles.length === 0) {
        return textResult({
            error: "NO_TEST_FILES",
            message: `Task ${task} RED 阶段未记录测试文件。`,
        });
    }
    // Build and execute test command
    const testCmd = buildTestCommand(state.stack.language, redTestFiles, projectRoot);
    if (!testCmd) {
        return textResult({
            error: "NO_TEST_COMMAND",
            message: `无法为语言 "${state.stack.language}" 生成测试命令。`,
        });
    }
    let exitCode = 0;
    let stderr = "";
    try {
        const { execFile: execFileTest } = await import("node:child_process");
        const result = await new Promise((resolve) => {
            execFileTest("sh", ["-c", testCmd], { cwd: projectRoot, timeout: TDD_TIMEOUTS.green }, (err, _stdout, stderrOut) => {
                const code = err ? err.code ?? 1 : 0;
                resolve({ code, stderr: stderrOut?.slice(0, 1000) ?? "" });
            });
        });
        exitCode = result.code;
        stderr = result.stderr;
    }
    catch (err) {
        return textResult({
            error: "TEST_EXECUTION_ERROR",
            message: `测试执行出错: ${err.message}`,
        });
    }
    if (exitCode === 0) {
        // Tests pass — GREEN_CONFIRMED
        const tddTaskStates = { ...(state.tddTaskStates ?? {}) };
        tddTaskStates[taskKey] = {
            ...tddTaskStates[taskKey],
            status: "GREEN_CONFIRMED",
        };
        await sm.atomicUpdate({ tddTaskStates });
        return textResult({
            status: "GREEN_CONFIRMED",
            task,
            testCmd,
            message: `Task ${task} GREEN 确认：测试全部通过。可以继续 checkpoint。`,
        });
    }
    // Tests still fail — REJECTED
    return textResult({
        status: "REJECTED",
        error: "TESTS_STILL_FAILING",
        task,
        testCmd,
        exitCode,
        stderr: stderr.slice(0, 500),
        message: `Task ${task} GREEN 被拒绝：测试仍然失败。请修复实现后重试。`,
    });
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
    if (phase >= 3) {
        await fileCheck("plan_md", join(outputDir, "plan.md"));
        // Validate plan contains at least one task marker
        try {
            const planContent = await readFile(join(outputDir, "plan.md"), "utf-8");
            if (!/##\s*Task\s+\d|###\s*Task\s+\d|\d+\./m.test(planContent)) {
                checks.push({ name: "plan_has_tasks", passed: false, message: "plan.md does not contain recognizable task markers (## Task N or numbered list)" });
            }
            else {
                checks.push({ name: "plan_has_tasks", passed: true, message: "plan.md contains task markers" });
            }
        }
        catch { /* already checked file exists above */ }
    }
    if (phase >= 5)
        await fileCheck("code_review_md", join(outputDir, "code-review.md"));
    if (phase >= 6)
        await fileCheck("e2e_test_results_md", join(outputDir, "e2e-test-results.md"));
    if (phase >= 7)
        await fileCheck("acceptance_report_md", join(outputDir, "acceptance-report.md"));
    const ready = checks.every((c) => c.passed);
    const result = { ready, checks };
    // Auto-render suggested prompt when ready
    if (ready) {
        // Model routing: economy mode uses sonnet for mechanical tasks, opus for critical thinking
        // beast mode uses opus for everything
        const state = await sm.loadAndValidate();
        const isBeast = state.costMode === "beast";
        const phasePromptMap = {
            0: { promptFile: "phase0-brainstorm", agent: "auto-dev-architect", model: isBeast ? "opus" : "sonnet" },
            1: { promptFile: "phase1-architect", agent: "auto-dev-architect", model: "opus" }, // 设计始终用最强
            2: { promptFile: "phase2-planner", agent: "auto-dev-architect", model: isBeast ? "opus" : "sonnet" },
            3: { promptFile: "phase3-developer", agent: "auto-dev-developer", model: "opus" }, // 实现始终用最强
            4: { promptFile: "phase4-full-reviewer", agent: "auto-dev-reviewer", model: "opus" }, // 代码审查始终用最强
            5: { promptFile: "phase5-test-architect", agent: "auto-dev-test-architect", model: isBeast ? "opus" : "sonnet" },
            6: { promptFile: "phase6-acceptance", agent: "auto-dev-acceptance-validator", model: isBeast ? "opus" : "sonnet" },
            7: { promptFile: "phase7-retrospective", agent: "auto-dev-reviewer", model: isBeast ? "opus" : "sonnet" },
        };
        // Phase 1: if design.md already exists, skip architect → go directly to reviewer
        if (phase === 1) {
            try {
                await stat(join(outputDir, "design.md"));
                phasePromptMap[1] = { promptFile: "phase1-design-reviewer", agent: "auto-dev-reviewer", model: "opus" };
                result.designExists = true;
                result.hint = "design.md already exists. Skipping architect, going directly to design review.";
            }
            catch { /* design.md not found, use default architect flow */ }
        }
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
                const localLessonIds = [];
                const globalLessonIds = [];
                try {
                    const lessonsManager = new LessonsManager(sm.outputDir, projectRoot);
                    const lessons = await lessonsManager.get(phase);
                    if (lessons.length > 0) {
                        extraContext += `## 历史教训（自动注入，请在本次执行中避免重蹈覆辙）\n\n`;
                        for (const l of lessons) {
                            const idTag = l.id ? `[id:${l.id}] ` : "";
                            extraContext += `- ${idTag}[${l.category}${l.severity ? `/${l.severity}` : ""}] ${l.lesson}\n`;
                            if (l.id)
                                localLessonIds.push(l.id);
                        }
                        extraContext += "\n";
                    }
                }
                catch { /* lessons file not found, skip */ }
                // 1b. Inject global lessons (cross-topic reusable experience)
                try {
                    const globalLessons = await new LessonsManager(sm.outputDir, projectRoot).getGlobalLessons(10);
                    if (globalLessons.length > 0) {
                        extraContext += `## 全局经验（跨项目积累，自动注入）\n\n`;
                        for (const l of globalLessons) {
                            const idTag = l.id ? `[id:${l.id}] ` : "";
                            extraContext += `- ${idTag}[${l.category}${l.severity ? `/${l.severity}` : ""}] ${l.lesson}${l.topic ? ` (来自: ${l.topic})` : ""}\n`;
                            if (l.id)
                                globalLessonIds.push(l.id);
                        }
                        extraContext += "\n";
                    }
                }
                catch { /* global lessons not found, skip */ }
                // 1-footer. Record injected lesson IDs and add feedback hint
                const injectedIds = [...localLessonIds, ...globalLessonIds];
                if (injectedIds.length > 0) {
                    extraContext += `> Phase 完成后请对以上经验逐条反馈（helpful / not_applicable / incorrect）\n\n`;
                    await sm.atomicUpdate({ injectedLessonIds: injectedIds });
                }
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
                    }
                    catch { /* no brainstorm notes, skip */ }
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
                    }
                    catch { /* design.md not found, skip */ }
                    if (phase === 3) {
                        try {
                            const planContent = await readFile(join(outputDir, "plan.md"), "utf-8");
                            const taskList = extractTaskList(planContent);
                            extraContext += `## 任务列表（自动注入）\n\n${taskList}\n\n`;
                        }
                        catch { /* plan.md not found, skip */ }
                    }
                }
                const rendered = await renderer.render(mapping.promptFile, variables, extraContext || undefined);
                result.suggestedPrompt = rendered.renderedPrompt;
                result.suggestedAgent = mapping.agent;
                result.suggestedModel = mapping.model;
                result.costMode = state.costMode ?? "economy";
            }
            catch { /* prompt file not found or render error, skip */ }
        }
    }
    return textResult(result);
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
    severity: z.string().optional(),
    reusable: z.boolean().optional(),
}, async ({ projectRoot, topic, phase, category, lesson, context, severity, reusable }) => {
    const sm = new StateManager(projectRoot, topic);
    const lessons = new LessonsManager(sm.outputDir);
    await lessons.add(phase, category, lesson, context, { severity, topic, reusable });
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
// 12. auto_dev_lessons_feedback (Lesson Feedback)
// ===========================================================================
server.tool("auto_dev_lessons_feedback", "Submit feedback verdicts for lessons that were injected during preflight. Must be called before checkpoint PASS.", {
    projectRoot: z.string(),
    topic: z.string(),
    feedbacks: z.array(z.object({
        id: z.string(),
        verdict: z.enum(["helpful", "not_applicable", "incorrect"]),
    })),
}, async ({ projectRoot, topic, feedbacks }) => {
    const sm = new StateManager(projectRoot, topic);
    const state = await sm.loadAndValidate();
    const lessons = new LessonsManager(sm.outputDir, projectRoot);
    const result = await lessons.feedback(feedbacks, { phase: state.phase, topic: state.topic });
    // Clear injectedLessonIds after feedback is submitted
    await sm.atomicUpdate({ injectedLessonIds: [] });
    return textResult({
        success: true,
        localUpdated: result.localUpdated.length,
        globalUpdated: result.globalUpdated.length,
        localIds: result.localUpdated,
        globalIds: result.globalUpdated,
    });
});
// ===========================================================================
// 13. auto_dev_complete (Phase Completion Gate)
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
    const validation = validateCompletion(progressLogContent, state.mode, state.dryRun === true, state.skipE2e === true);
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
    // CRITICAL: Read original commands from INIT marker in progress-log,
    // NOT from state.json — agent may have tampered with state.stack.testCmd
    // (e.g., adding -DskipTests to bypass test execution).
    const initMarker = parseInitMarker(progressLogContent);
    const buildCmd = initMarker?.buildCmd ?? state.stack?.buildCmd;
    const testCmd = initMarker?.testCmd ?? state.stack?.testCmd;
    // Tamper detection: if INIT marker exists, compare with state
    if (initMarker && state.stack) {
        if (initMarker.testCmd !== state.stack.testCmd) {
            return textResult({
                error: "TESTCMD_TAMPERED",
                canComplete: false,
                message: `testCmd 被篡改！原始值(INIT marker): "${initMarker.testCmd}", ` +
                    `当前 state.json 值: "${state.stack.testCmd}". 禁止绕过测试门禁。`,
                mandate: "[BLOCKED] 检测到 testCmd 被篡改。必须恢复原始测试命令后重试。",
            });
        }
        if (initMarker.buildCmd !== state.stack.buildCmd) {
            return textResult({
                error: "BUILDCMD_TAMPERED",
                canComplete: false,
                message: `buildCmd 被篡改！原始值(INIT marker): "${initMarker.buildCmd}", ` +
                    `当前 state.json 值: "${state.stack.buildCmd}". `,
                mandate: "[BLOCKED] 检测到 buildCmd 被篡改。必须恢复原始构建命令后重试。",
            });
        }
        if (initMarker.skipE2e !== (state.skipE2e === true)) {
            return textResult({
                error: "SKIPE2E_TAMPERED",
                canComplete: false,
                message: `skipE2e 被篡改！原始值(INIT marker): ${initMarker.skipE2e}, ` +
                    `当前 state.json 值: ${state.skipE2e}. `,
                mandate: "[BLOCKED] 检测到 skipE2e 标志被篡改。禁止事后修改跳过策略。",
            });
        }
    }
    // @Disabled/@Ignore count comparison — detect agent adding skip annotations to pass tests
    if (initMarker?.disabledTestCount !== undefined) {
        let currentDisabledCount = 0;
        try {
            const { execFile: execFileGrep } = await import("node:child_process");
            const grepOutput = await new Promise((resolve) => {
                execFileGrep("grep", ["-r", "-c", "-E", "@Disabled|@Ignore|@pytest.mark.skip|it\\.skip\\(|xit\\(|xdescribe\\(", projectRoot + "/src"], { timeout: 15_000 }, (err, stdout) => {
                    resolve(err ? "" : (stdout || ""));
                });
            });
            for (const line of grepOutput.trim().split("\n")) {
                const m = line.match(/:(\d+)$/);
                if (m)
                    currentDisabledCount += parseInt(m[1], 10);
            }
        }
        catch { /* grep failed */ }
        const newlyDisabled = currentDisabledCount - initMarker.disabledTestCount;
        if (newlyDisabled > 0) {
            return textResult({
                error: "TESTS_NEWLY_DISABLED",
                canComplete: false,
                message: `检测到新增 ${newlyDisabled} 个 @Disabled/@Ignore 测试注解！` +
                    `\n初始值（INIT marker）: ${initMarker.disabledTestCount}, 当前: ${currentDisabledCount}。` +
                    `\n禁止通过 @Disabled 跳过失败测试来绕过测试门禁。必须修复测试或移除 @Disabled 后重试。`,
                mandate: "[BLOCKED] 新增了跳过测试的注解。必须修复测试而非禁用测试。",
            });
        }
    }
    if (buildCmd) {
        try {
            const { execFile } = await import("node:child_process");
            const buildResult = await new Promise((resolve) => {
                execFile("sh", ["-c", buildCmd], { cwd: projectRoot, timeout: 120_000 }, (err, _stdout, stderr) => {
                    resolve({ success: !err, stderr: stderr?.slice(0, 500) ?? "" });
                });
            });
            if (!buildResult.success) {
                return textResult({
                    error: "BUILD_FAILED_AT_COMPLETION",
                    canComplete: false,
                    message: `所有 Phase 已 PASS，但最终构建失败（使用 INIT 原始命令: ${buildCmd}）。\n${buildResult.stderr}`,
                    mandate: "[BLOCKED] 构建失败，禁止宣称完成。",
                });
            }
        }
        catch { /* build command execution failed — non-fatal, continue */ }
    }
    if (testCmd) {
        try {
            const { execFile } = await import("node:child_process");
            const testResult = await new Promise((resolve) => {
                execFile("sh", ["-c", testCmd], { cwd: projectRoot, timeout: 300_000 }, (err, _stdout, stderr) => {
                    resolve({ success: !err, stderr: stderr?.slice(0, 500) ?? "" });
                });
            });
            if (!testResult.success) {
                return textResult({
                    error: "TESTS_FAILED_AT_COMPLETION",
                    canComplete: false,
                    message: `所有 Phase 已 PASS，但最终测试失败（使用 INIT 原始命令: ${testCmd}）。\n${testResult.stderr}`,
                    mandate: "[BLOCKED] 测试失败，禁止宣称完成。",
                });
            }
        }
        catch { /* test command execution failed — non-fatal, continue */ }
    }
    // All phases passed — mark as COMPLETED
    const completeLine = sm.getCheckpointLine(state.phase, undefined, "COMPLETED", "All required phases passed. Session complete.");
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
        const PHASE_NAMES = {
            "0": "BRAINSTORM", "1": "DESIGN", "2": "PLAN", "3": "EXECUTE", "4": "VERIFY", "5": "E2E_TEST", "6": "ACCEPTANCE", "7": "RETROSPECTIVE",
        };
        const timingRows = timingSummary
            .map(t => `| Phase ${t.phase} (${PHASE_NAMES[String(t.phase)] ?? "?"}) | ${t.durationStr} |`)
            .join("\n");
        const tokenRows = Object.entries(tokenUsage.byPhase)
            .map(([p, tok]) => `| Phase ${p} | ~${tok.toLocaleString()} |`)
            .join("\n");
        const summaryContent = `# auto-dev 完成摘要\n\n` +
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
            `- \`retrospective.md\` — 回顾总结（Phase 7）\n` +
            `- \`progress-log.md\` — 完整执行日志\n\n` +
            `> 如需回滚至 init 状态：\`git reset --hard auto-dev/${state.topic}/start\`\n`;
        await sm.atomicWrite(join(sm.outputDir, "summary.md"), summaryContent);
    }
    catch { /* summary.md generation failed — non-fatal */ }
    return textResult({
        canComplete: true,
        passedPhases: validation.passedPhases,
        message: validation.message,
        status: "COMPLETED",
        timingSummary,
        tokenUsage,
    });
});
// ===========================================================================
// 14. auto_dev_submit (Tribunal Submit)
// ===========================================================================
server.tool("auto_dev_submit", "提交当前 Phase 产物进行独立裁决。Phase 4/5/6/7 必须通过裁决 Agent 审查才能通过。", {
    projectRoot: z.string(),
    topic: z.string(),
    phase: z.number(),
    summary: z.string(),
}, async ({ projectRoot, topic, phase, summary }) => {
    // Validate phase is a tribunal phase
    if (!TRIBUNAL_PHASES.includes(phase)) {
        return textResult({
            error: "INVALID_PHASE",
            message: `Phase ${phase} 不是裁决 Phase。只有 Phase ${TRIBUNAL_PHASES.join("/")} 需要通过 auto_dev_submit 提交。`,
        });
    }
    const sm = new StateManager(projectRoot, topic);
    const state = await sm.loadAndValidate();
    // Verify current phase matches
    if (state.phase !== phase) {
        return textResult({
            error: "PHASE_MISMATCH",
            message: `当前 Phase 为 ${state.phase}，但提交的是 Phase ${phase}。请确认 Phase 是否正确。`,
        });
    }
    // Track submit count: max 3 attempts before escalation
    const phaseKey = String(phase);
    const submits = state.tribunalSubmits ?? {};
    const currentCount = submits[phaseKey] ?? 0;
    if (currentCount >= 3) {
        return textResult({
            status: "TRIBUNAL_ESCALATE",
            phase,
            message: `Phase ${phase} 已提交 ${currentCount} 次裁决均未通过。需要人工介入。`,
            mandate: "已达到最大裁决提交次数（3次），请人工审查后决定是否继续。",
        });
    }
    // Increment submit counter (stored in tribunalSubmits record)
    const updatedSubmits = { ...submits, [phaseKey]: currentCount + 1 };
    await sm.atomicUpdate({ tribunalSubmits: updatedSubmits });
    // Execute tribunal
    const outputDir = sm.outputDir;
    const tribunalResult = await executeTribunal(projectRoot, outputDir, phase, topic, summary, sm, state);
    // Convert tribunal ToolResult to MCP-compatible format
    return { content: tribunalResult.content };
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