/**
 * Tests for REGRESS logic in computeNextDirective (phase-enforcer.ts).
 */

import { describe, it, expect } from 'vitest';
import { computeNextDirective } from '../phase-enforcer.js';
import type { StateJson } from '../types.js';

function makeState(overrides: Partial<StateJson> = {}): StateJson {
  return {
    topic: 'test',
    mode: 'full',
    phase: 4,
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

describe('computeNextDirective REGRESS', () => {
  it('REGRESS with valid regressTo -> nextPhase correct', () => {
    const state = makeState();
    const result = computeNextDirective(4, 'REGRESS', state, 1);
    expect(result.nextPhase).toBe(1);
    expect(result.mandate).toContain('[REGRESS]');
  });

  it('REGRESS with regressTo >= currentPhase -> ERROR', () => {
    const state = makeState();
    const result = computeNextDirective(4, 'REGRESS', state, 4);
    expect(result.mandate).toContain('[ERROR]');
  });

  it('REGRESS with regressTo > currentPhase -> ERROR', () => {
    const state = makeState();
    const result = computeNextDirective(4, 'REGRESS', state, 5);
    expect(result.mandate).toContain('[ERROR]');
  });

  it('REGRESS with regressionCount=2 -> BLOCKED', () => {
    const state = makeState({ regressionCount: 2 });
    const result = computeNextDirective(4, 'REGRESS', state, 1);
    expect(result.mandate).toContain('[BLOCKED]');
  });

  it('REGRESS without regressTo -> ERROR', () => {
    const state = makeState();
    const result = computeNextDirective(4, 'REGRESS', state);
    expect(result.mandate).toContain('[ERROR]');
  });

  it('REGRESS returns phaseCompleted: false', () => {
    const state = makeState();
    const result = computeNextDirective(4, 'REGRESS', state, 1);
    expect(result.phaseCompleted).toBe(false);
  });

  it('REGRESS returns canDeclareComplete: false', () => {
    const state = makeState();
    const result = computeNextDirective(4, 'REGRESS', state, 1);
    expect(result.canDeclareComplete).toBe(false);
  });

  it('regressionCount=1 still allows regression', () => {
    const state = makeState({ regressionCount: 1 });
    const result = computeNextDirective(4, 'REGRESS', state, 1);
    expect(result.nextPhase).toBe(1);
    expect(result.mandate).toContain('[REGRESS]');
  });
});
