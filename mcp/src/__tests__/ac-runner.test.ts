/**
 * Tests for ac-runner.ts — structural assertion execution engine.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runStructuralAssertions } from '../ac-runner.js';
import type { AcceptanceCriterion } from '../ac-schema.js';

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'ac-runner-test-'));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe('file_exists', () => {
  it('should pass when file exists', async () => {
    await writeFile(join(tempDir, 'hello.txt'), 'content');
    const criteria: AcceptanceCriterion[] = [
      {
        id: 'AC-1',
        description: 'test',
        layer: 'structural',
        structuralAssertions: [{ type: 'file_exists', path: 'hello.txt' }],
      },
    ];
    const results = await runStructuralAssertions(criteria, tempDir);
    expect(results['AC-1']!.passed).toBe(true);
  });

  it('should fail when file does not exist', async () => {
    const criteria: AcceptanceCriterion[] = [
      {
        id: 'AC-1',
        description: 'test',
        layer: 'structural',
        structuralAssertions: [{ type: 'file_exists', path: 'missing.txt' }],
      },
    ];
    const results = await runStructuralAssertions(criteria, tempDir);
    expect(results['AC-1']!.passed).toBe(false);
  });

  it('should support glob patterns', async () => {
    await mkdir(join(tempDir, 'src'), { recursive: true });
    await writeFile(join(tempDir, 'src', 'app.ts'), 'export {}');
    const criteria: AcceptanceCriterion[] = [
      {
        id: 'AC-1',
        description: 'test',
        layer: 'structural',
        structuralAssertions: [{ type: 'file_exists', path: 'src/*.ts' }],
      },
    ];
    const results = await runStructuralAssertions(criteria, tempDir);
    expect(results['AC-1']!.passed).toBe(true);
  });
});

describe('file_not_exists', () => {
  it('should pass when file does not exist', async () => {
    const criteria: AcceptanceCriterion[] = [
      {
        id: 'AC-1',
        description: 'test',
        layer: 'structural',
        structuralAssertions: [
          { type: 'file_not_exists', path: 'deleted.txt' },
        ],
      },
    ];
    const results = await runStructuralAssertions(criteria, tempDir);
    expect(results['AC-1']!.passed).toBe(true);
  });

  it('should fail when file exists', async () => {
    await writeFile(join(tempDir, 'should-not-exist.txt'), 'oops');
    const criteria: AcceptanceCriterion[] = [
      {
        id: 'AC-1',
        description: 'test',
        layer: 'structural',
        structuralAssertions: [
          { type: 'file_not_exists', path: 'should-not-exist.txt' },
        ],
      },
    ];
    const results = await runStructuralAssertions(criteria, tempDir);
    expect(results['AC-1']!.passed).toBe(false);
  });
});

describe('file_contains', () => {
  it('should pass when file contains pattern', async () => {
    await writeFile(join(tempDir, 'config.yml'), 'max-retry: 3');
    const criteria: AcceptanceCriterion[] = [
      {
        id: 'AC-1',
        description: 'test',
        layer: 'structural',
        structuralAssertions: [
          {
            type: 'file_contains',
            path: 'config.yml',
            pattern: 'max-retry:\\s*3',
          },
        ],
      },
    ];
    const results = await runStructuralAssertions(criteria, tempDir);
    expect(results['AC-1']!.passed).toBe(true);
  });

  it('should fail when file does not contain pattern', async () => {
    await writeFile(join(tempDir, 'config.yml'), 'max-retry: 5');
    const criteria: AcceptanceCriterion[] = [
      {
        id: 'AC-1',
        description: 'test',
        layer: 'structural',
        structuralAssertions: [
          {
            type: 'file_contains',
            path: 'config.yml',
            pattern: 'max-retry:\\s*3',
          },
        ],
      },
    ];
    const results = await runStructuralAssertions(criteria, tempDir);
    expect(results['AC-1']!.passed).toBe(false);
  });

  it('should fail when file does not exist', async () => {
    const criteria: AcceptanceCriterion[] = [
      {
        id: 'AC-1',
        description: 'test',
        layer: 'structural',
        structuralAssertions: [
          { type: 'file_contains', path: 'missing.yml', pattern: 'anything' },
        ],
      },
    ];
    const results = await runStructuralAssertions(criteria, tempDir);
    expect(results['AC-1']!.passed).toBe(false);
  });
});

describe('file_not_contains', () => {
  it('should pass when file does not contain pattern', async () => {
    await writeFile(join(tempDir, 'app.ts'), 'const x = 1;');
    const criteria: AcceptanceCriterion[] = [
      {
        id: 'AC-1',
        description: 'test',
        layer: 'structural',
        structuralAssertions: [
          { type: 'file_not_contains', path: 'app.ts', pattern: 'TODO' },
        ],
      },
    ];
    const results = await runStructuralAssertions(criteria, tempDir);
    expect(results['AC-1']!.passed).toBe(true);
  });

  it('should fail when file contains pattern', async () => {
    await writeFile(join(tempDir, 'app.ts'), '// TODO: fix this');
    const criteria: AcceptanceCriterion[] = [
      {
        id: 'AC-1',
        description: 'test',
        layer: 'structural',
        structuralAssertions: [
          { type: 'file_not_contains', path: 'app.ts', pattern: 'TODO' },
        ],
      },
    ];
    const results = await runStructuralAssertions(criteria, tempDir);
    expect(results['AC-1']!.passed).toBe(false);
  });

  it('should pass when file does not exist', async () => {
    const criteria: AcceptanceCriterion[] = [
      {
        id: 'AC-1',
        description: 'test',
        layer: 'structural',
        structuralAssertions: [
          {
            type: 'file_not_contains',
            path: 'missing.ts',
            pattern: 'anything',
          },
        ],
      },
    ];
    const results = await runStructuralAssertions(criteria, tempDir);
    expect(results['AC-1']!.passed).toBe(true);
  });
});

describe('config_value', () => {
  it('should pass when JSON config value matches', async () => {
    await writeFile(
      join(tempDir, 'config.json'),
      JSON.stringify({
        database: { host: 'localhost', port: '5432' },
      })
    );
    const criteria: AcceptanceCriterion[] = [
      {
        id: 'AC-1',
        description: 'test',
        layer: 'structural',
        structuralAssertions: [
          {
            type: 'config_value',
            path: 'config.json',
            key: 'database.port',
            expectedValue: '5432',
          },
        ],
      },
    ];
    const results = await runStructuralAssertions(criteria, tempDir);
    expect(results['AC-1']!.passed).toBe(true);
  });

  it('should fail when JSON config value does not match', async () => {
    await writeFile(
      join(tempDir, 'config.json'),
      JSON.stringify({
        database: { port: '3306' },
      })
    );
    const criteria: AcceptanceCriterion[] = [
      {
        id: 'AC-1',
        description: 'test',
        layer: 'structural',
        structuralAssertions: [
          {
            type: 'config_value',
            path: 'config.json',
            key: 'database.port',
            expectedValue: '5432',
          },
        ],
      },
    ];
    const results = await runStructuralAssertions(criteria, tempDir);
    expect(results['AC-1']!.passed).toBe(false);
  });

  it('should fail when key path does not exist', async () => {
    await writeFile(
      join(tempDir, 'config.json'),
      JSON.stringify({ foo: 'bar' })
    );
    const criteria: AcceptanceCriterion[] = [
      {
        id: 'AC-1',
        description: 'test',
        layer: 'structural',
        structuralAssertions: [
          {
            type: 'config_value',
            path: 'config.json',
            key: 'missing.key',
            expectedValue: 'x',
          },
        ],
      },
    ];
    const results = await runStructuralAssertions(criteria, tempDir);
    expect(results['AC-1']!.passed).toBe(false);
  });
});

describe('build_succeeds', () => {
  it('should pass when build command succeeds', async () => {
    const criteria: AcceptanceCriterion[] = [
      {
        id: 'AC-1',
        description: 'test',
        layer: 'structural',
        structuralAssertions: [{ type: 'build_succeeds' }],
      },
    ];
    const results = await runStructuralAssertions(criteria, tempDir, {
      buildCmd: 'echo ok',
    });
    expect(results['AC-1']!.passed).toBe(true);
  });

  it('should fail when build command fails', async () => {
    const criteria: AcceptanceCriterion[] = [
      {
        id: 'AC-1',
        description: 'test',
        layer: 'structural',
        structuralAssertions: [{ type: 'build_succeeds' }],
      },
    ];
    const results = await runStructuralAssertions(criteria, tempDir, {
      buildCmd: 'exit 1',
    });
    expect(results['AC-1']!.passed).toBe(false);
  });

  it('should fail when no build command configured', async () => {
    const criteria: AcceptanceCriterion[] = [
      {
        id: 'AC-1',
        description: 'test',
        layer: 'structural',
        structuralAssertions: [{ type: 'build_succeeds' }],
      },
    ];
    const results = await runStructuralAssertions(criteria, tempDir);
    expect(results['AC-1']!.passed).toBe(false);
  });
});

describe('test_passes', () => {
  it('should pass when test command succeeds', async () => {
    const criteria: AcceptanceCriterion[] = [
      {
        id: 'AC-1',
        description: 'test',
        layer: 'structural',
        structuralAssertions: [{ type: 'test_passes' }],
      },
    ];
    const results = await runStructuralAssertions(criteria, tempDir, {
      testCmd: 'echo ok',
    });
    expect(results['AC-1']!.passed).toBe(true);
  });

  it('should fail when test command fails', async () => {
    const criteria: AcceptanceCriterion[] = [
      {
        id: 'AC-1',
        description: 'test',
        layer: 'structural',
        structuralAssertions: [{ type: 'test_passes' }],
      },
    ];
    const results = await runStructuralAssertions(criteria, tempDir, {
      testCmd: 'exit 1',
    });
    expect(results['AC-1']!.passed).toBe(false);
  });
});

describe('multiple assertions per AC', () => {
  it('should fail if any assertion fails', async () => {
    await writeFile(join(tempDir, 'exists.txt'), 'content');
    const criteria: AcceptanceCriterion[] = [
      {
        id: 'AC-1',
        description: 'test',
        layer: 'structural',
        structuralAssertions: [
          { type: 'file_exists', path: 'exists.txt' },
          { type: 'file_exists', path: 'missing.txt' },
        ],
      },
    ];
    const results = await runStructuralAssertions(criteria, tempDir);
    expect(results['AC-1']!.passed).toBe(false);
    expect(results['AC-1']!.details).toHaveLength(2);
    expect(results['AC-1']!.details[0]!.passed).toBe(true);
    expect(results['AC-1']!.details[1]!.passed).toBe(false);
  });
});

describe('non-structural ACs', () => {
  it('should skip test-bound and manual ACs', async () => {
    const criteria: AcceptanceCriterion[] = [
      { id: 'AC-1', description: 'test', layer: 'test-bound' },
      { id: 'AC-2', description: 'test', layer: 'manual' },
      {
        id: 'AC-3',
        description: 'test',
        layer: 'structural',
        structuralAssertions: [{ type: 'file_not_exists', path: 'nope.txt' }],
      },
    ];
    const results = await runStructuralAssertions(criteria, tempDir);
    expect(Object.keys(results)).toEqual(['AC-3']);
    expect(results['AC-3']!.passed).toBe(true);
  });
});

// TC-B-01: structural AC with null structuralAssertions
describe('boundary: null/empty structuralAssertions', () => {
  it('TC-B-01: should return passed:true for null structuralAssertions', async () => {
    const criteria: AcceptanceCriterion[] = [
      {
        id: 'AC-1',
        description: 'test',
        layer: 'structural',
        structuralAssertions: null,
      },
    ];
    const results = await runStructuralAssertions(criteria, tempDir);
    expect(results['AC-1']!.passed).toBe(true);
    expect(results['AC-1']!.details).toHaveLength(0);
  });

  // TC-B-02: structural AC with empty array structuralAssertions
  it('TC-B-02: should return passed:true for empty structuralAssertions array', async () => {
    const criteria: AcceptanceCriterion[] = [
      {
        id: 'AC-1',
        description: 'test',
        layer: 'structural',
        structuralAssertions: [],
      },
    ];
    const results = await runStructuralAssertions(criteria, tempDir);
    expect(results['AC-1']!.passed).toBe(true);
    expect(results['AC-1']!.details).toHaveLength(0);
  });
});

// TC-B-06: file_contains with invalid regex
describe('boundary: invalid regex in file_contains', () => {
  it('TC-B-06: should not throw on invalid regex pattern', async () => {
    await writeFile(join(tempDir, 'test.txt'), 'some content');
    const criteria: AcceptanceCriterion[] = [
      {
        id: 'AC-1',
        description: 'test',
        layer: 'structural',
        structuralAssertions: [
          { type: 'file_contains', path: 'test.txt', pattern: '[invalid' },
        ],
      },
    ];
    // Should not throw uncaught exception
    const results = await runStructuralAssertions(criteria, tempDir);
    expect(results['AC-1']!.passed).toBe(false);
  });
});

// TC-B-07: config_value with malformed JSON file
describe('boundary: malformed JSON in config_value', () => {
  it('TC-B-07: should return FAIL for malformed JSON config file', async () => {
    await writeFile(join(tempDir, 'config.json'), '{ broken json');
    const criteria: AcceptanceCriterion[] = [
      {
        id: 'AC-1',
        description: 'test',
        layer: 'structural',
        structuralAssertions: [
          {
            type: 'config_value',
            path: 'config.json',
            key: 'foo',
            expectedValue: 'bar',
          },
        ],
      },
    ];
    const results = await runStructuralAssertions(criteria, tempDir);
    expect(results['AC-1']!.passed).toBe(false);
    expect(results['AC-1']!.details[0]!.detail).toContain('Cannot read/parse');
  });
});

// TC-B-13: mixed structural + test-bound + manual -- only structural processed
describe('boundary: mixed AC layers filtering', () => {
  it('TC-B-13: should only process structural ACs, ignoring test-bound and manual', async () => {
    await writeFile(join(tempDir, 'exists.txt'), 'content');
    const criteria: AcceptanceCriterion[] = [
      {
        id: 'AC-1',
        description: 'structural',
        layer: 'structural',
        structuralAssertions: [{ type: 'file_exists', path: 'exists.txt' }],
      },
      { id: 'AC-2', description: 'test-bound', layer: 'test-bound' },
      { id: 'AC-3', description: 'manual', layer: 'manual' },
    ];
    const results = await runStructuralAssertions(criteria, tempDir);
    expect(Object.keys(results)).toEqual(['AC-1']);
    expect(results['AC-1']!.passed).toBe(true);
    expect(results['AC-2']).toBeUndefined();
    expect(results['AC-3']).toBeUndefined();
  });
});
