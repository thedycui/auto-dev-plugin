# GitHub Actions CI/CD Pipeline Design

**Created**: 2026-04-06
**Status**: Approved
**Author**: Claude (with user collaboration)

## Overview

Design and implementation of a comprehensive GitHub Actions CI/CD pipeline for the auto-dev-plugin project. The pipeline provides automated quality gates, security scanning, and release automation using a modular workflow architecture.

## Project Context

- **Repository**: https://github.com/thedycui/auto-dev-plugin
- **Dual-hosted**: GitHub (primary) + Gitee (mirror)
- **Type**: TypeScript MCP Server with monorepo structure
- **Current Status**: 733/733 tests passing, production-ready codebase
- **Tech Stack**: TypeScript, Node.js, MCP SDK, Vitest

## Pipeline Architecture

### Design Principles

1. **Modular Workflows** - Separate CI and release concerns
2. **Fail-Fast** - Sequential job execution stops immediately on errors
3. **Multi-Version Testing** - Support Node.js 20.x and 22.x LTS versions
4. **Security-First** - Automated vulnerability scanning in every build
5. **Manual Release Control** - Tag-based releases with full automation

### Workflow Structure

**Two Independent Workflows**:

1. **CI Workflow** (`.github/workflows/ci.yml`)
   - Triggers: Push to `main`, Pull Requests to any branch
   - Purpose: Quality gate for all code changes
   - Required for PR merging

2. **Release Workflow** (`.github/workflows/release.yml`)
   - Triggers: Git tags matching `v*.*.*` pattern
   - Purpose: Automated release creation
   - Manual control via tag pushing

## CI Workflow Design

### Trigger Events
```yaml
on:
  push:
    branches: [ main, master ]
  pull_request:
    branches: [ main, master ]
```

### Job Pipeline

**Job 1: Build & Test (Matrix)**
- Strategy: Node.js 20.x and 22.x (parallel execution)
- Steps: Checkout → Setup Node.js → Install deps → Build → Test → Upload artifacts
- Caching: npm dependencies for faster builds
- Artifact upload: Test results for both Node.js versions

**Job 2: Code Quality**
- Dependency: build-and-test job must pass
- Steps: ESLint → Prettier check → TypeScript type check
- Fail-fast: Stops pipeline on any quality violations

**Job 3: Security**
- Dependency: code-quality job must pass
- Steps: npm audit (moderate level) → production vulnerability check
- Purpose: Catch security issues before merge

### Key Features

✅ **Sequential Execution** - Each job depends on previous success
✅ **Parallel Testing** - Node.js versions tested simultaneously
✅ **Fast Feedback** - Pipeline stops on first failure
✅ **Artifact Retention** - Test results available for debugging
✅ **Dependency Caching** - Faster builds through smart caching

## Release Workflow Design

### Trigger Events
```yaml
on:
  push:
    tags:
      - 'v*.*.*'  # Matches v1.0.0, v9.2.0, etc.
```

### Release Process

**Single Job: Create Release**
- Steps: Checkout → Setup Node.js → Install deps → Build → Test → Version extraction → Changelog generation → Artifact creation → GitHub Release

**Artifacts Included**:
- `mcp/dist/` - Compiled TypeScript MCP server
- `skills/` - Skill definition files
- Source code archive (tar.gz)

**Changelog Generation**:
- Auto-generated from git commits since last tag
- Format: "## What's Changed" + commit list
- Links to referenced issues

### Release Workflow

```bash
# Manual process:
1. Update versions in package.json files
2. Commit changes
3. Create and push tag:
   git tag v9.2.0
   git push github v9.2.0

# Automated by GitHub Actions:
- Runs full test suite
- Creates GitHub Release
- Uploads built artifacts
- Generates changelog
```

### Safety Features

✅ **Test Verification** - Release fails if tests don't pass
✅ **Build Validation** - Only releases working builds
✅ **Tag Validation** - Only accepts semantic version tags
✅ **Manual Control** - User decides when releases happen

## Development Tooling Setup

### New Dependencies

**Root Package**:
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

### Configuration Files

**ESLint** (`.eslintrc.js`):
- TypeScript-specific rules
- Security plugin integration
- Node.js environment
- Recommended TypeScript extensions

**Prettier** (`.prettierrc`):
- Single quotes, semicolons
- 2-space tabs, 80 char width
- Trailing commas (ES5)

**Pre-commit Hooks** (optional):
- Husky for git hooks
- lint-staged for incremental checks
- Auto-fix on commit

### New npm Scripts

```json
{
  "lint": "eslint mcp/src --ext .ts",
  "lint:fix": "eslint mcp/src --ext .ts --fix",
  "format": "prettier --write \"mcp/src/**/*.ts\"",
  "format:check": "prettier --check \"mcp/src/**/*.ts\"",
  "type-check": "tsc --noEmit"
}
```

## Branch Protection Strategy

### Main Branch Rules

**Required Status Checks**:
- ✅ `Build & Test (Node.js 20.x)` - Required
- ✅ `Build & Test (Node.js 22.x)` - Required
- ✅ `Code Quality Checks` - Required
- ✅ `Security Audit` - Required

**Additional Protections**:
- ✅ Require branches to be up to date before merging
- ✅ Require PR reviews (optional, 1 approval)
- ❌ Signed commits (disabled initially)
- ❌ Linear history (disabled initially)

### Repository Settings

**Features Enabled**:
- Actions (CI/CD)
- Issues (for changelog links)
- Discussions (optional, community)

**Actions Permissions**:
- Allow all actions and reusable workflows
- Allow GitHub Actions to create PRs

## GitHub Integration

### Remote Configuration

**Add GitHub Remote** (if Gitee is origin):
```bash
git remote add github https://github.com/thedycui/auto-dev-plugin.git
```

**Dual-Push Configuration**:
```bash
git remote set-url --add --push origin https://github.com/thedycui/auto-dev-plugin.git
```

### No Secrets Required

Initial implementation uses only:
- `GITHUB_TOKEN` - Automatically provided by GitHub
- No external API keys or credentials needed

**Future Additions** (optional):
- `NPM_TOKEN` - For npm registry publishing

## Implementation Plan

### Phase 1: Development Tooling (30 min)
1. Install ESLint, Prettier, TypeScript ESLint, Security plugin
2. Install Husky, lint-staged (optional)
3. Create configuration files (.eslintrc.js, .prettierrc)
4. Update package.json scripts
5. Run initial linting and fix issues

### Phase 2: Workflow Files (15 min)
1. Create `.github/workflows/` directory
2. Add `ci.yml` workflow
3. Add `release.yml` workflow
4. Verify YAML syntax

### Phase 3: GitHub Integration (15 min)
1. Add GitHub remote to local git
2. Push workflows to GitHub
3. Verify workflows appear in Actions tab

### Phase 4: Branch Protection (15 min)
1. Configure branch protection rules in GitHub
2. Set required status checks
3. Enable PR requirements

### Phase 5: Testing & Validation (30 min)
1. Create test PR or push change
2. Verify CI pipeline runs successfully
3. Test release workflow with test tag (v9.2.0-rc.1)
4. Verify GitHub Release creation
5. Clean up test release

**Total Estimated Time**: 1.5-2 hours

## Success Criteria

### Immediate Goals
✅ All 733 existing tests pass in CI pipeline
✅ ESLint, Prettier, and type checking run successfully
✅ Security audits complete without critical vulnerabilities
✅ Branch protection rules prevent merging failing code

### Release Readiness
✅ Tag pushing triggers automated release creation
✅ GitHub releases include correct artifacts and changelogs
✅ Release process validates tests before publishing

### Long-term Benefits
✅ Fast feedback on code changes (< 5 minutes for CI)
✅ Consistent code quality across all contributions
✅ Automated security vulnerability detection
✅ Streamlined release process with minimal manual work

## Future Enhancements

### Potential Additions
- Code coverage reporting (Codecov)
- Automated npm package publishing
- Dependency update automation (Dependabot)
- Performance benchmarking
- Multi-platform testing (Windows, macOS)
- Integration testing enhancements

### Scaling Considerations
- As project grows, workflows can be extended
- Modular design allows easy feature additions
- Pipeline efficiency can be optimized further

## Risk Mitigation

### Common Issues
- **Pipeline Speed**: Use caching and parallel jobs
- **False Positives**: Configure security audit thresholds
- **Release Failures**: Test with pre-release tags first
- **Merge Conflicts**: Keep branch protections reasonable

### Rollback Plan
- Workflows can be reverted via git
- Branch protections can be disabled instantly
- Failed releases can be deleted and re-created

## Conclusion

This CI/CD pipeline design provides a solid foundation for maintaining code quality, security, and release automation for the auto-dev-plugin project. The modular approach ensures the pipeline can grow with the project while remaining maintainable and efficient.

The implementation prioritizes developer productivity through fast feedback loops while maintaining high standards for code quality and security through automated gates.
