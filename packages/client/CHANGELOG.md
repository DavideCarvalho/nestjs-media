# @dudousxd/nestjs-media-client

## 0.3.1

### Patch Changes

- [#199](https://github.com/DavideCarvalho/nestjs-media/pull/199) [`fa191a3`](https://github.com/DavideCarvalho/nestjs-media/commit/fa191a3e7a982e71e23b8cdd9fd67deec3848437) Thanks [@DavideCarvalho](https://github.com/DavideCarvalho)! - Fix packages that could be published without files their `exports` point to. The two tsup passes (ESM, CJS) no longer each clean `dist/` while running at the same time; `dist/` is cleaned once before the build. A new `check:exports` step (also `prepack`) fails the release if any `exports`/`main`/`types` path is missing.

## 0.3.0

### Minor Changes

- 74e9f4d: Add an optional `getHeaders?: () => HeadersInit | Promise<HeadersInit>` option to
  `streamChunks`, `streamChunksParallel`, and the `uploadMedia`/`uploadMediaParallel` wrappers.
  It's resolved fresh before every request (each part PUT/PATCH, the complete POST, and the
  session-initiate call) and merged over the static `headers` option, with `getHeaders` values
  winning on key conflict. Use it to refresh short-lived bearer tokens that might expire during a
  long-running upload.

## 0.2.1

### Patch Changes

- 1951e24: Split `uploadMedia` into reusable `createSession` + `streamChunks`, add
  `streamChunksParallel` (concurrency-pooled part PUTs) and `uploadMediaParallel`, and a
  `headers` option so hosts can inject auth. `uploadMedia` behaviour is unchanged.
