/**
 * GitManager — Git operations for auto-dev MCP Server.
 *
 * Only encapsulates operations that benefit from deterministic tooling:
 * diff_check (plan vs actual file comparison) and rollback (precise file-level revert).
 * Simple git commands (status, branch, commit, stash) are left to Claude via bash.
 */

import { execFile } from "node:child_process";
import type { GitInfo, DiffCheckOutput } from "./types.js";

export class GitManager {
  private static COMMIT_REF_RE = /^[a-zA-Z0-9_\-./~^@{}]+$/;

  private readonly cwd: string;

  constructor(cwd: string) {
    this.cwd = cwd;
  }

  private validateRef(ref: string): void {
    if (!GitManager.COMMIT_REF_RE.test(ref) || ref.startsWith("-")) {
      throw new Error(`Invalid git ref: ${ref}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Return current branch name, dirty status, and diff stat.
   */
  async getStatus(): Promise<GitInfo> {
    const currentBranch = (
      await this.execGit("rev-parse", "--abbrev-ref", "HEAD")
    ).trim();

    const statusOutput = (await this.execGit("status", "--porcelain")).trim();
    const isDirty = statusOutput.length > 0;

    let diffStat = "";
    if (isDirty) {
      diffStat = (await this.execGit("diff", "--stat")).trim();
    }

    return { currentBranch, isDirty, diffStat };
  }

  /**
   * Return the full SHA of the current HEAD commit.
   */
  async getHeadCommit(): Promise<string> {
    return (await this.execGit("rev-parse", "HEAD")).trim();
  }

  /**
   * Compare plan-expected files against actual git changes since baseCommit.
   */
  async diffCheck(
    expectedFiles: string[],
    baseCommit: string,
  ): Promise<DiffCheckOutput> {
    this.validateRef(baseCommit);

    const nameOnlyOutput = await this.execGit(
      "diff",
      "--name-only",
      `${baseCommit}..HEAD`,
      "--",
    );
    const actualFiles = nameOnlyOutput
      .trim()
      .split("\n")
      .filter((f) => f.length > 0);

    const actualSet = new Set(actualFiles);
    const expectedSet = new Set(expectedFiles);

    const expectedButMissing = expectedFiles.filter((f) => !actualSet.has(f));
    const unexpectedChanges = actualFiles.filter((f) => !expectedSet.has(f));

    const diffStat = (
      await this.execGit("diff", "--stat", `${baseCommit}..HEAD`, "--")
    ).trim();

    const isClean =
      expectedButMissing.length === 0 && unexpectedChanges.length === 0;

    return {
      actualFiles,
      expectedButMissing,
      unexpectedChanges,
      diffStat,
      isClean,
    };
  }

  /**
   * Rollback changes to baseCommit state.
   *
   * - If `files` is provided, checkout only those files.
   * - Otherwise, discover all changed files via `git diff --name-only` and
   *   checkout each one individually.
   */
  async rollback(
    baseCommit: string,
    files?: string[],
  ): Promise<{ rolledBack: string[]; message: string }> {
    this.validateRef(baseCommit);

    let targetFiles: string[];

    if (files && files.length > 0) {
      targetFiles = files;
    } else {
      const nameOnlyOutput = await this.execGit(
        "diff",
        "--name-only",
        baseCommit,
        "HEAD",
      );
      targetFiles = nameOnlyOutput
        .trim()
        .split("\n")
        .filter((f) => f.length > 0);
    }

    if (targetFiles.length === 0) {
      return { rolledBack: [], message: "No files to rollback." };
    }

    const rolledBack: string[] = [];
    const errors: string[] = [];

    for (const file of targetFiles) {
      try {
        await this.execGit("checkout", baseCommit, "--", file);
        rolledBack.push(file);
      } catch (err) {
        errors.push(
          `Failed to rollback ${file}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    const parts: string[] = [];
    if (rolledBack.length > 0) {
      parts.push(`Rolled back ${rolledBack.length} file(s).`);
    }
    if (errors.length > 0) {
      parts.push(`Errors: ${errors.join("; ")}`);
    }

    return { rolledBack, message: parts.join(" ") };
  }

  // ---------------------------------------------------------------------------
  // Internal helper
  // ---------------------------------------------------------------------------

  private execGit(...args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile("git", args, { cwd: this.cwd }, (error, stdout, stderr) => {
        if (error) {
          const cmd = `git ${args.join(" ")}`;
          reject(
            new Error(
              `Git command failed: ${cmd}\n${stderr?.trim() ?? error.message}`,
            ),
          );
          return;
        }
        resolve(stdout);
      });
    });
  }
}
