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
const mockEvaluateTribunal = vi.fn();
vi.mock("../tribunal.js", () => ({
  evaluateTribunal: (...args: unknown[]) => mockEvaluateTribunal(...args),
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
      getCheckpointLine(phase: number, _task: number | undefined, status: string, summary: string) {
        return `<!-- CHECKPOINT phase=${phase} status=${status} summary="${summary}" -->`;
      }
      async appendToProgressLog() {}
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
import { computeNextTask, computeNextStep, handleApproachFailure, buildTaskForStep } from "../orchestrator.js";
import type { NextTaskResult, ApproachState } from "../orchestrator.js";

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

  // -----------------------------------------------------------------------
  // Circuit breaker integration (Task 9)
  // -----------------------------------------------------------------------

  describe("circuit breaker", () => {
    // Helper: standard approach-plan.md content
    const approachPlanContent = [
      "## 主方案",
      "- **方法**: 使用 vitest mock 进行测试",
      "- **核心工具**: vitest",
      "",
      "## 备选方案 A",
      "- **方法**: 使用 jest 进行测试",
      "- **核心工具**: jest",
      "",
      "## 备选方案 B",
      "- **方法**: 使用 mocha 进行测试",
      "- **核心工具**: mocha",
    ].join("\n");

    it("returns CONTINUE when no approach-plan.md exists (AC-5)", async () => {
      const stepState = {
        step: "3",
        stepIteration: 0,
        lastValidation: null,
        approachState: null,
      };

      // readFile throws for approach-plan.md (file not found)
      mockReadFile.mockRejectedValue(new Error("ENOENT"));

      const result = await handleApproachFailure(
        stepState, "3", "/tmp/test-project/docs/auto-dev/test-topic", "build failed",
      );

      expect(result.action).toBe("CONTINUE");
    });

    it("first failure: CONTINUE and returns approachState for persistence", async () => {
      const stepState = {
        step: "3",
        stepIteration: 0,
        lastValidation: null,
        approachState: null,
      };

      mockReadFile.mockImplementation(async (path: string) => {
        if (path.includes("approach-plan.md")) {
          return approachPlanContent;
        }
        throw new Error("ENOENT");
      });

      const result = await handleApproachFailure(
        stepState, "3", "/tmp/test-project/docs/auto-dev/test-topic", "test failed",
      );

      expect(result.action).toBe("CONTINUE");
      expect(result.approachState).toBeDefined();
      expect(result.approachState!.currentIndex).toBe(0);
      expect(result.approachState!.approaches[0].failCount).toBe(1);
    });

    it("2 consecutive failures on same approach triggers CIRCUIT_BREAK with stepIteration reset (AC-2, AC-3)", async () => {
      // Simulate state where primary approach already failed once
      const approachState: ApproachState = {
        stepId: "3",
        approaches: [
          { id: "primary", summary: "使用 vitest mock 进行测试", failCount: 1 },
          { id: "alt-a", summary: "使用 jest 进行测试", failCount: 0 },
          { id: "alt-b", summary: "使用 mocha 进行测试", failCount: 0 },
        ],
        currentIndex: 0,
        failedApproaches: [],
      };

      const stepState = {
        step: "3",
        stepIteration: 1,
        lastValidation: "FAILED",
        approachState,
      };

      // plan.md for getStepGoal
      mockReadFile.mockImplementation(async (path: string) => {
        if (path.includes("plan.md")) {
          return "## Task 3: Implement feature\nBuild the user module";
        }
        throw new Error("ENOENT");
      });

      const result = await handleApproachFailure(
        stepState, "3", "/tmp/test-project/docs/auto-dev/test-topic", "still failing",
      );

      expect(result.action).toBe("CIRCUIT_BREAK");
      if (result.action === "CIRCUIT_BREAK") {
        expect(result.approachState.currentIndex).toBe(1);
        expect(result.approachState.failedApproaches).toHaveLength(1);
        expect(result.approachState.failedApproaches[0].id).toBe("primary");
        expect(result.prompt).toContain("使用 jest 进行测试");
        expect(result.prompt).toContain("禁止");
        expect(result.failedApproach).toBe("使用 vitest mock 进行测试");
        expect(result.nextApproach).toBe("使用 jest 进行测试");
      }
    });

    it("computeNextTask resets stepIteration to 0 on CIRCUIT_BREAK", async () => {
      const approachState: ApproachState = {
        stepId: "3",
        approaches: [
          { id: "primary", summary: "使用 vitest mock", failCount: 1 },
          { id: "alt-a", summary: "使用 jest", failCount: 0 },
        ],
        currentIndex: 0,
        failedApproaches: [],
      };

      const state = makeState({ mode: "turbo" });
      mockLoadAndValidate.mockResolvedValue(state);

      mockReadFile.mockImplementation(async (path: string) => {
        if (path.includes("state.json")) {
          return JSON.stringify({
            ...state,
            step: "3",
            stepIteration: 1,
            approachState,
          });
        }
        if (path.includes("plan.md")) {
          return "## Task 3: Implement\nDo the thing";
        }
        throw new Error("ENOENT");
      });

      // shell() build fails
      mockExecFile.mockImplementation(
        (_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
          cb(new Error("build failed"), "", "error output");
        },
      );

      const result = await computeNextTask("/tmp/test-project", "test-topic");

      expect(result.step).toBe("3");
      expect(result.prompt).toContain("禁止");
      // Verify atomicUpdate was called with stepIteration: 0
      const circuitBreakCall = mockAtomicUpdate.mock.calls.find(
        (call: unknown[]) => (call[0] as Record<string, unknown>).lastValidation === "CIRCUIT_BREAK",
      );
      expect(circuitBreakCall).toBeDefined();
      expect((circuitBreakCall![0] as Record<string, unknown>).stepIteration).toBe(0);
    });

    it("all approaches exhausted returns escalation with status BLOCKED (AC-4)", async () => {
      const approachState: ApproachState = {
        stepId: "3",
        approaches: [
          { id: "primary", summary: "方案A", failCount: 1 },
          { id: "alt-a", summary: "方案B", failCount: 1 },
        ],
        currentIndex: 1,
        failedApproaches: [
          { id: "primary", summary: "方案A", failReason: "编译失败" },
        ],
      };

      const state = makeState({ mode: "turbo" });
      mockLoadAndValidate.mockResolvedValue(state);

      mockReadFile.mockImplementation(async (path: string) => {
        if (path.includes("state.json")) {
          return JSON.stringify({
            ...state,
            step: "3",
            stepIteration: 1,
            approachState,
          });
        }
        throw new Error("ENOENT");
      });

      // shell() build fails
      mockExecFile.mockImplementation(
        (_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
          cb(new Error("build failed"), "", "error output");
        },
      );

      const result = await computeNextTask("/tmp/test-project", "test-topic");

      expect(result.done).toBe(false);
      expect(result.escalation).toBeDefined();
      expect(result.escalation?.reason).toBe("all_approaches_exhausted");
      expect(result.prompt).toBeNull();
      // Verify atomicUpdate was called with BLOCKED status
      const blockedCall = mockAtomicUpdate.mock.calls.find(
        (call: unknown[]) => (call[0] as Record<string, unknown>).status === "BLOCKED",
      );
      expect(blockedCall).toBeDefined();
    });

    it("step '3' prompt includes approach plan instruction, step '1a' does not (AC-8)", async () => {
      const state = makeState({ mode: "full" });
      mockLoadAndValidate.mockResolvedValue(state);

      // Test step 3 prompt
      mockReadFile.mockImplementation(async (path: string) => {
        if (path.includes("state.json")) {
          return JSON.stringify(state); // no step -> will create first step
        }
        if (path.includes("plan.md")) {
          return "### Task 1: Implement feature\n";
        }
        throw new Error("ENOENT");
      });

      // First call: full mode starts at 1a, check 1a prompt does NOT contain approach plan
      const result1a = await computeNextTask("/tmp/test-project", "test-topic");
      expect(result1a.step).toBe("1a");
      expect(result1a.prompt).not.toContain("方案计划");

      // Now test step 3 prompt by simulating turbo mode starting at step 3
      vi.clearAllMocks();
      mockWriteFile.mockResolvedValue(undefined);
      mockAtomicUpdate.mockResolvedValue(undefined);
      mockInternalCheckpoint.mockResolvedValue({
        ok: true,
        nextDirective: { phaseCompleted: true, nextPhase: 4, nextPhaseName: "VERIFY", mandate: "", canDeclareComplete: false },
        stateUpdates: {},
      });
      const turboState = makeState({ mode: "turbo" });
      mockLoadAndValidate.mockResolvedValue(turboState);
      mockReadFile.mockImplementation(async (path: string) => {
        if (path.includes("state.json")) {
          return JSON.stringify(turboState); // no step
        }
        if (path.includes("plan.md")) {
          return "### Task 3: Implement feature\nDo the work";
        }
        throw new Error("ENOENT");
      });

      const result3 = await computeNextTask("/tmp/test-project", "test-topic");
      expect(result3.step).toBe("3");
      expect(result3.prompt).toContain("方案计划");
    });
  });

  // -----------------------------------------------------------------------
  // E2E Circuit Breaker — Entry-level integration tests
  // -----------------------------------------------------------------------

  describe("circuit breaker E2E (entry-level)", () => {
    // Shared approach-plan.md with 3 approaches
    const approachPlan3 = [
      "## 主方案",
      "- **方法**: 使用 vitest mock 进行测试",
      "- **核心工具**: vitest",
      "",
      "## 备选方案 A",
      "- **方法**: 使用 jest 进行测试",
      "- **核心工具**: jest",
      "",
      "## 备选方案 B",
      "- **方法**: 使用 mocha 进行测试",
      "- **核心工具**: mocha",
    ].join("\n");

    // Shared approach-plan.md with 2 approaches
    const approachPlan2 = [
      "## 主方案",
      "- **方法**: vitest mock",
      "- **核心工具**: vitest",
      "",
      "## 备选方案 A",
      "- **方法**: jest 测试",
      "- **核心工具**: jest",
    ].join("\n");

    // Helper: set up a failing build
    function setupFailingBuild() {
      mockExecFile.mockImplementation(
        (_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
          cb(new Error("build failed"), "", "compilation error output");
        },
      );
    }

    // Helper: set up passing build + test
    function setupPassingBuildAndTest() {
      mockExecFile.mockImplementation(
        (_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
          cb(null, "ok", "");
        },
      );
    }

    // Helper: get the last atomicUpdate call
    function getLastWrittenState(): Record<string, unknown> | null {
      const calls = mockAtomicUpdate.mock.calls;
      if (calls.length === 0) return null;
      return calls[calls.length - 1][0] as Record<string, unknown>;
    }

    // Helper: find atomicUpdate call containing approachState
    function getWrittenStateWithApproachState(): Record<string, unknown> | null {
      for (const call of mockAtomicUpdate.mock.calls) {
        const data = call[0] as Record<string, unknown>;
        if (data.approachState) return data;
      }
      return null;
    }

    // TC-03: First failure + approach-plan.md exists -> CONTINUE with approachState
    it("TC-03: first failure with approach-plan.md creates approachState (AC-1)", async () => {
      const state = makeState({ mode: "turbo" });
      mockLoadAndValidate.mockResolvedValue(state);

      mockReadFile.mockImplementation(async (path: string) => {
        if (path.includes("state.json")) {
          return JSON.stringify({ ...state, step: "3", stepIteration: 0, approachState: null });
        }
        if (path.includes("approach-plan.md")) {
          return approachPlan2;
        }
        throw new Error("ENOENT");
      });

      setupFailingBuild();

      const result = await computeNextTask("/tmp/test-project", "test-topic");

      expect(result.done).toBe(false);
      expect(result.step).toBe("3");
      expect(result.prompt).not.toBeNull();
      expect(result.escalation).toBeUndefined();
      // approachState should be persisted in one of the writes
      const written = getWrittenStateWithApproachState();
      expect(written).not.toBeNull();
      const as = written!.approachState as ApproachState;
      expect(as.currentIndex).toBe(0);
      expect(as.approaches[0].failCount).toBe(1);
      // Prompt should not contain framework terms
      expect(containsFrameworkTerms(result.prompt!)).toBe(false);
    });

    // TC-04 + TC-05: CIRCUIT_BREAK with freshContext, stepIteration reset, message contains "熔断"
    it("TC-04/05: second failure triggers CIRCUIT_BREAK with clean prompt and stepIteration reset (AC-2, AC-3)", async () => {
      const approachState: ApproachState = {
        stepId: "3",
        approaches: [
          { id: "primary", summary: "vitest mock", failCount: 1 },
          { id: "alt-a", summary: "jest 测试", failCount: 0 },
        ],
        currentIndex: 0,
        failedApproaches: [],
      };

      const state = makeState({ mode: "turbo" });
      mockLoadAndValidate.mockResolvedValue(state);

      mockReadFile.mockImplementation(async (path: string) => {
        if (path.includes("state.json")) {
          return JSON.stringify({
            ...state,
            step: "3",
            stepIteration: 1,
            approachState,
          });
        }
        if (path.includes("plan.md")) {
          return "## Task 3: 实现用户模块\n构建用户认证功能";
        }
        throw new Error("ENOENT");
      });

      setupFailingBuild();

      const result = await computeNextTask("/tmp/test-project", "test-topic");

      expect(result.step).toBe("3");
      expect(result.prompt).toContain("禁止");
      expect(result.prompt).toContain("jest 测试");
      expect(result.prompt).toContain("vitest mock");
      expect(result.freshContext).toBe(true);
      expect(result.message).toContain("熔断");
      expect(result.escalation).toBeUndefined();
      // stepIteration reset to 0
      const written = getLastWrittenState();
      expect(written!.stepIteration).toBe(0);
      expect(written!.lastValidation).toBe("CIRCUIT_BREAK");
      const as = written!.approachState as ApproachState;
      expect(as.currentIndex).toBe(1);
      expect(as.failedApproaches).toHaveLength(1);
      // AC-7: no framework terms in circuit break prompt
      expect(containsFrameworkTerms(result.prompt!)).toBe(false);
    });

    // TC-06: All approaches exhausted -> escalation + BLOCKED
    it("TC-06: all approaches exhausted returns escalation with BLOCKED (AC-4)", async () => {
      const approachState: ApproachState = {
        stepId: "3",
        approaches: [
          { id: "primary", summary: "方案A", failCount: 2 },
          { id: "alt-a", summary: "方案B", failCount: 1 },
        ],
        currentIndex: 1,
        failedApproaches: [
          { id: "primary", summary: "方案A", failReason: "编译失败" },
        ],
      };

      const state = makeState({ mode: "turbo" });
      mockLoadAndValidate.mockResolvedValue(state);

      mockReadFile.mockImplementation(async (path: string) => {
        if (path.includes("state.json")) {
          return JSON.stringify({
            ...state,
            step: "3",
            stepIteration: 1,
            approachState,
          });
        }
        throw new Error("ENOENT");
      });

      setupFailingBuild();

      const result = await computeNextTask("/tmp/test-project", "test-topic");

      expect(result.done).toBe(false);
      expect(result.prompt).toBeNull();
      expect(result.escalation).toBeDefined();
      expect(result.escalation?.reason).toBe("all_approaches_exhausted");
      expect(result.escalation?.lastFeedback).toBeTruthy();
      expect(mockAtomicUpdate.mock.calls.some(
        (call: unknown[]) => (call[0] as Record<string, unknown>).status === "BLOCKED",
      )).toBe(true);
      // lastValidation written
      const written = getLastWrittenState();
      expect(written!.lastValidation).toBe("ALL_APPROACHES_EXHAUSTED");
    });

    // TC-07b: No approach-plan.md, stepIteration=1 -> normal revision
    it("TC-07b: no approach-plan.md with stepIteration=1 returns revision prompt (AC-5)", async () => {
      const state = makeState({ mode: "turbo" });
      mockLoadAndValidate.mockResolvedValue(state);

      mockReadFile.mockImplementation(async (path: string) => {
        if (path.includes("state.json")) {
          return JSON.stringify({ ...state, step: "3", stepIteration: 1, approachState: null });
        }
        // approach-plan.md does not exist
        throw new Error("ENOENT");
      });

      setupFailingBuild();

      const result = await computeNextTask("/tmp/test-project", "test-topic");

      expect(result.prompt).not.toBeNull();
      expect(result.escalation).toBeUndefined();
      // stepIteration should increment to 2
      const written = getLastWrittenState();
      expect(written!.stepIteration).toBe(2);
    });

    // TC-08: No approach-plan.md, stepIteration >= MAX -> escalation
    it("TC-08: no approach-plan.md with stepIteration >= MAX returns escalation (AC-5)", async () => {
      const state = makeState({ mode: "turbo" });
      mockLoadAndValidate.mockResolvedValue(state);

      mockReadFile.mockImplementation(async (path: string) => {
        if (path.includes("state.json")) {
          return JSON.stringify({ ...state, step: "3", stepIteration: 3, approachState: null });
        }
        throw new Error("ENOENT");
      });

      setupFailingBuild();

      const result = await computeNextTask("/tmp/test-project", "test-topic");

      expect(result.escalation).toBeDefined();
      expect(result.escalation?.reason).toBe("iteration_limit_exceeded");
      expect(result.prompt).toBeNull();
      expect(mockAtomicUpdate.mock.calls.some(
        (call: unknown[]) => (call[0] as Record<string, unknown>).status === "BLOCKED",
      )).toBe(true);
    });

    // TC-09: Only primary approach (no alternatives) -> planFeedback with "备选方案"
    it("TC-09: only primary approach returns planFeedback with backup plan hint (AC-6)", async () => {
      const state = makeState({ mode: "turbo" });
      mockLoadAndValidate.mockResolvedValue(state);

      mockReadFile.mockImplementation(async (path: string) => {
        if (path.includes("state.json")) {
          return JSON.stringify({ ...state, step: "3", stepIteration: 0, approachState: null });
        }
        if (path.includes("approach-plan.md")) {
          return "## 主方案\n- **方法**: 只有一个方案";
        }
        throw new Error("ENOENT");
      });

      setupFailingBuild();

      const result = await computeNextTask("/tmp/test-project", "test-topic");

      expect(result.prompt).not.toBeNull();
      expect(result.prompt).toContain("备选方案");
      expect(result.escalation).toBeUndefined();
      // stepIteration should increment to 1
      const written = getLastWrittenState();
      expect(written!.stepIteration).toBe(1);
    });

    // TC-16: step "1a" prompt does not contain approach plan instruction (AC-8 negative)
    it("TC-16: full mode step 1a prompt does not contain approach plan (AC-8)", async () => {
      const state = makeState({ mode: "full" });
      mockLoadAndValidate.mockResolvedValue(state);

      mockReadFile.mockImplementation(async (path: string) => {
        if (path.includes("state.json")) {
          return JSON.stringify(state); // no step
        }
        throw new Error("ENOENT");
      });

      const result = await computeNextTask("/tmp/test-project", "test-topic");

      expect(result.step).toBe("1a");
      expect(result.prompt).not.toContain("方案计划");
    });

    // TC-18: Step advance clears approachState (P1-1)
    it("TC-18: step advance clears approachState (P1-1 fix)", async () => {
      const approachState: ApproachState = {
        stepId: "3",
        approaches: [
          { id: "primary", summary: "方案A", failCount: 0 },
          { id: "alt-a", summary: "方案B", failCount: 0 },
        ],
        currentIndex: 0,
        failedApproaches: [],
      };

      const state = makeState({ mode: "quick" });
      mockLoadAndValidate.mockResolvedValue(state);

      mockReadFile.mockImplementation(async (path: string) => {
        if (path.includes("state.json")) {
          return JSON.stringify({
            ...state,
            step: "3",
            stepIteration: 0,
            approachState,
          });
        }
        if (path.includes("plan.md")) {
          return "### Task 3: Implement\n";
        }
        throw new Error("ENOENT");
      });

      // Build + test pass -> step 3 passes, advances to next step
      setupPassingBuildAndTest();

      const result = await computeNextTask("/tmp/test-project", "test-topic");

      // Should advance to step 4a (quick mode: 3, 4, 5, 7)
      expect(result.step).toBe("4a");
      // approachState should be null in the step-advance atomicUpdate
      const advanceCall = mockAtomicUpdate.mock.calls.find(
        (call: unknown[]) => (call[0] as Record<string, unknown>).step === "4a",
      );
      expect(advanceCall).toBeDefined();
      expect((advanceCall![0] as Record<string, unknown>).approachState).toBeNull();
    });

    // TC-19: approachState present skips MAX_STEP_ITERATIONS check
    it("TC-19: approachState present skips iteration limit check", async () => {
      const approachState: ApproachState = {
        stepId: "3",
        approaches: [
          { id: "primary", summary: "方案A", failCount: 0 },
          { id: "alt-a", summary: "方案B", failCount: 0 },
        ],
        currentIndex: 0,
        failedApproaches: [],
      };

      const state = makeState({ mode: "turbo" });
      mockLoadAndValidate.mockResolvedValue(state);

      mockReadFile.mockImplementation(async (path: string) => {
        if (path.includes("state.json")) {
          return JSON.stringify({
            ...state,
            step: "3",
            stepIteration: 5,
            approachState,
          });
        }
        if (path.includes("approach-plan.md")) {
          return approachPlan2;
        }
        throw new Error("ENOENT");
      });

      setupFailingBuild();

      const result = await computeNextTask("/tmp/test-project", "test-topic");

      // Should NOT trigger escalation despite stepIteration=5
      expect(result.escalation).toBeUndefined();
      expect(result.prompt).not.toBeNull();
      // approachState should have failCount incremented in one of the writes
      const written = getWrittenStateWithApproachState();
      expect(written).not.toBeNull();
      const as = written!.approachState as ApproachState;
      expect(as.approaches[0].failCount).toBe(1);
    });

    // TC-20: New approach first failure -> revision (not CIRCUIT_BREAK)
    it("TC-20: new approach first failure returns revision, not CIRCUIT_BREAK", async () => {
      const approachState: ApproachState = {
        stepId: "3",
        approaches: [
          { id: "primary", summary: "方案A", failCount: 2 },
          { id: "alt-a", summary: "方案B", failCount: 0 },
        ],
        currentIndex: 1,
        failedApproaches: [
          { id: "primary", summary: "方案A", failReason: "编译失败" },
        ],
      };

      const state = makeState({ mode: "turbo" });
      mockLoadAndValidate.mockResolvedValue(state);

      mockReadFile.mockImplementation(async (path: string) => {
        if (path.includes("state.json")) {
          return JSON.stringify({
            ...state,
            step: "3",
            stepIteration: 0,
            approachState,
          });
        }
        throw new Error("ENOENT");
      });

      setupFailingBuild();

      const result = await computeNextTask("/tmp/test-project", "test-topic");

      // Should be revision, not CIRCUIT_BREAK
      expect(result.prompt).not.toBeNull();
      expect(result.freshContext).toBeUndefined();
      expect(result.escalation).toBeUndefined();
      // failCount on alt-a should be 1 in the approachState write
      const written = getWrittenStateWithApproachState();
      expect(written).not.toBeNull();
      const as = written!.approachState as ApproachState;
      expect(as.approaches[1].failCount).toBe(1);
    });

    // TC-21: Full lifecycle with 3 approaches (6 calls)
    it("TC-21: full 3-approach lifecycle (AC-2, AC-3, AC-4)", async () => {
      const state = makeState({ mode: "turbo" });

      // We simulate 6 sequential calls by updating the step state between calls
      let currentStepState: Record<string, unknown> = {
        ...state,
        step: "3",
        stepIteration: 0,
        approachState: null,
      };

      setupFailingBuild();

      // --- Call 1: First failure, no approachState -> CONTINUE, creates approachState
      mockLoadAndValidate.mockResolvedValue(state);
      mockReadFile.mockImplementation(async (path: string) => {
        if (path.includes("state.json")) return JSON.stringify(currentStepState);
        if (path.includes("approach-plan.md")) return approachPlan3;
        throw new Error("ENOENT");
      });
      vi.mocked(mockWriteFile).mockClear();

      let result = await computeNextTask("/tmp/test-project", "test-topic");
      expect(result.prompt).not.toBeNull();
      expect(result.freshContext).toBeUndefined();

      let written = getWrittenStateWithApproachState();
      expect(written).not.toBeNull();
      let as = written!.approachState as ApproachState;
      expect(as.currentIndex).toBe(0);
      expect(as.failedApproaches).toHaveLength(0);

      // --- Call 2: primary.failCount=1 -> CIRCUIT_BREAK to alt-a
      currentStepState = {
        ...state,
        step: "3",
        stepIteration: 1,
        approachState: {
          stepId: "3",
          approaches: [
            { id: "primary", summary: "使用 vitest mock 进行测试", failCount: 1 },
            { id: "alt-a", summary: "使用 jest 进行测试", failCount: 0 },
            { id: "alt-b", summary: "使用 mocha 进行测试", failCount: 0 },
          ],
          currentIndex: 0,
          failedApproaches: [],
        },
      };
      vi.mocked(mockWriteFile).mockClear();
      mockReadFile.mockImplementation(async (path: string) => {
        if (path.includes("state.json")) return JSON.stringify(currentStepState);
        if (path.includes("plan.md")) return "## Task 3: Implement\nDo the thing";
        throw new Error("ENOENT");
      });

      result = await computeNextTask("/tmp/test-project", "test-topic");
      expect(result.freshContext).toBe(true);
      expect(result.prompt).toContain("禁止");

      written = getLastWrittenState();
      expect(written!.stepIteration).toBe(0);
      as = written!.approachState as ApproachState;
      expect(as.currentIndex).toBe(1);
      expect(as.failedApproaches).toHaveLength(1);

      // --- Call 3: alt-a.failCount=0, first failure -> CONTINUE
      currentStepState = {
        ...state,
        step: "3",
        stepIteration: 0,
        approachState: {
          stepId: "3",
          approaches: [
            { id: "primary", summary: "使用 vitest mock 进行测试", failCount: 2 },
            { id: "alt-a", summary: "使用 jest 进行测试", failCount: 0 },
            { id: "alt-b", summary: "使用 mocha 进行测试", failCount: 0 },
          ],
          currentIndex: 1,
          failedApproaches: [
            { id: "primary", summary: "使用 vitest mock 进行测试", failReason: "编译失败" },
          ],
        },
      };
      vi.mocked(mockWriteFile).mockClear();
      mockReadFile.mockImplementation(async (path: string) => {
        if (path.includes("state.json")) return JSON.stringify(currentStepState);
        throw new Error("ENOENT");
      });

      result = await computeNextTask("/tmp/test-project", "test-topic");
      expect(result.prompt).not.toBeNull();
      expect(result.freshContext).toBeUndefined();

      // --- Call 4: alt-a.failCount=1 -> CIRCUIT_BREAK to alt-b
      currentStepState = {
        ...state,
        step: "3",
        stepIteration: 1,
        approachState: {
          stepId: "3",
          approaches: [
            { id: "primary", summary: "使用 vitest mock 进行测试", failCount: 2 },
            { id: "alt-a", summary: "使用 jest 进行测试", failCount: 1 },
            { id: "alt-b", summary: "使用 mocha 进行测试", failCount: 0 },
          ],
          currentIndex: 1,
          failedApproaches: [
            { id: "primary", summary: "使用 vitest mock 进行测试", failReason: "编译失败" },
          ],
        },
      };
      vi.mocked(mockWriteFile).mockClear();
      mockReadFile.mockImplementation(async (path: string) => {
        if (path.includes("state.json")) return JSON.stringify(currentStepState);
        if (path.includes("plan.md")) return "## Task 3: Implement\nDo the thing";
        throw new Error("ENOENT");
      });

      result = await computeNextTask("/tmp/test-project", "test-topic");
      expect(result.freshContext).toBe(true);
      expect(result.prompt).toContain("禁止");
      // Should contain 2 prohibited approaches now
      expect(result.prompt).toContain("使用 vitest mock 进行测试");
      expect(result.prompt).toContain("使用 jest 进行测试");

      written = getLastWrittenState();
      expect(written!.stepIteration).toBe(0);
      as = written!.approachState as ApproachState;
      expect(as.currentIndex).toBe(2);
      expect(as.failedApproaches).toHaveLength(2);

      // --- Call 5: alt-b.failCount=0, first failure -> CONTINUE
      currentStepState = {
        ...state,
        step: "3",
        stepIteration: 0,
        approachState: {
          stepId: "3",
          approaches: [
            { id: "primary", summary: "使用 vitest mock 进行测试", failCount: 2 },
            { id: "alt-a", summary: "使用 jest 进行测试", failCount: 2 },
            { id: "alt-b", summary: "使用 mocha 进行测试", failCount: 0 },
          ],
          currentIndex: 2,
          failedApproaches: [
            { id: "primary", summary: "使用 vitest mock 进行测试", failReason: "编译失败" },
            { id: "alt-a", summary: "使用 jest 进行测试", failReason: "测试失败" },
          ],
        },
      };
      vi.mocked(mockWriteFile).mockClear();
      mockReadFile.mockImplementation(async (path: string) => {
        if (path.includes("state.json")) return JSON.stringify(currentStepState);
        throw new Error("ENOENT");
      });

      result = await computeNextTask("/tmp/test-project", "test-topic");
      expect(result.prompt).not.toBeNull();
      expect(result.freshContext).toBeUndefined();

      // --- Call 6: alt-b.failCount=1 -> ALL_EXHAUSTED
      currentStepState = {
        ...state,
        step: "3",
        stepIteration: 1,
        approachState: {
          stepId: "3",
          approaches: [
            { id: "primary", summary: "使用 vitest mock 进行测试", failCount: 2 },
            { id: "alt-a", summary: "使用 jest 进行测试", failCount: 2 },
            { id: "alt-b", summary: "使用 mocha 进行测试", failCount: 1 },
          ],
          currentIndex: 2,
          failedApproaches: [
            { id: "primary", summary: "使用 vitest mock 进行测试", failReason: "编译失败" },
            { id: "alt-a", summary: "使用 jest 进行测试", failReason: "测试失败" },
          ],
        },
      };
      vi.mocked(mockWriteFile).mockClear();
      mockReadFile.mockImplementation(async (path: string) => {
        if (path.includes("state.json")) return JSON.stringify(currentStepState);
        throw new Error("ENOENT");
      });

      result = await computeNextTask("/tmp/test-project", "test-topic");
      expect(result.done).toBe(false);
      expect(result.prompt).toBeNull();
      expect(result.escalation?.reason).toBe("all_approaches_exhausted");
      expect(mockAtomicUpdate.mock.calls.some(
        (call: unknown[]) => (call[0] as Record<string, unknown>).status === "BLOCKED",
      )).toBe(true);
    });

    // TC-25: getStepGoal fallback when plan.md is missing
    it("TC-25: CIRCUIT_BREAK prompt uses fallback goal when plan.md missing", async () => {
      const approachState: ApproachState = {
        stepId: "3",
        approaches: [
          { id: "primary", summary: "方案A", failCount: 1 },
          { id: "alt-a", summary: "方案B", failCount: 0 },
        ],
        currentIndex: 0,
        failedApproaches: [],
      };

      const stepState = {
        step: "3",
        stepIteration: 1,
        lastValidation: "FAILED",
        approachState,
      };

      // plan.md does not exist
      mockReadFile.mockRejectedValue(new Error("ENOENT"));

      const result = await handleApproachFailure(
        stepState, "3", "/tmp/test-project/docs/auto-dev/test-topic", "build error",
      );

      expect(result.action).toBe("CIRCUIT_BREAK");
      if (result.action === "CIRCUIT_BREAK") {
        expect(result.prompt).toContain("完成步骤 3 的任务");
      }
    });

    // TC-26: handleApproachFailure with malformed approach-plan -> planFeedback
    it("TC-26: malformed approach-plan returns planFeedback (AC-6)", async () => {
      const stepState = {
        step: "3",
        stepIteration: 0,
        lastValidation: null,
        approachState: null,
      };

      // approach-plan.md exists but only has primary (no alternatives)
      mockReadFile.mockImplementation(async (path: string) => {
        if (path.includes("approach-plan.md")) {
          return "## 主方案\n- **方法**: 只有一个方案\n- **核心工具**: vitest";
        }
        throw new Error("ENOENT");
      });

      const result = await handleApproachFailure(
        stepState, "3", "/tmp/test-project/docs/auto-dev/test-topic", "test failed",
      );

      expect(result.action).toBe("CONTINUE");
      if (result.action === "CONTINUE") {
        expect(result.planFeedback).toBeDefined();
        expect(result.planFeedback).toContain("备选方案");
      }
    });
  });

  // -----------------------------------------------------------------------
  // skipE2e — orchestrator must skip Phase 5 steps
  // -----------------------------------------------------------------------

  describe("skipE2e phase 5 skipping", () => {
    it("TC-27: skipE2e=true skips step 5a/5b, advances from 4a to 6", async () => {
      const state = makeState({ mode: "full", skipE2e: true, phase: 4 });
      mockLoadAndValidate.mockResolvedValue(state);

      mockReadFile.mockImplementation(async (path: string) => {
        if (path.includes("state.json")) {
          return JSON.stringify({
            ...state,
            step: "4a",
            stepIteration: 0,
          });
        }
        if (path.includes("plan.md")) return "## Task\n";
        throw new Error("ENOENT");
      });

      // Build + test must pass for step 4a validation
      mockExecFile.mockImplementation(
        (_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
          cb(null, "ok", "");
        },
      );

      // tribunal PASS for phase 4
      mockEvaluateTribunal.mockResolvedValue({
        verdict: "PASS",
        issues: [],
      });

      const result = await computeNextTask("/tmp/test-project", "test-topic");

      // Should advance to step 6, NOT 5a
      expect(result.step).toBe("6");
      expect(result.done).toBe(false);

      // Verify phase was set to 6 in atomicUpdate
      const updateCalls = mockAtomicUpdate.mock.calls;
      const phaseUpdate = updateCalls.find(
        (call: unknown[]) => (call[0] as Record<string, unknown>).phase === 6,
      );
      expect(phaseUpdate).toBeDefined();
    });

    it("TC-28: skipE2e=false does NOT skip step 5a", async () => {
      const state = makeState({ mode: "full", skipE2e: false, phase: 4 });
      mockLoadAndValidate.mockResolvedValue(state);

      mockReadFile.mockImplementation(async (path: string) => {
        if (path.includes("state.json")) {
          return JSON.stringify({
            ...state,
            step: "4a",
            stepIteration: 0,
          });
        }
        if (path.includes("plan.md")) return "## Task\n";
        throw new Error("ENOENT");
      });

      // Build + test must pass for step 4a validation
      mockExecFile.mockImplementation(
        (_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
          cb(null, "ok", "");
        },
      );

      mockEvaluateTribunal.mockResolvedValue({
        verdict: "PASS",
        issues: [],
      });

      const result = await computeNextTask("/tmp/test-project", "test-topic");

      expect(result.step).toBe("5a");
    });
  });
});

// ---------------------------------------------------------------------------
// buildTaskForStep — Component-level tests for approach plan instruction
// ---------------------------------------------------------------------------

describe("buildTaskForStep", () => {
  // TC-15: step "5b" includes approach plan instruction (AC-8)
  it("TC-15: step 5b prompt includes approach plan instruction (AC-8)", async () => {
    const result = await buildTaskForStep(
      "5b",
      "/tmp/output",
      "/tmp/project",
      "test-topic",
      "npm run build",
      "npm test",
    );

    expect(result).toContain("方案计划");
    expect(result).toContain("approach-plan.md");
  });

  // TC-17: step "7" does not include approach plan instruction (AC-8 negative)
  it("TC-17: step 7 prompt does not include approach plan instruction (AC-8)", async () => {
    const result = await buildTaskForStep(
      "7",
      "/tmp/output",
      "/tmp/project",
      "test-topic",
      "npm run build",
      "npm test",
    );

    expect(result).not.toContain("方案计划");
  });
});

// ---------------------------------------------------------------------------
// computeNextStep — skipE2e phase filtering
// ---------------------------------------------------------------------------

describe("computeNextStep — skipE2e phase filtering", () => {
  it("full phases: step 4a → 5a (phase 5 included)", () => {
    const phases = [1, 2, 3, 4, 5, 6, 7];
    expect(computeNextStep("4a", phases)).toBe("5a");
  });

  it("full phases minus 5: step 4a → 6 (phase 5 excluded)", () => {
    const phases = [1, 2, 3, 4, 6, 7];
    expect(computeNextStep("4a", phases)).toBe("6");
  });

  it("quick phases minus 5: step 4a → 7 (phases [3,4,7])", () => {
    const phases = [3, 4, 7];
    expect(computeNextStep("4a", phases)).toBe("7");
  });

  it("step 5b with phase 5 excluded: skips to 6", () => {
    // Edge case: if somehow at 5a, next candidate 5b also filtered
    const phases = [1, 2, 3, 4, 6, 7];
    expect(computeNextStep("5a", phases)).toBe("6");
  });

  // Phase 8 ship steps
  it("AC-4: full + ship phases: step 7 → 8a", () => {
    const phases = [1, 2, 3, 4, 5, 6, 7, 8];
    expect(computeNextStep("7", phases)).toBe("8a");
  });

  it("AC-5: skipE2e + ship: step 4a → 6 (skip 5), step 7 → 8a", () => {
    const phases = [1, 2, 3, 4, 6, 7, 8];
    expect(computeNextStep("4a", phases)).toBe("6");
    expect(computeNextStep("7", phases)).toBe("8a");
  });

  it("ship phases: step 8a → 8b → 8c → 8d", () => {
    const phases = [1, 2, 3, 4, 5, 6, 7, 8];
    expect(computeNextStep("8a", phases)).toBe("8b");
    expect(computeNextStep("8b", phases)).toBe("8c");
    expect(computeNextStep("8c", phases)).toBe("8d");
  });

  it("step 8d is terminal when phase 8 is last", () => {
    const phases = [1, 2, 3, 4, 5, 6, 7, 8];
    expect(computeNextStep("8d", phases)).toBeNull();
  });

  it("no ship: step 7 is terminal", () => {
    const phases = [1, 2, 3, 4, 5, 6, 7];
    expect(computeNextStep("7", phases)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Phase 8 Ship Integration Tests
// ---------------------------------------------------------------------------

describe("Phase 8 ship integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWriteFile.mockResolvedValue(undefined);
    mockAtomicUpdate.mockResolvedValue(undefined);
    mockInternalCheckpoint.mockResolvedValue({
      ok: true,
      nextDirective: { phaseCompleted: true, nextPhase: null, nextPhaseName: null, mandate: "", canDeclareComplete: true },
      stateUpdates: {},
    });
  });

  // AC-4: full + ship=true: Phase 7 PASS -> advance to 8a
  it("AC-4: Phase 7 PASS with ship=true advances to step 8a", async () => {
    const state = makeState({ mode: "full", ship: true, phase: 7, deployTarget: "my-app" });
    mockLoadAndValidate.mockResolvedValue(state);

    mockReadFile.mockImplementation(async (path: string) => {
      if (path.includes("state.json")) {
        return JSON.stringify({ ...state, step: "7", stepIteration: 0 });
      }
      if (path.includes("retrospective.md")) {
        return ("x\n").repeat(35); // >30 lines
      }
      throw new Error("ENOENT");
    });

    const result = await computeNextTask("/tmp/test-project", "test-topic");

    expect(result.done).toBe(false);
    expect(result.step).toBe("8a");
    expect(result.agent).toBe("auto-dev-developer");
  });

  // AC-6: Step 8a validation - unpushed commits
  it("AC-6: Step 8a fails when there are unpushed commits", async () => {
    const state = makeState({ mode: "full", ship: true, phase: 8, deployTarget: "my-app" });
    mockLoadAndValidate.mockResolvedValue(state);

    mockReadFile.mockImplementation(async (path: string) => {
      if (path.includes("state.json")) {
        return JSON.stringify({ ...state, step: "8a", stepIteration: 0 });
      }
      throw new Error("ENOENT");
    });

    // git log returns unpushed commits
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
        cb(null, "abc1234 some unpushed commit\n", "");
      },
    );

    const result = await computeNextTask("/tmp/test-project", "test-topic");

    expect(result.done).toBe(false);
    expect(result.step).toBe("8a");
    // Should be a revision (failed validation)
    expect(result.prompt).not.toBeNull();
  });

  it("AC-6: Step 8a passes when no unpushed commits", async () => {
    const state = makeState({ mode: "full", ship: true, phase: 8, deployTarget: "my-app" });
    mockLoadAndValidate.mockResolvedValue(state);

    mockReadFile.mockImplementation(async (path: string) => {
      if (path.includes("state.json")) {
        return JSON.stringify({ ...state, step: "8a", stepIteration: 0 });
      }
      throw new Error("ENOENT");
    });

    // git log returns empty (all pushed)
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
        cb(null, "", "");
      },
    );

    const result = await computeNextTask("/tmp/test-project", "test-topic");

    expect(result.done).toBe(false);
    expect(result.step).toBe("8b");
    expect(result.message).toContain("8a");
    expect(result.message).toContain("passed");
  });

  // AC-7: Step 8b validation
  it("AC-7: Step 8b fails when ship-build-result.md missing", async () => {
    const state = makeState({ mode: "full", ship: true, phase: 8, deployTarget: "my-app" });
    mockLoadAndValidate.mockResolvedValue(state);

    mockReadFile.mockImplementation(async (path: string) => {
      if (path.includes("state.json")) {
        return JSON.stringify({ ...state, step: "8b", stepIteration: 0 });
      }
      throw new Error("ENOENT");
    });

    const result = await computeNextTask("/tmp/test-project", "test-topic");

    expect(result.done).toBe(false);
    expect(result.step).toBe("8b");
    expect(result.prompt).not.toBeNull();
  });

  it("AC-7: Step 8b passes when ship-build-result.md contains SUCCEED", async () => {
    const state = makeState({ mode: "full", ship: true, phase: 8, deployTarget: "my-app" });
    mockLoadAndValidate.mockResolvedValue(state);

    mockReadFile.mockImplementation(async (path: string) => {
      if (path.includes("state.json")) {
        return JSON.stringify({ ...state, step: "8b", stepIteration: 0 });
      }
      if (path.includes("ship-build-result.md")) {
        return "Build SUCCEED at 2026-03-27T10:00:00Z";
      }
      throw new Error("ENOENT");
    });

    const result = await computeNextTask("/tmp/test-project", "test-topic");

    expect(result.done).toBe(false);
    expect(result.step).toBe("8c");
  });

  // AC-8: Step 8c validation
  it("AC-8: Step 8c passes when ship-deploy-result.md contains SUCCEED", async () => {
    const state = makeState({ mode: "full", ship: true, phase: 8, deployTarget: "my-app" });
    mockLoadAndValidate.mockResolvedValue(state);

    mockReadFile.mockImplementation(async (path: string) => {
      if (path.includes("state.json")) {
        return JSON.stringify({ ...state, step: "8c", stepIteration: 0 });
      }
      if (path.includes("ship-deploy-result.md")) {
        return "Deploy SUCCEED to green environment";
      }
      throw new Error("ENOENT");
    });

    const result = await computeNextTask("/tmp/test-project", "test-topic");

    expect(result.done).toBe(false);
    expect(result.step).toBe("8d");
  });

  // AC-9: Step 8d validation - PASS
  it("AC-9: Step 8d PASS completes all phases", async () => {
    const state = makeState({ mode: "full", ship: true, phase: 8, deployTarget: "my-app" });
    mockLoadAndValidate.mockResolvedValue(state);

    mockReadFile.mockImplementation(async (path: string) => {
      if (path.includes("state.json")) {
        return JSON.stringify({ ...state, step: "8d", stepIteration: 0 });
      }
      if (path.includes("ship-verify-result.md")) {
        return "Verification PASS - all checks green";
      }
      throw new Error("ENOENT");
    });

    const result = await computeNextTask("/tmp/test-project", "test-topic");

    expect(result.done).toBe(true);
    expect(result.step).toBeNull();
  });

  // AC-9: Step 8d CODE_BUG -> regressToPhase=3
  it("AC-9: Step 8d CODE_BUG triggers regress to Phase 3", async () => {
    const state = makeState({
      mode: "full", ship: true, phase: 8, deployTarget: "my-app",
      shipRound: 0, shipMaxRounds: 5,
    });
    mockLoadAndValidate.mockResolvedValue(state);

    mockReadFile.mockImplementation(async (path: string) => {
      if (path.includes("state.json")) {
        return JSON.stringify({ ...state, step: "8d", stepIteration: 0 });
      }
      if (path.includes("ship-verify-result.md")) {
        return "Verification failed: CODE_BUG - NullPointerException in UserService";
      }
      if (path.includes("plan.md")) {
        return "## Task 3: Fix code\nFix the NullPointerException";
      }
      throw new Error("ENOENT");
    });

    const result = await computeNextTask("/tmp/test-project", "test-topic");

    expect(result.done).toBe(false);
    expect(result.step).toBe("3");
    expect(result.agent).toBe("auto-dev-developer");
    expect(result.message).toContain("CODE_BUG");
    expect(result.message).toContain("round 1");

    // Verify atomicUpdate was called with regress state
    const regressCall = mockAtomicUpdate.mock.calls.find(
      (call: unknown[]) => (call[0] as Record<string, unknown>).lastValidation === "SHIP_REGRESS",
    );
    expect(regressCall).toBeDefined();
    const regressData = regressCall![0] as Record<string, unknown>;
    expect(regressData.phase).toBe(3);
    expect(regressData.step).toBe("3");
    expect(regressData.stepIteration).toBe(0);
    expect(regressData.shipRound).toBe(1);
    expect(regressData.approachState).toBeNull();
  });

  // AC-9: Step 8d ENV_ISSUE -> no regress
  it("AC-9: Step 8d ENV_ISSUE returns failure without regress", async () => {
    const state = makeState({ mode: "full", ship: true, phase: 8, deployTarget: "my-app" });
    mockLoadAndValidate.mockResolvedValue(state);

    mockReadFile.mockImplementation(async (path: string) => {
      if (path.includes("state.json")) {
        return JSON.stringify({ ...state, step: "8d", stepIteration: 0 });
      }
      if (path.includes("ship-verify-result.md")) {
        return "Verification failed: ENV_ISSUE - connection refused to database";
      }
      throw new Error("ENOENT");
    });

    const result = await computeNextTask("/tmp/test-project", "test-topic");

    expect(result.done).toBe(false);
    // ENV_ISSUE goes to normal failure handling (not regress)
    expect(result.step).toBe("8d");
  });

  // AC-10: shipRound >= shipMaxRounds -> ESCALATE
  it("AC-10: shipRound >= shipMaxRounds returns ESCALATE with BLOCKED", async () => {
    const state = makeState({
      mode: "full", ship: true, phase: 8, deployTarget: "my-app",
      shipRound: 4, shipMaxRounds: 5,
    });
    mockLoadAndValidate.mockResolvedValue(state);

    mockReadFile.mockImplementation(async (path: string) => {
      if (path.includes("state.json")) {
        return JSON.stringify({ ...state, step: "8d", stepIteration: 0 });
      }
      if (path.includes("ship-verify-result.md")) {
        return "Verification failed: CODE_BUG - still broken";
      }
      throw new Error("ENOENT");
    });

    const result = await computeNextTask("/tmp/test-project", "test-topic");

    expect(result.done).toBe(false);
    expect(result.escalation).toBeDefined();
    expect(result.escalation?.reason).toBe("ship_max_rounds");
    expect(result.prompt).toBeNull();

    // Verify BLOCKED status
    const blockedCall = mockAtomicUpdate.mock.calls.find(
      (call: unknown[]) => (call[0] as Record<string, unknown>).status === "BLOCKED",
    );
    expect(blockedCall).toBeDefined();
  });

  // AC-12: Phase 8 steps do NOT trigger tribunal
  it("AC-12: Phase 8 steps do not call evaluateTribunal", async () => {
    const state = makeState({ mode: "full", ship: true, phase: 8, deployTarget: "my-app" });
    mockLoadAndValidate.mockResolvedValue(state);

    // Step 8b passes
    mockReadFile.mockImplementation(async (path: string) => {
      if (path.includes("state.json")) {
        return JSON.stringify({ ...state, step: "8b", stepIteration: 0 });
      }
      if (path.includes("ship-build-result.md")) {
        return "Build SUCCEED";
      }
      throw new Error("ENOENT");
    });

    await computeNextTask("/tmp/test-project", "test-topic");

    expect(mockEvaluateTribunal).not.toHaveBeenCalled();
  });

  // No ship: Phase 7 is terminal (step 7 -> done=true)
  it("AC-3: no ship: Phase 7 last step completes successfully", async () => {
    const state = makeState({ mode: "full", phase: 7 });
    mockLoadAndValidate.mockResolvedValue(state);

    mockReadFile.mockImplementation(async (path: string) => {
      if (path.includes("state.json")) {
        return JSON.stringify({ ...state, step: "7", stepIteration: 0 });
      }
      if (path.includes("retrospective.md")) {
        return ("x\n").repeat(35);
      }
      throw new Error("ENOENT");
    });

    const result = await computeNextTask("/tmp/test-project", "test-topic");

    expect(result.done).toBe(true);
    expect(result.step).toBeNull();
  });
});
