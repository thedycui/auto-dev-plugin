/**
 * Agent Spawner Tests
 *
 * Tests the extracted agent-spawner module:
 *   - resolveClaudePath 4-tier fallback
 *   - getClaudePath caching
 *   - resetClaudePathCache
 *   - spawnAgent arg construction
 *   - spawnAgent JSON schema option
 *   - spawnAgent shell usage for npx paths
 *   - spawnAgentWithRetry crash retry
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — must be declared before imports that use them
// ---------------------------------------------------------------------------

vi.mock("node:child_process", () => {
  const mockExecFile = vi.fn();
  const mockExec = vi.fn();
  return {
    execFile: mockExecFile,
    exec: mockExec,
  };
});

vi.mock("node:fs/promises", () => {
  const mockStat = vi.fn();
  return {
    stat: mockStat,
  };
});

// Import after mocks are set up
import { execFile, exec } from "node:child_process";
import { stat } from "node:fs/promises";
import {
  resolveClaudePath,
  getClaudePath,
  resetClaudePathCache,
  spawnAgent,
  spawnAgentWithRetry,
} from "../agent-spawner.js";

// Type-safe mock references
const mockExecFile = vi.mocked(execFile);
const mockExec = vi.mocked(exec);
const mockStat = vi.mocked(stat);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setupExecFileCallback(
  error: Error | null,
  stdout: string,
  stderr: string = "",
): void {
  mockExecFile.mockImplementation((...args: any[]) => {
    const callback = args[args.length - 1];
    if (typeof callback === "function") {
      callback(error, stdout, stderr);
    }
    return undefined as any;
  });
}

function setupExecCallback(
  error: Error | null,
  stdout: string,
  stderr: string = "",
): void {
  mockExec.mockImplementation((...args: any[]) => {
    const callback = args[args.length - 1];
    if (typeof callback === "function") {
      callback(error, stdout, stderr);
    }
    return undefined as any;
  });
}

// ---------------------------------------------------------------------------
// resolveClaudePath
// ---------------------------------------------------------------------------

describe("resolveClaudePath — 4-tier fallback", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resetClaudePathCache();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns env var when TRIBUNAL_CLAUDE_PATH is set", async () => {
    vi.stubEnv("TRIBUNAL_CLAUDE_PATH", "/custom/path/claude");

    const result = await resolveClaudePath();

    expect(result).toBe("/custom/path/claude");
  });

  it("falls through to command -v claude when env not set", async () => {
    vi.stubEnv("TRIBUNAL_CLAUDE_PATH", "");

    // Mock exec for "command -v claude"
    mockExec.mockImplementation((...args: any[]) => {
      const callback = args[args.length - 1];
      if (typeof callback === "function") {
        callback(null, "/usr/local/bin/claude\n", "");
      }
      return undefined as any;
    });

    const result = await resolveClaudePath();

    expect(result).toBe("/usr/local/bin/claude");
  });

  it("falls through to hardcoded paths when command -v fails", async () => {
    vi.stubEnv("TRIBUNAL_CLAUDE_PATH", "");

    // command -v fails
    mockExec.mockImplementation((...args: any[]) => {
      const callback = args[args.length - 1];
      if (typeof callback === "function") {
        callback(new Error("not found"), "", "");
      }
      return undefined as any;
    });

    // stat succeeds for first candidate
    mockStat.mockResolvedValueOnce({} as any);

    const result = await resolveClaudePath();

    expect(result).toBe("/usr/local/bin/claude");
  });

  it("returns npx fallback when all tiers fail", async () => {
    vi.stubEnv("TRIBUNAL_CLAUDE_PATH", "");

    // command -v fails
    mockExec.mockImplementation((...args: any[]) => {
      const callback = args[args.length - 1];
      if (typeof callback === "function") {
        callback(new Error("not found"), "", "");
      }
      return undefined as any;
    });

    // All stat calls fail
    mockStat.mockRejectedValue(new Error("ENOENT"));

    const result = await resolveClaudePath();

    expect(result).toBe("npx --yes @anthropic-ai/claude-code");
  });
});

// ---------------------------------------------------------------------------
// getClaudePath / resetClaudePathCache
// ---------------------------------------------------------------------------

describe("getClaudePath — caching", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resetClaudePathCache();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("caches the result after first call", async () => {
    vi.stubEnv("TRIBUNAL_CLAUDE_PATH", "/cached/claude");

    const first = await getClaudePath();
    const second = await getClaudePath();

    expect(first).toBe("/cached/claude");
    expect(second).toBe("/cached/claude");
  });

  it("resetClaudePathCache clears the cache", async () => {
    vi.stubEnv("TRIBUNAL_CLAUDE_PATH", "/first/claude");
    await getClaudePath();

    resetClaudePathCache();
    vi.stubEnv("TRIBUNAL_CLAUDE_PATH", "/second/claude");
    const result = await getClaudePath();

    expect(result).toBe("/second/claude");
  });
});

// ---------------------------------------------------------------------------
// spawnAgent
// ---------------------------------------------------------------------------

describe("spawnAgent — arg construction", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resetClaudePathCache();
    vi.stubEnv("TRIBUNAL_CLAUDE_PATH", "/usr/bin/claude-mock");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("constructs correct args with defaults", async () => {
    setupExecFileCallback(null, "output text");

    await spawnAgent({ prompt: "test prompt" });

    expect(mockExecFile).toHaveBeenCalledTimes(1);
    const callArgs = mockExecFile.mock.calls[0]!;
    const binary = callArgs[0];
    const args = callArgs[1] as string[];

    expect(binary).toBe("/usr/bin/claude-mock");
    expect(args).toContain("-p");
    expect(args).toContain("test prompt");
    expect(args).toContain("--model");
    expect(args).toContain("sonnet");
    expect(args).toContain("--dangerously-skip-permissions");
    expect(args).toContain("--no-session-persistence");
    // No json schema args by default
    expect(args).not.toContain("--output-format");
    expect(args).not.toContain("--json-schema");
  });

  it("adds --json-schema when jsonSchema option provided", async () => {
    setupExecFileCallback(null, JSON.stringify({ result: "ok" }));

    const schema = { type: "object", properties: { verdict: { type: "string" } } };
    await spawnAgent({ prompt: "test", jsonSchema: schema });

    const callArgs = mockExecFile.mock.calls[0]!;
    const args = callArgs[1] as string[];

    expect(args).toContain("--output-format");
    expect(args).toContain("json");
    expect(args).toContain("--json-schema");
    expect(args).toContain(JSON.stringify(schema));
  });

  it("uses shell for npx paths", async () => {
    resetClaudePathCache();
    vi.stubEnv("TRIBUNAL_CLAUDE_PATH", "npx --yes @anthropic-ai/claude-code");

    setupExecCallback(null, "npx output");

    await spawnAgent({ prompt: "test prompt" });

    expect(mockExec).toHaveBeenCalledTimes(1);
    expect(mockExecFile).not.toHaveBeenCalled();

    const callArgs = mockExec.mock.calls[0]!;
    const cmd = callArgs[0] as string;
    expect(cmd).toContain("npx --yes @anthropic-ai/claude-code");
    expect(cmd).toContain("test prompt");
  });

  it("returns crashed=true on process error", async () => {
    setupExecFileCallback(new Error("spawn ENOENT"), "");

    const result = await spawnAgent({ prompt: "test" });

    expect(result.crashed).toBe(true);
    expect(result.exitCode).toBe(1);
  });

  it("returns parsed JSON when jsonSchema provided and output is valid", async () => {
    const jsonOutput = JSON.stringify({ structured_output: { verdict: "PASS" } });
    setupExecFileCallback(null, jsonOutput);

    const result = await spawnAgent({
      prompt: "test",
      jsonSchema: { type: "object" },
    });

    expect(result.crashed).toBe(false);
    expect(result.parsed).toEqual({ structured_output: { verdict: "PASS" } });
  });

  it("returns crashed=true when jsonSchema provided but output is not valid JSON", async () => {
    setupExecFileCallback(null, "not json");

    const result = await spawnAgent({
      prompt: "test",
      jsonSchema: { type: "object" },
    });

    expect(result.crashed).toBe(true);
    expect(result.parsed).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// spawnAgentWithRetry
// ---------------------------------------------------------------------------

describe("spawnAgentWithRetry — retry on crash", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resetClaudePathCache();
    vi.stubEnv("TRIBUNAL_CLAUDE_PATH", "/usr/bin/claude-mock");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("retries on crash, returns on success", async () => {
    let callCount = 0;
    mockExecFile.mockImplementation((...args: any[]) => {
      const callback = args[args.length - 1];
      callCount++;
      if (callCount === 1) {
        // First call: crash
        callback(new Error("signal SIGKILL"), "", "");
      } else {
        // Second call: success
        callback(null, "success output", "");
      }
      return undefined as any;
    });

    const result = await spawnAgentWithRetry({ prompt: "test" });

    expect(result.crashed).toBe(false);
    expect(result.stdout).toBe("success output");
    expect(callCount).toBe(2);
  });

  it("returns crash result after exhausting retries", async () => {
    mockExecFile.mockImplementation((...args: any[]) => {
      const callback = args[args.length - 1];
      callback(new Error("connection refused"), "", "");
      return undefined as any;
    });

    const result = await spawnAgentWithRetry({ prompt: "test" }, 1);

    expect(result.crashed).toBe(true);
  });

  it("uses custom crashDetector when provided", async () => {
    let callCount = 0;
    mockExecFile.mockImplementation((...args: any[]) => {
      const callback = args[args.length - 1];
      callCount++;
      if (callCount === 1) {
        callback(null, "bad output", "");
      } else {
        callback(null, "good output", "");
      }
      return undefined as any;
    });

    const detector = (r: { stdout: string }) => r.stdout === "bad output";
    const result = await spawnAgentWithRetry({ prompt: "test" }, 1, detector);

    expect(result.stdout).toBe("good output");
    expect(callCount).toBe(2);
  });

  it("does not retry when first attempt succeeds", async () => {
    let callCount = 0;
    mockExecFile.mockImplementation((...args: any[]) => {
      const callback = args[args.length - 1];
      callCount++;
      callback(null, "immediate success", "");
      return undefined as any;
    });

    const result = await spawnAgentWithRetry({ prompt: "test" });

    expect(result.stdout).toBe("immediate success");
    expect(result.crashed).toBe(false);
    expect(callCount).toBe(1);
  });
});
