import { describe, it, expect, beforeEach } from 'vitest'
import * as path from 'path'
import {
  createTempDir,
  createMockPackage,
  createMockLibrary,
  TestContext
} from '../setup.js'
import {
  runCli,
  readPackageJson,
  fileExists,
  dirExists,
  createWorkspace,
  createRelativeDepsConfig,
  touchFile,
  waitFor
} from '../utils.js'

describe('CLI E2E Tests', () => {
  let ctx: TestContext

  beforeEach(async () => {
    ctx = await createTempDir()
  })

  describe('relative-deps init', () => {
    it.only('should initialize relative-deps in a project', async () => {
      // Create a basic project
      await createMockPackage(ctx.tempDir, { name: 'test-project' })
      await createWorkspace(ctx.tempDir)

      // Run init command
      const result = await runCli(['init'], { cwd: ctx.tempDir })

      console.log(result)
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('Setting up relativeDependencies section')

      // Check package.json was updated
      const pkg = await readPackageJson(ctx.tempDir)
      expect(pkg.relativeDependencies).toEqual({})
      expect(pkg.scripts.prepare).toContain('relative-deps')
    })

    it('should initialize with custom script', async () => {
      await createMockPackage(ctx.tempDir, { name: 'test-project' })
      await createWorkspace(ctx.tempDir)

      const result = await runCli(['init', '--script', 'build'], { cwd: ctx.tempDir })

      expect(result.exitCode).toBe(0)

      const pkg = await readPackageJson(ctx.tempDir)
      expect(pkg.scripts.build).toContain('relative-deps')
    })
  })

  describe.skip('relative-deps add', () => {
    it('should add a relative dependency', async () => {
      // Create main project
      await createMockPackage(ctx.tempDir, { name: 'main-project' })
      await createWorkspace(ctx.tempDir)

      // Create a library to add
      const libPath = await createMockLibrary(ctx.tempDir, 'my-lib', {
        hasSourceFiles: true,
        hasBuildScript: false
      })

      // Run add command
      const relativePath = path.relative(ctx.tempDir, libPath)
      const result = await runCli(['add', relativePath], { cwd: ctx.tempDir })

      expect(result.exitCode).toBe(0)

      // Check package.json was updated
      const pkg = await readPackageJson(ctx.tempDir)
      expect(pkg.relativeDependencies).toHaveProperty('my-lib', relativePath)
      expect(pkg.scripts.prepare).toContain('relative-deps')
    })

    it('should add multiple relative dependencies', async () => {
      await createMockPackage(ctx.tempDir, { name: 'main-project' })
      await createWorkspace(ctx.tempDir)

      // Create multiple libraries
      const lib1Path = await createMockLibrary(ctx.tempDir, 'lib-one')
      const lib2Path = await createMockLibrary(ctx.tempDir, 'lib-two')

      const relPath1 = path.relative(ctx.tempDir, lib1Path)
      const relPath2 = path.relative(ctx.tempDir, lib2Path)

      const result = await runCli(['add', relPath1, relPath2], { cwd: ctx.tempDir })

      expect(result.exitCode).toBe(0)

      const pkg = await readPackageJson(ctx.tempDir)
      expect(pkg.relativeDependencies).toHaveProperty('lib-one', relPath1)
      expect(pkg.relativeDependencies).toHaveProperty('lib-two', relPath2)
    })

    it('should add as dev dependency with --dev flag', async () => {
      await createMockPackage(ctx.tempDir, { name: 'main-project' })
      await createWorkspace(ctx.tempDir)

      const libPath = await createMockLibrary(ctx.tempDir, 'dev-lib')
      const relativePath = path.relative(ctx.tempDir, libPath)

      const result = await runCli(['add', '--dev', relativePath], { cwd: ctx.tempDir })

      expect(result.exitCode).toBe(0)

      const pkg = await readPackageJson(ctx.tempDir)
      expect(pkg.relativeDependencies).toHaveProperty('dev-lib', relativePath)
    })

    it('should handle invalid library path', async () => {
      await createMockPackage(ctx.tempDir, { name: 'main-project' })
      await createWorkspace(ctx.tempDir)

      const result = await runCli(['add', './nonexistent'], { cwd: ctx.tempDir })

      expect(result.exitCode).toBe(0) // Should not crash but handle gracefully
      expect(result.stderr).toContain('Failed to resolve dependency')
    })
  })

  describe.skip('relative-deps install', () => {
    it('should install relative dependencies', async () => {
      // Create main project
      await createMockPackage(ctx.tempDir, {
        name: 'main-project',
        dependencies: { 'my-lib': '1.0.0' }
      })
      await createWorkspace(ctx.tempDir)

      // Create library
      const libPath = await createMockLibrary(ctx.tempDir, 'my-lib', {
        hasSourceFiles: true,
        hasBuildScript: true
      })

      // Set up relative dependency
      const relativePath = path.relative(ctx.tempDir, libPath)
      await createRelativeDepsConfig(ctx.tempDir, { 'my-lib': relativePath })

      // Run install
      const result = await runCli([], { cwd: ctx.tempDir })

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain("Checking 'my-lib'")

      // Check that library was processed
      expect(await dirExists(path.join(ctx.tempDir, 'node_modules', 'my-lib'))).toBe(true)

      // Check cache files were created
      expect(await fileExists(path.join(ctx.tempDir, '.relative-deps-cache', 'my-lib.hash'))).toBe(true)
      expect(await fileExists(path.join(ctx.tempDir, '.relative-deps-cache', 'my-lib.metadata.json'))).toBe(true)
    })

    it('should skip installation when no changes detected', async () => {
      await createMockPackage(ctx.tempDir, {
        name: 'main-project',
        dependencies: { 'my-lib': '1.0.0' }
      })
      await createWorkspace(ctx.tempDir)

      const libPath = await createMockLibrary(ctx.tempDir, 'my-lib')
      const relativePath = path.relative(ctx.tempDir, libPath)
      await createRelativeDepsConfig(ctx.tempDir, { 'my-lib': relativePath })

      // First run
      await runCli([], { cwd: ctx.tempDir })

      // Second run should detect no changes
      const result = await runCli(['--verbose'], { cwd: ctx.tempDir })

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('No changes detected')
    })

    it('should force update with --force flag', async () => {
      await createMockPackage(ctx.tempDir, {
        name: 'main-project',
        dependencies: { 'my-lib': '1.0.0' }
      })
      await createWorkspace(ctx.tempDir)

      const libPath = await createMockLibrary(ctx.tempDir, 'my-lib')
      const relativePath = path.relative(ctx.tempDir, libPath)
      await createRelativeDepsConfig(ctx.tempDir, { 'my-lib': relativePath })

      // First run
      await runCli([], { cwd: ctx.tempDir })

      // Force update
      const result = await runCli(['--force'], { cwd: ctx.tempDir })

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('Force updating my-lib')
    })

    it('should clean cache with --clean flag', async () => {
      await createMockPackage(ctx.tempDir, {
        name: 'main-project',
        dependencies: { 'my-lib': '1.0.0' }
      })
      await createWorkspace(ctx.tempDir)

      const libPath = await createMockLibrary(ctx.tempDir, 'my-lib')
      const relativePath = path.relative(ctx.tempDir, libPath)
      await createRelativeDepsConfig(ctx.tempDir, { 'my-lib': relativePath })

      // Create cache files
      await runCli([], { cwd: ctx.tempDir })

      // Clean and reinstall
      const result = await runCli(['--clean'], { cwd: ctx.tempDir })

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('Cleaning cache')
    })

    it('should provide verbose output with --verbose flag', async () => {
      await createMockPackage(ctx.tempDir, {
        name: 'main-project',
        dependencies: { 'my-lib': '1.0.0' }
      })
      await createWorkspace(ctx.tempDir)

      const libPath = await createMockLibrary(ctx.tempDir, 'my-lib')
      const relativePath = path.relative(ctx.tempDir, libPath)
      await createRelativeDepsConfig(ctx.tempDir, { 'my-lib': relativePath })

      const result = await runCli(['--verbose'], { cwd: ctx.tempDir })

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('Starting installation with options')
    })
  })

  describe.skip('Error handling', () => {
    it('should handle missing package.json gracefully', async () => {
      const result = await runCli([], { cwd: ctx.tempDir })

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('Could not find package.json')
    })

    it('should handle missing relativeDependencies', async () => {
      await createMockPackage(ctx.tempDir, { name: 'test-project' })

      const result = await runCli([], { cwd: ctx.tempDir })

      expect(result.exitCode).toBe(0)
      expect(result.stderr).toContain("No 'relativeDependencies' specified")
    })

    it('should handle non-existent relative dependency path', async () => {
      await createMockPackage(ctx.tempDir, { name: 'main-project' })
      await createRelativeDepsConfig(ctx.tempDir, { 'missing-lib': './nonexistent' })

      const result = await runCli([], { cwd: ctx.tempDir })

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('Failed to resolve dependency missing-lib')
    })
  })

  describe.skip('Change detection', () => {
    it('should detect changes when source files are modified', async () => {
      await createMockPackage(ctx.tempDir, {
        name: 'main-project',
        dependencies: { 'my-lib': '1.0.0' }
      })
      await createWorkspace(ctx.tempDir)

      const libPath = await createMockLibrary(ctx.tempDir, 'my-lib')
      const relativePath = path.relative(ctx.tempDir, libPath)
      await createRelativeDepsConfig(ctx.tempDir, { 'my-lib': relativePath })

      // First install
      await runCli([], { cwd: ctx.tempDir })

      // Modify source file
      await touchFile(path.join(libPath, 'src', 'index.js'))

      // Second install should detect changes
      const result = await runCli(['--verbose'], { cwd: ctx.tempDir })

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toMatch(/Re-installing my-lib|Quick check detected changes/)
    })

    it('should detect changes when package.json is modified', async () => {
      await createMockPackage(ctx.tempDir, {
        name: 'main-project',
        dependencies: { 'my-lib': '1.0.0' }
      })
      await createWorkspace(ctx.tempDir)

      const libPath = await createMockLibrary(ctx.tempDir, 'my-lib')
      const relativePath = path.relative(ctx.tempDir, libPath)
      await createRelativeDepsConfig(ctx.tempDir, { 'my-lib': relativePath })

      // First install
      await runCli([], { cwd: ctx.tempDir })

      // Modify library package.json
      const libPkg = await readPackageJson(libPath)
      libPkg.version = '1.0.1'
      await createMockPackage(libPath, libPkg)

      // Second install should detect version change
      const result = await runCli(['--verbose'], { cwd: ctx.tempDir })

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toMatch(/Package version changed|Re-installing my-lib/)
    })
  })

  describe.skip('CLI argument validation', () => {
    it('should show help with --help flag', async () => {
      const result = await runCli(['--help'], { cwd: ctx.tempDir })

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('Usage:')
    })

    it('should handle unknown commands gracefully', async () => {
      const result = await runCli(['unknown-command'], { cwd: ctx.tempDir })

      // Should either show help or handle gracefully
      expect([0, 1]).toContain(result.exitCode)
    })
  })
})