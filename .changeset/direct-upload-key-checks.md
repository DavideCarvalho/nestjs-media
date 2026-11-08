---
'@dudousxd/nestjs-media-core': patch
---

`DirectUploadManager.presignPart()`, `completeUpload()` and `abortUpload()` check the key with `assertMediaKey` before calling the multipart side-car, as `createUpload()` does.
