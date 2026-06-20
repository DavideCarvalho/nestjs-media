import { fileURLToPath } from 'node:url';
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

const pkg = (name: string) =>
  fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@dudousxd/nestjs-media-core': pkg('core'),
      '@dudousxd/nestjs-media-disk-local': pkg('disk-local'),
      '@dudousxd/nestjs-media-disk-s3': pkg('disk-s3'),
      '@dudousxd/nestjs-media-image-sharp': pkg('image-sharp'),
      '@dudousxd/nestjs-media-database-typeorm': pkg('database-typeorm'),
      '@dudousxd/nestjs-media-database-mikro-orm': pkg('database-mikro-orm'),
      '@dudousxd/nestjs-media-testing': pkg('testing'),
      '@dudousxd/nestjs-media': pkg('nestjs'),
    },
  },
  plugins: [
    swc.vite({
      jsc: {
        target: 'es2022',
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
      },
    }),
  ],
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./vitest.setup.ts'],
    include: ['packages/*/src/**/*.spec.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/*.db.spec.ts'],
  },
});
