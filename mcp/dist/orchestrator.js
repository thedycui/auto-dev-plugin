/**
 * orchestrator.ts — Core loop for the invisible framework.
 *
 * Drives the auto-dev pipeline by spawning isolated task agents per phase.
 * Task agents receive pure task prompts with ZERO framework awareness.
 * All validation, state management, and phase progression happens here.
 */
import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnAgent } from "./agent-spawner.js";
import { buildRevisionPrompt, translateFailureToFeedback, containsFrameworkTerms, } from "./orchestrator-prompts.js";
import { StateManager, internalCheckpoint, extractTaskList } from "./state-manager.js";
import { validatePhase1ReviewArtifact, validatePhase2ReviewArtifact, checkIterationLimit, } from "./phase-enforcer.js";
import { executeTribunal } from "./tribunal.js";
import { TemplateRenderer } from "./template-renderer.js";
// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const MAX_ITERATIONS = {
    1: 3, 2: 3, 3: 2, 4: 3, 5: 3, 6: 3, 7: 2,
};
const ISOLATION_FOOTER = "\n---\n完成后不需要做其他操作。直接完成任务即可。\n";
const SKILLS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "skills", "auto-dev");
// ---------------------------------------------------------------------------
// Model Routing
// ---------------------------------------------------------------------------
function getModel(phase, costMode) {
    if (costMode === "beast")
        return "opus";
    if ([1, 3, 4].includes(phase))
        return "opus"; // critical phases
    return "sonnet";
}
// ---------------------------------------------------------------------------
// OrchestratorPhaseRunner
// ---------------------------------------------------------------------------
export class OrchestratorPhaseRunner {
    ctx;
    renderer;
    constructor(ctx) {
        this.ctx = ctx;
        this.renderer = new TemplateRenderer(SKILLS_DIR);
    }
    // -----------------------------------------------------------------------
    // Private helpers
    // -----------------------------------------------------------------------
    async renderPrompt(promptFile, extraContext) {
        const variables = {
            topic: this.ctx.topic,
            output_dir: this.ctx.outputDir,
            project_root: this.ctx.projectRoot,
            build_cmd: this.ctx.buildCmd,
            test_cmd: this.ctx.testCmd,
        };
        const { renderedPrompt } = await this.renderer.render(promptFile, variables, extraContext);
        return renderedPrompt + ISOLATION_FOOTER;
    }
    async spawn(prompt, model) {
        return spawnAgent({
            prompt,
            model: model ?? "sonnet",
            cwd: this.ctx.projectRoot,
        });
    }
    shell(cmd, cwd, timeout = 300_000) {
        return new Promise((resolve) => {
            execFile("sh", ["-c", cmd], {
                cwd,
                timeout,
                maxBuffer: 5 * 1024 * 1024,
            }, (err, stdout, stderr) => {
                const exitCode = err ? (err.code ?? 1) : 0;
                resolve({
                    stdout: stdout || "",
                    stderr: stderr || "",
                    exitCode: typeof exitCode === "number" ? exitCode : 1,
                });
            });
        });
    }
    async fileExists(path) {
        try {
            await stat(path);
            return true;
        }
        catch {
            return false;
        }
    }
    async readFileSafe(path) {
        try {
            return await readFile(path, "utf-8");
        }
        catch {
            return null;
        }
    }
    // -----------------------------------------------------------------------
    // Phase 1: Design
    // -----------------------------------------------------------------------
    async executeDesign() {
        const prompt = await this.renderPrompt("phase1-architect");
        const model = getModel(1, this.ctx.costMode ?? "economy");
        await this.spawn(prompt, model);
        const designPath = join(this.ctx.outputDir, "design.md");
        const content = await this.readFileSafe(designPath);
        if (!content || content.length < 100) {
            return {
                status: "NEEDS_REVISION",
                feedback: "design.md 不存在或内容不足（< 100 字符），请补充完整的设计方案。",
            };
        }
        return { status: "ARTIFACT_READY", artifacts: [designPath] };
    }
    // -----------------------------------------------------------------------
    // Phase 1 Review: Design Review
    // -----------------------------------------------------------------------
    async executeDesignReview() {
        const prompt = await this.renderPrompt("phase1-design-reviewer");
        await this.spawn(prompt, "sonnet");
        const reviewPath = join(this.ctx.outputDir, "design-review.md");
        const content = await this.readFileSafe(reviewPath);
        const validation = validatePhase1ReviewArtifact(content);
        if (!validation.valid) {
            return {
                status: "NEEDS_REVISION",
                feedback: validation.errors.join(" "),
            };
        }
        // Parse verdict from review content
        if (content && /\bREJECT\b/i.test(content)) {
            const feedbackMatch = content.match(/##\s*(?:反馈|Feedback|问题|Issues)\s*\n([\s\S]*?)(?=\n##|$)/);
            const feedback = feedbackMatch?.[1]?.trim() ?? "设计审查未通过，请根据审查意见修订设计方案。";
            return { status: "NEEDS_REVISION", feedback };
        }
        return { status: "PASS" };
    }
    // -----------------------------------------------------------------------
    // Phase 2: Plan
    // -----------------------------------------------------------------------
    async executePlan() {
        const prompt = await this.renderPrompt("phase2-planner");
        await this.spawn(prompt, "sonnet");
        const planPath = join(this.ctx.outputDir, "plan.md");
        const exists = await this.fileExists(planPath);
        if (!exists) {
            return {
                status: "NEEDS_REVISION",
                feedback: "plan.md 不存在，请生成完整的实施计划。",
            };
        }
        return { status: "ARTIFACT_READY", artifacts: [planPath] };
    }
    // -----------------------------------------------------------------------
    // Phase 2 Review: Plan Review
    // -----------------------------------------------------------------------
    async executePlanReview() {
        const prompt = await this.renderPrompt("phase2-plan-reviewer");
        await this.spawn(prompt, "sonnet");
        const reviewPath = join(this.ctx.outputDir, "plan-review.md");
        const content = await this.readFileSafe(reviewPath);
        const validation = validatePhase2ReviewArtifact(content);
        if (!validation.valid) {
            return {
                status: "NEEDS_REVISION",
                feedback: validation.errors.join(" "),
            };
        }
        if (content && /\bREJECT\b/i.test(content)) {
            const feedbackMatch = content.match(/##\s*(?:反馈|Feedback|问题|Issues)\s*\n([\s\S]*?)(?=\n##|$)/);
            const feedback = feedbackMatch?.[1]?.trim() ?? "计划审查未通过，请根据审查意见修订实施计划。";
            return { status: "NEEDS_REVISION", feedback };
        }
        return { status: "PASS" };
    }
    // -----------------------------------------------------------------------
    // Phase 3: Implementation
    // -----------------------------------------------------------------------
    async executeImplementation() {
        const planPath = join(this.ctx.outputDir, "plan.md");
        const planContent = await this.readFileSafe(planPath);
        if (!planContent) {
            return {
                status: "NEEDS_REVISION",
                feedback: "plan.md 不存在，无法解析任务列表。",
            };
        }
        const taskListStr = extractTaskList(planContent);
        const taskLines = taskListStr.split("\n").filter((l) => l.trim().length > 0);
        if (taskLines.length === 0) {
            // No structured tasks found — treat entire plan as single task
            taskLines.push("实现 plan.md 中描述的所有功能");
        }
        const model = getModel(3, this.ctx.costMode ?? "economy");
        for (let i = 0; i < taskLines.length; i++) {
            const taskDesc = taskLines[i];
            const taskPrompt = `请完成以下任务：\n\n${taskDesc}\n\n项目根目录: ${this.ctx.projectRoot}\n输出目录: ${this.ctx.outputDir}` + ISOLATION_FOOTER;
            await this.spawn(taskPrompt, model);
            // Run build + test after each task
            const buildResult = await this.shell(this.ctx.buildCmd, this.ctx.projectRoot);
            if (buildResult.exitCode !== 0) {
                const fixPrompt = `编译失败，错误信息如下：\n\n${buildResult.stdout}\n${buildResult.stderr}\n\n请修复编译错误。` + ISOLATION_FOOTER;
                await this.spawn(fixPrompt, model);
                // Verify fix
                const retryBuild = await this.shell(this.ctx.buildCmd, this.ctx.projectRoot);
                if (retryBuild.exitCode !== 0) {
                    return {
                        status: "NEEDS_REVISION",
                        feedback: translateFailureToFeedback("BUILD_FAILED", retryBuild.stdout + "\n" + retryBuild.stderr),
                    };
                }
            }
            const testResult = await this.shell(this.ctx.testCmd, this.ctx.projectRoot);
            if (testResult.exitCode !== 0) {
                const fixPrompt = `测试失败，错误信息如下：\n\n${testResult.stdout}\n${testResult.stderr}\n\n请修复测试失败。` + ISOLATION_FOOTER;
                await this.spawn(fixPrompt, model);
                const retryTest = await this.shell(this.ctx.testCmd, this.ctx.projectRoot);
                if (retryTest.exitCode !== 0) {
                    return {
                        status: "NEEDS_REVISION",
                        feedback: translateFailureToFeedback("TEST_FAILED", retryTest.stdout + "\n" + retryTest.stderr),
                    };
                }
            }
        }
        return { status: "PASS" };
    }
    // -----------------------------------------------------------------------
    // Phase 4: Verify
    // -----------------------------------------------------------------------
    async executeVerify(sm, state) {
        // Run build + test
        const buildResult = await this.shell(this.ctx.buildCmd, this.ctx.projectRoot);
        if (buildResult.exitCode !== 0) {
            return {
                status: "NEEDS_REVISION",
                feedback: translateFailureToFeedback("BUILD_FAILED", buildResult.stdout + "\n" + buildResult.stderr),
            };
        }
        const testResult = await this.shell(this.ctx.testCmd, this.ctx.projectRoot);
        if (testResult.exitCode !== 0) {
            return {
                status: "NEEDS_REVISION",
                feedback: translateFailureToFeedback("TEST_FAILED", testResult.stdout + "\n" + testResult.stderr),
            };
        }
        // Run tribunal
        const tribunalResult = await executeTribunal(this.ctx.projectRoot, this.ctx.outputDir, 4, this.ctx.topic, "Phase 4 verify", sm, state);
        return this.parseTribunalResult(tribunalResult);
    }
    // -----------------------------------------------------------------------
    // Phase 5: E2E Test
    // -----------------------------------------------------------------------
    async executeE2ETest(sm, state) {
        // Test architect
        const architectPrompt = await this.renderPrompt("phase5-test-architect");
        await this.spawn(architectPrompt, "sonnet");
        // Test developer
        const developerPrompt = await this.renderPrompt("phase5-test-developer");
        await this.spawn(developerPrompt, "sonnet");
        // Run tests
        const testResult = await this.shell(this.ctx.testCmd, this.ctx.projectRoot);
        if (testResult.exitCode !== 0) {
            return {
                status: "NEEDS_REVISION",
                feedback: translateFailureToFeedback("TEST_FAILED", testResult.stdout + "\n" + testResult.stderr),
            };
        }
        // Run tribunal
        const tribunalResult = await executeTribunal(this.ctx.projectRoot, this.ctx.outputDir, 5, this.ctx.topic, "Phase 5 E2E test", sm, state);
        return this.parseTribunalResult(tribunalResult);
    }
    // -----------------------------------------------------------------------
    // Phase 6: Acceptance
    // -----------------------------------------------------------------------
    async executeAcceptance(sm, state) {
        const prompt = await this.renderPrompt("phase6-acceptance");
        await this.spawn(prompt, "sonnet");
        const tribunalResult = await executeTribunal(this.ctx.projectRoot, this.ctx.outputDir, 6, this.ctx.topic, "Phase 6 acceptance", sm, state);
        return this.parseTribunalResult(tribunalResult);
    }
    // -----------------------------------------------------------------------
    // Phase 7: Retrospective
    // -----------------------------------------------------------------------
    async executeRetrospective(sm, state) {
        const prompt = await this.renderPrompt("phase7-retrospective");
        await this.spawn(prompt, "sonnet");
        const tribunalResult = await executeTribunal(this.ctx.projectRoot, this.ctx.outputDir, 7, this.ctx.topic, "Phase 7 retrospective", sm, state);
        return this.parseTribunalResult(tribunalResult);
    }
    // -----------------------------------------------------------------------
    // Tribunal result parser
    // -----------------------------------------------------------------------
    parseTribunalResult(toolResult) {
        const text = toolResult.content[0]?.text;
        if (!text) {
            return { status: "NEEDS_REVISION", feedback: "Tribunal returned empty result." };
        }
        let parsed;
        try {
            parsed = JSON.parse(text);
        }
        catch {
            return { status: "NEEDS_REVISION", feedback: "Failed to parse tribunal result." };
        }
        if (parsed.status === "TRIBUNAL_PASS") {
            return { status: "PASS" };
        }
        if (parsed.status === "TRIBUNAL_FAIL" || parsed.status === "TRIBUNAL_OVERRIDDEN") {
            const detail = parsed.issues
                ? JSON.stringify(parsed.issues)
                : (parsed.message ?? "Tribunal failed.");
            return {
                status: "NEEDS_REVISION",
                feedback: translateFailureToFeedback(parsed.status === "TRIBUNAL_FAIL" ? "TRIBUNAL_FAIL" : "TRIBUNAL_OVERRIDDEN", detail),
            };
        }
        // TRIBUNAL_PENDING (crash)
        return {
            status: "NEEDS_REVISION",
            feedback: translateFailureToFeedback("TRIBUNAL_FAIL", parsed.message ?? "Tribunal process crashed."),
        };
    }
}
// ---------------------------------------------------------------------------
// runOrchestrator — Main loop
// ---------------------------------------------------------------------------
export async function runOrchestrator(config) {
    // 1. Load state
    const sm = new StateManager(config.projectRoot, config.topic);
    const state = await sm.loadAndValidate();
    // 2. Build PhaseContext
    const ctx = {
        projectRoot: state.projectRoot,
        outputDir: sm.outputDir,
        topic: config.topic,
        mode: config.mode,
        buildCmd: state.stack.buildCmd,
        testCmd: state.stack.testCmd,
        startCommit: state.startCommit ?? "HEAD",
        costMode: config.costMode,
        tdd: config.tdd,
        skipE2e: config.skipE2e,
    };
    const runner = new OrchestratorPhaseRunner(ctx);
    // 3. Determine required phases based on mode
    let phases;
    if (config.mode === "full") {
        phases = [1, 2, 3, 4, 5, 6, 7];
    }
    else if (config.mode === "quick") {
        phases = [3, 4, 5, 7];
    }
    else {
        // turbo
        phases = [3];
    }
    // 4. Filter out phase 5 if skipE2e
    if (config.skipE2e) {
        phases = phases.filter((p) => p !== 5);
    }
    // 5. Execute phases
    const iterations = {};
    for (const phase of phases) {
        iterations[phase] = 0;
        // Write IN_PROGRESS checkpoint
        await internalCheckpoint(sm, await sm.loadAndValidate(), phase, "IN_PROGRESS");
        let result;
        // Phase dispatch with review sub-phases
        if (phase === 1) {
            result = await executePhaseWithReview(runner, sm, phase, iterations, () => runner.executeDesign(), () => runner.executeDesignReview(), config);
        }
        else if (phase === 2) {
            result = await executePhaseWithReview(runner, sm, phase, iterations, () => runner.executePlan(), () => runner.executePlanReview(), config);
        }
        else if (phase === 3) {
            result = await executePhaseWithRetry(runner, sm, phase, iterations, () => runner.executeImplementation(), config);
        }
        else if (phase === 4) {
            result = await executePhaseWithRetry(runner, sm, phase, iterations, async () => runner.executeVerify(sm, await sm.loadAndValidate()), config);
        }
        else if (phase === 5) {
            result = await executePhaseWithRetry(runner, sm, phase, iterations, async () => runner.executeE2ETest(sm, await sm.loadAndValidate()), config);
        }
        else if (phase === 6) {
            result = await executePhaseWithRetry(runner, sm, phase, iterations, async () => runner.executeAcceptance(sm, await sm.loadAndValidate()), config);
        }
        else if (phase === 7) {
            result = await executePhaseWithRetry(runner, sm, phase, iterations, async () => runner.executeRetrospective(sm, await sm.loadAndValidate()), config);
        }
        else {
            result = { status: "BLOCKED", feedback: `Unknown phase ${phase}` };
        }
        // Handle result
        if (result.status === "BLOCKED") {
            return {
                completed: false,
                phase,
                status: "BLOCKED",
                message: result.feedback ?? `Phase ${phase} is blocked.`,
                escalation: {
                    reason: "iteration_limit_exceeded",
                    lastFeedback: result.feedback ?? "",
                },
            };
        }
        if (result.status === "NEEDS_REVISION") {
            return {
                completed: false,
                phase,
                status: "NEEDS_REVISION",
                message: result.feedback ?? `Phase ${phase} needs revision.`,
            };
        }
        // PASS — write checkpoint
        await internalCheckpoint(sm, await sm.loadAndValidate(), phase, "PASS");
    }
    // 6. All phases complete
    return {
        completed: true,
        phase: phases[phases.length - 1] ?? 0,
        status: "COMPLETED",
        message: "All phases completed successfully.",
    };
}
// ---------------------------------------------------------------------------
// Phase execution helpers
// ---------------------------------------------------------------------------
async function executePhaseWithReview(runner, sm, phase, iterations, executeFn, reviewFn, config) {
    const maxIter = MAX_ITERATIONS[phase] ?? 3;
    while (iterations[phase] < maxIter) {
        const result = await executeFn();
        if (result.status === "NEEDS_REVISION") {
            iterations[phase] = (iterations[phase] ?? 0) + 1;
            const iterCheck = checkIterationLimit(phase, iterations[phase], config.interactive ?? false);
            if (!iterCheck.allowed) {
                return { status: "BLOCKED", feedback: iterCheck.message };
            }
            // Re-spawn with revision prompt
            continue;
        }
        if (result.status === "ARTIFACT_READY") {
            // Run review
            const reviewResult = await reviewFn();
            if (reviewResult.status === "PASS") {
                return { status: "PASS" };
            }
            if (reviewResult.status === "NEEDS_REVISION") {
                iterations[phase] = (iterations[phase] ?? 0) + 1;
                const iterCheck = checkIterationLimit(phase, iterations[phase], config.interactive ?? false);
                if (!iterCheck.allowed) {
                    return { status: "BLOCKED", feedback: iterCheck.message };
                }
                // Continue to re-execute
                continue;
            }
        }
        if (result.status === "PASS") {
            return { status: "PASS" };
        }
        // BLOCKED
        return result;
    }
    return {
        status: "BLOCKED",
        feedback: `Phase ${phase} exceeded maximum iterations (${maxIter}).`,
    };
}
async function executePhaseWithRetry(_runner, _sm, phase, iterations, executeFn, config) {
    const maxIter = MAX_ITERATIONS[phase] ?? 3;
    while (iterations[phase] < maxIter) {
        const result = await executeFn();
        if (result.status === "PASS") {
            return { status: "PASS" };
        }
        if (result.status === "NEEDS_REVISION") {
            iterations[phase] = (iterations[phase] ?? 0) + 1;
            const iterCheck = checkIterationLimit(phase, iterations[phase], config.interactive ?? false);
            if (!iterCheck.allowed) {
                return { status: "BLOCKED", feedback: iterCheck.message };
            }
            continue;
        }
        // BLOCKED or other
        return result;
    }
    return {
        status: "BLOCKED",
        feedback: `Phase ${phase} exceeded maximum iterations (${maxIter}).`,
    };
}
//# sourceMappingURL=orchestrator.js.map