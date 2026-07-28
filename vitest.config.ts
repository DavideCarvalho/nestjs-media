import { defineConfig } from 'vitest/config';
import { alias, plugins, testBase } from './vitest.shared';

export default defineConfig({
  resolve: { alias },
  plugins,
  test: {
    ...testBase,
    // `.tsx` is in the glob because component specs are written as TSX; without it they are
    // collected by nothing and the suite still reports green.
    include: ['packages/*/src/**/*.spec.{ts,tsx}'],
    // `*.db.spec.ts` boot real infra via testcontainers — run them only via `pnpm test:db`.
    exclude: ['**/node_modules/**', '**/dist/**', '**/*.db.spec.ts'],
  },
});
