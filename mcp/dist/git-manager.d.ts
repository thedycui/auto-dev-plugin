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
     * Return the full SHA of the current HEAD commit.
     */
    getHeadCommit(): Promise<string>;
    /**
     * IMP-003: Unified function to get changed files (committed + staged + untracked).
     *
     * @param options.baseCommit - Base commit for diff (default: "HEAD~20")
     * @param options.includeCommitted - Include committed changes since baseCommit (default: true)
     * @param options.includeStaged - Include staged changes (default: true)
     * @param options.includeUntracked - Include untracked files (default: true)
     * @param options.diffFilter - Git diff-filter option (default: "AM" for added/modified)
     * @returns Array of changed file paths
     */
    getChangedFiles(options?: {
        baseCommit?: string;
        includeCommitted?: boolean;
        includeStaged?: boolean;
        includeUntracked?: boolean;
        diffFilter?: string;
    }): Promise<string[]>;
    /**
     * IMP-003: Get git diff --stat output with untracked files listing.
     * Used for tribunal digest generation.
     *
     * @param baseCommit - Base commit for diff (default: "HEAD")
     * @returns Formatted string with diff stat and untracked files
     */
    getDiffStatWithUntracked(baseCommit?: string): Promise<string>;
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
