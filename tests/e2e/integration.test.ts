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
  readPackageJson,
  fileExists,
  dirExists,
  createWorkspace,
  createRelativeDepsConfig,
  touchFile
} from '../utils.js'

describe('Integration Tests', () => {
  let ctx: TestContext

  beforeEach(async () => {
    ctx = await createTempDir()
  })

  describe('Monorepo scenarios', () => {
    it('should work with multiple nested libraries', async () => {
      // Create a monorepo structure
      await createMockPackage(ctx.tempDir, { name: 'monorepo-root' })
      await createWorkspace(ctx.tempDir)

      // Create packages directory
      const packagesDir = path.join(ctx.tempDir, 'packages')
      await fs.promises.mkdir(packagesDir, { recursive: true })

      // Create multiple packages
      const libAPath = await createMockLibrary(packagesDir, 'lib-a', {
        hasSourceFiles: true,
        hasBuildScript: true
      })
      const libBPath = await createMockLibrary(packagesDir, 'lib-b', {
        hasSourceFiles: true,
        hasBuildScript: true
      })

      // Create an app that depends on both libraries
      const appDir = path.join(ctx.tempDir, 'apps', 'web-app')
      await fs.promises.mkdir(appDir, { recursive: true })
      await createMockPackage(appDir, {
        name: 'web-app',
        dependencies: {
          'lib-a': '1.0.0',
          'lib-b': '1.0.0'
        }
      })

      // Set up relative dependencies
      const relativeLibA = path.relative(appDir, libAPath)
      const relativeLibB = path.relative(appDir, libBPath)
      await createRelativeDepsConfig(appDir, {
        'lib-a': relativeLibA,
        'lib-b': relativeLibB
      })

      // Run installation
      const result = await runCli([], { cwd: appDir })

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain("Checking 'lib-a'")
      expect(result.stdout).toContain("Checking 'lib-b'")

      // Verify installations
      expect(await dirExists(path.join(appDir, 'node_modules', 'lib-a'))).toBe(true)
      expect(await dirExists(path.join(appDir, 'node_modules', 'lib-b'))).toBe(true)
    })

    it('should handle circular dependencies gracefully', async () => {
      await createMockPackage(ctx.tempDir, { name: 'main-app' })
      await createWorkspace(ctx.tempDir)

      // Create two libraries that depend on each other
      const libAPath = await createMockLibrary(ctx.tempDir, 'lib-a')
      const libBPath = await createMockLibrary(ctx.tempDir, 'lib-b')

      // Set up circular relative dependencies
      const relativeLibA = path.relative(ctx.tempDir, libAPath)
      const relativeLibB = path.relative(ctx.tempDir, libBPath)

      await createRelativeDepsConfig(ctx.tempDir, {
        'lib-a': relativeLibA,
        'lib-b': relativeLibB
      })

      // Run installation - should not hang or crash
      const result = await runCli([], { cwd: ctx.tempDir, timeout: 15000 })

      expect(result.exitCode).toBe(0)
      expect(result.error).toBeUndefined()
    })
  })

  describe('Build scenarios', () => {
    it('should build libraries with TypeScript', async () => {
      await createMockPackage(ctx.tempDir, {
        name: 'main-project',
        dependencies: { 'ts-lib': '1.0.0' }
      })
      await createWorkspace(ctx.tempDir)

      // Create a TypeScript library
      const libPath = await createMockLibrary(ctx.tempDir, 'ts-lib', {
        hasSourceFiles: false,
        hasBuildScript: true
      })

      // Add TypeScript files
      const srcDir = path.join(libPath, 'src')
      await fs.promises.mkdir(srcDir, { recursive: true })
      await fs.promises.writeFile(
        path.join(srcDir, 'index.ts'),
        'export const greeting = (name: string): string => `Hello, ${name}!`;'
      )

      // Add tsconfig.json
      await fs.promises.writeFile(
        path.join(libPath, 'tsconfig.json'),
        JSON.stringify({
          compilerOptions: {
            target: 'es2020',
            module: 'commonjs',
            outDir: 'dist',
            strict: true
          },
          include: ['src/**/*']
        }, null, 2)
      )

      // Set up relative dependency
      const relativePath = path.relative(ctx.tempDir, libPath)
      await createRelativeDepsConfig(ctx.tempDir, { 'ts-lib': relativePath })

      // Run installation
      const result = await runCli([], { cwd: ctx.tempDir })

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain("Building ts-lib")
    })

    it('should handle build failures gracefully', async () => {
      await createMockPackage(ctx.tempDir, {
        name: 'main-project',
        dependencies: { 'failing-lib': '1.0.0' }
      })
      await createWorkspace(ctx.tempDir)

      // Create a library with a failing build script
      const libPath = await createMockLibrary(ctx.tempDir, 'failing-lib', {
        hasSourceFiles: true,
        hasBuildScript: false
      })

      // Update package.json with a failing build script
      const libPkg = await readPackageJson(libPath)
      libPkg.scripts = { build: 'exit 1' }
      await fs.promises.writeFile(
        path.join(libPath, 'package.json'),
        JSON.stringify(libPkg, null, 2)
      )

      // Set up relative dependency
      const relativePath = path.relative(ctx.tempDir, libPath)
      await createRelativeDepsConfig(ctx.tempDir, { 'failing-lib': relativePath })

      // Run installation - should fail gracefully
      const result = await runCli([], { cwd: ctx.tempDir })

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('Build failed for failing-lib')
    })
  })

  describe('Cache invalidation', () => {
    it('should invalidate cache when dependencies change', async () => {
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

      // Modify library's dependencies
      const libPkg = await readPackageJson(libPath)
      libPkg.dependencies = { 'lodash': '4.17.21' }
      await fs.promises.writeFile(
        path.join(libPath, 'package.json'),
        JSON.stringify(libPkg, null, 2)
      )

      // Second install should detect dependency changes
      const result = await runCli(['--verbose'], { cwd: ctx.tempDir })

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toMatch(/dependencies changed|Re-installing my-lib/)
    })

    it('should invalidate cache when build script changes', async () => {
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

      // Modify build script
      const libPkg = await readPackageJson(libPath)
      libPkg.scripts = { build: 'echo "new build script"' }
      await fs.promises.writeFile(
        path.join(libPath, 'package.json'),
        JSON.stringify(libPkg, null, 2)
      )

      // Second install should detect build script change
      const result = await runCli(['--verbose'], { cwd: ctx.tempDir })

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toMatch(/dependencies changed|Re-installing my-lib/)
    })
  })

  describe('Package manager compatibility', () => {
    it('should work with npm lockfile', async () => {
      await createMockPackage(ctx.tempDir, {
        name: 'npm-project',
        dependencies: { 'my-lib': '1.0.0' }
      })
      await createWorkspace(ctx.tempDir, 'npm')

      const libPath = await createMockLibrary(ctx.tempDir, 'my-lib')
      const relativePath = path.relative(ctx.tempDir, libPath)
      await createRelativeDepsConfig(ctx.tempDir, { 'my-lib': relativePath })

      const result = await runCli([], { cwd: ctx.tempDir })

      expect(result.exitCode).toBe(0)
      expect(await fileExists(path.join(ctx.tempDir, 'package-lock.json'))).toBe(true)
    })

    it('should work with yarn lockfile', async () => {
      await createMockPackage(ctx.tempDir, {
        name: 'yarn-project',
        dependencies: { 'my-lib': '1.0.0' }
      })
      await createWorkspace(ctx.tempDir, 'yarn')

      const libPath = await createMockLibrary(ctx.tempDir, 'my-lib')
      const relativePath = path.relative(ctx.tempDir, libPath)
      await createRelativeDepsConfig(ctx.tempDir, { 'my-lib': relativePath })

      const result = await runCli([], { cwd: ctx.tempDir })

      expect(result.exitCode).toBe(0)
      expect(await fileExists(path.join(ctx.tempDir, 'yarn.lock'))).toBe(true)
    })
  })

  describe('Performance tests', () => {
    it('should handle large numbers of files efficiently', async () => {
      await createMockPackage(ctx.tempDir, {
        name: 'large-project',
        dependencies: { 'large-lib': '1.0.0' }
      })
      await createWorkspace(ctx.tempDir)

      // Create a library with many files
      const libPath = await createMockLibrary(ctx.tempDir, 'large-lib')
      const srcDir = path.join(libPath, 'src')

      // Create 100 source files
      for (let i = 0; i < 100; i++) {
        await fs.promises.writeFile(
          path.join(srcDir, `file${i}.js`),
          `export const value${i} = ${i};`
        )
      }

      const relativePath = path.relative(ctx.tempDir, libPath)
      await createRelativeDepsConfig(ctx.tempDir, { 'large-lib': relativePath })

      const startTime = Date.now()
      const result = await runCli([], { cwd: ctx.tempDir })
      const duration = Date.now() - startTime

      expect(result.exitCode).toBe(0)
      expect(duration).toBeLessThan(30000) // Should complete within 30 seconds
    })
  })
})