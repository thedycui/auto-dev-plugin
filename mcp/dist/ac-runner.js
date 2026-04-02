/**
 * AC Runner — Structural assertion execution engine.
 *
 * Executes Layer 1 (structural) assertions defined in acceptance-criteria.json.
 * No arbitrary shell commands — all assertions are framework-interpreted.
 */
import { readFile, stat, readdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { join, relative } from "node:path";
// ---------------------------------------------------------------------------
// Glob Helper (simple, no external deps)
// ---------------------------------------------------------------------------
/**
 * Simple glob matching: supports `*` (single segment) and `**` (any segments).
 * Converts glob pattern to regex for matching against relative paths.
 */
function globToRegex(pattern) {
    const escaped = pattern
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*\*/g, "<<<GLOBSTAR>>>")
        .replace(/\*/g, "[^/]*")
        .replace(/<<<GLOBSTAR>>>/g, ".*");
    return new RegExp(`^${escaped}$`);
}
async function findFilesByGlob(root, pattern) {
    const regex = globToRegex(pattern);
    const results = [];
    async function walk(dir) {
        let entries;
        try {
            entries = await readdir(dir, { withFileTypes: true });
        }
        catch {
            return;
        }
        for (const entry of entries) {
            const fullPath = join(dir, entry.name);
            const relPath = relative(root, fullPath);
            if (entry.isDirectory()) {
                await walk(fullPath);
            }
            else if (regex.test(relPath)) {
                results.push(fullPath);
            }
        }
    }
    await walk(root);
    return results;
}
// ---------------------------------------------------------------------------
// Exec Helper
// ---------------------------------------------------------------------------
function execWithTimeout(cmd, args, options) {
    return new Promise((resolve) => {
        execFile(cmd, args, { cwd: options.cwd, timeout: options.timeout }, (err, stdout, stderr) => {
            const exitCode = err ? err.code === undefined ? 1 : 1 : 0;
            resolve({
                exitCode: err ? 1 : 0,
                stdout: typeof stdout === "string" ? stdout : "",
                stderr: typeof stderr === "string" ? stderr : "",
            });
        });
    });
}
// ---------------------------------------------------------------------------
// Individual Assertion Executors
// ---------------------------------------------------------------------------
async function assertFileExists(assertion, codeRoot) {
    const pattern = assertion.path;
    // If no glob chars, check directly
    if (!pattern.includes("*")) {
        const fullPath = join(codeRoot, pattern);
        try {
            await stat(fullPath);
            return { type: "file_exists", passed: true, detail: `File exists: ${pattern}` };
        }
        catch {
            return { type: "file_exists", passed: false, detail: `File not found: ${pattern}` };
        }
    }
    // Glob match
    const matches = await findFilesByGlob(codeRoot, pattern);
    if (matches.length > 0) {
        return { type: "file_exists", passed: true, detail: `Glob matched ${matches.length} file(s): ${pattern}` };
    }
    return { type: "file_exists", passed: false, detail: `No files match glob: ${pattern}` };
}
async function assertFileNotExists(assertion, codeRoot) {
    const fullPath = join(codeRoot, assertion.path);
    try {
        await stat(fullPath);
        return { type: "file_not_exists", passed: false, detail: `File should not exist but found: ${assertion.path}` };
    }
    catch {
        return { type: "file_not_exists", passed: true, detail: `File correctly absent: ${assertion.path}` };
    }
}
async function assertFileContains(assertion, codeRoot) {
    const fullPath = join(codeRoot, assertion.path);
    try {
        const content = await readFile(fullPath, "utf-8");
        const regex = new RegExp(assertion.pattern);
        if (regex.test(content)) {
            return { type: "file_contains", passed: true, detail: `Pattern /${assertion.pattern}/ found in ${assertion.path}` };
        }
        return { type: "file_contains", passed: false, detail: `Pattern /${assertion.pattern}/ not found in ${assertion.path}` };
    }
    catch {
        return { type: "file_contains", passed: false, detail: `Cannot read file: ${assertion.path}` };
    }
}
async function assertFileNotContains(assertion, codeRoot) {
    const fullPath = join(codeRoot, assertion.path);
    try {
        const content = await readFile(fullPath, "utf-8");
        const regex = new RegExp(assertion.pattern);
        if (regex.test(content)) {
            return { type: "file_not_contains", passed: false, detail: `Pattern /${assertion.pattern}/ should not be in ${assertion.path} but was found` };
        }
        return { type: "file_not_contains", passed: true, detail: `Pattern /${assertion.pattern}/ correctly absent from ${assertion.path}` };
    }
    catch {
        // File not existing means pattern is not contained — pass
        return { type: "file_not_contains", passed: true, detail: `File does not exist (pattern trivially absent): ${assertion.path}` };
    }
}
async function assertConfigValue(assertion, codeRoot) {
    const fullPath = join(codeRoot, assertion.path);
    try {
        const content = await readFile(fullPath, "utf-8");
        const parsed = JSON.parse(content);
        // Traverse dot-separated key path
        const keys = assertion.key.split(".");
        let current = parsed;
        for (const key of keys) {
            if (current == null || typeof current !== "object") {
                return { type: "config_value", passed: false, detail: `Key path "${assertion.key}" not found in ${assertion.path}: intermediate key "${key}" is not an object` };
            }
            current = current[key];
        }
        const actualValue = String(current);
        if (actualValue === assertion.expectedValue) {
            return { type: "config_value", passed: true, detail: `${assertion.key} = "${assertion.expectedValue}" in ${assertion.path}` };
        }
        return { type: "config_value", passed: false, detail: `${assertion.key} = "${actualValue}" (expected "${assertion.expectedValue}") in ${assertion.path}` };
    }
    catch (err) {
        return { type: "config_value", passed: false, detail: `Cannot read/parse config file ${assertion.path}: ${err.message}` };
    }
}
async function assertBuildSucceeds(_assertion, codeRoot, buildCmd) {
    if (!buildCmd) {
        return { type: "build_succeeds", passed: false, detail: "No build command configured" };
    }
    const result = await execWithTimeout("sh", ["-c", buildCmd], { cwd: codeRoot, timeout: 300_000 });
    if (result.exitCode === 0) {
        return { type: "build_succeeds", passed: true, detail: "Build succeeded" };
    }
    return { type: "build_succeeds", passed: false, detail: `Build failed: ${result.stderr.slice(0, 300)}` };
}
async function assertTestPasses(assertion, codeRoot, testCmd) {
    if (!testCmd) {
        return { type: "test_passes", passed: false, detail: "No test command configured" };
    }
    let cmd = testCmd;
    // If specific test file/name provided, try to append to command
    if (assertion.testFile) {
        cmd = `${cmd} ${assertion.testFile}`;
    }
    const result = await execWithTimeout("sh", ["-c", cmd], { cwd: codeRoot, timeout: 300_000 });
    if (result.exitCode === 0) {
        return { type: "test_passes", passed: true, detail: `Test passed${assertion.testFile ? `: ${assertion.testFile}` : ""}` };
    }
    return { type: "test_passes", passed: false, detail: `Test failed${assertion.testFile ? `: ${assertion.testFile}` : ""}: ${result.stderr.slice(0, 300)}` };
}
// ---------------------------------------------------------------------------
// Main Entry Point
// ---------------------------------------------------------------------------
/**
 * Run all structural assertions for Layer 1 ACs.
 * Returns results keyed by AC id.
 */
export async function runStructuralAssertions(criteria, codeRoot, options) {
    const results = {};
    const structuralAcs = criteria.filter((c) => c.layer === "structural");
    for (const ac of structuralAcs) {
        const assertions = ac.structuralAssertions ?? [];
        const details = [];
        let allPassed = true;
        for (const assertion of assertions) {
            let result;
            switch (assertion.type) {
                case "file_exists":
                    result = await assertFileExists(assertion, codeRoot);
                    break;
                case "file_not_exists":
                    result = await assertFileNotExists(assertion, codeRoot);
                    break;
                case "file_contains":
                    result = await assertFileContains(assertion, codeRoot);
                    break;
                case "file_not_contains":
                    result = await assertFileNotContains(assertion, codeRoot);
                    break;
                case "config_value":
                    result = await assertConfigValue(assertion, codeRoot);
                    break;
                case "build_succeeds":
                    result = await assertBuildSucceeds(assertion, codeRoot, options?.buildCmd);
                    break;
                case "test_passes":
                    result = await assertTestPasses(assertion, codeRoot, options?.testCmd);
                    break;
                default:
                    result = { type: "unknown", passed: false, detail: `Unknown assertion type` };
            }
            details.push(result);
            if (!result.passed)
                allPassed = false;
        }
        results[ac.id] = { passed: allPassed, details };
    }
    return results;
}
//# sourceMappingURL=ac-runner.js.map