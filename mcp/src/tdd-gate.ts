/**
 * TDD Gate — RED/GREEN 验证核心模块
 *
 * 提供文件分类、测试命令生成、RED 阶段验证等功能。
 */

// ---------------------------------------------------------------------------
// Test File Detection (dual filter: test patterns + test resources)
// ---------------------------------------------------------------------------

const TEST_PATTERNS = [
  /[Tt]est\.(java|ts|js|py|kt|go|rs)$/,
  /\.test\.(ts|js|tsx|jsx)$/,
  /\.spec\.(ts|js|tsx|jsx)$/,
  /_test\.(go|py|rs)$/,
  /(?:^|\/)test_\w+\.py$/,
];

const TEST_RESOURCE_EXT = /\.(json|yml|yaml|xml|sql|txt|csv)$/;
const TEST_RESOURCE_DIR = /tests?\/|__tests__|spec\/|fixtures\//;

/**
 * 判断文件是否为测试文件（包括测试资源文件）。
 */
export function isTestFile(filePath: string): boolean {
  const isTestPattern = TEST_PATTERNS.some(p => p.test(filePath));
  const isTestResource =
    TEST_RESOURCE_EXT.test(filePath) && TEST_RESOURCE_DIR.test(filePath);
  return isTestPattern || isTestResource;
}

// ---------------------------------------------------------------------------
// Implementation File Detection
// ---------------------------------------------------------------------------

const SOURCE_EXT = /\.(java|ts|js|py|go|rs|kt)$/;

/**
 * 判断文件是否为实现源码文件（排除测试文件和非源码文件）。
 */
export function isImplFile(filePath: string): boolean {
  if (isTestFile(filePath)) return false;
  return SOURCE_EXT.test(filePath);
}

// ---------------------------------------------------------------------------
// Test Command Builder
// ---------------------------------------------------------------------------

/**
 * 根据语言和测试文件列表生成测试执行命令。
 *
 * Java: 支持多模块 Maven 项目，从路径推导模块名。
 * TypeScript/JavaScript: vitest。
 * Python: pytest。
 * 未知语言: 返回空字符串（调用方使用 full testCmd fallback）。
 */
export function buildTestCommand(
  language: string,
  testFiles: string[],
  projectRoot: string
): string {
  if (testFiles.length === 0) return '';

  switch (language) {
    case 'Java':
    case 'Java 8': {
      const entries = testFiles
        .map(f => {
          const classMatch = f.match(/([^/]+)\.java$/);
          const moduleMatch = f.match(/^([^/]+?)\/src\//);
          return {
            className: classMatch ? classMatch[1]! : null,
            module: moduleMatch ? moduleMatch[1]! : null,
          };
        })
        .filter(e => e.className);

      // 按模块分组
      const byModule = new Map<string, string[]>();
      for (const e of entries) {
        const key = e.module || '__root__';
        if (!byModule.has(key)) byModule.set(key, []);
        byModule.get(key)!.push(e.className!);
      }

      const commands = [...byModule.entries()].map(([mod, classes]) => {
        const plFlag = mod !== '__root__' ? ` -pl ${mod}` : '';
        return `mvn test -Dtest="${classes.join(',')}"${plFlag} -DfailIfNoTests=false`;
      });
      return commands.join(' && ');
    }

    case 'TypeScript/JavaScript':
    case 'TypeScript':
    case 'JavaScript': {
      const files = testFiles.join(' ');
      return `npx vitest run ${files} --reporter=verbose`;
    }

    case 'Python': {
      const files = testFiles.join(' ');
      return `pytest ${files} -v`;
    }

    default:
      return '';
  }
}

// ---------------------------------------------------------------------------
// RED Phase Validation
// ---------------------------------------------------------------------------

/**
 * 验证 RED 阶段的变更是否合法：
 * 1. changedFiles 中不能有实现文件
 * 2. changedFiles 中至少有一个 testFiles 中的文件
 */
export function validateRedPhase(
  changedFiles: string[],
  testFiles: string[]
): { valid: boolean; error?: string } {
  // 检查是否有实现文件被修改
  const implFiles = changedFiles.filter(f => isImplFile(f));
  if (implFiles.length > 0) {
    return {
      valid: false,
      error: `RED 阶段禁止修改实现文件。检测到以下实现文件被修改：${implFiles.join(', ')}`,
    };
  }

  // 检查是否至少有一个测试文件被修改
  const testFileSet = new Set(testFiles);
  const changedTestFiles = changedFiles.filter(f => testFileSet.has(f));
  if (changedTestFiles.length === 0) {
    return {
      valid: false,
      error:
        'RED 阶段要求至少修改一个测试文件，但 changedFiles 中没有找到 testFiles 中的文件。',
    };
  }

  return { valid: true };
}

// ---------------------------------------------------------------------------
// Timeouts
// ---------------------------------------------------------------------------

/** TDD 测试执行超时（毫秒） */
export const TDD_TIMEOUTS = {
  red: 60_000, // RED: 60 秒（单文件编译+运行）
  green: 120_000, // GREEN: 120 秒（全量测试）
};
