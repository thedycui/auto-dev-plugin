# GitHub Actions CI/CD Pipeline Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement comprehensive GitHub Actions CI/CD pipeline for auto-dev-plugin with automated testing, code quality checks, security scanning, and release automation.

**Architecture:** Modular workflow design with separate CI and release workflows. CI workflow runs sequential jobs (build → test → code quality → security) on Node.js 20.x and 22.x matrix. Release workflow triggers on semantic version tags to create GitHub releases with artifacts.

**Tech Stack:** GitHub Actions, ESLint, Prettier, TypeScript, Vitest, npm audit, semantic versioning

---

## Task 1: Add Development Tooling Dependencies

**Files:**
- Modify: `package.json` (root)
- Modify: `mcp/package.json`

**Step 1: Update root package.json with dev dependencies**

Open `package.json` in the root directory, add to `devDependencies`:

```json
{
  "devDependencies": {
    "@typescript-eslint/eslint-plugin": "^7.0.0",
    "@typescript-eslint/parser": "^7.0.0",
    "eslint": "^8.57.0",
    "eslint-plugin-security": "^3.0.0",
    "prettier": "^3.2.5",
    "husky": "^9.0.0",
    "lint-staged": "^15.2.0"
  }
}
```

**Step 2: Add linting and formatting scripts to root package.json**

Add to `scripts` section in root `package.json`:

```json
{
  "scripts": {
    "build": "cd mcp && npm run build",
    "test": "cd mcp && npm test",
    "lint": "eslint mcp/src --ext .ts",
    "lint:fix": "eslint mcp/src --ext .ts --fix",
    "format": "prettier --write \"mcp/src/**/*.ts\"",
    "format:check": "prettier --check \"mcp/src/**/*.ts\"",
    "type-check": "cd mcp && tsc --noEmit",
    "prepare": "husky install"
  }
}
```

**Step 3: Install dependencies**

Run: `npm install`
Expected: All dependencies installed successfully

**Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "feat: add development tooling dependencies

- Add ESLint, TypeScript ESLint, Security plugin
- Add Prettier for code formatting
- Add Husky and lint-staged for pre-commit hooks
- Add npm scripts for lint, format, and type-check

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 2: Create ESLint Configuration

**Files:**
- Create: `.eslintrc.js`

**Step 1: Create ESLint configuration file**

Create `.eslintrc.js` in root directory:

```javascript
module.exports = {
  parser: '@typescript-eslint/parser',
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:security/recommended'
  ],
  plugins: ['@typescript-eslint', 'security'],
  env: {
    node: true,
    es2022: true
  },
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    project: './mcp/tsconfig.json'
  },
  rules: {
    // TypeScript-specific rules
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    '@typescript-eslint/explicit-function-return-type': 'off',
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/explicit-module-boundary-types': 'off',
    // Security rules
    'security/detect-eval-with-expression': 'error',
    'security/detect-non-literal-fs-filename': 'warn',
    'security/detect-non-literal-regexp': 'warn'
  },
  ignorePatterns: [
    'node_modules/',
    'dist/',
    'coverage/',
    '*.config.js'
  ]
};
```

**Step 2: Commit**

```bash
git add .eslintrc.js
git commit -m "feat: add ESLint configuration

- TypeScript ESLint configuration with recommended rules
- Security plugin for vulnerability detection
- Node.js environment and ES2022 support
- Ignore patterns for node_modules, dist, coverage

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 3: Create Prettier Configuration

**Files:**
- Create: `.prettierrc`
- Create: `.prettierignore`

**Step 1: Create Prettier configuration**

Create `.prettierc` in root directory:

```json
{
  "semi": true,
  "trailingComma": "es5",
  "singleQuote": true,
  "printWidth": 80,
  "tabWidth": 2,
  "useTabs": false,
  "arrowParens": "avoid",
  "endOfLine": "lf"
}
```

**Step 2: Create Prettier ignore file**

Create `.prettierignore` in root directory:

```
node_modules/
dist/
coverage/
.mcp/
*.log
package-lock.json
```

**Step 3: Commit**

```bash
git add .prettierrc .prettierignore
git commit -m "feat: add Prettier configuration

- Standard code formatting rules
- Single quotes, semicolons, 2-space indentation
- Ignore patterns for build artifacts and dependencies

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 4: Setup Pre-commit Hooks

**Files:**
- Create: `.lintstagedrc.json`
- Create: `.husky/pre-commit`

**Step 1: Create lint-staged configuration**

Create `.lintstagedrc.json` in root directory:

```json
{
  "mcp/src/**/*.ts": [
    "eslint --fix",
    "prettier --write"
  ]
}
```

**Step 2: Initialize Husky**

Run: `npx husky install`
Expected: `.husky/` directory created with git hooks configured

**Step 3: Create pre-commit hook**

Run: `npx husky add .husky/pre-commit "npx lint-staged"`
Expected: `.husky/pre-commit` file created

**Step 4: Verify pre-commit hook**

Check: `cat .husky/pre-commit`
Expected: Contains `npx lint-staged` command

**Step 5: Commit**

```bash
git add .lintstagedrc.json .husky/
git commit -m "feat: add pre-commit hooks with Husky

- Configure lint-staged for incremental checks
- Auto-fix ESLint and Prettier issues on commit
- Run checks only on staged files for performance

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 5: Run Initial Code Formatting

**Files:**
- All `.ts` files in `mcp/src/`

**Step 1: Check formatting issues**

Run: `npm run format:check`
Expected: Show files that need formatting

**Step 2: Auto-format all files**

Run: `npm run format`
Expected: All TypeScript files formatted

**Step 3: Check for ESLint issues**

Run: `npm run lint`
Expected: Show linting issues (may have warnings/errors)

**Step 4: Auto-fix ESLint issues**

Run: `npm run lint:fix`
Expected: Auto-fixable issues resolved

**Step 5: Commit formatting changes**

```bash
git add -A
git commit -m "style: apply Prettier and ESLint fixes

- Auto-format all TypeScript files with Prettier
- Apply ESLint auto-fixes
- Ensure consistent code style across codebase

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 6: Create GitHub Actions CI Workflow

**Files:**
- Create: `.github/workflows/ci.yml`

**Step 1: Create workflows directory**

Run: `mkdir -p .github/workflows`
Expected: Directory created

**Step 2: Create CI workflow file**

Create `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: [ main, master ]
  pull_request:
    branches: [ main, master ]

jobs:
  build-and-test:
    name: Build & Test (Node.js ${{ matrix.node-version }})
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node-version: [20.x, 22.x]
      fail-fast: false

    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup Node.js ${{ matrix.node-version }}
        uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node-version }}
          cache: 'npm'
          cache-dependency-path: '**/package-lock.json'

      - name: Install root dependencies
        run: npm ci

      - name: Install MCP dependencies
        run: cd mcp && npm ci

      - name: TypeScript build
        run: npm run build

      - name: Run tests
        run: npm test
        working-directory: ./mcp

      - name: Upload test results
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: test-results-node-${{ matrix.node-version }}
          path: mcp/coverage/
          retention-days: 7

  code-quality:
    name: Code Quality Checks
    needs: build-and-test
    runs-on: ubuntu-latest

    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 22.x
          cache: 'npm'
          cache-dependency-path: '**/package-lock.json'

      - name: Install dependencies
        run: |
          npm ci
          cd mcp && npm ci

      - name: ESLint check
        run: npm run lint

      - name: Prettier check
        run: npm run format:check

      - name: TypeScript type check
        run: npm run type-check
        working-directory: ./

  security:
    name: Security Audit
    needs: code-quality
    runs-on: ubuntu-latest

    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 22.x
          cache: 'npm'
          cache-dependency-path: '**/package-lock.json'

      - name: Install dependencies
        run: |
          npm ci
          cd mcp && npm ci

      - name: Run npm audit
        run: npm audit --audit-level=moderate
        working-directory: ./mcp
        continue-on-error: true

      - name: Check for production vulnerabilities
        run: npm audit --production
        working-directory: ./mcp
```

**Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "feat: add GitHub Actions CI workflow

- Multi-version testing on Node.js 20.x and 22.x
- Sequential pipeline: build → test → code quality → security
- ESLint, Prettier, TypeScript type checking
- npm audit for vulnerability scanning
- Test artifact uploads for debugging

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 7: Create GitHub Actions Release Workflow

**Files:**
- Create: `.github/workflows/release.yml`

**Step 1: Create release workflow file**

Create `.github/workflows/release.yml`:

```yaml
name: Release

on:
  push:
    tags:
      - 'v*.*.*'

jobs:
  create-release:
    name: Create GitHub Release
    runs-on: ubuntu-latest

    steps:
      - name: Checkout code
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 22.x
          cache: 'npm'
          cache-dependency-path: '**/package-lock.json'

      - name: Install dependencies
        run: |
          npm ci
          cd mcp && npm ci

      - name: Build project
        run: npm run build

      - name: Run tests
        run: npm test
        working-directory: ./mcp

      - name: Extract version from tag
        id: get_version
        run: echo "VERSION=${GITHUB_REF#refs/tags/v}" >> $GITHUB_OUTPUT

      - name: Generate changelog
        id: changelog
        run: |
          PREV_TAG=$(git describe --tags --abbrev=0 HEAD^ 2>/dev/null || echo "")
          if [ -z "$PREV_TAG" ]; then
            echo "CHANGELOG=## 🎉 Initial Release" >> $GITHUB_OUTPUT
          else
            echo "CHANGELOG<<EOF" >> $GITHUB_OUTPUT
            echo "## What's Changed" >> $GITHUB_OUTPUT
            echo "" >> $GITHUB_OUTPUT
            git log ${PREV_TAG}..HEAD --pretty=format:"- %s (%h)" >> $GITHUB_OUTPUT
            echo "EOF" >> $GITHUB_OUTPUT
          fi

      - name: Create release artifacts
        run: |
          mkdir -p artifacts
          cp -r mcp/dist artifacts/auto-dev-mcp-server
          cp -r skills artifacts/skills
          cp package.json artifacts/
          cp mcp/package.json artifacts/auto-dev-mcp-server/
          cd artifacts
          tar -czf ../auto-dev-plugin-${{ steps.get_version.outputs.VERSION }}.tar.gz *
          cd ..

      - name: Create GitHub Release
        uses: softprops/action-gh-release@v1
        with:
          tag_name: ${{ github.ref_name }}
          name: Release ${{ steps.get_version.outputs.VERSION }}
          body: ${{ steps.changelog.outputs.CHANGELOG }}
          files: auto-dev-plugin-${{ steps.get_version.outputs.VERSION }}.tar.gz
          draft: false
          prerelease: false
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

**Step 2: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "feat: add GitHub Actions release workflow

- Automated release creation on semantic version tags
- Full test suite execution before release
- Auto-generated changelog from git commits
- Artifact packaging and GitHub Release publishing
- Support for v*.*.* tag pattern

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 8: Add GitHub Remote and Push Workflows

**Files:**
- Git configuration

**Step 1: Add GitHub remote**

Check current remotes: `git remote -v`

If GitHub remote doesn't exist:
```bash
git remote add github https://github.com/thedycui/auto-dev-plugin.git
```

**Step 2: Verify remote added**

Run: `git remote -v`
Expected: Should show `github` remote

**Step 3: Push workflows to GitHub**

```bash
git push github main
```

**Step 4: Verify workflows in GitHub**

Expected: Navigate to https://github.com/thedycui/auto-dev-plugin/actions and see two workflows:
- CI
- Release

**Step 5: Create initial commit to trigger CI**

Make a small change to trigger CI (if needed):
```bash
echo "# CI/CD Pipeline" >> README.md
git add README.md
git commit -m "docs: update README with CI/CD info"
git push github main
```

---

## Task 9: Configure Branch Protection Rules

**Files:**
- GitHub repository settings (no local files)

**Step 1: Navigate to branch protection settings**

Go to: https://github.com/thedycui/auto-dev-plugin/settings/branches

**Step 2: Add branch protection rule for `main`**

Click "Add rule" and configure:

**Branch name pattern**: `main`

✅ **Require status checks to pass before merging**
  - `Build & Test (Node.js 20.x)` - Required
  - `Build & Test (Node.js 22.x)` - Required
  - `Code Quality Checks` - Required
  - `Security Audit` - Required

✅ **Require branches to be up to date before merging**

❌ **Do not require**
  - Signed commits
  - Linear history (for now)

**Step 3: Save branch protection rule**

Click "Create" or "Save changes"

**Step 4: Verify branch protection**

Create a test branch to verify protection:
```bash
git checkout -b/test-branch
echo "test" > test.txt
git add test.txt
git commit -m "test commit"
git push github test-branch
```

Expected: GitHub should show that PR requires status checks

**Step 5: Cleanup test branch**

```bash
git checkout main
git branch -D test-branch
git push github --delete test-branch
```

---

## Task 10: Test CI Pipeline with Pull Request

**Files:**
- Test file or documentation change

**Step 1: Create feature branch**

```bash
git checkout -b/test-ci-pipeline
```

**Step 2: Make a small change**

Create or modify a file:
```bash
echo "## CI/CD Pipeline Status

[![CI](https://github.com/thedycui/auto-dev-plugin/actions/workflows/ci.yml/badge.svg)](https://github.com/thedycui/auto-dev-plugin/actions/workflows/ci.yml)" >> README.md
```

**Step 3: Commit and push changes**

```bash
git add README.md
git commit -m "test: add CI badge to README"
git push github test-ci-pipeline
```

**Step 4: Create pull request on GitHub**

Go to: https://github.com/thedycui/auto-dev-plugin

Expected: GitHub should prompt to create PR

**Step 5: Verify CI pipeline runs**

Check: https://github.com/thedycui/auto-dev-plugin/actions

Expected:
- Build & Test jobs run for Node.js 20.x and 22.x
- Code Quality checks run after tests pass
- Security audit runs after quality checks pass

**Step 6: Verify all status checks pass**

Check PR page: Should show green checkmarks for all jobs

**Step 7: Merge pull request**

Click "Merge pull request" in GitHub

**Step 8: Delete test branch**

```bash
git checkout main
git pull github main
git branch -D test-ci-pipeline
```

---

## Task 11: Test Release Workflow

**Files:**
- Git tag

**Step 1: Create test release tag**

```bash
git tag v9.2.0-rc.1
```

**Step 2: Push tag to GitHub**

```bash
git push github v9.2.0-rc.1
```

**Step 3: Verify release workflow runs**

Check: https://github.com/thedycui/auto-dev-plugin/actions

Expected: Release workflow should run successfully

**Step 4: Verify GitHub release created**

Check: https://github.com/thedycui/auto-dev-plugin/releases

Expected:
- Release v9.2.0-rc.1 created
- Contains auto-generated changelog
- Includes artifact: `auto-dev-plugin-9.2.0-rc.1.tar.gz`

**Step 5: Download and verify artifact**

Download the artifact from GitHub release page and verify contents

**Step 6: Delete test release**

Delete the release from GitHub releases page

**Step 7: Delete test tag**

```bash
git tag -d v9.2.0-rc.1
git push github :refs/tags/v9.2.0-rc.1
```

---

## Task 12: Final Documentation and README Update

**Files:**
- Modify: `README.md`
- Create: `.github/ISSUE_TEMPLATE/bug-report.md`
- Create: `.github/PULL_REQUEST_TEMPLATE.md`

**Step 1: Update README with CI/CD information**

Add to `README.md`:

```markdown
## CI/CD Pipeline

This project uses GitHub Actions for continuous integration and automated releases.

### Status Badges

[![CI](https://github.com/thedycui/auto-dev-plugin/actions/workflows/ci.yml/badge.svg)](https://github.com/thedycui/auto-dev-plugin/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/thedycui/auto-dev-plugin)](https://github.com/thedycui/auto-dev-plugin/releases)

### Pipeline Features

- ✅ Automated testing on Node.js 20.x and 22.x
- ✅ ESLint and Prettier code quality checks
- ✅ TypeScript type checking
- ✅ Security vulnerability scanning
- ✅ Automated releases via git tags

### Development Workflow

1. Create feature branch from `main`
2. Make changes and commit
3. Push to GitHub and create pull request
4. CI pipeline runs automatically
5. Merge after all checks pass

### Creating Releases

To create a new release:

```bash
# Update version numbers
git add .
git commit -m "chore: bump version to X.Y.Z"

# Create and push tag
git tag vX.Y.Z
git push github vX.Y.Z
```

GitHub Actions will automatically:
- Run full test suite
- Build release artifacts
- Create GitHub Release
- Generate changelog from commits

### Local Development

Install dependencies:
```bash
npm install
```

Run tests:
```bash
npm test
```

Run linting:
```bash
npm run lint
```

Format code:
```bash
npm run format
```
```

**Step 2: Create PR template**

Create `.github/PULL_REQUEST_TEMPLATE.md`:

```markdown
## Description
<!-- Brief description of changes -->

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation update

## Testing
- [ ] All tests pass locally (`npm test`)
- [ ] ESLint passes (`npm run lint`)
- [ ] Type checking passes (`npm run type-check`)

## Checklist
- [ ] Code follows project style guidelines
- [ ] Self-review completed
- [ ] Comments added to complex code
- [ ] Documentation updated
- [ ] No new warnings generated
- [ ] Tests added for new functionality
- [ ] All tests passing

## CI Status
<!-- Wait for CI to complete and check results -->
```

**Step 3: Create bug report template**

Create `.github/ISSUE_TEMPLATE/bug-report.md`:

```markdown
---
name: Bug report
about: Report a problem with the auto-dev-plugin
title: '[BUG] '
labels: bug
assignees: ''
---

## Bug Description
<!-- Clear and concise description of the bug -->

## Steps to Reproduce
1. Go to '...'
2. Click on '....'
3. Scroll down to '....'
4. See error

## Expected Behavior
<!-- What you expected to happen -->

## Actual Behavior
<!-- What actually happened -->

## Environment
- Node.js version:
- OS:
- auto-dev-plugin version:

## Logs/Screenshots
<!-- Add logs, screenshots, or error messages -->

## Additional Context
<!-- Any other context about the problem -->
```

**Step 4: Commit documentation updates**

```bash
git add README.md .github/PULL_REQUEST_TEMPLATE.md .github/ISSUE_TEMPLATE/
git commit -m "docs: add CI/CD documentation and templates

- Update README with pipeline features and badges
- Add PR template with checklist
- Add bug report template for issues
- Document development workflow and release process

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

**Step 5: Push final changes**

```bash
git push github main
```

---

## Success Criteria Verification

### Phase 1: Development Tooling ✅
- [ ] All dependencies installed successfully
- [ ] ESLint runs without errors
- [ ] Prettier formats all files
- [ ] Pre-commit hooks work on commit

### Phase 2: CI Pipeline ✅
- [ ] CI workflow runs on push to main
- [ ] CI workflow runs on pull requests
- [ ] All 733 tests pass in CI
- [ ] ESLint and Prettier checks pass
- [ ] Security audit completes
- [ ] Status checks appear in PRs

### Phase 3: Release Automation ✅
- [ ] Release workflow triggers on tag push
- [ ] GitHub releases are created automatically
- [ ] Release artifacts are packaged correctly
- [ ] Changelog generation works

### Phase 4: Branch Protection ✅
- [ ] PRs require status checks to pass
- [ ] Cannot merge failing checks to main
- [ ] Branches must be up to date before merge

### Phase 5: Documentation ✅
- [ ] README updated with CI/CD info
- [ ] PR and issue templates created
- [ ] Development workflow documented

## Rollback Procedures

If any step fails:

1. **Dependency issues**: Revert to previous `package.json`
2. **Workflow failures**: Check YAML syntax in workflow files
3. **CI pipeline fails**: Check Actions logs, fix specific failing step
4. **Release workflow fails**: Delete failed release, fix issue, retry with new tag
5. **Branch protection issues**: Temporarily disable protection in GitHub settings

## Next Steps After Implementation

1. **Monitor first few CI runs** for any issues
2. **Adjust security audit thresholds** if needed
3. **Add code coverage reporting** (optional)
4. **Set up Dependabot** for dependency updates
5. **Configure npm publishing** (if needed)

---

## Implementation Timeline

- **Tasks 1-4**: Development tooling setup (30 min)
- **Task 5**: Code formatting (15 min)
- **Tasks 6-7**: Workflow creation (20 min)
- **Task 8**: GitHub integration (10 min)
- **Task 9**: Branch protection (15 min)
- **Task 10**: CI pipeline testing (20 min)
- **Task 11**: Release testing (15 min)
- **Task 12**: Documentation (20 min)

**Total Estimated Time**: 2-3 hours

---

**Plan complete and saved to `docs/plans/2026-04-06-cicd-implementation.md`.**
