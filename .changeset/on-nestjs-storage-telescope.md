---
"@dudousxd/nestjs-media-telescope": minor
---

`media.disks` reads the disks from `@nestjs/storage`'s `Storage` (new peer) and the multipart side-cars, and computes the badges with core's `diskCapabilities()`. The rows keep their shape (`name`, `default`, `presign`, `multipart`, `publicUrls`, `list`). `MEDIA_STORAGE_SHARED` is replaced by `MEDIA_MULTIPART`.
