/**
 * TDD Gate Integration Tests
 *
 * These tests verify the integration of TDD Gate components:
 * - StateManager + tddTaskStates persistence (atomicUpdate round-trip)
 * - Checkpoint TDD gate logic (replicated from index.ts ~L557-574)
 * - isTddExemptTask with real plan.md files
 * - buildTestCommand with real language strings from stack definitions
 * - extractTddGateStats via generateRetrospectiveData from real files
 * - Tribunal checklist TDD Gate Verification section
 *
 * Does NOT duplicate unit tests from tdd-gate.test.ts.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { StateManager } from "../state-manager.js";
import { isTddExemptTask } from "../phase-enforcer.js";
import { isTestFile, isImplFile, validateRedPhase, buildTestCommand } from "../tdd-gate.js";
import { getTribunalChecklist } from "../tribunal-checklists.js";
import { generateRetrospectiveData } from "../retrospective-data.js";
import type { StateJson, StackInfo } from "../types.js";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const TS_STACK: StackInfo = {
  language: "TypeScript/JavaScript",
  buildCmd: "npm run build",
  testCmd: "npm test",
  langChecklist: "ts.md",
};

const JAVA_STACK: StackInfo = {
  language: "Java 8",
  buildCmd: "mvn clean package -DskipTests",
  testCmd: "mvn test",
  langChecklist: "java.md",
};

const TOPIC = "tdd-gate-int-test";

let tmpDir: string;
let projectRoot: string;

async function setupTestProject(): Promise<string> {
  tmpDir = await mkdtemp(join(tmpdir(), "tdd-gate-int-"));
  projectRoot = tmpDir;
  await writeFile(join(projectRoot, "package.json"), '{"name":"test"}', "utf-8");
  return projectRoot;
}

async function initStateOnDisk(
  sm: StateManager,
  overrides: Partial<StateJson> = {},
): Promise<StateJson> {
  const outputDir = sm.outputDir;
  await mkdir(outputDir, { recursive: true });

  const now = new Date().toISOString();
  const state: StateJson = {
    topic: TOPIC,
    mode: "full",
    phase: 3,
    status: "IN_PROGRESS",
    stack: TS_STACK,
    outputDir,
    projectRoot,
    startedAt: now,
    updatedAt: now,
    ...overrides,
  };

  await sm.atomicWrite(sm.stateFilePath, JSON.stringify(state, null, 2));

  const header =
    `# auto-dev progress-log: ${TOPIC}\n\n` +
    `> Started: ${state.startedAt}  \n` +
    `> Mode: ${state.mode}  \n` +
    `> Stack: ${state.stack.language}\n\n`;
  await sm.atomicWrite(sm.progressLogPath, header);

  return state;
}

// ---------------------------------------------------------------------------
// 1. StateManager + tddTaskStates persistence
// ---------------------------------------------------------------------------

describe("Integration: StateManager + tddTaskStates persistence", () => {
  let sm: StateManager;

  beforeEach(async () => {
    await setupTestProject();
    sm = new StateManager(projectRoot, TOPIC);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("atomicUpdate persists tddTaskStates and loadAndValidate reads it back", async () => {
    await initStateOnDisk(sm, { tdd: true });

    await sm.atomicUpdate({
      tddTaskStates: {
        "1": { status: "RED_CONFIRMED", redTestFiles: ["src/__tests__/foo.test.ts"], redExitCode: 1, redFailType: "test_failure" },
      },
    });

    const reloaded = await sm.loadAndValidate();
    expect(reloaded.tddTaskStates).toBeDefined();
    expect(reloaded.tddTaskStates!["1"]!.status).toBe("RED_CONFIRMED");
    expect(reloaded.tddTaskStates!["1"]!.redTestFiles).toEqual(["src/__tests__/foo.test.ts"]);
    expect(reloaded.tddTaskStates!["1"]!.redExitCode).toBe(1);
    expect(reloaded.tddTaskStates!["1"]!.redFailType).toBe("test_failure");
  });

  it("atomicUpdate merges new task state with existing tddTaskStates", async () => {
    await initStateOnDisk(sm, {
      tdd: true,
      tddTaskStates: {
        "1": { status: "GREEN_CONFIRMED", redTestFiles: ["a.test.ts"], redExitCode: 1, redFailType: "test_failure" },
      },
    });

    // Simulate adding task 2 RED_CONFIRMED -- must spread existing states
    const current = await sm.loadAndValidate();
    const existingStates = current.tddTaskStates ?? {};
    await sm.atomicUpdate({
      tddTaskStates: {
        ...existingStates,
        "2": { status: "RED_CONFIRMED", redTestFiles: ["b.test.ts"], redExitCode: 1 },
      },
    });

    const reloaded = await sm.loadAndValidate();
    expect(Object.keys(reloaded.tddTaskStates!)).toHaveLength(2);
    expect(reloaded.tddTaskStates!["1"]!.status).toBe("GREEN_CONFIRMED");
    expect(reloaded.tddTaskStates!["2"]!.status).toBe("RED_CONFIRMED");
  });

  it("RED -> GREEN transition persists correctly via successive atomicUpdates", async () => {
    await initStateOnDisk(sm, { tdd: true });

    // Step 1: RED_CONFIRMED
    await sm.atomicUpdate({
      tddTaskStates: {
        "1": { status: "RED_CONFIRMED", redTestFiles: ["t.test.ts"], redExitCode: 1, redFailType: "compilation_error" },
      },
    });

    // Step 2: GREEN_CONFIRMED (spread existing, update status)
    const afterRed = await sm.loadAndValidate();
    const redState = afterRed.tddTaskStates!["1"]!;
    await sm.atomicUpdate({
      tddTaskStates: {
        ...afterRed.tddTaskStates,
        "1": { ...redState, status: "GREEN_CONFIRMED" },
      },
    });

    // Verify final state on disk
    const raw = JSON.parse(await readFile(sm.stateFilePath, "utf-8"));
    expect(raw.tddTaskStates["1"].status).toBe("GREEN_CONFIRMED");
    expect(raw.tddTaskStates["1"].redTestFiles).toEqual(["t.test.ts"]);
    expect(raw.tddTaskStates["1"].redExitCode).toBe(1);
    expect(raw.tddTaskStates["1"].redFailType).toBe("compilation_error");
  });
});

// ---------------------------------------------------------------------------
// 2. Checkpoint TDD gate logic (replicated from index.ts)
// ---------------------------------------------------------------------------

describe("Integration: Checkpoint TDD gate logic", () => {
  let sm: StateManager;

  beforeEach(async () => {
    await setupTestProject();
    sm = new StateManager(projectRoot, TOPIC);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  /**
   * Replicate the TDD gate check from index.ts L557-574.
   * Returns the error object if blocked, or null if allowed through.
   */
  async function simulateTddGate(
    state: StateJson,
    phase: number,
    status: string,
    task: number | undefined,
  ): Promise<{ error: string; message: string; mandate: string } | null> {
    if (phase === 3 && status === "PASS" && state.tdd === true && task != null) {
      const isExempt = await isTddExemptTask(sm.outputDir, task);
      if (!isExempt) {
        const tddState = state.tddTaskStates?.[String(task)];
        if (tddState?.status !== "GREEN_CONFIRMED") {
          return {
            error: "TDD_GATE_INCOMPLETE",
            message: `Task ${task} 未完成 TDD RED-GREEN 流程。` +
              (tddState?.status === "RED_CONFIRMED"
                ? "RED 已确认，但 GREEN 尚未完成。请先调用 auto_dev_task_green。"
                : "RED 尚未完成。请先调用 auto_dev_task_red。"),
            mandate: "[BLOCKED] TDD 模式下，checkpoint PASS 要求 RED+GREEN 均已确认。",
          };
        }
      }
    }
    return null;
  }

  it("INT-15: blocks when phase=3, status=PASS, tdd=true, no tddTaskStates", async () => {
    const state = await initStateOnDisk(sm, { tdd: true });

    const result = await simulateTddGate(state, 3, "PASS", 1);
    expect(result).not.toBeNull();
    expect(result!.error).toBe("TDD_GATE_INCOMPLETE");
    expect(result!.message).toContain("RED 尚未完成");
    expect(result!.message).toContain("auto_dev_task_red");
  });

  it("INT-16: blocks when only RED_CONFIRMED (no GREEN)", async () => {
    const state = await initStateOnDisk(sm, {
      tdd: true,
      tddTaskStates: {
        "1": { status: "RED_CONFIRMED", redTestFiles: ["t.ts"] },
      },
    });

    const result = await simulateTddGate(state, 3, "PASS", 1);
    expect(result).not.toBeNull();
    expect(result!.error).toBe("TDD_GATE_INCOMPLETE");
    expect(result!.message).toContain("RED 已确认");
    expect(result!.message).toContain("GREEN 尚未完成");
    expect(result!.message).toContain("auto_dev_task_green");
  });

  it("INT-17: allows through when GREEN_CONFIRMED", async () => {
    const state = await initStateOnDisk(sm, {
      tdd: true,
      tddTaskStates: {
        "1": { status: "GREEN_CONFIRMED", redTestFiles: ["t.ts"], redExitCode: 1, redFailType: "test_failure" },
      },
    });

    const result = await simulateTddGate(state, 3, "PASS", 1);
    expect(result).toBeNull();
  });

  it("INT-18: allows through when task is TDD exempt (plan.md has skip)", async () => {
    await initStateOnDisk(sm, { tdd: true });

    // Write plan.md with Task 9 marked as skip
    await writeFile(
      join(sm.outputDir, "plan.md"),
      "## Task 9: Update SKILL.md\n**TDD**: skip\n",
      "utf-8",
    );

    // Load state (no tddTaskStates for task 9)
    const state = await sm.loadAndValidate();

    const result = await simulateTddGate(state, 3, "PASS", 9);
    expect(result).toBeNull();
  });

  it("INT-19: does not apply gate when tdd=false", async () => {
    const state = await initStateOnDisk(sm, { tdd: false });

    const result = await simulateTddGate(state, 3, "PASS", 1);
    expect(result).toBeNull();
  });

  it("does not apply gate when phase != 3", async () => {
    const state = await initStateOnDisk(sm, { tdd: true });

    const result = await simulateTddGate(state, 4, "PASS", 1);
    expect(result).toBeNull();
  });

  it("does not apply gate when status != PASS", async () => {
    const state = await initStateOnDisk(sm, { tdd: true });

    const result = await simulateTddGate(state, 3, "NEEDS_REVISION", 1);
    expect(result).toBeNull();
  });

  it("does not apply gate when task is undefined", async () => {
    const state = await initStateOnDisk(sm, { tdd: true });

    const result = await simulateTddGate(state, 3, "PASS", undefined);
    expect(result).toBeNull();
  });

  it("state not polluted when TDD gate blocks", async () => {
    const state = await initStateOnDisk(sm, { tdd: true, phase: 3, status: "IN_PROGRESS" });

    const result = await simulateTddGate(state, 3, "PASS", 1);
    expect(result).not.toBeNull();

    // Verify state.json unchanged (no phase/status mutation)
    const reloaded = await sm.loadAndValidate();
    expect(reloaded.phase).toBe(3);
    expect(reloaded.status).toBe("IN_PROGRESS");
    expect(reloaded.tddTaskStates).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 3. isTddExemptTask with real plan.md files
// ---------------------------------------------------------------------------

describe("Integration: isTddExemptTask with real plan.md", () => {
  let outputDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "tdd-exempt-int-"));
    outputDir = tmpDir;
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("mixed plan.md: correctly identifies exempt vs required tasks", async () => {
    await writeFile(join(outputDir, "plan.md"), [
      "# Plan",
      "",
      "## Task 1: Implement feature A",
      "**TDD**: required",
      "Details of task 1.",
      "",
      "## Task 2: Update config files",
      "**TDD**: skip",
      "Config only changes.",
      "",
      "## Task 3: Implement feature B",
      "**TDD**: required",
      "",
      "## Task 4: Write documentation",
      "**TDD**: skip",
      "",
      "## Task 5: Implement feature C",
      "No TDD marker here.",
    ].join("\n"), "utf-8");

    expect(await isTddExemptTask(outputDir, 1)).toBe(false);
    expect(await isTddExemptTask(outputDir, 2)).toBe(true);
    expect(await isTddExemptTask(outputDir, 3)).toBe(false);
    expect(await isTddExemptTask(outputDir, 4)).toBe(true);
    expect(await isTddExemptTask(outputDir, 5)).toBe(false);
  });

  it("returns false when task number does not exist in plan.md", async () => {
    await writeFile(join(outputDir, "plan.md"), [
      "## Task 1: Something",
      "**TDD**: skip",
    ].join("\n"), "utf-8");

    expect(await isTddExemptTask(outputDir, 99)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4. buildTestCommand with real language strings
// ---------------------------------------------------------------------------

describe("Integration: buildTestCommand with stack language strings", () => {
  it("TypeScript/JavaScript stack produces vitest command", () => {
    const cmd = buildTestCommand(
      TS_STACK.language,
      ["src/__tests__/foo.test.ts", "src/__tests__/bar.test.ts"],
      "/project",
    );
    expect(cmd).toBe("npx vitest run src/__tests__/foo.test.ts src/__tests__/bar.test.ts --reporter=verbose");
  });

  it("Java 8 stack produces mvn test command with module detection", () => {
    const cmd = buildTestCommand(
      JAVA_STACK.language,
      ["service-mod/src/test/java/com/example/FooTest.java"],
      "/project",
    );
    expect(cmd).toBe('mvn test -Dtest="FooTest" -pl service-mod -DfailIfNoTests=false');
  });

  it("Java 8 multi-module produces chained commands", () => {
    const cmd = buildTestCommand(
      JAVA_STACK.language,
      [
        "api-mod/src/test/java/ATest.java",
        "service-mod/src/test/java/BTest.java",
      ],
      "/project",
    );
    expect(cmd).toContain("-pl api-mod");
    expect(cmd).toContain("-pl service-mod");
    expect(cmd).toContain("&&");
  });

  it("Python stack produces pytest command", () => {
    const cmd = buildTestCommand("Python", ["tests/test_calc.py"], "/project");
    expect(cmd).toBe("pytest tests/test_calc.py -v");
  });
});

// ---------------------------------------------------------------------------
// 5. validateRedPhase end-to-end scenarios
// ---------------------------------------------------------------------------

describe("Integration: validateRedPhase end-to-end scenarios", () => {
  it("realistic Java project: test + test resource OK, impl file REJECTED", () => {
    const changedFiles = [
      "service-tifenbao-metrics/src/test/java/com/metrics/BatchImportTest.java",
      "service-tifenbao-metrics/src/test/resources/test-data.json",
    ];
    const testFiles = ["service-tifenbao-metrics/src/test/java/com/metrics/BatchImportTest.java"];

    const result = validateRedPhase(changedFiles, testFiles);
    expect(result.valid).toBe(true);
  });

  it("realistic Java project: impl file mixed in triggers rejection", () => {
    const changedFiles = [
      "service-tifenbao-metrics/src/test/java/com/metrics/BatchImportTest.java",
      "service-tifenbao-metrics/src/main/java/com/metrics/BatchImportService.java",
    ];
    const testFiles = ["service-tifenbao-metrics/src/test/java/com/metrics/BatchImportTest.java"];

    const result = validateRedPhase(changedFiles, testFiles);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("BatchImportService.java");
  });

  it("TypeScript project: .test.ts files pass, .ts impl file rejects", () => {
    const changedOk = ["src/__tests__/tdd-gate.test.ts"];
    const changedBad = ["src/__tests__/tdd-gate.test.ts", "src/tdd-gate.ts"];
    const testFiles = ["src/__tests__/tdd-gate.test.ts"];

    expect(validateRedPhase(changedOk, testFiles).valid).toBe(true);
    expect(validateRedPhase(changedBad, testFiles).valid).toBe(false);
  });

  it("file classification: isTestFile + isImplFile are consistent", () => {
    const files = [
      "src/main/java/Foo.java",
      "src/test/java/FooTest.java",
      "tests/fixtures/data.json",
      "src/__tests__/bar.test.ts",
      "src/utils.ts",
      "README.md",
      "pom.xml",
    ];

    for (const f of files) {
      // A file cannot be both test and impl
      expect(isTestFile(f) && isImplFile(f)).toBe(false);
    }

    // Verify specific classifications
    expect(isTestFile("src/test/java/FooTest.java")).toBe(true);
    expect(isImplFile("src/main/java/Foo.java")).toBe(true);
    expect(isTestFile("tests/fixtures/data.json")).toBe(true);
    expect(isImplFile("README.md")).toBe(false);
    expect(isTestFile("README.md")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 6. extractTddGateStats via generateRetrospectiveData
// ---------------------------------------------------------------------------

describe("Integration: extractTddGateStats from real files", () => {
  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "tdd-retro-int-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("INT-21: correct stats from state.json tddTaskStates + progress-log rejections", async () => {
    // Write state.json with tddTaskStates
    const state = {
      topic: "test",
      mode: "full",
      phase: 7,
      status: "IN_PROGRESS",
      stack: TS_STACK,
      outputDir: tmpDir,
      projectRoot: tmpDir,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      tdd: true,
      tddTaskStates: {
        "1": { status: "GREEN_CONFIRMED", redTestFiles: ["a.test.ts"], redExitCode: 1, redFailType: "test_failure" },
        "2": { status: "GREEN_CONFIRMED", redTestFiles: ["b.test.ts"], redExitCode: 1, redFailType: "test_failure" },
        "3": { status: "RED_CONFIRMED", redTestFiles: ["c.test.ts"], redExitCode: 1 },
      },
    };
    await writeFile(join(tmpDir, "state.json"), JSON.stringify(state, null, 2), "utf-8");

    // Write progress-log with rejection keywords
    const progressLog =
      `# auto-dev progress-log: test\n\n` +
      `> Started: 2026-01-01T00:00:00Z  \n` +
      `> Mode: full  \n` +
      `> Stack: TypeScript/JavaScript\n\n` +
      `TDD_RED_REJECTED: tests passed when they should fail\n` +
      `TDD_GREEN_REJECTED: tests still failing\n` +
      `TDD_GREEN_REJECTED: tests still failing again\n` +
      `\n<!-- CHECKPOINT phase=1 status=PASS timestamp=2026-01-01T01:00:00Z -->\n`;
    await writeFile(join(tmpDir, "progress-log.md"), progressLog, "utf-8");

    const result = await generateRetrospectiveData(tmpDir);
    expect(result.tddGateStats).toBeDefined();
    expect(result.tddGateStats!.totalTasks).toBe(3);
    expect(result.tddGateStats!.tddTasks).toBe(2);
    expect(result.tddGateStats!.exemptTasks).toBe(0);
    expect(result.tddGateStats!.redRejections).toBe(1);
    expect(result.tddGateStats!.greenRejections).toBe(2);
  });

  it("INT-22: returns all zeros when no tddTaskStates", async () => {
    const state = {
      topic: "test",
      mode: "full",
      phase: 7,
      status: "IN_PROGRESS",
      stack: TS_STACK,
      outputDir: tmpDir,
      projectRoot: tmpDir,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await writeFile(join(tmpDir, "state.json"), JSON.stringify(state, null, 2), "utf-8");
    await writeFile(join(tmpDir, "progress-log.md"), "# progress-log\n", "utf-8");

    const result = await generateRetrospectiveData(tmpDir);
    expect(result.tddGateStats).toBeDefined();
    expect(result.tddGateStats!.totalTasks).toBe(0);
    expect(result.tddGateStats!.tddTasks).toBe(0);
    expect(result.tddGateStats!.exemptTasks).toBe(0);
    expect(result.tddGateStats!.redRejections).toBe(0);
    expect(result.tddGateStats!.greenRejections).toBe(0);
  });

  it("INT-23: retrospective markdown contains TDD Gate Stats section", async () => {
    const state = {
      topic: "test",
      mode: "full",
      phase: 7,
      status: "IN_PROGRESS",
      stack: TS_STACK,
      outputDir: tmpDir,
      projectRoot: tmpDir,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      tdd: true,
      tddTaskStates: {
        "1": { status: "GREEN_CONFIRMED", redTestFiles: ["a.test.ts"], redExitCode: 1, redFailType: "test_failure" },
      },
    };
    await writeFile(join(tmpDir, "state.json"), JSON.stringify(state, null, 2), "utf-8");
    await writeFile(join(tmpDir, "progress-log.md"), "# progress-log\n", "utf-8");

    await generateRetrospectiveData(tmpDir);

    const retroMd = await readFile(join(tmpDir, "retrospective-data.md"), "utf-8");
    expect(retroMd).toContain("## TDD Gate Stats");
    expect(retroMd).toContain("| Total Tasks | 1 |");
    expect(retroMd).toContain("| TDD Tasks (RED+GREEN) | 1 |");
  });
});

// ---------------------------------------------------------------------------
// 7. Tribunal checklist contains TDD Gate Verification
// ---------------------------------------------------------------------------

describe("Integration: Tribunal checklist TDD Gate Verification", () => {
  it("INT-20: Phase 4 checklist contains TDD Gate Verification section", () => {
    const checklist = getTribunalChecklist(4);
    expect(checklist).toContain("TDD Gate Verification");
    expect(checklist).toContain("tddTaskStates");
    expect(checklist).toContain("GREEN_CONFIRMED");
  });

  it("Phase 4 checklist mentions RED_CONFIRMED as failure condition", () => {
    const checklist = getTribunalChecklist(4);
    expect(checklist).toContain("RED_CONFIRMED");
  });

  it("other tribunal phases (5, 6, 7) do not error", () => {
    expect(() => getTribunalChecklist(5)).not.toThrow();
    expect(() => getTribunalChecklist(6)).not.toThrow();
    expect(() => getTribunalChecklist(7)).not.toThrow();
  });

  it("non-tribunal phase throws", () => {
    expect(() => getTribunalChecklist(3)).toThrow(/No tribunal checklist/);
  });
});
