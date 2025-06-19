// Main entry point - re-exports from modular files
export { installRelativeDeps, watchRelativeDeps } from "./core.js";
export { initRelativeDeps, addRelativeDeps } from "./package.js";

// Re-export types for external use
export type {
  InstallOptions,
  AddRelativeDepsOptions,
  InitRelativeDepsOptions,
  PackageJson,
  HashStore,
  Library,
  ChangeMetadata
} from "./types.js";