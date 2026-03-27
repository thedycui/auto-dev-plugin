/**
 * orchestrator.ts — Step-function orchestrator for auto-dev.
 *
 * Exports `computeNextTask()` which is called once per step by the main agent.
 * Each call validates the previous step's artifacts, then returns the next
 * task prompt for the main agent to dispatch via Agent() subagent.
 *
 * No agent spawning happens here — the orchestrator only computes prompts.
 */
import { execFile } from "node:child_process";
import { readFile, stat, writeFile } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildRevisionPrompt, translateFailureToFeedback, containsFrameworkTerms, parseApproachPlan, extractOneLineReason, buildCircuitBreakPrompt, } from "./orchestrator-prompts.js";
import { StateManager, extractTaskList } from "./state-manager.js";
import { validatePhase1ReviewArtifact, validatePhase2ReviewArtifact, } from "./phase-enforcer.js";
import { evaluateTribunal } from "./tribunal.js";
import { TemplateRenderer } from "./template-renderer.js";
// ---------------------------------------------------------------------------
// Design Doc Compliance Check
// ---------------------------------------------------------------------------
/**
 * Check if an existing design.md already has the required sections for auto-dev.
 * Required: AC table (≥3 AC-N entries) + solution comparison (≥2 solutions).
 * If compliant, Phase 1a (architect rewrite) can be skipped — go straight to 1b (review).
 */
export function checkDesignDocCompliance(content) {
    const missing = [];
    // Check AC table: look for "AC-N" pattern (at least 3)
    const acMatches = content.match(/AC-\d+/g);
    if (!acMatches || acMatches.length < 3) {
        missing.push(`验收标准不足（需要 ≥3 条 AC-N，当前 ${acMatches?.length ?? 0} 条）`);
    }
    // Check solution comparison: look for "方案" with A/B/1/2 or comparison table
    const hasSolutionComparison = /方案\s*[A-Z12]|方案选型|方案对比|方案设计/.test(content) &&
        (content.includes("|") && /\|.*方案.*\|/.test(content)); // table with "方案"
    if (!hasSolutionComparison) {
        missing.push("缺少方案对比（需要 ≥2 个方案的对比表格）");
    }
    return { compliant: missing.length === 0, missing };
}
// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const MAX_STEP_ITERATIONS = 3;
const MAX_APPROACH_FAILURES = 2;
const PHASE_SEQUENCE = {
    full: [1, 2, 3, 4, 5, 6, 7],
    quick: [3, 4, 5, 7],
    turbo: [3],
};
const STEP_AGENTS = {
    "1a": "auto-dev-architect",
    "1b": "auto-dev-reviewer",
    "1c": "auto-dev-architect",
    "2a": "auto-dev-architect",
    "2b": "auto-dev-reviewer",
    "2c": "auto-dev-architect",
    "3": "auto-dev-developer",
    "4a": "auto-dev-developer",
    "5a": "auto-dev-test-architect",
    "5b": "auto-dev-developer",
    "5c": "auto-dev-developer",
    "6": "auto-dev-acceptance-validator",
    "7": "auto-dev-reviewer",
    "8a": "auto-dev-developer",
    "8b": "auto-dev-developer",
    "8c": "auto-dev-developer",
    "8d": "auto-dev-developer",
};
/** Ordered step transitions (happy path) */
const STEP_ORDER = ["1a", "1b", "2a", "2b", "3", "4a", "5a", "5b", "6", "7", "8a", "8b", "8c", "8d"];
const ISOLATION_FOOTER = "\n\n---\n完成后不需要做其他操作。直接完成任务即可。\n";
const SKILLS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "skills", "auto-dev");
// ---------------------------------------------------------------------------
// Model Routing
// ---------------------------------------------------------------------------
export function getModel(phase, costMode) {
    if (costMode === "beast")
        return "opus";
    if ([1, 3, 4].includes(phase))
        return "opus"; // critical phases
    return "sonnet";
}
// ---------------------------------------------------------------------------
// File Helpers
// ---------------------------------------------------------------------------
export async function fileExists(path) {
    try {
        await stat(path);
        return true;
    }
    catch {
        return false;
    }
}
export async function readFileSafe(path) {
    try {
        return await readFile(path, "utf-8");
    }
    catch {
        return null;
    }
}
// ---------------------------------------------------------------------------
// Shell Helper
// ---------------------------------------------------------------------------
export function shell(cmd, cwd, timeout = 300_000) {
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
// ---------------------------------------------------------------------------
// Prompt Rendering
// ---------------------------------------------------------------------------
export async function renderPrompt(promptFile, variables, extraContext) {
    const renderer = new TemplateRenderer(SKILLS_DIR);
    const { renderedPrompt } = await renderer.render(promptFile, variables, extraContext);
    return renderedPrompt + ISOLATION_FOOTER;
}
// ---------------------------------------------------------------------------
// Tribunal Result Parser
// ---------------------------------------------------------------------------
/** @deprecated No longer used — tribunal results handled directly via EvalTribunalResult */
export function parseTribunalResult(toolResult) {
    const text = toolResult.content[0]?.text;
    if (!text) {
        return { passed: false, feedback: "Tribunal returned empty result." };
    }
    let parsed;
    try {
        parsed = JSON.parse(text);
    }
    catch {
        return { passed: false, feedback: "Failed to parse tribunal result." };
    }
    if (parsed.status === "TRIBUNAL_PASS") {
        return { passed: true, feedback: "" };
    }
    if (parsed.status === "TRIBUNAL_FAIL" || parsed.status === "TRIBUNAL_OVERRIDDEN") {
        const detail = parsed.issues
            ? JSON.stringify(parsed.issues)
            : (parsed.message ?? "Tribunal failed.");
        const feedback = translateFailureToFeedback(parsed.status === "TRIBUNAL_FAIL" ? "TRIBUNAL_FAIL" : "TRIBUNAL_OVERRIDDEN", detail);
        return { passed: false, feedback };
    }
    // TRIBUNAL_PENDING (crash)
    return {
        passed: false,
        feedback: translateFailureToFeedback("TRIBUNAL_FAIL", parsed.message ?? "Tribunal process crashed."),
    };
}
async function readStepState(stateFilePath) {
    try {
        const raw = JSON.parse(await readFile(stateFilePath, "utf-8"));
        return {
            step: raw.step ?? null,
            stepIteration: raw.stepIteration ?? 0,
            lastValidation: raw.lastValidation ?? null,
            approachState: raw.approachState ?? null,
        };
    }
    catch {
        return { step: null, stepIteration: 0, lastValidation: null, approachState: null };
    }
}
// ---------------------------------------------------------------------------
// Phase / Step Helpers
// ---------------------------------------------------------------------------
/** Extract the phase number from a step string (e.g. "1a" -> 1, "3" -> 3) */
export function phaseForStep(step) {
    return parseInt(step.replace(/[a-z]/g, ""), 10);
}
/** Return the first sub-step for a given phase */
export function firstStepForPhase(phase) {
    const map = {
        1: "1a", 2: "2a", 3: "3", 4: "4a", 5: "5a", 6: "6", 7: "7", 8: "8a",
    };
    return map[phase] ?? String(phase);
}
/**
 * Compute the next step in sequence, skipping steps whose phase
 * is not in the mode's phase sequence.
 */
export function computeNextStep(currentStep, phases) {
    const idx = STEP_ORDER.indexOf(currentStep);
    if (idx < 0)
        return null;
    for (let i = idx + 1; i < STEP_ORDER.length; i++) {
        const candidate = STEP_ORDER[i];
        const candidatePhase = phaseForStep(candidate);
        if (phases.includes(candidatePhase)) {
            return candidate;
        }
    }
    return null; // all done
}
// ---------------------------------------------------------------------------
// Circuit Breaker — approach failure handling
// ---------------------------------------------------------------------------
/** Extract the goal for a given step from plan.md */
async function getStepGoal(step, outputDir) {
    const planPath = join(outputDir, "plan.md");
    const content = await readFileSafe(planPath);
    if (!content)
        return `完成步骤 ${step} 的任务`;
    // Try to find a task section matching the step number
    const phase = parseInt(step.replace(/[a-z]/g, ""), 10);
    // Look for "## Task N:" or similar patterns
    const taskRegex = new RegExp(`## Task\\s+${phase}[^\\n]*\\n([\\s\\S]*?)(?=\\n## |$)`, "i");
    const match = content.match(taskRegex);
    if (match) {
        // Extract the description line (first line after heading)
        const descLine = match[1].split("\n").map((l) => l.trim()).filter((l) => l.length > 0)[0];
        if (descLine)
            return descLine;
    }
    return `完成步骤 ${step} 的任务`;
}
export async function handleApproachFailure(stepState, step, outputDir, feedback) {
    let approachState = stepState.approachState;
    // First failure with no approach state: try to parse approach-plan.md
    if (!approachState) {
        const planPath = join(outputDir, "approach-plan.md");
        const planContent = await readFileSafe(planPath);
        if (!planContent) {
            return { action: "CONTINUE" };
        }
        const approaches = parseApproachPlan(planContent);
        if (!approaches) {
            return {
                action: "CONTINUE",
                planFeedback: "你的 approach-plan.md 缺少备选方案。请补充至少 1 个与主方案技术路径有本质区别的备选方案（换参数/换 flag 不算，换工具/换思路才算）。",
            };
        }
        approachState = {
            stepId: step,
            approaches,
            currentIndex: 0,
            failedApproaches: [],
        };
    }
    // Increment current approach failCount
    const current = approachState.approaches[approachState.currentIndex];
    if (!current) {
        return { action: "ALL_EXHAUSTED" };
    }
    current.failCount++;
    // Below threshold: continue with revision
    if (current.failCount < MAX_APPROACH_FAILURES) {
        return { action: "CONTINUE", approachState };
    }
    // Threshold reached: circuit break current approach
    approachState.failedApproaches.push({
        id: current.id,
        summary: current.summary,
        failReason: extractOneLineReason(feedback),
    });
    approachState.currentIndex++;
    // Check if there are more approaches
    if (approachState.currentIndex >= approachState.approaches.length) {
        return { action: "ALL_EXHAUSTED" };
    }
    const next = approachState.approaches[approachState.currentIndex];
    const goal = await getStepGoal(step, outputDir);
    // Build clean prompt
    const prompt = buildCircuitBreakPrompt({
        goal,
        approach: next.summary,
        prohibited: approachState.failedApproaches,
        outputDir,
    });
    return {
        action: "CIRCUIT_BREAK",
        prompt,
        approachState,
        failedApproach: current.summary,
        nextApproach: next.summary,
    };
}
// ---------------------------------------------------------------------------
// Step Validation
// ---------------------------------------------------------------------------
export async function validateStep(step, outputDir, projectRoot, buildCmd, testCmd, sm, state, topic) {
    switch (step) {
        case "1a": {
            const designPath = join(outputDir, "design.md");
            const content = await readFileSafe(designPath);
            if (!content || content.length < 100) {
                return {
                    passed: false,
                    feedback: "design.md 不存在或内容不足（< 100 字符），请补充完整的设计方案。",
                };
            }
            return { passed: true, feedback: "" };
        }
        case "1b": {
            const reviewPath = join(outputDir, "design-review.md");
            const content = await readFileSafe(reviewPath);
            const validation = validatePhase1ReviewArtifact(content);
            if (!validation.valid) {
                return { passed: false, feedback: validation.errors.join(" ") };
            }
            if (content && /\bREJECT\b/i.test(content)) {
                const feedbackMatch = content.match(/##\s*(?:反馈|Feedback|问题|Issues)\s*\n([\s\S]*?)(?=\n##|$)/);
                const feedback = feedbackMatch?.[1]?.trim() ?? "设计审查未通过，请根据审查意见修订设计方案。";
                return { passed: false, feedback };
            }
            return { passed: true, feedback: "" };
        }
        case "2a": {
            const planPath = join(outputDir, "plan.md");
            const exists = await fileExists(planPath);
            if (!exists) {
                return { passed: false, feedback: "plan.md 不存在，请生成完整的实施计划。" };
            }
            return { passed: true, feedback: "" };
        }
        case "2b": {
            const reviewPath = join(outputDir, "plan-review.md");
            const content = await readFileSafe(reviewPath);
            const validation = validatePhase2ReviewArtifact(content);
            if (!validation.valid) {
                return { passed: false, feedback: validation.errors.join(" ") };
            }
            if (content && /\bREJECT\b/i.test(content)) {
                const feedbackMatch = content.match(/##\s*(?:反馈|Feedback|问题|Issues)\s*\n([\s\S]*?)(?=\n##|$)/);
                const feedback = feedbackMatch?.[1]?.trim() ?? "计划审查未通过，请根据审查意见修订实施计划。";
                return { passed: false, feedback };
            }
            return { passed: true, feedback: "" };
        }
        case "3": {
            // Build + test
            const buildResult = await shell(buildCmd, projectRoot);
            if (buildResult.exitCode !== 0) {
                return {
                    passed: false,
                    feedback: translateFailureToFeedback("BUILD_FAILED", buildResult.stdout + "\n" + buildResult.stderr),
                };
            }
            const testResult = await shell(testCmd, projectRoot);
            if (testResult.exitCode !== 0) {
                return {
                    passed: false,
                    feedback: translateFailureToFeedback("TEST_FAILED", testResult.stdout + "\n" + testResult.stderr),
                };
            }
            return { passed: true, feedback: "" };
        }
        case "4a": {
            // Build + test first
            const buildResult = await shell(buildCmd, projectRoot);
            if (buildResult.exitCode !== 0) {
                return {
                    passed: false,
                    feedback: translateFailureToFeedback("BUILD_FAILED", buildResult.stdout + "\n" + buildResult.stderr),
                };
            }
            const testResult = await shell(testCmd, projectRoot);
            if (testResult.exitCode !== 0) {
                return {
                    passed: false,
                    feedback: translateFailureToFeedback("TEST_FAILED", testResult.stdout + "\n" + testResult.stderr),
                };
            }
            // Tribunal (pure evaluation — no state side effects)
            const eval4 = await evaluateTribunal(projectRoot, outputDir, 4, topic, "Phase 4 verify", state.startCommit);
            return {
                passed: eval4.verdict === "PASS",
                feedback: eval4.verdict === "FAIL"
                    ? eval4.issues.map(i => `[${i.severity}] ${i.description}`).join("\n")
                    : "",
                tribunalResult: eval4,
            };
        }
        case "5a": {
            // Just check that test design output exists (pass through)
            return { passed: true, feedback: "" };
        }
        case "5b": {
            // Run tests first
            const testResult5 = await shell(testCmd, projectRoot);
            if (testResult5.exitCode !== 0) {
                return {
                    passed: false,
                    feedback: translateFailureToFeedback("TEST_FAILED", testResult5.stdout + "\n" + testResult5.stderr),
                };
            }
            const eval5 = await evaluateTribunal(projectRoot, outputDir, 5, topic, "Phase 5 E2E test", state.startCommit);
            return {
                passed: eval5.verdict === "PASS",
                feedback: eval5.verdict === "FAIL"
                    ? eval5.issues.map(i => `[${i.severity}] ${i.description}`).join("\n")
                    : "",
                tribunalResult: eval5,
            };
        }
        case "6": {
            const eval6 = await evaluateTribunal(projectRoot, outputDir, 6, topic, "Phase 6 acceptance", state.startCommit);
            return {
                passed: eval6.verdict === "PASS",
                feedback: eval6.verdict === "FAIL"
                    ? eval6.issues.map(i => `[${i.severity}] ${i.description}`).join("\n")
                    : "",
                tribunalResult: eval6,
            };
        }
        case "7": {
            // Phase 7 (retrospective) — no tribunal, just check retrospective.md exists
            const retroContent = await readFileSafe(join(outputDir, "retrospective.md"));
            if (!retroContent || retroContent.split("\n").length < 30) {
                return {
                    passed: false,
                    feedback: "retrospective.md 不存在或内容不足（< 30 行），请补充完整的复盘报告。",
                };
            }
            return { passed: true, feedback: "" };
        }
        // Phase 8: Ship (delivery verification) — no tribunal
        case "8a": {
            // Check all commits are pushed
            try {
                const gitResult = await shell("git log --oneline --branches --not --remotes", projectRoot, 10_000);
                if (gitResult.exitCode !== 0) {
                    return { passed: false, feedback: `git 命令执行失败: ${gitResult.stderr}` };
                }
                const unpushed = gitResult.stdout.trim();
                if (unpushed.length > 0) {
                    return { passed: false, feedback: `存在未 push 的 commit:\n${unpushed}\n请执行 git push 推送所有变更。` };
                }
            }
            catch (err) {
                return { passed: false, feedback: `git 命令执行异常: ${err.message}` };
            }
            return { passed: true, feedback: "" };
        }
        case "8b": {
            const buildResultContent = await readFileSafe(join(outputDir, "ship-build-result.md"));
            if (!buildResultContent || !buildResultContent.includes("SUCCEED")) {
                return {
                    passed: false,
                    feedback: "ship-build-result.md 不存在或不含 'SUCCEED'，请确认构建成功后写入结果。",
                };
            }
            return { passed: true, feedback: "" };
        }
        case "8c": {
            const deployResultContent = await readFileSafe(join(outputDir, "ship-deploy-result.md"));
            if (!deployResultContent || !deployResultContent.includes("SUCCEED")) {
                return {
                    passed: false,
                    feedback: "ship-deploy-result.md 不存在或不含 'SUCCEED'，请确认部署成功后写入结果。",
                };
            }
            return { passed: true, feedback: "" };
        }
        case "8d": {
            const verifyContent = await readFileSafe(join(outputDir, "ship-verify-result.md"));
            if (!verifyContent) {
                return { passed: false, feedback: "ship-verify-result.md 不存在，请完成远程验证后写入结果。" };
            }
            if (verifyContent.includes("PASS")) {
                return { passed: true, feedback: "" };
            }
            if (verifyContent.includes("CODE_BUG")) {
                return {
                    passed: false,
                    feedback: "远程验证发现代码问题（CODE_BUG），需要回退到 Phase 3 修复。",
                    regressToPhase: 3,
                };
            }
            // ENV_ISSUE or other failure — no regress, escalate
            return {
                passed: false,
                feedback: "远程验证失败（ENV_ISSUE 或其他环境问题），需要人工介入排查环境。",
            };
        }
        default:
            return { passed: true, feedback: "" };
    }
}
// ---------------------------------------------------------------------------
// Build Task Prompt for Step
// ---------------------------------------------------------------------------
/**
 * Extract task details including completion criteria from plan.md.
 * Falls back to extractTaskList if parsing fails.
 */
function extractTaskDetails(planContent) {
    // Match ## Task N: title ... - **完成标准**: ...
    const taskPattern = /^## Task \d+[：:].+(?:\n(?!## Task).)*/gm;
    const matches = planContent.match(taskPattern);
    if (!matches || matches.length === 0) {
        // Fallback to simple task list
        const taskList = extractTaskList(planContent);
        return taskList || "实现 plan.md 中描述的所有功能";
    }
    return matches.join("\n\n");
}
export async function buildTaskForStep(step, outputDir, projectRoot, topic, buildCmd, testCmd, feedback, extraVars) {
    const variables = {
        topic,
        output_dir: outputDir,
        project_root: projectRoot,
        build_cmd: buildCmd,
        test_cmd: testCmd,
        ...extraVars,
    };
    // Revision steps (1c, 2c, 5c) — build revision prompt
    if (step === "1c" && feedback) {
        return buildRevisionPrompt({
            originalTask: `设计方案：${topic}`,
            feedback,
            artifacts: [join(outputDir, "design.md")],
        }) + ISOLATION_FOOTER;
    }
    if (step === "2c" && feedback) {
        return buildRevisionPrompt({
            originalTask: `实施计划：${topic}`,
            feedback,
            artifacts: [join(outputDir, "plan.md")],
        }) + ISOLATION_FOOTER;
    }
    if (step === "5c" && feedback) {
        return buildRevisionPrompt({
            originalTask: `测试实现：${topic}`,
            feedback,
            artifacts: [],
        }) + ISOLATION_FOOTER;
    }
    // Approach plan instruction for steps that may need circuit breaker
    const APPROACH_PLAN_STEPS = ["3", "4a", "5b"];
    const approachPlanInstruction = APPROACH_PLAN_STEPS.includes(step)
        ? `\n\n## 执行前：方案计划\n\n在开始编码/测试之前，先输出方案计划到 ${outputDir}/approach-plan.md：\n\n1. 主方案 + 1~2 个备选方案\n2. 每个方案标注方法、核心工具、风险\n3. 备选方案应与主方案在技术路径上有本质区别\n   （换参数/换 flag 不算，换工具/换思路才算）\n`
        : "";
    // Map steps to prompt templates
    const stepToTemplate = {
        "1a": "phase1-architect",
        "1b": "phase1-design-reviewer",
        "2a": "phase2-planner",
        "2b": "phase2-plan-reviewer",
        "5a": "phase5-test-architect",
        "5b": "phase5-test-developer",
        "6": "phase6-acceptance",
        "7": "phase7-retrospective",
        "8a": "phase8-ship",
        "8b": "phase8-ship",
        "8c": "phase8-ship",
        "8d": "phase8-ship",
    };
    // Step 3: implementation — special handling
    if (step === "3") {
        const planPath = join(outputDir, "plan.md");
        const planContent = await readFileSafe(planPath);
        if (!planContent) {
            // Turbo mode without plan.md — use topic directly
            return `请实现以下功能：${topic}\n\n项目根目录: ${projectRoot}` + approachPlanInstruction + ISOLATION_FOOTER;
        }
        // Extract task details with completion criteria (task-level contract)
        const taskDetails = extractTaskDetails(planContent);
        return `请完成以下任务：\n\n${taskDetails}\n\n项目根目录: ${projectRoot}\n输出目录: ${outputDir}\n\n` +
            `**重要：每完成一个 task，先验证其完成标准是否满足，再开始下一个。**` +
            approachPlanInstruction + ISOLATION_FOOTER;
    }
    // Step 4a: implementation fix/verify
    if (step === "4a") {
        if (feedback) {
            return buildRevisionPrompt({
                originalTask: `代码验证：${topic}`,
                feedback,
                artifacts: [],
            }) + approachPlanInstruction + ISOLATION_FOOTER;
        }
        return `请检查并修复代码，确保编译和测试通过。\n\n项目根目录: ${projectRoot}` + approachPlanInstruction + ISOLATION_FOOTER;
    }
    const template = stepToTemplate[step];
    if (template) {
        const rendered = await renderPrompt(template, variables);
        return rendered + approachPlanInstruction;
    }
    // Fallback
    return `请完成步骤 ${step} 的任务。\n\n主题: ${topic}\n项目根目录: ${projectRoot}` + ISOLATION_FOOTER;
}
// ---------------------------------------------------------------------------
// computeNextTask — Main Step Function
// ---------------------------------------------------------------------------
export async function computeNextTask(projectRoot, topic) {
    // 1. Load state via StateManager
    const sm = new StateManager(projectRoot, topic);
    const state = await sm.loadAndValidate();
    const outputDir = sm.outputDir;
    const mode = state.mode;
    let phases = PHASE_SEQUENCE[mode] ?? [3];
    if (state.skipE2e === true) {
        phases = phases.filter(p => p !== 5);
    }
    if (state.ship === true) {
        phases = [...phases, 8];
    }
    const buildCmd = state.stack.buildCmd;
    const testCmd = state.stack.testCmd;
    // Ship extra variables for Phase 8 prompt rendering
    const shipExtraVars = state.ship === true
        ? {
            substep: "", // will be overridden per call
            deployTarget: state.deployTarget ?? "",
            deployBranch: state.deployBranch ?? "",
            deployEnv: state.deployEnv ?? "green",
            verifyMethod: state.verifyMethod ?? "",
            verifyEndpoint: state.verifyConfig?.endpoint ?? "",
            verifyExpectedPattern: state.verifyConfig?.expectedPattern ?? "",
            verifyLogPath: state.verifyConfig?.logPath ?? "",
            verifyLogKeyword: state.verifyConfig?.logKeyword ?? "",
            verifySshHost: state.verifyConfig?.sshHost ?? "",
        }
        : undefined;
    /** Build extraVars for a specific step, adding substep for Phase 8 */
    function getExtraVars(step) {
        if (shipExtraVars && step.startsWith("8")) {
            return { ...shipExtraVars, substep: step };
        }
        return undefined;
    }
    // 2. Read step state
    const stepState = await readStepState(sm.stateFilePath);
    // 3. If no step: determine first phase, set step, return first task prompt
    if (!stepState.step) {
        const firstPhase = phases[0];
        let firstStep = firstStepForPhase(firstPhase);
        // Skip Phase 1a if design doc already exists and is compliant
        // (has AC table with ≥3 entries + solution comparison)
        if (firstStep === "1a" && state.designDocBound) {
            const designContent = await readFileSafe(join(outputDir, "design.md"));
            if (designContent && designContent.length >= 100) {
                const { compliant } = checkDesignDocCompliance(designContent);
                if (compliant) {
                    // Design doc is compliant — skip 1a (architect rewrite), go to 1b (review)
                    firstStep = "1b";
                    await sm.atomicUpdate({
                        step: firstStep, stepIteration: 0, lastValidation: null,
                        phase: firstPhase, status: "IN_PROGRESS",
                    });
                    const prompt = await buildTaskForStep(firstStep, outputDir, projectRoot, topic, buildCmd, testCmd, undefined, getExtraVars(firstStep));
                    return {
                        done: false,
                        step: firstStep,
                        agent: STEP_AGENTS[firstStep] ?? null,
                        prompt,
                        message: `Design doc is compliant (has AC table + solution comparison). Skipping 1a, starting at 1b (review).`,
                    };
                }
            }
        }
        // Single atomicUpdate: step + phase
        await sm.atomicUpdate({
            step: firstStep, stepIteration: 0, lastValidation: null,
            phase: firstPhase, status: "IN_PROGRESS",
        });
        const prompt = await buildTaskForStep(firstStep, outputDir, projectRoot, topic, buildCmd, testCmd, undefined, getExtraVars(firstStep));
        return {
            done: false,
            step: firstStep,
            agent: STEP_AGENTS[firstStep] ?? null,
            prompt,
            message: `Starting step ${firstStep} (phase ${firstPhase}).`,
        };
    }
    // 4. Step exists — validate previous step's artifacts
    const currentStep = stepState.step;
    const currentIteration = stepState.stepIteration;
    const validation = await validateStep(currentStep, outputDir, projectRoot, buildCmd, testCmd, sm, state, topic);
    if (!validation.passed) {
        // --- Tribunal FAIL: handle counter + ESCALATE ---
        if (validation.tribunalResult) {
            const phaseKey = String(phaseForStep(currentStep));
            const submits = state.tribunalSubmits ?? {};
            const count = (submits[phaseKey] ?? 0) + 1;
            // Parse failure: LLM responded but JSON was malformed.
            // Return raw output for the main agent to extract the verdict itself.
            if (validation.tribunalResult.rawParseFailure && validation.tribunalResult.rawOutput) {
                await sm.atomicUpdate({
                    tribunalSubmits: { ...submits, [phaseKey]: count },
                });
                return {
                    done: false,
                    step: currentStep,
                    agent: null,
                    prompt: null,
                    escalation: {
                        reason: "tribunal_parse_failure",
                        lastFeedback: "Tribunal 返回了裁决内容但 JSON 格式不合法。请从以下原始输出中提取 verdict 和 issues，然后调用 auto_dev_tribunal_verdict 提交。",
                        digest: validation.tribunalResult.rawOutput,
                        digestHash: validation.tribunalResult.digestHash,
                    },
                    message: `Step ${currentStep} tribunal JSON 解析失败，原始输出已返回，请 agent 自行提取裁决结果。`,
                };
            }
            // Crashed tribunal → full fallback needed (process-level failure)
            if (validation.tribunalResult.crashed) {
                await sm.atomicUpdate({
                    tribunalSubmits: { ...submits, [phaseKey]: count },
                });
                return {
                    done: false,
                    step: currentStep,
                    agent: null,
                    prompt: null,
                    escalation: {
                        reason: "tribunal_crashed",
                        lastFeedback: "Tribunal 进程崩溃，需要 fallback 裁决。",
                        digest: validation.tribunalResult.digest,
                        digestHash: validation.tribunalResult.digestHash,
                    },
                    message: `Step ${currentStep} tribunal 崩溃，需要 fallback。`,
                };
            }
            if (count >= 3) {
                // ESCALATE_REGRESS — regress to Phase 3
                const escCount = state.phaseEscalateCount?.[phaseKey] ?? 0;
                if (escCount >= 2) {
                    await sm.atomicUpdate({ status: "BLOCKED" });
                    return {
                        done: false, step: currentStep, agent: null, prompt: null,
                        escalation: {
                            reason: "tribunal_max_escalations",
                            lastFeedback: `Phase ${phaseKey} 已 ${escCount + 1} 次 ESCALATE，需要人工介入。`,
                        },
                        message: `Phase ${phaseKey} 多次 ESCALATE，BLOCKED。`,
                    };
                }
                await sm.atomicUpdate({
                    phase: 3, status: "IN_PROGRESS",
                    step: "3", stepIteration: 0, lastValidation: "ESCALATE_REGRESS", approachState: null,
                    tribunalSubmits: {}, // Reset ALL counters
                    phaseEscalateCount: { ...(state.phaseEscalateCount ?? {}), [phaseKey]: escCount + 1 },
                });
                return {
                    done: false,
                    step: "3",
                    agent: STEP_AGENTS["3"] ?? null,
                    prompt: await buildTaskForStep("3", outputDir, projectRoot, topic, buildCmd, testCmd, validation.feedback),
                    message: `Phase ${phaseKey} tribunal 3 次未通过，回退到 Phase 3 修复。`,
                };
            }
            // Tribunal FAIL but under limit — increment counter and return revision
            await sm.atomicUpdate({
                stepIteration: currentIteration + 1, lastValidation: "FAILED",
                tribunalSubmits: { ...submits, [phaseKey]: count },
            });
            const prompt = await buildTaskForStep(currentStep, outputDir, projectRoot, topic, buildCmd, testCmd, validation.feedback);
            return {
                done: false,
                step: currentStep,
                agent: STEP_AGENTS[currentStep] ?? null,
                prompt,
                message: `Step ${currentStep} tribunal FAIL (attempt ${count}/3). Revision needed.`,
            };
        }
        // --- regressToPhase handling (Phase 8 CODE_BUG -> regress to Phase 3) ---
        if (validation.regressToPhase !== undefined) {
            const currentShipRound = (state.shipRound ?? 0) + 1;
            const maxRounds = state.shipMaxRounds ?? 5;
            if (currentShipRound >= maxRounds) {
                await sm.atomicUpdate({ status: "BLOCKED" });
                return {
                    done: false, step: currentStep, agent: null, prompt: null,
                    escalation: {
                        reason: "ship_max_rounds",
                        lastFeedback: validation.feedback,
                    },
                    message: `Ship 已达最大轮次 (${currentShipRound}/${maxRounds})，需要人工介入。`,
                };
            }
            const regressStep = firstStepForPhase(validation.regressToPhase);
            await sm.atomicUpdate({
                phase: validation.regressToPhase,
                step: regressStep,
                stepIteration: 0,
                shipRound: currentShipRound,
                lastValidation: "SHIP_REGRESS",
                approachState: null,
                status: "IN_PROGRESS",
            });
            const prompt = await buildTaskForStep(regressStep, outputDir, projectRoot, topic, buildCmd, testCmd, validation.feedback);
            return {
                done: false,
                step: regressStep,
                agent: STEP_AGENTS[regressStep] ?? null,
                prompt,
                message: `Step ${currentStep} 远程验证失败 (CODE_BUG)，回退到 Phase ${validation.regressToPhase} (round ${currentShipRound})。`,
            };
        }
        // --- Non-tribunal failure: circuit breaker + iteration logic ---
        const approachResult = await handleApproachFailure(stepState, currentStep, outputDir, validation.feedback);
        if (approachResult.action === "CIRCUIT_BREAK") {
            await sm.atomicUpdate({
                stepIteration: 0, lastValidation: "CIRCUIT_BREAK",
                approachState: approachResult.approachState,
            });
            return {
                done: false,
                step: currentStep,
                agent: STEP_AGENTS[currentStep] ?? null,
                prompt: approachResult.prompt,
                freshContext: true,
                message: `方案 "${approachResult.failedApproach}" 已熔断，切换到 "${approachResult.nextApproach}"。`,
            };
        }
        if (approachResult.action === "ALL_EXHAUSTED") {
            await sm.atomicUpdate({
                lastValidation: "ALL_APPROACHES_EXHAUSTED", status: "BLOCKED",
            });
            return {
                done: false, step: currentStep, agent: null, prompt: null,
                escalation: {
                    reason: "all_approaches_exhausted",
                    lastFeedback: validation.feedback,
                },
                message: `Step ${currentStep} 所有方案均已失败，需要人工介入。`,
            };
        }
        // CONTINUE: persist approachState if present
        if (approachResult.approachState) {
            await sm.atomicUpdate({ approachState: approachResult.approachState });
        }
        // Check iteration limit (skip if approachState exists)
        const hasApproachState = !!(approachResult.approachState || stepState.approachState);
        if (!hasApproachState && currentIteration >= MAX_STEP_ITERATIONS) {
            await sm.atomicUpdate({
                lastValidation: "ESCALATED", status: "BLOCKED",
            });
            return {
                done: false, step: currentStep, agent: null, prompt: null,
                escalation: {
                    reason: "iteration_limit_exceeded",
                    lastFeedback: validation.feedback,
                },
                message: `Step ${currentStep} exceeded maximum iterations (${MAX_STEP_ITERATIONS}). Escalating.`,
            };
        }
        // Return revision prompt
        const newIteration = currentIteration + 1;
        // Determine revision step (1b fail -> 1c, 2b fail -> 2c, etc)
        let revisionStep = currentStep;
        if (currentStep === "1b")
            revisionStep = "1c";
        if (currentStep === "2b")
            revisionStep = "2c";
        if (currentStep === "5b")
            revisionStep = "5c";
        const effectiveStep = revisionStep !== currentStep ? revisionStep : currentStep;
        await sm.atomicUpdate({
            step: effectiveStep, stepIteration: newIteration, lastValidation: "FAILED",
        });
        let combinedFeedback = validation.feedback;
        if (approachResult.action === "CONTINUE" && approachResult.planFeedback) {
            combinedFeedback += `\n\n${approachResult.planFeedback}`;
        }
        const prompt = await buildTaskForStep(effectiveStep, outputDir, projectRoot, topic, buildCmd, testCmd, combinedFeedback, getExtraVars(effectiveStep));
        return {
            done: false,
            step: effectiveStep,
            agent: STEP_AGENTS[effectiveStep] ?? STEP_AGENTS[currentStep] ?? null,
            prompt,
            message: `Step ${currentStep} validation failed (iteration ${newIteration}/${MAX_STEP_ITERATIONS}). Revision needed.`,
        };
    }
    // 5. Validation passed — advance to next step
    const currentPhase = phaseForStep(currentStep);
    // Write progress-log checkpoint (audit only)
    await sm.appendToProgressLog("\n" + sm.getCheckpointLine(currentPhase, undefined, "PASS", `Step ${currentStep} passed.`) + "\n");
    // Reset tribunal counter on PASS
    const tribunalUpdates = {};
    if (validation.tribunalResult) {
        const phaseKey = String(currentPhase);
        tribunalUpdates.tribunalSubmits = { ...(state.tribunalSubmits ?? {}), [phaseKey]: 0 };
    }
    const nextStep = computeNextStep(currentStep, phases);
    if (!nextStep) {
        // All steps done — single atomicUpdate
        await sm.atomicUpdate({
            step: null, stepIteration: 0, lastValidation: "DONE",
            status: "COMPLETED",
            ...tribunalUpdates,
        });
        return {
            done: true,
            step: null,
            agent: null,
            prompt: null,
            message: "All phases completed successfully.",
        };
    }
    // Advance to next step — single atomicUpdate
    const nextPhase = phaseForStep(nextStep);
    await sm.atomicUpdate({
        step: nextStep, stepIteration: 0, lastValidation: null, approachState: null,
        phase: nextPhase, status: "IN_PROGRESS",
        ...tribunalUpdates,
    });
    const prompt = await buildTaskForStep(nextStep, outputDir, projectRoot, topic, buildCmd, testCmd, undefined, getExtraVars(nextStep));
    return {
        done: false,
        step: nextStep,
        agent: STEP_AGENTS[nextStep] ?? null,
        prompt,
        message: `Step ${currentStep} passed. Advancing to step ${nextStep} (phase ${nextPhase}).`,
    };
}
//# sourceMappingURL=orchestrator.js.map