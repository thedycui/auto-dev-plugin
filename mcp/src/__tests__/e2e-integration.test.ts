/**
 * E2E Integration Tests -- v6.0 Robustness Enhancement
 *
 * These tests exercise the checkpoint handler's integration logic by
 * operating on real temporary directories with actual state.json and
 * progress-log.md files. They simulate the flow from index.ts checkpoint
 * handler using StateManager + checkIterationLimit + computeNextDirective.
 *
 * Rule: Integration Entry Point Test -- every test group includes at least
 * one test that follows the full checkpoint handler pipeline (validate ->
 * mutate state -> append progress-log -> computeNextDirective), not just
 * testing individual components.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  StateManager,
  extractDocSummary,
  extractTaskList,
} from '../state-manager.js';
import {
  checkIterationLimit,
  computeNextDirective,
  validateCompletion,
} from '../phase-enforcer.js';
import type { StateJson, StackInfo } from '../types.js';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const TEST_STACK: StackInfo = {
  language: 'TypeScript',
  buildCmd: 'npm run build',
  testCmd: 'npm test',
  langChecklist: 'ts.md',
};

const TOPIC = 'e2e-test';

let tmpDir: string;
let projectRoot: string;

/**
 * Create a real temp directory with package.json (so detectStack can find it)
 * and the stacks/node-npm.md file in the expected location.
 */
async function setupTestProject(): Promise<string> {
  tmpDir = await mkdtemp(join(tmpdir(), 'auto-dev-e2e-'));
  projectRoot = tmpDir;

  // Create package.json so detectStack matches node-npm
  await writeFile(
    join(projectRoot, 'package.json'),
    '{"name":"test"}',
    'utf-8'
  );

  return projectRoot;
}

/**
 * Create a StateManager initialized with a specific state, bypassing detectStack.
 * Directly writes state.json and progress-log.md to disk.
 */
async function initStateOnDisk(
  sm: StateManager,
  overrides: Partial<StateJson> = {}
): Promise<StateJson> {
  const outputDir = sm.outputDir;
  await mkdir(outputDir, { recursive: true });

  const now = new Date().toISOString();
  const state: StateJson = {
    topic: TOPIC,
    mode: 'full',
    phase: 1,
    status: 'IN_PROGRESS',
    stack: TEST_STACK,
    outputDir,
    projectRoot,
    startedAt: now,
    updatedAt: now,
    ...overrides,
  };

  await sm.atomicWrite(sm.stateFilePath, JSON.stringify(state, null, 2));

  // Write progress-log header
  const header =
    `# auto-dev progress-log: ${TOPIC}\n\n` +
    `> Started: ${state.startedAt}  \n` +
    `> Mode: ${state.mode}  \n` +
    `> Stack: ${TEST_STACK.language}\n\n`;
  await sm.atomicWrite(sm.progressLogPath, header);

  return state;
}

/**
 * Simulate the full checkpoint handler pipeline from index.ts.
 * This is the "integration entry point" -- it follows the exact same logic
 * as the checkpoint tool handler in index.ts L249-L431.
 */
async function simulateCheckpointHandler(
  sm: StateManager,
  params: {
    phase: number;
    task?: number;
    status: string;
    summary?: string;
    regressTo?: number;
  }
): Promise<{
  result: Record<string, unknown>;
  earlyReturn?: boolean;
}> {
  let status = params.status;
  let summary = params.summary;
  const state = await sm.loadAndValidate();

  // Idempotency check
  if (
    await sm.isCheckpointDuplicate(params.phase, params.task, status, summary)
  ) {
    return { result: { idempotent: true }, earlyReturn: true };
  }

  // [P0-1 fix] REGRESS validation BEFORE any state mutation
  if (status === 'REGRESS') {
    if (!params.regressTo) {
      return {
        result: { error: 'REGRESS requires regressTo parameter' },
        earlyReturn: true,
      };
    }
    if (params.regressTo >= params.phase) {
      return {
        result: {
          error: `regressTo(${params.regressTo}) must be < current phase(${params.phase})`,
        },
        earlyReturn: true,
      };
    }
    if ((state.regressionCount ?? 0) >= 2) {
      return {
        result: {
          status: 'BLOCKED',
          mandate: '[BLOCKED] Max regression count (2) reached.',
        },
        earlyReturn: true,
      };
    }
  }

  // Iteration limit check for NEEDS_REVISION
  if (status === 'NEEDS_REVISION') {
    const newIteration = (state.iteration ?? 0) + 1;
    const iterCheck = checkIterationLimit(
      params.phase,
      newIteration,
      state.interactive ?? false
    );

    if (iterCheck.action === 'BLOCK') {
      // [P1-2 fix] Persist iteration even on BLOCK
      await sm.atomicUpdate({ iteration: newIteration });
      return {
        result: { status: 'BLOCKED', message: iterCheck.message },
        earlyReturn: true,
      };
    }

    if (iterCheck.action === 'FORCE_PASS') {
      status = 'PASS';
      summary = `[FORCED_PASS: iteration limit exceeded] ${summary ?? ''}`;
    }
  }

  // 1. Append to progress-log
  const line = sm.getCheckpointLine(params.phase, params.task, status, summary);
  await sm.appendToProgressLog('\n' + line + '\n');

  // 2. Update state.json
  const stateUpdates: Record<string, unknown> = { phase: params.phase, status };
  if (params.task !== undefined) stateUpdates['task'] = params.task;

  if (status === 'NEEDS_REVISION') {
    stateUpdates['iteration'] = (state.iteration ?? 0) + 1;
  } else if (status === 'PASS' || status === 'COMPLETED') {
    stateUpdates['iteration'] = 0;
  }

  if (status === 'REGRESS') {
    stateUpdates['regressionCount'] = (state.regressionCount ?? 0) + 1;
    stateUpdates['iteration'] = 0;
  }

  await sm.atomicUpdate(stateUpdates);

  // 3. Compute next directive
  const stateForDirective =
    status === 'REGRESS'
      ? { ...state, regressionCount: (state.regressionCount ?? 0) + 1 }
      : state;
  const nextDirective = computeNextDirective(
    params.phase,
    status,
    stateForDirective,
    params.regressTo
  );

  return { result: { ok: true, ...nextDirective } };
}

// ---------------------------------------------------------------------------
// Test Groups
// ---------------------------------------------------------------------------

describe('E2E Integration: BLOCK on Iteration Limit (P1-4)', () => {
  let sm: StateManager;

  beforeEach(async () => {
    await setupTestProject();
    sm = new StateManager(projectRoot, TOPIC);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('TC-1.1: NEEDS_REVISION at iteration limit (non-interactive) triggers BLOCK', async () => {
    // Precondition: phase=4, iteration=2, non-interactive
    await initStateOnDisk(sm, { phase: 4, iteration: 2 });

    // Simulate the full checkpoint handler pipeline
    const { result, earlyReturn } = await simulateCheckpointHandler(sm, {
      phase: 4,
      status: 'NEEDS_REVISION',
      summary: 'Code issues found',
    });

    // Verify early return with BLOCKED status (FORCE_PASS eliminated in v7.0)
    expect(earlyReturn).toBe(true);
    expect(result).toHaveProperty('status', 'BLOCKED');
    // BLOCK has no nextPhase or phaseCompleted — execution stops
    expect(result).toHaveProperty('message');
  });

  it('TC-1.2: NEEDS_REVISION at iteration limit (interactive) BLOCKs and persists iteration', async () => {
    // Precondition: phase=1, iteration=2, interactive=true
    await initStateOnDisk(sm, { phase: 1, iteration: 2, interactive: true });

    const { result, earlyReturn } = await simulateCheckpointHandler(sm, {
      phase: 1,
      status: 'NEEDS_REVISION',
    });

    // Verify early return with BLOCK
    expect(earlyReturn).toBe(true);
    expect(result).toHaveProperty('status', 'BLOCKED');

    // Verify iteration is persisted (sticky BLOCK -- P1-2 fix)
    const finalState = await sm.loadAndValidate();
    expect(finalState.iteration).toBe(3);

    // Verify progress-log has NO new checkpoint (BLOCK returns before append)
    const progressLog = await readFile(sm.progressLogPath, 'utf-8');
    expect(progressLog).not.toContain('CHECKPOINT');
  });

  it('TC-1.3: NEEDS_REVISION below limit increments iteration normally', async () => {
    await initStateOnDisk(sm, { phase: 4, iteration: 0 });

    const { result, earlyReturn } = await simulateCheckpointHandler(sm, {
      phase: 4,
      status: 'NEEDS_REVISION',
      summary: 'Minor issues',
    });

    expect(earlyReturn).toBeUndefined();

    const finalState = await sm.loadAndValidate();
    expect(finalState.status).toBe('NEEDS_REVISION');
    expect(finalState.iteration).toBe(1);

    const progressLog = await readFile(sm.progressLogPath, 'utf-8');
    expect(progressLog).toContain('status=NEEDS_REVISION');
  });
});

describe('E2E Integration: REGRESS Flow (P0-1, P1-3)', () => {
  let sm: StateManager;

  beforeEach(async () => {
    await setupTestProject();
    sm = new StateManager(projectRoot, TOPIC);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('TC-2.1: Valid REGRESS increments regressionCount, resets iteration, returns correct directive', async () => {
    await initStateOnDisk(sm, { phase: 4, iteration: 2 });

    const { result } = await simulateCheckpointHandler(sm, {
      phase: 4,
      status: 'REGRESS',
      regressTo: 1,
    });

    // Verify state.json
    const finalState = await sm.loadAndValidate();
    expect(finalState.regressionCount).toBe(1);
    expect(finalState.iteration).toBe(0);
    expect(finalState.status).toBe('REGRESS');

    // Verify progress-log
    const progressLog = await readFile(sm.progressLogPath, 'utf-8');
    expect(progressLog).toContain('status=REGRESS');

    // Verify directive
    expect(result).toHaveProperty('ok', true);
    expect(result).toHaveProperty('nextPhase', 1);
    expect((result as Record<string, unknown>)['mandate']).toContain(
      '[REGRESS]'
    );
  });

  it('TC-2.2: Invalid REGRESS (regressTo >= currentPhase) returns error WITHOUT mutating state', async () => {
    await initStateOnDisk(sm, { phase: 4 });
    const stateBefore = await sm.loadAndValidate();
    const progressLogBefore = await readFile(sm.progressLogPath, 'utf-8');

    const { result, earlyReturn } = await simulateCheckpointHandler(sm, {
      phase: 4,
      status: 'REGRESS',
      regressTo: 4,
    });

    expect(earlyReturn).toBe(true);
    expect(result).toHaveProperty('error');
    expect((result as Record<string, string>)['error']).toContain(
      'regressTo(4)'
    );

    // Verify NO state mutation
    const stateAfter = await sm.loadAndValidate();
    expect(stateAfter.regressionCount).toBeUndefined();

    // Verify NO progress-log mutation
    const progressLogAfter = await readFile(sm.progressLogPath, 'utf-8');
    expect(progressLogAfter).toBe(progressLogBefore);
  });

  it('TC-2.3: REGRESS at max count returns BLOCKED without mutation', async () => {
    await initStateOnDisk(sm, { phase: 4, regressionCount: 2 });
    const progressLogBefore = await readFile(sm.progressLogPath, 'utf-8');

    const { result, earlyReturn } = await simulateCheckpointHandler(sm, {
      phase: 4,
      status: 'REGRESS',
      regressTo: 1,
    });

    expect(earlyReturn).toBe(true);
    expect(result).toHaveProperty('status', 'BLOCKED');
    expect((result as Record<string, string>)['mandate']).toContain(
      'Max regression count'
    );

    // State unchanged
    const stateAfter = await sm.loadAndValidate();
    expect(stateAfter.regressionCount).toBe(2);

    // Progress-log unchanged
    const progressLogAfter = await readFile(sm.progressLogPath, 'utf-8');
    expect(progressLogAfter).toBe(progressLogBefore);
  });

  it("TC-2.4: Two successive regressions -- first allowed, second's directive is BLOCKED", async () => {
    await initStateOnDisk(sm, { phase: 4, iteration: 1 });

    // 1st REGRESS: count 0 -> 1
    const first = await simulateCheckpointHandler(sm, {
      phase: 4,
      status: 'REGRESS',
      regressTo: 1,
    });
    expect(first.earlyReturn).toBeUndefined();
    expect(first.result).toHaveProperty('nextPhase', 1);

    const stateAfter1 = await sm.loadAndValidate();
    expect(stateAfter1.regressionCount).toBe(1);

    // Reset state to phase=4 to simulate returning to phase 4 after regression
    // Also add a non-REGRESS checkpoint so idempotency check won't match
    await sm.atomicUpdate({ phase: 4, status: 'IN_PROGRESS', iteration: 0 });
    const interimLine = sm.getCheckpointLine(
      4,
      undefined,
      'IN_PROGRESS',
      'back at phase 4'
    );
    await sm.appendToProgressLog('\n' + interimLine + '\n');

    // 2nd REGRESS: count 1 -> early guard passes (1 < 2), writes count=2,
    // but computeNextDirective sees count=2 -> BLOCKED in directive
    const second = await simulateCheckpointHandler(sm, {
      phase: 4,
      status: 'REGRESS',
      regressTo: 1,
    });

    // The 2nd call does NOT early return (early guard checks state.regressionCount=1 < 2).
    // But computeNextDirective returns BLOCKED because the updated count (2) >= 2.
    expect(second.earlyReturn).toBeUndefined();
    expect((second.result as Record<string, string>)['mandate']).toContain(
      '[BLOCKED]'
    );

    const stateAfter2 = await sm.loadAndValidate();
    expect(stateAfter2.regressionCount).toBe(2);

    // 3rd REGRESS: early guard blocks (2 >= 2)
    await sm.atomicUpdate({ phase: 4, status: 'IN_PROGRESS' });
    const interimLine2 = sm.getCheckpointLine(
      4,
      undefined,
      'IN_PROGRESS',
      'back at phase 4 again'
    );
    await sm.appendToProgressLog('\n' + interimLine2 + '\n');
    const third = await simulateCheckpointHandler(sm, {
      phase: 4,
      status: 'REGRESS',
      regressTo: 1,
    });
    expect(third.earlyReturn).toBe(true);
    expect(third.result).toHaveProperty('status', 'BLOCKED');

    // regressionCount stays at 2 (no mutation)
    const stateAfter3 = await sm.loadAndValidate();
    expect(stateAfter3.regressionCount).toBe(2);
  });
});

describe('E2E Integration: State Rebuild from Progress-Log (AC-2)', () => {
  let sm: StateManager;

  beforeEach(async () => {
    await setupTestProject();
    sm = new StateManager(projectRoot, TOPIC);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('TC-3.1: Corrupted state.json triggers rebuild from progress-log', async () => {
    const outputDir = sm.outputDir;
    await mkdir(outputDir, { recursive: true });

    // Write valid progress-log with checkpoints
    const progressLog =
      `# auto-dev progress-log: ${TOPIC}\n\n` +
      `> Started: 2026-01-01T00:00:00Z  \n` +
      `> Mode: full  \n` +
      `> Stack: TypeScript\n\n` +
      `\n<!-- CHECKPOINT phase=1 status=PASS summary="design done" timestamp=2026-01-01T01:00:00Z -->\n` +
      `\n<!-- CHECKPOINT phase=2 status=IN_PROGRESS timestamp=2026-01-01T02:00:00Z -->\n`;
    await writeFile(sm.progressLogPath, progressLog, 'utf-8');

    // Write invalid JSON to state.json
    await writeFile(sm.stateFilePath, '{ CORRUPTED JSON !!!', 'utf-8');

    // loadAndValidate should fail
    await expect(sm.loadAndValidate()).rejects.toThrow();

    // Rebuild from progress-log (mock detectStack since we may not have stacks/*.md)
    const detectStackSpy = (await import('vitest')).vi
      .spyOn(sm, 'detectStack')
      .mockResolvedValue(TEST_STACK);
    const rebuilt = await sm.rebuildStateFromProgressLog();
    detectStackSpy.mockRestore();

    expect(rebuilt.phase).toBe(2);
    expect(rebuilt.status).toBe('IN_PROGRESS');
    expect(rebuilt.mode).toBe('full');
    expect(rebuilt.startedAt).toBe('2026-01-01T00:00:00Z');

    // State.json should now be valid
    const reloaded = await sm.loadAndValidate();
    expect(reloaded.phase).toBe(2);
  });

  it('TC-3.2: Dirty state.json -- clear dirty flag to recover', async () => {
    const outputDir = sm.outputDir;
    await mkdir(outputDir, { recursive: true });

    // Write valid state with dirty=true
    const dirtyState: StateJson = {
      topic: TOPIC,
      mode: 'full',
      phase: 3,
      status: 'PASS',
      stack: TEST_STACK,
      outputDir,
      projectRoot,
      dirty: true,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await writeFile(
      sm.stateFilePath,
      JSON.stringify(dirtyState, null, 2),
      'utf-8'
    );

    // Write progress-log (needed for potential rebuild)
    await writeFile(sm.progressLogPath, '# progress-log\n', 'utf-8');

    // loadAndValidate should fail with "dirty"
    await expect(sm.loadAndValidate()).rejects.toThrow(/dirty/);

    // Fix dirty flag (simulating the resume handler in index.ts)
    const raw = JSON.parse(await readFile(sm.stateFilePath, 'utf-8'));
    raw.dirty = false;
    raw.updatedAt = new Date().toISOString();
    await sm.atomicWrite(sm.stateFilePath, JSON.stringify(raw, null, 2));

    // Now loadAndValidate should succeed
    const recovered = await sm.loadAndValidate();
    expect(recovered.phase).toBe(3);
    expect(recovered.status).toBe('PASS');
    expect(recovered.dirty).toBeFalsy();
  });

  it('TC-3.3: Missing state.json + valid progress-log rebuilds correctly', async () => {
    const outputDir = sm.outputDir;
    await mkdir(outputDir, { recursive: true });

    // Create progress-log with checkpoints through phase 3
    const progressLog =
      `# auto-dev progress-log: ${TOPIC}\n\n` +
      `> Started: 2026-02-15T10:00:00Z  \n` +
      `> Mode: quick  \n` +
      `> Stack: TypeScript\n\n` +
      `\n<!-- CHECKPOINT phase=1 status=PASS timestamp=2026-02-15T10:30:00Z -->\n` +
      `\n<!-- CHECKPOINT phase=2 status=PASS timestamp=2026-02-15T11:00:00Z -->\n` +
      `\n<!-- CHECKPOINT phase=3 status=PASS timestamp=2026-02-15T12:00:00Z -->\n`;
    await writeFile(sm.progressLogPath, progressLog, 'utf-8');

    // Do NOT create state.json -- loadAndValidate should fail
    await expect(sm.loadAndValidate()).rejects.toThrow(/Failed to read/);

    // Rebuild
    const detectStackSpy = (await import('vitest')).vi
      .spyOn(sm, 'detectStack')
      .mockResolvedValue(TEST_STACK);
    const rebuilt = await sm.rebuildStateFromProgressLog();
    detectStackSpy.mockRestore();

    expect(rebuilt.phase).toBe(3);
    expect(rebuilt.status).toBe('PASS');
    expect(rebuilt.mode).toBe('quick');
    expect(rebuilt.startedAt).toBe('2026-02-15T10:00:00Z');

    // Verify new state.json is written and valid
    const reloaded = await sm.loadAndValidate();
    expect(reloaded.phase).toBe(3);
  });
});

describe('E2E Integration: Preflight Context Injection (AC-3)', () => {
  let sm: StateManager;

  beforeEach(async () => {
    await setupTestProject();
    sm = new StateManager(projectRoot, TOPIC);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('TC-4.1: Phase 3 extracts both design summary and task list', async () => {
    const outputDir = sm.outputDir;
    await mkdir(outputDir, { recursive: true });

    // Create design.md
    const designContent =
      `# Design\n\n` +
      `## 概述\n\n` +
      `This project adds iteration limits and REGRESS support.\n` +
      `It affects phase-enforcer, state-manager, and index.ts.\n\n` +
      `## Details\n\nDetailed implementation notes.\n`;
    await writeFile(join(outputDir, 'design.md'), designContent, 'utf-8');

    // Create plan.md
    const planContent =
      `# Plan\n\n` +
      `### Task 1: Add iteration limit to phase-enforcer\n\n` +
      `Description of task 1.\n\n` +
      `### Task 2: Implement REGRESS in checkpoint handler\n\n` +
      `Description of task 2.\n\n` +
      `### Task 3: Add state rebuild from progress-log\n\n` +
      `Description of task 3.\n`;
    await writeFile(join(outputDir, 'plan.md'), planContent, 'utf-8');

    // Simulate preflight context building (matching index.ts L524-L540)
    const phase = 3;
    let extraContext = '';

    const designFile = await readFile(join(outputDir, 'design.md'), 'utf-8');
    const designSummary = extractDocSummary(designFile, 80);
    extraContext += `## 设计摘要（自动注入）\n\n${designSummary}\n\n`;

    if (phase === 3) {
      const planFile = await readFile(join(outputDir, 'plan.md'), 'utf-8');
      const taskList = extractTaskList(planFile);
      extraContext += `## 任务列表（自动注入）\n\n${taskList}\n\n`;
    }

    // Verify design summary content
    expect(extraContext).toContain('设计摘要');
    expect(extraContext).toContain('iteration limits');
    expect(extraContext).toContain('REGRESS support');
    expect(extraContext).not.toContain('Detailed implementation notes');

    // Verify task list content
    expect(extraContext).toContain('任务列表');
    expect(extraContext).toContain('Task 1: Add iteration limit');
    expect(extraContext).toContain('Task 2: Implement REGRESS');
    expect(extraContext).toContain('Task 3: Add state rebuild');
    expect(extraContext).not.toContain('Description of task');
  });

  it('TC-4.2: Phase 4 extracts design summary only, no task list', async () => {
    const outputDir = sm.outputDir;
    await mkdir(outputDir, { recursive: true });

    await writeFile(
      join(outputDir, 'design.md'),
      `# Design\n\n## Summary\n\nA concise summary of the design.\n\n## Details\n\nNot included.\n`,
      'utf-8'
    );
    await writeFile(
      join(outputDir, 'plan.md'),
      `# Plan\n\n### Task 1: Should not appear\n\nDetails.\n`,
      'utf-8'
    );

    const phase = 4;
    let extraContext = '';

    const designFile = await readFile(join(outputDir, 'design.md'), 'utf-8');
    const designSummary = extractDocSummary(designFile, 80);
    extraContext += `## 设计摘要（自动注入）\n\n${designSummary}\n\n`;

    // Phase 4: do NOT inject task list (only phase 3 does)
    if (phase === 3) {
      // This block should not execute
      const planFile = await readFile(join(outputDir, 'plan.md'), 'utf-8');
      const taskList = extractTaskList(planFile);
      extraContext += `## 任务列表（自动注入）\n\n${taskList}\n\n`;
    }

    expect(extraContext).toContain('设计摘要');
    expect(extraContext).toContain('A concise summary');
    expect(extraContext).not.toContain('任务列表');
    expect(extraContext).not.toContain('Task 1');
  });

  it('TC-4.3: Missing design.md does not cause error', async () => {
    const outputDir = sm.outputDir;
    await mkdir(outputDir, { recursive: true });

    // Only plan.md, no design.md
    await writeFile(
      join(outputDir, 'plan.md'),
      `# Plan\n\n### Task 1: Do something\n\n`,
      'utf-8'
    );

    const phase = 3;
    let extraContext = '';

    // Try reading design.md -- should fail gracefully
    try {
      const designFile = await readFile(join(outputDir, 'design.md'), 'utf-8');
      const designSummary = extractDocSummary(designFile, 80);
      extraContext += `## 设计摘要（自动注入）\n\n${designSummary}\n\n`;
    } catch {
      // design.md not found -- skip, no error
    }

    if (phase === 3) {
      try {
        const planFile = await readFile(join(outputDir, 'plan.md'), 'utf-8');
        const taskList = extractTaskList(planFile);
        extraContext += `## 任务列表（自动注入）\n\n${taskList}\n\n`;
      } catch {
        // plan.md not found -- skip
      }
    }

    // No error thrown, extraContext has only task list
    expect(extraContext).not.toContain('设计摘要');
    expect(extraContext).toContain('任务列表');
    expect(extraContext).toContain('Task 1');
  });
});

describe('E2E Integration: Checkpoint Pipeline (Entry Point)', () => {
  let sm: StateManager;

  beforeEach(async () => {
    await setupTestProject();
    sm = new StateManager(projectRoot, TOPIC);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('TC-5.1: PASS at phase 4 advances to phase 5 via full pipeline', async () => {
    await initStateOnDisk(sm, { phase: 4, status: 'IN_PROGRESS' });

    const { result } = await simulateCheckpointHandler(sm, {
      phase: 4,
      status: 'PASS',
      summary: 'Code review passed',
    });

    // Verify state
    const finalState = await sm.loadAndValidate();
    expect(finalState.phase).toBe(4);
    expect(finalState.status).toBe('PASS');
    expect(finalState.iteration).toBe(0);

    // Verify progress-log
    const progressLog = await readFile(sm.progressLogPath, 'utf-8');
    expect(progressLog).toContain('phase=4');
    expect(progressLog).toContain('status=PASS');
    expect(progressLog).toContain('Code review passed');

    // Verify directive
    expect(result).toHaveProperty('ok', true);
    expect(result).toHaveProperty('nextPhase', 5);
    expect(result).toHaveProperty('phaseCompleted', true);
    expect((result as Record<string, string>)['mandate']).toContain('Phase 5');
  });

  it('TC-5.2: Idempotent checkpoint -- duplicate detected and skipped', async () => {
    await initStateOnDisk(sm, { phase: 1 });

    // First checkpoint
    await simulateCheckpointHandler(sm, {
      phase: 1,
      status: 'PASS',
      summary: 'Design approved',
    });

    // Same checkpoint again -- should be detected as duplicate
    const { result, earlyReturn } = await simulateCheckpointHandler(sm, {
      phase: 1,
      status: 'PASS',
      summary: 'Design approved',
    });

    expect(earlyReturn).toBe(true);
    expect(result).toHaveProperty('idempotent', true);

    // Different status should NOT be duplicate
    const different = await sm.isCheckpointDuplicate(
      1,
      undefined,
      'NEEDS_REVISION',
      'Design approved'
    );
    expect(different).toBe(false);
  });

  it('TC-5.3: validateCompletion with all phases PASS allows completion', async () => {
    await initStateOnDisk(sm, { phase: 6, status: 'PASS' });

    // Build progress-log with all phases PASS
    let checkpoints = '';
    for (const p of [1, 2, 3, 4, 5, 6, 7]) {
      checkpoints += `\n<!-- CHECKPOINT phase=${p} status=PASS summary="phase ${p} done" timestamp=2026-01-01T0${p}:00:00Z -->\n`;
    }
    await sm.appendToProgressLog(checkpoints);

    const progressLog = await readFile(sm.progressLogPath, 'utf-8');
    const validation = validateCompletion(progressLog, 'full', false, false);

    expect(validation.canComplete).toBe(true);
    expect(validation.missingPhases).toEqual([]);
    expect(validation.passedPhases).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
});

describe('E2E Integration: Negative Test Cases', () => {
  let sm: StateManager;

  beforeEach(async () => {
    await setupTestProject();
    sm = new StateManager(projectRoot, TOPIC);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('TC-N1: REGRESS without regressTo returns error, no mutation', async () => {
    await initStateOnDisk(sm, { phase: 4 });
    const progressLogBefore = await readFile(sm.progressLogPath, 'utf-8');

    const { result, earlyReturn } = await simulateCheckpointHandler(sm, {
      phase: 4,
      status: 'REGRESS',
      // regressTo intentionally omitted
    });

    expect(earlyReturn).toBe(true);
    expect(result).toHaveProperty(
      'error',
      'REGRESS requires regressTo parameter'
    );

    // No state mutation
    const stateAfter = await sm.loadAndValidate();
    expect(stateAfter.regressionCount).toBeUndefined();

    // No progress-log mutation
    const progressLogAfter = await readFile(sm.progressLogPath, 'utf-8');
    expect(progressLogAfter).toBe(progressLogBefore);
  });

  it('TC-N2: NEEDS_REVISION when iteration already at max -- BLOCK is sticky', async () => {
    // iteration=3 already at max for phase 1 (max=3)
    await initStateOnDisk(sm, { phase: 1, iteration: 3, interactive: true });

    const { result, earlyReturn } = await simulateCheckpointHandler(sm, {
      phase: 1,
      status: 'NEEDS_REVISION',
    });

    // newIteration = 3+1 = 4 > 3, BLOCK
    expect(earlyReturn).toBe(true);
    expect(result).toHaveProperty('status', 'BLOCKED');

    // Iteration persisted as 4
    const finalState = await sm.loadAndValidate();
    expect(finalState.iteration).toBe(4);

    // Another attempt: iteration=4+1=5, still blocked
    const second = await simulateCheckpointHandler(sm, {
      phase: 1,
      status: 'NEEDS_REVISION',
    });
    expect(second.earlyReturn).toBe(true);
    expect(second.result).toHaveProperty('status', 'BLOCKED');

    const finalState2 = await sm.loadAndValidate();
    expect(finalState2.iteration).toBe(5);
  });

  it('TC-N3: State rebuild with empty progress-log defaults correctly', async () => {
    const outputDir = sm.outputDir;
    await mkdir(outputDir, { recursive: true });

    // Empty progress-log (no header, no checkpoints)
    await writeFile(sm.progressLogPath, '', 'utf-8');

    const detectStackSpy = (await import('vitest')).vi
      .spyOn(sm, 'detectStack')
      .mockResolvedValue(TEST_STACK);
    const rebuilt = await sm.rebuildStateFromProgressLog();
    detectStackSpy.mockRestore();

    expect(rebuilt.phase).toBe(1);
    expect(rebuilt.status).toBe('IN_PROGRESS');
    expect(rebuilt.mode).toBe('full');
  });
});
