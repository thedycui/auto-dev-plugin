/**
 * Tests for rebuildStateFromProgressLog (StateManager) and parseAllCheckpoints/parseHeaderField.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StateManager } from '../state-manager.js';

// Mock node:fs/promises
vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn().mockResolvedValue(undefined),
  rename: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
  stat: vi.fn().mockResolvedValue({ isDirectory: () => true }),
}));

import { readFile } from 'node:fs/promises';

const mockedReadFile = vi.mocked(readFile);

describe('rebuildStateFromProgressLog', () => {
  let sm: StateManager;

  beforeEach(() => {
    vi.clearAllMocks();
    sm = new StateManager('/tmp/project', 'test-topic');

    // Mock detectStack to return a valid stack
    vi.spyOn(sm, 'detectStack').mockResolvedValue({
      language: 'TypeScript',
      buildCmd: 'npm run build',
      testCmd: 'npm test',
      langChecklist: 'ts.md',
    });
  });

  it('normal progress-log with checkpoints -> correct phase/status/mode', async () => {
    const progressLog =
      `# auto-dev progress-log: test-topic\n\n` +
      `> Started: 2026-01-01T00:00:00Z  \n` +
      `> Mode: full  \n` +
      `> Stack: TypeScript\n\n` +
      `<!-- CHECKPOINT phase=1 status=PASS timestamp=2026-01-01T00:01:00Z -->\n` +
      `<!-- CHECKPOINT phase=2 status=PASS timestamp=2026-01-01T00:02:00Z -->\n` +
      `<!-- CHECKPOINT phase=3 status=NEEDS_REVISION timestamp=2026-01-01T00:03:00Z -->\n`;

    mockedReadFile.mockResolvedValue(progressLog as any);

    const result = await sm.rebuildStateFromProgressLog();
    expect(result.phase).toBe(3);
    expect(result.status).toBe('NEEDS_REVISION');
    expect(result.mode).toBe('full');
    expect(result.startedAt).toBe('2026-01-01T00:00:00Z');
  });

  it('no CHECKPOINT -> phase=1, status=IN_PROGRESS', async () => {
    const progressLog =
      `# auto-dev progress-log: test-topic\n\n` +
      `> Started: 2026-01-01T00:00:00Z  \n` +
      `> Mode: quick  \n` +
      `> Stack: TypeScript\n\n`;

    mockedReadFile.mockResolvedValue(progressLog as any);

    const result = await sm.rebuildStateFromProgressLog();
    expect(result.phase).toBe(1);
    expect(result.status).toBe('IN_PROGRESS');
    expect(result.mode).toBe('quick');
  });

  it('progress-log does not exist -> throws error', async () => {
    mockedReadFile.mockRejectedValue(new Error('ENOENT: no such file'));

    await expect(sm.rebuildStateFromProgressLog()).rejects.toThrow();
  });

  it('header with extra spaces -> correct parsing', async () => {
    const progressLog =
      `# auto-dev progress-log: test-topic\n\n` +
      `>   Started:   2026-03-01T12:00:00Z   \n` +
      `>   Mode:   full   \n` +
      `> Stack: TypeScript\n\n` +
      `<!-- CHECKPOINT phase=2 status=PASS timestamp=2026-03-01T12:05:00Z -->\n`;

    mockedReadFile.mockResolvedValue(progressLog as any);

    const result = await sm.rebuildStateFromProgressLog();
    expect(result.startedAt).toBe('2026-03-01T12:00:00Z');
    expect(result.mode).toBe('full');
    expect(result.phase).toBe(2);
  });

  it('mixed PASS and NEEDS_REVISION -> takes last checkpoint', async () => {
    const progressLog =
      `# auto-dev progress-log: test-topic\n\n` +
      `> Started: 2026-01-01T00:00:00Z  \n` +
      `> Mode: full  \n` +
      `> Stack: TypeScript\n\n` +
      `<!-- CHECKPOINT phase=1 status=PASS timestamp=2026-01-01T00:01:00Z -->\n` +
      `<!-- CHECKPOINT phase=2 status=NEEDS_REVISION timestamp=2026-01-01T00:02:00Z -->\n` +
      `<!-- CHECKPOINT phase=2 status=PASS timestamp=2026-01-01T00:03:00Z -->\n` +
      `<!-- CHECKPOINT phase=3 status=NEEDS_REVISION timestamp=2026-01-01T00:04:00Z -->\n`;

    mockedReadFile.mockResolvedValue(progressLog as any);

    const result = await sm.rebuildStateFromProgressLog();
    expect(result.phase).toBe(3);
    expect(result.status).toBe('NEEDS_REVISION');
  });
});
