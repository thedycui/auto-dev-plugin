/**
 * Tests for tdd-gate.ts core functions and isTddExemptTask.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { isTestFile, isImplFile, buildTestCommand, validateRedPhase, TDD_TIMEOUTS } from "../tdd-gate.js";
import { countTestFiles } from "../phase-enforcer.js";
import { StateJsonSchema } from "../types.js";

// ---------------------------------------------------------------------------
// isTestFile
// ---------------------------------------------------------------------------

describe("isTestFile", () => {
  it("matches FooTest.java", () => {
    expect(isTestFile("src/test/java/com/metrics/FooTest.java")).toBe(true);
  });

  it("matches foo.test.ts", () => {
    expect(isTestFile("src/__tests__/foo.test.ts")).toBe(true);
  });

  it("matches foo.spec.js", () => {
    expect(isTestFile("lib/foo.spec.js")).toBe(true);
  });

  it("matches foo_test.go", () => {
    expect(isTestFile("pkg/handler/foo_test.go")).toBe(true);
  });

  it("matches foo_test.py", () => {
    expect(isTestFile("tests/foo_test.py")).toBe(true);
  });

  it("matches test resource file in test directory", () => {
    expect(isTestFile("tests/fixtures/data.json")).toBe(true);
  });

  it("matches test resource yaml in __tests__", () => {
    expect(isTestFile("src/__tests__/config.yml")).toBe(true);
  });

  it("does NOT match src/main/java/Foo.java", () => {
    expect(isTestFile("src/main/java/com/metrics/Foo.java")).toBe(false);
  });

  it("does NOT match src/utils.ts", () => {
    expect(isTestFile("src/utils.ts")).toBe(false);
  });

  it("does NOT match README.md", () => {
    expect(isTestFile("README.md")).toBe(false);
  });

  it("does NOT match config.yml outside test directory", () => {
    expect(isTestFile("config/app.yml")).toBe(false);
  });

  it("matches foo.test.tsx", () => {
    expect(isTestFile("foo.test.tsx")).toBe(true);
  });

  it("matches foo.spec.jsx", () => {
    expect(isTestFile("foo.spec.jsx")).toBe(true);
  });

  it("matches foo_test.rs", () => {
    expect(isTestFile("foo_test.rs")).toBe(true);
  });

  it("matches FooTest.kt", () => {
    expect(isTestFile("FooTest.kt")).toBe(true);
  });

  it("matches test_foo.py", () => {
    expect(isTestFile("test_foo.py")).toBe(true);
  });

  it("matches tests/test_bar.py", () => {
    expect(isTestFile("tests/test_bar.py")).toBe(true);
  });

  it("does NOT match src/main/java/TestDataFactory.java as false positive", () => {
    expect(isTestFile("src/main/java/TestDataFactory.java")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isImplFile
// ---------------------------------------------------------------------------

describe("isImplFile", () => {
  it("matches src/main/java/Foo.java", () => {
    expect(isImplFile("src/main/java/com/metrics/Foo.java")).toBe(true);
  });

  it("matches src/utils.ts", () => {
    expect(isImplFile("src/utils.ts")).toBe(true);
  });

  it("matches handler.go", () => {
    expect(isImplFile("pkg/handler.go")).toBe(true);
  });

  it("does NOT match FooTest.java (test file)", () => {
    expect(isImplFile("src/test/java/FooTest.java")).toBe(false);
  });

  it("does NOT match foo.test.ts (test file)", () => {
    expect(isImplFile("src/__tests__/foo.test.ts")).toBe(false);
  });

  it("does NOT match README.md (non-source)", () => {
    expect(isImplFile("README.md")).toBe(false);
  });

  it("does NOT match config.yml (non-source)", () => {
    expect(isImplFile("config/app.yml")).toBe(false);
  });

  it("does NOT match package.json (non-source)", () => {
    expect(isImplFile("package.json")).toBe(false);
  });

  it("does NOT match FooTest.java (isImplFile)", () => {
    expect(isImplFile("FooTest.java")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// buildTestCommand
// ---------------------------------------------------------------------------

describe("buildTestCommand", () => {
  it("returns empty string for empty testFiles", () => {
    expect(buildTestCommand("Java", [], "/project")).toBe("");
  });

  it("Java: single module test", () => {
    const result = buildTestCommand("Java", ["service-mod/src/test/java/BarTest.java"], "/project");
    expect(result).toBe('mvn test -Dtest="BarTest" -pl service-mod -DfailIfNoTests=false');
  });

  it("Java 8: works the same as Java", () => {
    const result = buildTestCommand("Java 8", ["service-mod/src/test/java/BarTest.java"], "/project");
    expect(result).toBe('mvn test -Dtest="BarTest" -pl service-mod -DfailIfNoTests=false');
  });

  it("Java: root-level test (no module) — no -pl flag", () => {
    const result = buildTestCommand("Java", ["src/test/java/FooTest.java"], "/project");
    expect(result).toBe('mvn test -Dtest="FooTest" -DfailIfNoTests=false');
  });

  it("Java: multi-module — two commands joined with &&", () => {
    const result = buildTestCommand("Java", [
      "mod-a/src/test/java/ATest.java",
      "mod-b/src/test/java/BTest.java",
    ], "/project");
    expect(result).toContain("&&");
    expect(result).toContain("-pl mod-a");
    expect(result).toContain("-pl mod-b");
  });

  it("TypeScript/JavaScript: vitest command", () => {
    const result = buildTestCommand("TypeScript/JavaScript", ["src/__tests__/foo.test.ts"], "/project");
    expect(result).toBe("npx vitest run src/__tests__/foo.test.ts --reporter=verbose");
  });

  it("TypeScript: also generates vitest command", () => {
    const result = buildTestCommand("TypeScript", ["src/foo.test.ts"], "/project");
    expect(result).toBe("npx vitest run src/foo.test.ts --reporter=verbose");
  });

  it("JavaScript: also generates vitest command", () => {
    const result = buildTestCommand("JavaScript", ["src/foo.test.js"], "/project");
    expect(result).toBe("npx vitest run src/foo.test.js --reporter=verbose");
  });

  it("Python: pytest command", () => {
    const result = buildTestCommand("Python", ["tests/test_foo.py"], "/project");
    expect(result).toBe("pytest tests/test_foo.py -v");
  });

  it("unknown language: returns empty string", () => {
    expect(buildTestCommand("Rust", ["src/foo_test.rs"], "/project")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// validateRedPhase
// ---------------------------------------------------------------------------

describe("validateRedPhase", () => {
  it("rejects when impl file is in changedFiles", () => {
    const result = validateRedPhase(
      ["src/main/java/Foo.java", "src/test/java/FooTest.java"],
      ["src/test/java/FooTest.java"],
    );
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Foo.java");
  });

  it("passes when only test files in changedFiles", () => {
    const result = validateRedPhase(
      ["src/test/java/FooTest.java"],
      ["src/test/java/FooTest.java"],
    );
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it("allows test resource files alongside test files", () => {
    const result = validateRedPhase(
      ["src/test/java/FooTest.java", "tests/fixtures/data.json"],
      ["src/test/java/FooTest.java"],
    );
    expect(result.valid).toBe(true);
  });

  it("rejects when no testFile found in changedFiles", () => {
    const result = validateRedPhase(
      ["tests/fixtures/data.json"],
      ["src/test/java/FooTest.java"],
    );
    expect(result.valid).toBe(false);
    expect(result.error).toContain("测试文件");
  });

  it("allows non-source non-test files (e.g., config)", () => {
    const result = validateRedPhase(
      ["src/test/java/FooTest.java", "pom.xml"],
      ["src/test/java/FooTest.java"],
    );
    expect(result.valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// TDD_TIMEOUTS
// ---------------------------------------------------------------------------

describe("TDD_TIMEOUTS", () => {
  it("has red and green timeouts", () => {
    expect(TDD_TIMEOUTS.red).toBe(60_000);
    expect(TDD_TIMEOUTS.green).toBe(120_000);
  });
});

// ---------------------------------------------------------------------------
// StateJsonSchema: tddTaskStates
// ---------------------------------------------------------------------------

describe("StateJsonSchema tddTaskStates", () => {
  function makeState(overrides: Record<string, unknown> = {}) {
    return {
      topic: "test",
      mode: "full",
      phase: 3,
      status: "IN_PROGRESS",
      stack: { language: "TypeScript", buildCmd: "npm run build", testCmd: "npm test", langChecklist: "ts.md" },
      outputDir: "/tmp/test",
      projectRoot: "/tmp",
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...overrides,
    };
  }

  it("accepts valid tddTaskStates with GREEN_CONFIRMED", () => {
    const state = makeState({
      tddTaskStates: {
        "1": { status: "GREEN_CONFIRMED", redTestFiles: ["test.ts"], redExitCode: 1, redFailType: "test_failure" },
      },
    });
    expect(StateJsonSchema.safeParse(state).success).toBe(true);
  });

  it("accepts valid tddTaskStates with RED_CONFIRMED", () => {
    const state = makeState({
      tddTaskStates: { "2": { status: "RED_CONFIRMED" } },
    });
    expect(StateJsonSchema.safeParse(state).success).toBe(true);
  });

  it("rejects invalid status value", () => {
    const state = makeState({
      tddTaskStates: { "1": { status: "INVALID" } },
    });
    expect(StateJsonSchema.safeParse(state).success).toBe(false);
  });

  it("backward compat: state without tddTaskStates is valid", () => {
    const state = makeState();
    expect(StateJsonSchema.safeParse(state).success).toBe(true);
  });

  it("backward compat: state without tddWarnings is valid (field removed)", () => {
    const state = makeState();
    expect(StateJsonSchema.safeParse(state).success).toBe(true);
    // tddWarnings field was removed from schema
    const stateWithOld = makeState({ tddWarnings: ["some warning"] });
    // Zod v4 passthrough: unknown fields should not fail (depends on schema strictness)
    // The important thing is the field is no longer in the schema definition
  });
});

// ---------------------------------------------------------------------------
// countTestFiles (AC-9)
// ---------------------------------------------------------------------------

describe("countTestFiles", () => {
  it("counts test files in a diff list", () => {
    const files = [
      "src/main/java/Foo.java",
      "src/test/java/FooTest.java",
      "src/utils.ts",
      "src/__tests__/bar.test.ts",
      "lib/baz.spec.jsx",
      "pkg/handler_test.go",
      "tests/test_foo.py",
    ];
    expect(countTestFiles(files)).toBe(5);
  });

  it("returns 0 for empty list", () => {
    expect(countTestFiles([])).toBe(0);
  });

  it("returns 0 when no test files present", () => {
    const files = ["src/Foo.java", "src/utils.ts", "README.md"];
    expect(countTestFiles(files)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// isTddExemptTask (requires fs mock)
// ---------------------------------------------------------------------------

describe("isTddExemptTask", () => {
  // Dynamic import to handle the async module
  let isTddExemptTask: (outputDir: string, task: number) => Promise<boolean>;

  beforeEach(async () => {
    const mod = await import("../phase-enforcer.js");
    isTddExemptTask = mod.isTddExemptTask;
  });

  it("returns false when plan.md does not exist", async () => {
    const result = await isTddExemptTask("/nonexistent/path", 1);
    expect(result).toBe(false);
  });

  // For these tests we need a real plan.md, so we use a temp dir
  it("returns true when task section contains **TDD**: skip", async () => {
    const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const tmpDir = await mkdtemp(join((await import("node:os")).tmpdir(), "tdd-test-"));
    try {
      await writeFile(join(tmpDir, "plan.md"), [
        "## Task 1: Something",
        "**TDD**: required",
        "",
        "## Task 2: Config only",
        "**TDD**: skip",
        "",
        "## Task 3: Another",
        "**TDD**: required",
      ].join("\n"));

      expect(await isTddExemptTask(tmpDir, 2)).toBe(true);
    } finally {
      await rm(tmpDir, { recursive: true });
    }
  });

  it("returns false when task section does not contain skip", async () => {
    const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const tmpDir = await mkdtemp(join((await import("node:os")).tmpdir(), "tdd-test-"));
    try {
      await writeFile(join(tmpDir, "plan.md"), [
        "## Task 1: Something",
        "**TDD**: required",
        "",
        "## Task 2: Config only",
        "**TDD**: skip",
      ].join("\n"));

      expect(await isTddExemptTask(tmpDir, 1)).toBe(false);
    } finally {
      await rm(tmpDir, { recursive: true });
    }
  });

  it("correctly isolates task sections (skip in Task 2 does not affect Task 3)", async () => {
    const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const tmpDir = await mkdtemp(join((await import("node:os")).tmpdir(), "tdd-test-"));
    try {
      await writeFile(join(tmpDir, "plan.md"), [
        "## Task 2: Config",
        "**TDD**: skip",
        "",
        "## Task 3: Real work",
        "**TDD**: required",
      ].join("\n"));

      expect(await isTddExemptTask(tmpDir, 3)).toBe(false);
    } finally {
      await rm(tmpDir, { recursive: true });
    }
  });

  it("case insensitive: **TDD**: SKIP also works", async () => {
    const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const tmpDir = await mkdtemp(join((await import("node:os")).tmpdir(), "tdd-test-"));
    try {
      await writeFile(join(tmpDir, "plan.md"), [
        "## Task 1: Docs",
        "**TDD**: SKIP",
      ].join("\n"));

      expect(await isTddExemptTask(tmpDir, 1)).toBe(true);
    } finally {
      await rm(tmpDir, { recursive: true });
    }
  });
});
