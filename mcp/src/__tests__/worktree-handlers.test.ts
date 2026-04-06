/**
 * Worktree handler tests — AC-2 and AC-12
 *
 * These tests exercise the auto_dev_complete and auto_dev_init tool handlers
 * in index.ts by capturing registered handlers via a mock MCP SDK.
 *
 * AC-2: auto_dev_complete calls git merge then git worktree remove (merge+cleanup)
 * AC-12: auto_dev_init resume path reuses or rebuilds worktree
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Capture registered tool handlers before any imports run them
// ---------------------------------------------------------------------------

const toolHandlers = new Map<string, Function>();

vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => ({
  McpServer: class {
    tool(name: string, _desc: string, _schema: unknown, handler: Function) {
      toolHandlers.set(name, handler);
    }
    async connect(_transport: unknown) {
      // no-op: prevent actual stdio connection
    }
  },
}));

vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: class {},
}));

// ---------------------------------------------------------------------------
// child_process mock — intercept all git calls (both static & dynamic imports)
// ---------------------------------------------------------------------------

const shellCalls: Array<{ prog: string; args: string[]; cwd: string }> = [];
const mockExecFile = vi.fn();
const mockExec = vi.fn();

vi.mock('node:child_process', () => ({
  execFile: (...args: unknown[]) => {
    const [prog, progArgs, opts, cb] = args as [
      string,
      string[],
      { cwd?: string },
      Function,
    ];
    shellCalls.push({ prog, args: progArgs ?? [], cwd: opts?.cwd ?? '' });
    return mockExecFile(...args);
  },
  exec: (...args: unknown[]) => {
    return mockExec(...args);
  },
}));

// ---------------------------------------------------------------------------
// State manager mock
// ---------------------------------------------------------------------------

const mockLoadAndValidate = vi.fn();
const mockAtomicUpdate = vi.fn();
const mockAtomicWrite = vi.fn();
const mockAppendToProgressLog = vi.fn();
const mockOutputDirExists = vi.fn();
const mockRebuildStateFromProgressLog = vi.fn();
const mockIsCheckpointDuplicate = vi.fn();

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
      async atomicWrite(path: string, content: string) {
        return mockAtomicWrite(path, content);
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
      async appendToProgressLog(msg: string) {
        mockAppendToProgressLog(msg);
      }
      async outputDirExists() {
        return mockOutputDirExists();
      }
      async rebuildStateFromProgressLog() {
        return mockRebuildStateFromProgressLog();
      }
      async isCheckpointDuplicate() {
        return false;
      }
    },
    internalCheckpoint: actual['internalCheckpoint'],
    extractTaskList: actual['extractTaskList'],
    extractDocSummary: actual['extractDocSummary'],
  };
});

// ---------------------------------------------------------------------------
// fs/promises mock
// ---------------------------------------------------------------------------

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
    mkdir: vi.fn().mockResolvedValue(undefined),
    mkdtemp: vi.fn().mockResolvedValue('/tmp/mock-tmp'),
    copyFile: vi.fn().mockResolvedValue(undefined),
    rm: vi.fn().mockResolvedValue(undefined),
    rename: vi.fn().mockResolvedValue(undefined),
    access: vi.fn().mockResolvedValue(undefined),
  };
});

// ---------------------------------------------------------------------------
// Other index.ts dependency mocks
// ---------------------------------------------------------------------------

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

vi.mock('../git-manager.js', () => ({
  GitManager: class MockGitManager {
    constructor(_projectRoot: string) {}
    async getStatus() {
      return { currentBranch: 'main', isDirty: false, commitHash: 'abc123' };
    }
    async getChangedFiles(_opts: unknown) {
      return [];
    }
    async diffCheck(_files: unknown, _commit: unknown) {
      return { ok: true, diff: '' };
    }
    async rollback(_commit: unknown, _files: unknown) {
      return { ok: true };
    }
  },
}));

vi.mock('../tribunal.js', () => ({
  evaluateTribunal: vi.fn().mockResolvedValue({ verdict: 'PASS', issues: [] }),
  executeTribunal: vi.fn().mockResolvedValue({ verdict: 'PASS', issues: [] }),
  crossValidate: vi.fn().mockResolvedValue([]),
  buildTribunalLog: vi.fn().mockReturnValue(''),
  getClaudePath: vi.fn().mockReturnValue('/usr/local/bin/claude'),
}));

vi.mock('../phase-enforcer.js', () => ({
  validateCompletion: vi.fn().mockReturnValue({
    canComplete: true,
    passedPhases: [1, 2, 3, 4, 5, 6, 7],
    missingPhases: [],
    message: 'All phases passed',
  }),
  validatePhase5Artifacts: vi.fn().mockReturnValue({ ok: true }),
  validatePhase6Artifacts: vi.fn().mockReturnValue({ ok: true }),
  validatePhase7Artifacts: vi.fn().mockReturnValue({ ok: true }),
  countTestFiles: vi.fn().mockReturnValue(5),
  checkIterationLimit: vi.fn().mockReturnValue({ exceeded: false }),
  validatePredecessor: vi.fn().mockReturnValue({ ok: true }),
  parseInitMarker: vi.fn().mockReturnValue(null),
  validatePhase1ReviewArtifact: vi.fn().mockReturnValue({ ok: true }),
  validatePhase2ReviewArtifact: vi.fn().mockReturnValue({ ok: true }),
  isTddExemptTask: vi.fn().mockReturnValue(false),
  computeNextDirective: vi
    .fn()
    .mockReturnValue({ phaseCompleted: false, nextPhase: 3 }),
  validateAcJson: vi.fn().mockReturnValue({ ok: true }),
  validateAcIntegrity: vi.fn().mockReturnValue({ ok: true }),
}));

vi.mock('../tdd-gate.js', () => ({
  validateRedPhase: vi.fn().mockResolvedValue({ ok: true }),
  buildTestCommand: vi.fn().mockReturnValue('npm test'),
  TDD_TIMEOUTS: { red: 30_000, green: 120_000 },
  isImplFile: vi.fn().mockReturnValue(false),
}));

vi.mock('../retrospective.js', () => ({
  runRetrospective: vi.fn().mockResolvedValue({ ok: true }),
}));

vi.mock('../tribunal-schema.js', () => ({
  TRIBUNAL_PHASES: [4, 5, 6],
}));

vi.mock('../retrospective-data.js', () => ({
  generateRetrospectiveData: vi.fn().mockResolvedValue({}),
}));

vi.mock('../orchestrator.js', () => ({
  computeNextTask: vi
    .fn()
    .mockResolvedValue({ done: false, step: '1a', agent: null, prompt: null }),
  firstStepForPhase: vi.fn().mockReturnValue('1a'),
  validateResetRequest: vi.fn().mockReturnValue({ ok: true }),
}));

vi.mock('../ac-runner.js', () => ({
  runStructuralAssertions: vi
    .fn()
    .mockResolvedValue({ passed: true, results: [] }),
}));

vi.mock('../ac-test-binding.js', () => ({
  discoverAcBindings: vi.fn().mockResolvedValue([]),
  validateAcBindingCoverage: vi.fn().mockReturnValue({ ok: true }),
  runAcBoundTests: vi.fn().mockResolvedValue({ passed: true, results: [] }),
}));

vi.mock('../ac-schema.js', () => ({
  AcceptanceCriteriaSchema: {
    safeParse: vi
      .fn()
      .mockReturnValue({ success: true, data: { criteria: [] } }),
  },
}));

vi.mock('../lessons-manager.js', () => ({
  LessonsManager: class {
    constructor(_dir: string) {}
    async addLesson(_l: unknown) {}
    async getLessons() {
      return [];
    }
    async giveFeedback(_id: string, _fb: unknown) {}
  },
}));

// ---------------------------------------------------------------------------
// Import index.js AFTER all mocks are declared
// This triggers server.tool() registrations
// ---------------------------------------------------------------------------

await import('../index.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCompleteState(overrides?: Partial<Record<string, unknown>>) {
  return {
    topic: 'test-topic',
    mode: 'full' as const,
    phase: 7,
    status: 'PASS' as const,
    stack: {
      language: 'TypeScript',
      buildCmd: 'npm run build',
      testCmd: 'npm test',
      langChecklist: 'code-review-ts',
    },
    outputDir: '/tmp/test-project/docs/auto-dev/test-topic',
    projectRoot: '/tmp/test-project',
    startedAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    startCommit: 'abc123',
    ...overrides,
  };
}

function makeResumeState(overrides?: Partial<Record<string, unknown>>) {
  return {
    topic: 'test-topic',
    mode: 'full' as const,
    phase: 3,
    status: 'IN_PROGRESS' as const,
    stack: {
      language: 'TypeScript',
      buildCmd: 'npm run build',
      testCmd: 'npm test',
      langChecklist: 'code-review-ts',
    },
    outputDir: '/tmp/test-project/docs/auto-dev/test-topic',
    projectRoot: '/tmp/test-project',
    startedAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    startCommit: 'abc123',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AC-2: auto_dev_complete worktree merge and cleanup', () => {
  beforeEach(() => {
    shellCalls.length = 0;
    vi.clearAllMocks();
    mockWriteFile.mockResolvedValue(undefined);
    mockAtomicUpdate.mockResolvedValue(undefined);
    mockAtomicWrite.mockResolvedValue(undefined);

    // progress-log with no INIT marker (parseInitMarker returns null → already mocked)
    mockReadFile.mockImplementation((path: string) => {
      if (path.includes('progress-log')) {
        return Promise.resolve(
          '<!-- CHECKPOINT phase=7 status=PASS summary="Done" -->\n'
        );
      }
      if (path.includes('summary.md') || path.includes('state.json')) {
        return Promise.reject(new Error('ENOENT'));
      }
      return Promise.reject(new Error('ENOENT'));
    });

    // exec (used for build/test in auto_dev_complete): succeed
    mockExec.mockImplementation(
      (_cmd: string, _opts: Record<string, unknown>, cb: Function) => {
        cb(null, '', '');
      }
    );
  });

  it('[AC-2] auto_dev_complete calls git merge then git worktree remove', async () => {
    const worktreeRoot = '/tmp/.auto-dev-wt-test-topic';
    const state = makeCompleteState({
      worktreeRoot,
      worktreeBranch: 'auto-dev/test-topic',
      sourceBranch: 'main',
    });
    mockLoadAndValidate.mockResolvedValue(state);

    // git status --porcelain: returns dirty status to trigger commit
    // git add/commit/merge/worktree remove: all succeed
    mockExecFile.mockImplementation(
      (
        _prog: string,
        args: string[],
        _opts: Record<string, unknown>,
        cb: Function
      ) => {
        const argsStr = args.join(' ');
        if (argsStr.includes('status --porcelain')) {
          cb(null, 'M some/file.ts', '');
        } else {
          cb(null, '', '');
        }
      }
    );

    const handler = toolHandlers.get('auto_dev_complete');
    expect(handler).toBeDefined();

    await handler!({ projectRoot: '/tmp/test-project', topic: 'test-topic' });

    // Should have called git add -A in worktreeRoot
    const addCall = shellCalls.find(
      c =>
        c.prog === 'git' &&
        c.args.includes('add') &&
        c.args.includes('-A') &&
        c.cwd === worktreeRoot
    );
    // Should have called git commit in worktreeRoot
    const commitCall = shellCalls.find(
      c =>
        c.prog === 'git' && c.args.includes('commit') && c.cwd === worktreeRoot
    );
    // Should have called git merge in projectRoot
    const mergeCall = shellCalls.find(
      c =>
        c.prog === 'git' &&
        c.args.includes('merge') &&
        c.args.includes('auto-dev/test-topic')
    );
    // Should have called git worktree remove
    const removeCall = shellCalls.find(
      c =>
        c.prog === 'git' &&
        c.args.includes('worktree') &&
        c.args.includes('remove')
    );

    expect(addCall).toBeDefined();
    expect(commitCall).toBeDefined();
    expect(mergeCall).toBeDefined();
    expect(removeCall).toBeDefined();

    // Verify order: commit before merge, merge before remove
    const addIdx = shellCalls.indexOf(addCall!);
    const mergeIdx = shellCalls.indexOf(mergeCall!);
    const removeIdx = shellCalls.indexOf(removeCall!);
    expect(addIdx).toBeLessThan(mergeIdx);
    expect(mergeIdx).toBeLessThan(removeIdx);

    // Verify atomicUpdate clears worktreeRoot
    expect(mockAtomicUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ worktreeRoot: null })
    );
  });

  it('[AC-2] auto_dev_complete skips commit when worktree is clean', async () => {
    const worktreeRoot = '/tmp/.auto-dev-wt-test-topic';
    const state = makeCompleteState({
      worktreeRoot,
      worktreeBranch: 'auto-dev/test-topic',
      sourceBranch: 'main',
    });
    mockLoadAndValidate.mockResolvedValue(state);

    // git status --porcelain: empty (clean)
    mockExecFile.mockImplementation(
      (
        _prog: string,
        _args: string[],
        _opts: Record<string, unknown>,
        cb: Function
      ) => {
        cb(null, '', '');
      }
    );

    const handler = toolHandlers.get('auto_dev_complete');
    await handler!({ projectRoot: '/tmp/test-project', topic: 'test-topic' });

    // Should NOT have called git add/commit (clean worktree)
    const addCall = shellCalls.find(
      c => c.prog === 'git' && c.args.includes('add') && c.cwd === worktreeRoot
    );
    expect(addCall).toBeUndefined();

    // Should still merge and remove
    const mergeCall = shellCalls.find(
      c => c.prog === 'git' && c.args.includes('merge')
    );
    const removeCall = shellCalls.find(
      c =>
        c.prog === 'git' &&
        c.args.includes('worktree') &&
        c.args.includes('remove')
    );
    expect(mergeCall).toBeDefined();
    expect(removeCall).toBeDefined();
  });
});

describe('AC-12: worktree resume — reuse or rebuild', () => {
  beforeEach(() => {
    shellCalls.length = 0;
    vi.clearAllMocks();
    mockWriteFile.mockResolvedValue(undefined);
    mockAtomicUpdate.mockResolvedValue(undefined);
    mockOutputDirExists.mockResolvedValue(true);

    // No progress-log tasks (no task-level resume info needed)
    mockReadFile.mockImplementation((path: string) => {
      if (path.includes('progress-log')) {
        return Promise.resolve('');
      }
      return Promise.reject(new Error('ENOENT'));
    });
  });

  it('[AC-12] resume reuses existing worktree when worktreeRoot dir still exists', async () => {
    const worktreeRoot = '/tmp/.auto-dev-wt-test-topic';
    const state = makeResumeState({
      worktreeRoot,
      worktreeBranch: 'auto-dev/test-topic',
      sourceBranch: 'main',
    });
    mockLoadAndValidate.mockResolvedValue(state);

    // stat(worktreeRoot) succeeds → worktree exists
    mockStat.mockImplementation((path: string) => {
      if (path === worktreeRoot) return Promise.resolve({});
      return Promise.reject(new Error('ENOENT'));
    });

    // git branch --show-current returns correct branch → no warning
    mockExecFile.mockImplementation(
      (
        _prog: string,
        args: string[],
        _opts: Record<string, unknown>,
        cb: Function
      ) => {
        const argsStr = args.join(' ');
        if (argsStr.includes('branch --show-current')) {
          cb(null, 'auto-dev/test-topic\n', '');
        } else {
          cb(null, '', '');
        }
      }
    );

    const handler = toolHandlers.get('auto_dev_init');
    expect(handler).toBeDefined();

    await handler!({
      projectRoot: '/tmp/test-project',
      topic: 'test-topic',
      onConflict: 'resume',
    });

    // Should NOT call "git worktree add" (no rebuild)
    const addCall = shellCalls.find(
      c =>
        c.prog === 'git' &&
        c.args.includes('worktree') &&
        c.args.includes('add') &&
        !c.args.includes('--detach')
    );
    expect(addCall).toBeUndefined();
  });

  it('[AC-12] resume rebuilds worktree from branch when worktreeRoot dir deleted', async () => {
    const worktreeRoot = '/tmp/.auto-dev-wt-test-topic';
    const state = makeResumeState({
      worktreeRoot,
      worktreeBranch: 'auto-dev/test-topic',
      sourceBranch: 'main',
    });
    mockLoadAndValidate.mockResolvedValue(state);

    // stat(worktreeRoot) throws ENOENT → worktree directory deleted
    mockStat.mockImplementation((_path: string) => {
      return Promise.reject(new Error('ENOENT'));
    });

    // git branch --list returns branch name → branch exists, can rebuild
    // git worktree add succeeds
    mockExecFile.mockImplementation(
      (
        _prog: string,
        args: string[],
        _opts: Record<string, unknown>,
        cb: Function
      ) => {
        const argsStr = args.join(' ');
        if (argsStr.includes('branch --list')) {
          cb(null, '  auto-dev/test-topic\n', '');
        } else if (argsStr.includes('worktree add')) {
          cb(null, '', '');
        } else {
          cb(null, '', '');
        }
      }
    );

    const handler = toolHandlers.get('auto_dev_init');
    await handler!({
      projectRoot: '/tmp/test-project',
      topic: 'test-topic',
      onConflict: 'resume',
    });

    // Should have called "git worktree add <worktreeRoot> auto-dev/test-topic" to rebuild
    const addCall = shellCalls.find(
      c =>
        c.prog === 'git' &&
        c.args.includes('worktree') &&
        c.args.includes('add') &&
        c.args.includes('auto-dev/test-topic')
    );
    expect(addCall).toBeDefined();
  });
});
