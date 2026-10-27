---
'@dudousxd/nestjs-media-core': patch
'@dudousxd/nestjs-media-disk-local': patch
'@dudousxd/nestjs-media-dashboard': patch
'@dudousxd/nestjs-media-upload-redis': patch
---

Cut memory and round trips on the upload and conversion paths:

- `ResumableUploadManager.complete()` on a disk without native multipart streams the parts, one at a time, into a single `put` instead of concatenating them in memory.
- `LocalDriver.put()` writes a stream to disk as it arrives (via a temp file renamed into place) instead of buffering it whole.
- Eager conversions during `attach()` read the original once (or not at all when it was passed as a Buffer) and save the record once, instead of a store lookup, a disk read and a save per preset.
- Concurrent `ensureConversion()` calls for the same media and conversion share one generation.
- The dashboard's folder delete uses the disk's `deleteMany` per listed page.
- `RedisUploadSessionStore.list()` no longer fails with `WRONGTYPE` when a session has recorded multipart parts, and reads sessions with one `MGET` per scan page (falling back to `GET` when the client has no `mget`).
