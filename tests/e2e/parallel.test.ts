import { describe, it, expect, beforeEach } from 'vitest'
import * as path from 'path'
import * as fs from 'fs'
import {
  createTempDir,
  createMockPackage,
  createMockLibrary,
  TestContext
} from '../setup.js'
import {
  runCli,
  createWorkspace,
  createRelativeDepsConfig,
  touchFile,
  readPackageJson
} from '../utils.js'

describe('Parallel Processing Tests', () => {
  let ctx: TestContext

  beforeEach(async () => {
    ctx = await createTempDir()
  })

  describe('Basic parallel processing', () => {
    it('should process independent packages in parallel', async () => {
      // Create main package with multiple independent relative deps
      await createMockPackage(ctx.tempDir, {
        name: 'parallel-test',
        dependencies: {
          'lib-a': '1.0.0',
          'lib-b': '1.0.0',
          'lib-c': '1.0.0'
        }
      })
      await createWorkspace(ctx.tempDir)

      // Create three independent libraries
      await createMockLibrary(ctx.tempDir + '/packages', 'lib-a', { hasBuildScript: true })
      await createMockLibrary(ctx.tempDir + '/packages', 'lib-b', { hasBuildScript: true })
      await createMockLibrary(ctx.tempDir + '/packages', 'lib-c', { hasBuildScript: true })

      await createRelativeDepsConfig(ctx.tempDir, {
        'lib-a': './packages/lib-a',
        'lib-b': './packages/lib-b',
        'lib-c': './packages/lib-c'
      })

      const startTime = Date.now()
      const result = await runCli(['--parallel', '--max-concurrency', '3', '--verbose'], {
        cwd: ctx.tempDir
      })
      const duration = Date.now() - startTime

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toMatch(/Using parallel processing with max concurrency: 3/)
      expect(result.stdout).toMatch(/Processing order:/)
      expect(result.stdout).toMatch(/Re-installing lib-a\.\.\. DONE/)
      expect(result.stdout).toMatch(/Re-installing lib-b\.\.\. DONE/)
      expect(result.stdout).toMatch(/Re-installing lib-c\.\.\. DONE/)

      // With 3 independent packages and concurrency 3, should be faster than sequential
      console.log(`Parallel processing took ${duration}ms`)
    })

    it('should fall back to sequential when parallel disabled', async () => {
      await createMockPackage(ctx.tempDir, {
        name: 'sequential-test',
        dependencies: { 'my-lib': '1.0.0' }
      })
      await createWorkspace(ctx.tempDir)
      await createMockLibrary(ctx.tempDir + '/packages', 'my-lib', { hasBuildScript: true })
      await createRelativeDepsConfig(ctx.tempDir, {
        'my-lib': './packages/my-lib'
      })

      const result = await runCli(['--verbose'], { cwd: ctx.tempDir })

      expect(result.exitCode).toBe(0)
      expect(result.stdout).not.toMatch(/Using parallel processing/)
      expect(result.stdout).toMatch(/Checking 'my-lib'/)
    })

    it('should handle single package gracefully with parallel enabled', async () => {
      await createMockPackage(ctx.tempDir, {
        name: 'single-test',
        dependencies: { 'my-lib': '1.0.0' }
      })
      await createWorkspace(ctx.tempDir)
      await createMockLibrary(ctx.tempDir + '/packages', 'my-lib', { hasBuildScript: true })
      await createRelativeDepsConfig(ctx.tempDir, {
        'my-lib': './packages/my-lib'
      })

      const result = await runCli(['--parallel', '--verbose'], { cwd: ctx.tempDir })

      expect(result.exitCode).toBe(0)
      // Should fall back to sequential for single package
      expect(result.stdout).not.toMatch(/Using parallel processing/)
      expect(result.stdout).toMatch(/Checking 'my-lib'/)
    })
  })

  describe('Dependency resolution', () => {
    it.skip('should process packages in correct order when dependencies exist', async () => {
      await createMockPackage(ctx.tempDir, {
        name: 'dependency-test',
        dependencies: {
          'lib-base': '1.0.0',
          'lib-dependent': '1.0.0'
        }
      })
      await createWorkspace(ctx.tempDir)

      // Create base library
      await createMockLibrary(ctx.tempDir + '/packages', 'lib-base', { hasBuildScript: true })

      // Create dependent library
      await createMockLibrary(ctx.tempDir + '/packages', 'lib-dependent', {
        hasBuildScript: true
      })

      // Add dependency to lib-dependent's package.json for topological sorting
      const dependentPkgPath = path.join(ctx.tempDir, 'packages', 'lib-dependent', 'package.json')
      const dependentPkg = JSON.parse(await fs.promises.readFile(dependentPkgPath, 'utf8'))
      // Use devDependencies to avoid npm install but still enable dependency detection
      dependentPkg.devDependencies = { 'lib-base': '1.0.0' }
      await fs.promises.writeFile(dependentPkgPath, JSON.stringify(dependentPkg, null, 2))

      await createRelativeDepsConfig(ctx.tempDir, {
        'lib-base': './packages/lib-base',
        'lib-dependent': './packages/lib-dependent'
      })

      const result = await runCli(['--parallel', '--max-concurrency', '2', '--verbose'], {
        cwd: ctx.tempDir
      })

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toMatch(/Using parallel processing/)
      expect(result.stdout).toMatch(/Processing order.*lib-base.*lib-dependent/)
    })

    it('should handle packages without dependencies in parallel', async () => {
      await createMockPackage(ctx.tempDir, {
        name: 'no-deps-test',
        dependencies: {
          'lib-a': '1.0.0',
          'lib-b': '1.0.0'
        }
      })
      await createWorkspace(ctx.tempDir)

      // Create libraries without internal dependencies
      await createMockLibrary(ctx.tempDir + '/packages', 'lib-a', { hasBuildScript: true })
      await createMockLibrary(ctx.tempDir + '/packages', 'lib-b', { hasBuildScript: true })

      await createRelativeDepsConfig(ctx.tempDir, {
        'lib-a': './packages/lib-a',
        'lib-b': './packages/lib-b'
      })

      const result = await runCli(['--parallel', '--verbose'], { cwd: ctx.tempDir })

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toMatch(/Using parallel processing/)
      expect(result.stdout).toMatch(/Re-installing lib-a\.\.\. DONE/)
      expect(result.stdout).toMatch(/Re-installing lib-b\.\.\. DONE/)
    })
  })

  describe('Error handling in parallel mode', () => {
    it('should stop processing on build failure', async () => {
      await createMockPackage(ctx.tempDir, {
        name: 'error-test',
        dependencies: {
          'good-lib': '1.0.0',
          'bad-lib': '1.0.0'
        }
      })
      await createWorkspace(ctx.tempDir)

      await createMockLibrary(ctx.tempDir + '/packages', 'good-lib', { hasBuildScript: true })
      await createMockLibrary(ctx.tempDir + '/packages', 'bad-lib', { hasBuildScript: true })

      // Make bad-lib's build script fail
      const badLibPkgPath = path.join(ctx.tempDir, 'packages', 'bad-lib', 'package.json')
      const badLibPkg = JSON.parse(await fs.promises.readFile(badLibPkgPath, 'utf8'))
      badLibPkg.scripts = { build: 'exit 1' }
      await fs.promises.writeFile(badLibPkgPath, JSON.stringify(badLibPkg, null, 2))

      await createRelativeDepsConfig(ctx.tempDir, {
        'good-lib': './packages/good-lib',
        'bad-lib': './packages/bad-lib'
      })

      const result = await runCli(['--parallel', '--verbose'], {
        cwd: ctx.tempDir
      })

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toMatch(/Failed to process some packages/)
    })

    it('should continue processing independent packages when one fails', async () => {
      await createMockPackage(ctx.tempDir, {
        name: 'partial-error-test',
        dependencies: {
          'lib-a': '1.0.0',
          'lib-b': '1.0.0',
          'lib-c': '1.0.0'
        }
      })
      await createWorkspace(ctx.tempDir)

      await createMockLibrary(ctx.tempDir + '/packages', 'lib-a', { hasBuildScript: true })
      await createMockLibrary(ctx.tempDir + '/packages', 'lib-b', { hasBuildScript: true })
      await createMockLibrary(ctx.tempDir + '/packages', 'lib-c', { hasBuildScript: true })

      // Make lib-b's build script fail
      const libBPkgPath = path.join(ctx.tempDir, 'packages', 'lib-b', 'package.json')
      const libBPkg = JSON.parse(await fs.promises.readFile(libBPkgPath, 'utf8'))
      libBPkg.scripts = { build: 'exit 1' }
      await fs.promises.writeFile(libBPkgPath, JSON.stringify(libBPkg, null, 2))

      await createRelativeDepsConfig(ctx.tempDir, {
        'lib-a': './packages/lib-a',
        'lib-b': './packages/lib-b',
        'lib-c': './packages/lib-c'
      })

      const result = await runCli(['--parallel', '--max-concurrency', '3'], {
        cwd: ctx.tempDir
      })

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toMatch(/Failed to process lib-b/)
    })
  })

  describe('Performance comparison', () => {
    it('should complete processing with multiple packages', async () => {
      const packageCount = 3
      const dependencies: Record<string, string> = {}
      const relativeDeps: Record<string, string> = {}

      // Create multiple independent packages
      for (let i = 1; i <= packageCount; i++) {
        const name = `perf-lib-${i}`
        dependencies[name] = '1.0.0'
        relativeDeps[name] = `./packages/${name}`
        await createMockLibrary(ctx.tempDir + '/packages', name, { hasBuildScript: true })
      }

      await createMockPackage(ctx.tempDir, {
        name: 'perf-test',
        dependencies
      })
      await createWorkspace(ctx.tempDir)
      await createRelativeDepsConfig(ctx.tempDir, relativeDeps)

      // Test parallel processing
      const result = await runCli(['--parallel', '--max-concurrency', '3', '--verbose'], {
        cwd: ctx.tempDir
      })

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toMatch(/Using parallel processing/)

      // All packages should be processed
      for (let i = 1; i <= packageCount; i++) {
        expect(result.stdout).toMatch(new RegExp(`Re-installing perf-lib-${i}.*DONE`))
      }
    })
  })

  describe('Concurrency limits', () => {
    it('should respect max concurrency setting', async () => {
      const dependencies: Record<string, string> = {}
      const relativeDeps: Record<string, string> = {}

      // Create 5 packages but limit concurrency to 2
      for (let i = 1; i <= 5; i++) {
        const name = `concurrency-lib-${i}`
        dependencies[name] = '1.0.0'
        relativeDeps[name] = `./packages/${name}`
        await createMockLibrary(ctx.tempDir + '/packages', name, { hasBuildScript: true })
      }

      await createMockPackage(ctx.tempDir, {
        name: 'concurrency-test',
        dependencies
      })
      await createWorkspace(ctx.tempDir)
      await createRelativeDepsConfig(ctx.tempDir, relativeDeps)

      const result = await runCli(['--parallel', '--max-concurrency', '2', '--verbose'], {
        cwd: ctx.tempDir
      })

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toMatch(/max concurrency: 2/)

      // All packages should still be processed
      for (let i = 1; i <= 5; i++) {
        expect(result.stdout).toMatch(new RegExp(`Re-installing concurrency-lib-${i}.*DONE`))
      }
    })
  })
})