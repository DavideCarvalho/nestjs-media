---
"@dudousxd/nestjs-media-client": patch
---

Split `uploadMedia` into reusable `createSession` + `streamChunks`, add
`streamChunksParallel` (concurrency-pooled part PUTs) and `uploadMediaParallel`, and a
`headers` option so hosts can inject auth. `uploadMedia` behaviour is unchanged.
