/**
 * GitManager — Git operations for auto-dev MCP Server.
 *
 * Only encapsulates operations that benefit from deterministic tooling:
 * diff_check (plan vs actual file comparison) and rollback (precise file-level revert).
 * Simple git commands (status, branch, commit, stash) are left to Claude via bash.
 */
import { execFile } from "node:child_process";
export class GitManager {
    static COMMIT_REF_RE = /^[a-zA-Z0-9_\-./~^@{}]+$/;
    cwd;
    constructor(cwd) {
        this.cwd = cwd;
    }
    validateRef(ref) {
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
    async getStatus() {
        const currentBranch = (await this.execGit("rev-parse", "--abbrev-ref", "HEAD")).trim();
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
    async getHeadCommit() {
        return (await this.execGit("rev-parse", "HEAD")).trim();
    }
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
    async getChangedFiles(options) {
        const opts = {
            baseCommit: "HEAD~20",
            includeCommitted: true,
            includeStaged: true,
            includeUntracked: true,
            diffFilter: "AM",
            ...options,
        };
        const parts = [];
        // Committed changes since baseCommit
        if (opts.includeCommitted) {
            const committed = await this.execGit("diff", "--name-only", `--diff-filter=${opts.diffFilter}`, `${opts.baseCommit}..HEAD`);
            parts.push(committed);
        }
        // Staged but not yet committed
        if (opts.includeStaged) {
            const staged = await this.execGit("diff", "--cached", "--name-only", `--diff-filter=${opts.diffFilter}`);
            parts.push(staged);
        }
        // Untracked new files
        if (opts.includeUntracked) {
            const untracked = await this.execGit("ls-files", "--others", "--exclude-standard");
            parts.push(untracked);
        }
        // Merge and deduplicate
        const allFiles = parts
            .join("\n")
            .trim()
            .split("\n")
            .filter((f) => f.length > 0);
        return [...new Set(allFiles)];
    }
    /**
     * IMP-003: Get git diff --stat output with untracked files listing.
     * Used for tribunal digest generation.
     *
     * @param baseCommit - Base commit for diff (default: "HEAD")
     * @returns Formatted string with diff stat and untracked files
     */
    async getDiffStatWithUntracked(baseCommit) {
        const diffBase = baseCommit ?? "HEAD";
        const tracked = await this.execGit("diff", "--stat", diffBase);
        const untrackedRaw = await this.execGit("ls-files", "--others", "--exclude-standard");
        const untracked = untrackedRaw.trim()
            ? "\nUntracked new files:\n" + untrackedRaw.trim().split("\n").map((f) => ` ${f} (new file)`).join("\n") + "\n"
            : "";
        return tracked + untracked;
    }
    /**
     * Compare plan-expected files against actual git changes since baseCommit.
     */
    async diffCheck(expectedFiles, baseCommit) {
        this.validateRef(baseCommit);
        // Committed changes
        const nameOnlyOutput = await this.execGit("diff", "--name-only", `${baseCommit}..HEAD`, "--");
        // Staged but not yet committed
        const stagedOutput = await this.execGit("diff", "--cached", "--name-only");
        // Untracked new files (invisible to git diff)
        const untrackedOutput = await this.execGit("ls-files", "--others", "--exclude-standard");
        const actualFiles = [...new Set((nameOnlyOutput + "\n" + stagedOutput + "\n" + untrackedOutput)
                .trim()
                .split("\n")
                .filter((f) => f.length > 0))];
        const actualSet = new Set(actualFiles);
        const expectedSet = new Set(expectedFiles);
        const expectedButMissing = expectedFiles.filter((f) => !actualSet.has(f));
        const unexpectedChanges = actualFiles.filter((f) => !expectedSet.has(f));
        const diffStat = (await this.execGit("diff", "--stat", `${baseCommit}..HEAD`, "--")).trim();
        const isClean = expectedButMissing.length === 0 && unexpectedChanges.length === 0;
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
    async rollback(baseCommit, files) {
        this.validateRef(baseCommit);
        let targetFiles;
        if (files && files.length > 0) {
            targetFiles = files;
        }
        else {
            const nameOnlyOutput = await this.execGit("diff", "--name-only", baseCommit, "HEAD");
            targetFiles = nameOnlyOutput
                .trim()
                .split("\n")
                .filter((f) => f.length > 0);
        }
        if (targetFiles.length === 0) {
            return { rolledBack: [], message: "No files to rollback." };
        }
        const rolledBack = [];
        const errors = [];
        for (const file of targetFiles) {
            try {
                await this.execGit("checkout", baseCommit, "--", file);
                rolledBack.push(file);
            }
            catch (err) {
                errors.push(`Failed to rollback ${file}: ${err instanceof Error ? err.message : String(err)}`);
            }
        }
        const parts = [];
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
    execGit(...args) {
        return new Promise((resolve, reject) => {
            execFile("git", args, { cwd: this.cwd }, (error, stdout, stderr) => {
                if (error) {
                    const cmd = `git ${args.join(" ")}`;
                    reject(new Error(`Git command failed: ${cmd}\n${stderr?.trim() ?? error.message}`));
                    return;
                }
                resolve(stdout);
            });
        });
    }
}
//# sourceMappingURL=git-manager.js.map