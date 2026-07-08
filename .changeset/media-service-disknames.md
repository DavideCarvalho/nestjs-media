---
"@dudousxd/nestjs-media": patch
---

Add `MediaService.diskNames()` (delegates to `StorageManager.diskNames()`), so hosts can enumerate configured disks through the injectable `MediaService` without the `MEDIA_STORAGE` token.
