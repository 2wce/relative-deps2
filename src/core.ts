import * as path from "path";
import * as fs from "fs";
import { readPackageUp} from "read-pkg-up";
import debounce from "lodash/debounce";
import { HashStore, InstallOptions, PackageJson } from "./types.js";
import { cleanRelativeDepsCaches, clearModuleCache, libraryHasChanged, createChangeMetadata } from "./cache.js";
import { buildLibrary, packAndInstallLibrary } from "./builder.js";

interface PackageTask {
  name: string;
  libDir: string;
  dependencies: string[];
  regularDep?: string;
}

/**
 * Build dependency graph for relative packages to determine build order
 */
async function buildDependencyGraph(
  relativeDependencies: Record<string, string>,
  targetDir: string
): Promise<PackageTask[]> {
  const tasks: PackageTask[] = [];

  for (const [name, relativePath] of Object.entries(relativeDependencies)) {
    const libDir = path.resolve(targetDir, relativePath);
    const dependencies: string[] = [];

    // Check if this package depends on other relative dependencies
    try {
      const pkgPath = path.join(libDir, 'package.json');
      if (fs.existsSync(pkgPath)) {
        const pkg: PackageJson = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        const allDeps = {
          ...pkg.dependencies,
          ...pkg.devDependencies,
          ...pkg.peerDependencies
        };

        // Find dependencies that are also relative dependencies
        for (const depName of Object.keys(allDeps || {})) {
          if (relativeDependencies[depName]) {
            dependencies.push(depName);
          }
        }
      }
    } catch (error) {
      // If we can't read the package.json, assume no internal dependencies
    }

    tasks.push({
      name,
      libDir,
      dependencies
    });
  }

  return tasks;
}

/**
 * Topologically sort packages to respect dependencies
 */
function topologicalSort(tasks: PackageTask[]): PackageTask[] {
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const result: PackageTask[] = [];
  const taskMap = new Map(tasks.map(task => [task.name, task]));

  function visit(taskName: string) {
    if (visited.has(taskName)) return;
    if (visiting.has(taskName)) {
      // Circular dependency detected - continue anyway but warn
      console.warn(`[relative-deps][WARN] Circular dependency detected involving ${taskName}`);
      return;
    }

    visiting.add(taskName);
    const task = taskMap.get(taskName);

    if (task) {
      // Visit all dependencies first
      for (const dep of task.dependencies) {
        if (taskMap.has(dep)) {
          visit(dep);
        }
      }

      result.push(task);
      visited.add(taskName);
    }

    visiting.delete(taskName);
  }

  // Visit all tasks
  for (const task of tasks) {
    visit(task.name);
  }

  return result;
}

/**
 * Process packages in parallel with respect to dependencies
 */
async function processPackagesInParallel(
  tasks: PackageTask[],
  projectPkgJson: any,
  targetDir: string,
  options: InstallOptions
): Promise<void> {
  const { force = false, verbose = false, maxConcurrency = 1 } = options;
  const completed = new Set<string>();
  const processing = new Set<string>();
  const errors: string[] = [];

  // Create a queue of tasks that can be processed
  const getReadyTasks = () => {
    return tasks.filter(task =>
      !completed.has(task.name) &&
      !processing.has(task.name) &&
      task.dependencies.every(dep => completed.has(dep))
    );
  };

  const processTask = async (task: PackageTask) => {
    const { name, libDir } = task;
    processing.add(name);

    try {
      if (verbose) {
        console.log(`[relative-deps] Processing '${name}' in '${libDir}'`);
      }

      const regularDep =
        (projectPkgJson.packageJson.dependencies && projectPkgJson.packageJson.dependencies[name]) ||
        (projectPkgJson.packageJson.devDependencies && projectPkgJson.packageJson.devDependencies[name]);

      if (!regularDep) {
        console.warn(`[relative-deps][WARN] The relative dependency '${name}' should also be added as normal- or dev-dependency`);
      }

      // Check if target dir exists
      if (!fs.existsSync(libDir)) {
        if (regularDep) {
          console.warn(`[relative-deps][WARN] Could not find target directory '${libDir}', using normally installed version ('${regularDep}') instead`);
          return;
        } else {
          throw new Error(`Failed to resolve dependency ${name}: failed to find target directory '${libDir}', and the library is not present as normal dependency either`);
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

        await buildLibrary(name, libDir, verbose);
        await packAndInstallLibrary(name, libDir, targetDir, verbose);

        // Write both hash and metadata
        fs.writeFileSync(hashStore.file, hashStore.hash);
        if (hashStore.metadataFile) {
          const metadata = await createChangeMetadata(name, libDir);
          fs.writeFileSync(hashStore.metadataFile, JSON.stringify(metadata, null, 2));
        }

        console.log(`[relative-deps] Re-installing ${name}... DONE`);
      } else if (verbose) {
        console.log(`[relative-deps] No changes detected for ${name}`);
      }

      completed.add(name);
    } catch (error) {
      const errorMsg = `Failed to process ${name}: ${error instanceof Error ? error.message : String(error)}`;
      errors.push(errorMsg);
      console.error(`[relative-deps][ERROR] ${errorMsg}`);
      completed.add(name); // Mark as completed to unblock dependents
    } finally {
      processing.delete(name);
    }
  };

  // Process tasks in waves, respecting concurrency limits
  while (completed.size < tasks.length && errors.length === 0) {
    const readyTasks = getReadyTasks();

    if (readyTasks.length === 0) {
      if (processing.size === 0) {
        // No tasks ready and none processing - might be stuck
        const remainingTasks = tasks.filter(task => !completed.has(task.name));
        const stuckTasks = remainingTasks.map(task => `${task.name} (waiting for: ${task.dependencies.filter(dep => !completed.has(dep)).join(', ')})`);
        throw new Error(`Dependency resolution stuck. Remaining tasks: ${stuckTasks.join(', ')}`);
      }
      // Wait for some task to complete
      await new Promise(resolve => setTimeout(resolve, 100));
      continue;
    }

    // Start up to maxConcurrency tasks
    const tasksToStart = readyTasks.slice(0, maxConcurrency - processing.size);
    const promises = tasksToStart.map(processTask);

    // Wait for at least one to complete
    if (promises.length > 0) {
      await Promise.race(promises);
    }
  }

  // Wait for all remaining tasks to complete
  while (processing.size > 0) {
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  if (errors.length > 0) {
    console.error(`[relative-deps][ERROR] Failed to process some packages: ${errors.join(', ')}`);
    process.exit(1);
  }
}

export async function installRelativeDeps(options: InstallOptions = {}): Promise<void> {
  const { force = false, clean = false, verbose = false, parallel = false, maxConcurrency = 1 } = options;

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

  if (parallel && Object.keys(relativeDependencies).length > 1) {
    if (verbose) {
      console.log(`[relative-deps] Using parallel processing with max concurrency: ${maxConcurrency}`);
    }

    // Build dependency graph and process in parallel
    const tasks = await buildDependencyGraph(relativeDependencies, targetDir);
    const sortedTasks = topologicalSort(tasks);

    if (verbose) {
      console.log(`[relative-deps] Processing order: ${sortedTasks.map(t => t.name).join(' → ')}`);
    }

    await processPackagesInParallel(sortedTasks, projectPkgJson, targetDir, options);
  } else {
    // Sequential processing (original logic)
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