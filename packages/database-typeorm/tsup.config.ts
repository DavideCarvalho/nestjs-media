import { defineConfig } from 'tsup';

const external = ['@dudousxd/nestjs-media-core', 'typeorm', '@nestjs/typeorm'];

export default defineConfig([
  {
    entry: { index: 'src/index.ts', 'nest/index': 'src/nest/index.ts' },
    format: ['esm'],
    dts: true,
    clean: true,
    splitting: false,
    sourcemap: true,
    outDir: 'dist',
    external,
  },
  {
    entry: { index: 'src/index.ts', 'nest/index': 'src/nest/index.ts' },
    format: ['cjs'],
    dts: true,
    clean: false,
    splitting: false,
    sourcemap: true,
    outDir: 'dist',
    external,
  },
]);
