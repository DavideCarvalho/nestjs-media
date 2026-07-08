---
"@dudousxd/nestjs-media-upload-redis": patch
---

`RedisUploadSessionStore` implements `addPart`/`listParts` backed by a per-session
`…:<id>:parts` hash (atomic `HSET` per part number, out-of-order safe), TTL-bounded, and
removed with the session on `delete`. Enables the parallel multipart upload path.
