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

import { execFile, exec } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { TribunalVerdict, StateJson } from "./types.js";
import { TRIBUNAL_SCHEMA } from "./tribunal-schema.js";
import { getTribunalChecklist } from "./tribunal-checklists.js";
import { generateRetrospectiveData } from "./retrospective-data.js";
import { internalCheckpoint, StateManager } from "./state-manager.js";
import {
  parseInitMarker,
  validatePhase5Artifacts,
  validatePhase6Artifacts,
  validatePhase7Artifacts,
  countTestFiles,
  computeNextDirective,
} from "./phase-enforcer.js";
import { LessonsManager } from "./lessons-manager.js";
import { isTestFile, isImplFile } from "./tdd-gate.js";
import type { NextDirective } from "./phase-enforcer.js";
import { getClaudePath } from "./agent-spawner.js";

// Re-export for backward compatibility
export { getClaudePath, resolveClaudePath } from "./agent-spawner.js";

// ---------------------------------------------------------------------------
// Digest Helpers (Task 1 + Task 2)
// ---------------------------------------------------------------------------

/**
 * Read a file and truncate to maxLines. Returns null if file does not exist.
 */
export async function safeRead(path: string, maxLines: number): Promise<string | null> {
  try {
    const content = await readFile(path, "utf-8");
    const lines = content.split("\n");
    if (lines.length <= maxLines) return content;
    return lines.slice(0, maxLines).join("\n") + `\n... (truncated, ${lines.length - maxLines} lines omitted)`;
  } catch {
    return null;
  }
}

/**
 * Return the list of files to inline for each tribunal phase.
 */
export function getPhaseFiles(
  phase: number,
  outputDir: string,
): Array<{ label: string; path: string; maxLines: number }> {
  if (phase === 4) {
    return [
      { label: "Phase 1 设计评审", path: join(outputDir, "design-review.md"), maxLines: 100 },
      { label: "Phase 2 计划评审", path: join(outputDir, "plan-review.md"), maxLines: 100 },
      { label: "主 Agent 的代码审查", path: join(outputDir, "code-review.md"), maxLines: 100 },
    ];
  }
  if (phase === 5) {
    return [
      { label: "E2E 测试结果", path: join(outputDir, "e2e-test-results.md"), maxLines: 80 },
      { label: "框架执行的测试日志（可信）", path: join(outputDir, "framework-test-log.txt"), maxLines: 80 },
      { label: "框架测试退出码（可信）", path: join(outputDir, "framework-test-exitcode.txt"), maxLines: 80 },
    ];
  }
  if (phase === 6) {
    return [
      { label: "验收报告", path: join(outputDir, "acceptance-report.md"), maxLines: 100 },
    ];
  }
  if (phase === 7) {
    return [
      { label: "复盘报告", path: join(outputDir, "retrospective.md"), maxLines: 80 },
      { label: "框架自动生成的数据（可信）", path: join(outputDir, "retrospective-data.md"), maxLines: 80 },
      { label: "Progress Log", path: join(outputDir, "progress-log.md"), maxLines: 80 },
    ];
  }
  return [];
}

/**
 * Get key code diff excluding dist/, *.map, *.lock, node_modules/, __tests__/.
 * Budget is distributed evenly across files (min 20 lines per file).
 */
export async function getKeyDiff(
  projectRoot: string,
  startCommit: string | undefined,
  totalBudget: number,
): Promise<string> {
  const diffBase = startCommit ?? "HEAD~1";
  const rawDiff = await new Promise<string>((resolve) => {
    execFile("git", [
      "diff", diffBase, "--",
      ".", ":!*/dist/*", ":!*.map", ":!*.lock", ":!*/node_modules/*", ":!*/__tests__/*",
    ], {
      cwd: projectRoot,
      maxBuffer: 5 * 1024 * 1024,
    }, (err, stdout) => resolve(err ? "" : stdout));
  });

  if (!rawDiff) return "(no diff)";

  // Split diff by file (each file starts with "diff --git")
  const fileSections = rawDiff.split(/(?=^diff --git )/m).filter((s) => s.trim().length > 0);
  if (fileSections.length === 0) return "(no diff)";

  const perFile = Math.max(20, Math.floor(totalBudget / fileSections.length));
  const truncated: string[] = [];

  for (const section of fileSections) {
    const lines = section.split("\n");
    if (lines.length <= perFile) {
      truncated.push(section);
    } else {
      truncated.push(
        lines.slice(0, perFile).join("\n") +
        `\n... (truncated, ${lines.length - perFile} lines omitted)`,
      );
    }
  }

  return truncated.join("\n");
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
export async function prepareTribunalInput(
  phase: number,
  outputDir: string,
  projectRoot: string,
  startCommit?: string,
): Promise<{ digestPath: string; digestContent: string }> {
  const digestFile = join(outputDir, `tribunal-digest-phase${phase}.md`);

  // Phase 5: framework executes testCmd independently (tamper-proof) — must run BEFORE inlining
  if (phase === 5) {
    const progressLogContent = await readFile(
      join(outputDir, "progress-log.md"), "utf-8",
    ).catch(() => "");
    const initData = parseInitMarker(progressLogContent);
    if (initData?.testCmd) {
      const { stdout: testStdout, stderr: testStderr, exitCode } = await new Promise<{
        stdout: string; stderr: string; exitCode: number;
      }>((resolve) => {
        execFile("sh", ["-c", initData.testCmd], {
          cwd: projectRoot,
          timeout: 300_000,
          maxBuffer: 5 * 1024 * 1024,
        }, (err, stdout, stderr) => {
          const code = err ? ((err as any).code ?? 1) : 0;
          resolve({
            stdout: stdout || "",
            stderr: stderr || "",
            exitCode: typeof code === "number" ? code : 1,
          });
        });
      });
      await writeFile(
        join(outputDir, "framework-test-log.txt"),
        testStdout + "\n" + testStderr,
        "utf-8",
      );
      await writeFile(
        join(outputDir, "framework-test-exitcode.txt"),
        String(exitCode),
        "utf-8",
      );
    }
  }

  // Phase 7: generate retrospective data before tribunal
  if (phase === 7) {
    await generateRetrospectiveData(outputDir);
  }

  let content = `# Phase ${phase} 独立裁决\n\n`;
  content += `你是独立裁决者。你的默认立场是 FAIL。\n`;
  content += `PASS 必须对每条检查项提供证据（文件名:行号），FAIL 只需说明理由。\n`;
  content += `PASS 的举证成本远大于 FAIL —— 如果你不确定，判 FAIL。\n\n`;
  content += `## 范围限制\n\n`;
  content += `- 你只能审查本次 diff 涉及的变更，不得对 diff 之外的代码提出阻塞性问题（P0/P1）。\n`;
  content += `- P0/P1 问题必须提供 acRef（关联验收标准编号），否则将被降级为 advisory。\n`;
  content += `- 不在本次任务范围内的改进建议请放入 advisory 字段。\n\n`;

  // 1. Framework statistics (hard data — git diff --stat)
  const diffBase = startCommit ?? "HEAD";
  const diffStat = await new Promise<string>((resolve) => {
    execFile("git", ["diff", "--stat", diffBase], {
      cwd: projectRoot,
      maxBuffer: 1 * 1024 * 1024,
    }, (err, stdout) => resolve(err ? "(git diff --stat failed)" : stdout));
  });
  content += `## 框架统计（可信数据）\n\`\`\`\n${diffStat}\n\`\`\`\n\n`;

  // 2. Inline review materials (truncated to reasonable length)
  const filesToInline = getPhaseFiles(phase, outputDir);
  for (const { label, path, maxLines } of filesToInline) {
    const text = await safeRead(path, maxLines);
    if (text) content += `## ${label}\n\`\`\`\n${text}\n\`\`\`\n\n`;
  }

  // 3. Key code diff (excluding test/config/dist, truncated)
  const keyDiff = await getKeyDiff(projectRoot, startCommit, 300);
  content += `## 关键代码变更\n\`\`\`diff\n${keyDiff}\n\`\`\`\n\n`;

  // 4. Inject tribunal-category lessons (calibration)
  try {
    const lessonsManager = new LessonsManager(outputDir, projectRoot);
    const tribunalLessons = (await lessonsManager.get(undefined, "tribunal"))
      .filter((l) => !l.retired)
      .slice(0, 5);
    if (tribunalLessons.length > 0) {
      content += `## 裁决校准经验（历史积累）\n\n`;
      for (const l of tribunalLessons) {
        content += `- [${l.severity ?? "minor"}] ${l.lesson}\n`;
      }
      content += `\n`;
    }
  } catch { /* lessons not available, skip */ }

  // 5. Checklist
  content += `## 检查清单\n\n${getTribunalChecklist(phase)}\n`;

  await writeFile(digestFile, content, "utf-8");
  return { digestPath: digestFile, digestContent: content };
}

// ---------------------------------------------------------------------------
// Tribunal Invocation
// ---------------------------------------------------------------------------

/** Known error strings that indicate a crash (not a legitimate verdict) */
const CRASH_INDICATORS = [
  "裁决进程执行失败",
];

/** Error strings that indicate JSON parse failure (raw output may still be usable) */
const PARSE_FAILURE_INDICATORS = [
  "JSON 解析失败",
  "未返回有效的 structured_output",
];

/**
 * Spawn an independent `claude` process to judge the tribunal input.
 * Parses structured_output from JSON response.
 * Post-parse: PASS without passEvidence is overridden to FAIL (revision 4).
 */
export async function runTribunal(
  digestContent: string,
  phase: number,
): Promise<TribunalVerdict> {
  const resolved = await getClaudePath();
  const useShell = resolved.startsWith("npx");

  const prompt = `以下是待裁决的材料，请按照检查清单逐条裁决。\n\n${digestContent}`;
  const schemaStr = JSON.stringify(TRIBUNAL_SCHEMA);

  const args = [
    "-p", prompt,
    "--output-format", "json",
    "--json-schema", schemaStr,
    "--dangerously-skip-permissions",
    "--model", "sonnet",
    "--no-session-persistence",
  ];

  const spawnOpts = {
    timeout: 180_000,
    maxBuffer: 2 * 1024 * 1024,
  };

  return new Promise<TribunalVerdict>((resolve) => {
    const callback = (err: Error | null, stdout: string, _stderr: string) => {
      if (err) {
        resolve({
          verdict: "FAIL",
          issues: [{ severity: "P0", description: `裁决进程执行失败: ${err.message}` }],
          raw: err.message,
        });
        return;
      }

      try {
        const response = JSON.parse(stdout);
        const data = response.structured_output;

        if (!data || !data.verdict) {
          resolve({
            verdict: "FAIL",
            issues: [{ severity: "P0", description: "裁决 Agent 未返回有效的 structured_output" }],
            raw: stdout,
          });
          return;
        }

        // Revision 4: PASS without passEvidence -> override to FAIL
        if (data.verdict === "PASS" && (!data.passEvidence || data.passEvidence.length === 0)) {
          resolve({
            verdict: "FAIL",
            issues: [{
              severity: "P0",
              description: "裁决判定 PASS 但未提供任何证据（passEvidence 为空）。PASS 必须逐条举证。",
            }],
            raw: stdout,
          });
          return;
        }

        resolve({ ...data, raw: stdout });
      } catch (parseErr) {
        resolve({
          verdict: "FAIL",
          issues: [{
            severity: "P0",
            description: `裁决输出 JSON 解析失败: ${parseErr}`,
          }],
          raw: stdout || "",
        });
      }
    };

    if (useShell) {
      // npx path requires shell: true
      const fullCmd = `${resolved} ${args.map(a => `'${a.replace(/'/g, "'\\''")}'`).join(" ")}`;
      exec(fullCmd, { ...spawnOpts, shell: "/bin/sh" }, (err, stdout, stderr) => {
        callback(err, stdout, stderr);
      });
    } else {
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
 * Run tribunal with 1 retry for crash (not legitimate FAIL).
 * Uses crash detection via known error strings.
 * 3s backoff between attempts.
 * Returns { verdict, crashed, rawParseFailure } —
 *   crashed=true means process-level crash (needs full fallback),
 *   rawParseFailure=true means LLM responded but JSON was malformed (agent can parse raw).
 */
export async function runTribunalWithRetry(
  digestContent: string,
  phase: number,
): Promise<{ verdict: TribunalVerdict; crashed: boolean; rawParseFailure?: boolean }> {
  const MAX_RETRIES = 1;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const result = await runTribunal(digestContent, phase);

    // Check if it's a JSON parse failure (LLM responded but output wasn't valid JSON).
    // The raw output likely contains the verdict in a readable form — return it
    // immediately for the main agent to extract, no retry needed.
    const isParseFailure = result.issues.some((i) =>
      PARSE_FAILURE_INDICATORS.some((indicator) => i.description.includes(indicator)),
    );
    if (isParseFailure) {
      return { verdict: result, crashed: false, rawParseFailure: true };
    }

    // Distinguish legitimate verdict from process crash
    const isCrash = result.issues.some((i) =>
      CRASH_INDICATORS.some((indicator) => i.description.includes(indicator)),
    );

    if (!isCrash) return { verdict: result, crashed: false }; // Normal verdict (PASS or FAIL)

    if (attempt < MAX_RETRIES) {
      // Transient failure, backoff 3s and retry
      await new Promise((r) => setTimeout(r, 3000));
      continue;
    }

    // Exhausted retries, return crash result
    return {
      verdict: {
        verdict: "FAIL",
        issues: [{
          severity: "P0",
          description: `裁决进程连续 ${MAX_RETRIES + 1} 次崩溃（非裁决结果），请检查 claude CLI 是否可用后重新 submit`,
        }],
        raw: result.raw,
      },
      crashed: true,
    };
  }

  // R2-1: unreachable — the loop always returns
  throw new Error("unreachable");
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
export async function crossValidate(
  phase: number,
  outputDir: string,
  projectRoot: string,
  startCommit?: string,
): Promise<string | null> {
  // Phase 4: git diff non-empty check
  if (phase === 4) {
    if (!startCommit) {
      return "startCommit 未设置（可能是旧版 state 迁移），无法校验 Phase 4 代码变更";
    }
    const diffOutput = await new Promise<string>((resolve) => {
      execFile("git", ["diff", "--stat", startCommit], {
        cwd: projectRoot,
      }, (err, stdout) => resolve(err ? "" : stdout || ""));
    });
    if (!diffOutput.trim()) {
      return "git diff 为空，没有任何代码变更，裁决 Agent 不应判定 PASS";
    }
  }

  if (phase === 5) {
    // Check exit code (revision 6: exit code, not regex)
    try {
      const exitCodeStr = await readFile(
        join(outputDir, "framework-test-exitcode.txt"), "utf-8",
      );
      const exitCode = parseInt(exitCodeStr.trim(), 10);
      if (exitCode !== 0) {
        return "框架执行 testCmd 退出码非零，但裁决 Agent 判定 PASS";
      }
    } catch { /* no exit code file — skip this check */ }

    // Check impl files vs test files ratio (committed + staged + untracked)
    const diffBase = startCommit ?? "HEAD~20";
    const diffOutput = await new Promise<string>((resolve) => {
      execFile("git", ["diff", "--name-only", "--diff-filter=AM", diffBase, "HEAD"], {
        cwd: projectRoot,
      }, (err, stdout) => {
        const committed = err ? "" : (stdout || "");
        // Also check staged (cached) and untracked files
        execFile("git", ["diff", "--cached", "--name-only", "--diff-filter=AM"], {
          cwd: projectRoot,
        }, (err2, stdout2) => {
          const staged = err2 ? "" : (stdout2 || "");
          execFile("git", ["ls-files", "--others", "--exclude-standard"], {
            cwd: projectRoot,
          }, (err3, stdout3) => {
            const untracked = err3 ? "" : (stdout3 || "");
            resolve(committed + "\n" + staged + "\n" + untracked);
          });
        });
      });
    });
    const files = [...new Set(diffOutput.trim().split("\n").filter((f) => f.length > 0))];
    const implCount = files.filter(f => isImplFile(f)).length;
    const testCount = files.filter(f => isTestFile(f)).length;
    if (implCount > 0 && testCount === 0) {
      return `${implCount} 个新增实现文件但 0 个测试文件，裁决 Agent 不应判定 PASS`;
    }
  }

  // Phase 6: acceptance-report.md has PASS/FAIL result
  if (phase === 6) {
    try {
      const reportContent = await readFile(join(outputDir, "acceptance-report.md"), "utf-8");
      if (!/\b(PASS|FAIL)\b/.test(reportContent)) {
        return "acceptance-report.md 中没有 PASS/FAIL 结果";
      }
    } catch {
      return "acceptance-report.md 不存在";
    }
  }

  // Phase 7: retrospective.md exists and >= 50 lines
  if (phase === 7) {
    try {
      const retroContent = await readFile(join(outputDir, "retrospective.md"), "utf-8");
      const lineCount = retroContent.split("\n").length;
      if (lineCount < 50) {
        return `retrospective.md 只有 ${lineCount} 行（要求 >= 50 行）`;
      }
    } catch {
      return "retrospective.md 不存在";
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Tool Result Helper
// ---------------------------------------------------------------------------

export interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
}

export function textResult(obj: Record<string, unknown>): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(obj, null, 2) }],
  };
}

// ---------------------------------------------------------------------------
// Pure Tribunal Evaluation (no state side effects)
// ---------------------------------------------------------------------------

export interface EvalTribunalResult {
  /** Final verdict after auto-override and cross-validation */
  verdict: "PASS" | "FAIL";
  /** Issues found */
  issues: TribunalVerdict["issues"];
  /** Advisory items (downgraded from P0/P1 without acRef) */
  advisory?: Array<{ description: string; suggestion?: string }>;
  /** Whether the tribunal process crashed (needs fallback) */
  crashed?: boolean;
  /** Whether JSON parse failed but raw LLM output is available for agent extraction */
  rawParseFailure?: boolean;
  /** Raw LLM output when parse failed (agent can extract verdict from this) */
  rawOutput?: string;
  /** Digest content for fallback (only when crashed or rawParseFailure) */
  digest?: string;
  digestHash?: string;
  /** Pre-check failure message (no tribunal was run) */
  preCheckError?: string;
  /** Cross-validation override message */
  crossValidateOverride?: string;
}

/**
 * Pure tribunal evaluation — runs tribunal and returns verdict WITHOUT writing
 * any state (no checkpoint, no phase advancement, no counter updates).
 *
 * The orchestrator is responsible for all state changes based on this result.
 */
export async function evaluateTribunal(
  projectRoot: string,
  outputDir: string,
  phase: number,
  topic: string,
  summary: string,
  startCommit?: string,
): Promise<EvalTribunalResult> {
  // 1. Quick pre-checks
  const preCheckError = await runQuickPreCheck(phase, outputDir, projectRoot, startCommit);
  if (preCheckError) {
    return { verdict: "FAIL", issues: [{ severity: "P0", description: preCheckError }], preCheckError };
  }

  // 2. Prepare tribunal input
  const { digestContent } = await prepareTribunalInput(phase, outputDir, projectRoot, startCommit);

  // 3. Run tribunal with retry
  const { verdict, crashed, rawParseFailure } = await runTribunalWithRetry(digestContent, phase);

  // 4. Write tribunal log (audit trail — not state)
  const tribunalLog = buildTribunalLog(phase, verdict, "claude-p");
  await writeFile(join(outputDir, `tribunal-phase${phase}.md`), tribunalLog, "utf-8");

  // 5a. Parse failure → return raw output for main agent to extract verdict
  // The LLM responded but output wasn't valid JSON. The raw text likely contains
  // the verdict in a readable form that the main agent can parse.
  if (rawParseFailure && verdict.raw) {
    const digestHash = createHash("sha256").update(digestContent).digest("hex").slice(0, 16);
    return {
      verdict: "FAIL",
      issues: [],
      rawParseFailure: true,
      rawOutput: verdict.raw,
      digest: digestContent,
      digestHash,
    };
  }

  // 5b. Crashed → return for fallback (process-level failure, no raw output available)
  if (crashed) {
    const digestHash = createHash("sha256").update(digestContent).digest("hex").slice(0, 16);
    return { verdict: "FAIL", issues: [], crashed: true, digest: digestContent, digestHash };
  }

  // 6. Auto-override: FAIL without P0/P1 acRef → PASS
  const advisory: Array<{ description: string; suggestion?: string }> = [];
  if (verdict.verdict === "FAIL") {
    const remaining = verdict.issues.filter((issue) => {
      if ((issue.severity === "P0" || issue.severity === "P1") && !(issue as any).acRef) {
        advisory.push({ description: issue.description, suggestion: issue.suggestion });
        return false;
      }
      return true;
    });
    const hasBlockingIssues = remaining.some(
      (i) => i.severity === "P0" || i.severity === "P1",
    );
    if (!hasBlockingIssues) {
      verdict.verdict = "PASS";
      verdict.issues = remaining;
    }
  }

  // 7. Cross-validate on PASS
  if (verdict.verdict === "PASS") {
    const crossCheckFail = await crossValidate(phase, outputDir, projectRoot, startCommit);
    if (crossCheckFail) {
      return {
        verdict: "FAIL",
        issues: [{ severity: "P0", description: crossCheckFail }],
        crossValidateOverride: crossCheckFail,
        advisory,
      };
    }
  }

  return {
    verdict: verdict.verdict as "PASS" | "FAIL",
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
export async function executeTribunal(
  projectRoot: string,
  outputDir: string,
  phase: number,
  topic: string,
  summary: string,
  sm: StateManager,
  state: StateJson,
): Promise<ToolResult> {
  const startCommit = state.startCommit;

  // ------- Quick pre-checks (avoid wasting tribunal tokens) -------
  const preCheckError = await runQuickPreCheck(phase, outputDir, projectRoot, startCommit);
  if (preCheckError) {
    return textResult({
      status: "TRIBUNAL_FAIL",
      phase,
      message: preCheckError,
      issues: [{ severity: "P0", description: preCheckError }],
      mandate: "请修复上述问题后重新 submit。",
    });
  }

  // ------- Prepare tribunal input files -------
  const { digestPath, digestContent } = await prepareTribunalInput(phase, outputDir, projectRoot, startCommit);

  // ------- Run tribunal with retry -------
  const { verdict, crashed } = await runTribunalWithRetry(digestContent, phase);

  // ------- Write tribunal log (audit trail) -------
  const tribunalLog = buildTribunalLog(phase, verdict, "claude-p");
  await writeFile(join(outputDir, `tribunal-phase${phase}.md`), tribunalLog, "utf-8");

  // ------- Crashed: return TRIBUNAL_PENDING for fallback -------
  if (crashed) {
    const digestHash = createHash("sha256").update(digestContent).digest("hex").slice(0, 16);
    return textResult({
      status: "TRIBUNAL_PENDING",
      phase,
      message: "裁决进程崩溃，请使用 subagent 执行 fallback 裁决。",
      digest: digestContent,
      digestHash,
      mandate: "[FALLBACK] 请调用 auto-dev-reviewer subagent 审查上述材料，然后提交 auto_dev_tribunal_verdict。",
    });
  }

  // ------- Auto-override: FAIL without P0/P1 -> PASS -------
  if (verdict.verdict === "FAIL") {
    // Downgrade P0/P1 issues without acRef to advisory
    const advisory: Array<{ description: string; suggestion?: string }> = [];
    const remaining = verdict.issues.filter((issue) => {
      if ((issue.severity === "P0" || issue.severity === "P1") && !(issue as any).acRef) {
        advisory.push({ description: issue.description, suggestion: issue.suggestion });
        return false;
      }
      return true;
    });

    const hasBlockingIssues = remaining.some(
      (i) => i.severity === "P0" || i.severity === "P1",
    );

    if (!hasBlockingIssues) {
      // Override FAIL to PASS — no real P0/P1 with acRef
      verdict.verdict = "PASS";
      verdict.issues = remaining;
      (verdict as any).advisory = advisory;
    }
  }

  // ------- Cross-validate on PASS -------
  if (verdict.verdict === "PASS") {
    const crossCheckFail = await crossValidate(phase, outputDir, projectRoot, startCommit);
    if (crossCheckFail) {
      return textResult({
        status: "TRIBUNAL_OVERRIDDEN",
        phase,
        message: `裁决 Agent 判定 PASS，但框架交叉验证不通过：${crossCheckFail}`,
        issues: [{ severity: "P0", description: crossCheckFail }],
        mandate: "框架硬数据与裁决结果矛盾，请修复后重新 submit。",
      });
    }
  }

  // ------- PASS: write checkpoint and return success -------
  if (verdict.verdict === "PASS") {
    const ckptSummary = `[TRIBUNAL] 独立裁决通过。${verdict.issues.length} 个建议项。`;
    const ckptResult = await internalCheckpoint(sm, state, phase, "PASS", ckptSummary);

    const nextDirective: NextDirective = ckptResult.ok
      ? ckptResult.nextDirective
      : computeNextDirective(phase, "PASS", state);

    return textResult({
      status: "TRIBUNAL_PASS",
      phase,
      nextPhase: nextDirective.nextPhase,
      mandate: nextDirective.mandate,
      message: "独立裁决通过，checkpoint 已自动写入。",
      suggestions: verdict.issues,
    });
  }

  // ------- FAIL: return issues to main agent -------
  return textResult({
    status: "TRIBUNAL_FAIL",
    phase,
    message: `独立裁决未通过。发现 ${verdict.issues.length} 个问题，请修复后重新 submit。`,
    issues: verdict.issues,
    mandate: "请根据以上问题逐一修复，修复完成后再次调用 auto_dev_submit。",
  });
}

// ---------------------------------------------------------------------------
// Quick Pre-Check (reuse existing validation functions)
// ---------------------------------------------------------------------------

/**
 * Run quick pre-checks before invoking the tribunal.
 * Returns null if OK, or an error message string.
 */
async function runQuickPreCheck(
  phase: number,
  outputDir: string,
  projectRoot: string,
  startCommit?: string,
): Promise<string | null> {
  if (phase === 5) {
    // Get test file count from git diff (committed + staged + untracked)
    const diffBase = startCommit ?? "HEAD~20";
    const diffOutput = await new Promise<string>((resolve) => {
      execFile("git", ["diff", "--name-only", "--diff-filter=AM", diffBase, "HEAD"], {
        cwd: projectRoot,
      }, (err, stdout) => {
        const committed = err ? "" : (stdout || "");
        execFile("git", ["diff", "--cached", "--name-only", "--diff-filter=AM"], {
          cwd: projectRoot,
        }, (err2, stdout2) => {
          const staged = err2 ? "" : (stdout2 || "");
          execFile("git", ["ls-files", "--others", "--exclude-standard"], {
            cwd: projectRoot,
          }, (err3, stdout3) => {
            const untracked = err3 ? "" : (stdout3 || "");
            resolve(committed + "\n" + staged + "\n" + untracked);
          });
        });
      });
    });
    const files = [...new Set(diffOutput.trim().split("\n").filter((f) => f.length > 0))];
    const testFileCount = countTestFiles(files);

    // Read e2e-test-results.md
    let resultsContent: string | null = null;
    try {
      resultsContent = await readFile(join(outputDir, "e2e-test-results.md"), "utf-8");
    } catch { /* file doesn't exist */ }

    const implFileCount = files.filter(f => isImplFile(f)).length;

    const result = await validatePhase5Artifacts(outputDir, testFileCount, resultsContent, implFileCount);
    if (!result.valid) {
      return result.mandate;
    }
  }

  if (phase === 6) {
    let reportContent: string | null = null;
    try {
      reportContent = await readFile(join(outputDir, "acceptance-report.md"), "utf-8");
    } catch { /* file doesn't exist */ }

    const result = validatePhase6Artifacts(reportContent);
    if (!result.valid) {
      return result.mandate;
    }
  }

  if (phase === 7) {
    let retroContent: string | null = null;
    try {
      retroContent = await readFile(join(outputDir, "retrospective.md"), "utf-8");
    } catch { /* file doesn't exist */ }

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

export function buildTribunalLog(
  phase: number,
  verdict: TribunalVerdict,
  source: "claude-p" | "fallback-subagent" = "claude-p",
): string {
  let log = `# Tribunal Verdict - Phase ${phase}\n\n`;
  log += `## Source: ${source}\n\n`;
  log += `## Verdict: ${verdict.verdict}\n\n`;
  log += `## Issues\n`;
  log += verdict.issues
    .map((i) => `- [${i.severity}] ${i.description}${i.file ? ` (${i.file})` : ""}`)
    .join("\n");
  log += "\n\n";

  if (verdict.traces?.length) {
    log += `## Phase 1/2 Traces\n`;
    log += verdict.traces
      .map((t) => `- ${t.source} → ${t.status}${t.evidence ? ` — ${t.evidence}` : ""}`)
      .join("\n");
    log += "\n\n";
  }

  if (verdict.passEvidence?.length) {
    log += `## PASS Evidence\n`;
    log += verdict.passEvidence.map((e) => `- ${e}`).join("\n");
    log += "\n\n";
  }

  log += `## Raw Output\n\`\`\`\n${verdict.raw}\n\`\`\`\n`;
  return log;
}
