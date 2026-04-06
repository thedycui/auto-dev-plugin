/**
 * E2E / Integration tests for ship-integration (Phase 8).
 *
 * Covers T-INT-01 through T-INT-14 from e2e-test-cases.md.
 * Only UNIT and INTEGRATION level tests (E2E-DEFERRED tests are excluded).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — must be declared before imports that use them
// ---------------------------------------------------------------------------

const mockExecFile = vi.fn();
vi.mock('node:child_process', () => ({
  execFile: (...args: unknown[]) => mockExecFile(...args),
  exec: vi.fn(),
}));

const mockEvaluateTribunal = vi.fn();
vi.mock('../tribunal.js', () => ({
  evaluateTribunal: (...args: unknown[]) => mockEvaluateTribunal(...args),
}));

const mockLoadAndValidate = vi.fn();
const mockAtomicUpdate = vi.fn();
const mockInternalCheckpoint = vi.fn();
vi.mock('../state-manager.js', async importOriginal => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    StateManager: class MockStateManager {
      projectRoot: string;
      topic: string;
      outputDir: string;
      stateFilePath: string;
      progressLogPath: string;
      static async create(projectRoot: string, topic: string) {
        return new MockStateManager(projectRoot, topic);
      }
      constructor(projectRoot: string, topic: string) {
        this.projectRoot = projectRoot;
        this.topic = topic;
        this.outputDir = `/tmp/test-project/docs/auto-dev/${topic}`;
        this.stateFilePath = `${this.outputDir}/state.json`;
        this.progressLogPath = `${this.outputDir}/progress-log.md`;
      }
      async loadAndValidate() {
        return mockLoadAndValidate();
      }
      async atomicUpdate(updates: Record<string, unknown>) {
        return mockAtomicUpdate(updates);
      }
      async init() {}
      getFullState() {
        return mockLoadAndValidate();
      }
      getCheckpointLine(
        phase: number,
        _task: number | undefined,
        status: string,
        summary: string
      ) {
        return `<!-- CHECKPOINT phase=${phase} status=${status} summary="${summary}" -->`;
      }
      async appendToProgressLog() {}
    },
    internalCheckpoint: (...args: unknown[]) => mockInternalCheckpoint(...args),
    extractTaskList: actual['extractTaskList'],
  };
});

vi.mock('../template-renderer.js', () => ({
  TemplateRenderer: class MockRenderer {
    async render(
      _promptFile: string,
      _vars: Record<string, string>,
      _extra?: string
    ) {
      return {
        renderedPrompt: `Rendered prompt for ${_promptFile}`,
        warnings: [],
      };
    }
  },
}));

const mockStat = vi.fn();
const mockReadFile = vi.fn();
const mockWriteFile = vi.fn();
vi.mock('node:fs/promises', async importOriginal => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    stat: (...args: unknown[]) => mockStat(...args),
    readFile: (...args: unknown[]) => mockReadFile(...args),
    writeFile: (...args: unknown[]) => mockWriteFile(...args),
  };
});

import { computeNextTask, validateStep } from '../orchestrator.js';
import { computeNextDirective, validateCompletion } from '../phase-enforcer.js';
import { StateManager } from '../state-manager.js';
import type { StateJson } from '../types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeState(overrides?: Partial<Record<string, unknown>>) {
  return {
    topic: 'ship-test',
    mode: 'full' as const,
    phase: 1,
    status: 'IN_PROGRESS' as const,
    stack: {
      language: 'TypeScript',
      buildCmd: 'npm run build',
      testCmd: 'npm test',
      langChecklist: 'code-review-ts',
    },
    outputDir: '/tmp/test-project/docs/auto-dev/ship-test',
    projectRoot: '/tmp/test-project',
    startedAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    startCommit: 'abc123',
    ...overrides,
  };
}

function setupPassingBuildAndTest() {
  mockExecFile.mockImplementation(
    (_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
      cb(null, 'ok', '');
    }
  );
}

function getLastWrittenState(): Record<string, unknown> | null {
  const calls = mockAtomicUpdate.mock.calls;
  if (calls.length === 0) return null;
  return calls[calls.length - 1][0] as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// T-INT-02: computeNextTask complete Phase 8 progression (7 -> 8d PASS)
// ---------------------------------------------------------------------------

describe('T-INT-02: Complete Phase 8 progression path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWriteFile.mockResolvedValue(undefined);
    mockAtomicUpdate.mockResolvedValue(undefined);
    mockInternalCheckpoint.mockResolvedValue({
      ok: true,
      nextDirective: {
        phaseCompleted: true,
        nextPhase: null,
        nextPhaseName: null,
        mandate: '',
        canDeclareComplete: true,
      },
      stateUpdates: {},
    });
  });

  it('Step 1: Phase 7 PASS -> advances to 8a', async () => {
    const state = makeState({
      mode: 'full',
      ship: true,
      phase: 7,
      deployTarget: 'my-app',
    });
    mockLoadAndValidate.mockResolvedValue(state);

    mockReadFile.mockImplementation(async (path: string) => {
      if (path.includes('state.json')) {
        return JSON.stringify({ ...state, step: '7', stepIteration: 0 });
      }
      if (path.includes('retrospective.md')) {
        return 'x\n'.repeat(35);
      }
      throw new Error('ENOENT');
    });

    const result = await computeNextTask('/tmp/test-project', 'ship-test');

    expect(result.done).toBe(false);
    expect(result.step).toBe('8a');
    expect(result.agent).toBe('auto-dev:auto-dev-developer');
  });

  it('Step 2: 8a passes (no unpushed) -> advances to 8b', async () => {
    const state = makeState({
      mode: 'full',
      ship: true,
      phase: 8,
      deployTarget: 'my-app',
    });
    mockLoadAndValidate.mockResolvedValue(state);

    mockReadFile.mockImplementation(async (path: string) => {
      if (path.includes('state.json')) {
        return JSON.stringify({ ...state, step: '8a', stepIteration: 0 });
      }
      throw new Error('ENOENT');
    });

    // git log returns empty (no unpushed)
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
        cb(null, '', '');
      }
    );

    const result = await computeNextTask('/tmp/test-project', 'ship-test');

    expect(result.step).toBe('8b');
    expect(result.message).toContain('8a');
    expect(result.message).toContain('passed');
  });

  it('Step 3: 8b passes (SUCCEED) -> advances to 8c', async () => {
    const state = makeState({
      mode: 'full',
      ship: true,
      phase: 8,
      deployTarget: 'my-app',
    });
    mockLoadAndValidate.mockResolvedValue(state);

    mockReadFile.mockImplementation(async (path: string) => {
      if (path.includes('state.json')) {
        return JSON.stringify({ ...state, step: '8b', stepIteration: 0 });
      }
      if (path.includes('ship-build-result.md')) {
        return 'Build SUCCEED at 2026-03-27T10:00:00Z';
      }
      throw new Error('ENOENT');
    });

    const result = await computeNextTask('/tmp/test-project', 'ship-test');

    expect(result.step).toBe('8c');
    expect(result.message).toContain('8b');
    expect(result.message).toContain('passed');
  });

  it('Step 4: 8c passes (SUCCEED) -> advances to 8d', async () => {
    const state = makeState({
      mode: 'full',
      ship: true,
      phase: 8,
      deployTarget: 'my-app',
    });
    mockLoadAndValidate.mockResolvedValue(state);

    mockReadFile.mockImplementation(async (path: string) => {
      if (path.includes('state.json')) {
        return JSON.stringify({ ...state, step: '8c', stepIteration: 0 });
      }
      if (path.includes('ship-deploy-result.md')) {
        return 'Deploy SUCCEED to green environment';
      }
      throw new Error('ENOENT');
    });

    const result = await computeNextTask('/tmp/test-project', 'ship-test');

    expect(result.step).toBe('8d');
    expect(result.message).toContain('8c');
    expect(result.message).toContain('passed');
  });

  it('Step 5: 8d PASS -> done=true', async () => {
    const state = makeState({
      mode: 'full',
      ship: true,
      phase: 8,
      deployTarget: 'my-app',
    });
    mockLoadAndValidate.mockResolvedValue(state);

    mockReadFile.mockImplementation(async (path: string) => {
      if (path.includes('state.json')) {
        return JSON.stringify({ ...state, step: '8d', stepIteration: 0 });
      }
      if (path.includes('ship-verify-result.md')) {
        return 'Verification PASS - all checks green';
      }
      throw new Error('ENOENT');
    });

    const result = await computeNextTask('/tmp/test-project', 'ship-test');

    expect(result.done).toBe(true);
    expect(result.step).toBeNull();
  });

  it('Step 6: evaluateTribunal never called during Phase 8 (AC-12)', async () => {
    // Run 8b pass -> 8c to verify no tribunal
    const state = makeState({
      mode: 'full',
      ship: true,
      phase: 8,
      deployTarget: 'my-app',
    });
    mockLoadAndValidate.mockResolvedValue(state);

    mockReadFile.mockImplementation(async (path: string) => {
      if (path.includes('state.json')) {
        return JSON.stringify({ ...state, step: '8b', stepIteration: 0 });
      }
      if (path.includes('ship-build-result.md')) {
        return 'Build SUCCEED';
      }
      throw new Error('ENOENT');
    });

    await computeNextTask('/tmp/test-project', 'ship-test');

    expect(mockEvaluateTribunal).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// T-INT-03: Phase 8 CODE_BUG regress to Phase 3 and re-advance
// ---------------------------------------------------------------------------

describe('T-INT-03: Phase 8d CODE_BUG -> regress to Phase 3', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWriteFile.mockResolvedValue(undefined);
    mockAtomicUpdate.mockResolvedValue(undefined);
    mockInternalCheckpoint.mockResolvedValue({
      ok: true,
      nextDirective: {
        phaseCompleted: true,
        nextPhase: null,
        nextPhaseName: null,
        mandate: '',
        canDeclareComplete: true,
      },
      stateUpdates: {},
    });
  });

  it("CODE_BUG triggers regress to Phase 3, step='3', shipRound=1", async () => {
    const state = makeState({
      mode: 'full',
      ship: true,
      phase: 8,
      deployTarget: 'my-app',
      shipRound: 0,
      shipMaxRounds: 5,
    });
    mockLoadAndValidate.mockResolvedValue(state);

    mockReadFile.mockImplementation(async (path: string) => {
      if (path.includes('state.json')) {
        return JSON.stringify({ ...state, step: '8d', stepIteration: 0 });
      }
      if (path.includes('ship-verify-result.md')) {
        return 'Verification failed: CODE_BUG - NullPointerException in UserService';
      }
      if (path.includes('plan.md')) {
        return '## Task 3: Fix code\nFix the NullPointerException';
      }
      throw new Error('ENOENT');
    });

    const result = await computeNextTask('/tmp/test-project', 'ship-test');

    expect(result.done).toBe(false);
    expect(result.step).toBe('3');
    expect(result.agent).toBe('auto-dev:auto-dev-developer');
    expect(result.message).toContain('CODE_BUG');
    expect(result.message).toContain('round 1');

    // Verify regress state in atomicUpdate
    const regressCall = mockAtomicUpdate.mock.calls.find(
      (call: unknown[]) =>
        (call[0] as Record<string, unknown>).lastValidation === 'SHIP_REGRESS'
    );
    expect(regressCall).toBeDefined();
    const regressData = regressCall![0] as Record<string, unknown>;
    expect(regressData.phase).toBe(3);
    expect(regressData.step).toBe('3');
    expect(regressData.stepIteration).toBe(0);
    expect(regressData.shipRound).toBe(1);
    expect(regressData.approachState).toBeNull();
  });

  it('After regress, Phase 3 build+test pass -> advances to 4a', async () => {
    const state = makeState({
      mode: 'full',
      ship: true,
      phase: 3,
      deployTarget: 'my-app',
      shipRound: 1,
      shipMaxRounds: 5,
      lastValidation: 'SHIP_REGRESS',
    });
    mockLoadAndValidate.mockResolvedValue(state);

    mockReadFile.mockImplementation(async (path: string) => {
      if (path.includes('state.json')) {
        return JSON.stringify({ ...state, step: '3', stepIteration: 0 });
      }
      if (path.includes('plan.md')) {
        return '### Task 3: Fix\n';
      }
      throw new Error('ENOENT');
    });

    setupPassingBuildAndTest();

    const result = await computeNextTask('/tmp/test-project', 'ship-test');

    expect(result.step).toBe('4a');
    expect(result.done).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// T-INT-04: shipRound boundary values
// ---------------------------------------------------------------------------

describe('T-INT-04: shipRound boundary values (ESCALATE)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWriteFile.mockResolvedValue(undefined);
    mockAtomicUpdate.mockResolvedValue(undefined);
    mockInternalCheckpoint.mockResolvedValue({
      ok: true,
      nextDirective: {
        phaseCompleted: true,
        nextPhase: null,
        nextPhaseName: null,
        mandate: '',
        canDeclareComplete: true,
      },
      stateUpdates: {},
    });
  });

  it('T-INT-04a: shipRound=4, shipMaxRounds=5, CODE_BUG -> ESCALATE', async () => {
    const state = makeState({
      mode: 'full',
      ship: true,
      phase: 8,
      deployTarget: 'my-app',
      shipRound: 4,
      shipMaxRounds: 5,
    });
    mockLoadAndValidate.mockResolvedValue(state);

    mockReadFile.mockImplementation(async (path: string) => {
      if (path.includes('state.json')) {
        return JSON.stringify({ ...state, step: '8d', stepIteration: 0 });
      }
      if (path.includes('ship-verify-result.md')) {
        return 'Verification failed: CODE_BUG - still broken';
      }
      throw new Error('ENOENT');
    });

    const result = await computeNextTask('/tmp/test-project', 'ship-test');

    expect(result.done).toBe(false);
    expect(result.escalation).toBeDefined();
    expect(result.escalation?.reason).toBe('ship_max_rounds');
    expect(result.prompt).toBeNull();

    // Verify BLOCKED
    const blockedCall = mockAtomicUpdate.mock.calls.find(
      (call: unknown[]) =>
        (call[0] as Record<string, unknown>).status === 'BLOCKED'
    );
    expect(blockedCall).toBeDefined();
  });

  it('T-INT-04b: shipRound=0, shipMaxRounds=1, CODE_BUG -> ESCALATE (minimal boundary)', async () => {
    const state = makeState({
      mode: 'full',
      ship: true,
      phase: 8,
      deployTarget: 'my-app',
      shipRound: 0,
      shipMaxRounds: 1,
    });
    mockLoadAndValidate.mockResolvedValue(state);

    mockReadFile.mockImplementation(async (path: string) => {
      if (path.includes('state.json')) {
        return JSON.stringify({ ...state, step: '8d', stepIteration: 0 });
      }
      if (path.includes('ship-verify-result.md')) {
        return 'Verification failed: CODE_BUG - broken';
      }
      throw new Error('ENOENT');
    });

    const result = await computeNextTask('/tmp/test-project', 'ship-test');

    expect(result.escalation).toBeDefined();
    expect(result.escalation?.reason).toBe('ship_max_rounds');
  });

  it('T-INT-04c: shipRound=3, shipMaxRounds=5, CODE_BUG -> no ESCALATE, regress to Phase 3', async () => {
    const state = makeState({
      mode: 'full',
      ship: true,
      phase: 8,
      deployTarget: 'my-app',
      shipRound: 3,
      shipMaxRounds: 5,
    });
    mockLoadAndValidate.mockResolvedValue(state);

    mockReadFile.mockImplementation(async (path: string) => {
      if (path.includes('state.json')) {
        return JSON.stringify({ ...state, step: '8d', stepIteration: 0 });
      }
      if (path.includes('ship-verify-result.md')) {
        return 'Verification failed: CODE_BUG - still issues';
      }
      if (path.includes('plan.md')) {
        return '## Task 3: Fix\nFix issues';
      }
      throw new Error('ENOENT');
    });

    const result = await computeNextTask('/tmp/test-project', 'ship-test');

    expect(result.step).toBe('3');
    expect(result.escalation).toBeUndefined();
    expect(result.message).toContain('round 4');
  });
});

// ---------------------------------------------------------------------------
// T-INT-05: skipE2e + ship
// ---------------------------------------------------------------------------

describe('T-INT-05: skipE2e + ship combination', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWriteFile.mockResolvedValue(undefined);
    mockAtomicUpdate.mockResolvedValue(undefined);
    mockInternalCheckpoint.mockResolvedValue({
      ok: true,
      nextDirective: {
        phaseCompleted: true,
        nextPhase: null,
        nextPhaseName: null,
        mandate: '',
        canDeclareComplete: true,
      },
      stateUpdates: {},
    });
  });

  it('skipE2e=true skips Phase 5 but Phase 8 remains: 4a -> 6', async () => {
    const state = makeState({
      mode: 'full',
      ship: true,
      skipE2e: true,
      phase: 4,
      deployTarget: 'my-app',
    });
    mockLoadAndValidate.mockResolvedValue(state);

    mockReadFile.mockImplementation(async (path: string) => {
      if (path.includes('state.json')) {
        return JSON.stringify({ ...state, step: '4a', stepIteration: 0 });
      }
      if (path.includes('plan.md')) return '## Task\n';
      throw new Error('ENOENT');
    });

    setupPassingBuildAndTest();
    mockEvaluateTribunal.mockResolvedValue({ verdict: 'PASS', issues: [] });

    const result = await computeNextTask('/tmp/test-project', 'ship-test');

    // Should advance to step 6 (skip 5a/5b/5c)
    expect(result.step).toBe('6');
  });

  it('skipE2e=true, Phase 7 -> 8a (Phase 8 not skipped)', async () => {
    const state = makeState({
      mode: 'full',
      ship: true,
      skipE2e: true,
      phase: 7,
      deployTarget: 'my-app',
    });
    mockLoadAndValidate.mockResolvedValue(state);

    mockReadFile.mockImplementation(async (path: string) => {
      if (path.includes('state.json')) {
        return JSON.stringify({ ...state, step: '7', stepIteration: 0 });
      }
      if (path.includes('retrospective.md')) {
        return 'x\n'.repeat(35);
      }
      throw new Error('ENOENT');
    });

    const result = await computeNextTask('/tmp/test-project', 'ship-test');

    expect(result.step).toBe('8a');
  });
});

// ---------------------------------------------------------------------------
// T-INT-06: dryRun + ship
// ---------------------------------------------------------------------------

describe('T-INT-06: dryRun + ship combination', () => {
  it('dryRun=true: maxPhase=2 regardless of ship, canDeclareComplete at Phase 2', () => {
    const state = {
      topic: 'test',
      mode: 'full' as const,
      phase: 2,
      status: 'IN_PROGRESS' as const,
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
      dryRun: true,
      ship: true,
    } satisfies StateJson;

    const result = computeNextDirective(2, 'PASS', state);
    expect(result.canDeclareComplete).toBe(true);
  });

  it('dryRun=true + ship=true: validateCompletion requires Phase 1,2,8 (ship appends 8 to basePhases)', () => {
    // dryRun basePhases=[1,2], ship appends 8 -> required=[1,2,8]
    const logWithout8 = [1, 2]
      .map(p => `<!-- CHECKPOINT phase=${p} status=PASS -->`)
      .join('\n');
    const result1 = validateCompletion(logWithout8, 'full', true, false, true);
    expect(result1.canComplete).toBe(false);
    expect(result1.missingPhases).toContain(8);

    // With Phase 8 PASS -> canComplete
    const logWith8 = [1, 2, 8]
      .map(p => `<!-- CHECKPOINT phase=${p} status=PASS -->`)
      .join('\n');
    const result2 = validateCompletion(logWith8, 'full', true, false, true);
    expect(result2.canComplete).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// T-INT-07: turbo + ship
// ---------------------------------------------------------------------------

describe('T-INT-07: turbo + ship combination', () => {
  it('turbo mode: maxPhase=3 regardless of ship, canDeclareComplete at Phase 3', () => {
    const state = {
      topic: 'test',
      mode: 'turbo' as const,
      phase: 3,
      status: 'IN_PROGRESS' as const,
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
      ship: true,
    } satisfies StateJson;

    const result = computeNextDirective(3, 'PASS', state);
    expect(result.canDeclareComplete).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// T-INT-08: validateCompletion ship gate (from auto_dev_complete path)
// ---------------------------------------------------------------------------

describe('T-INT-08: validateCompletion ship gate', () => {
  const makeLog = (phases: number[]) =>
    phases.map(p => `<!-- CHECKPOINT phase=${p} status=PASS -->`).join('\n');

  it('T-INT-08a: ship=true but Phase 8 not PASS -> canComplete=false, missingPhases contains 8', () => {
    const log = makeLog([1, 2, 3, 4, 5, 6, 7]);
    const result = validateCompletion(log, 'full', false, false, true);
    expect(result.canComplete).toBe(false);
    expect(result.missingPhases).toContain(8);
  });

  it('T-INT-08b: ship=true with Phase 8 PASS -> canComplete=true', () => {
    const log = makeLog([1, 2, 3, 4, 5, 6, 7, 8]);
    const result = validateCompletion(log, 'full', false, false, true);
    expect(result.canComplete).toBe(true);
    expect(result.missingPhases).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// T-INT-09: Phase 8 step validation failure iteration + escalation
// ---------------------------------------------------------------------------

describe('T-INT-09: 8b validation failure iteration and escalation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWriteFile.mockResolvedValue(undefined);
    mockAtomicUpdate.mockResolvedValue(undefined);
    mockInternalCheckpoint.mockResolvedValue({
      ok: true,
      nextDirective: {
        phaseCompleted: true,
        nextPhase: null,
        nextPhaseName: null,
        mandate: '',
        canDeclareComplete: true,
      },
      stateUpdates: {},
    });
  });

  it('iteration 0: 8b fails (no file) -> stays at 8b, prompt non-null', async () => {
    const state = makeState({
      mode: 'full',
      ship: true,
      phase: 8,
      deployTarget: 'my-app',
    });
    mockLoadAndValidate.mockResolvedValue(state);

    mockReadFile.mockImplementation(async (path: string) => {
      if (path.includes('state.json')) {
        return JSON.stringify({ ...state, step: '8b', stepIteration: 0 });
      }
      throw new Error('ENOENT');
    });

    const result = await computeNextTask('/tmp/test-project', 'ship-test');

    expect(result.step).toBe('8b');
    expect(result.prompt).not.toBeNull();

    // stepIteration should be incremented to 1
    const written = getLastWrittenState();
    expect(written!.stepIteration).toBe(1);
  });

  it('iteration 1: 8b fails again -> stays at 8b, prompt non-null', async () => {
    const state = makeState({
      mode: 'full',
      ship: true,
      phase: 8,
      deployTarget: 'my-app',
    });
    mockLoadAndValidate.mockResolvedValue(state);

    mockReadFile.mockImplementation(async (path: string) => {
      if (path.includes('state.json')) {
        return JSON.stringify({ ...state, step: '8b', stepIteration: 1 });
      }
      throw new Error('ENOENT');
    });

    const result = await computeNextTask('/tmp/test-project', 'ship-test');

    expect(result.step).toBe('8b');
    expect(result.prompt).not.toBeNull();

    const written = getLastWrittenState();
    expect(written!.stepIteration).toBe(2);
  });

  it('iteration 2: 8b fails third time -> ESCALATE (iteration_limit_exceeded)', async () => {
    const state = makeState({
      mode: 'full',
      ship: true,
      phase: 8,
      deployTarget: 'my-app',
    });
    mockLoadAndValidate.mockResolvedValue(state);

    mockReadFile.mockImplementation(async (path: string) => {
      if (path.includes('state.json')) {
        return JSON.stringify({ ...state, step: '8b', stepIteration: 3 });
      }
      throw new Error('ENOENT');
    });

    const result = await computeNextTask('/tmp/test-project', 'ship-test');

    expect(result.escalation).toBeDefined();
    expect(result.escalation?.reason).toBe('iteration_limit_exceeded');
    expect(result.prompt).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// T-INT-10: Phase 8d ENV_ISSUE does not regress
// ---------------------------------------------------------------------------

describe('T-INT-10: Phase 8d ENV_ISSUE does not trigger regress', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWriteFile.mockResolvedValue(undefined);
    mockAtomicUpdate.mockResolvedValue(undefined);
    mockInternalCheckpoint.mockResolvedValue({
      ok: true,
      nextDirective: {
        phaseCompleted: true,
        nextPhase: null,
        nextPhaseName: null,
        mandate: '',
        canDeclareComplete: true,
      },
      stateUpdates: {},
    });
  });

  it('ENV_ISSUE stays at 8d, no phase change, shipRound unchanged', async () => {
    const state = makeState({
      mode: 'full',
      ship: true,
      phase: 8,
      deployTarget: 'my-app',
      shipRound: 0,
      shipMaxRounds: 5,
    });
    mockLoadAndValidate.mockResolvedValue(state);

    mockReadFile.mockImplementation(async (path: string) => {
      if (path.includes('state.json')) {
        return JSON.stringify({ ...state, step: '8d', stepIteration: 0 });
      }
      if (path.includes('ship-verify-result.md')) {
        return 'Verification failed: ENV_ISSUE - connection refused to database';
      }
      throw new Error('ENOENT');
    });

    const result = await computeNextTask('/tmp/test-project', 'ship-test');

    expect(result.step).toBe('8d');
    expect(result.done).toBe(false);
    expect(result.prompt).not.toBeNull();

    // No SHIP_REGRESS in atomicUpdate calls
    const regressCall = mockAtomicUpdate.mock.calls.find(
      (call: unknown[]) =>
        (call[0] as Record<string, unknown>).lastValidation === 'SHIP_REGRESS'
    );
    expect(regressCall).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// T-INT-11: ship-verify-result.md with unknown content (UNIT)
// ---------------------------------------------------------------------------

describe('T-INT-11: ship-verify-result.md unknown content (no PASS/CODE_BUG/ENV_ISSUE)', () => {
  it("validateStep('8d') returns passed=false, no regressToPhase (ENV_ISSUE fallback)", async () => {
    mockReadFile.mockImplementation(async (path: string) => {
      if (path.includes('ship-verify-result.md')) {
        return 'Verification FAILED: unknown error';
      }
      throw new Error('ENOENT');
    });

    const sm = new StateManager('/tmp/test-project', 'ship-test') as any;
    const state = makeState({
      mode: 'full',
      ship: true,
      phase: 8,
    }) as unknown as StateJson;

    const result = await validateStep(
      '8d',
      '/tmp/test-project/docs/auto-dev/ship-test',
      '/tmp/test-project',
      'npm run build',
      'npm test',
      sm,
      state,
      'ship-test'
    );

    expect(result.passed).toBe(false);
    expect(result.regressToPhase).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// T-INT-12: ship-verify-result.md with both PASS and CODE_BUG (priority test)
// ---------------------------------------------------------------------------

describe('T-INT-12: PASS takes priority over CODE_BUG in ship-verify-result.md', () => {
  it('content with both PASS and CODE_BUG -> passed=true (PASS checked first)', async () => {
    mockReadFile.mockImplementation(async (path: string) => {
      if (path.includes('ship-verify-result.md')) {
        return 'Overall PASS but had CODE_BUG in one test';
      }
      throw new Error('ENOENT');
    });

    const sm = new StateManager('/tmp/test-project', 'ship-test') as any;
    const state = makeState({
      mode: 'full',
      ship: true,
      phase: 8,
    }) as unknown as StateJson;

    const result = await validateStep(
      '8d',
      '/tmp/test-project/docs/auto-dev/ship-test',
      '/tmp/test-project',
      'npm run build',
      'npm test',
      sm,
      state,
      'ship-test'
    );

    expect(result.passed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// T-INT-13: ship-build-result.md case sensitivity (UNIT)
// ---------------------------------------------------------------------------

describe('T-INT-13: ship-build-result.md case sensitivity', () => {
  it("lowercase 'succeed' -> passed=false (includes('SUCCEED') is case-sensitive)", async () => {
    mockReadFile.mockImplementation(async (path: string) => {
      if (path.includes('ship-build-result.md')) {
        return 'Build succeed at 2026-03-27T10:00:00Z';
      }
      throw new Error('ENOENT');
    });

    const sm = new StateManager('/tmp/test-project', 'ship-test') as any;
    const state = makeState({
      mode: 'full',
      ship: true,
      phase: 8,
    }) as unknown as StateJson;

    const result = await validateStep(
      '8b',
      '/tmp/test-project/docs/auto-dev/ship-test',
      '/tmp/test-project',
      'npm run build',
      'npm test',
      sm,
      state,
      'ship-test'
    );

    expect(result.passed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// T-INT-14: 8a git command execution error (UNIT)
// ---------------------------------------------------------------------------

describe('T-INT-14: 8a git command execution failure', () => {
  it('git exitCode=128 -> passed=false, feedback contains error message', async () => {
    // Mock shell() -> exitCode=128
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
        cb({ code: 128 }, '', 'fatal: not a git repository');
      }
    );

    const sm = new StateManager('/tmp/test-project', 'ship-test') as any;
    const state = makeState({
      mode: 'full',
      ship: true,
      phase: 8,
    }) as unknown as StateJson;

    const result = await validateStep(
      '8a',
      '/tmp/test-project/docs/auto-dev/ship-test',
      '/tmp/test-project',
      'npm run build',
      'npm test',
      sm,
      state,
      'ship-test'
    );

    expect(result.passed).toBe(false);
    expect(result.feedback).toContain('git');
  });
});
