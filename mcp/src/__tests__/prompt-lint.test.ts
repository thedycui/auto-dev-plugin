import { describe, it, expect } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FRAMEWORK_TERMS } from "../orchestrator-prompts.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = resolve(__dirname, "..", "..", "..", "skills", "auto-dev", "prompts");

describe("phase prompt lint — no framework terms", () => {
  it("no prompt file contains framework-specific terms", async () => {
    const files = await readdir(PROMPTS_DIR);
    const mdFiles = files.filter((f) => f.endsWith(".md"));
    expect(mdFiles.length).toBeGreaterThan(0);

    const violations: Array<{ file: string; matches: string[] }> = [];

    for (const file of mdFiles) {
      const content = await readFile(join(PROMPTS_DIR, file), "utf-8");
      const matches: string[] = [];
      for (const re of FRAMEWORK_TERMS) {
        const found = content.match(new RegExp(re.source, re.flags + "g"));
        if (found) matches.push(...found);
      }
      if (matches.length > 0) {
        violations.push({ file, matches: [...new Set(matches)] });
      }
    }

    if (violations.length > 0) {
      const report = violations
        .map((v) => `  ${v.file}: ${v.matches.join(", ")}`)
        .join("\n");
      expect.fail(`Framework terms found in prompts:\n${report}`);
    }
  }, 15000);

  it("all prompt files have isolation footer", async () => {
    const files = await readdir(PROMPTS_DIR);
    const mdFiles = files.filter((f) => f.endsWith(".md"));

    const missing: string[] = [];
    for (const file of mdFiles) {
      const content = await readFile(join(PROMPTS_DIR, file), "utf-8");
      if (!content.includes("完成后不需要做其他操作")) {
        missing.push(file);
      }
    }

    if (missing.length > 0) {
      expect.fail(`Missing isolation footer in: ${missing.join(", ")}`);
    }
  }, 15000);
});
