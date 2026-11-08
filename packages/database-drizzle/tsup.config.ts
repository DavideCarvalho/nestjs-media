import { rmSync } from 'node:fs';
import { defineConfig } from 'tsup';

const external = ['@dudousxd/nestjs-media-core', 'drizzle-orm', '@nestjs/drizzle'];
// Root = sqlite/libSQL store; `/pg` = the Postgres store; `/nest` = factories on @nestjs/drizzle.
const entry = {
  index: 'src/index.ts',
  'pg/index': 'src/pg/index.ts',
  'nest/index': 'src/nest/index.ts',
};

// tsup builds the entries of a config array concurrently, so a per-entry `clean: true` races the
// other passes and can delete files they already wrote (e.g. `index.d.cts`, seen under a loaded
// `turbo run build`). Clean the output directory once, before any pass starts, and let no entry
// clean. `scripts/check-package-exports.mjs` (prepack) fails the pack if an entry is still missing.
rmSync(new URL('./dist/', import.meta.url), { recursive: true, force: true });

export default defineConfig([
  {
    entry,
    format: ['esm'],
    dts: true,
    clean: false,
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
