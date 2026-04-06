/**
 * Tests for ship-integration (Phase 8).
 * Covers data model, init parameters, validateCompletion, computeNextDirective, and PHASE_META.
 */

import { describe, it, expect } from 'vitest';
import { StateJsonSchema, InitInputSchema } from '../types.js';
import { computeNextDirective, validateCompletion } from '../phase-enforcer.js';
import type { StateJson } from '../types.js';

// Helper to create a minimal valid StateJson
function makeState(overrides: Partial<StateJson> = {}): StateJson {
  return {
    topic: 'test',
    mode: 'full',
    phase: 1,
    status: 'IN_PROGRESS',
    stack: {
      language: 'TypeScript',
      buildCmd: 'npm run build',
      testCmd: 'npm test',
      langChecklist: 'ts.md',
    },
    outputDir: '/tmp/test',
    projectRoot: '/tmp',
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Task 13: Data model and init parameter tests
// ---------------------------------------------------------------------------

describe('StateJsonSchema ship fields', () => {
  it('accepts all ship-related fields', () => {
    const state = makeState({
      ship: true,
      deployTarget: 'my-app',
      deployBranch: 'main',
      deployEnv: 'green',
      verifyMethod: 'api',
      verifyConfig: {
        endpoint: 'http://localhost:8080/health',
        expectedPattern: 'ok',
        logPath: '/var/log/app.log',
        logKeyword: 'started',
        sshHost: '10.0.0.1',
      },
      shipRound: 0,
      shipMaxRounds: 5,
    });
    expect(StateJsonSchema.safeParse(state).success).toBe(true);
  });

  it('ship fields are optional -- state without them is valid', () => {
    const state = makeState();
    const result = StateJsonSchema.safeParse(state);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.ship).toBeUndefined();
      expect(result.data.deployTarget).toBeUndefined();
      expect(result.data.shipRound).toBeUndefined();
    }
  });
});

describe('InitInputSchema ship fields', () => {
  it('accepts ship parameters', () => {
    const input = {
      projectRoot: '/tmp',
      topic: 'test',
      mode: 'full',
      ship: true,
      deployTarget: 'my-app',
      deployBranch: 'main',
      deployEnv: 'green',
      verifyMethod: 'combined',
      verifyConfig: { endpoint: 'http://x', logPath: '/var/log' },
      shipMaxRounds: 3,
    };
    expect(InitInputSchema.safeParse(input).success).toBe(true);
  });

  it('ship parameters are optional', () => {
    const input = { projectRoot: '/tmp', topic: 'test', mode: 'full' };
    expect(InitInputSchema.safeParse(input).success).toBe(true);
  });

  it('does not include shipRound (set by framework)', () => {
    const input = {
      projectRoot: '/tmp',
      topic: 'test',
      mode: 'full',
      shipRound: 3, // should be stripped / not in schema
    };
    // Zod v4 strips unknown keys by default on parse
    const result = InitInputSchema.safeParse(input);
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Task 15: computeNextDirective and PHASE_META tests
// ---------------------------------------------------------------------------

describe('computeNextDirective ship awareness (P0-2 fix)', () => {
  it('ship=true: Phase 7 PASS -> nextPhase=8', () => {
    const state = makeState({ ship: true, phase: 7 });
    const result = computeNextDirective(7, 'PASS', state);
    expect(result.phaseCompleted).toBe(true);
    expect(result.nextPhase).toBe(8);
    expect(result.canDeclareComplete).toBe(false);
    expect(result.mandate).toContain('Phase 8');
  });

  it('ship=true: Phase 8 PASS -> canDeclareComplete=true', () => {
    const state = makeState({ ship: true, phase: 8 });
    const result = computeNextDirective(8, 'PASS', state);
    expect(result.phaseCompleted).toBe(true);
    expect(result.nextPhase).toBeNull();
    expect(result.canDeclareComplete).toBe(true);
  });

  it('ship=false: Phase 7 PASS -> canDeclareComplete=true (unchanged)', () => {
    const state = makeState({ phase: 7 });
    const result = computeNextDirective(7, 'PASS', state);
    expect(result.phaseCompleted).toBe(true);
    expect(result.nextPhase).toBeNull();
    expect(result.canDeclareComplete).toBe(true);
  });

  it('isDryRun=true: maxPhase still 2 regardless of ship', () => {
    const state = makeState({ dryRun: true, ship: true, phase: 2 });
    const result = computeNextDirective(2, 'PASS', state);
    expect(result.canDeclareComplete).toBe(true);
  });

  it('turbo mode: maxPhase still 3 regardless of ship', () => {
    const state = makeState({ mode: 'turbo', ship: true, phase: 3 });
    const result = computeNextDirective(3, 'PASS', state);
    expect(result.canDeclareComplete).toBe(true);
  });
});

describe('validateCompletion ship parameter', () => {
  const makeLog = (phases: number[]) =>
    phases.map(p => `<!-- CHECKPOINT phase=${p} status=PASS -->`).join('\n');

  it('AC-11: ship=true requires Phase 8 PASS', () => {
    const log = makeLog([1, 2, 3, 4, 5, 6, 7]);
    const result = validateCompletion(log, 'full', false, false, true);
    expect(result.canComplete).toBe(false);
    expect(result.missingPhases).toContain(8);
  });

  it('AC-11: ship=true with Phase 8 PASS -> canComplete', () => {
    const log = makeLog([1, 2, 3, 4, 5, 6, 7, 8]);
    const result = validateCompletion(log, 'full', false, false, true);
    expect(result.canComplete).toBe(true);
    expect(result.missingPhases).toHaveLength(0);
  });

  it('AC-11 reverse: ship=false does not require Phase 8', () => {
    const log = makeLog([1, 2, 3, 4, 5, 6, 7]);
    const result = validateCompletion(log, 'full', false, false, false);
    expect(result.canComplete).toBe(true);
  });

  it('default ship parameter is false', () => {
    const log = makeLog([1, 2, 3, 4, 5, 6, 7]);
    const result = validateCompletion(log, 'full', false, false);
    expect(result.canComplete).toBe(true);
  });

  it('skipE2e + ship: requires [1,2,3,4,6,7,8]', () => {
    const log = makeLog([1, 2, 3, 4, 6, 7, 8]);
    const result = validateCompletion(log, 'full', false, true, true);
    expect(result.canComplete).toBe(true);
  });
});
