import { defineConfig } from 'tsup';

const external = ['@dudousxd/nestjs-media-core', 'drizzle-orm', '@nestjs/drizzle'];
// Root = sqlite/libSQL store; `/pg` = the Postgres store; `/nest` = factories on @nestjs/drizzle.
const entry = {
  index: 'src/index.ts',
  'pg/index': 'src/pg/index.ts',
  'nest/index': 'src/nest/index.ts',
};

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
