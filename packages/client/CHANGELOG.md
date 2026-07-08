# @dudousxd/nestjs-media-client

## 0.2.1

### Patch Changes

- 1951e24: Split `uploadMedia` into reusable `createSession` + `streamChunks`, add
  `streamChunksParallel` (concurrency-pooled part PUTs) and `uploadMediaParallel`, and a
  `headers` option so hosts can inject auth. `uploadMedia` behaviour is unchanged.
