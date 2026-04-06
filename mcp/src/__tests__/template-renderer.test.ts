/**
 * Tests for TemplateRenderer — self-assess.md template rendering (AC-7).
 */

import { describe, it, expect } from 'vitest';
import { TemplateRenderer } from '../template-renderer.js';
import { join } from 'node:path';

const SKILLS_DIR = join(__dirname, '..', '..', '..', 'skills', 'auto-dev');

describe('TemplateRenderer — self-assess', () => {
  it('AC-7: self-assess.md renders with project_root and output_dir variables', async () => {
    const renderer = new TemplateRenderer(SKILLS_DIR);
    const result = await renderer.render('self-assess', {
      project_root: '/test/project',
      output_dir: '/test/project/docs/auto-dev/self-assess',
    });

    expect(result.renderedPrompt).toContain('/test/project');
    expect(result.renderedPrompt).toContain(
      '/test/project/docs/auto-dev/self-assess'
    );
    expect(result.renderedPrompt).toContain('auto-dev Self-Assessment');
    expect(result.renderedPrompt).toContain('improvement-candidates.md');

    // {timestamp} is expected to remain unreplaced (filled at runtime)
    const criticalWarnings = result.warnings.filter(
      w => !w.includes('timestamp')
    );
    expect(criticalWarnings).toEqual([]);
  });

  it('template file exists and is not empty', async () => {
    const renderer = new TemplateRenderer(SKILLS_DIR);
    const result = await renderer.render('self-assess', {
      project_root: 'X',
      output_dir: 'Y',
    });

    expect(result.renderedPrompt.length).toBeGreaterThan(100);
  });
});
