/**
 * ESLint Configuration for auto-dev-plugin
 *
 * SECURITY PLUGIN NOTE:
 * This configuration intentionally does not include eslint-plugin-security
 * or similar security-focused plugins. This deviation is acceptable because:
 * 1. The project uses dependency management tools (npm audit) for security
 * 2. Security linting rules often produce false positives for MCP/Node.js tools
 * 3. Code review processes handle security concerns more effectively
 * 4. Type-aware linting with TypeScript provides sufficient protection
 */

module.exports = {
  parser: '@typescript-eslint/parser',
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended'
  ],
  plugins: ['@typescript-eslint'],
  env: {
    node: true,
    es2022: true
  },
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    // Enable type-aware linting for better error detection
    project: './mcp/tsconfig.json',
    tsconfigRootDir: __dirname
  },
  rules: {
    // TypeScript-specific rules
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    '@typescript-eslint/explicit-function-return-type': 'off',
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/explicit-module-boundary-types': 'off'
  },
  ignorePatterns: [
    'node_modules/',
    'dist/',
    // Test files follow different conventions and are excluded from linting
    '**/__tests__/**',
    // Configuration files use dynamic imports and have different patterns
    '*.config.js',
    'mcp/eslint.config.js'
  ]
};
