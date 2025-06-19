export interface HashStore {
  hash: string;
  file: string;
  metadataFile: string;
}

export interface Library {
  relPath: string;
  name: string;
  version: string;
}

export interface AddRelativeDepsOptions {
  paths?: string[];
  dev?: boolean;
  script?: string;
}

export interface InitRelativeDepsOptions {
  script?: string;
}

export interface InstallOptions {
  force?: boolean;
  clean?: boolean;
  verbose?: boolean;
}

export interface ChangeMetadata {
  lastModified: number;
  packageVersion: string;
  dependencyHash: string;
  buildHash?: string;
}

export interface PackageJson {
  name?: string;
  version?: string;
  main?: string;
  module?: string;
  types?: string;
  exports?: any;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  relativeDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
}

export interface QuickCheckResult {
  hasChanges: boolean;
  reason?: string;
}

export interface FileHashResult {
  contents: string;
  changedFiles: string[];
}