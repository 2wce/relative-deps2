# E2E Test Suite for relative-deps

This directory contains comprehensive end-to-end tests for the relative-deps CLI tool.

## Overview

The test suite validates the complete functionality of relative-deps in real-world scenarios by:

- Creating temporary file systems with mock projects and libraries
- Running the actual CLI commands
- Verifying expected outcomes and side effects
- Testing error conditions and edge cases

## Test Structure

### 📁 `setup.ts`
- Test setup utilities and fixtures
- Temporary directory management
- Mock package and library creation
- Automatic cleanup after tests

### 📁 `utils.ts`
- CLI command execution utilities
- File system assertion helpers
- Package.json manipulation utilities
- Workspace creation helpers

### 📁 `e2e/cli.test.ts`
Main CLI functionality tests:
- `relative-deps init` - Project initialization
- `relative-deps add` - Adding relative dependencies
- `relative-deps` (install) - Installing dependencies
- CLI flags: `--force`, `--clean`, `--verbose`, `--dev`
- Error handling and validation
- Change detection and caching

### 📁 `e2e/integration.test.ts`
Complex integration scenarios:
- Monorepo setups with multiple libraries
- Build script integration (TypeScript, etc.)
- Cache invalidation scenarios
- Package manager compatibility (npm, yarn, pnpm)
- Performance tests with large file sets

## Running Tests

```bash
# Run all tests
npm run test

# Run tests once (CI mode)
npm run test:run

# Run only e2e tests
npm run test:e2e

# Run with verbose output
npm run test -- --verbose

# Run specific test file
npm run test tests/e2e/cli.test.ts
```

## Test Coverage

### ✅ **CLI Commands Tested**
- `relative-deps` (default install command)
- `relative-deps init [--script <name>]`
- `relative-deps add <paths...> [--dev]`
- `relative-deps watch`

### ✅ **CLI Flags Tested**
- `--force` / `-f` - Force update ignoring cache
- `--clean` / `-c` - Clean all caches before installing
- `--verbose` / `-v` - Show detailed output
- `--dev` / `-D` - Install as dev dependency
- `--script` / `-S` - Custom script name for hooks

### ✅ **Scenarios Covered**

**Basic Functionality:**
- Initialize new projects
- Add single and multiple relative dependencies
- Install and update relative dependencies
- Detect and skip unchanged dependencies

**Cache Management:**
- Hash-based change detection
- Metadata-based quick checks
- Cache invalidation on file changes
- Cache invalidation on package.json changes
- Force updates bypassing cache
- Cache cleaning

**Build Integration:**
- Libraries with build scripts
- TypeScript compilation
- Build failure handling
- Silent vs verbose build output

**Error Handling:**
- Missing package.json files
- Invalid library paths
- Non-existent relative dependencies
- Build script failures
- Circular dependency scenarios

**Advanced Scenarios:**
- Monorepo structures
- Nested library dependencies
- Different package managers (npm, yarn, pnpm)
- Large numbers of files (performance)
- Complex directory structures

### ✅ **File System Operations Tested**
- Package.json manipulation
- node_modules installation
- Cache file creation and cleanup
- Temporary directory management
- File modification detection
- Symlink handling

## Test Environment

**Requirements:**
- Node.js 18+
- Built CLI (`npm run build` first)
- Vitest test runner

**Mock Environment:**
- Temporary directories for each test
- Mock package.json files
- Fake library structures
- Simulated package managers

**Isolation:**
- Each test runs in its own temporary directory
- Automatic cleanup prevents test interference
- No dependencies on external packages or networks

## Adding New Tests

1. **Basic CLI test** → Add to `e2e/cli.test.ts`
2. **Complex integration** → Add to `e2e/integration.test.ts`
3. **New test utilities** → Add to `utils.ts`
4. **Test fixtures** → Add to `setup.ts`

### Example Test Structure:

```typescript
it('should do something specific', async () => {
  // Setup
  await createMockPackage(ctx.tempDir, { name: 'test-project' })
  await createWorkspace(ctx.tempDir)

  // Action
  const result = await runCli(['command', '--flag'], { cwd: ctx.tempDir })

  // Assertions
  expect(result.exitCode).toBe(0)
  expect(result.stdout).toContain('expected output')

  // Verify side effects
  const pkg = await readPackageJson(ctx.tempDir)
  expect(pkg.someProperty).toBe('expected value')
})
```

## Debugging Tests

```bash
# Run single test with verbose output
npm run test -- --verbose tests/e2e/cli.test.ts -t "specific test name"

# Keep temporary directories for inspection
# (Modify cleanup in setup.ts temporarily)

# Check CLI output
console.log(result.stdout, result.stderr)
```

## CI/CD Integration

Tests are designed to run in CI environments:
- No external dependencies
- Deterministic outcomes
- Proper cleanup
- Reasonable timeouts
- Clear error messages

The test suite provides confidence that relative-deps works correctly across different scenarios and edge cases that users might encounter in real projects.