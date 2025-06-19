import { spawn, SpawnOptionsWithoutStdio } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'

export interface CliResult {
  exitCode: number
  stdout: string
  stderr: string
  error?: Error
}

// Run a CLI command and return the result
export async function runCli(
  args: string[],
  options: {
    cwd?: string
    timeout?: number
    env?: Record<string, string>
  } = {}
): Promise<CliResult> {
  const { cwd = process.cwd(), timeout = 10000, env = {} } = options

  // Build the CLI executable path
  const cliPath = path.resolve(__dirname, '../dist/cli.js')

  return new Promise((resolve) => {
    const child = spawn('node', [cliPath, ...args], {
      cwd,
      env: { ...process.env, ...env },
      stdio: 'pipe'
    })

    let stdout = ''
    let stderr = ''
    let timeoutId: NodeJS.Timeout | undefined

    if (child.stdout) {
      child.stdout.on('data', (data) => {
        stdout += data.toString()
      })
    }

    if (child.stderr) {
      child.stderr.on('data', (data) => {
        stderr += data.toString()
      })
    }

    child.on('close', (code) => {
      if (timeoutId) clearTimeout(timeoutId)
      resolve({
        exitCode: code || 0,
        stdout,
        stderr
      })
    })

    child.on('error', (error) => {
      if (timeoutId) clearTimeout(timeoutId)
      resolve({
        exitCode: 1,
        stdout,
        stderr,
        error
      })
    })

    // Set timeout
    timeoutId = setTimeout(() => {
      child.kill('SIGTERM')
      resolve({
        exitCode: 1,
        stdout,
        stderr,
        error: new Error('Command timed out')
      })
    }, timeout)
  })
}

// Read and parse package.json
export async function readPackageJson(dir: string): Promise<any> {
  const pkgPath = path.join(dir, 'package.json')
  const content = await fs.promises.readFile(pkgPath, 'utf-8')
  return JSON.parse(content)
}

// Check if a file exists
export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.promises.access(filePath)
    return true
  } catch {
    return false
  }
}

// Check if a directory exists
export async function dirExists(dirPath: string): Promise<boolean> {
  try {
    const stat = await fs.promises.stat(dirPath)
    return stat.isDirectory()
  } catch {
    return false
  }
}

// Read file content
export async function readFile(filePath: string): Promise<string> {
  return fs.promises.readFile(filePath, 'utf-8')
}

// Wait for a condition to be true (useful for async operations)
export async function waitFor(
  condition: () => Promise<boolean> | boolean,
  timeout = 5000,
  interval = 100
): Promise<void> {
  const start = Date.now()

  while (Date.now() - start < timeout) {
    if (await condition()) {
      return
    }
    await new Promise(resolve => setTimeout(resolve, interval))
  }

  throw new Error(`Condition not met within ${timeout}ms`)
}

// Create a workspace with npm/yarn lock files
export async function createWorkspace(
  dir: string,
  packageManager: 'npm' | 'yarn' | 'pnpm' = 'npm'
): Promise<void> {
  // Create node_modules directory
  await fs.promises.mkdir(path.join(dir, 'node_modules'), { recursive: true })

  // Create appropriate lock file
  switch (packageManager) {
    case 'npm':
      await fs.promises.writeFile(
        path.join(dir, 'package-lock.json'),
        JSON.stringify({ lockfileVersion: 2 }, null, 2)
      )
      break
    case 'yarn':
      await fs.promises.writeFile(
        path.join(dir, 'yarn.lock'),
        '# Yarn lockfile v1\n'
      )
      break
    case 'pnpm':
      await fs.promises.writeFile(
        path.join(dir, 'pnpm-lock.yaml'),
        'lockfileVersion: 5.4\n'
      )
      break
  }
}

// Simulate file changes by touching files
export async function touchFile(filePath: string): Promise<void> {
  const now = new Date()
  await fs.promises.utimes(filePath, now, now)
}

// Create a sample relative deps configuration
export async function createRelativeDepsConfig(
  dir: string,
  config: Record<string, string>
): Promise<void> {
  const pkg = await readPackageJson(dir)
  pkg.relativeDependencies = config

  await fs.promises.writeFile(
    path.join(dir, 'package.json'),
    JSON.stringify(pkg, null, 2)
  )
}