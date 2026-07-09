import { defineConfig } from 'tsup';

// The dashboard SERVER is a decorator-bearing NestJS module (@Module/@Injectable/@Controller/
// @Inject). It MUST emit dual ESM + CJS: a CJS host (`nest build` → CommonJS) that `require`s
// this package while also `require`ing `@dudousxd/nestjs-media` (MediaModule) must resolve both
// in the same module system, or the `Symbol.for(...)` media tokens would be looked up from a
// second, ESM copy of the graph. The DI tokens are `Symbol.for` (identity survives the ESM/CJS
// split), and every constructor param is an explicit `@Inject(...)`, so we do NOT rely on
// `emitDecoratorMetadata`/`design:paramtypes` — plain esbuild output is sufficient.
//
// `shims: true` provides an `import.meta.url` shim in the CJS build, which the UI controller uses
// (`new URL('../spa', import.meta.url)`) to locate the Vite SPA output (dist/spa). The SPA build
// (dist/spa via vite) and the client types (dist/client via tsc) are driven separately by the
// package `build` script.
const external = [
  '@dudousxd/nestjs-media-core',
  '@nestjs/common',
  '@nestjs/core',
  'rxjs',
  'reflect-metadata',
];

export default defineConfig([
  {
    entry: ['src/server/index.ts'],
    format: ['esm'],
    outDir: 'dist/server',
    dts: true,
    clean: true,
    splitting: false,
    sourcemap: true,
    shims: true,
    external,
    tsconfig: 'tsconfig.server.json',
  },
  {
    entry: ['src/server/index.ts'],
    format: ['cjs'],
    outDir: 'dist/server',
    dts: true,
    clean: false,
    splitting: false,
    sourcemap: true,
    shims: true,
    external,
    tsconfig: 'tsconfig.server.json',
  },
]);
