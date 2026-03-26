/**
 * Tests for orchestrator.ts — core loop and phase execution.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { containsFrameworkTerms } from "../orchestrator-prompts.js";

// ---------------------------------------------------------------------------
// Mocks — must be declared before imports that use them
// ---------------------------------------------------------------------------

// Mock agent-spawner
const mockSpawnAgent = vi.fn();
vi.mock("../agent-spawner.js", () => ({
  spawnAgent: (...args: unknown[]) => mockSpawnAgent(...args),
}));

// Mock child_process for shell()
const mockExecFile = vi.fn();
vi.mock("node:child_process", () => ({
  execFile: (...args: unknown[]) => mockExecFile(...args),
  exec: vi.fn(),
}));

// Mock tribunal
const mockExecuteTribunal = vi.fn();
vi.mock("../tribunal.js", () => ({
  executeTribunal: (...args: unknown[]) => mockExecuteTribunal(...args),
}));

// Mock state-manager
const mockLoadAndValidate = vi.fn();
const mockInternalCheckpoint = vi.fn();
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
      constructor(projectRoot: string, topic: string) {
        this.projectRoot = projectRoot;
        this.topic = topic;
        this.outputDir = `/tmp/test-project/docs/auto-dev/${topic}`;
        this.stateFilePath = `${this.outputDir}/state.json`;
        this.progressLogPath = `${this.outputDir}/progress-log.md`;
      }
      async loadAndValidate() { return mockLoadAndValidate(); }
      async init() {}
      getFullState() { return mockLoadAndValidate(); }
    },
    internalCheckpoint: (...args: unknown[]) => mockInternalCheckpoint(...args),
    extractTaskList: actual["extractTaskList"],
  };
});

// Mock template-renderer
vi.mock("../template-renderer.js", () => ({
  TemplateRenderer: class MockRenderer {
    async render(_promptFile: string, _vars: Record<string, string>, _extra?: string) {
      return { renderedPrompt: `Rendered prompt for ${_promptFile}`, warnings: [] };
    }
  },
}));

// Mock fs/promises for fileExists / readFileSafe inside OrchestratorPhaseRunner
const mockStat = vi.fn();
const mockReadFile = vi.fn();
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    stat: (...args: unknown[]) => mockStat(...args),
    readFile: (...args: unknown[]) => mockReadFile(...args),
  };
});

// Now import the modules under test (after mocks)
import {
  OrchestratorPhaseRunner,
  runOrchestrator,
} from "../orchestrator.js";
import type { PhaseContext, OrchestratorConfig } from "../orchestrator.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCtx(overrides?: Partial<PhaseContext>): PhaseContext {
  return {
    projectRoot: "/tmp/test-project",
    outputDir: "/tmp/test-project/docs/auto-dev/test-topic",
    topic: "test-topic",
    mode: "full",
    buildCmd: "npm run build",
    testCmd: "npm test",
    startCommit: "abc123",
    costMode: "economy",
    ...overrides,
  };
}

function makeState() {
  return {
    topic: "test-topic",
    mode: "full" as const,
    phase: 1,
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
  };
}

function spawnSuccess(): { stdout: string; stderr: string; exitCode: number; crashed: boolean } {
  return { stdout: "ok", stderr: "", exitCode: 0, crashed: false };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("OrchestratorPhaseRunner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSpawnAgent.mockResolvedValue(spawnSuccess());
    mockInternalCheckpoint.mockResolvedValue({
      ok: true,
      nextDirective: { phaseCompleted: true, nextPhase: 2, nextPhaseName: "PLAN", mandate: "", canDeclareComplete: false },
      stateUpdates: {},
    });
  });

  // -----------------------------------------------------------------------
  // executeDesign
  // -----------------------------------------------------------------------

  describe("executeDesign", () => {
    it("spawns agent and returns ARTIFACT_READY when design.md is valid", async () => {
      const ctx = makeCtx();
      const runner = new OrchestratorPhaseRunner(ctx);

      mockSpawnAgent.mockResolvedValue(spawnSuccess());
      mockStat.mockResolvedValue({ isFile: () => true }); // fileExists
      mockReadFile.mockResolvedValue("x".repeat(200)); // >= 100 chars

      const result = await runner.executeDesign();

      expect(mockSpawnAgent).toHaveBeenCalledTimes(1);
      expect(result.status).toBe("ARTIFACT_READY");
      expect(result.artifacts).toContain(
        "/tmp/test-project/docs/auto-dev/test-topic/design.md",
      );
    });

    it("returns NEEDS_REVISION when design.md is missing", async () => {
      const ctx = makeCtx();
      const runner = new OrchestratorPhaseRunner(ctx);

      mockSpawnAgent.mockResolvedValue(spawnSuccess());
      mockReadFile.mockRejectedValue(new Error("ENOENT")); // file not found

      const result = await runner.executeDesign();

      expect(result.status).toBe("NEEDS_REVISION");
      expect(result.feedback).toContain("design.md");
    });

    it("returns NEEDS_REVISION when design.md is too short", async () => {
      const ctx = makeCtx();
      const runner = new OrchestratorPhaseRunner(ctx);

      mockSpawnAgent.mockResolvedValue(spawnSuccess());
      mockReadFile.mockResolvedValue("short"); // < 100 chars

      const result = await runner.executeDesign();

      expect(result.status).toBe("NEEDS_REVISION");
    });
  });

  // -----------------------------------------------------------------------
  // executeImplementation
  // -----------------------------------------------------------------------

  describe("executeImplementation", () => {
    it("parses tasks from plan.md and spawns agent per task", async () => {
      const ctx = makeCtx();
      const runner = new OrchestratorPhaseRunner(ctx);

      // plan.md with structured tasks
      mockReadFile.mockImplementation(async (path: string) => {
        if (path.includes("plan.md")) {
          return "### Task 1: Create module\n### Task 2: Write tests\n";
        }
        throw new Error("ENOENT");
      });

      // Mock shell (build + test pass for each task)
      mockExecFile.mockImplementation(
        (_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
          cb(null, "ok", "");
        },
      );

      const result = await runner.executeImplementation();

      // 2 tasks -> 2 spawn calls (one per task)
      expect(mockSpawnAgent).toHaveBeenCalledTimes(2);
      expect(result.status).toBe("PASS");
    });

    it("spawns fix agent when build fails after task", async () => {
      const ctx = makeCtx();
      const runner = new OrchestratorPhaseRunner(ctx);

      mockReadFile.mockImplementation(async (path: string) => {
        if (path.includes("plan.md")) {
          return "### Task 1: Implement feature\n";
        }
        throw new Error("ENOENT");
      });

      let shellCallCount = 0;
      mockExecFile.mockImplementation(
        (_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
          shellCallCount++;
          if (shellCallCount === 1) {
            // First build fails
            const err = new Error("build fail") as any;
            err.code = 1;
            cb(err, "", "compilation error");
          } else {
            // Retry succeeds
            cb(null, "ok", "");
          }
        },
      );

      const result = await runner.executeImplementation();

      // 1 task spawn + 1 fix spawn = 2
      expect(mockSpawnAgent).toHaveBeenCalledTimes(2);
      expect(result.status).toBe("PASS");
    });
  });

  // -----------------------------------------------------------------------
  // Prompt isolation: no framework terms
  // -----------------------------------------------------------------------

  describe("prompt isolation", () => {
    it("prompts sent to spawnAgent contain NO framework terms", async () => {
      const ctx = makeCtx();
      const runner = new OrchestratorPhaseRunner(ctx);

      mockReadFile.mockResolvedValue("x".repeat(200));
      mockStat.mockResolvedValue({ isFile: () => true });

      await runner.executeDesign();

      const promptArg = mockSpawnAgent.mock.calls[0]?.[0]?.prompt as string;
      expect(promptArg).toBeDefined();
      expect(containsFrameworkTerms(promptArg)).toBe(false);
    });

    it("task prompts in executeImplementation contain NO framework terms", async () => {
      const ctx = makeCtx();
      const runner = new OrchestratorPhaseRunner(ctx);

      mockReadFile.mockImplementation(async (path: string) => {
        if (path.includes("plan.md")) {
          return "### Task 1: Implement login\n";
        }
        throw new Error("ENOENT");
      });

      mockExecFile.mockImplementation(
        (_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
          cb(null, "ok", "");
        },
      );

      await runner.executeImplementation();

      for (const call of mockSpawnAgent.mock.calls) {
        const prompt = call[0]?.prompt as string;
        expect(containsFrameworkTerms(prompt)).toBe(false);
      }
    });
  });
});

// ---------------------------------------------------------------------------
// runOrchestrator
// ---------------------------------------------------------------------------

describe("runOrchestrator", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    const state = makeState();
    mockLoadAndValidate.mockResolvedValue(state);
    mockSpawnAgent.mockResolvedValue(spawnSuccess());
    mockInternalCheckpoint.mockResolvedValue({
      ok: true,
      nextDirective: { phaseCompleted: true, nextPhase: null, nextPhaseName: null, mandate: "", canDeclareComplete: true },
      stateUpdates: {},
    });
  });

  it("iterates phases in correct order for full mode", async () => {
    // Make all phases pass immediately
    mockReadFile.mockResolvedValue("x".repeat(200) + "\nAPPROVE\n");
    mockStat.mockResolvedValue({ isFile: () => true });
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
        cb(null, "ok", "");
      },
    );
    mockExecuteTribunal.mockResolvedValue({
      content: [{ type: "text", text: JSON.stringify({ status: "TRIBUNAL_PASS" }) }],
    });

    const config: OrchestratorConfig = {
      projectRoot: "/tmp/test-project",
      topic: "test-topic",
      mode: "full",
    };

    const result = await runOrchestrator(config);

    // internalCheckpoint should be called for each phase (IN_PROGRESS + PASS)
    // 7 phases * 2 calls (IN_PROGRESS + PASS) = 14
    expect(mockInternalCheckpoint).toHaveBeenCalled();

    // Verify the checkpoint phases are in order
    const inProgressCalls = mockInternalCheckpoint.mock.calls
      .filter((c) => c[3] === "IN_PROGRESS")
      .map((c) => c[2]);
    expect(inProgressCalls).toEqual([1, 2, 3, 4, 5, 6, 7]);

    expect(result.completed).toBe(true);
    expect(result.status).toBe("COMPLETED");
  });

  it("returns BLOCKED when iteration limit exceeded", async () => {
    // Design always returns NEEDS_REVISION
    mockReadFile.mockRejectedValue(new Error("ENOENT")); // design.md missing
    mockStat.mockRejectedValue(new Error("ENOENT"));

    const config: OrchestratorConfig = {
      projectRoot: "/tmp/test-project",
      topic: "test-topic",
      mode: "full",
    };

    const result = await runOrchestrator(config);

    expect(result.completed).toBe(false);
    expect(result.status).toBe("BLOCKED");
    expect(result.escalation).toBeDefined();
    expect(result.escalation?.reason).toBe("iteration_limit_exceeded");
  });

  it("skips phase 5 when skipE2e is set", async () => {
    mockReadFile.mockResolvedValue("x".repeat(200) + "\nAPPROVE\n");
    mockStat.mockResolvedValue({ isFile: () => true });
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
        cb(null, "ok", "");
      },
    );
    mockExecuteTribunal.mockResolvedValue({
      content: [{ type: "text", text: JSON.stringify({ status: "TRIBUNAL_PASS" }) }],
    });

    const config: OrchestratorConfig = {
      projectRoot: "/tmp/test-project",
      topic: "test-topic",
      mode: "full",
      skipE2e: true,
    };

    const result = await runOrchestrator(config);

    // Phase 5 should not be in the IN_PROGRESS calls
    const inProgressPhases = mockInternalCheckpoint.mock.calls
      .filter((c) => c[3] === "IN_PROGRESS")
      .map((c) => c[2]);
    expect(inProgressPhases).not.toContain(5);
    expect(result.completed).toBe(true);
  });

  it("uses correct phases for quick mode", async () => {
    mockReadFile.mockResolvedValue("x".repeat(200) + "\n### Task 1: do stuff\n");
    mockStat.mockResolvedValue({ isFile: () => true });
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
        cb(null, "ok", "");
      },
    );
    mockExecuteTribunal.mockResolvedValue({
      content: [{ type: "text", text: JSON.stringify({ status: "TRIBUNAL_PASS" }) }],
    });

    const config: OrchestratorConfig = {
      projectRoot: "/tmp/test-project",
      topic: "test-topic",
      mode: "quick",
    };

    const result = await runOrchestrator(config);

    const inProgressPhases = mockInternalCheckpoint.mock.calls
      .filter((c) => c[3] === "IN_PROGRESS")
      .map((c) => c[2]);
    expect(inProgressPhases).toEqual([3, 4, 5, 7]);
    expect(result.completed).toBe(true);
  });

  it("uses correct phases for turbo mode", async () => {
    mockReadFile.mockResolvedValue("x".repeat(200) + "\n### Task 1: do stuff\n");
    mockStat.mockResolvedValue({ isFile: () => true });
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
        cb(null, "ok", "");
      },
    );

    const config: OrchestratorConfig = {
      projectRoot: "/tmp/test-project",
      topic: "test-topic",
      mode: "turbo",
    };

    const result = await runOrchestrator(config);

    const inProgressPhases = mockInternalCheckpoint.mock.calls
      .filter((c) => c[3] === "IN_PROGRESS")
      .map((c) => c[2]);
    expect(inProgressPhases).toEqual([3]);
    expect(result.completed).toBe(true);
  });
});
