/**
 * Worktree integration tests — AC-1/2/3/4/10/11/12/16
 *
 * These tests verify the worktree lifecycle: isolation, merge, cleanup,
 * effectiveRoot routing, and backward-compatibility with no-worktree state.
 *
 * Note: shell() calls execFile("sh", ["-c", cmd], { cwd, ... }).
 * Tests verify the cwd passed to execFile for git operations.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — declared before imports
// ---------------------------------------------------------------------------

const shellCalls: Array<{ cmd: string; cwd: string }> = [];
const mockExecFile = vi.fn();
vi.mock("node:child_process", () => ({
  execFile: (...args: unknown[]) => {
    const [prog, progArgs, opts, cb] = args as [string, string[], { cwd?: string }, Function];
    if (prog === "sh" && progArgs?.[0] === "-c") {
      shellCalls.push({ cmd: progArgs[1] ?? "", cwd: opts?.cwd ?? "" });
    }
    return mockExecFile(...args);
  },
  exec: vi.fn(),
}));

const mockEvaluateTribunal = vi.fn();
vi.mock("../tribunal.js", () => ({
  evaluateTribunal: (...args: unknown[]) => mockEvaluateTribunal(...args),
}));

const mockLoadAndValidate = vi.fn();
const mockAtomicUpdate = vi.fn();
const mockInternalCheckpoint = vi.fn();
const mockAppendToProgressLog = vi.fn();
vi.mock("../state-manager.js", async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    StateManager: class MockStateManager {
      projectRoot: string;
      topic: string;
      outputDir: string;
      stateFilePath: string;
      progressLogPath: string;
      static async create(projectRoot: string, topic: string) {
        return new MockStateManager(projectRoot, topic);
      }
      constructor(projectRoot: string, topic: string) {
        this.projectRoot = projectRoot;
        this.topic = topic;
        this.outputDir = `/tmp/test-project/docs/auto-dev/${topic}`;
        this.stateFilePath = `${this.outputDir}/state.json`;
        this.progressLogPath = `${this.outputDir}/progress-log.md`;
      }
      async loadAndValidate() { return mockLoadAndValidate(); }
      async atomicUpdate(updates: Record<string, unknown>) { return mockAtomicUpdate(updates); }
      async init() {}
      getFullState() { return mockLoadAndValidate(); }
      getCheckpointLine(phase: number, _task: number | undefined, status: string, summary: string) {
        return `<!-- CHECKPOINT phase=${phase} status=${status} summary="${summary}" -->`;
      }
      async appendToProgressLog(msg: string) { mockAppendToProgressLog(msg); }
    },
    internalCheckpoint: (...args: unknown[]) => mockInternalCheckpoint(...args),
    extractTaskList: actual["extractTaskList"],
    effortKeyForStep: actual["effortKeyForStep"],
    hashContent: actual["hashContent"],
  };
});

vi.mock("../template-renderer.js", () => ({
  TemplateRenderer: class MockRenderer {
    async render(_promptFile: string, _vars: Record<string, string>, _extra?: string) {
      return { renderedPrompt: `Rendered prompt for ${_promptFile}`, warnings: [] };
    }
  },
}));

const mockStat = vi.fn();
const mockReadFile = vi.fn();
const mockWriteFile = vi.fn();
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    stat: (...args: unknown[]) => mockStat(...args),
    readFile: (...args: unknown[]) => mockReadFile(...args),
    writeFile: (...args: unknown[]) => mockWriteFile(...args),
  };
});

import { computeNextTask, validateStep } from "../orchestrator.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBaseState(overrides?: Partial<Record<string, unknown>>) {
  return {
    topic: "test-topic",
    mode: "quick" as const,
    phase: 3,
    status: "IN_PROGRESS" as const,
    stack: {
      language: "TypeScript",
      buildCmd: "npm run build",
      testCmd: "npm test",
      langChecklist: "code-review-ts",
    },
    outputDir: "/tmp/test-project/docs/auto-dev/test-topic",
    projectRoot: "/tmp/test-project",
    startedAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    startCommit: "abc123",
    step: "3",
    stepIteration: 0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AC-1: worktree isolation — effectiveRoot routing in computeNextTask", () => {
  beforeEach(() => {
    shellCalls.length = 0;
    vi.clearAllMocks();
    mockWriteFile.mockResolvedValue(undefined);
    mockAtomicUpdate.mockResolvedValue(undefined);
    mockInternalCheckpoint.mockResolvedValue({
      ok: true,
      nextDirective: { phaseCompleted: false, nextPhase: 3, nextPhaseName: "EXECUTE", mandate: "", canDeclareComplete: false },
      stateUpdates: {},
    });
  });

  it("AC-1: with worktreeRoot set, git diff runs with worktreeRoot as cwd", async () => {
    const worktreeRoot = "/tmp/.auto-dev-wt-test-topic";
    const state = makeBaseState({
      worktreeRoot,
      worktreeBranch: "auto-dev/test-topic",
      sourceBranch: "main",
    });
    mockLoadAndValidate.mockResolvedValue(state);

    // All shell calls succeed with non-empty output for diff (so build check runs)
    mockExecFile.mockImplementation((_prog: string, args: string[], _opts: Record<string, unknown>, cb: Function) => {
      const cmd = args?.[1] ?? "";
      if (cmd.includes("git diff")) {
        cb(null, "some changes\n", "");
      } else {
        // build/test succeed
        cb(null, "", "");
      }
    });

    mockStat.mockResolvedValue({});
    mockReadFile.mockImplementation((path: string) => {
      if (path.includes("state.json")) {
        return Promise.resolve(JSON.stringify({ step: "3", stepIteration: 0 }));
      }
      if (path.includes("plan.md")) return Promise.resolve("# Plan\nContent here\n");
      if (path.includes("design.md")) return Promise.resolve("# Design\nContent here\n");
      return Promise.reject(new Error("not found"));
    });

    await computeNextTask("/tmp/test-project", "test-topic");

    // Find the git diff call and verify cwd is worktreeRoot
    const diffCall = shellCalls.find(c => c.cmd.includes("git diff"));
    expect(diffCall).toBeDefined();
    expect(diffCall?.cwd).toBe(worktreeRoot);
  });
});

describe("AC-3: tribunal uses effectiveRoot (worktreeRoot)", () => {
  beforeEach(() => {
    shellCalls.length = 0;
    vi.clearAllMocks();
    mockWriteFile.mockResolvedValue(undefined);
    mockAtomicUpdate.mockResolvedValue(undefined);
  });

  it("AC-3: evaluateTribunal is called with worktreeRoot as projectRoot when worktree active", async () => {
    const worktreeRoot = "/tmp/.auto-dev-wt-test-topic";
    const sm = { loadAndValidate: mockLoadAndValidate, atomicUpdate: mockAtomicUpdate };
    const state = makeBaseState({
      worktreeRoot,
      worktreeBranch: "auto-dev/test-topic",
      sourceBranch: "main",
      phase: 4,
      step: "4a",
    });

    // build and test succeed
    mockExecFile.mockImplementation((_prog: string, _args: string[], _opts: Record<string, unknown>, cb: Function) => {
      cb(null, "", "");
    });

    mockEvaluateTribunal.mockResolvedValue({ verdict: "PASS", issues: [] });

    await validateStep(
      "4a",
      "/tmp/test-project/docs/auto-dev/test-topic",
      worktreeRoot, // effectiveRoot passed as projectRoot
      "npm run build",
      "npm test",
      sm as any,
      state as any,
      "test-topic",
      worktreeRoot,
    );

    // evaluateTribunal first arg should be worktreeRoot
    expect(mockEvaluateTribunal).toHaveBeenCalledWith(
      worktreeRoot,
      expect.any(String),
      expect.any(Number),
      expect.any(String),
      expect.any(String),
      expect.anything(),
    );
  });
});

describe("AC-4: checkBuildWithBaseline uses worktree baseline, not git stash", () => {
  beforeEach(() => {
    shellCalls.length = 0;
    vi.clearAllMocks();
    mockWriteFile.mockResolvedValue(undefined);
    mockAtomicUpdate.mockResolvedValue(undefined);
  });

  it("AC-4: when worktreeRoot set and build fails, calls 'git worktree add --detach' not 'git stash'", async () => {
    const worktreeRoot = "/tmp/.auto-dev-wt-test-topic";
    const sm = { loadAndValidate: mockLoadAndValidate, atomicUpdate: mockAtomicUpdate };
    const state = makeBaseState({ worktreeRoot, phase: 3, step: "3", startCommit: "abc123" });

    // Intercept shell calls: fail build, succeed git operations
    mockExecFile.mockImplementation((_prog: string, args: string[], _opts: Record<string, unknown>, cb: Function) => {
      const cmd = args?.[1] ?? "";
      if (cmd.includes("npm run build")) {
        cb(new Error("build failed"), "", "build error");
      } else if (cmd.includes("git worktree add") || cmd.includes("git worktree remove") || cmd.includes("git diff")) {
        cb(null, "some output", "");
      } else {
        cb(null, "", "");
      }
    });

    mockStat.mockResolvedValue({});
    mockReadFile.mockImplementation((path: string) => {
      if (path.includes("state.json")) {
        return Promise.resolve(JSON.stringify({ step: "3", stepIteration: 0 }));
      }
      if (path.includes("plan.md")) return Promise.resolve("# Plan\nContent\n");
      if (path.includes("design.md")) return Promise.resolve("# Design\nContent\n");
      return Promise.reject(new Error("not found"));
    });

    await validateStep(
      "3",
      "/tmp/test-project/docs/auto-dev/test-topic",
      worktreeRoot,
      "npm run build",
      "npm test",
      sm as any,
      state as any,
      "test-topic",
      worktreeRoot,
    );

    const worktreeAddCall = shellCalls.find(c => c.cmd.includes("git worktree add") && c.cmd.includes("--detach"));
    const stashCall = shellCalls.find(c => c.cmd.includes("git stash"));

    expect(worktreeAddCall).toBeDefined();
    expect(stashCall).toBeUndefined();
  });

  it("AC-4: without worktreeRoot, uses git stash for baseline (legacy behavior)", async () => {
    const sm = { loadAndValidate: mockLoadAndValidate, atomicUpdate: mockAtomicUpdate };
    const state = makeBaseState({ phase: 3, step: "3", startCommit: "abc123" });

    mockExecFile.mockImplementation((_prog: string, args: string[], _opts: Record<string, unknown>, cb: Function) => {
      const cmd = args?.[1] ?? "";
      if (cmd.includes("npm run build")) {
        cb(new Error("build failed"), "", "build error");
      } else if (cmd.includes("git stash") || cmd.includes("git diff")) {
        cb(null, "stashed/diffed", "");
      } else {
        cb(null, "", "");
      }
    });

    mockStat.mockResolvedValue({});
    mockReadFile.mockImplementation((path: string) => {
      if (path.includes("state.json")) {
        return Promise.resolve(JSON.stringify({ step: "3", stepIteration: 0 }));
      }
      if (path.includes("plan.md")) return Promise.resolve("# Plan\nContent\n");
      if (path.includes("design.md")) return Promise.resolve("# Design\nContent\n");
      return Promise.reject(new Error("not found"));
    });

    await validateStep(
      "3",
      "/tmp/test-project/docs/auto-dev/test-topic",
      "/tmp/test-project",
      "npm run build",
      "npm test",
      sm as any,
      state as any,
      "test-topic",
      null,
    );

    const stashCall = shellCalls.find(c => c.cmd.includes("git stash"));
    const worktreeAddCall = shellCalls.find(c => c.cmd.includes("git worktree add") && c.cmd.includes("--detach"));

    expect(stashCall).toBeDefined();
    expect(worktreeAddCall).toBeUndefined();
  });
});

describe("AC-10: useWorktree=false mode — step loop works normally", () => {
  beforeEach(() => {
    shellCalls.length = 0;
    vi.clearAllMocks();
    mockWriteFile.mockResolvedValue(undefined);
    mockAtomicUpdate.mockResolvedValue(undefined);
  });

  it("AC-10: computeNextTask with no worktreeRoot resolves initial step without error", async () => {
    const state = makeBaseState({ step: null, stepIteration: 0, phase: 3, status: "IN_PROGRESS" });
    mockLoadAndValidate.mockResolvedValue(state);

    mockExecFile.mockImplementation((_prog: string, _args: string[], _opts: Record<string, unknown>, cb: Function) => {
      cb(null, "", "");
    });

    mockStat.mockResolvedValue({});
    mockReadFile.mockImplementation((path: string) => {
      if (path.includes("state.json")) {
        return Promise.resolve(JSON.stringify({ step: null, stepIteration: 0 }));
      }
      if (path.includes("plan.md")) return Promise.resolve("# Plan\nContent here\n");
      if (path.includes("design.md")) return Promise.resolve("# Design\nContent here\n");
      return Promise.reject(new Error("not found"));
    });

    const result = await computeNextTask("/tmp/test-project", "test-topic");
    expect(result).toBeDefined();
    expect(result.done).toBe(false);
    expect(result.step).not.toBeNull();
  });
});

describe("AC-11: backward compatibility — old state.json without worktreeRoot/stepEffort", () => {
  beforeEach(() => {
    shellCalls.length = 0;
    vi.clearAllMocks();
    mockWriteFile.mockResolvedValue(undefined);
    mockAtomicUpdate.mockResolvedValue(undefined);
  });

  it("AC-11: computeNextTask with legacy state (no worktreeRoot/stepEffort) does not crash", async () => {
    const legacyState = {
      topic: "test-topic",
      mode: "quick" as const,
      phase: 3,
      status: "IN_PROGRESS" as const,
      stack: {
        language: "TypeScript",
        buildCmd: "npm run build",
        testCmd: "npm test",
        langChecklist: "code-review-ts",
      },
      outputDir: "/tmp/test-project/docs/auto-dev/test-topic",
      projectRoot: "/tmp/test-project",
      startedAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      // Intentionally omitting: worktreeRoot, worktreeBranch, sourceBranch, stepEffort, lastArtifactHashes
    };
    mockLoadAndValidate.mockResolvedValue(legacyState);

    mockExecFile.mockImplementation((_prog: string, _args: string[], _opts: Record<string, unknown>, cb: Function) => {
      cb(null, "", "");
    });

    mockStat.mockResolvedValue({});
    mockReadFile.mockImplementation((path: string) => {
      if (path.includes("state.json")) {
        return Promise.resolve(JSON.stringify({ step: null, stepIteration: 0 }));
      }
      if (path.includes("plan.md")) return Promise.resolve("# Plan\nContent here\n");
      if (path.includes("design.md")) return Promise.resolve("# Design\nContent here\n");
      return Promise.reject(new Error("not found"));
    });

    const result = await computeNextTask("/tmp/test-project", "test-topic");
    expect(result).toBeDefined();
    expect(result.done).toBe(false);
  });
});

describe("AC-16: validateStep('8a') blocked when worktreeRoot is set", () => {
  beforeEach(() => {
    shellCalls.length = 0;
    vi.clearAllMocks();
    mockWriteFile.mockResolvedValue(undefined);
    mockAtomicUpdate.mockResolvedValue(undefined);
  });

  it("AC-16: validateStep('8a') returns passed=false when worktreeRoot is non-null", async () => {
    const worktreeRoot = "/tmp/.auto-dev-wt-test-topic";
    const sm = { loadAndValidate: mockLoadAndValidate, atomicUpdate: mockAtomicUpdate };
    const state = makeBaseState({ worktreeRoot, phase: 8, step: "8a" });

    const result = await validateStep(
      "8a",
      "/tmp/test-project/docs/auto-dev/test-topic",
      worktreeRoot,
      "npm run build",
      "npm test",
      sm as any,
      state as any,
      "test-topic",
      worktreeRoot,
    );

    expect(result.passed).toBe(false);
    expect(result.feedback).toContain("auto_dev_complete");
  });

  it("AC-16: validateStep('8a') proceeds normally when worktreeRoot is null", async () => {
    const sm = { loadAndValidate: mockLoadAndValidate, atomicUpdate: mockAtomicUpdate };
    const state = makeBaseState({ worktreeRoot: null, phase: 8, step: "8a" });

    mockExecFile.mockImplementation((_prog: string, _args: string[], _opts: Record<string, unknown>, cb: Function) => {
      // git log returns empty (all pushed)
      cb(null, "", "");
    });

    const result = await validateStep(
      "8a",
      "/tmp/test-project/docs/auto-dev/test-topic",
      "/tmp/test-project",
      "npm run build",
      "npm test",
      sm as any,
      state as any,
      "test-topic",
      null,
    );

    expect(result.passed).toBe(true);
  });
});
