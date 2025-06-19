import * as path from "path"
import * as fs from "fs"
import { execa } from "execa"
import yarnOrNpm from "yarn-or-npm"
import {
  AddRelativeDepsOptions,
  InitRelativeDepsOptions,
  Library,
  PackageJson,
} from "./types.js"
import { getPackageJson, setPackageData } from "./utils.js"
import { installRelativeDeps } from "./core.js"

// Extract spawn from the default export since yarn-or-npm is a CommonJS module
const { spawn } = yarnOrNpm

export async function addScriptToPackage(script: string): Promise<void> {
  let pkg = await getPackageJson()
  if (!pkg.scripts) {
    pkg.scripts = {}
  }

  const msg = `[relative-deps] Adding relative-deps to ${script} script in package.json`

  if (!pkg.scripts[script]) {
    console.log(msg)
    pkg.scripts[script] = "relative-deps"
  } else if (!pkg.scripts[script].includes("relative-deps")) {
    console.log(msg)
    pkg.scripts[script] = `${pkg.scripts[script]} && relative-deps`
  }
  await setPackageData(pkg)
}

export async function installRelativeDepsPackage(): Promise<void> {
  let pkg = await getPackageJson()

  if (
    !(
      (pkg.devDependencies && pkg.devDependencies["relative-deps"]) ||
      (pkg.dependencies && pkg.dependencies["relative-deps"])
    )
  ) {
    console.log("[relative-deps] Installing relative-deps package")
    spawn.sync(["add", "-D", "relative-deps"])
  }
}

export async function setupEmptyRelativeDeps(): Promise<void> {
  let pkg = await getPackageJson()

  if (!pkg.relativeDependencies) {
    console.log(
      `[relative-deps] Setting up relativeDependencies section in package.json`
    )
    pkg.relativeDependencies = {}
    await setPackageData(pkg)
  }
}

export async function initRelativeDeps({
  script = "prepare",
}: InitRelativeDepsOptions = {}): Promise<void> {
  await installRelativeDepsPackage()
  await setupEmptyRelativeDeps()
  await addScriptToPackage(script)
}

export async function addRelativeDeps({
  paths,
  dev = false,
  script = "prepare",
}: AddRelativeDepsOptions = {}): Promise<void> {
  await initRelativeDeps({ script })

  if (!paths || paths.length === 0) {
    console.log(`[relative-deps][WARN] no paths provided running ${script}`)
    spawn.sync([script])
    return
  }

  let libraries: Library[]
  try {
    libraries = await Promise.all(
      paths.map(async (relPath) => {
        const libPackagePath = path.resolve(
          process.cwd(),
          relPath,
          "package.json"
        )
        try {
          await fs.promises.access(libPackagePath)
        } catch {
          throw new Error(
            `[relative-deps][ERROR] Failed to resolve dependency ${relPath}`
          )
        }
        const libraryPackageJson: PackageJson = await getPackageJson(
          libPackagePath
        )
        if (!libraryPackageJson.name) {
          throw new Error(
            `[relative-deps][ERROR] Package at ${relPath} does not have a name`
          )
        }
        return {
          relPath,
          name: libraryPackageJson.name,
          version: libraryPackageJson.version || "0.0.0",
        }
      })
    )
  } catch (err) {
    console.error((err as Error).message)
    return
  }

  let pkg = await getPackageJson()

  const depsKey = dev ? "devDependencies" : "dependencies"
  if (!pkg[depsKey]) pkg[depsKey] = {}

  libraries.forEach((library) => {
    if (!pkg[depsKey]![library.name]) {
      try {
        spawn.sync(["add", ...(dev ? ["-D"] : []), library.name], {
          stdio: "ignore",
        })
      } catch (_e) {
        console.log(
          `[relative-deps][WARN] Unable to fetch ${library.name} from registry. Installing as a relative dependency only.`
        )
      }
    }
  })

  if (!pkg.relativeDependencies) pkg.relativeDependencies = {}

  libraries.forEach((dependency) => {
    pkg.relativeDependencies![dependency.name] = dependency.relPath
  })

  await setPackageData(pkg)
  await installRelativeDeps()
}
