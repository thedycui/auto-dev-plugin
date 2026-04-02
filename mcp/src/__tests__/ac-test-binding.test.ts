/**
 * Tests for ac-test-binding.ts — AC test binding discovery and coverage validation.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  discoverAcBindings,
  validateAcBindingCoverage,
  buildTargetedTestCommand,
} from "../ac-test-binding.js";
import type { AcceptanceCriterion } from "../ac-schema.js";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "ac-binding-test-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// discoverAcBindings — Node.js
// ---------------------------------------------------------------------------

describe("discoverAcBindings - node", () => {
  it("should discover test() with [AC-N] annotation", async () => {
    await mkdir(join(tempDir, "__tests__"), { recursive: true });
    await writeFile(
      join(tempDir, "__tests__", "user.test.ts"),
      `
import { describe, test, expect } from "vitest";

test("[AC-1] should return 400 when list is empty", () => {
  expect(true).toBe(true);
});

test("[AC-2] should create user successfully", () => {
  expect(true).toBe(true);
});
`,
    );

    const bindings = await discoverAcBindings(tempDir, "node");
    expect(bindings).toHaveLength(2);
    expect(bindings[0]!.acId).toBe("AC-1");
    expect(bindings[0]!.testFile).toContain("user.test.ts");
    expect(bindings[1]!.acId).toBe("AC-2");
  });

  it("should discover describe() with AC-N: prefix", async () => {
    await mkdir(join(tempDir, "__tests__"), { recursive: true });
    await writeFile(
      join(tempDir, "__tests__", "api.test.ts"),
      `
describe("AC-3: validation logic", () => {
  it("validates input", () => {});
});
`,
    );

    const bindings = await discoverAcBindings(tempDir, "node");
    expect(bindings).toHaveLength(1);
    expect(bindings[0]!.acId).toBe("AC-3");
  });

  it("should discover it() with [AC-N] annotation", async () => {
    await mkdir(join(tempDir, "__tests__"), { recursive: true });
    await writeFile(
      join(tempDir, "__tests__", "service.spec.ts"),
      `
it("[AC-5] handles edge case", () => {});
`,
    );

    const bindings = await discoverAcBindings(tempDir, "node");
    expect(bindings).toHaveLength(1);
    expect(bindings[0]!.acId).toBe("AC-5");
  });
});

// ---------------------------------------------------------------------------
// discoverAcBindings — Java
// ---------------------------------------------------------------------------

describe("discoverAcBindings - java", () => {
  it("should discover @DisplayName with [AC-N]", async () => {
    await mkdir(join(tempDir, "src", "test", "java"), { recursive: true });
    await writeFile(
      join(tempDir, "src", "test", "java", "UserServiceTest.java"),
      `
@Test
@DisplayName("[AC-1] should return 400 for empty list")
void shouldReturn400WhenListIsEmpty() {}
`,
    );

    const bindings = await discoverAcBindings(tempDir, "java");
    expect(bindings).toHaveLength(1);
    expect(bindings[0]!.acId).toBe("AC-1");
  });

  it("should discover void ACN_ method pattern", async () => {
    await mkdir(join(tempDir, "src", "test", "java"), { recursive: true });
    await writeFile(
      join(tempDir, "src", "test", "java", "OrderTest.java"),
      `
@Test
void AC2_shouldCalculateTotal() {}
`,
    );

    const bindings = await discoverAcBindings(tempDir, "java");
    expect(bindings).toHaveLength(1);
    expect(bindings[0]!.acId).toBe("AC-2");
  });
});

// ---------------------------------------------------------------------------
// discoverAcBindings — Python
// ---------------------------------------------------------------------------

describe("discoverAcBindings - python", () => {
  it("should discover def test_acN_ pattern", async () => {
    await mkdir(join(tempDir, "tests"), { recursive: true });
    await writeFile(
      join(tempDir, "tests", "test_user.py"),
      `
def test_ac1_empty_list_returns_400():
    assert True

def test_ac3_creates_user():
    assert True
`,
    );

    const bindings = await discoverAcBindings(tempDir, "python");
    expect(bindings).toHaveLength(2);
    expect(bindings[0]!.acId).toBe("AC-1");
    expect(bindings[1]!.acId).toBe("AC-3");
  });

  it("should discover @pytest.mark.ac pattern", async () => {
    await mkdir(join(tempDir, "tests"), { recursive: true });
    await writeFile(
      join(tempDir, "tests", "test_order.py"),
      `
@pytest.mark.ac("AC-2")
def test_order_total():
    assert True
`,
    );

    const bindings = await discoverAcBindings(tempDir, "python");
    expect(bindings).toHaveLength(1);
    expect(bindings[0]!.acId).toBe("AC-2");
  });
});

// ---------------------------------------------------------------------------
// validateAcBindingCoverage
// ---------------------------------------------------------------------------

describe("validateAcBindingCoverage", () => {
  it("should report covered, missing, and extra bindings", () => {
    const criteria: AcceptanceCriterion[] = [
      { id: "AC-1", description: "test", layer: "test-bound" },
      { id: "AC-2", description: "test", layer: "test-bound" },
      { id: "AC-3", description: "test", layer: "structural" },
      { id: "AC-4", description: "test", layer: "manual" },
    ];
    const bindings = [
      { acId: "AC-1", testFile: "test.ts", testName: "test1", language: "node" },
      { acId: "AC-99", testFile: "test.ts", testName: "extra", language: "node" },
    ];

    const result = validateAcBindingCoverage(criteria, bindings);
    expect(result.covered).toEqual(["AC-1"]);
    expect(result.missing).toEqual(["AC-2"]);
    expect(result.extraBindings).toEqual(["AC-99"]);
  });

  it("should return empty missing when all test-bound ACs are covered", () => {
    const criteria: AcceptanceCriterion[] = [
      { id: "AC-1", description: "test", layer: "test-bound" },
    ];
    const bindings = [
      { acId: "AC-1", testFile: "test.ts", testName: "test1", language: "node" },
    ];

    const result = validateAcBindingCoverage(criteria, bindings);
    expect(result.covered).toEqual(["AC-1"]);
    expect(result.missing).toEqual([]);
    expect(result.extraBindings).toEqual([]);
  });

  it("should handle no test-bound ACs", () => {
    const criteria: AcceptanceCriterion[] = [
      { id: "AC-1", description: "test", layer: "structural" },
      { id: "AC-2", description: "test", layer: "manual" },
    ];
    const result = validateAcBindingCoverage(criteria, []);
    expect(result.covered).toEqual([]);
    expect(result.missing).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// buildTargetedTestCommand
// ---------------------------------------------------------------------------

describe("buildTargetedTestCommand", () => {
  it("should generate vitest command for node", () => {
    const bindings = [
      { acId: "AC-1", testFile: "__tests__/user.test.ts", testName: "should return 400", language: "node" },
    ];
    const cmd = buildTargetedTestCommand("node", "__tests__/user.test.ts", bindings, "/project");
    expect(cmd).toContain("npx vitest run");
    expect(cmd).toContain("__tests__/user.test.ts");
    expect(cmd).toContain("-t");
  });

  it("should generate maven command for java", () => {
    const bindings = [
      { acId: "AC-1", testFile: "src/test/java/UserServiceTest.java", testName: "shouldReturn400", language: "java" },
    ];
    const cmd = buildTargetedTestCommand("java", "src/test/java/UserServiceTest.java", bindings, "/project");
    expect(cmd).toContain("mvn test");
    expect(cmd).toContain("-Dtest=UserServiceTest#shouldReturn400");
  });

  it("should generate pytest command for python", () => {
    const bindings = [
      { acId: "AC-1", testFile: "tests/test_user.py", testName: "test_ac1_empty_list", language: "python" },
    ];
    const cmd = buildTargetedTestCommand("python", "tests/test_user.py", bindings, "/project");
    expect(cmd).toContain("pytest");
    expect(cmd).toContain("-k");
    expect(cmd).toContain("test_ac1_empty_list");
  });

  // TC-B-09: unknown language fallback
  it("TC-B-09: should return fallback command for unknown language", () => {
    const bindings = [
      { acId: "AC-1", testFile: "tests/test_main.rs", testName: "test1", language: "rust" },
    ];
    const cmd = buildTargetedTestCommand("rust", "tests/test_main.rs", bindings, "/project");
    expect(cmd).toBe("cd /project && tests/test_main.rs");
  });
});

// TC-B-08: unsupported language in discoverAcBindings
describe("boundary: unsupported language", () => {
  it("TC-B-08: should return empty array for unsupported language", async () => {
    const bindings = await discoverAcBindings(tempDir, "go");
    expect(bindings).toEqual([]);
  });
});

// TC-B-12: runAcBoundTests with empty bindings
describe("boundary: runAcBoundTests empty bindings", () => {
  it("TC-B-12: should return empty Map for empty bindings array", async () => {
    const { runAcBoundTests } = await import("../ac-test-binding.js");
    const results = await runAcBoundTests([], tempDir, "node", "npx vitest run");
    expect(results.size).toBe(0);
  });
});

// TC-B-14: discoverAcBindings with nonexistent project root
describe("boundary: nonexistent project root", () => {
  it("TC-B-14: should return empty array for nonexistent path", async () => {
    const bindings = await discoverAcBindings("/nonexistent/path/that/does/not/exist", "node");
    expect(bindings).toEqual([]);
  });
});

// TC-B-18: validateAcBindingCoverage with duplicate bindings for same AC
describe("boundary: duplicate bindings for same AC", () => {
  it("TC-B-18: should not count duplicate AC-id bindings multiple times", () => {
    const criteria = [
      { id: "AC-1", description: "test", layer: "test-bound" as const },
    ];
    const bindings = [
      { acId: "AC-1", testFile: "a.test.ts", testName: "test1", language: "node" },
      { acId: "AC-1", testFile: "b.test.ts", testName: "test2", language: "node" },
    ];
    const result = validateAcBindingCoverage(criteria, bindings);
    expect(result.covered).toEqual(["AC-1"]);
    expect(result.missing).toEqual([]);
    expect(result.extraBindings).toEqual([]);
  });
});
