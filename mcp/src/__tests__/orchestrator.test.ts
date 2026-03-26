/**
 * Tests for orchestrator.ts — step function (computeNextTask).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { containsFrameworkTerms } from "../orchestrator-prompts.js";

// ---------------------------------------------------------------------------
// Mocks — must be declared before imports that use them
// ---------------------------------------------------------------------------

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
const mockAtomicUpdate = vi.fn();
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
      async atomicUpdate(updates: Record<string, unknown>) { return mockAtomicUpdate(updates); }
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

// Mock fs/promises
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

// Now import modules under test (after mocks)
import { computeNextTask } from "../orchestrator.js";
import type { NextTaskResult } from "../orchestrator.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeState(overrides?: Partial<Record<string, unknown>>) {
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
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("computeNextTask", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWriteFile.mockResolvedValue(undefined);
    mockAtomicUpdate.mockResolvedValue(undefined);
    mockInternalCheckpoint.mockResolvedValue({
      ok: true,
      nextDirective: { phaseCompleted: true, nextPhase: 2, nextPhaseName: "PLAN", mandate: "", canDeclareComplete: false },
      stateUpdates: {},
    });
  });

  // -----------------------------------------------------------------------
  // First call (no step) — full mode
  // -----------------------------------------------------------------------

  describe("first call (no step)", () => {
    it("full mode: returns architect task for step 1a", async () => {
      const state = makeState({ mode: "full" });
      mockLoadAndValidate.mockResolvedValue(state);
      // readFile for step state: no step field
      mockReadFile.mockImplementation(async (path: string) => {
        if (path.includes("state.json")) {
          return JSON.stringify(state);
        }
        throw new Error("ENOENT");
      });

      const result = await computeNextTask("/tmp/test-project", "test-topic");

      expect(result.done).toBe(false);
      expect(result.step).toBe("1a");
      expect(result.agent).toBe("auto-dev-architect");
      expect(result.prompt).toBeDefined();
      expect(result.prompt).not.toBeNull();
    });

    it("turbo mode without plan.md: returns implementation task with topic", async () => {
      const state = makeState({ mode: "turbo" });
      mockLoadAndValidate.mockResolvedValue(state);
      // readFile: state.json has no step; plan.md does not exist
      mockReadFile.mockImplementation(async (path: string) => {
        if (path.includes("state.json")) {
          return JSON.stringify(state);
        }
        throw new Error("ENOENT");
      });

      const result = await computeNextTask("/tmp/test-project", "test-topic");

      expect(result.done).toBe(false);
      expect(result.step).toBe("3");
      expect(result.agent).toBe("auto-dev-developer");
      expect(result.prompt).toContain("请实现以下功能");
      expect(result.prompt).toContain("test-topic");
    });
  });

  // -----------------------------------------------------------------------
  // After design.md written (step=1a) — validation passes, advance to 1b
  // -----------------------------------------------------------------------

  describe("step 1a validation passes", () => {
    it("returns reviewer task for step 1b", async () => {
      const state = makeState({ mode: "full" });
      mockLoadAndValidate.mockResolvedValue(state);
      // State has step=1a
      mockReadFile.mockImplementation(async (path: string) => {
        if (path.includes("state.json")) {
          return JSON.stringify({ ...state, step: "1a", stepIteration: 0 });
        }
        if (path.includes("design.md")) {
          return "x".repeat(200); // valid design.md
        }
        throw new Error("ENOENT");
      });

      const result = await computeNextTask("/tmp/test-project", "test-topic");

      expect(result.done).toBe(false);
      expect(result.step).toBe("1b");
      expect(result.agent).toBe("auto-dev-reviewer");
      expect(result.prompt).toBeDefined();
      expect(result.message).toContain("1a");
      expect(result.message).toContain("passed");
    });
  });

  // -----------------------------------------------------------------------
  // stepIteration >= MAX_STEP_ITERATIONS — escalation
  // -----------------------------------------------------------------------

  describe("escalation on iteration limit", () => {
    it("returns escalation when stepIteration >= MAX", async () => {
      const state = makeState({ mode: "full" });
      mockLoadAndValidate.mockResolvedValue(state);
      // State has step=1a, stepIteration=3 (>= MAX_STEP_ITERATIONS)
      mockReadFile.mockImplementation(async (path: string) => {
        if (path.includes("state.json")) {
          return JSON.stringify({ ...state, step: "1a", stepIteration: 3 });
        }
        // design.md missing => validation fails
        throw new Error("ENOENT");
      });

      const result = await computeNextTask("/tmp/test-project", "test-topic");

      expect(result.done).toBe(false);
      expect(result.escalation).toBeDefined();
      expect(result.escalation?.reason).toBe("iteration_limit_exceeded");
      expect(result.prompt).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // All phases complete — done=true
  // -----------------------------------------------------------------------

  describe("all phases complete", () => {
    it("returns done=true when last step passes", async () => {
      const state = makeState({ mode: "turbo" });
      mockLoadAndValidate.mockResolvedValue(state);
      // State has step=3 (turbo only has phase 3)
      mockReadFile.mockImplementation(async (path: string) => {
        if (path.includes("state.json")) {
          return JSON.stringify({ ...state, step: "3", stepIteration: 0 });
        }
        throw new Error("ENOENT");
      });
      // shell() build + test pass
      mockExecFile.mockImplementation(
        (_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
          cb(null, "ok", "");
        },
      );

      const result = await computeNextTask("/tmp/test-project", "test-topic");

      expect(result.done).toBe(true);
      expect(result.step).toBeNull();
      expect(result.prompt).toBeNull();
      expect(result.message).toContain("completed");
    });
  });

  // -----------------------------------------------------------------------
  // Prompt isolation: no framework terms
  // -----------------------------------------------------------------------

  describe("prompt isolation", () => {
    it("prompts never contain framework terms", async () => {
      const state = makeState({ mode: "full" });
      mockLoadAndValidate.mockResolvedValue(state);
      mockReadFile.mockImplementation(async (path: string) => {
        if (path.includes("state.json")) {
          return JSON.stringify(state); // no step
        }
        throw new Error("ENOENT");
      });

      const result = await computeNextTask("/tmp/test-project", "test-topic");

      expect(result.prompt).toBeDefined();
      expect(result.prompt).not.toBeNull();
      expect(containsFrameworkTerms(result.prompt!)).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Quick mode starts at phase 3
  // -----------------------------------------------------------------------

  describe("quick mode", () => {
    it("first call starts at step 3", async () => {
      const state = makeState({ mode: "quick" });
      mockLoadAndValidate.mockResolvedValue(state);
      mockReadFile.mockImplementation(async (path: string) => {
        if (path.includes("state.json")) {
          return JSON.stringify(state);
        }
        if (path.includes("plan.md")) {
          return "### Task 1: Implement feature\n";
        }
        throw new Error("ENOENT");
      });

      const result = await computeNextTask("/tmp/test-project", "test-topic");

      expect(result.step).toBe("3");
      expect(result.agent).toBe("auto-dev-developer");
    });
  });
});
