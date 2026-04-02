/**
 * AC Schema — Zod schema definitions for acceptance-criteria.json
 * and hash computation for tamper detection.
 */

import { z } from "zod/v4";
import { createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// Assertion Type Schema (discriminated union)
// ---------------------------------------------------------------------------

export const AssertionTypeSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("file_exists"),
    path: z.string(),
  }),
  z.object({
    type: z.literal("file_not_exists"),
    path: z.string(),
  }),
  z.object({
    type: z.literal("file_contains"),
    path: z.string(),
    pattern: z.string(),
  }),
  z.object({
    type: z.literal("file_not_contains"),
    path: z.string(),
    pattern: z.string(),
  }),
  z.object({
    type: z.literal("config_value"),
    path: z.string(),
    key: z.string(),
    expectedValue: z.string(),
  }),
  z.object({
    type: z.literal("build_succeeds"),
  }),
  z.object({
    type: z.literal("test_passes"),
    testFile: z.string().optional(),
    testName: z.string().optional(),
  }),
]);

export type AssertionType = z.infer<typeof AssertionTypeSchema>;

// ---------------------------------------------------------------------------
// Acceptance Criterion Schema
// ---------------------------------------------------------------------------

export const AcceptanceCriterionSchema = z.object({
  id: z.string(),
  description: z.string(),
  layer: z.enum(["structural", "test-bound", "manual"]),
  structuralAssertions: z.array(AssertionTypeSchema).nullable().optional(),
  note: z.string().optional(),
});

export type AcceptanceCriterion = z.infer<typeof AcceptanceCriterionSchema>;

// ---------------------------------------------------------------------------
// Acceptance Criteria (top-level) Schema
// ---------------------------------------------------------------------------

export const AcceptanceCriteriaSchema = z.object({
  version: z.number(),
  criteria: z.array(AcceptanceCriterionSchema),
});

export type AcceptanceCriteria = z.infer<typeof AcceptanceCriteriaSchema>;

// ---------------------------------------------------------------------------
// Hash Computation
// ---------------------------------------------------------------------------

/**
 * Compute a deterministic SHA-256 hash (32 hex chars) over the AC criteria.
 * Covers: id, layer, structuralAssertions for each criterion.
 * Used for tamper detection between Phase 1 lock and Phase 6 verification.
 */
export function computeAcHash(criteria: AcceptanceCriterion[]): string {
  const payload = criteria.map((c) => ({
    id: c.id,
    layer: c.layer,
    structuralAssertions: c.structuralAssertions ?? null,
  }));
  return createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex")
    .slice(0, 32);
}
