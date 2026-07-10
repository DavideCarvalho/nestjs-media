# @dudousxd/nestjs-media-client

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
