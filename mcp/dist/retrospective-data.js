/**
 * retrospective-data — Auto-generate Phase 7 retrospective data from progress-log
 * and tribunal records.
 *
 * This data is framework-generated and cannot be tampered with by the main agent.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
/**
 * Auto-generate retrospective data from progress-log and tribunal records.
 * Writes the result to `retrospective-data.md` and returns the structured data.
 */
export async function generateRetrospectiveData(outputDir) {
    const progressLog = await safeRead(join(outputDir, 'progress-log.md'));
    const data = {
        rejectionCount: countRejections(progressLog),
        phaseTimings: extractPhaseTimings(progressLog),
        tribunalResults: await extractTribunalResults(outputDir),
        tribunalCrashes: extractTribunalCrashes(progressLog),
        submitRetries: extractSubmitRetries(progressLog),
        tddGateStats: await extractTddGateStats(outputDir, progressLog),
    };
    // Write to retrospective-data.md as a markdown table
    const md = renderRetrospectiveDataMarkdown(data);
    await writeFile(join(outputDir, 'retrospective-data.md'), md, 'utf-8');
    return data;
}
// ---------------------------------------------------------------------------
// Extraction helpers
// ---------------------------------------------------------------------------
/**
 * Count rejections from progress-log (REJECTED / BLOCKED / 被拒绝 keywords).
 */
function countRejections(progressLog) {
    const matches = progressLog.match(/REJECTED|BLOCKED|被拒绝/g);
    return matches ? matches.length : 0;
}
/**
 * Extract phase timings from CHECKPOINT comments in progress-log.
 *
 * Each CHECKPOINT has the format:
 *   <!-- CHECKPOINT phase=N status=STATUS timestamp=ISO -->
 *
 * The first checkpoint per phase is treated as startedAt,
 * and the last PASS checkpoint per phase is treated as completedAt.
 */
export function extractPhaseTimings(progressLog) {
    const timings = {};
    // Hardened regex: uses known attribute order (phase -> task? -> status -> summary? -> timestamp)
    // summary is bounded by double quotes, so we skip it precisely to avoid mis-matching
    // status= or timestamp= substrings inside summary text.
    const regex = /<!-- CHECKPOINT phase=(\d+)(?:\s+task=\d+)?\s+status=(\S+)(?:\s+summary="[^"]*")?\s+timestamp=(\S+)\s*-->/g;
    let match;
    while ((match = regex.exec(progressLog)) !== null) {
        const phase = parseInt(match[1], 10);
        const status = match[2];
        const timestamp = match[3];
        if (!timings[phase]) {
            timings[phase] = { startedAt: timestamp };
        }
        if (status === 'PASS' || status === 'COMPLETED') {
            timings[phase].completedAt = timestamp;
            const startMs = new Date(timings[phase].startedAt).getTime();
            const endMs = new Date(timestamp).getTime();
            if (!isNaN(startMs) && !isNaN(endMs) && endMs >= startMs) {
                timings[phase].durationMs = endMs - startMs;
            }
        }
    }
    return timings;
}
/**
 * Extract tribunal results from tribunal-phase{N}.md files.
 * Each file is expected to contain a VERDICT line: `VERDICT: PASS` or `VERDICT: FAIL`.
 * Issue count is derived from `ISSUE:` lines.
 */
async function extractTribunalResults(outputDir) {
    const results = [];
    const tribunalPhases = [4, 5, 6, 7];
    for (const phase of tribunalPhases) {
        const content = await safeRead(join(outputDir, `tribunal-phase${phase}.md`));
        if (!content)
            continue;
        const verdictMatch = content.match(/VERDICT:\s*(PASS|FAIL)/i);
        const verdict = verdictMatch ? verdictMatch[1].toUpperCase() : 'UNKNOWN';
        const issueMatches = content.match(/ISSUE:\s*/gi);
        const issueCount = issueMatches ? issueMatches.length : 0;
        results.push({ phase, verdict, issueCount });
    }
    return results;
}
/**
 * Extract tribunal crash events from progress-log.
 *
 * Two formats are supported:
 *   - Simple:  <!-- TRIBUNAL_CRASH phase=N -->
 *   - Full:    <!-- TRIBUNAL_CRASH phase=N category="..." exitCode="..." retryable="..." timestamp="..." -->
 */
export function extractTribunalCrashes(progressLog) {
    const results = [];
    const regex = /<!-- TRIBUNAL_CRASH\s+phase=(\d+)(.*?)-->/g;
    let match;
    while ((match = regex.exec(progressLog)) !== null) {
        const phase = parseInt(match[1], 10);
        const rest = match[2] ?? '';
        const categoryMatch = rest.match(/category="([^"]*)"/);
        const exitCodeMatch = rest.match(/exitCode="([^"]*)"/);
        const retryableMatch = rest.match(/retryable="([^"]*)"/);
        const timestampMatch = rest.match(/timestamp="([^"]*)"/);
        results.push({
            phase,
            ...(categoryMatch ? { category: categoryMatch[1] } : {}),
            ...(exitCodeMatch ? { exitCode: exitCodeMatch[1] } : {}),
            ...(retryableMatch ? { retryable: retryableMatch[1] === 'true' } : {}),
            ...(timestampMatch ? { timestamp: timestampMatch[1] } : {}),
        });
    }
    return results;
}
/**
 * Extract submit (checkpoint PASS) retry counts per phase from progress-log.
 * Counts the number of CHECKPOINT calls with status=PASS for each phase.
 * A count > 1 means the phase was retried.
 */
export function extractSubmitRetries(progressLog) {
    const retries = {};
    const regex = /<!-- CHECKPOINT phase=(\d+)(?:\s+task=\d+)?\s+status=PASS/g;
    let match;
    while ((match = regex.exec(progressLog)) !== null) {
        const phase = parseInt(match[1], 10);
        retries[phase] = (retries[phase] ?? 0) + 1;
    }
    return retries;
}
// ---------------------------------------------------------------------------
// Markdown rendering
// ---------------------------------------------------------------------------
function renderRetrospectiveDataMarkdown(data) {
    const PHASE_NAMES = {
        0: 'BRAINSTORM',
        1: 'DESIGN',
        2: 'PLAN',
        3: 'EXECUTE',
        4: 'VERIFY',
        5: 'E2E_TEST',
        6: 'ACCEPTANCE',
        7: 'RETROSPECTIVE',
    };
    let md = '# Retrospective Auto-Generated Data\n\n';
    md +=
        '> This file is framework-generated and cannot be tampered with by the main agent.\n\n';
    // Summary
    md += `## Summary\n\n`;
    md += `- **Total Rejections (REJECTED/BLOCKED)**: ${data.rejectionCount}\n\n`;
    // Phase Timings
    md += `## Phase Timings\n\n`;
    md += `| Phase | Name | Started At | Completed At | Duration |\n`;
    md += `|-------|------|------------|--------------|----------|\n`;
    const phaseKeys = Object.keys(data.phaseTimings)
        .map(Number)
        .sort((a, b) => a - b);
    for (const phase of phaseKeys) {
        const t = data.phaseTimings[phase];
        const name = PHASE_NAMES[phase] ?? '?';
        const dur = t.durationMs !== undefined
            ? `${Math.round(t.durationMs / 1000)}s`
            : '---';
        md += `| ${phase} | ${name} | ${t.startedAt} | ${t.completedAt ?? '---'} | ${dur} |\n`;
    }
    md += '\n';
    // Tribunal Results
    md += `## Tribunal Results\n\n`;
    if (data.tribunalResults.length === 0) {
        md += 'No tribunal records found.\n\n';
    }
    else {
        md += `| Phase | Verdict | Issue Count |\n`;
        md += `|-------|---------|-------------|\n`;
        for (const r of data.tribunalResults) {
            md += `| ${r.phase} | ${r.verdict} | ${r.issueCount} |\n`;
        }
        md += '\n';
    }
    // Tribunal Crashes
    md += `## Tribunal Crashes\n\n`;
    if (data.tribunalCrashes.length === 0) {
        md += 'No tribunal crashes recorded.\n\n';
    }
    else {
        md += `| Phase | Category | Exit Code | Retryable | Timestamp |\n`;
        md += `|-------|----------|-----------|-----------|----------|\n`;
        for (const c of data.tribunalCrashes) {
            md += `| ${c.phase} | ${c.category ?? '---'} | ${c.exitCode ?? '---'} | ${c.retryable !== undefined ? c.retryable : '---'} | ${c.timestamp ?? '---'} |\n`;
        }
        md += '\n';
    }
    // Submit Retries
    md += `## Submit Retries (PASS attempts per phase)\n\n`;
    const retryKeys = Object.keys(data.submitRetries)
        .map(Number)
        .sort((a, b) => a - b);
    if (retryKeys.length === 0) {
        md += 'No PASS checkpoints recorded.\n\n';
    }
    else {
        md += `| Phase | PASS Count |\n`;
        md += `|-------|------------|\n`;
        for (const phase of retryKeys) {
            md += `| ${phase} | ${data.submitRetries[phase]} |\n`;
        }
        md += '\n';
    }
    // TDD Gate Stats
    if (data.tddGateStats) {
        md += `## TDD Gate Stats\n\n`;
        md += `| Metric | Value |\n`;
        md += `|--------|-------|\n`;
        md += `| Total Tasks | ${data.tddGateStats.totalTasks} |\n`;
        md += `| TDD Tasks (RED+GREEN) | ${data.tddGateStats.tddTasks} |\n`;
        md += `| Exempt Tasks (TDD: skip) | ${data.tddGateStats.exemptTasks} |\n`;
        md += `| RED Rejections | ${data.tddGateStats.redRejections} |\n`;
        md += `| GREEN Rejections | ${data.tddGateStats.greenRejections} |\n`;
        md += '\n';
    }
    md += '---\n> Generated by auto-dev framework (Phase 7 Part A)\n';
    return md;
}
/**
 * Extract TDD gate statistics from state.json tddTaskStates and progress-log.
 */
async function extractTddGateStats(outputDir, progressLog) {
    const stateRaw = await safeRead(join(outputDir, 'state.json'));
    if (!stateRaw)
        return undefined;
    let state;
    try {
        state = JSON.parse(stateRaw);
    }
    catch {
        return undefined;
    }
    const tddTaskStates = state.tddTaskStates;
    if (!tddTaskStates || typeof tddTaskStates !== 'object') {
        return {
            totalTasks: 0,
            tddTasks: 0,
            exemptTasks: 0,
            redRejections: 0,
            greenRejections: 0,
        };
    }
    const entries = Object.values(tddTaskStates);
    const totalTasks = entries.length;
    const tddTasks = entries.filter(e => e.status === 'GREEN_CONFIRMED').length;
    const exemptTasks = 0; // exempt tasks are not recorded in tddTaskStates
    // Count RED/GREEN rejections from progress-log
    const redRejections = (progressLog.match(/TDD_RED_REJECTED|auto_dev_task_red.*REJECTED/g) ?? []).length;
    const greenRejections = (progressLog.match(/TDD_GREEN_REJECTED|auto_dev_task_green.*REJECTED/g) ?? []).length;
    return { totalTasks, tddTasks, exemptTasks, redRejections, greenRejections };
}
// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------
async function safeRead(path) {
    try {
        return await readFile(path, 'utf-8');
    }
    catch {
        return '';
    }
}
//# sourceMappingURL=retrospective-data.js.map