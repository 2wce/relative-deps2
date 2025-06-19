import { afterEach, beforeEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

// Global test state
export interface TestContext {
  tempDir: string
  cleanup: () => Promise<void>
}

// Store active temp directories for cleanup
const activeTempDirs = new Set<string>()

// Cleanup function for all temp directories
export async function cleanupAllTempDirs() {
  for (const dir of activeTempDirs) {
    try {
      await fs.promises.rm(dir, { recursive: true, force: true })
    } catch (error) {
      console.warn(`Failed to cleanup temp dir ${dir}:`, error)
    }
  }
  activeTempDirs.clear()
}

// Create a temporary directory for testing
export async function createTempDir(prefix = 'relative-deps-test-'): Promise<TestContext> {
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), prefix))
  activeTempDirs.add(tempDir)

  const cleanup = async () => {
    try {
      await fs.promises.rm(tempDir, { recursive: true, force: true })
      activeTempDirs.delete(tempDir)
    } catch (error) {
      console.warn(`Failed to cleanup ${tempDir}:`, error)
    }
  }

  return { tempDir, cleanup }
}

// Create a mock package.json
export async function createMockPackage(
  dir: string,
  packageData: {
    name: string
    version?: string
    dependencies?: Record<string, string>
    devDependencies?: Record<string, string>
    relativeDependencies?: Record<string, string>
    scripts?: Record<string, string>
  }
) {
  const defaultPackage = {
    version: '1.0.0',
    dependencies: {},
    devDependencies: {},
    scripts: {},
    ...packageData
  }

  await fs.promises.writeFile(
    path.join(dir, 'package.json'),
    JSON.stringify(defaultPackage, null, 2)
  )
}

// Create a mock library with source files
export async function createMockLibrary(
  dir: string,
  libName: string,
  options: {
    hasSourceFiles?: boolean
    hasBuildScript?: boolean
    hasDistFolder?: boolean
  } = {}
) {
  const { hasSourceFiles = true, hasBuildScript = false, hasDistFolder = false } = options

  const libDir = path.join(dir, libName)
  await fs.promises.mkdir(libDir, { recursive: true })

  // Create package.json
  const packageJson = {
    name: libName,
    version: '1.0.0',
    main: hasDistFolder ? 'dist/index.js' : 'src/index.js',
    scripts: hasBuildScript ? { build: 'echo "Building..."' } : undefined
  }

  await createMockPackage(libDir, packageJson)

  if (hasSourceFiles) {
    // Create src directory and files
    const srcDir = path.join(libDir, 'src')
    await fs.promises.mkdir(srcDir, { recursive: true })
    await fs.promises.writeFile(
      path.join(srcDir, 'index.js'),
      `export const ${libName.replace(/[^a-zA-Z0-9]/g, '')} = 'Hello from ${libName}';`
    )
  }

  if (hasDistFolder) {
    // Create dist directory
    const distDir = path.join(libDir, 'dist')
    await fs.promises.mkdir(distDir, { recursive: true })
    await fs.promises.writeFile(
      path.join(distDir, 'index.js'),
      `module.exports = { ${libName.replace(/[^a-zA-Z0-9]/g, '')}: 'Built ${libName}' };`
    )
  }

  return libDir
}

// Run after each test to cleanup
afterEach(async () => {
  await cleanupAllTempDirs()
})

// Global teardown
process.on('exit', () => {
  // Sync cleanup on exit
  for (const dir of activeTempDirs) {
    try {
      fs.rmSync(dir, { recursive: true, force: true })
    } catch (error) {
      console.warn(`Failed to cleanup temp dir ${dir} on exit:`, error)
    }
  }
})