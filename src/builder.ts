import * as path from "path"
import * as fs from "fs"
import { sync } from "rimraf"
import * as tar from "tar"
import { execa } from "execa"
import { PackageJson } from "./types"

export function detectPackageManager(
  cwd: string = process.cwd()
): "yarn" | "npm" | "pnpm" | "bun" {
  if (fs.existsSync(path.join(cwd, "bun.lockb"))) return "bun"
  if (fs.existsSync(path.join(cwd, "pnpm-lock.yaml"))) return "pnpm"
  if (fs.existsSync(path.join(cwd, "yarn.lock"))) return "yarn"
  if (fs.existsSync(path.join(cwd, "package-lock.json"))) return "npm"
  return "npm" // fallback
}
export async function buildLibrary(
  name: string,
  dir: string,
  verbose: boolean = false
): Promise<void> {
  const pkgManager = detectPackageManager(dir)

  // Run install if never done before
  if (!fs.existsSync(path.join(dir, "node_modules"))) {
    console.log(`[relative-deps] Running 'install' in ${dir}`)
    try {
      await execa(pkgManager, ["install"], {
        cwd: dir,
        stdio: verbose ? "inherit" : "ignore",
      })
    } catch (err) {
      const errorMessage = `Install failed for ${name}`
      if (verbose) {
        console.error(`[relative-deps][ERROR] ${errorMessage}:`, err)
      }
      throw new Error(errorMessage)
    }
  }

  // Run build script if present
  const libraryPkgJson: PackageJson = JSON.parse(
    fs.readFileSync(path.join(dir, "package.json"), "utf8")
  )
  if (libraryPkgJson.name !== name) {
    console.error(
      `[relative-deps][ERROR] Mismatch in package name: found '${libraryPkgJson.name}', expected '${name}'`
    )
    process.exit(1)
  }
  if (libraryPkgJson.scripts && libraryPkgJson.scripts.build) {
    console.log(`[relative-deps] Building ${name} in ${dir}`)

    const pkgManager = detectPackageManager(dir)

    try {
      await execa(pkgManager, ["run", "build"], {
        cwd: dir,
        stdio: verbose ? "inherit" : "ignore",
      })
    } catch (err) {
      const errorMessage = `Build failed for ${name}`
      if (verbose) {
        console.error(`[relative-deps][ERROR] ${errorMessage}:`, err)
      }
      throw new Error(errorMessage)
    }
  }
}

export async function packAndInstallLibrary(
  name: string,
  dir: string,
  targetDir: string,
  verbose: boolean = false
): Promise<void> {
  const libDestDir = path.join(targetDir, "node_modules", name)
  let fullPackageName: string | undefined

  try {
    if (verbose) console.log("[relative-deps] Packing library...")

    const pkgManager = detectPackageManager(dir)

    try {
      await execa(pkgManager, ["pack"], {
        cwd: dir,
        stdio: verbose ? "inherit" : "ignore",
      })
    } catch (err) {
      const errorMessage = `Pack failed for ${name}`
      if (verbose) {
        console.error(`[relative-deps][ERROR] ${errorMessage}:`, err)
      }
      throw new Error(errorMessage)
    }

    if (fs.existsSync(libDestDir)) {
      if (verbose)
        console.log(`[relative-deps] Removing existing ${libDestDir}`)
      sync(libDestDir)
    }
    fs.mkdirSync(libDestDir, { recursive: true })

    const tmpName = name.replace(/[\s\/]/g, "-").replace(/@/g, "")
    // npm replaces @... with at- where yarn just removes it, so we test for both files here
    const regex = new RegExp(`^(at-)?${tmpName}(.*).tgz$`)

    const packagedName = fs.readdirSync(dir).find((file) => regex.test(file))
    if (!packagedName) {
      throw new Error(`Could not find packaged file for ${name}`)
    }
    fullPackageName = path.join(dir, packagedName)

    if (verbose) {
      console.log(
        `[relative-deps] Extracting "${packagedName}" to ${libDestDir}`
      )
    } else {
      console.log("[relative-deps] Installing to local node_modules")
    }

    const [cwd, file] = [libDestDir, fullPackageName].map((absolutePath) =>
      path.relative(process.cwd(), absolutePath)
    )

    tar.extract({
      cwd,
      file,
      gzip: true,
      strip: 1,
      sync: true,
    } as any)

    // Bust package manager cache by touching package.json
    const installedPackageJson = path.join(libDestDir, "package.json")
    if (fs.existsSync(installedPackageJson)) {
      const now = new Date()
      fs.utimesSync(installedPackageJson, now, now)
    }
  } finally {
    if (fullPackageName && fs.existsSync(fullPackageName)) {
      fs.unlinkSync(fullPackageName)
    }
  }
}
