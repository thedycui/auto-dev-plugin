# Tech Stack: Node.js / npm

## Variables
- language: TypeScript/JavaScript
- build_cmd: npm run build
- test_cmd: npm test
- test_single_cmd: npx jest {test_file} --no-coverage
- lang_checklist: code-review-typescript.md
- test_dir: __tests__/ or src/**/*.test.ts
- source_dir: src/

## Build Notes
- Check `engines` in package.json for Node.js version requirements
- Use `nvm use` if .nvmrc exists
- TypeScript: `npx tsc --noEmit` for type checking without build

## Test Notes
- Check for Jest, Mocha, or Vitest configuration
- Look at `scripts.test` in package.json for the actual test command
- For Vue projects, check for @vue/test-utils
