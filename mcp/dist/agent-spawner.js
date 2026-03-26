/**
 * agent-spawner.ts — Reusable Claude CLI process spawning module.
 *
 * Extracted from tribunal.ts to allow both tribunal judges and task agents
 * to spawn claude processes.
 *
 * Exports:
 *  - resolveClaudePath()        — 4-tier fallback
 *  - getClaudePath()            — cached wrapper
 *  - resetClaudePathCache()     — for testing
 *  - spawnAgent(options)        — generic claude -p spawner
 *  - spawnAgentWithRetry()      — retry wrapper with backoff
 */
import { execFile, exec } from "node:child_process";
import { stat } from "node:fs/promises";
// ---------------------------------------------------------------------------
// Claude CLI Path Resolution
// ---------------------------------------------------------------------------
let cachedClaudePath = null;
/**
 * 4-tier fallback to resolve the `claude` CLI binary path:
 *   1. env TRIBUNAL_CLAUDE_PATH
 *   2. `command -v claude` (POSIX-portable)
 *   3. hardcoded candidate paths
 *   4. npx fallback (requires shell: true)
 */
export async function resolveClaudePath() {
    // Tier 1: environment variable override
    if (process.env.TRIBUNAL_CLAUDE_PATH) {
        return process.env.TRIBUNAL_CLAUDE_PATH;
    }
    // Tier 2: command -v claude (POSIX, R2-4)
    try {
        const resolved = await new Promise((resolve, reject) => {
            exec("command -v claude", (err, stdout) => {
                if (err || !stdout.trim())
                    reject(new Error("not found"));
                else
                    resolve(stdout.trim());
            });
        });
        return resolved;
    }
    catch { /* fall through */ }
    // Tier 3: hardcoded candidate paths
    const candidates = [
        "/usr/local/bin/claude",
        `${process.env.HOME}/.npm-global/bin/claude`,
        `${process.env.HOME}/.claude/local/claude`,
    ];
    for (const p of candidates) {
        try {
            await stat(p);
            return p;
        }
        catch { /* try next */ }
    }
    // Tier 4: npx fallback (shell: true required)
    return "npx --yes @anthropic-ai/claude-code";
}
/**
 * Cached wrapper for resolveClaudePath.
 */
export async function getClaudePath() {
    if (!cachedClaudePath) {
        cachedClaudePath = await resolveClaudePath();
    }
    return cachedClaudePath;
}
/**
 * Reset the cached claude path (for testing).
 */
export function resetClaudePathCache() {
    cachedClaudePath = null;
}
// ---------------------------------------------------------------------------
// Agent Spawning
// ---------------------------------------------------------------------------
/**
 * Spawn a `claude -p` process with the given options.
 * Uses execFile for direct paths, exec with shell for npx paths.
 */
export async function spawnAgent(options) {
    const { prompt, model = "sonnet", timeout = 300_000, maxBuffer = 4 * 1024 * 1024, jsonSchema, cwd, } = options;
    const resolved = await getClaudePath();
    const useShell = resolved.startsWith("npx");
    const args = [
        "-p", prompt,
        "--model", model,
        "--dangerously-skip-permissions",
        "--no-session-persistence",
    ];
    if (jsonSchema) {
        args.push("--output-format", "json");
        args.push("--json-schema", JSON.stringify(jsonSchema));
    }
    const spawnOpts = {
        timeout,
        maxBuffer,
    };
    if (cwd) {
        spawnOpts.cwd = cwd;
    }
    return new Promise((resolve) => {
        const callback = (err, stdout, stderr) => {
            const exitCode = err ? (err.code ?? 1) : 0;
            let parsed;
            let crashed = false;
            if (err) {
                crashed = true;
            }
            else if (jsonSchema) {
                try {
                    const response = JSON.parse(stdout);
                    parsed = response;
                }
                catch {
                    crashed = true;
                }
            }
            resolve({
                stdout: stdout || "",
                stderr: stderr || "",
                exitCode: typeof exitCode === "number" ? exitCode : 1,
                parsed,
                crashed,
            });
        };
        if (useShell) {
            const fullCmd = `${resolved} ${args.map(a => `'${a.replace(/'/g, "'\\''")}'`).join(" ")}`;
            exec(fullCmd, { ...spawnOpts, shell: "/bin/sh" }, (err, stdout, stderr) => {
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
// Retry Wrapper
// ---------------------------------------------------------------------------
/**
 * Spawn agent with retry on crash.
 * Default: 1 retry (2 total attempts), 3s backoff.
 * crashDetector allows custom crash detection; defaults to checking SpawnResult.crashed.
 */
export async function spawnAgentWithRetry(options, maxRetries = 1, crashDetector) {
    const detect = crashDetector ?? ((r) => r.crashed);
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        const result = await spawnAgent(options);
        if (!detect(result)) {
            return result;
        }
        if (attempt < maxRetries) {
            await new Promise((r) => setTimeout(r, 3000));
            continue;
        }
        // Exhausted retries, return last crash result
        return result;
    }
    // Unreachable
    throw new Error("unreachable");
}
//# sourceMappingURL=agent-spawner.js.map