/**
 * GitManager — Git operations for auto-dev MCP Server.
 *
 * Only encapsulates operations that benefit from deterministic tooling:
 * diff_check (plan vs actual file comparison) and rollback (precise file-level revert).
 * Simple git commands (status, branch, commit, stash) are left to Claude via bash.
 */
import type { GitInfo, DiffCheckOutput } from "./types.js";
export declare class GitManager {
    private static COMMIT_REF_RE;
    private readonly cwd;
    constructor(cwd: string);
    private validateRef;
    /**
     * Return current branch name, dirty status, and diff stat.
     */
    getStatus(): Promise<GitInfo>;
    /**
     * Compare plan-expected files against actual git changes since baseCommit.
     */
    diffCheck(expectedFiles: string[], baseCommit: string): Promise<DiffCheckOutput>;
    /**
     * Rollback changes to baseCommit state.
     *
     * - If `files` is provided, checkout only those files.
     * - Otherwise, discover all changed files via `git diff --name-only` and
     *   checkout each one individually.
     */
    rollback(baseCommit: string, files?: string[]): Promise<{
        rolledBack: string[];
        message: string;
    }>;
    private execGit;
}
