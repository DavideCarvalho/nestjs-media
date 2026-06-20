import { fileURLToPath } from 'node:url';
import swc from 'unplugin-swc';
import type { Plugin } from 'vitest/config';

const pkg = (name: string) =>
  fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url));

/** Resolve workspace packages to their TS source so cross-package tests never hit a stale dist/. */
export const alias: Record<string, string> = {
  '@dudousxd/nestjs-media-core': pkg('core'),
  '@dudousxd/nestjs-media-client': pkg('client'),
  '@dudousxd/nestjs-media-disk-local': pkg('disk-local'),
  '@dudousxd/nestjs-media-disk-s3': pkg('disk-s3'),
  '@dudousxd/nestjs-media-image-sharp': pkg('image-sharp'),
  '@dudousxd/nestjs-media-database-typeorm': pkg('database-typeorm'),
  '@dudousxd/nestjs-media-database-mikro-orm': pkg('database-mikro-orm'),
  '@dudousxd/nestjs-media-database-drizzle': pkg('database-drizzle'),
  '@dudousxd/nestjs-media-database-prisma': pkg('database-prisma'),
  '@dudousxd/nestjs-media-telescope': pkg('telescope'),
  '@dudousxd/nestjs-media-codegen': pkg('codegen'),
  '@dudousxd/nestjs-media-react': pkg('react'),
  '@dudousxd/nestjs-media-testing': pkg('testing'),
  '@dudousxd/nestjs-media': pkg('nestjs'),
};

/** SWC transform so NestJS decorator metadata works under Vitest (esbuild can't emit it). */
export const plugins: Plugin[] = [
  swc.vite({
    jsc: {
      target: 'es2022',
      parser: { syntax: 'typescript', decorators: true },
      transform: { legacyDecorator: true, decoratorMetadata: true },
    },
  }),
];

export const testBase = {
  globals: true,
  environment: 'node' as const,
  setupFiles: ['./vitest.setup.ts'],
};
