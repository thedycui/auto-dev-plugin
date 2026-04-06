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

import { execFile, exec } from 'node:child_process';
import { stat } from 'node:fs/promises';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SpawnOptions {
  prompt: string;
  model?: 'opus' | 'sonnet' | 'haiku';
  timeout?: number; // default 300_000
  maxBuffer?: number; // default 4MB
  jsonSchema?: object; // if provided, adds --output-format json --json-schema
  cwd?: string;
}

export interface SpawnResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  parsed?: unknown; // only when jsonSchema provided
  crashed: boolean;
}

// ---------------------------------------------------------------------------
// Claude CLI Path Resolution
// ---------------------------------------------------------------------------

let cachedClaudePath: string | null = null;

/**
 * 4-tier fallback to resolve the `claude` CLI binary path:
 *   1. env TRIBUNAL_CLAUDE_PATH
 *   2. `command -v claude` (POSIX-portable)
 *   3. hardcoded candidate paths
 *   4. npx fallback (requires shell: true)
 */
export async function resolveClaudePath(): Promise<string> {
  // Tier 1: environment variable override
  if (process.env.TRIBUNAL_CLAUDE_PATH) {
    return process.env.TRIBUNAL_CLAUDE_PATH;
  }

  // Tier 2: command -v claude (POSIX, R2-4)
  try {
    const resolved = await new Promise<string>((resolve, reject) => {
      exec('command -v claude', (err, stdout) => {
        if (err || !stdout.trim()) reject(new Error('not found'));
        else resolve(stdout.trim());
      });
    });
    return resolved;
  } catch {
    /* fall through */
  }

  // Tier 3: hardcoded candidate paths
  const candidates = [
    '/usr/local/bin/claude',
    `${process.env.HOME}/.npm-global/bin/claude`,
    `${process.env.HOME}/.claude/local/claude`,
  ];
  for (const p of candidates) {
    try {
      await stat(p);
      return p;
    } catch {
      /* try next */
    }
  }

  // Tier 4: npx fallback (shell: true required)
  return 'npx --yes @anthropic-ai/claude-code';
}

/**
 * Cached wrapper for resolveClaudePath.
 */
export async function getClaudePath(): Promise<string> {
  if (!cachedClaudePath) {
    cachedClaudePath = await resolveClaudePath();
  }
  return cachedClaudePath;
}

/**
 * Reset the cached claude path (for testing).
 */
export function resetClaudePathCache(): void {
  cachedClaudePath = null;
}

// ---------------------------------------------------------------------------
// Agent Spawning
// ---------------------------------------------------------------------------

/**
 * Spawn a `claude -p` process with the given options.
 * Uses execFile for direct paths, exec with shell for npx paths.
 */
export async function spawnAgent(options: SpawnOptions): Promise<SpawnResult> {
  const {
    prompt,
    model = 'sonnet',
    timeout = 300_000,
    maxBuffer = 4 * 1024 * 1024,
    jsonSchema,
    cwd,
  } = options;

  const resolved = await getClaudePath();
  const useShell = resolved.startsWith('npx');

  const args: string[] = [
    '-p',
    prompt,
    '--model',
    model,
    '--dangerously-skip-permissions',
    '--no-session-persistence',
  ];

  if (jsonSchema) {
    args.push('--output-format', 'json');
    args.push('--json-schema', JSON.stringify(jsonSchema));
  }

  const spawnOpts: {
    timeout: number;
    maxBuffer: number;
    cwd?: string;
    shell?: string;
  } = {
    timeout,
    maxBuffer,
  };
  if (cwd) {
    spawnOpts.cwd = cwd;
  }

  return new Promise<SpawnResult>(resolve => {
    const callback = (err: Error | null, stdout: string, stderr: string) => {
      const exitCode = err ? ((err as any).code ?? 1) : 0;

      let parsed: unknown | undefined;
      let crashed = false;

      if (err) {
        crashed = true;
      } else if (jsonSchema) {
        try {
          const response = JSON.parse(stdout);
          parsed = response;
        } catch {
          crashed = true;
        }
      }

      resolve({
        stdout: stdout || '',
        stderr: stderr || '',
        exitCode: typeof exitCode === 'number' ? exitCode : 1,
        parsed,
        crashed,
      });
    };

    if (useShell) {
      const fullCmd = `${resolved} ${args.map(a => `'${a.replace(/'/g, "'\\''")}'`).join(' ')}`;
      exec(
        fullCmd,
        { ...spawnOpts, shell: '/bin/sh' },
        (err, stdout, stderr) => {
          callback(err, stdout, stderr);
        }
      );
    } else {
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
export async function spawnAgentWithRetry(
  options: SpawnOptions,
  maxRetries: number = 1,
  crashDetector?: (result: SpawnResult) => boolean
): Promise<SpawnResult> {
  const detect = crashDetector ?? ((r: SpawnResult) => r.crashed);

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const result = await spawnAgent(options);

    if (!detect(result)) {
      return result;
    }

    if (attempt < maxRetries) {
      await new Promise(r => setTimeout(r, 3000));
      continue;
    }

    // Exhausted retries, return last crash result
    return result;
  }

  // Unreachable
  throw new Error('unreachable');
}
