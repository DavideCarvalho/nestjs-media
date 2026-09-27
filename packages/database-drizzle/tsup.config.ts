import { defineConfig } from 'tsup';

const external = ['@dudousxd/nestjs-media-core', 'drizzle-orm'];
// Root = sqlite/libSQL store; `/pg` = the Postgres store (`@dudousxd/nestjs-media-database-drizzle/pg`).
const entry = { index: 'src/index.ts', 'pg/index': 'src/pg/index.ts' };

export default defineConfig([
  {
    entry,
    format: ['esm'],
    dts: true,
    clean: true,
    splitting: false,
    sourcemap: true,
    outDir: 'dist',
    external,
  },
  {
    entry,
    format: ['cjs'],
    dts: true,
    clean: false,
    splitting: false,
    sourcemap: true,
    outDir: 'dist',
    external,
  },
]);
