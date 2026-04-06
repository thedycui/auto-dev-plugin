/**
 * AC Test Binding — discovers AC-tagged tests and runs them.
 *
 * Layer 2 (test-bound) AC verification:
 * 1. discoverAcBindings() — scans test files for [AC-N] annotations
 * 2. validateAcBindingCoverage() — checks all test-bound ACs have bindings
 * 3. runAcBoundTests() — executes bound tests and collects results
 */
import { readFile, readdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { join, relative } from 'node:path';
// ---------------------------------------------------------------------------
// Regex Patterns per Language
// ---------------------------------------------------------------------------
const AC_PATTERNS = {
    java: [
        /@DisplayName\s*\(\s*"\[AC-(\d+)\]([^"]*)"/, // @DisplayName("[AC-1] desc")
        /void\s+AC(\d+)_(\w+)/, // void AC1_methodName
    ],
    node: [
        /(?:test|it)\s*\(\s*["'`]\[AC-(\d+)\]\s*([^"'`]*)["'`]/, // test("[AC-1] desc", ...)
        /describe\s*\(\s*["'`]AC-(\d+):\s*([^"'`]*)["'`]/, // describe("AC-1: desc", ...)
    ],
    python: [
        /def\s+(test_ac(\d+)_\w+)/, // def test_ac1_description():
        /@pytest\.mark\.ac\s*\(\s*["']AC-(\d+)["']\)/, // @pytest.mark.ac("AC-1")
    ],
};
const TEST_FILE_PATTERNS = {
    java: /Test\.java$/,
    node: /\.(test|spec)\.(ts|js|tsx|jsx)$/,
    python: /test_.*\.py$|_test\.py$/,
};
const TEST_DIRS = {
    java: ['src/test'],
    node: ['__tests__', 'src/__tests__', 'test', 'tests'],
    python: ['tests', 'test'],
};
// ---------------------------------------------------------------------------
// Language Normalization
// ---------------------------------------------------------------------------
function normalizeLanguage(language) {
    const lower = language.toLowerCase();
    if (lower.includes('typescript') ||
        lower.includes('javascript') ||
        lower === 'ts' ||
        lower === 'js' ||
        lower === 'node') {
        return 'node';
    }
    if (lower.includes('java') && !lower.includes('script'))
        return 'java';
    if (lower.includes('python') || lower === 'py')
        return 'python';
    return language;
}
// ---------------------------------------------------------------------------
// File Discovery
// ---------------------------------------------------------------------------
async function findTestFiles(root, language) {
    const normalized = normalizeLanguage(language);
    const pattern = TEST_FILE_PATTERNS[normalized];
    if (!pattern)
        return [];
    const dirs = TEST_DIRS[normalized] ?? [];
    const results = [];
    const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.git']);
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
            if (entry.isDirectory() &&
                !entry.name.startsWith('.') &&
                !SKIP_DIRS.has(entry.name)) {
                await walk(fullPath);
            }
            else if (entry.isFile() && pattern.test(entry.name)) {
                results.push(fullPath);
            }
        }
    }
    // Search in known test directories first
    for (const dir of dirs) {
        await walk(join(root, dir));
    }
    // If no results, search the whole project (but skip node_modules, dist, etc.)
    if (results.length === 0) {
        await walk(root);
    }
    return results;
}
// ---------------------------------------------------------------------------
// Binding Discovery
// ---------------------------------------------------------------------------
/**
 * Scan test files for AC-N annotations.
 * Returns discovered bindings.
 */
export async function discoverAcBindings(projectRoot, language) {
    const bindings = [];
    const normalized = normalizeLanguage(language);
    const patterns = AC_PATTERNS[normalized];
    if (!patterns)
        return bindings;
    const testFiles = await findTestFiles(projectRoot, language);
    for (const filePath of testFiles) {
        let content;
        try {
            content = await readFile(filePath, 'utf-8');
        }
        catch {
            continue;
        }
        const relPath = relative(projectRoot, filePath);
        const lines = content.split('\n');
        for (const line of lines) {
            for (const pattern of patterns) {
                const match = pattern.exec(line);
                if (match) {
                    let acNum;
                    let testName;
                    if (language === 'java') {
                        if (match[0].includes('@DisplayName')) {
                            acNum = match[1];
                            testName = match[2]?.trim() || `AC-${acNum}`;
                        }
                        else {
                            acNum = match[1];
                            testName = `AC${acNum}_${match[2] ?? ''}`;
                        }
                    }
                    else if (language === 'python') {
                        if (match[0].includes('def ')) {
                            acNum = match[2];
                            testName = match[1];
                        }
                        else {
                            acNum = match[1];
                            testName = `ac_${acNum}`;
                        }
                    }
                    else {
                        // node
                        acNum = match[1];
                        testName = match[2]?.trim() || `AC-${acNum}`;
                    }
                    bindings.push({
                        acId: `AC-${acNum}`,
                        testFile: relPath,
                        testName,
                        language,
                    });
                }
            }
        }
    }
    return bindings;
}
// ---------------------------------------------------------------------------
// Binding Coverage Validation
// ---------------------------------------------------------------------------
/**
 * Check that all test-bound ACs have corresponding test bindings.
 */
export function validateAcBindingCoverage(criteria, bindings) {
    const testBoundAcs = criteria
        .filter(c => c.layer === 'test-bound')
        .map(c => c.id);
    const boundAcIds = new Set(bindings.map(b => b.acId));
    const covered = testBoundAcs.filter(id => boundAcIds.has(id));
    const missing = testBoundAcs.filter(id => !boundAcIds.has(id));
    const allAcIds = new Set(criteria.map(c => c.id));
    const extraBindings = [...boundAcIds].filter(id => !allAcIds.has(id));
    return { covered, missing, extraBindings };
}
// ---------------------------------------------------------------------------
// Test Command Building
// ---------------------------------------------------------------------------
function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
/**
 * Build a targeted test command for a specific AC binding.
 */
export function buildTargetedTestCommand(language, testFile, bindings, projectRoot) {
    switch (normalizeLanguage(language)) {
        case 'java': {
            const className = testFile.replace(/.*\//, '').replace('.java', '');
            const methods = bindings.map(b => b.testName).join('+');
            return `cd ${projectRoot} && mvn test -Dtest=${className}#${methods} -pl . -q`;
        }
        case 'node': {
            const namePattern = bindings.map(b => escapeRegex(b.testName)).join('|');
            return `cd ${projectRoot} && npx vitest run ${testFile} -t "${namePattern}"`;
        }
        case 'python': {
            const kPattern = bindings.map(b => b.testName).join(' or ');
            return `cd ${projectRoot} && python -m pytest ${testFile} -k "${kPattern}" -v`;
        }
        default:
            return `cd ${projectRoot} && ${testFile}`;
    }
}
// ---------------------------------------------------------------------------
// Exec Helper
// ---------------------------------------------------------------------------
function execWithTimeout(cmd, options) {
    return new Promise(resolve => {
        execFile('sh', ['-c', cmd], { cwd: options.cwd, timeout: options.timeout }, (err, stdout, stderr) => {
            resolve({
                exitCode: err ? 1 : 0,
                stdout: typeof stdout === 'string' ? stdout : '',
                stderr: typeof stderr === 'string' ? stderr : '',
            });
        });
    });
}
// ---------------------------------------------------------------------------
// Test Execution
// ---------------------------------------------------------------------------
/**
 * Group bindings by AC id for per-AC test execution.
 */
function groupBy(items, keyFn) {
    const map = new Map();
    for (const item of items) {
        const key = keyFn(item);
        const group = map.get(key);
        if (group) {
            group.push(item);
        }
        else {
            map.set(key, [item]);
        }
    }
    return map;
}
/**
 * Run tests for each AC binding independently.
 * Returns results keyed by AC id.
 */
export async function runAcBoundTests(bindings, projectRoot, language, testCmd) {
    const results = new Map();
    // Group bindings by AC id
    const grouped = groupBy(bindings, b => b.acId);
    for (const [acId, acBindings] of grouped) {
        // Use the first binding's test file (typically one file per AC)
        const testFile = acBindings[0].testFile;
        const cmd = buildTargetedTestCommand(language, testFile, acBindings, projectRoot);
        const { exitCode, stdout, stderr } = await execWithTimeout(cmd, {
            cwd: projectRoot,
            timeout: 120_000,
        });
        const combined = stdout + stderr;
        let passed = exitCode === 0;
        // Detect all-skipped: vitest exits 0 when all tests are skipped,
        // but no tests actually ran. Treat this as FAIL.
        if (passed) {
            const hasPassedTests = /\d+\s+passed/.test(combined);
            const hasSkippedTests = /\d+\s+skipped/.test(combined);
            if (hasSkippedTests && !hasPassedTests) {
                passed = false;
            }
        }
        results.set(acId, {
            passed,
            output: combined.slice(0, 500),
        });
    }
    return results;
}
//# sourceMappingURL=ac-test-binding.js.map