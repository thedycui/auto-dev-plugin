/**
 * Translates framework-internal failures into plain technical feedback
 * for task agents. Output prompts must NEVER contain framework terminology.
 */
/** Terms that must NEVER appear in prompts sent to task agents. */
export const FRAMEWORK_TERMS = [
    /\bcheckpoint\b/i,
    /\btribunal\b/i,
    /\bauto_dev_/i,
    /\bPhase\s+\d/i,
    /迭代限制/,
    /回退限制/,
    /\bsubmit\b/i,
    /\bpreflight\b/i,
    /\bmandate\b/i,
];
/** Returns true if any FRAMEWORK_TERMS regex matches the text. */
export function containsFrameworkTerms(text) {
    return FRAMEWORK_TERMS.some((re) => re.test(text));
}
/** Builds a revision prompt from structured input. */
export function buildRevisionPrompt(input) {
    const lines = [];
    lines.push("你之前的工作有以下需要修订的地方：");
    lines.push(input.feedback);
    if (input.artifacts.length > 0) {
        lines.push("请修订以下文件：");
        for (const a of input.artifacts) {
            lines.push(`- ${a}`);
        }
    }
    if (input.previousAttemptSummary) {
        lines.push("上次尝试摘要：");
        lines.push(input.previousAttemptSummary);
    }
    lines.push("原始任务描述供参考：");
    lines.push(input.originalTask);
    return lines.join("\n");
}
/** Translates framework error codes to plain technical feedback. */
export function translateFailureToFeedback(errorCode, detail) {
    switch (errorCode) {
        case "PHASE1_REVIEW_MISSING":
            return "设计方案缺少审查文档，请补充设计审查并确保审查意见已被处理。";
        case "PHASE2_REVIEW_MISSING":
            return "实施计划缺少审查文档，请补充计划审查并确保审查意见已被处理。";
        case "PHASE5_ARTIFACTS_MISSING":
            return "端到端测试产出不完整，请检查测试用例和测试结果是否齐全。";
        case "PHASE6_ARTIFACTS_MISSING":
            return "验收报告缺失，请补充完整的验收报告。";
        case "PHASE7_RETROSPECTIVE_MISSING":
            return "回顾文档缺失或不完整，请补充完整的回顾总结。";
        case "TRIBUNAL_FAIL":
            return formatTribunalIssues(detail);
        case "TRIBUNAL_OVERRIDDEN":
            return `框架验证发现：${detail}。请修复代码确保编译和测试通过。`;
        case "TEST_FAILED":
            return `测试执行失败，错误信息如下：\n\n${detail}\n\n请根据错误信息修复代码。`;
        case "BUILD_FAILED":
            return `编译失败，错误信息如下：\n\n${detail}\n\n请根据错误信息修复代码。`;
        default:
            return `工作未达标：${detail || errorCode}。请根据反馈修订。`;
    }
}
function formatTribunalIssues(detail) {
    let issues;
    try {
        issues = JSON.parse(detail);
    }
    catch {
        return `代码审查发现问题：${detail}。请根据反馈修复。`;
    }
    if (!Array.isArray(issues) || issues.length === 0) {
        return `代码审查发现问题：${detail}。请根据反馈修复。`;
    }
    const lines = ["代码审查发现以下问题：", ""];
    for (let i = 0; i < issues.length; i++) {
        const issue = issues[i];
        const prefix = `${i + 1}. [${issue.severity}]`;
        lines.push(`${prefix} ${issue.description}`);
        if (issue.file) {
            lines.push(`   文件：${issue.file}`);
        }
        if (issue.suggestion) {
            lines.push(`   建议：${issue.suggestion}`);
        }
    }
    lines.push("");
    lines.push("请根据以上问题逐一修复。");
    return lines.join("\n");
}
//# sourceMappingURL=orchestrator-prompts.js.map