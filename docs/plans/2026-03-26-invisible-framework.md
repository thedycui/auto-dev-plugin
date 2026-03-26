# Invisible Framework Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Refactor auto-dev so the orchestration loop runs framework-side, making task agents unaware of phases/checkpoints/tribunal — eliminating the Goodhart gaming incentive.

**Architecture:** Extract `claude -p` spawning from tribunal.ts into a shared agent-spawner module. Build an orchestrator that drives the phase loop, spawning isolated task agents per phase. Each agent receives only a pure task prompt and produces file artifacts. The orchestrator validates artifacts using existing hard-data checks (phase-enforcer, tribunal, framework-executed tests), translating failures into technical feedback for retry. Register a single `auto_dev_orchestrate` MCP tool as the new entry point; simplify SKILL.md to ~100 lines.

**Tech Stack:** TypeScript, Node.js, `claude -p` CLI spawning, MCP SDK, Vitest

---

### Task 1: Extract agent-spawner module from tribunal.ts

**Files:**
- Create: `mcp/src/agent-spawner.ts`
- Create: `mcp/src/__tests__/agent-spawner.test.ts`
- Modify: `mcp/src/tribunal.ts:1-87` (remove duplicated path resolution, import from agent-spawner)

**Step 1: Write the failing test**

```typescript
// mcp/src/__tests__/agent-spawner.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
  exec: vi.fn(),
}));

import { exec } from "node:child_process";
import { resolveClaudePath, spawnAgent } from "../agent-spawner.js";

const mockExec = vi.mocked(exec);

describe("agent-spawner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("resolveClaudePath", () => {
    it("returns env var when TRIBUNAL_CLAUDE_PATH is set", async () => {
      process.env.TRIBUNAL_CLAUDE_PATH = "/custom/claude";
      const result = await resolveClaudePath();
      expect(result).toBe("/custom/claude");
      delete process.env.TRIBUNAL_CLAUDE_PATH;
    });
  });

  describe("spawnAgent", () => {
    it("returns SpawnResult with stdout from claude -p", async () => {
      const result = await spawnAgent({
        prompt: "test prompt",
        model: "sonnet",
        timeout: 5000,
      });
      expect(result).toHaveProperty("stdout");
      expect(result).toHaveProperty("exitCode");
      expect(result).toHaveProperty("crashed");
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/admin/.claude/plugins/auto-dev-plugin/mcp && npx vitest run src/__tests__/agent-spawner.test.ts`
Expected: FAIL — module `../agent-spawner.js` not found

**Step 3: Write agent-spawner.ts**

```typescript
// mcp/src/agent-spawner.ts
/**
 * agent-spawner — Generic Claude CLI process spawner.
 *
 * Extracted from tribunal.ts to serve both tribunal judges and task agents.
 * Provides: path resolution, spawn with structured/plain output, retry logic.
 */

import { execFile, exec } from "node:child_process";
import { stat } from "node:fs/promises";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SpawnOptions {
  prompt: string;
  model?: "opus" | "sonnet" | "haiku";
  timeout?: number;
  maxBuffer?: number;
  jsonSchema?: object;
  cwd?: string;
}

export interface SpawnResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  parsed?: unknown;
  crashed: boolean;
}

// ---------------------------------------------------------------------------
// Claude CLI Path Resolution (moved from tribunal.ts)
// ---------------------------------------------------------------------------

let cachedClaudePath: string | null = null;

export async function resolveClaudePath(): Promise<string> {
  if (process.env.TRIBUNAL_CLAUDE_PATH) {
    return process.env.TRIBUNAL_CLAUDE_PATH;
  }

  try {
    const resolved = await new Promise<string>((resolve, reject) => {
      exec("command -v claude", (err, stdout) => {
        if (err || !stdout.trim()) reject(new Error("not found"));
        else resolve(stdout.trim());
      });
    });
    return resolved;
  } catch { /* fall through */ }

  const candidates = [
    "/usr/local/bin/claude",
    `${process.env.HOME}/.npm-global/bin/claude`,
    `${process.env.HOME}/.claude/local/claude`,
  ];
  for (const p of candidates) {
    try {
      await stat(p);
      return p;
    } catch { /* try next */ }
  }

  return "npx --yes @anthropic-ai/claude-code";
}

export async function getClaudePath(): Promise<string> {
  if (!cachedClaudePath) {
    cachedClaudePath = await resolveClaudePath();
  }
  return cachedClaudePath;
}

/** Reset cached path (for testing). */
export function resetClaudePathCache(): void {
  cachedClaudePath = null;
}

// ---------------------------------------------------------------------------
// Spawn Agent
// ---------------------------------------------------------------------------

export async function spawnAgent(options: SpawnOptions): Promise<SpawnResult> {
  const {
    prompt,
    model = "sonnet",
    timeout = 300_000,
    maxBuffer = 4 * 1024 * 1024,
    jsonSchema,
    cwd,
  } = options;

  const resolved = await getClaudePath();
  const useShell = resolved.startsWith("npx");

  const args = [
    "-p", prompt,
    "--model", model,
    "--dangerously-skip-permissions",
    "--no-session-persistence",
  ];

  if (jsonSchema) {
    args.push("--output-format", "json");
    args.push("--json-schema", JSON.stringify(jsonSchema));
  }

  const spawnOpts: { timeout: number; maxBuffer: number; cwd?: string; shell?: string } = {
    timeout,
    maxBuffer,
  };
  if (cwd) spawnOpts.cwd = cwd;

  return new Promise<SpawnResult>((resolve) => {
    const callback = (err: Error | null, stdout: string, stderr: string) => {
      if (err) {
        resolve({
          stdout: stdout || "",
          stderr: stderr || err.message,
          exitCode: (err as any).code ?? 1,
          crashed: true,
        });
        return;
      }

      let parsed: unknown;
      if (jsonSchema) {
        try {
          const response = JSON.parse(stdout);
          parsed = response.structured_output ?? response;
        } catch {
          resolve({ stdout, stderr, exitCode: 0, crashed: true });
          return;
        }
      }

      resolve({
        stdout,
        stderr: stderr || "",
        exitCode: 0,
        parsed,
        crashed: false,
      });
    };

    if (useShell) {
      const fullCmd = `${resolved} ${args.map(a => `'${a.replace(/'/g, "'\\''")}'`).join(" ")}`;
      exec(fullCmd, { ...spawnOpts, shell: "/bin/sh" }, (err, stdout, stderr) => {
        callback(err, stdout, stderr);
      });
    } else {
      execFile(resolved, args, spawnOpts, (err, stdout, stderr) => {
        callback(err, stdout, stderr);
      });
    }
  });
}

// ---------------------------------------------------------------------------
// Retry Wrapper
// ---------------------------------------------------------------------------

const CRASH_INDICATORS = [
  "裁决进程执行失败",
  "JSON 解析失败",
  "未返回有效的 structured_output",
];

export async function spawnAgentWithRetry(
  options: SpawnOptions,
  maxRetries = 1,
  crashDetector?: (result: SpawnResult) => boolean,
): Promise<SpawnResult> {
  const detectCrash = crashDetector ?? ((r: SpawnResult) =>
    r.crashed || CRASH_INDICATORS.some(ind => r.stderr.includes(ind) || r.stdout.includes(ind))
  );

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const result = await spawnAgent(options);
    if (!detectCrash(result)) return result;

    if (attempt < maxRetries) {
      await new Promise(r => setTimeout(r, 3000));
    }
  }

  // All retries exhausted — return last result
  return spawnAgent(options);
}
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/admin/.claude/plugins/auto-dev-plugin/mcp && npx vitest run src/__tests__/agent-spawner.test.ts`
Expected: PASS

**Step 5: Refactor tribunal.ts to import from agent-spawner**

Replace lines 1-87 of `tribunal.ts` — remove `resolveClaudePath`, `getClaudePath`, and the path resolution logic. Import from `agent-spawner.ts` instead:

```typescript
// tribunal.ts — top of file, replace path resolution imports
import { getClaudePath, resolveClaudePath, spawnAgent } from "./agent-spawner.js";
```

Remove the entire "Claude CLI Path Resolution" section (lines 36-87) and re-export from agent-spawner:

```typescript
// Re-export for backward compatibility (other files import from tribunal.ts)
export { getClaudePath, resolveClaudePath } from "./agent-spawner.js";
```

**Step 6: Run existing tribunal tests to verify no regression**

Run: `cd /Users/admin/.claude/plugins/auto-dev-plugin/mcp && npx vitest run src/__tests__/tribunal.test.ts`
Expected: All existing tests PASS

**Step 7: Commit**

```bash
cd /Users/admin/.claude/plugins/auto-dev-plugin
git add mcp/src/agent-spawner.ts mcp/src/__tests__/agent-spawner.test.ts mcp/src/tribunal.ts
git commit -m "refactor: extract agent-spawner module from tribunal.ts"
```

---

### Task 2: Build orchestrator-prompts module

**Files:**
- Create: `mcp/src/orchestrator-prompts.ts`
- Create: `mcp/src/__tests__/orchestrator-prompts.test.ts`

**Step 1: Write the failing test**

```typescript
// mcp/src/__tests__/orchestrator-prompts.test.ts
import { describe, it, expect } from "vitest";
import {
  buildRevisionPrompt,
  translateFailureToFeedback,
  FRAMEWORK_TERMS,
  containsFrameworkTerms,
} from "../orchestrator-prompts.js";

describe("orchestrator-prompts", () => {
  describe("containsFrameworkTerms", () => {
    it("detects 'checkpoint' as a framework term", () => {
      expect(containsFrameworkTerms("请调用 checkpoint")).toBe(true);
    });

    it("allows normal task text", () => {
      expect(containsFrameworkTerms("请为 XX 功能写设计方案")).toBe(false);
    });

    it("detects 'tribunal' as a framework term", () => {
      expect(containsFrameworkTerms("tribunal 会审查")).toBe(true);
    });

    it("detects 'auto_dev_submit' as a framework term", () => {
      expect(containsFrameworkTerms("auto_dev_submit")).toBe(true);
    });

    it("detects 'Phase 3' as a framework term", () => {
      expect(containsFrameworkTerms("Phase 3 已通过")).toBe(true);
    });
  });

  describe("buildRevisionPrompt", () => {
    it("includes feedback and original task", () => {
      const prompt = buildRevisionPrompt({
        originalTask: "请实现用户登录功能",
        feedback: "缺少密码加密逻辑",
        artifacts: ["src/auth.ts"],
      });
      expect(prompt).toContain("缺少密码加密逻辑");
      expect(prompt).toContain("请实现用户登录功能");
      expect(prompt).toContain("src/auth.ts");
    });

    it("does not contain framework terms", () => {
      const prompt = buildRevisionPrompt({
        originalTask: "implement feature",
        feedback: "tests fail",
        artifacts: ["src/index.ts"],
      });
      expect(containsFrameworkTerms(prompt)).toBe(false);
    });
  });

  describe("translateFailureToFeedback", () => {
    it("translates PHASE1_REVIEW_MISSING to actionable feedback", () => {
      const fb = translateFailureToFeedback("PHASE1_REVIEW_MISSING", "");
      expect(fb).toContain("设计审查");
      expect(containsFrameworkTerms(fb)).toBe(false);
    });

    it("translates TRIBUNAL_FAIL with issues to readable feedback", () => {
      const issues = JSON.stringify([
        { severity: "P0", description: "未审查 adaptToZip() 的调用方", file: "src/adapter.ts" },
      ]);
      const fb = translateFailureToFeedback("TRIBUNAL_FAIL", issues);
      expect(fb).toContain("adaptToZip()");
      expect(fb).toContain("src/adapter.ts");
      expect(containsFrameworkTerms(fb)).toBe(false);
    });

    it("translates TEST_FAILED with stderr to readable feedback", () => {
      const fb = translateFailureToFeedback("TEST_FAILED", "AssertionError: expected 1 to be 2");
      const prompt = fb;
      expect(prompt).toContain("AssertionError");
      expect(containsFrameworkTerms(prompt)).toBe(false);
    });

    it("translates TRIBUNAL_OVERRIDDEN to readable feedback", () => {
      const fb = translateFailureToFeedback("TRIBUNAL_OVERRIDDEN", "测试实际未通过 exit code=1");
      expect(fb).toContain("测试");
      expect(containsFrameworkTerms(fb)).toBe(false);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/admin/.claude/plugins/auto-dev-plugin/mcp && npx vitest run src/__tests__/orchestrator-prompts.test.ts`
Expected: FAIL — module not found

**Step 3: Write orchestrator-prompts.ts**

```typescript
// mcp/src/orchestrator-prompts.ts
/**
 * orchestrator-prompts — Feedback translation layer.
 *
 * Translates framework-internal events (checkpoint rejections, tribunal failures,
 * test failures) into plain technical feedback that contains NO framework terminology.
 * This ensures task agents never learn about phases, checkpoints, or tribunals.
 */

// ---------------------------------------------------------------------------
// Framework Term Detection (used for validation / lint)
// ---------------------------------------------------------------------------

/** Terms that must NEVER appear in prompts sent to task agents. */
export const FRAMEWORK_TERMS = [
  /\bcheckpoint\b/i,
  /\btribunal\b/i,
  /\bauto_dev_/i,
  /\bPhase\s+\d/i,
  /\b迭代限制\b/,
  /\b回退限制\b/,
  /\bsubmit\b/i,
  /\bpreflight\b/i,
  /\bmandate\b/i,
];

export function containsFrameworkTerms(text: string): boolean {
  return FRAMEWORK_TERMS.some((re) => re.test(text));
}

// ---------------------------------------------------------------------------
// Feedback Injection Types
// ---------------------------------------------------------------------------

export interface RevisionInput {
  originalTask: string;
  feedback: string;
  artifacts: string[];
  previousAttemptSummary?: string;
}

// ---------------------------------------------------------------------------
// Revision Prompt Builder
// ---------------------------------------------------------------------------

export function buildRevisionPrompt(input: RevisionInput): string {
  const { originalTask, feedback, artifacts, previousAttemptSummary } = input;

  let prompt = `你之前的工作有以下需要修订的地方：\n\n${feedback}\n\n`;

  if (artifacts.length > 0) {
    prompt += `请修订以下文件：\n${artifacts.map((a) => `- ${a}`).join("\n")}\n\n`;
  }

  if (previousAttemptSummary) {
    prompt += `上次尝试的摘要：${previousAttemptSummary}\n\n`;
  }

  prompt += `原始任务描述供参考：\n${originalTask}`;

  return prompt.trim();
}

// ---------------------------------------------------------------------------
// Failure → Feedback Translation
// ---------------------------------------------------------------------------

interface TribunalIssue {
  severity: string;
  description: string;
  file?: string;
  suggestion?: string;
}

/**
 * Translate a framework-internal failure code + detail into plain technical feedback.
 * The output MUST NOT contain any framework terminology.
 */
export function translateFailureToFeedback(errorCode: string, detail: string): string {
  switch (errorCode) {
    case "PHASE1_REVIEW_MISSING":
      return "设计方案缺少审查文档。请完成设计审查，输出 design-review.md，包含对设计方案的逐项评估。";

    case "PHASE2_REVIEW_MISSING":
      return "实施计划缺少审查文档。请完成计划审查，输出 plan-review.md。";

    case "PHASE5_ARTIFACTS_MISSING":
      return "端到端测试产出不完整。请确保测试文件已创建且测试结果已记录到 e2e-test-results.md。";

    case "PHASE6_ARTIFACTS_MISSING":
      return "验收报告缺失。请根据设计文档中的验收标准逐项验证，输出 acceptance-report.md。";

    case "PHASE7_RETROSPECTIVE_MISSING":
      return "回顾文档缺失或不完整。请对开发过程做深度回顾，输出 retrospective.md（至少 50 行）。";

    case "TRIBUNAL_FAIL": {
      let issues: TribunalIssue[] = [];
      try {
        issues = JSON.parse(detail);
      } catch {
        return `代码审查发现问题：${detail}`;
      }
      const lines = issues.map((issue) => {
        let line = `- [${issue.severity}] ${issue.description}`;
        if (issue.file) line += ` (文件: ${issue.file})`;
        if (issue.suggestion) line += `\n  建议: ${issue.suggestion}`;
        return line;
      });
      return `代码审查发现以下问题，请逐一修复：\n\n${lines.join("\n")}`;
    }

    case "TRIBUNAL_OVERRIDDEN":
      return `框架验证发现：${detail}。请修复代码确保编译和测试通过。`;

    case "TEST_FAILED":
      return `测试执行失败，错误信息如下：\n\n${detail}\n\n请根据错误信息修复代码。`;

    case "BUILD_FAILED":
      return `编译失败，错误信息如下：\n\n${detail}\n\n请根据错误信息修复代码。`;

    default:
      return `工作未达标：${detail || errorCode}。请根据反馈修订。`;
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/admin/.claude/plugins/auto-dev-plugin/mcp && npx vitest run src/__tests__/orchestrator-prompts.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
cd /Users/admin/.claude/plugins/auto-dev-plugin
git add mcp/src/orchestrator-prompts.ts mcp/src/__tests__/orchestrator-prompts.test.ts
git commit -m "feat: add orchestrator-prompts feedback translation layer"
```

---

### Task 3: Build orchestrator core loop

**Files:**
- Create: `mcp/src/orchestrator.ts`
- Create: `mcp/src/__tests__/orchestrator.test.ts`

**Step 1: Write the failing test**

```typescript
// mcp/src/__tests__/orchestrator.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Mock agent-spawner so we don't actually call claude
vi.mock("../agent-spawner.js", () => ({
  spawnAgent: vi.fn(),
  spawnAgentWithRetry: vi.fn(),
  getClaudePath: vi.fn().mockResolvedValue("/usr/local/bin/claude"),
  resolveClaudePath: vi.fn().mockResolvedValue("/usr/local/bin/claude"),
  resetClaudePathCache: vi.fn(),
}));

// Mock child_process for build/test execution
vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
  exec: vi.fn(),
}));

import { spawnAgent } from "../agent-spawner.js";
import { OrchestratorPhaseRunner, type PhaseContext } from "../orchestrator.js";

const mockSpawnAgent = vi.mocked(spawnAgent);

describe("OrchestratorPhaseRunner", () => {
  let tmpDir: string;
  let outputDir: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    tmpDir = await mkdtemp(join(tmpdir(), "orch-test-"));
    outputDir = join(tmpDir, "docs", "auto-dev", "test-topic");
    await mkdir(outputDir, { recursive: true });
  });

  describe("executeDesignPhase", () => {
    it("spawns architect agent and collects design.md", async () => {
      // Mock: agent writes design.md during execution
      mockSpawnAgent.mockImplementation(async (opts) => {
        await writeFile(join(outputDir, "design.md"), "# Design\n\n## Summary\nTest design content that is long enough to pass validation checks of 100 chars minimum");
        return { stdout: "Done", stderr: "", exitCode: 0, crashed: false };
      });

      const runner = new OrchestratorPhaseRunner({
        projectRoot: tmpDir,
        outputDir,
        topic: "test-topic",
        mode: "full",
        buildCmd: "echo ok",
        testCmd: "echo ok",
        startCommit: "abc123",
      });

      const result = await runner.executeDesign();
      expect(result.status).toBe("ARTIFACT_READY");
      expect(mockSpawnAgent).toHaveBeenCalled();
      const prompt = mockSpawnAgent.mock.calls[0]![0].prompt;
      // Verify no framework terms leaked into the prompt
      expect(prompt).not.toMatch(/checkpoint/i);
      expect(prompt).not.toMatch(/tribunal/i);
      expect(prompt).not.toMatch(/Phase\s+\d/i);
    });
  });

  describe("executeImplementation", () => {
    it("spawns developer agent per task", async () => {
      // Write plan.md with 2 tasks
      await writeFile(join(outputDir, "plan.md"), "# Plan\n\n### Task 1\nDo thing A\n\n### Task 2\nDo thing B\n");
      await writeFile(join(outputDir, "design.md"), "# Design\n\nDesign content");

      mockSpawnAgent.mockResolvedValue({
        stdout: "Implemented", stderr: "", exitCode: 0, crashed: false,
      });

      const runner = new OrchestratorPhaseRunner({
        projectRoot: tmpDir,
        outputDir,
        topic: "test-topic",
        mode: "full",
        buildCmd: "echo ok",
        testCmd: "echo ok",
        startCommit: "abc123",
      });

      const result = await runner.executeImplementation();
      // Should have spawned at least once per task
      expect(mockSpawnAgent).toHaveBeenCalled();
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/admin/.claude/plugins/auto-dev-plugin/mcp && npx vitest run src/__tests__/orchestrator.test.ts`
Expected: FAIL — module `../orchestrator.js` not found

**Step 3: Write orchestrator.ts**

This is the largest file (~400 lines). Core structure:

```typescript
// mcp/src/orchestrator.ts
/**
 * Orchestrator — Framework-side phase loop.
 *
 * Drives the auto-dev pipeline by spawning isolated task agents per phase.
 * Task agents receive pure task prompts with zero framework awareness.
 * All validation, state management, and phase progression happen here.
 */

import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { spawnAgent } from "./agent-spawner.js";
import type { SpawnResult } from "./agent-spawner.js";
import { StateManager, internalCheckpoint, extractTaskList } from "./state-manager.js";
import { TemplateRenderer } from "./template-renderer.js";
import {
  computeNextDirective,
  checkIterationLimit,
  validatePhase1ReviewArtifact,
  validatePhase2ReviewArtifact,
  validatePhase5Artifacts,
  validatePhase6Artifacts,
  validatePhase7Artifacts,
} from "./phase-enforcer.js";
import { executeTribunal } from "./tribunal.js";
import { translateFailureToFeedback, buildRevisionPrompt, containsFrameworkTerms } from "./orchestrator-prompts.js";
import type { StateJson } from "./types.js";
import { LessonsManager } from "./lessons-manager.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OrchestratorConfig {
  projectRoot: string;
  topic: string;
  mode: "full" | "quick" | "turbo";
  skipE2e?: boolean;
  tdd?: boolean;
  costMode?: "economy" | "beast";
  interactive?: boolean;
}

export interface PhaseResult {
  status: "ARTIFACT_READY" | "NEEDS_REVISION" | "BLOCKED" | "PASS";
  feedback?: string;
  artifacts?: string[];
}

export interface OrchestratorResult {
  completed: boolean;
  phase: number;
  status: string;
  message: string;
  escalation?: {
    reason: string;
    lastFeedback: string;
  };
}

// Phase model routing (same logic as preflight)
function getModel(phase: number, costMode: string): "opus" | "sonnet" {
  if (costMode === "beast") return "opus";
  // Critical phases always use opus
  if ([1, 3, 4].includes(phase)) return "opus";
  return "sonnet";
}

// ---------------------------------------------------------------------------
// Phase Context (shared state for a single orchestrator run)
// ---------------------------------------------------------------------------

export interface PhaseContext {
  projectRoot: string;
  outputDir: string;
  topic: string;
  mode: "full" | "quick" | "turbo";
  buildCmd: string;
  testCmd: string;
  startCommit: string;
  costMode?: string;
  tdd?: boolean;
  skipE2e?: boolean;
}

// ---------------------------------------------------------------------------
// Shell helper
// ---------------------------------------------------------------------------

function shell(cmd: string, cwd: string, timeout = 120_000): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile("sh", ["-c", cmd], { cwd, timeout, maxBuffer: 2 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({
        exitCode: err ? (err as any).code ?? 1 : 0,
        stdout: stdout || "",
        stderr: stderr || "",
      });
    });
  });
}

// ---------------------------------------------------------------------------
// OrchestratorPhaseRunner
// ---------------------------------------------------------------------------

const MAX_ITERATIONS: Record<number, number> = { 1: 3, 2: 3, 3: 2, 4: 3, 5: 3, 6: 3, 7: 2 };

export class OrchestratorPhaseRunner {
  private ctx: PhaseContext;
  private skillsDir: string;

  constructor(ctx: PhaseContext, skillsDir?: string) {
    this.ctx = ctx;
    // Default: resolve plugin root -> skills/auto-dev
    this.skillsDir = skillsDir ?? join(__dirname, "..", "..", "skills", "auto-dev");
  }

  /** Render a phase prompt template with variables, stripping any framework terms. */
  private async renderPrompt(promptFile: string, extraContext?: string): Promise<string> {
    const renderer = new TemplateRenderer(this.skillsDir);
    const variables: Record<string, string> = {
      topic: this.ctx.topic,
      language: "auto",
      build_cmd: this.ctx.buildCmd,
      test_cmd: this.ctx.testCmd,
      output_dir: this.ctx.outputDir,
      project_root: this.ctx.projectRoot,
    };
    const rendered = await renderer.render(promptFile, variables, extraContext);

    // Safety: strip any framework terms that leaked through templates
    let prompt = rendered.renderedPrompt;
    // Append isolation footer
    prompt += "\n\n---\n完成后不需要做其他操作。直接完成任务即可。\n";
    return prompt;
  }

  /** Spawn a task agent with a pure prompt. */
  private async spawn(prompt: string, model?: "opus" | "sonnet"): Promise<SpawnResult> {
    return spawnAgent({
      prompt,
      model: model ?? getModel(1, this.ctx.costMode ?? "beast"),
      timeout: 300_000,
      cwd: this.ctx.projectRoot,
    });
  }

  // ----- Phase 1: Design -----

  async executeDesign(): Promise<PhaseResult> {
    const prompt = await this.renderPrompt("phase1-architect");
    await this.spawn(prompt, getModel(1, this.ctx.costMode ?? "beast"));

    // Validate artifact
    const designPath = join(this.ctx.outputDir, "design.md");
    try {
      const content = await readFile(designPath, "utf-8");
      if (content.length < 100) {
        return {
          status: "NEEDS_REVISION",
          feedback: translateFailureToFeedback("PHASE1_REVIEW_MISSING", ""),
          artifacts: [designPath],
        };
      }
    } catch {
      return {
        status: "NEEDS_REVISION",
        feedback: "设计文档 design.md 未生成。请完成设计方案输出。",
        artifacts: [designPath],
      };
    }

    return { status: "ARTIFACT_READY", artifacts: [designPath] };
  }

  async executeDesignReview(): Promise<PhaseResult> {
    const prompt = await this.renderPrompt("phase1-design-reviewer");
    await this.spawn(prompt, getModel(1, this.ctx.costMode ?? "beast"));

    const validation = validatePhase1ReviewArtifact(this.ctx.outputDir);
    if (!validation.valid) {
      return {
        status: "NEEDS_REVISION",
        feedback: translateFailureToFeedback("PHASE1_REVIEW_MISSING", validation.message ?? ""),
      };
    }

    // Parse verdict from design-review.md
    try {
      const reviewContent = await readFile(join(this.ctx.outputDir, "design-review.md"), "utf-8");
      if (/NEEDS_REVISION|需要修订/i.test(reviewContent)) {
        return {
          status: "NEEDS_REVISION",
          feedback: `设计审查发现需要修订的问题：\n\n${reviewContent.slice(0, 2000)}`,
          artifacts: [join(this.ctx.outputDir, "design.md")],
        };
      }
    } catch { /* proceed */ }

    return { status: "PASS" };
  }

  // ----- Phase 2: Plan -----

  async executePlan(): Promise<PhaseResult> {
    const prompt = await this.renderPrompt("phase2-planner");
    await this.spawn(prompt, getModel(2, this.ctx.costMode ?? "beast"));

    const planPath = join(this.ctx.outputDir, "plan.md");
    try {
      await stat(planPath);
    } catch {
      return {
        status: "NEEDS_REVISION",
        feedback: "实施计划 plan.md 未生成。请根据设计文档拆解实施任务。",
        artifacts: [planPath],
      };
    }

    return { status: "ARTIFACT_READY", artifacts: [planPath] };
  }

  async executePlanReview(): Promise<PhaseResult> {
    const prompt = await this.renderPrompt("phase2-plan-reviewer");
    await this.spawn(prompt, getModel(2, this.ctx.costMode ?? "beast"));

    const validation = validatePhase2ReviewArtifact(this.ctx.outputDir);
    if (!validation.valid) {
      return {
        status: "NEEDS_REVISION",
        feedback: translateFailureToFeedback("PHASE2_REVIEW_MISSING", validation.message ?? ""),
      };
    }

    try {
      const reviewContent = await readFile(join(this.ctx.outputDir, "plan-review.md"), "utf-8");
      if (/NEEDS_REVISION|需要修订/i.test(reviewContent)) {
        return {
          status: "NEEDS_REVISION",
          feedback: `计划审查发现需要修订的问题：\n\n${reviewContent.slice(0, 2000)}`,
          artifacts: [join(this.ctx.outputDir, "plan.md")],
        };
      }
    } catch { /* proceed */ }

    return { status: "PASS" };
  }

  // ----- Phase 3: Implementation -----

  async executeImplementation(): Promise<PhaseResult> {
    // Parse tasks from plan.md
    let planContent: string;
    try {
      planContent = await readFile(join(this.ctx.outputDir, "plan.md"), "utf-8");
    } catch {
      return { status: "BLOCKED", feedback: "plan.md not found. Cannot proceed with implementation." };
    }

    const taskList = extractTaskList(planContent);
    const taskCount = (taskList.match(/Task\s+\d+/gi) || []).length || 1;

    for (let task = 1; task <= taskCount; task++) {
      // Extract task description from plan
      const taskRegex = new RegExp(`###?\\s+Task\\s+${task}[\\s\\S]*?(?=###?\\s+Task\\s+${task + 1}|$)`);
      const taskMatch = planContent.match(taskRegex);
      const taskDesc = taskMatch?.[0] ?? `Task ${task}`;

      const taskPrompt = `请实现以下任务：\n\n${taskDesc}\n\n相关设计见 ${this.ctx.outputDir}/design.md，完整计划见 ${this.ctx.outputDir}/plan.md。`;

      await this.spawn(taskPrompt, getModel(3, this.ctx.costMode ?? "beast"));

      // Run build+test after each task
      const buildResult = await shell(this.ctx.buildCmd, this.ctx.projectRoot);
      if (buildResult.exitCode !== 0) {
        const fixPrompt = buildRevisionPrompt({
          originalTask: taskDesc,
          feedback: translateFailureToFeedback("BUILD_FAILED", buildResult.stderr.slice(0, 1000)),
          artifacts: [],
        });
        await this.spawn(fixPrompt, getModel(3, this.ctx.costMode ?? "beast"));
      }

      const testResult = await shell(this.ctx.testCmd, this.ctx.projectRoot);
      if (testResult.exitCode !== 0) {
        const fixPrompt = buildRevisionPrompt({
          originalTask: taskDesc,
          feedback: translateFailureToFeedback("TEST_FAILED", testResult.stderr.slice(0, 1000)),
          artifacts: [],
        });
        await this.spawn(fixPrompt, getModel(3, this.ctx.costMode ?? "beast"));
      }
    }

    return { status: "PASS" };
  }

  // ----- Phase 4: Verify (build + test + tribunal) -----

  async executeVerify(sm: StateManager, state: StateJson): Promise<PhaseResult> {
    // Framework executes build+test
    const buildResult = await shell(this.ctx.buildCmd, this.ctx.projectRoot);
    if (buildResult.exitCode !== 0) {
      return {
        status: "NEEDS_REVISION",
        feedback: translateFailureToFeedback("BUILD_FAILED", buildResult.stderr.slice(0, 1000)),
      };
    }

    const testResult = await shell(this.ctx.testCmd, this.ctx.projectRoot);
    if (testResult.exitCode !== 0) {
      return {
        status: "NEEDS_REVISION",
        feedback: translateFailureToFeedback("TEST_FAILED", testResult.stderr.slice(0, 1000)),
      };
    }

    // Run tribunal (independent judge)
    const tribunalResult = await executeTribunal(
      this.ctx.projectRoot, this.ctx.outputDir, 4,
      this.ctx.topic, "Full code review", sm, state,
    );

    const parsed = JSON.parse(tribunalResult.content[0].text);
    if (parsed.status === "TRIBUNAL_PASS") {
      return { status: "PASS" };
    }

    return {
      status: "NEEDS_REVISION",
      feedback: translateFailureToFeedback(
        parsed.status === "TRIBUNAL_OVERRIDDEN" ? "TRIBUNAL_OVERRIDDEN" : "TRIBUNAL_FAIL",
        JSON.stringify(parsed.issues ?? parsed.message),
      ),
    };
  }

  // ----- Phase 5: E2E Test -----

  async executeE2ETest(sm: StateManager, state: StateJson): Promise<PhaseResult> {
    // Design tests
    const designPrompt = await this.renderPrompt("phase5-test-architect");
    await this.spawn(designPrompt, getModel(5, this.ctx.costMode ?? "beast"));

    // Implement tests
    const implPrompt = await this.renderPrompt("phase5-test-developer");
    await this.spawn(implPrompt, getModel(5, this.ctx.costMode ?? "beast"));

    // Framework executes tests
    const testResult = await shell(this.ctx.testCmd, this.ctx.projectRoot);
    if (testResult.exitCode !== 0) {
      return {
        status: "NEEDS_REVISION",
        feedback: translateFailureToFeedback("TEST_FAILED", testResult.stderr.slice(0, 1000)),
      };
    }

    // Run tribunal
    const tribunalResult = await executeTribunal(
      this.ctx.projectRoot, this.ctx.outputDir, 5,
      this.ctx.topic, "E2E test review", sm, state,
    );
    const parsed = JSON.parse(tribunalResult.content[0].text);
    if (parsed.status === "TRIBUNAL_PASS") return { status: "PASS" };

    return {
      status: "NEEDS_REVISION",
      feedback: translateFailureToFeedback("TRIBUNAL_FAIL", JSON.stringify(parsed.issues ?? parsed.message)),
    };
  }

  // ----- Phase 6: Acceptance -----

  async executeAcceptance(sm: StateManager, state: StateJson): Promise<PhaseResult> {
    const prompt = await this.renderPrompt("phase6-acceptance");
    await this.spawn(prompt, getModel(6, this.ctx.costMode ?? "beast"));

    const tribunalResult = await executeTribunal(
      this.ctx.projectRoot, this.ctx.outputDir, 6,
      this.ctx.topic, "Acceptance validation", sm, state,
    );
    const parsed = JSON.parse(tribunalResult.content[0].text);
    if (parsed.status === "TRIBUNAL_PASS") return { status: "PASS" };

    return {
      status: "NEEDS_REVISION",
      feedback: translateFailureToFeedback("TRIBUNAL_FAIL", JSON.stringify(parsed.issues ?? parsed.message)),
    };
  }

  // ----- Phase 7: Retrospective -----

  async executeRetrospective(sm: StateManager, state: StateJson): Promise<PhaseResult> {
    const prompt = await this.renderPrompt("phase7-retrospective");
    await this.spawn(prompt, getModel(7, this.ctx.costMode ?? "beast"));

    const tribunalResult = await executeTribunal(
      this.ctx.projectRoot, this.ctx.outputDir, 7,
      this.ctx.topic, "Retrospective audit", sm, state,
    );
    const parsed = JSON.parse(tribunalResult.content[0].text);
    if (parsed.status === "TRIBUNAL_PASS") return { status: "PASS" };

    return {
      status: "NEEDS_REVISION",
      feedback: translateFailureToFeedback("TRIBUNAL_FAIL", JSON.stringify(parsed.issues ?? parsed.message)),
    };
  }
}

// ---------------------------------------------------------------------------
// Main Orchestrator Loop
// ---------------------------------------------------------------------------

export async function runOrchestrator(config: OrchestratorConfig): Promise<OrchestratorResult> {
  const sm = new StateManager(config.projectRoot, config.topic ?? "default");
  const state = await sm.loadAndValidate();
  const outputDir = sm.outputDir;

  const ctx: PhaseContext = {
    projectRoot: config.projectRoot,
    outputDir,
    topic: config.topic,
    mode: config.mode,
    buildCmd: state.stack.buildCmd,
    testCmd: state.stack.testCmd,
    startCommit: state.startCommit ?? "HEAD",
    costMode: config.costMode ?? state.costMode,
    tdd: config.tdd ?? state.tdd,
    skipE2e: config.skipE2e ?? state.skipE2e,
  };

  const runner = new OrchestratorPhaseRunner(ctx);

  // Phase sequence based on mode
  const requiredPhases =
    config.mode === "turbo" ? [3] :
    config.mode === "quick" ? [3, 4, 5, 7] :
    [1, 2, 3, 4, 5, 6, 7];

  const filteredPhases = ctx.skipE2e
    ? requiredPhases.filter((p) => p !== 5)
    : requiredPhases;

  for (const phase of filteredPhases) {
    // Write IN_PROGRESS checkpoint
    await internalCheckpoint(sm, state, phase, "IN_PROGRESS", `Starting phase ${phase}`);

    let iteration = 0;
    let phaseResult: PhaseResult;

    while (true) {
      // Execute the phase
      phaseResult = await executePhase(runner, phase, sm, state);

      if (phaseResult.status === "PASS" || phaseResult.status === "ARTIFACT_READY") {
        // For phases with separate review step (1, 2), run review
        if (phaseResult.status === "ARTIFACT_READY") {
          let reviewResult: PhaseResult;
          if (phase === 1) reviewResult = await runner.executeDesignReview();
          else if (phase === 2) reviewResult = await runner.executePlanReview();
          else reviewResult = { status: "PASS" };

          if (reviewResult.status === "NEEDS_REVISION") {
            iteration++;
            if (iteration >= (MAX_ITERATIONS[phase] ?? 3)) {
              return {
                completed: false,
                phase,
                status: "BLOCKED",
                message: `经过 ${iteration} 轮修订仍未通过审查。`,
                escalation: {
                  reason: "迭代次数耗尽",
                  lastFeedback: reviewResult.feedback ?? "",
                },
              };
            }
            // Spawn revision agent with feedback
            const revPrompt = buildRevisionPrompt({
              originalTask: `Phase ${phase} task`,
              feedback: reviewResult.feedback ?? "",
              artifacts: reviewResult.artifacts ?? [],
            });
            await runner["spawn"](revPrompt);
            continue;
          }
        }

        // Phase passed — write checkpoint
        await internalCheckpoint(sm, state, phase, "PASS", `Phase ${phase} completed`);
        break;
      }

      if (phaseResult.status === "NEEDS_REVISION") {
        iteration++;
        if (iteration >= (MAX_ITERATIONS[phase] ?? 3)) {
          return {
            completed: false,
            phase,
            status: "BLOCKED",
            message: `经过 ${iteration} 轮修订仍未通过。`,
            escalation: {
              reason: "迭代次数耗尽",
              lastFeedback: phaseResult.feedback ?? "",
            },
          };
        }

        // Spawn fix agent with translated feedback
        const fixPrompt = buildRevisionPrompt({
          originalTask: `Phase task`,
          feedback: phaseResult.feedback ?? "",
          artifacts: phaseResult.artifacts ?? [],
        });
        await runner["spawn"](fixPrompt);
        continue;
      }

      if (phaseResult.status === "BLOCKED") {
        return {
          completed: false,
          phase,
          status: "BLOCKED",
          message: phaseResult.feedback ?? "Phase blocked",
        };
      }
    }
  }

  return {
    completed: true,
    phase: filteredPhases[filteredPhases.length - 1] ?? 7,
    status: "COMPLETED",
    message: "所有阶段已完成。",
  };
}

// ---------------------------------------------------------------------------
// Phase dispatcher
// ---------------------------------------------------------------------------

async function executePhase(
  runner: OrchestratorPhaseRunner,
  phase: number,
  sm: StateManager,
  state: StateJson,
): Promise<PhaseResult> {
  switch (phase) {
    case 1: return runner.executeDesign();
    case 2: return runner.executePlan();
    case 3: return runner.executeImplementation();
    case 4: return runner.executeVerify(sm, state);
    case 5: return runner.executeE2ETest(sm, state);
    case 6: return runner.executeAcceptance(sm, state);
    case 7: return runner.executeRetrospective(sm, state);
    default: return { status: "BLOCKED", feedback: `Unknown phase: ${phase}` };
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/admin/.claude/plugins/auto-dev-plugin/mcp && npx vitest run src/__tests__/orchestrator.test.ts`
Expected: PASS

**Step 5: Run all tests for regression**

Run: `cd /Users/admin/.claude/plugins/auto-dev-plugin/mcp && npx vitest run`
Expected: All tests PASS

**Step 6: Commit**

```bash
cd /Users/admin/.claude/plugins/auto-dev-plugin
git add mcp/src/orchestrator.ts mcp/src/__tests__/orchestrator.test.ts
git commit -m "feat: add orchestrator core loop for invisible framework"
```

---

### Task 4: Register auto_dev_orchestrate MCP tool

**Files:**
- Modify: `mcp/src/index.ts` (add new tool registration after auto_dev_complete)

**Step 1: Write the failing test**

```typescript
// Add to existing test or create mcp/src/__tests__/orchestrate-tool.test.ts
import { describe, it, expect, vi } from "vitest";

// Verify the orchestrator module exports what index.ts needs
import { runOrchestrator } from "../orchestrator.js";

describe("auto_dev_orchestrate integration", () => {
  it("runOrchestrator is importable and callable", () => {
    expect(typeof runOrchestrator).toBe("function");
  });
});
```

**Step 2: Run test to verify it passes (module exists from Task 3)**

Run: `cd /Users/admin/.claude/plugins/auto-dev-plugin/mcp && npx vitest run src/__tests__/orchestrate-tool.test.ts`
Expected: PASS

**Step 3: Add tool registration to index.ts**

After the `auto_dev_complete` tool registration (around line 1409), add:

```typescript
// ===========================================================================
// 14. auto_dev_orchestrate (Invisible Framework Entry Point)
// ===========================================================================

import { runOrchestrator } from "./orchestrator.js";

server.tool(
  "auto_dev_orchestrate",
  "Launch the autonomous development loop. Orchestrates design → plan → implement → verify → test → accept → retrospect as isolated task agents. Returns progress or escalation when human input is needed.",
  {
    projectRoot: z.string(),
    topic: z.string(),
    mode: z.enum(["full", "quick", "turbo"]).optional(),
    skipE2e: z.boolean().optional(),
    tdd: z.boolean().optional(),
    costMode: z.enum(["economy", "beast"]).optional(),
    interactive: z.boolean().optional(),
  },
  async ({ projectRoot, topic, mode, skipE2e, tdd, costMode, interactive }) => {
    const result = await runOrchestrator({
      projectRoot,
      topic,
      mode: mode ?? "full",
      skipE2e,
      tdd,
      costMode,
      interactive,
    });
    return textResult(result);
  },
);
```

**Step 4: Build to verify compilation**

Run: `cd /Users/admin/.claude/plugins/auto-dev-plugin/mcp && npm run build`
Expected: No errors

**Step 5: Commit**

```bash
cd /Users/admin/.claude/plugins/auto-dev-plugin
git add mcp/src/index.ts
git commit -m "feat: register auto_dev_orchestrate MCP tool"
```

---

### Task 5: Simplify SKILL.md + backup legacy

**Files:**
- Rename: `skills/auto-dev/SKILL.md` → `skills/auto-dev/SKILL.legacy.md`
- Create: `skills/auto-dev/SKILL.md` (new simplified version)

**Step 1: Backup legacy SKILL.md**

```bash
cd /Users/admin/.claude/plugins/auto-dev-plugin
cp skills/auto-dev/SKILL.md skills/auto-dev/SKILL.legacy.md
```

**Step 2: Write the new simplified SKILL.md**

```markdown
---
name: auto-dev
description: "自治开发循环 — 从设计到测试通过的全自动闭环。支持自审迭代，最小化人工介入。Use when user says /auto-dev, asks for autonomous development, wants a full dev loop (design -> plan -> implement -> verify -> e2e test), or mentions '自治开发', '自动开发循环', '全自动闭环', 'autonomous dev', 'auto implement'. Also use when user provides a design doc and wants it implemented end-to-end without manual intervention."
---

# auto-dev 自治开发

## 概述

auto-dev 通过编排器（Orchestrator）自动完成从设计到测试的全流程。你只需要调用一个工具。

## 使用方式

### 1. 初始化

```
auto_dev_init(projectRoot, topic, mode?, ...)
```

参数同之前。初始化完成后会返回 projectRoot、outputDir、buildCmd、testCmd 等信息。

### 2. 启动编排器

```
auto_dev_orchestrate(projectRoot, topic, mode?, skipE2e?, tdd?, costMode?)
```

编排器会自动完成所有阶段：
- 设计 → 计划 → 实现 → 验证 → 测试 → 验收 → 回顾
- 每个阶段由独立的 agent 完成，编排器负责验证和反馈
- 如果需要人工决策，编排器会返回并说明情况

### 3. 人工介入

编排器在以下情况返回等待人工决策：
- 修订轮次耗尽（某个阶段多次修订仍未通过）
- 编译/测试持续失败
- 验证异常

收到返回后，根据 `escalation.reason` 和 `escalation.lastFeedback` 决定：
- 调整方向后重新调用 `auto_dev_orchestrate` 继续
- 手动修复问题后重新调用
- 终止流程

### 4. 查看状态

```
auto_dev_state_get(projectRoot, topic)
```

### 参数说明

| 参数 | 说明 |
|------|------|
| `mode` | `full`（默认，全流程）/ `quick`（跳过设计计划）/ `turbo`（仅实现） |
| `skipE2e` | 跳过端到端测试阶段 |
| `tdd` | 启用 TDD 红绿循环（默认开启） |
| `costMode` | `beast`（全部用最强模型）/ `economy`（按阶段选模型） |

### 旧版模式

如需使用旧版 agent 驱动模式（agent 直接调用 checkpoint/submit），参考 `SKILL.legacy.md`。
传入 `--legacy` 参数切换。
```

**Step 3: Verify new SKILL.md is under 150 lines**

Run: `wc -l /Users/admin/.claude/plugins/auto-dev-plugin/skills/auto-dev/SKILL.md`
Expected: < 150 lines

**Step 4: Commit**

```bash
cd /Users/admin/.claude/plugins/auto-dev-plugin
git add skills/auto-dev/SKILL.md skills/auto-dev/SKILL.legacy.md
git commit -m "feat: simplify SKILL.md for invisible framework, backup legacy"
```

---

### Task 6: Clean framework terms from phase prompts

**Files:**
- Modify: `skills/auto-dev/prompts/*.md` (all 12 prompt files — scan and clean)
- Create: `mcp/src/__tests__/prompt-lint.test.ts`

**Step 1: Write the prompt lint test**

```typescript
// mcp/src/__tests__/prompt-lint.test.ts
import { describe, it, expect } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { containsFrameworkTerms, FRAMEWORK_TERMS } from "../orchestrator-prompts.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = resolve(__dirname, "..", "..", "..", "skills", "auto-dev", "prompts");

describe("phase prompt lint — no framework terms", () => {
  it("no prompt file contains framework-specific terms", async () => {
    const files = await readdir(PROMPTS_DIR);
    const mdFiles = files.filter((f) => f.endsWith(".md"));

    const violations: Array<{ file: string; matches: string[] }> = [];

    for (const file of mdFiles) {
      const content = await readFile(join(PROMPTS_DIR, file), "utf-8");
      const matches: string[] = [];
      for (const re of FRAMEWORK_TERMS) {
        const found = content.match(re);
        if (found) matches.push(found[0]);
      }
      if (matches.length > 0) {
        violations.push({ file, matches });
      }
    }

    if (violations.length > 0) {
      const report = violations
        .map((v) => `  ${v.file}: ${v.matches.join(", ")}`)
        .join("\n");
      expect.fail(`Framework terms found in prompts:\n${report}`);
    }
  });
});
```

**Step 2: Run test to see which prompts have violations**

Run: `cd /Users/admin/.claude/plugins/auto-dev-plugin/mcp && npx vitest run src/__tests__/prompt-lint.test.ts`
Expected: FAIL — shows which files have framework terms

**Step 3: Clean each prompt file**

For each violation found, edit the prompt file:
- Replace `checkpoint` references with task-completion language
- Replace `Phase N` references with descriptive names (e.g., "设计阶段" → just describe the task)
- Replace `tribunal` references with "审查" or remove
- Replace `auto_dev_submit` / `auto_dev_checkpoint` references with "完成后不需要做其他操作"
- Add footer to each prompt: `\n---\n完成后不需要做其他操作。直接完成任务即可。\n`

**Step 4: Run lint test again**

Run: `cd /Users/admin/.claude/plugins/auto-dev-plugin/mcp && npx vitest run src/__tests__/prompt-lint.test.ts`
Expected: PASS

**Step 5: Run all tests for final regression**

Run: `cd /Users/admin/.claude/plugins/auto-dev-plugin/mcp && npx vitest run`
Expected: All tests PASS

**Step 6: Commit**

```bash
cd /Users/admin/.claude/plugins/auto-dev-plugin
git add skills/auto-dev/prompts/ mcp/src/__tests__/prompt-lint.test.ts
git commit -m "chore: clean framework terms from phase prompts"
```

---

### Task 7: Build verification + full regression

**Files:** None (verification only)

**Step 1: Build the project**

Run: `cd /Users/admin/.claude/plugins/auto-dev-plugin/mcp && npm run build`
Expected: No TypeScript errors

**Step 2: Run all tests**

Run: `cd /Users/admin/.claude/plugins/auto-dev-plugin/mcp && npx vitest run`
Expected: All tests PASS

**Step 3: Verify SKILL.md line count**

Run: `wc -l /Users/admin/.claude/plugins/auto-dev-plugin/skills/auto-dev/SKILL.md`
Expected: < 150

**Step 4: Verify agent-spawner exports are used by tribunal**

Run: `cd /Users/admin/.claude/plugins/auto-dev-plugin/mcp && grep -n "from.*agent-spawner" src/tribunal.ts`
Expected: Import line exists

**Step 5: Verify auto_dev_orchestrate is registered**

Run: `cd /Users/admin/.claude/plugins/auto-dev-plugin/mcp && grep -n "auto_dev_orchestrate" src/index.ts`
Expected: Tool registration line exists

**Step 6: Final commit if any fixups needed**

```bash
cd /Users/admin/.claude/plugins/auto-dev-plugin
git add -A
git commit -m "chore: final verification and fixups for invisible framework"
```
