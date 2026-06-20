import { defineConfig } from 'tsup';

const external = [
  '@dudousxd/nestjs-media-core',
  '@nestjs/common',
  '@nestjs/core',
  'reflect-metadata',
  'rxjs',
];

export default defineConfig([
  {
    entry: ['src/index.ts', 'src/storage.ts'],
    format: ['esm'],
    dts: true,
    clean: true,
    splitting: false,
    sourcemap: true,
    outDir: 'dist',
    external,
  },
  {
    entry: ['src/index.ts', 'src/storage.ts'],
    format: ['cjs'],
    dts: true,
    clean: false,
    splitting: false,
    sourcemap: true,
    outDir: 'dist',
    external,
  },
]);
