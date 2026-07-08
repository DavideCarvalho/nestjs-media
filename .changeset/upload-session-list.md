---
"@dudousxd/nestjs-media-upload-redis": minor
---

Add `RedisUploadSessionStore.list(filter?)` to enumerate the currently-stored (in-progress) upload sessions, optionally filtered by `disk` and/or `keyPrefix` — for admin-facing "uploads in progress" views. It scans keys under the store's prefix, so it requires a redis client with a `scan` method (ioredis has one); `MinimalRedis.scan` is optional, so existing minimal adapters keep compiling. No change to the core `UploadSessionStore` interface.
