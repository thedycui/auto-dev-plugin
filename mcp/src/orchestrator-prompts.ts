/**
 * Translates framework-internal failures into plain technical feedback
 * for task agents. Output prompts must NEVER contain framework terminology.
 */

// Re-export types used by orchestrator.ts
export interface ApproachEntry {
  id: string;
  summary: string;
  failCount: number;
}

export interface FailedApproach {
  id: string;
  summary: string;
  failReason: string;
}

/** Terms that must NEVER appear in prompts sent to task agents. */
export const FRAMEWORK_TERMS: RegExp[] = [
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
export function containsFrameworkTerms(text: string): boolean {
  return FRAMEWORK_TERMS.some(re => re.test(text));
}

export interface RevisionInput {
  originalTask: string;
  feedback: string;
  artifacts: string[];
  previousAttemptSummary?: string;
}

/** Builds a revision prompt from structured input. */
export function buildRevisionPrompt(input: RevisionInput): string {
  const lines: string[] = [];
  lines.push('修订:');
  lines.push(input.originalTask);
  if (input.previousAttemptSummary) {
    lines.push('');
    lines.push('上次:');
    lines.push(input.previousAttemptSummary);
  }
  lines.push('');
  lines.push('反馈:');
  lines.push(input.feedback);
  if (input.artifacts.length > 0) {
    lines.push('');
    lines.push('文件:');
    for (const a of input.artifacts) {
      lines.push(`- ${a}`);
    }
  }
  return lines.join('\n');
}

/** Builds a previous attempt summary from step effort and current feedback. */
export function buildPreviousAttemptSummary(
  stepId: string,
  effort: {
    totalAttempts: number;
    revisionCycles: number;
    tribunalAttempts: number;
  },
  currentFeedback: string
): string {
  const parts = [
    `${stepId}:${effort.totalAttempts}/${effort.revisionCycles}/${effort.tribunalAttempts}`,
  ];
  if (currentFeedback) {
    const firstLine =
      currentFeedback.split('\n').find(l => l.trim().length > 0) ??
      currentFeedback;
    const summary =
      firstLine.length > 80 ? firstLine.slice(0, 80) + '...' : firstLine;
    parts.push(`原:${summary}`);
  }
  return parts.join(' ');
}

/** Translates framework error codes to plain technical feedback. */
export function translateFailureToFeedback(
  errorCode: string,
  detail: string
): string {
  switch (errorCode) {
    case 'PHASE1_REVIEW_MISSING':
      return '设计方案缺少审查文档，请补充设计审查并确保审查意见已被处理。';

    case 'PHASE2_REVIEW_MISSING':
      return '实施计划缺少审查文档，请补充计划审查并确保审查意见已被处理。';

    case 'PHASE5_ARTIFACTS_MISSING':
      return '端到端测试产出不完整，请检查测试用例和测试结果是否齐全。';

    case 'PHASE6_ARTIFACTS_MISSING':
      return '验收报告缺失，请补充完整的验收报告。';

    case 'PHASE7_RETROSPECTIVE_MISSING':
      return '回顾文档缺失或不完整，请补充完整的回顾总结。';

    case 'TRIBUNAL_FAIL':
      return formatTribunalIssues(detail);

    case 'TRIBUNAL_OVERRIDDEN':
      return `框架验证发现：${detail}。请修复代码确保编译和测试通过。`;

    case 'TEST_FAILED':
      return `测试执行失败，错误信息如下：\n\n${detail}\n\n请根据错误信息修复代码。`;

    case 'BUILD_FAILED':
      return `编译失败，错误信息如下：\n\n${detail}\n\n请根据错误信息修复代码。`;

    default:
      return `工作未达标：${detail || errorCode}。请根据反馈修订。`;
  }
}

function formatTribunalIssues(detail: string): string {
  let issues: Array<{
    severity: string;
    description: string;
    file?: string;
    suggestion?: string;
  }>;
  try {
    issues = JSON.parse(detail);
  } catch {
    return `代码审查发现问题：${detail}。请根据反馈修复。`;
  }

  if (!Array.isArray(issues) || issues.length === 0) {
    return `代码审查发现问题：${detail}。请根据反馈修复。`;
  }

  const lines: string[] = ['代码审查发现以下问题：', ''];
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
  lines.push('');
  lines.push('请根据以上问题逐一修复。');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Circuit Breaker — approach-plan.md parsing
// ---------------------------------------------------------------------------

/** Parse approach-plan.md content into a list of ApproachEntry objects.
 *  Returns null if fewer than 2 approaches (need primary + at least 1 alt). */
export function parseApproachPlan(content: string): ApproachEntry[] | null {
  const approaches: ApproachEntry[] = [];

  // Parse "## 主方案" section
  const primaryMatch = content.match(/## 主方案\s*\n([\s\S]*?)(?=\n## |$)/);
  if (primaryMatch) {
    const methodMatch = primaryMatch[1].match(/-\s*\*\*方法\*\*:\s*(.+)/);
    approaches.push({
      id: 'primary',
      summary: methodMatch?.[1]?.trim() ?? '主方案',
      failCount: 0,
    });
  }

  // Parse "## 备选方案 X" sections
  const altRegex = /## 备选方案\s+(\w)\s*\n([\s\S]*?)(?=\n## |$)/g;
  let match;
  while ((match = altRegex.exec(content)) !== null) {
    const label = match[1].toLowerCase();
    const section = match[2];
    const methodMatch = section.match(/-\s*\*\*方法\*\*:\s*(.+)/);
    approaches.push({
      id: `alt-${label}`,
      summary: methodMatch?.[1]?.trim() ?? `备选方案 ${match[1]}`,
      failCount: 0,
    });
  }

  return approaches.length >= 2 ? approaches : null;
}

/** Extract the first meaningful line from a long feedback string. */
export function extractOneLineReason(feedback: string): string {
  const lines = feedback
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0);
  if (lines.length === 0) return '未知原因';
  // Return the first non-empty line, truncated to 120 chars
  const first = lines[0];
  return first.length > 120 ? first.slice(0, 120) + '...' : first;
}

// ---------------------------------------------------------------------------
// Circuit Breaker — clean prompt builder
// ---------------------------------------------------------------------------

export function buildCircuitBreakPrompt(params: {
  goal: string;
  approach: string;
  prohibited: FailedApproach[];
  outputDir: string;
}): string {
  const lines: string[] = [];
  lines.push(params.goal);
  lines.push('');
  lines.push('方案:');
  lines.push(params.approach);
  lines.push('');

  if (params.prohibited.length > 0) {
    lines.push('禁止方案:');
    for (const p of params.prohibited) {
      lines.push(`- ${p.summary}(${p.failReason})`);
    }
    lines.push('');
  }

  lines.push('约束:');
  lines.push('- 禁用上述方案');
  lines.push('- 遇困难先分析根因');
  lines.push('');
  lines.push(`输出:${params.outputDir}`);

  return lines.join('\n');
}
