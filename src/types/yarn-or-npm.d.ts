declare module 'yarn-or-npm' {
  import { SpawnOptions, SpawnSyncOptions, SpawnSyncReturns, ChildProcess } from 'child_process';

  interface SpawnFunction {
    (...args: any[]): ChildProcess;
    sync: (...args: any[]) => SpawnSyncReturns<Buffer>;
  }

  interface YarnOrNpmFunction {
    (): 'yarn' | 'npm';
    hasYarn: () => boolean;
    hasNpm: () => boolean;
    spawn: SpawnFunction;
    clearCache: () => void;
  }

  const yarnOrNpm: YarnOrNpmFunction;
  export = yarnOrNpm;

  // Named exports for destructuring
  export const spawn: SpawnFunction;
  export const hasYarn: () => boolean;
  export const hasNpm: () => boolean;
  export const clearCache: () => void;
}