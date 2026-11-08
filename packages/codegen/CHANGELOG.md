# @dudousxd/nestjs-media-codegen

## 0.2.2

### Patch Changes

- [#199](https://github.com/DavideCarvalho/nestjs-media/pull/199) [`fa191a3`](https://github.com/DavideCarvalho/nestjs-media/commit/fa191a3e7a982e71e23b8cdd9fd67deec3848437) Thanks [@DavideCarvalho](https://github.com/DavideCarvalho)! - Fix packages that could be published without files their `exports` point to. The two tsup passes (ESM, CJS) no longer each clean `dist/` while running at the same time; `dist/` is cleaned once before the build. A new `check:exports` step (also `prepack`) fails the release if any `exports`/`main`/`types` path is missing.

## 0.2.1

### Patch Changes

- 6bac081: The generated media client now also emits `uploadMediaParallel()` bound to the project's
  base path and re-exports `createSession`/`streamChunks`/`streamChunksParallel`.
