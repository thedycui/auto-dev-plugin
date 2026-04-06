/**
 * Tests for checkIterationLimit function (phase-enforcer.ts).
 */

import { describe, it, expect } from 'vitest';
import { checkIterationLimit } from '../phase-enforcer.js';

describe('checkIterationLimit', () => {
  it('Phase 1, iteration 1 -> CONTINUE', () => {
    const result = checkIterationLimit(1, 1, false);
    expect(result.action).toBe('CONTINUE');
    expect(result.allowed).toBe(true);
    expect(result.exceeded).toBe(false);
  });

  it('Phase 1, iteration 3, interactive -> BLOCK', () => {
    const result = checkIterationLimit(1, 3, true);
    expect(result.action).toBe('BLOCK');
    expect(result.exceeded).toBe(true);
    expect(result.allowed).toBe(false);
  });

  it('Phase 1, iteration 3, non-interactive -> BLOCK', () => {
    const result = checkIterationLimit(1, 3, false);
    expect(result.action).toBe('BLOCK');
    expect(result.exceeded).toBe(true);
    expect(result.allowed).toBe(false);
  });

  it('Phase 4, iteration 2 -> CONTINUE (max is 3)', () => {
    const result = checkIterationLimit(4, 2, false);
    expect(result.action).toBe('CONTINUE');
    expect(result.allowed).toBe(true);
    expect(result.maxIteration).toBe(3);
  });

  it('Phase 4, iteration 3 -> BLOCK', () => {
    const result = checkIterationLimit(4, 3, false);
    expect(result.action).toBe('BLOCK');
    expect(result.exceeded).toBe(true);
  });

  it('Phase 6, iteration 10 -> CONTINUE (no limit)', () => {
    const result = checkIterationLimit(6, 10, false);
    expect(result.action).toBe('CONTINUE');
    expect(result.allowed).toBe(true);
    expect(result.maxIteration).toBe(Infinity);
  });

  it('maxIteration values per phase', () => {
    // Phase 1: max 3
    expect(checkIterationLimit(1, 1, false).maxIteration).toBe(3);
    // Phase 2: max 3
    expect(checkIterationLimit(2, 1, false).maxIteration).toBe(3);
    // Phase 3: max 2
    expect(checkIterationLimit(3, 1, false).maxIteration).toBe(2);
    // Phase 4: max 3
    expect(checkIterationLimit(4, 1, false).maxIteration).toBe(3);
    // Phase 5: max 3
    expect(checkIterationLimit(5, 1, false).maxIteration).toBe(3);
    // Phase 6: no limit
    expect(checkIterationLimit(6, 1, false).maxIteration).toBe(Infinity);
  });
});
