import * as path from "path";
import * as fs from "fs";
import { readPackageUp} from "read-pkg-up";
import debounce from "lodash/debounce";
import { HashStore, InstallOptions } from "./types.js";
import { cleanRelativeDepsCaches, clearModuleCache, libraryHasChanged, createChangeMetadata } from "./cache.js";
import { buildLibrary, packAndInstallLibrary } from "./builder.js";

export async function installRelativeDeps(options: InstallOptions = {}): Promise<void> {
  const { force = false, clean = false, verbose = false } = options;

  if (verbose) console.log("[relative-deps] Starting installation with options:", options);

  const projectPkgJson = await readPackageUp();

  if (!projectPkgJson) {
    console.error("[relative-deps][ERROR] Could not find package.json");
    process.exit(1);
  }

  const relativeDependencies = projectPkgJson.packageJson.relativeDependencies;

  if (!relativeDependencies) {
    console.warn("[relative-deps][WARN] No 'relativeDependencies' specified in package.json");
    process.exit(0);
  }

  const targetDir = path.dirname(projectPkgJson.path);

  // Clean cache if requested
  if (clean) {
    console.log("[relative-deps] Cleaning cache...");
    await cleanRelativeDepsCaches(targetDir, Object.keys(relativeDependencies));
  }

  const depNames = Object.keys(relativeDependencies);
  for (const name of depNames) {
    const libDir = path.resolve(targetDir, relativeDependencies[name]);
    console.log(`[relative-deps] Checking '${name}' in '${libDir}'`);

    const regularDep =
      (projectPkgJson.packageJson.dependencies && projectPkgJson.packageJson.dependencies[name]) ||
      (projectPkgJson.packageJson.devDependencies && projectPkgJson.packageJson.devDependencies[name]);

    if (!regularDep) {
      console.warn(`[relative-deps][WARN] The relative dependency '${name}' should also be added as normal- or dev-dependency`);
    }

    // Check if target dir exists
    if (!fs.existsSync(libDir)) {
      // Nope, but is the dependency mentioned as normal dependency in the package.json? Use that one
      if (regularDep) {
        console.warn(`[relative-deps][WARN] Could not find target directory '${libDir}', using normally installed version ('${regularDep}') instead`);
        return;
      } else {
        console.error(
          `[relative-deps][ERROR] Failed to resolve dependency ${name}: failed to find target directory '${libDir}', and the library is not present as normal depenency either`
        );
        process.exit(1);
      }
    }

    const hashStore: HashStore = {
      hash: "",
      file: "",
      metadataFile: ""
    };

    const hasChanges = force || await libraryHasChanged(name, libDir, targetDir, hashStore, verbose);

    if (hasChanges) {
      if (force) console.log(`[relative-deps] Force updating ${name}...`);

      // Clear Node.js module cache for this package
      clearModuleCache(name, targetDir);

      try {
        await buildLibrary(name, libDir, verbose);
        await packAndInstallLibrary(name, libDir, targetDir, verbose);

        // Write both hash and metadata
        fs.writeFileSync(hashStore.file, hashStore.hash);
        if (hashStore.metadataFile) {
          const metadata = await createChangeMetadata(name, libDir);
          fs.writeFileSync(hashStore.metadataFile, JSON.stringify(metadata, null, 2));
        }

        console.log(`[relative-deps] Re-installing ${name}... DONE`);
      } catch (error) {
        // Write clean error message to stderr
        console.error(`[relative-deps][ERROR] ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
      }
    } else if (verbose) {
      console.log(`[relative-deps] No changes detected for ${name}`);
    }
  }
}

export async function watchRelativeDeps(): Promise<void> {
  const projectPkgJson = await readPackageUp();

  if (!projectPkgJson) {
    console.error("[relative-deps][ERROR] Could not find package.json");
    process.exit(1);
  }

  const relativeDependencies = projectPkgJson.packageJson.relativeDependencies;

  if (!relativeDependencies) {
    console.warn("[relative-deps][WARN] No 'relativeDependencies' specified in package.json");
    process.exit(0);
  }

  (Object.values(relativeDependencies) as string[]).forEach(relativePath => {
    fs.watch(relativePath, { recursive: true }, debounce(() => installRelativeDeps(), 500));
  });
}