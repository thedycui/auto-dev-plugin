/**
 * Tests for extractDocSummary and extractTaskList (state-manager.ts).
 */

import { describe, it, expect } from 'vitest';
import { extractDocSummary, extractTaskList } from '../state-manager.js';

describe('extractDocSummary', () => {
  it('content with ## 概述 -> returns summary section', () => {
    const content =
      `# Title\n\n` +
      `## 概述\n\n` +
      `This is the overview.\nWith multiple lines.\n\n` +
      `## Details\n\nSome details here.\n`;

    const result = extractDocSummary(content, 5);
    expect(result).toContain('This is the overview.');
    expect(result).toContain('With multiple lines.');
    expect(result).not.toContain('Some details here.');
  });

  it('content with ## Summary -> returns Summary section', () => {
    const content =
      `# Title\n\n` +
      `## Summary\n\n` +
      `This is the summary.\n\n` +
      `## Implementation\n\nImplementation details.\n`;

    const result = extractDocSummary(content, 5);
    expect(result).toContain('This is the summary.');
    expect(result).not.toContain('Implementation details.');
  });

  it('no summary section -> returns first maxLines lines', () => {
    const content = `Line 1\nLine 2\nLine 3\nLine 4\nLine 5\nLine 6\nLine 7\n`;

    const result = extractDocSummary(content, 3);
    expect(result).toContain('Line 1');
    expect(result).toContain('Line 3');
    expect(result).not.toContain('Line 4');
  });

  it('empty content -> returns empty string', () => {
    const result = extractDocSummary('', 10);
    expect(result).toBe('');
  });
});

describe('extractTaskList', () => {
  it('content with ### Task N -> extracts tasks', () => {
    const content =
      `# Plan\n\n` +
      `### Task 1: Design review\n\n` +
      `Some description.\n\n` +
      `### Task 2: Implementation\n\n` +
      `More description.\n`;

    const result = extractTaskList(content);
    expect(result).toContain('### Task 1: Design review');
    expect(result).toContain('### Task 2: Implementation');
    expect(result).not.toContain('Some description.');
  });

  it('content with - [ ] Task N -> extracts tasks', () => {
    const content =
      `# Checklist\n\n` +
      `- [ ] Task 1: Do this\n` +
      `- [x] Task 2: Do that\n` +
      `- Some other item\n`;

    const result = extractTaskList(content);
    expect(result).toContain('- [ ] Task 1: Do this');
    expect(result).toContain('- [x] Task 2: Do that');
    expect(result).not.toContain('Some other item');
  });

  it('no matching lines -> returns empty string', () => {
    const content = `# Title\n\nSome random text.\nAnother line.\n`;

    const result = extractTaskList(content);
    expect(result).toBe('');
  });
});
