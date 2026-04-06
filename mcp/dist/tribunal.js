/**
 * tribunal.ts — Core tribunal (independent judge agent) logic.
 *
 * Orchestrates:
 *  - Claude CLI path resolution (4-tier fallback)
 *  - Tribunal input preparation (write files for judge to read)
 *  - Tribunal invocation (spawn claude with structured output)
 *  - Retry on crash (not on legitimate FAIL)
 *  - Cross-validation (framework hard-data override)
 *  - Full execution pipeline (pre-check -> prepare -> run -> log -> checkpoint)
 */
import { execFile, exec } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { TRIBUNAL_SCHEMA } from './tribunal-schema.js';
import { getTribunalChecklist } from './tribunal-checklists.js';
import { generateRetrospectiveData } from './retrospective-data.js';
import { internalCheckpoint, StateManager } from './state-manager.js';
import { parseInitMarker, validatePhase5Artifacts, validatePhase6Artifacts, validatePhase7Artifacts, countTestFiles, computeNextDirective, } from './phase-enforcer.js';
import { LessonsManager } from './lessons-manager.js';
import { isTestFile, isImplFile } from './tdd-gate.js';
import { getClaudePath } from './agent-spawner.js';
import { getHubClient } from './hub-client.js';
import { GitManager } from './git-manager.js';
// Re-export for backward compatibility
export { getClaudePath, resolveClaudePath } from './agent-spawner.js';
// ---------------------------------------------------------------------------
// Digest Helpers (Task 1 + Task 2)
// ---------------------------------------------------------------------------
/**
 * Read a file and truncate to maxLines. Returns null if file does not exist.
 */
export async function safeRead(path, maxLines) {
    try {
        const content = await readFile(path, 'utf-8');
        const lines = content.split('\n');
        if (lines.length <= maxLines)
            return content;
        return (lines.slice(0, maxLines).join('\n') +
            `\n... (truncated, ${lines.length - maxLines} lines omitted)`);
    }
    catch {
        return null;
    }
}
/**
 * Return the list of files to inline for each tribunal phase.
 */
export function getPhaseFiles(phase, outputDir) {
    if (phase === 4) {
        return [
            {
                label: 'Phase 1 设计评审',
                path: join(outputDir, 'design-review.md'),
                maxLines: 100,
            },
            {
                label: 'Phase 2 计划评审',
                path: join(outputDir, 'plan-review.md'),
                maxLines: 100,
            },
            {
                label: '主 Agent 的代码审查',
                path: join(outputDir, 'code-review.md'),
                maxLines: 100,
            },
        ];
    }
    if (phase === 5) {
        return [
            {
                label: 'E2E 测试结果',
                path: join(outputDir, 'e2e-test-results.md'),
                maxLines: 80,
            },
            {
                label: '框架执行的测试日志（可信）',
                path: join(outputDir, 'framework-test-log.txt'),
                maxLines: 80,
            },
            {
                label: '框架测试退出码（可信）',
                path: join(outputDir, 'framework-test-exitcode.txt'),
                maxLines: 80,
            },
        ];
    }
    if (phase === 6) {
        return [
            {
                label: '验收报告',
                path: join(outputDir, 'acceptance-report.md'),
                maxLines: 100,
            },
        ];
    }
    if (phase === 7) {
        return [
            {
                label: '复盘报告',
                path: join(outputDir, 'retrospective.md'),
                maxLines: 80,
            },
            {
                label: '框架自动生成的数据（可信）',
                path: join(outputDir, 'retrospective-data.md'),
                maxLines: 80,
            },
            {
                label: 'Progress Log',
                path: join(outputDir, 'progress-log.md'),
                maxLines: 80,
            },
        ];
    }
    return [];
}
/**
 * Get key code diff excluding dist/, *.map, *.lock, node_modules/, __tests__/.
 * Budget is distributed evenly across files (min 20 lines per file).
 */
export async function getKeyDiff(projectRoot, startCommit, totalBudget) {
    const diffBase = startCommit ?? 'HEAD~1';
    const rawDiff = await new Promise(resolve => {
        execFile('git', [
            'diff',
            diffBase,
            '--',
            '.',
            ':!*/dist/*',
            ':!*.map',
            ':!*.lock',
            ':!*/node_modules/*',
            ':!*/__tests__/*',
        ], {
            cwd: projectRoot,
            maxBuffer: 5 * 1024 * 1024,
        }, (err, stdout) => resolve(err ? '' : stdout));
    });
    if (!rawDiff)
        return '(no diff)';
    // Split diff by file (each file starts with "diff --git")
    const fileSections = rawDiff
        .split(/(?=^diff --git )/m)
        .filter(s => s.trim().length > 0);
    if (fileSections.length === 0)
        return '(no diff)';
    const perFile = Math.max(20, Math.floor(totalBudget / fileSections.length));
    const truncated = [];
    for (const section of fileSections) {
        const lines = section.split('\n');
        if (lines.length <= perFile) {
            truncated.push(section);
        }
        else {
            truncated.push(lines.slice(0, perFile).join('\n') +
                `\n... (truncated, ${lines.length - perFile} lines omitted)`);
        }
    }
    return truncated.join('\n');
}
// ---------------------------------------------------------------------------
// parseDiffSummary — parse git diff --stat summary line
// ---------------------------------------------------------------------------
/**
 * Parse a git diff --stat summary line like:
 *   "5 files changed, 120 insertions(+), 30 deletions(-)"
 * Handles edge cases: only insertions, only deletions, unrecognized format.
 * Returns { files: 0, insertions: 0, deletions: 0 } on any parse failure.
 */
export function parseDiffSummary(summaryLine) {
    try {
        const filesMatch = summaryLine.match(/(\d+)\s+files?\s+changed/);
        const insertMatch = summaryLine.match(/(\d+)\s+insertions?\(\+\)/);
        const deleteMatch = summaryLine.match(/(\d+)\s+deletions?\(-\)/);
        const files = filesMatch ? parseInt(filesMatch[1], 10) : 0;
        const insertions = insertMatch ? parseInt(insertMatch[1], 10) : 0;
        const deletions = deleteMatch ? parseInt(deleteMatch[1], 10) : 0;
        if (!filesMatch)
            return { files: 0, insertions: 0, deletions: 0 };
        return { files, insertions, deletions };
    }
    catch {
        return { files: 0, insertions: 0, deletions: 0 };
    }
}
// ---------------------------------------------------------------------------
// Tribunal Input Preparation
// ---------------------------------------------------------------------------
/**
 * Assemble a single digest file tribunal-digest-phase{N}.md with all review
 * materials inlined. Tribunal only needs to read this one file.
 * For Phase 5, also execute testCmd and write framework-test-log.txt / framework-test-exitcode.txt.
 * Returns the digest file path and content.
 */
export async function prepareTribunalInput(phase, outputDir, projectRoot, startCommit) {
    const digestFile = join(outputDir, `tribunal-digest-phase${phase}.md`);
    // Phase 5: framework executes testCmd independently (tamper-proof) — must run BEFORE inlining
    if (phase === 5) {
        const progressLogContent = await readFile(join(outputDir, 'progress-log.md'), 'utf-8').catch(() => '');
        const initData = parseInitMarker(progressLogContent);
        if (initData?.testCmd) {
            const { stdout: testStdout, stderr: testStderr, exitCode, } = await new Promise(resolve => {
                execFile('sh', ['-c', initData.testCmd], {
                    cwd: projectRoot,
                    timeout: 300_000,
                    maxBuffer: 5 * 1024 * 1024,
                }, (err, stdout, stderr) => {
                    const code = err ? (err.code ?? 1) : 0;
                    resolve({
                        stdout: stdout || '',
                        stderr: stderr || '',
                        exitCode: typeof code === 'number' ? code : 1,
                    });
                });
            });
            await writeFile(join(outputDir, 'framework-test-log.txt'), testStdout + '\n' + testStderr, 'utf-8');
            await writeFile(join(outputDir, 'framework-test-exitcode.txt'), String(exitCode), 'utf-8');
        }
    }
    // Phase 7: generate retrospective data before tribunal
    if (phase === 7) {
        await generateRetrospectiveData(outputDir);
    }
    let content = `# Phase ${phase} 裁决\n\n`;
    content += `默认立场 FAIL。PASS 需逐条举证(文件:行号)。\n`;
    content += `审查范围限本次 diff。P0/P1 必须提供 acRef。\n\n`;
    // 1. Framework statistics (hard data — git diff --stat + untracked files)
    // IMP-003: Use unified GitManager.getDiffStatWithUntracked
    const gm = new GitManager(projectRoot);
    const diffStat = await gm.getDiffStatWithUntracked(startCommit ?? 'HEAD');
    // Truncate diffStat if too large (monorepos can produce thousands of lines)
    const diffStatLines = diffStat.split('\n');
    const truncatedDiffStat = diffStatLines.length > 100
        ? diffStatLines.slice(0, 100).join('\n') +
            `\n... (+${diffStatLines.length - 100} files)`
        : diffStat;
    content += `## 统计\n\`\`\`\n${truncatedDiffStat}\n\`\`\`\n\n`;
    // 1b. Change scale signal (injected between 框架统计 and 关键代码变更)
    let keyDiffBudget = 300;
    try {
        const nonEmptyLines = diffStat.split('\n').filter(l => l.trim().length > 0);
        const summaryLine = nonEmptyLines[nonEmptyLines.length - 1] ?? '';
        const { insertions, deletions } = parseDiffSummary(summaryLine);
        const totalLines = insertions + deletions;
        let scaleLevel;
        let scaleInstruction;
        if (totalLines > 500) {
            scaleLevel = 'HIGH';
            scaleInstruction = '逐文件审查';
            keyDiffBudget = 500;
        }
        else if (totalLines > 100) {
            scaleLevel = 'MEDIUM';
            scaleInstruction = '重点审查核心逻辑';
        }
        else {
            scaleLevel = 'LOW';
            scaleInstruction = '快速审查';
        }
        content += `## 变更: ${scaleLevel} (+${insertions} -${deletions}) ${scaleInstruction}\n\n`;
    }
    catch {
        /* scale injection failed, skip silently */
    }
    // 2. Inline review materials (truncated to reasonable length)
    const filesToInline = getPhaseFiles(phase, outputDir);
    for (const { label, path, maxLines } of filesToInline) {
        const text = await safeRead(path, maxLines);
        if (text)
            content += `## ${label}\n\`\`\`\n${text}\n\`\`\`\n\n`;
    }
    // 3. Key code diff (excluding test/config/dist, truncated)
    const keyDiff = await getKeyDiff(projectRoot, startCommit, keyDiffBudget);
    content += `## Diff\n\`\`\`diff\n${keyDiff}\n\`\`\`\n\n`;
    // 4. Inject tribunal-category lessons (calibration)
    try {
        const lessonsManager = new LessonsManager(outputDir, projectRoot);
        const tribunalLessons = (await lessonsManager.get(undefined, 'tribunal'))
            .filter(l => !l.retired)
            .slice(0, 5);
        if (tribunalLessons.length > 0) {
            content += `## 经验校准\n\n`;
            for (const l of tribunalLessons) {
                content += `- [${l.severity ?? 'minor'}] ${l.lesson}\n`;
            }
            content += `\n`;
        }
    }
    catch {
        /* lessons not available, skip */
    }
    // 5. Checklist
    content += `## 检查清单\n\n${getTribunalChecklist(phase)}\n`;
    // 6. Size guard: truncate digest to prevent MCP token limit errors.
    // 93K+ char digests have been observed in large projects (monorepos with binary diffs).
    const MAX_DIGEST_CHARS = 40_000;
    if (content.length > MAX_DIGEST_CHARS) {
        const truncatePoint = content.lastIndexOf('\n', MAX_DIGEST_CHARS);
        content =
            content.slice(0, truncatePoint > 0 ? truncatePoint : MAX_DIGEST_CHARS) +
                `\n\n... (truncated: ${content.length}→${MAX_DIGEST_CHARS} chars)\n`;
    }
    await writeFile(digestFile, content, 'utf-8');
    return { digestPath: digestFile, digestContent: content };
}
/**
 * Classify a tribunal process error into one of 7 known fault categories.
 * Pure function — no side effects.
 *
 * Categories and retryability:
 * - ENOENT:  claude CLI binary not found (not retryable)
 * - EPERM:   permission denied (not retryable)
 * - prompt-too-long: prompt exceeds shell limits (not retryable)
 * - timeout:  process exceeded time limit (retryable)
 * - OOM:     out of memory (retryable)
 * - cli-internal: internal CLI error (retryable)
 * - unknown: uncategorized error (retryable by default)
 */
export function classifyTribunalError(err, stderr, exitCode) {
    const msg = typeof err === 'string' ? err : err.message;
    // IMP-002: Save full stderr for detailed crash analysis
    const stderrSnippet = stderr?.slice(0, 500);
    const stderrFull = stderr;
    if (/ENOENT/i.test(msg)) {
        return {
            errorCategory: 'ENOENT',
            isRetryable: false,
            exitCode,
            stderrSnippet,
            stderrFull,
            errMessage: msg,
        };
    }
    if (/EPERM|EACCES/i.test(msg)) {
        return {
            errorCategory: 'EPERM',
            isRetryable: false,
            exitCode,
            stderrSnippet,
            stderrFull,
            errMessage: msg,
        };
    }
    if (/arg.*too long|argument list too long/i.test(msg) || /E2BIG/i.test(msg)) {
        return {
            errorCategory: 'prompt-too-long',
            isRetryable: false,
            exitCode,
            stderrSnippet,
            stderrFull,
            errMessage: msg,
        };
    }
    if (/timed?\s*out|timeout|SIGTERM|ETIMEDOUT/i.test(msg)) {
        return {
            errorCategory: 'timeout',
            isRetryable: true,
            exitCode,
            stderrSnippet,
            stderrFull,
            errMessage: msg,
        };
    }
    if (/OOM|out of memory|heap|ENOMEM/i.test(msg) ||
        (stderr && /OOM|out of memory|heap|ENOMEM/i.test(stderr))) {
        return {
            errorCategory: 'OOM',
            isRetryable: true,
            exitCode,
            stderrSnippet,
            stderrFull,
            errMessage: msg,
        };
    }
    if (/internal|ECONNREFUSED|ECONNRESET|SIGKILL|SIGSEGV/i.test(msg) ||
        (stderr && /internal|fatal|abort/i.test(stderr))) {
        return {
            errorCategory: 'cli-internal',
            isRetryable: true,
            exitCode,
            stderrSnippet,
            stderrFull,
            errMessage: msg,
        };
    }
    return {
        errorCategory: 'unknown',
        isRetryable: true,
        exitCode,
        stderrSnippet,
        stderrFull,
        errMessage: msg,
    };
}
/** Known error strings that indicate a crash (not a legitimate verdict) */
const CRASH_INDICATORS = ['裁决进程执行失败'];
/** Error strings that indicate JSON parse failure (raw output may still be usable) */
const PARSE_FAILURE_INDICATORS = [
    'JSON 解析失败',
    '未返回有效的 structured_output',
];
/** Threshold (chars) above which we pass digest via file instead of inline -p */
const INLINE_THRESHOLD = 8_000;
/**
 * Spawn an independent `claude` process to judge the tribunal input.
 * Parses structured_output from JSON response.
 * Post-parse: PASS without passEvidence is overridden to FAIL (revision 4).
 *
 * When digestContent exceeds INLINE_THRESHOLD, the prompt references the
 * digest file path instead of inlining it, avoiding shell argument length
 * limits and escaping issues.
 */
export async function runTribunal(digestContent, phase, digestPath) {
    const resolved = await getClaudePath();
    const useShell = resolved.startsWith('npx');
    // Short digests inline; long digests reference the file
    const useFile = digestPath && digestContent.length > INLINE_THRESHOLD;
    const prompt = useFile
        ? `读取"${digestPath}"并按清单裁决。`
        : `按清单裁决:\n\n${digestContent}`;
    const schemaStr = JSON.stringify(TRIBUNAL_SCHEMA);
    const args = [
        '-p',
        prompt,
        '--output-format',
        'json',
        '--json-schema',
        schemaStr,
        '--dangerously-skip-permissions',
        '--model',
        'sonnet',
        '--no-session-persistence',
    ];
    // When using file mode, allow read permission on the digest file
    if (useFile) {
        args.push('--allowedTools', 'Read');
    }
    const spawnOpts = {
        timeout: 600_000,
        maxBuffer: 2 * 1024 * 1024,
    };
    return new Promise(resolve => {
        const callback = (err, stdout, stderr) => {
            if (err) {
                // Task 2: Enrich crash info with classified error category
                const crashInfo = classifyTribunalError(err, stderr, typeof err?.code === 'number' ? err.code : undefined);
                resolve({
                    verdict: 'FAIL',
                    issues: [
                        { severity: 'P0', description: `裁决进程执行失败: ${err.message}` },
                    ],
                    raw: JSON.stringify({ crashInfo, errMessage: err.message }),
                });
                return;
            }
            try {
                const response = JSON.parse(stdout);
                const data = response.structured_output;
                if (!data || !data.verdict) {
                    resolve({
                        verdict: 'FAIL',
                        issues: [
                            {
                                severity: 'P0',
                                description: '裁决 Agent 未返回有效的 structured_output',
                            },
                        ],
                        raw: stdout,
                    });
                    return;
                }
                // Revision 4: PASS without passEvidence -> override to FAIL
                if (data.verdict === 'PASS' &&
                    (!data.passEvidence || data.passEvidence.length === 0)) {
                    resolve({
                        verdict: 'FAIL',
                        issues: [
                            {
                                severity: 'P0',
                                description: '裁决判定 PASS 但未提供任何证据（passEvidence 为空）。PASS 必须逐条举证。',
                            },
                        ],
                        raw: stdout,
                    });
                    return;
                }
                resolve({ ...data, raw: stdout });
            }
            catch (parseErr) {
                resolve({
                    verdict: 'FAIL',
                    issues: [
                        {
                            severity: 'P0',
                            description: `裁决输出 JSON 解析失败: ${parseErr}`,
                        },
                    ],
                    raw: stdout || '',
                });
            }
        };
        if (useShell) {
            // npx path requires shell: true
            const fullCmd = `${resolved} ${args.map(a => `'${a.replace(/'/g, "'\\''")}'`).join(' ')}`;
            exec(fullCmd, { ...spawnOpts, shell: '/bin/sh' }, (err, stdout, stderr) => {
                callback(err, stdout, stderr);
            });
        }
        else {
            execFile(resolved, args, spawnOpts, (err, stdout, stderr) => {
                callback(err, stdout, stderr);
            });
        }
    });
}
// ---------------------------------------------------------------------------
// Retry Logic
// ---------------------------------------------------------------------------
/**
 * Run tribunal with three-tier strategy:
 *   Level 1: Hub mode (TRIBUNAL_HUB_URL set) — execute via Agent Hub
 *   Level 2: Subagent mode (default) — return subagentRequested=true for orchestrator
 *   Level 3: CLI mode (TRIBUNAL_MODE=cli) — spawn claude CLI process with retry
 *
 * Returns { verdict, crashed, rawParseFailure, subagentRequested }.
 */
export async function runTribunalWithRetry(digestContent, phase, digestPath) {
    // --- Level 3: CLI mode (explicit opt-in via TRIBUNAL_MODE=cli) ---
    if (process.env.TRIBUNAL_MODE === 'cli') {
        return runTribunalWithRetryCli(digestContent, phase, digestPath);
    }
    // --- Level 1: Hub mode (TRIBUNAL_HUB_URL set) ---
    const hubClient = getHubClient();
    if (hubClient) {
        const hubResult = await tryRunViaHub(hubClient, digestContent, phase, digestPath);
        if (hubResult) {
            return { verdict: hubResult, crashed: false };
        }
        // Hub failed — fall through to Level 2 (Subagent)
    }
    // --- Level 2: Subagent mode (default — no CLI spawn, no Hub) ---
    return {
        verdict: { verdict: 'FAIL', issues: [], raw: '' },
        crashed: false,
        subagentRequested: true,
    };
}
/**
 * Try to run tribunal via Agent Hub. Returns TribunalVerdict on success, null on failure.
 */
async function tryRunViaHub(hubClient, digestContent, phase, digestPath) {
    try {
        // 1. Check availability
        const available = await hubClient.isAvailable();
        if (!available)
            return null;
        // 2. Register (idempotent)
        const connected = await hubClient.ensureConnected();
        if (!connected)
            return null;
        // 3. Find worker
        const worker = await hubClient.findTribunalWorker();
        if (!worker)
            return null;
        // 4. Build prompt for worker
        const useFile = digestPath && digestContent.length > INLINE_THRESHOLD;
        const prompt = useFile
            ? `读取"${digestPath}"并按清单裁决。输出JSON格式:verdict+issues数组。`
            : `按清单裁决。输出JSON格式:verdict+issues数组。\n\n${digestContent}`;
        // 5. Execute via Hub (10 min timeout)
        const result = await hubClient.executePrompt(worker.id, prompt, 600_000);
        if (!result)
            return null;
        // 6. Parse result
        const data = typeof result === 'string' ? JSON.parse(result) : result;
        if (data && data.verdict) {
            // Apply PASS-without-evidence override (same as runTribunal)
            if (data.verdict === 'PASS' &&
                (!data.passEvidence || data.passEvidence.length === 0)) {
                return {
                    verdict: 'FAIL',
                    issues: [
                        {
                            severity: 'P0',
                            description: '裁决判定 PASS 但未提供任何证据（passEvidence 为空）。PASS 必须逐条举证。',
                        },
                    ],
                    raw: JSON.stringify(data),
                };
            }
            return data;
        }
        return null;
    }
    catch (err) {
        // Task 4: Log error instead of silently swallowing
        console.warn(`[tribunal] Hub execution failed: ${err instanceof Error ? err.message : String(err)}`);
        return null;
    }
}
/**
 * Original CLI spawn path with retry logic (Level 3).
 * Extracted from the original runTribunalWithRetry for TRIBUNAL_MODE=cli.
 */
async function runTribunalWithRetryCli(digestContent, phase, digestPath) {
    const MAX_RETRIES = 1;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        const result = await runTribunal(digestContent, phase, digestPath);
        // Check if it's a JSON parse failure (LLM responded but output wasn't valid JSON).
        const isParseFailure = result.issues.some(i => PARSE_FAILURE_INDICATORS.some(indicator => i.description.includes(indicator)));
        if (isParseFailure) {
            return { verdict: result, crashed: false, rawParseFailure: true };
        }
        // Distinguish legitimate verdict from process crash
        const isCrash = result.issues.some(i => CRASH_INDICATORS.some(indicator => i.description.includes(indicator)));
        if (!isCrash)
            return { verdict: result, crashed: false }; // Normal verdict (PASS or FAIL)
        // Task 3: Check if crash is retryable via classified crashInfo
        let isRetryable = true;
        try {
            const parsed = JSON.parse(result.raw);
            if (parsed.crashInfo &&
                typeof parsed.crashInfo.isRetryable === 'boolean') {
                isRetryable = parsed.crashInfo.isRetryable;
            }
        }
        catch {
            /* raw not JSON — default to retryable */
        }
        if (!isRetryable) {
            return {
                verdict: {
                    verdict: 'FAIL',
                    issues: [
                        {
                            severity: 'P0',
                            description: `裁决进程崩溃（不可重试故障），跳过重试`,
                        },
                    ],
                    raw: result.raw,
                },
                crashed: true,
            };
        }
        if (attempt < MAX_RETRIES) {
            // Transient failure, backoff 3s and retry
            await new Promise(r => setTimeout(r, 3000));
            continue;
        }
        // Exhausted retries, return crash result
        return {
            verdict: {
                verdict: 'FAIL',
                issues: [
                    {
                        severity: 'P0',
                        description: `裁决进程连续 ${MAX_RETRIES + 1} 次崩溃（非裁决结果），请检查 claude CLI 是否可用后重新 submit`,
                    },
                ],
                raw: result.raw,
            },
            crashed: true,
        };
    }
    // Unreachable — the loop always returns
    throw new Error('unreachable');
}
// ---------------------------------------------------------------------------
// Cross-Validation
// ---------------------------------------------------------------------------
/**
 * Framework hard-data cross-validation after tribunal PASS.
 * Returns null if validation passes, or a string describing the override reason.
 *
 * Phase 4: check git diff non-empty (at least some code changes).
 * Phase 5: check framework-test-exitcode.txt (revision 6) + impl vs test file ratio.
 * Phase 6: check acceptance-report.md has PASS/FAIL result.
 * Phase 7: check retrospective.md exists and >= 50 lines.
 */
export async function crossValidate(phase, outputDir, projectRoot, startCommit) {
    // Phase 4: git diff non-empty check (committed + staged + untracked)
    if (phase === 4) {
        if (!startCommit) {
            return 'startCommit 未设置（可能是旧版 state 迁移），无法校验 Phase 4 代码变更';
        }
        // IMP-003: Use unified GitManager.getChangedFiles
        const gm = new GitManager(projectRoot);
        const files = await gm.getChangedFiles({
            baseCommit: startCommit,
        });
        if (files.length === 0) {
            return 'git diff 为空，没有任何代码变更，裁决 Agent 不应判定 PASS';
        }
    }
    if (phase === 5) {
        // Check exit code (revision 6: exit code, not regex)
        try {
            const exitCodeStr = await readFile(join(outputDir, 'framework-test-exitcode.txt'), 'utf-8');
            const exitCode = parseInt(exitCodeStr.trim(), 10);
            if (exitCode !== 0) {
                return '框架执行 testCmd 退出码非零，但裁决 Agent 判定 PASS';
            }
        }
        catch {
            /* no exit code file — skip this check */
        }
        // Check impl files vs test files ratio (committed + staged + untracked)
        // IMP-003: Use unified GitManager.getChangedFiles
        const gm = new GitManager(projectRoot);
        const files = await gm.getChangedFiles({
            baseCommit: startCommit ?? 'HEAD~20',
        });
        const implCount = files.filter(f => isImplFile(f)).length;
        const testCount = files.filter(f => isTestFile(f)).length;
        if (implCount > 0 && testCount === 0) {
            return `${implCount} 个新增实现文件但 0 个测试文件，裁决 Agent 不应判定 PASS`;
        }
    }
    // Phase 6: acceptance-report.md has PASS/FAIL result
    if (phase === 6) {
        try {
            const reportContent = await readFile(join(outputDir, 'acceptance-report.md'), 'utf-8');
            if (!/\b(PASS|FAIL)\b/.test(reportContent)) {
                return 'acceptance-report.md 中没有 PASS/FAIL 结果';
            }
        }
        catch {
            return 'acceptance-report.md 不存在';
        }
    }
    // Phase 7: retrospective.md exists and >= 50 lines
    if (phase === 7) {
        try {
            const retroContent = await readFile(join(outputDir, 'retrospective.md'), 'utf-8');
            const lineCount = retroContent.split('\n').length;
            if (lineCount < 50) {
                return `retrospective.md 只有 ${lineCount} 行（要求 >= 50 行）`;
            }
        }
        catch {
            return 'retrospective.md 不存在';
        }
    }
    return null;
}
export function textResult(obj) {
    return {
        content: [{ type: 'text', text: JSON.stringify(obj, null, 2) }],
    };
}
/**
 * Pure tribunal evaluation — runs tribunal and returns verdict WITHOUT writing
 * any state (no checkpoint, no phase advancement, no counter updates).
 *
 * The orchestrator is responsible for all state changes based on this result.
 */
export async function evaluateTribunal(projectRoot, outputDir, phase, topic, summary, startCommit) {
    // 1. Quick pre-checks
    const preCheckError = await runQuickPreCheck(phase, outputDir, projectRoot, startCommit);
    if (preCheckError) {
        return {
            verdict: 'FAIL',
            issues: [{ severity: 'P0', description: preCheckError }],
            preCheckError,
        };
    }
    // 2. Prepare tribunal input
    const { digestPath, digestContent } = await prepareTribunalInput(phase, outputDir, projectRoot, startCommit);
    // 3. Run tribunal with retry (passes digestPath for file-based mode on large digests)
    const { verdict, crashed, rawParseFailure, subagentRequested } = await runTribunalWithRetry(digestContent, phase, digestPath);
    // 3b. Subagent requested — skip all post-processing, return immediately
    //     (P1-2: skip tribunal log writing to avoid misleading audit trail)
    if (subagentRequested) {
        const digestHash = createHash('sha256')
            .update(digestContent)
            .digest('hex')
            .slice(0, 16);
        return {
            verdict: 'FAIL',
            issues: [],
            subagentRequested: true,
            digestPath,
            digest: digestContent,
            digestHash,
        };
    }
    // 4. Write tribunal log (audit trail — not state)
    const tribunalLog = buildTribunalLog(phase, verdict, 'claude-p');
    await writeFile(join(outputDir, `tribunal-phase${phase}.md`), tribunalLog, 'utf-8');
    // 5a. Parse failure → return raw output for main agent to extract verdict
    // The LLM responded but output wasn't valid JSON. The raw text likely contains
    // the verdict in a readable form that the main agent can parse.
    if (rawParseFailure && verdict.raw) {
        const digestHash = createHash('sha256')
            .update(digestContent)
            .digest('hex')
            .slice(0, 16);
        return {
            verdict: 'FAIL',
            issues: [],
            rawParseFailure: true,
            rawOutput: verdict.raw,
            digest: digestContent,
            digestHash,
        };
    }
    // 5b. Crashed → return for fallback (process-level failure, no raw output available)
    if (crashed) {
        const digestHash = createHash('sha256')
            .update(digestContent)
            .digest('hex')
            .slice(0, 16);
        return {
            verdict: 'FAIL',
            issues: [],
            crashed: true,
            digest: digestContent,
            digestHash,
            crashRaw: verdict.raw,
        };
    }
    // 6. Auto-override: FAIL without P0/P1 acRef → PASS
    const advisory = [];
    if (verdict.verdict === 'FAIL') {
        const remaining = verdict.issues.filter(issue => {
            if ((issue.severity === 'P0' || issue.severity === 'P1') &&
                !issue.acRef) {
                advisory.push({
                    description: issue.description,
                    suggestion: issue.suggestion,
                });
                return false;
            }
            return true;
        });
        const hasBlockingIssues = remaining.some(i => i.severity === 'P0' || i.severity === 'P1');
        if (!hasBlockingIssues) {
            verdict.verdict = 'PASS';
            verdict.issues = remaining;
        }
    }
    // 7. Cross-validate on PASS
    if (verdict.verdict === 'PASS') {
        const crossCheckFail = await crossValidate(phase, outputDir, projectRoot, startCommit);
        if (crossCheckFail) {
            return {
                verdict: 'FAIL',
                issues: [{ severity: 'P0', description: crossCheckFail }],
                crossValidateOverride: crossCheckFail,
                advisory,
            };
        }
    }
    return {
        verdict: verdict.verdict,
        issues: verdict.issues,
        advisory: advisory.length > 0 ? advisory : undefined,
    };
}
// ---------------------------------------------------------------------------
// Full Tribunal Execution (DEPRECATED — use evaluateTribunal + orchestrator)
// ---------------------------------------------------------------------------
/**
 * @deprecated Use evaluateTribunal() instead. This function has side effects
 * (writes checkpoint, advances phase) that conflict with the orchestrator.
 * Kept for backward compatibility with auto_dev_tribunal_verdict fallback path.
 */
export async function executeTribunal(projectRoot, outputDir, phase, topic, summary, sm, state) {
    const startCommit = state.startCommit;
    // ------- Quick pre-checks (avoid wasting tribunal tokens) -------
    const preCheckError = await runQuickPreCheck(phase, outputDir, projectRoot, startCommit);
    if (preCheckError) {
        return textResult({
            status: 'TRIBUNAL_FAIL',
            phase,
            message: preCheckError,
            issues: [{ severity: 'P0', description: preCheckError }],
            mandate: '请修复上述问题后重新 submit。',
        });
    }
    // ------- Prepare tribunal input files -------
    const { digestPath, digestContent } = await prepareTribunalInput(phase, outputDir, projectRoot, startCommit);
    // ------- Run tribunal with retry -------
    const { verdict, crashed } = await runTribunalWithRetry(digestContent, phase, digestPath);
    // ------- Write tribunal log (audit trail) -------
    const tribunalLog = buildTribunalLog(phase, verdict, 'claude-p');
    await writeFile(join(outputDir, `tribunal-phase${phase}.md`), tribunalLog, 'utf-8');
    // ------- Crashed: return TRIBUNAL_PENDING for fallback -------
    if (crashed) {
        const digestHash = createHash('sha256')
            .update(digestContent)
            .digest('hex')
            .slice(0, 16);
        return textResult({
            status: 'TRIBUNAL_PENDING',
            phase,
            message: '裁决进程崩溃，请使用 subagent 执行 fallback 裁决。',
            digest: digestContent,
            digestHash,
            mandate: '[FALLBACK] 请调用 auto-dev-reviewer subagent 审查上述材料，然后提交 auto_dev_tribunal_verdict。',
        });
    }
    // ------- Auto-override: FAIL without P0/P1 -> PASS -------
    if (verdict.verdict === 'FAIL') {
        // Downgrade P0/P1 issues without acRef to advisory
        const advisory = [];
        const remaining = verdict.issues.filter(issue => {
            if ((issue.severity === 'P0' || issue.severity === 'P1') &&
                !issue.acRef) {
                advisory.push({
                    description: issue.description,
                    suggestion: issue.suggestion,
                });
                return false;
            }
            return true;
        });
        const hasBlockingIssues = remaining.some(i => i.severity === 'P0' || i.severity === 'P1');
        if (!hasBlockingIssues) {
            // Override FAIL to PASS — no real P0/P1 with acRef
            verdict.verdict = 'PASS';
            verdict.issues = remaining;
            verdict.advisory = advisory;
        }
    }
    // ------- Cross-validate on PASS -------
    if (verdict.verdict === 'PASS') {
        const crossCheckFail = await crossValidate(phase, outputDir, projectRoot, startCommit);
        if (crossCheckFail) {
            return textResult({
                status: 'TRIBUNAL_OVERRIDDEN',
                phase,
                message: `裁决 Agent 判定 PASS，但框架交叉验证不通过：${crossCheckFail}`,
                issues: [{ severity: 'P0', description: crossCheckFail }],
                mandate: '框架硬数据与裁决结果矛盾，请修复后重新 submit。',
            });
        }
    }
    // ------- PASS: write checkpoint and return success -------
    if (verdict.verdict === 'PASS') {
        const ckptSummary = `[TRIBUNAL] 独立裁决通过。${verdict.issues.length} 个建议项。`;
        const ckptResult = await internalCheckpoint(sm, state, phase, 'PASS', ckptSummary);
        const nextDirective = ckptResult.ok
            ? ckptResult.nextDirective
            : computeNextDirective(phase, 'PASS', state);
        return textResult({
            status: 'TRIBUNAL_PASS',
            phase,
            nextPhase: nextDirective.nextPhase,
            mandate: nextDirective.mandate,
            message: '独立裁决通过，checkpoint 已自动写入。',
            suggestions: verdict.issues,
        });
    }
    // ------- FAIL: return issues to main agent -------
    return textResult({
        status: 'TRIBUNAL_FAIL',
        phase,
        message: `独立裁决未通过。发现 ${verdict.issues.length} 个问题，请修复后重新 submit。`,
        issues: verdict.issues,
        mandate: '请根据以上问题逐一修复，修复完成后再次调用 auto_dev_submit。',
    });
}
// ---------------------------------------------------------------------------
// Quick Pre-Check (reuse existing validation functions)
// ---------------------------------------------------------------------------
/**
 * Run quick pre-checks before invoking the tribunal.
 * Returns null if OK, or an error message string.
 */
async function runQuickPreCheck(phase, outputDir, projectRoot, startCommit) {
    if (phase === 5) {
        // IMP-003: Use unified GitManager.getChangedFiles
        const gm = new GitManager(projectRoot);
        const files = await gm.getChangedFiles({
            baseCommit: startCommit ?? 'HEAD~20',
        });
        const testFileCount = countTestFiles(files);
        // Read e2e-test-results.md
        let resultsContent = null;
        try {
            resultsContent = await readFile(join(outputDir, 'e2e-test-results.md'), 'utf-8');
        }
        catch {
            /* file doesn't exist */
        }
        const implFileCount = files.filter(f => isImplFile(f)).length;
        const result = await validatePhase5Artifacts(outputDir, testFileCount, resultsContent, implFileCount);
        if (!result.valid) {
            return result.mandate;
        }
    }
    if (phase === 6) {
        let reportContent = null;
        try {
            reportContent = await readFile(join(outputDir, 'acceptance-report.md'), 'utf-8');
        }
        catch {
            /* file doesn't exist */
        }
        const result = validatePhase6Artifacts(reportContent);
        if (!result.valid) {
            return result.mandate;
        }
    }
    if (phase === 7) {
        let retroContent = null;
        try {
            retroContent = await readFile(join(outputDir, 'retrospective.md'), 'utf-8');
        }
        catch {
            /* file doesn't exist */
        }
        const result = validatePhase7Artifacts(retroContent);
        if (!result.valid) {
            return result.mandate;
        }
    }
    return null;
}
// ---------------------------------------------------------------------------
// Tribunal Log Builder
// ---------------------------------------------------------------------------
export function buildTribunalLog(phase, verdict, source = 'claude-p') {
    let log = `# Tribunal Verdict - Phase ${phase}\n\n`;
    log += `## Source: ${source}\n\n`;
    log += `## Verdict: ${verdict.verdict}\n\n`;
    log += `## Issues\n`;
    log += verdict.issues
        .map(i => `- [${i.severity}] ${i.description}${i.file ? ` (${i.file})` : ''}`)
        .join('\n');
    log += '\n\n';
    if (verdict.traces?.length) {
        log += `## Phase 1/2 Traces\n`;
        log += verdict.traces
            .map(t => `- ${t.source} → ${t.status}${t.evidence ? ` — ${t.evidence}` : ''}`)
            .join('\n');
        log += '\n\n';
    }
    if (verdict.passEvidence?.length) {
        log += `## PASS Evidence\n`;
        log += verdict.passEvidence.map(e => `- ${e}`).join('\n');
        log += '\n\n';
    }
    log += `## Raw Output\n\`\`\`\n${verdict.raw}\n\`\`\`\n`;
    return log;
}
// test
//# sourceMappingURL=tribunal.js.map