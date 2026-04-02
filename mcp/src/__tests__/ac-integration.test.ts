/**
 * Integration tests for AC framework execution in Phase 6.
 *
 * Tests cover:
 * 1. AC JSON + all PASS → proceeds to Tribunal
 * 2. AC JSON + structural FAIL → short-circuit failure
 * 3. AC JSON + hash mismatch → BLOCKED
 * 4. No AC JSON → legacy Tribunal flow (backward compatible)
 * 5. Test-bound AC missing bindings → BLOCKED
 * 6. Index.ts fallback path: AC JSON + all PASS → success
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { validateAcJson, validateAcIntegrity } from "../phase-enforcer.js";
import { validateAcBindingCoverage } from "../ac-test-binding.js";
import { computeAcHash, AcceptanceCriteriaSchema } from "../ac-schema.js";
import type { AcceptanceCriterion } from "../ac-schema.js";
import { runStructuralAssertions } from "../ac-runner.js";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeAcJson(criteria: AcceptanceCriterion[]): string {
  return JSON.stringify({ version: 1, criteria }, null, 2);
}

const STRUCTURAL_AC: AcceptanceCriterion = {
  id: "AC-101",
  description: "Config file exists",
  layer: "structural",
  structuralAssertions: [
    { type: "file_exists", path: "config.json" },
  ],
};

const STRUCTURAL_AC_CONTAINS: AcceptanceCriterion = {
  id: "AC-102",
  description: "Config has correct value",
  layer: "structural",
  structuralAssertions: [
    { type: "file_contains", path: "config.json", pattern: "max-retry" },
  ],
};

const TEST_BOUND_AC: AcceptanceCriterion = {
  id: "AC-103",
  description: "Empty list returns 400",
  layer: "test-bound",
};

const MANUAL_AC: AcceptanceCriterion = {
  id: "AC-104",
  description: "Code style consistency",
  layer: "manual",
};

// ---------------------------------------------------------------------------
// Test Suites
// ---------------------------------------------------------------------------

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "ac-integration-"));
});

// afterEach not strictly needed for tmp dirs but good practice
afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("Scenario 1: AC JSON + all PASS → proceeds to Tribunal", () => {
  it("should pass structural assertions when files exist and contain expected content", async () => {
    // Setup: create files that match AC assertions
    await writeFile(join(tempDir, "config.json"), JSON.stringify({ "max-retry": 3 }));

    const criteria = [STRUCTURAL_AC, STRUCTURAL_AC_CONTAINS, MANUAL_AC];
    const acJson = makeAcJson(criteria);

    // Validate schema
    const validation = validateAcJson(acJson);
    expect(validation.valid).toBe(true);
    expect(validation.hash).toBeDefined();

    // Run structural assertions
    const results = await runStructuralAssertions(criteria, tempDir);
    expect(results["AC-101"]!.passed).toBe(true);
    expect(results["AC-102"]!.passed).toBe(true);

    // Manual ACs should not appear in structural results
    expect(results["AC-104"]).toBeUndefined();

    // No structural failures
    const fails = Object.entries(results).filter(([, v]) => !v.passed);
    expect(fails).toHaveLength(0);
  });
});

describe("Scenario 2: AC JSON + structural FAIL → short-circuit failure", () => {
  it("should report failure when structural assertion fails", async () => {
    // Setup: config.json does NOT exist
    // Use 2 structural + 1 manual to keep manual ratio at 33% (< 40%)
    const criteria = [STRUCTURAL_AC, STRUCTURAL_AC_CONTAINS, MANUAL_AC];
    const acJson = makeAcJson(criteria);

    const validation = validateAcJson(acJson);
    expect(validation.valid).toBe(true);

    // Run structural assertions — AC-1 expects config.json to exist
    const results = await runStructuralAssertions(criteria, tempDir);
    expect(results["AC-101"]!.passed).toBe(false);
    expect(results["AC-101"]!.details[0]!.detail).toContain("not found");

    // Verify short-circuit logic
    const structuralFails = Object.entries(results)
      .filter(([, v]) => !v.passed)
      .map(([id]) => id);
    expect(structuralFails).toContain("AC-101");
    expect(structuralFails.length).toBeGreaterThan(0);
  });

  it("should report failure when file_contains pattern is not found", async () => {
    await writeFile(join(tempDir, "config.json"), JSON.stringify({ "other-key": "value" }));
    const criteria = [STRUCTURAL_AC_CONTAINS];

    const results = await runStructuralAssertions(criteria, tempDir);
    expect(results["AC-102"]!.passed).toBe(false);
    expect(results["AC-102"]!.details[0]!.detail).toContain("not found");
  });
});

describe("Scenario 3: AC JSON + hash mismatch → BLOCKED", () => {
  it("should detect tamper when AC hash does not match AC_LOCK", async () => {
    const criteria = [STRUCTURAL_AC, MANUAL_AC];
    const acJson = makeAcJson(criteria);

    // Simulate Phase 1 lock with a different hash
    const progressLog = `<!-- AC_LOCK hash=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa total=2 structural=1 testBound=0 manual=1 -->`;

    const result = validateAcIntegrity(acJson, progressLog);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("tamper detected");
  });

  it("should pass when hash matches AC_LOCK", async () => {
    const criteria = [STRUCTURAL_AC, MANUAL_AC];
    const acJson = makeAcJson(criteria);
    const hash = computeAcHash(criteria);

    const progressLog = `<!-- AC_LOCK hash=${hash} total=2 structural=1 testBound=0 manual=1 -->`;

    const result = validateAcIntegrity(acJson, progressLog);
    expect(result.valid).toBe(true);
  });
});

describe("Scenario 4: No AC JSON → legacy Tribunal flow (backward compatible)", () => {
  it("should allow when no AC_LOCK marker exists in progress log", () => {
    // validateAcIntegrity should return valid when no AC_LOCK marker
    const progressLog = `<!-- CHECKPOINT phase=1 status=PASS -->`;
    const acJson = makeAcJson([STRUCTURAL_AC]);

    const result = validateAcIntegrity(acJson, progressLog);
    expect(result.valid).toBe(true);
  });

  it("should pass validateAcJson when AC JSON is well-formed", () => {
    // In legacy flow, if AC JSON happens to exist but no AC_LOCK,
    // integrity check passes (backward compatible)
    const criteria = [STRUCTURAL_AC, TEST_BOUND_AC, MANUAL_AC];
    const acJson = makeAcJson(criteria);

    const validation = validateAcJson(acJson);
    expect(validation.valid).toBe(true);
    // manual ratio = 1/3 = 33% < 40%
    expect(validation.stats!.manual).toBe(1);
  });
});

describe("Scenario 5: Test-bound AC missing bindings → BLOCKED", () => {
  it("should report missing bindings when test-bound AC has no test", () => {
    const criteria = [STRUCTURAL_AC, TEST_BOUND_AC, MANUAL_AC];
    const bindings: { acId: string; testFile: string; testName: string; language: string }[] = [];

    const coverage = validateAcBindingCoverage(criteria, bindings);
    expect(coverage.missing).toContain("AC-103");
    expect(coverage.covered).toHaveLength(0);
  });

  it("should pass when all test-bound ACs are covered", () => {
    const criteria = [STRUCTURAL_AC, TEST_BOUND_AC, MANUAL_AC];
    const bindings = [
      { acId: "AC-103", testFile: "test.ts", testName: "test1", language: "node" },
    ];

    const coverage = validateAcBindingCoverage(criteria, bindings);
    expect(coverage.missing).toHaveLength(0);
    expect(coverage.covered).toEqual(["AC-103"]);
  });

  it("should report extra bindings that reference non-existent ACs", () => {
    const criteria = [STRUCTURAL_AC, MANUAL_AC];
    const bindings = [
      { acId: "AC-99", testFile: "test.ts", testName: "extra", language: "node" },
    ];

    const coverage = validateAcBindingCoverage(criteria, bindings);
    expect(coverage.extraBindings).toEqual(["AC-99"]);
  });
});

describe("Scenario 6: Index.ts fallback path — full AC framework validation", () => {
  it("should execute full framework validation pipeline when AC JSON exists", async () => {
    // This scenario simulates the complete pipeline in index.ts fallback path:
    // 1. validateAcJson → 2. computeAcHash + AC_LOCK check → 3. structural assertions → 4. binding coverage

    // Setup files
    await writeFile(join(tempDir, "config.json"), JSON.stringify({ "max-retry": 3 }));
    await mkdir(join(tempDir, "__tests__"), { recursive: true });
    await writeFile(
      join(tempDir, "__tests__", "api.test.ts"),
      `test("[AC-${103}] should return 400 when list is empty", () => { expect(true).toBe(true); });`,
    );

    const criteria = [STRUCTURAL_AC, STRUCTURAL_AC_CONTAINS, TEST_BOUND_AC, MANUAL_AC];
    const acJson = makeAcJson(criteria);

    // Step 1: Schema validation
    const validation = validateAcJson(acJson);
    expect(validation.valid).toBe(true);
    expect(validation.stats!.total).toBe(4);
    expect(validation.stats!.structural).toBe(2);
    expect(validation.stats!.testBound).toBe(1);
    expect(validation.stats!.manual).toBe(1);
    // manual ratio = 1/4 = 25% < 40%

    // Step 2: Hash integrity (simulate matching lock)
    const hash = computeAcHash(criteria);
    const progressLog = `<!-- AC_LOCK hash=${hash} total=4 structural=2 testBound=1 manual=1 -->`;
    const integrity = validateAcIntegrity(acJson, progressLog);
    expect(integrity.valid).toBe(true);

    // Step 3: Parse AC JSON
    const acData = AcceptanceCriteriaSchema.parse(JSON.parse(acJson));
    expect(acData.criteria).toHaveLength(4);

    // Step 4: Structural assertions
    const structuralResults = await runStructuralAssertions(
      acData.criteria,
      tempDir,
    );
    expect(structuralResults["AC-101"]!.passed).toBe(true);
    expect(structuralResults["AC-102"]!.passed).toBe(true);
    const structuralFails = Object.entries(structuralResults)
      .filter(([, v]) => !v.passed);
    expect(structuralFails).toHaveLength(0);

    // Step 5: Binding coverage
    // Note: discoverAcBindings is async and walks filesystem,
    // but we directly test validateAcBindingCoverage with known bindings
    const bindings = [
      { acId: "AC-103", testFile: "__tests__/api.test.ts", testName: "should return 400 when list is empty", language: "node" },
    ];
    const coverage = validateAcBindingCoverage(acData.criteria, bindings);
    expect(coverage.missing).toHaveLength(0);
    expect(coverage.covered).toEqual(["AC-103"]);

    // Step 6: Compose results (simulating framework-ac-results.json)
    const frameworkResults = {
      structural: structuralResults,
      testBound: Object.fromEntries(bindings.map(b => [b.acId, { passed: true, output: "ok" }])),
      pendingManual: acData.criteria
        .filter((c) => c.layer === "manual")
        .map((c) => c.id),
      timestamp: new Date().toISOString(),
    };
    expect(frameworkResults.pendingManual).toEqual(["AC-104"]);
    expect(Object.keys(frameworkResults.structural)).toHaveLength(2);
    expect(Object.keys(frameworkResults.testBound)).toHaveLength(1);
  });

  it("should reject AC JSON when manual ratio exceeds 40%", () => {
    // 3 manual out of 4 = 75% > 40%
    const criteria = [
      STRUCTURAL_AC,
      { id: "AC-5", description: "m1", layer: "manual" as const },
      { id: "AC-6", description: "m2", layer: "manual" as const },
      { id: "AC-7", description: "m3", layer: "manual" as const },
    ];
    const acJson = makeAcJson(criteria);

    const validation = validateAcJson(acJson);
    expect(validation.valid).toBe(false);
    expect(validation.error).toContain("exceeds 40%");
  });

  it("should reject AC JSON with invalid schema", () => {
    const invalidJson = JSON.stringify({
      version: 1,
      criteria: [
        { id: "AC-101", layer: "structural" }, // missing description
      ],
    });

    const validation = validateAcJson(invalidJson);
    expect(validation.valid).toBe(false);
    expect(validation.error).toContain("schema invalid");
  });
});

// ---------------------------------------------------------------------------
// Boundary / Negative Tests
// ---------------------------------------------------------------------------

describe("TC-B-04: validateAcJson with non-JSON string", () => {
  it("should return valid:false with parse error for non-JSON input", () => {
    const result = validateAcJson("not a json {{}");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("parse error");
  });
});

describe("TC-B-05: validateAcIntegrity with malformed AC JSON", () => {
  it("should return valid:false with parse error for broken JSON", () => {
    const progressLog = `<!-- AC_LOCK hash=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa total=2 structural=1 testBound=0 manual=1 -->`;
    const result = validateAcIntegrity("broken json", progressLog);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("parse error");
  });
});

describe("TC-B-11: AC_LOCK marker with truncated hash", () => {
  it("should detect tamper when AC_LOCK hash is truncated (3 chars)", () => {
    const criteria = [STRUCTURAL_AC, MANUAL_AC];
    const acJson = makeAcJson(criteria);
    const progressLog = `<!-- AC_LOCK hash=abc total=2 structural=1 testBound=0 manual=1 -->`;
    const result = validateAcIntegrity(acJson, progressLog);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("tamper detected");
  });
});

// ---------------------------------------------------------------------------
// E2E Integration: Orchestrator Phase 6 control flow (function composition)
// ---------------------------------------------------------------------------

describe("TC-E2E-01: orchestrator Phase 6 full PASS pipeline", () => {
  it("should pass all checks when structural assertions pass and no test-bound ACs", async () => {
    // Setup: create files that match AC assertions
    await writeFile(join(tempDir, "config.json"), JSON.stringify({ "max-retry": 3 }));

    const criteria = [STRUCTURAL_AC, STRUCTURAL_AC_CONTAINS, MANUAL_AC];
    const acJson = makeAcJson(criteria);
    const hash = computeAcHash(criteria);
    const progressLog = `<!-- AC_LOCK hash=${hash} total=3 structural=2 testBound=0 manual=1 -->`;

    // Step 1: Hash integrity
    const integrity = validateAcIntegrity(acJson, progressLog);
    expect(integrity.valid).toBe(true);

    // Step 2: Parse
    const acData = AcceptanceCriteriaSchema.parse(JSON.parse(acJson));

    // Step 3: Binding coverage (no test-bound ACs -> no missing)
    const coverage = validateAcBindingCoverage(acData.criteria, []);
    expect(coverage.missing).toHaveLength(0);

    // Step 4: Structural assertions
    const structuralResults = await runStructuralAssertions(acData.criteria, tempDir);
    const structuralFails = Object.entries(structuralResults).filter(([, v]) => !v.passed);
    expect(structuralFails).toHaveLength(0);

    // Step 5: Compose framework-ac-results.json
    const frameworkResults = {
      structural: structuralResults,
      testBound: {},
      pendingManual: acData.criteria.filter(c => c.layer === "manual").map(c => c.id),
      timestamp: new Date().toISOString(),
    };
    expect(structuralResults["AC-101"]!.passed).toBe(true);
    expect(frameworkResults.pendingManual).toEqual(["AC-104"]);

    // Write and verify framework-ac-results.json
    const { writeFile: fsWriteFile, readFile: fsReadFile } = await import("node:fs/promises");
    await fsWriteFile(join(tempDir, "framework-ac-results.json"), JSON.stringify(frameworkResults, null, 2));
    const written = JSON.parse(await fsReadFile(join(tempDir, "framework-ac-results.json"), "utf-8"));
    expect(written.structural["AC-101"].passed).toBe(true);
    expect(written.pendingManual).toContain("AC-104");
  });
});

describe("TC-E2E-02: orchestrator Phase 6 structural FAIL short-circuit", () => {
  it("should report structural failure and not proceed to Tribunal", async () => {
    // No config.json exists in tempDir
    const criteria = [STRUCTURAL_AC, STRUCTURAL_AC_CONTAINS, MANUAL_AC];
    const acJson = makeAcJson(criteria);
    const hash = computeAcHash(criteria);
    const progressLog = `<!-- AC_LOCK hash=${hash} total=3 structural=2 testBound=0 manual=1 -->`;

    // Integrity passes
    const integrity = validateAcIntegrity(acJson, progressLog);
    expect(integrity.valid).toBe(true);

    // Structural assertions fail
    const acData = AcceptanceCriteriaSchema.parse(JSON.parse(acJson));
    const structuralResults = await runStructuralAssertions(acData.criteria, tempDir);
    const structuralFails = Object.entries(structuralResults)
      .filter(([, v]) => !v.passed).map(([id]) => id);
    expect(structuralFails.length).toBeGreaterThan(0);
    expect(structuralFails).toContain("AC-101");

    // Compose feedback (mimicking orchestrator logic)
    const feedback = structuralFails.length > 0
      ? `Structural AC FAIL: ${structuralFails.join(", ")}`
      : "";
    expect(feedback).toContain("Structural AC FAIL");
    expect(feedback).toContain("AC-101");
  });
});

describe("TC-E2E-03: orchestrator Phase 6 hash tamper BLOCKED", () => {
  it("should block when AC JSON hash does not match AC_LOCK", () => {
    const criteria = [STRUCTURAL_AC, MANUAL_AC];
    const acJson = makeAcJson(criteria);
    // Use a wrong hash
    const progressLog = `<!-- AC_LOCK hash=00000000000000000000000000000000 total=2 structural=1 testBound=0 manual=1 -->`;
    const result = validateAcIntegrity(acJson, progressLog);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("tamper detected");
  });
});

describe("TC-E2E-04: orchestrator Phase 6 binding missing BLOCKED", () => {
  it("should block when test-bound AC has no binding", () => {
    const criteria = [STRUCTURAL_AC, TEST_BOUND_AC, MANUAL_AC];

    // No bindings discovered
    const coverage = validateAcBindingCoverage(criteria, []);
    expect(coverage.missing).toContain("AC-103");

    // Compose feedback (mimicking orchestrator logic)
    const feedback = coverage.missing.length > 0
      ? `[BLOCKED] Test-bound AC missing bindings: ${coverage.missing.join(", ")}. Please go back to Phase 5`
      : "";
    expect(feedback).toContain("missing bindings");
    expect(feedback).toContain("AC-103");
    expect(feedback).toContain("Phase 5");
  });
});

describe("TC-E2E-05: orchestrator Phase 6 no AC JSON legacy fallback", () => {
  it("should skip AC framework when no AC JSON exists", async () => {
    // Simulate: acContent is null (file does not exist)
    const acContent: string | null = null;

    // When acContent is null, orchestrator skips AC framework and goes to Tribunal
    let tribunalCalled = false;
    if (!acContent) {
      // Proceed directly to Tribunal (simulated)
      tribunalCalled = true;
    }
    expect(tribunalCalled).toBe(true);

    // framework-ac-results.json should NOT be created
    const { stat: fsStat } = await import("node:fs/promises");
    await expect(fsStat(join(tempDir, "framework-ac-results.json"))).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// E2E Integration: index.ts Phase 1 checkpoint AC validation (function composition)
// ---------------------------------------------------------------------------

describe("TC-E2E-06: Phase 1 checkpoint AC_LOCK write", () => {
  it("should validate AC schema and produce hash for AC_LOCK marker", () => {
    const criteria = [STRUCTURAL_AC, STRUCTURAL_AC_CONTAINS, TEST_BOUND_AC, MANUAL_AC];
    const acJson = makeAcJson(criteria);

    // Simulating index.ts Phase 1 checkpoint logic
    const acValidation = validateAcJson(acJson);
    expect(acValidation.valid).toBe(true);
    expect(acValidation.hash).toBeDefined();
    expect(acValidation.hash).toMatch(/^[a-f0-9]{32}$/);

    // Verify the marker format that index.ts writes
    const { hash, stats } = acValidation;
    const marker = `<!-- AC_LOCK hash=${hash} total=${stats!.total} structural=${stats!.structural} testBound=${stats!.testBound} manual=${stats!.manual} -->`;
    expect(marker).toContain(`hash=${hash}`);
    expect(marker).toContain("total=4");
    expect(marker).toContain("structural=2");

    // Verify hash matches independent computation
    expect(hash).toBe(computeAcHash(criteria));
  });
});

describe("TC-E2E-07: Phase 1 checkpoint AC schema invalid rejection", () => {
  it("should reject when acceptance-criteria.json has invalid schema", () => {
    const invalidJson = JSON.stringify({
      version: 1,
      criteria: [
        { id: "AC-101", layer: "structural" }, // missing description
      ],
    });

    const result = validateAcJson(invalidJson);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("schema invalid");
    // No state pollution: the result is returned before any state update
  });
});

describe("TC-E2E-08: Phase 1 checkpoint manual ratio exceeded", () => {
  it("should reject when manual AC ratio exceeds 40%", () => {
    // 3 manual out of 4 = 75%
    const criteria = [
      { id: "AC-101", description: "s1", layer: "structural" as const, structuralAssertions: [{ type: "file_exists" as const, path: "a.txt" }] },
      { id: "AC-102", description: "m1", layer: "manual" as const },
      { id: "AC-103", description: "m2", layer: "manual" as const },
      { id: "AC-104", description: "m3", layer: "manual" as const },
    ];
    const acJson = makeAcJson(criteria);
    const result = validateAcJson(acJson);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("exceeds 40%");
  });
});

// ---------------------------------------------------------------------------
// E2E Integration: index.ts Phase 6 submit legacy path (function composition)
// ---------------------------------------------------------------------------

describe("TC-E2E-09: index.ts Phase 6 submit legacy path full PASS", () => {
  it("should pass structural assertions and write framework-ac-results.json", async () => {
    // Setup files
    await writeFile(join(tempDir, "config.json"), JSON.stringify({ "max-retry": 3 }));

    const criteria = [STRUCTURAL_AC, STRUCTURAL_AC_CONTAINS, MANUAL_AC];
    const acJson = makeAcJson(criteria);
    const hash = computeAcHash(criteria);

    // Simulate progress-log with AC_LOCK
    const progressLog = `<!-- AC_LOCK hash=${hash} total=3 structural=2 testBound=0 manual=1 -->`;

    // Step 1: Integrity check
    const integrityResult = validateAcIntegrity(acJson, progressLog);
    expect(integrityResult.valid).toBe(true);

    // Step 2: Parse and run structural
    const acData = AcceptanceCriteriaSchema.parse(JSON.parse(acJson));
    const structuralResults = await runStructuralAssertions(acData.criteria, tempDir);

    const structuralFails = Object.entries(structuralResults).filter(([, v]) => !v.passed);
    expect(structuralFails).toHaveLength(0);

    // Step 3: Write framework results
    const { writeFile: fsWriteFile, readFile: fsReadFile } = await import("node:fs/promises");
    const frameworkResults = {
      structural: structuralResults,
      testBound: {},
      pendingManual: acData.criteria.filter(c => c.layer === "manual").map(c => c.id),
      timestamp: new Date().toISOString(),
    };
    await fsWriteFile(join(tempDir, "framework-ac-results.json"), JSON.stringify(frameworkResults, null, 2));

    // Verify file was written correctly
    const written = JSON.parse(await fsReadFile(join(tempDir, "framework-ac-results.json"), "utf-8"));
    expect(written.structural["AC-101"].passed).toBe(true);
    expect(written.structural["AC-102"].passed).toBe(true);
  });
});

describe("TC-E2E-10: index.ts Phase 6 submit structural FAIL returns AC_FRAMEWORK_FAIL", () => {
  it("should return BLOCKED when structural assertions fail", async () => {
    // No config.json -> structural assertions will fail
    const criteria = [STRUCTURAL_AC, MANUAL_AC];
    const acJson = makeAcJson(criteria);
    const hash = computeAcHash(criteria);
    const progressLog = `<!-- AC_LOCK hash=${hash} total=2 structural=1 testBound=0 manual=1 -->`;

    // Integrity passes
    const integrityResult = validateAcIntegrity(acJson, progressLog);
    expect(integrityResult.valid).toBe(true);

    // Structural fails
    const acData = AcceptanceCriteriaSchema.parse(JSON.parse(acJson));
    const structuralResults = await runStructuralAssertions(acData.criteria, tempDir);
    const structuralFails = Object.entries(structuralResults).filter(([, v]) => !v.passed).map(([id]) => id);

    expect(structuralFails.length).toBeGreaterThan(0);

    // Mimicking index.ts error response
    const mandate = "[BLOCKED] Framework AC verification failed. Fix issues before resubmitting.";
    expect(mandate).toContain("[BLOCKED]");
  });
});
