import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    target: 'node18',
    outDir: 'dist',
    lib: {
      entry: {
        index: './src/index.ts',
        cli: './src/cli.ts'
      },
      formats: ['es'],
      fileName: (format, entryName) => `${entryName}.js`
    },
    rollupOptions: {
      external: [
        'checksum',
        'globby',
        'lodash',
        'read-pkg-up',
        'rimraf',
        'tar',
        'yargs',
        'yargs-parser',
        'yarn-or-npm',
        'fs',
        'path',
        'child_process',
        'execa',
        'node:module',
        'node:fs',
        'util',
        'assert',
        'url',
        'crypto'
      ],
      output: {
        preserveModules: false,
        format: 'es',
        banner: (chunk) => {
          if (chunk.fileName === 'cli.js') {
            return '#!/usr/bin/env node';
          }
          return '';
        }
      }
    },
    minify: false,
    sourcemap: true
  }
});