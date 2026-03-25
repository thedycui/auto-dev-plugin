/**
 * TemplateRenderer — reads prompt templates, injects checklists,
 * replaces variables, and returns the fully rendered prompt.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { RenderOutput } from "./types.js";

const REQUIRES_RE = /<!--\s*requires:\s*([\w-]+)\s*-->/g;
const VARIABLE_RE = /\{(\w+)\}/g;
const CHECKPOINT_RE = /<!--\s*CHECKPOINT\b[^>]*-->/g;

export class TemplateRenderer {
  private readonly skillsDir: string;

  constructor(skillsDir: string) {
    this.skillsDir = skillsDir;
  }

  async render(
    promptFile: string,
    variables: Record<string, string>,
    extraContext?: string,
  ): Promise<RenderOutput> {
    const warnings: string[] = [];

    // 1. Read the prompt template
    const templatePath = join(this.skillsDir, "prompts", `${promptFile}.md`);
    let content: string;
    try {
      content = await readFile(templatePath, "utf-8");
    } catch (err) {
      const code = (err as { code?: string }).code;
      // List available templates to help agent self-correct
      let available = "";
      try {
        const { readdirSync } = await import("node:fs");
        const promptsDir = join(this.skillsDir, "prompts");
        const files = readdirSync(promptsDir)
          .filter((f: string) => f.endsWith(".md"))
          .map((f: string) => f.replace(/\.md$/, ""));
        available = `\nAvailable templates: ${files.join(", ")}`;
      } catch { /* ignore */ }
      throw new Error(
        `Template file not found: ${templatePath}` +
          (code ? ` (${code})` : "") +
          available +
          `\nHint: use auto_dev_preflight() which returns suggestedPrompt with the correct template name.`,
      );
    }

    // 2. Mask CHECKPOINT comments to protect their braces from substitution
    const checkpointPlaceholders: string[] = [];
    content = content.replace(CHECKPOINT_RE, (cp) => {
      const idx = checkpointPlaceholders.length;
      checkpointPlaceholders.push(cp);
      return `__AUTODEV_CHECKPOINT_${idx}_PLACEHOLDER__`;
    });

    // 3. Replace {variable} placeholders FIRST
    //    This must happen before requires parsing so that
    //    <!-- requires: {lang_checklist} --> resolves to e.g.
    //    <!-- requires: code-review-java8 --> before checklist injection.
    content = content.replace(VARIABLE_RE, (original, name: string) => {
      const value = variables[name];
      if (value !== undefined) {
        return value;
      }
      return original;
    });

    // 4. Restore CHECKPOINT comments
    content = content.replace(
      /__AUTODEV_CHECKPOINT_(\d+)_PLACEHOLDER__/g,
      (_, idx: string) => checkpointPlaceholders[Number(idx)]!,
    );

    // 5. Parse <!-- requires: checklist-name --> and inject checklist content
    //    Now runs AFTER variable substitution, so dynamic checklist names work.
    const requiresMatches = [...content.matchAll(REQUIRES_RE)];
    for (const match of requiresMatches) {
      const checklistName = match[1]!;
      const checklistPath = join(
        this.skillsDir,
        "checklists",
        `${checklistName}.md`,
      );
      let checklistContent: string;
      try {
        checklistContent = await readFile(checklistPath, "utf-8");
      } catch {
        warnings.push(
          `Checklist file not found: ${checklistPath} (required by ${promptFile})`,
        );
        continue;
      }
      // Replace the requires directive with the checklist content
      content = content.replace(match[0], checklistContent);
    }

    // 6. Check for remaining unreplaced variables (outside CHECKPOINTs)
    const tempWithoutCheckpoints = content.replace(CHECKPOINT_RE, "");
    const unreplaced = [...tempWithoutCheckpoints.matchAll(VARIABLE_RE)];
    for (const m of unreplaced) {
      warnings.push(`Unreplaced variable: ${m[0]}`);
    }

    // 7. Append extra context if provided
    if (extraContext) {
      content += "\n\n## Additional Context\n\n" + extraContext;
    }

    return { renderedPrompt: content, warnings };
  }
}
