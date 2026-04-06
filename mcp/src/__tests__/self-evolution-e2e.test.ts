/**
 * E2E tests for self-evolution: 3-layer Lessons promotion pipeline.
 *
 * Tests the full lifecycle:
 *   add() → promoteToProject() → promoteToGlobal() → getCrossProjectLessons()
 * Also tests retrospective integration and init injection path.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LessonsManager, applyDecay } from '../lessons-manager.js';
import { runRetrospective } from '../retrospective.js';
import type { LessonEntry, StateJson } from '../types.js';
import {
  MAX_CROSS_PROJECT_POOL,
  GLOBAL_PROMOTE_MIN_SCORE,
} from '../lessons-constants.js';

// Mock homedir for cross-project file isolation
let mockHomedir: string | null = null;
vi.mock('node:os', async importOriginal => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    homedir: () => mockHomedir ?? (actual.homedir as () => string)(),
  };
});

describe('E2E: self-evolution promotion pipeline', () => {
  let tmpRoot: string;
  let projectRoot: string;
  let outputDir: string;
  let crossGlobalFile: string;

  beforeEach(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), 'e2e-self-evo-'));
    projectRoot = tmpRoot;
    outputDir = join(projectRoot, 'docs', 'auto-dev', 'test-topic');
    crossGlobalFile = join(tmpRoot, '.auto-dev', 'lessons-global.json');
    await mkdir(outputDir, { recursive: true });
    await mkdir(join(projectRoot, 'docs', 'auto-dev', '_global'), {
      recursive: true,
    });
    await mkdir(join(tmpRoot, '.auto-dev'), { recursive: true });
    mockHomedir = tmpRoot;
  });

  afterEach(async () => {
    mockHomedir = null;
    await rm(tmpRoot, { recursive: true, force: true });
  });

  it('full pipeline: add → promoteToProject → promoteToGlobal → getCrossProjectLessons', async () => {
    const mgr = new LessonsManager(outputDir, projectRoot);

    // Step 1: Add lessons locally (reusable + high severity)
    await mgr.add(
      3,
      'technical',
      'Always validate input before DB writes',
      undefined,
      {
        severity: 'critical',
        reusable: true,
        topic: 'auth-feature',
      }
    );
    await mgr.add(
      3,
      'pitfall',
      'Missing null check on optional field',
      undefined,
      {
        severity: 'important',
        reusable: true,
        topic: 'auth-feature',
      }
    );
    await mgr.add(3, 'process', 'Local-only process note', undefined, {
      severity: 'minor',
      reusable: false,
      topic: 'auth-feature',
    });

    // Verify local entries
    const local = await mgr.get();
    expect(local.length).toBe(3);

    // Step 2: add() auto-promotes reusable entries to Project layer
    const projectEntries = await mgr.readProjectEntries();
    expect(projectEntries.length).toBe(2); // only reusable ones

    // Step 3: Promote from Project → Global
    const promoted = await mgr.promoteToGlobal();
    // critical(score=10) qualifies, important(score=6) qualifies (>= GLOBAL_PROMOTE_MIN_SCORE=6)
    expect(promoted).toBe(2);

    // Step 4: Read from Global (cross-project)
    const global = await mgr.getCrossProjectLessons();
    expect(global.length).toBe(2);
    expect(global[0].sourceProject).toBeDefined();
    expect(global[0].promotionPath).toBe('project_to_global');

    // Verify ordering by decayed score (critical=10 first, important=6 second)
    expect(global[0].lesson).toContain('validate input');
    expect(global[1].lesson).toContain('null check');
  });

  it('cross-project injection: lessons from project A visible in project B', async () => {
    // Simulate Project A adding and promoting a lesson
    const projectADir = join(projectRoot, 'docs', 'auto-dev', 'project-a');
    await mkdir(projectADir, { recursive: true });
    const mgrA = new LessonsManager(projectADir, projectRoot);

    await mgrA.add(
      3,
      'technical',
      'Cross-project reusable insight',
      undefined,
      {
        severity: 'critical',
        reusable: true,
        topic: 'project-a-topic',
      }
    );
    const promotedA = await mgrA.promoteToGlobal();
    expect(promotedA).toBe(1);

    // Simulate Project B reading global lessons
    const projectBDir = join(projectRoot, 'docs', 'auto-dev', 'project-b');
    await mkdir(projectBDir, { recursive: true });
    const mgrB = new LessonsManager(projectBDir, projectRoot);

    const injected = await mgrB.injectGlobalLessons();
    expect(injected.length).toBe(1);
    expect(injected[0].lesson).toBe('Cross-project reusable insight');
    expect(injected[0].sourceProject).toBeDefined();
  });

  it('backward compat: old method names still work end-to-end', async () => {
    const mgr = new LessonsManager(outputDir, projectRoot);

    // Use old method names
    await mgr.add(3, 'technical', 'Compat test lesson', undefined, {
      severity: 'important',
      reusable: true,
      topic: 'compat',
    });

    // Old: promoteReusableLessons (now promoteToProject)
    const promoted = await mgr.promoteReusableLessons('compat');
    expect(promoted).toBe(0); // already promoted via add()

    // Old: getGlobalLessons (now getProjectLessons)
    const projectLessons = await mgr.getGlobalLessons();
    expect(projectLessons.length).toBe(1);

    // Old: readGlobalEntries (now readProjectEntries)
    const raw = await mgr.readGlobalEntries();
    expect(raw.length).toBe(1);
  });

  it('retrospective integration: promoteToGlobal called during retrospective', async () => {
    const mgr = new LessonsManager(outputDir, projectRoot);

    // Pre-seed a high-score reusable project-level entry
    const projectFile = join(
      projectRoot,
      'docs',
      'auto-dev',
      '_global',
      'lessons-global.json'
    );
    await writeFile(
      projectFile,
      JSON.stringify(
        [
          {
            id: 'retro-test-1',
            phase: 3,
            category: 'technical',
            severity: 'critical',
            lesson: 'Retrospective promotion test',
            reusable: true,
            score: 10,
            timestamp: new Date().toISOString(),
            lastPositiveAt: new Date().toISOString(),
          },
        ],
        null,
        2
      )
    );

    // Create minimal progress-log for retrospective
    await writeFile(
      join(outputDir, 'progress-log.md'),
      '# Progress\nAll phases passed.\n'
    );

    const state: StateJson = {
      topic: 'retro-test',
      mode: 'full',
      phase: 7,
      status: 'IN_PROGRESS',
      stack: {
        language: 'TypeScript',
        buildCmd: 'npm run build',
        testCmd: 'npm test',
        langChecklist: 'ts.md',
      },
      outputDir,
      projectRoot,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const result = await runRetrospective(state, outputDir, projectRoot);
    expect(result.crossProjectPromoted).toBeGreaterThanOrEqual(1);

    // Verify the entry made it to the cross-project global file
    const globalEntries = JSON.parse(
      await readFile(crossGlobalFile, 'utf-8')
    ) as LessonEntry[];
    expect(globalEntries.length).toBe(1);
    expect(globalEntries[0].lesson).toBe('Retrospective promotion test');
    expect(globalEntries[0].promotionPath).toBe('project_to_global');
  });

  it('data compatibility: old-format entries survive full pipeline', async () => {
    // Seed a project-level entry without new fields (old format)
    const projectFile = join(
      projectRoot,
      'docs',
      'auto-dev',
      '_global',
      'lessons-global.json'
    );
    await writeFile(
      projectFile,
      JSON.stringify(
        [
          {
            id: 'old-format-1',
            phase: 3,
            category: 'pitfall',
            severity: 'critical',
            lesson: 'Old format lesson without new fields',
            reusable: true,
            score: 10,
            timestamp: new Date().toISOString(),
            // No sourceProject, promotedAt, promotionPath
          },
        ],
        null,
        2
      )
    );

    const mgr = new LessonsManager(outputDir, projectRoot);

    // Old format entries should be readable
    const projectLessons = await mgr.getProjectLessons();
    expect(projectLessons.length).toBe(1);
    expect(projectLessons[0].sourceProject).toBeUndefined();

    // And promotable to global
    const promoted = await mgr.promoteToGlobal(1);
    expect(promoted).toBe(1);

    // Global entry should have new fields
    const global = await mgr.getCrossProjectLessons();
    expect(global.length).toBe(1);
    expect(global[0].sourceProject).toBeDefined();
    expect(global[0].promotionPath).toBe('project_to_global');
  });
});
