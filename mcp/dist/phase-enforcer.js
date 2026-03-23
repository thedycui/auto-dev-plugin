/**
 * Phase Enforcer — 强制 auto-dev 流程按顺序执行。
 *
 * 1. computeNextDirective: checkpoint 返回值中带下一步指令
 * 2. validateCompletion: 完成门禁，检查所有必需 Phase 是否已通过
 */
/** Phase 元数据 */
const PHASE_META = {
    1: { name: "DESIGN", description: "设计审查" },
    2: { name: "PLAN", description: "实施计划" },
    3: { name: "EXECUTE", description: "代码实施" },
    4: { name: "VERIFY", description: "编译测试验证" },
    5: { name: "E2E_TEST", description: "端到端测试" },
    6: { name: "ACCEPTANCE", description: "验收" },
};
/** full 模式的必需 Phase */
const REQUIRED_PHASES_FULL = [1, 2, 3, 4, 5, 6];
/** quick 模式的必需 Phase */
const REQUIRED_PHASES_QUICK = [3, 4, 5];
const MAX_ITERATIONS_PER_PHASE = {
    1: 3, 2: 3, 3: 2, 4: 3, 5: 3,
};
export function checkIterationLimit(phase, currentIteration, isInteractive) {
    const maxIteration = MAX_ITERATIONS_PER_PHASE[phase];
    if (maxIteration === undefined) {
        return {
            allowed: true,
            exceeded: false,
            currentIteration,
            maxIteration: Infinity,
            action: "CONTINUE",
            message: `Phase ${phase} has no iteration limit.`,
        };
    }
    if (currentIteration < maxIteration) {
        return {
            allowed: true,
            exceeded: false,
            currentIteration,
            maxIteration,
            action: "CONTINUE",
            message: `Iteration ${currentIteration}/${maxIteration} for Phase ${phase}.`,
        };
    }
    if (isInteractive) {
        return {
            allowed: false,
            exceeded: true,
            currentIteration,
            maxIteration,
            action: "BLOCK",
            message: `Phase ${phase} has reached iteration limit (${currentIteration}/${maxIteration}). User intervention required.`,
        };
    }
    return {
        allowed: false,
        exceeded: true,
        currentIteration,
        maxIteration,
        action: "FORCE_PASS",
        message: `[WARNING] Phase ${phase} exceeded iteration limit (${currentIteration}/${maxIteration}). Force-passing to next phase.`,
    };
}
/**
 * 根据当前 checkpoint 的 phase 和 status，计算下一步强制指令。
 */
export function computeNextDirective(currentPhase, status, state, regressTo) {
    const mode = state.mode;
    const isDryRun = state.dryRun === true;
    const maxPhase = isDryRun ? 2 : 6;
    // REGRESS 分支必须在守卫之前
    if (status === "REGRESS") {
        if (!regressTo || regressTo >= currentPhase) {
            return {
                phaseCompleted: false,
                nextPhase: currentPhase,
                nextPhaseName: PHASE_META[currentPhase]?.name ?? `Phase ${currentPhase}`,
                mandate: `[ERROR] regressTo(${regressTo}) 必须小于当前 phase(${currentPhase})。`,
                canDeclareComplete: false,
            };
        }
        if ((state.regressionCount ?? 0) >= 2) {
            return {
                phaseCompleted: false,
                nextPhase: currentPhase,
                nextPhaseName: PHASE_META[currentPhase]?.name ?? `Phase ${currentPhase}`,
                mandate: "[BLOCKED] 已达最大回退次数(2)。需要人工介入决定后续步骤。",
                canDeclareComplete: false,
            };
        }
        return {
            phaseCompleted: false,
            nextPhase: regressTo,
            nextPhaseName: PHASE_META[regressTo]?.name ?? `Phase ${regressTo}`,
            mandate: `[REGRESS] Phase ${currentPhase} 要求回退到 Phase ${regressTo} (${PHASE_META[regressTo]?.description ?? ""})。` +
                ` 调用 auto_dev_preflight(phase=${regressTo}) 重新开始。`,
            canDeclareComplete: false,
        };
    }
    // 非 PASS 状态不推进
    if (status !== "PASS" && status !== "COMPLETED") {
        return {
            phaseCompleted: false,
            nextPhase: currentPhase,
            nextPhaseName: PHASE_META[currentPhase]?.name ?? `Phase ${currentPhase}`,
            mandate: `Phase ${currentPhase} 状态为 ${status}，需要修复后重新检查。`,
            canDeclareComplete: false,
        };
    }
    let nextPhase = currentPhase + 1;
    if (state.skipE2e === true && nextPhase === 5) {
        nextPhase = 6;
    }
    // 已到达最大 Phase
    if (nextPhase > maxPhase) {
        return {
            phaseCompleted: true,
            nextPhase: null,
            nextPhaseName: null,
            mandate: `所有 Phase 已完成。请调用 auto_dev_complete 确认完成。`,
            canDeclareComplete: true,
        };
    }
    const nextMeta = PHASE_META[nextPhase];
    return {
        phaseCompleted: true,
        nextPhase,
        nextPhaseName: nextMeta?.name ?? `Phase ${nextPhase}`,
        mandate: `[MANDATORY] Phase ${currentPhase} 已通过。必须立即执行 Phase ${nextPhase} (${nextMeta?.description ?? ""})。` +
            ` 调用 auto_dev_preflight(phase=${nextPhase}) 开始。` +
            ` 禁止跳过，禁止向用户宣称任务完成。`,
        canDeclareComplete: false,
    };
}
/**
 * 验证是否所有必需 Phase 都已完成。
 * 通过解析 progress-log.md 中的 CHECKPOINT 注释来判断。
 */
export function validateCompletion(progressLogContent, mode, isDryRun, skipE2e = false) {
    const basePhases = isDryRun
        ? [1, 2]
        : mode === "quick"
            ? REQUIRED_PHASES_QUICK
            : REQUIRED_PHASES_FULL;
    const requiredPhases = skipE2e
        ? basePhases.filter((p) => p !== 5)
        : basePhases;
    // 从 progress-log 中提取所有 PASS 的 phase
    const passedPhases = new Set();
    const checkpointRegex = /<!-- CHECKPOINT phase=(\d+).*?status=PASS/g;
    let match;
    while ((match = checkpointRegex.exec(progressLogContent)) !== null) {
        passedPhases.add(parseInt(match[1], 10));
    }
    const missingPhases = requiredPhases.filter((p) => !passedPhases.has(p));
    if (missingPhases.length === 0) {
        return {
            canComplete: true,
            passedPhases: Array.from(passedPhases).sort(),
            missingPhases: [],
            message: "所有必需 Phase 已通过，可以完成。",
        };
    }
    const missingNames = missingPhases
        .map((p) => `Phase ${p} (${PHASE_META[p]?.name ?? "unknown"})`)
        .join(", ");
    return {
        canComplete: false,
        passedPhases: Array.from(passedPhases).sort(),
        missingPhases,
        message: `不能完成：以下 Phase 未通过: ${missingNames}。必须按顺序执行所有 Phase。`,
    };
}
/**
 * Phase 5 验证：检查是否有实际的测试产出物。
 * 防止 Claude 只写测试计划文档而不写测试代码。
 *
 * 验证规则：
 * 1. 必须有新增的测试文件（通过 git diff 检测 *Test.java / *.test.ts 等）
 * 2. e2e-test-results.md 必须包含实际执行结果（PASS/FAIL），不能只有计划
 */
export async function validatePhase5Artifacts(outputDir, testFileCount, resultsContent) {
    const errors = [];
    // 1. 检查测试文件
    if (testFileCount === 0) {
        errors.push("未检测到新增的测试文件。必须调用 test-architect agent 设计用例，" +
            "再调用 developer agent 实现测试代码。不能只写测试计划文档。");
    }
    // 2. 检查测试结果文件
    if (!resultsContent) {
        errors.push("e2e-test-results.md 不存在。");
    }
    else {
        const hasExecutionResult = /\b(PASS|FAIL|passed|failed|✅|❌|SUCCESS|ERROR)\b/i.test(resultsContent);
        const hasPendingOnly = /⏳|待执行|待部署|待验证|pending/i.test(resultsContent);
        if (!hasExecutionResult && hasPendingOnly) {
            errors.push("e2e-test-results.md 中只有'待执行'标记，没有实际测试执行结果（PASS/FAIL）。" +
                "必须执行测试命令并记录结果。如果部分测试需要远程环境，" +
                "仍然必须写测试代码并标注哪些本地通过、哪些需要部署后验证。");
        }
    }
    if (errors.length > 0) {
        return {
            valid: false,
            errors,
            mandate: "[BLOCKED] Phase 5 PASS 被拒绝：" + errors.join(" "),
        };
    }
    return { valid: true, errors: [], mandate: "" };
}
/**
 * Phase 6 验证：检查验收报告是否存在且有实质内容。
 * 防止 Claude 以"无 AC 标准"为由跳过验收。
 *
 * 验证规则：
 * 1. acceptance-report.md 必须存在
 * 2. 报告中必须有至少 1 条验证结果（PASS/FAIL/SKIP/VERIFIED）
 */
export function validatePhase6Artifacts(reportContent) {
    const errors = [];
    if (!reportContent) {
        errors.push("acceptance-report.md 不存在。必须调用 acceptance-validator agent 生成验收报告。" +
            "即使 design.md 没有显式 AC-N 条目，也必须从设计目标和改动清单中自动提取验收标准。");
    }
    else {
        const hasVerification = /\b(PASS|FAIL|SKIP|VERIFIED|通过|失败|跳过)\b/i.test(reportContent);
        if (!hasVerification) {
            errors.push("acceptance-report.md 中没有验证结果（PASS/FAIL/SKIP）。" +
                "报告必须包含逐条验证的结果，不能只有描述性文字。");
        }
    }
    if (errors.length > 0) {
        return {
            valid: false,
            errors,
            mandate: "[BLOCKED] Phase 6 PASS 被拒绝：" + errors.join(" "),
        };
    }
    return { valid: true, errors: [], mandate: "" };
}
/**
 * 检测新增的测试文件数量。
 * 通过扫描 git diff 输出中的文件名模式判断。
 */
export function countTestFiles(diffFileNames) {
    const testPatterns = [
        /[Tt]est\.(java|py|ts|js|kt|go|rs)$/,
        /\.test\.(ts|js|tsx|jsx)$/,
        /\.spec\.(ts|js|tsx|jsx)$/,
        /_test\.(go|py)$/,
        /tests?\//i,
    ];
    return diffFileNames.filter((f) => testPatterns.some((p) => p.test(f))).length;
}
//# sourceMappingURL=phase-enforcer.js.map