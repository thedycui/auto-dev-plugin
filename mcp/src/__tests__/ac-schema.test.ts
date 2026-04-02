/**
 * Tests for ac-schema.ts — Zod schema validation and hash computation.
 */

import { describe, it, expect } from "vitest";
import { AcceptanceCriteriaSchema, computeAcHash } from "../ac-schema.js";
import { validateAcJson } from "../phase-enforcer.js";

describe("AcceptanceCriteriaSchema", () => {
  it("should parse valid AC JSON with all layers", () => {
    const input = {
      version: 1,
      criteria: [
        {
          id: "AC-1",
          description: "Empty list returns 400",
          layer: "test-bound",
        },
        {
          id: "AC-2",
          description: "Config file has max-retry = 3",
          layer: "structural",
          structuralAssertions: [
            { type: "file_exists", path: "src/config.json" },
            { type: "file_contains", path: "src/config.json", pattern: "max-retry" },
          ],
        },
        {
          id: "AC-3",
          description: "Code style consistency",
          layer: "manual",
        },
      ],
    };

    const result = AcceptanceCriteriaSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.criteria).toHaveLength(3);
      expect(result.data.criteria[0]!.layer).toBe("test-bound");
      expect(result.data.criteria[1]!.structuralAssertions).toHaveLength(2);
    }
  });

  it("should parse all 7 assertion types", () => {
    const input = {
      version: 1,
      criteria: [
        {
          id: "AC-1",
          description: "All assertion types",
          layer: "structural" as const,
          structuralAssertions: [
            { type: "file_exists", path: "a.txt" },
            { type: "file_not_exists", path: "b.txt" },
            { type: "file_contains", path: "c.txt", pattern: "hello" },
            { type: "file_not_contains", path: "d.txt", pattern: "world" },
            { type: "config_value", path: "e.json", key: "foo.bar", expectedValue: "42" },
            { type: "build_succeeds" },
            { type: "test_passes", testFile: "test.ts", testName: "myTest" },
          ],
        },
      ],
    };

    const result = AcceptanceCriteriaSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.criteria[0]!.structuralAssertions).toHaveLength(7);
    }
  });

  it("should reject missing required fields", () => {
    // Missing description
    const input = {
      version: 1,
      criteria: [
        { id: "AC-1", layer: "manual" },
      ],
    };

    const result = AcceptanceCriteriaSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it("should reject invalid layer value", () => {
    const input = {
      version: 1,
      criteria: [
        { id: "AC-1", description: "test", layer: "invalid-layer" },
      ],
    };

    const result = AcceptanceCriteriaSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it("should reject invalid assertion type", () => {
    const input = {
      version: 1,
      criteria: [
        {
          id: "AC-1",
          description: "test",
          layer: "structural",
          structuralAssertions: [
            { type: "shell_command", command: "rm -rf /" },
          ],
        },
      ],
    };

    const result = AcceptanceCriteriaSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it("should accept null structuralAssertions", () => {
    const input = {
      version: 1,
      criteria: [
        { id: "AC-1", description: "test", layer: "test-bound", structuralAssertions: null },
      ],
    };

    const result = AcceptanceCriteriaSchema.safeParse(input);
    expect(result.success).toBe(true);
  });

  it("should accept missing structuralAssertions (optional)", () => {
    const input = {
      version: 1,
      criteria: [
        { id: "AC-1", description: "test", layer: "manual" },
      ],
    };

    const result = AcceptanceCriteriaSchema.safeParse(input);
    expect(result.success).toBe(true);
  });
});

describe("computeAcHash", () => {
  it("should produce a 32-char hex string", () => {
    const criteria = [
      { id: "AC-1", description: "test", layer: "manual" as const },
    ];
    const hash = computeAcHash(criteria);
    expect(hash).toMatch(/^[a-f0-9]{32}$/);
  });

  it("should produce stable output for same input", () => {
    const criteria = [
      { id: "AC-1", description: "test", layer: "structural" as const, structuralAssertions: [{ type: "file_exists" as const, path: "a.txt" }] },
      { id: "AC-2", description: "test2", layer: "manual" as const },
    ];
    const hash1 = computeAcHash(criteria);
    const hash2 = computeAcHash(criteria);
    expect(hash1).toBe(hash2);
  });

  it("should produce different output for different input", () => {
    const criteria1 = [
      { id: "AC-1", description: "test", layer: "manual" as const },
    ];
    const criteria2 = [
      { id: "AC-1", description: "test", layer: "structural" as const },
    ];
    const hash1 = computeAcHash(criteria1);
    const hash2 = computeAcHash(criteria2);
    expect(hash1).not.toBe(hash2);
  });

  it("should not include description in hash (only id, layer, structuralAssertions)", () => {
    const criteria1 = [
      { id: "AC-1", description: "description A", layer: "manual" as const },
    ];
    const criteria2 = [
      { id: "AC-1", description: "description B", layer: "manual" as const },
    ];
    const hash1 = computeAcHash(criteria1);
    const hash2 = computeAcHash(criteria2);
    expect(hash1).toBe(hash2);
  });

  // TC-B-10: duplicate AC-id hash stability
  it("should produce stable hash for duplicate AC ids", () => {
    const criteria = [
      { id: "AC-1", description: "a", layer: "manual" as const },
      { id: "AC-1", description: "b", layer: "manual" as const },
    ];
    const hash1 = computeAcHash(criteria);
    const hash2 = computeAcHash(criteria);
    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[a-f0-9]{32}$/);
  });
});

// TC-B-03: empty criteria array
describe("validateAcJson edge cases", () => {
  it("TC-B-03: should handle empty criteria array without divide-by-zero", () => {

    const input = JSON.stringify({ version: 1, criteria: [] });
    const result = validateAcJson(input);
    expect(result.valid).toBe(true);
    expect(result.stats!.total).toBe(0);
    expect(result.hash).toMatch(/^[a-f0-9]{32}$/);
  });

  // TC-B-15: manual ratio exactly 40%
  it("TC-B-15: should accept manual ratio at exactly 40%", () => {

    const criteria = [
      { id: "AC-1", description: "s1", layer: "structural", structuralAssertions: [{ type: "file_exists", path: "a.txt" }] },
      { id: "AC-2", description: "s2", layer: "structural", structuralAssertions: [{ type: "file_exists", path: "b.txt" }] },
      { id: "AC-3", description: "t1", layer: "test-bound" },
      { id: "AC-4", description: "m1", layer: "manual" },
      { id: "AC-5", description: "m2", layer: "manual" },
    ];
    const input = JSON.stringify({ version: 1, criteria });
    const result = validateAcJson(input);
    expect(result.valid).toBe(true);
  });

  // TC-B-16: manual ratio just over 40%
  it("TC-B-16: should reject manual ratio over 40%", () => {

    const criteria = [
      { id: "AC-1", description: "s1", layer: "structural", structuralAssertions: [{ type: "file_exists", path: "a.txt" }] },
      { id: "AC-2", description: "s2", layer: "structural", structuralAssertions: [{ type: "file_exists", path: "b.txt" }] },
      { id: "AC-3", description: "m1", layer: "manual" },
      { id: "AC-4", description: "m2", layer: "manual" },
      { id: "AC-5", description: "m3", layer: "manual" },
    ];
    const input = JSON.stringify({ version: 1, criteria });
    const result = validateAcJson(input);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("exceeds 40%");
  });
});
