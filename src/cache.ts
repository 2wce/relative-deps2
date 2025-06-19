import * as path from "path";
import * as fs from "fs";
import * as crypto from "crypto";
import { sync } from "rimraf";
import { ChangeMetadata, HashStore, PackageJson, QuickCheckResult, FileHashResult } from "./types.js";
import { findFiles, getFileHash } from "./utils.js";

export async function cleanRelativeDepsCaches(targetDir: string, packageNames: string[]): Promise<void> {
  const cacheDir = path.join(targetDir, ".relative-deps-cache");

  if (fs.existsSync(cacheDir)) {
    // Clean specific package caches
    for (const name of packageNames) {
      const hashFile = path.join(cacheDir, `${name}.hash`);
      const metadataFile = path.join(cacheDir, `${name}.metadata.json`);

      if (fs.existsSync(hashFile)) fs.unlinkSync(hashFile);
      if (fs.existsSync(metadataFile)) fs.unlinkSync(metadataFile);
    }
  }

  // Also clean node_modules cache directories
  const nodeModulesCache = path.join(targetDir, "node_modules", ".cache");
  if (fs.existsSync(nodeModulesCache)) {
    sync(nodeModulesCache);
  }
}

export function clearModuleCache(packageName: string, targetDir: string): void {
  const packagePath = path.join(targetDir, "node_modules", packageName);

  // Clear Node.js module cache for this package
  // In ESM, we need to use a different approach since require.cache isn't available
  try {
    // This is a simplified approach - in pure ESM there's no direct equivalent to require.cache
    // We could use dynamic imports with cache busting, but for now we'll just log it
    console.log(`[relative-deps] Note: Module cache clearing not fully supported in ESM mode for ${packageName}`);
  } catch (error) {
    // Silently ignore cache clearing errors in ESM mode
  }
}

export async function createChangeMetadata(name: string, libDir: string): Promise<ChangeMetadata> {
  const packageJsonPath = path.join(libDir, "package.json");
  const packageJson: PackageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));

  // Get the most recent modification time of important files
  const importantFiles = [
    // Package files
    path.join(libDir, "package.json"),
    path.join(libDir, "package-lock.json"),
    path.join(libDir, "yarn.lock"),
    path.join(libDir, "pnpm-lock.yaml"),

    // Build configuration files
    path.join(libDir, "tsconfig.json"),
    path.join(libDir, "webpack.config.js"),
    path.join(libDir, "rollup.config.js"),
    path.join(libDir, "vite.config.js"),
    path.join(libDir, "vite.config.ts"),
    path.join(libDir, "babel.config.js"),
    path.join(libDir, ".babelrc"),
    path.join(libDir, "jest.config.js"),
    path.join(libDir, "vitest.config.js"),
    path.join(libDir, "vitest.config.ts"),

    // Source directories (just check if they exist and their mtime)
    path.join(libDir, "src"),
    path.join(libDir, "lib"),
    path.join(libDir, "dist")

  ].filter(f => fs.existsSync(f));

  let lastModified = 0;
  for (const file of importantFiles) {
    const stat = fs.statSync(file);
    lastModified = Math.max(lastModified, stat.mtimeMs);
  }

  // Include build script in the hash since it affects output
  const buildScript = packageJson.scripts?.build || "";

  // Simple hash of package.json dependencies and build configuration
  const configString = JSON.stringify({
    dependencies: packageJson.dependencies || {},
    devDependencies: packageJson.devDependencies || {},
    peerDependencies: packageJson.peerDependencies || {},
    buildScript,
    main: packageJson.main,
    module: packageJson.module,
    types: packageJson.types,
    exports: packageJson.exports
  });

  return {
    lastModified,
    packageVersion: packageJson.version || "0.0.0",
    dependencyHash: crypto.createHash("md5").update(configString).digest("hex")
  };
}

export async function quickChangeCheck(name: string, libDir: string, metadataFile: string, verbose: boolean): Promise<QuickCheckResult> {
  if (!fs.existsSync(metadataFile)) {
    return { hasChanges: true, reason: "No metadata file found" };
  }

  try {
    const savedMetadata: ChangeMetadata = JSON.parse(fs.readFileSync(metadataFile, "utf8"));
    const currentMetadata = await createChangeMetadata(name, libDir);

    // Check package version
    if (savedMetadata.packageVersion !== currentMetadata.packageVersion) {
      return { hasChanges: true, reason: `Package version changed: ${savedMetadata.packageVersion} → ${currentMetadata.packageVersion}` };
    }

    // Check dependency changes
    if (savedMetadata.dependencyHash !== currentMetadata.dependencyHash) {
      return { hasChanges: true, reason: "Package dependencies changed" };
    }

    // Check if any important files were modified recently
    if (currentMetadata.lastModified > savedMetadata.lastModified) {
      return { hasChanges: true, reason: "Important files modified" };
    }

    // Quick check passed, but we're not 100% sure
    return { hasChanges: false };

  } catch (error) {
    if (verbose) console.log("[relative-deps] Error reading metadata, falling back to full check:", error);
    return { hasChanges: true, reason: "Error reading metadata" };
  }
}

export async function computeFileHashes(libDir: string, targetDir: string, verbose: boolean): Promise<FileHashResult> {
  const libFiles = await findFiles(libDir, targetDir);
  const hashes: string[] = [];
  const changedFiles: string[] = [];

  if (verbose && libFiles.length > 100) {
    console.log(`[relative-deps] Computing hashes for ${libFiles.length} files...`);
  }

  for (const file of libFiles) {
    try {
      const hash = await getFileHash(path.join(libDir, file));
      hashes.push(hash);
    } catch (error) {
      if (verbose) console.log(`[relative-deps] Warning: Could not hash ${file}:`, error);
      changedFiles.push(file);
      hashes.push("ERROR");
    }
  }

  const contents = libFiles.map((file, index) => hashes[index] + " " + file).join("\n");

  return { contents, changedFiles };
}

export async function libraryHasChanged(name: string, libDir: string, targetDir: string, hashStore: HashStore, verbose: boolean = false): Promise<boolean> {
  // Store hashes in project root instead of node_modules to avoid cache issues
  const cacheDir = path.join(targetDir, ".relative-deps-cache");
  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }

  const hashFile = path.join(cacheDir, `${name}.hash`);
  const metadataFile = path.join(cacheDir, `${name}.metadata.json`);

  hashStore.file = hashFile;
  hashStore.metadataFile = metadataFile;

  // Quick check using metadata first
  const quickCheck = await quickChangeCheck(name, libDir, metadataFile, verbose);
  if (quickCheck.hasChanges && quickCheck.reason) {
    if (verbose) console.log(`[relative-deps] Quick check detected changes: ${quickCheck.reason}`);

    // Still compute full hash for storage
    const { contents } = await computeFileHashes(libDir, targetDir, verbose);
    hashStore.hash = contents;
    return true;
  }

  // Full hash comparison if quick check is inconclusive
  const referenceContents = fs.existsSync(hashFile) ? fs.readFileSync(hashFile, "utf8") : "";
  const { contents, changedFiles } = await computeFileHashes(libDir, targetDir, verbose);

  hashStore.hash = contents;

  if (contents === referenceContents) {
    if (verbose) console.log("[relative-deps] No changes detected");
    return false;
  }

  // Print which files changed
  if (verbose && changedFiles.length > 0) {
    console.log("[relative-deps] Changed files:", changedFiles.slice(0, 5).join(", "));
    if (changedFiles.length > 5) {
      console.log(`[relative-deps] ... and ${changedFiles.length - 5} more files`);
    }
  }

  return true;
}