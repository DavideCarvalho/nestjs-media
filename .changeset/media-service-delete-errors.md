---
'@dudousxd/nestjs-media': patch
---

`MediaService.delete()` is a no-op only for a missing record: other store failures now propagate instead of reporting success, and without a `store` it throws the same "MediaLibrary is not configured" error as `library`.
