import * as path from "path"
import * as fs from "fs"
import { globby } from "globby"
import checksum from "checksum"
import merge from "lodash/merge"
import { PackageJson } from "./types.js"

export async function findFiles(
  libDir: string,
  targetDir: string
): Promise<string[]> {
  // Ensure absolute paths for reliable comparison
  const resolvedLibDir = path.resolve(libDir)
  const resolvedTargetDir = path.resolve(targetDir)

  const ignore = [
    "**/*",
    "!node_modules",
    "!.git",
    "!.relative-deps-cache",
    "!dist",
    "!build",
    "!coverage",
    "!.nyc_output",
    "!*.log",
    "!.DS_Store",
    "!.vscode",
    "!.idea",
    // Exclude lockfiles that get created during build
    "!package-lock.json",
    "!yarn.lock",
    "!pnpm-lock.yaml",
    "!bun.lockb",
    // Exclude other build artifacts
    "!*.tgz",
    "!*.tar.gz",
    "!.npmrc",
    "!.yarnrc",
    "!.pnp.js",
    "!.pnp.cjs",
  ]

  // Exclude the target directory if it's inside the lib directory
  if (resolvedTargetDir.startsWith(resolvedLibDir)) {
    const relativeTarget = path.relative(resolvedLibDir, resolvedTargetDir)
    // Only add exclusion if relativeTarget is not empty
    if (relativeTarget) {
      const topLevelDir = relativeTarget.split(path.sep)[0]
      ignore.push("!" + topLevelDir)
    }
  }

  const files = await globby(ignore, {
    gitignore: true,
    cwd: resolvedLibDir,
    onlyFiles: true,
    followSymbolicLinks: false,
  })

  return files.sort()
}

export async function getFileHash(file: string): Promise<string> {
  return await new Promise((resolve, reject) => {
    checksum.file(file, (error: Error | null, hash: string) => {
      if (error) reject(error)
      else resolve(hash)
    })
  })
}

export async function getPackageJson(pathname?: string): Promise<PackageJson> {
  const pkgPath = pathname ?? path.join(process.cwd(), "package.json")
  const content = await fs.promises.readFile(pkgPath, "utf-8")
  return JSON.parse(content)
}

export async function setPackageData(pkgData: Partial<PackageJson>): Promise<void> {
  const source = await getPackageJson()
  const merged = merge(source, pkgData)
  await fs.promises.writeFile(
    path.join(process.cwd(), "package.json"),
    JSON.stringify(merged, null, 2)
  )
}
