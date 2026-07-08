# @dudousxd/nestjs-media-upload-redis

## 0.6.0

### Minor Changes

- b2f3d74: Proxy/tus uploads now stream each chunk into a native S3 multipart upload instead of buffering the whole file at `complete()`.

  - `ResumableUploadManager` uses the target disk's native multipart when `capabilities.multipart` is set: `createMultipartUpload` on start, one `uploadPart` per PATCH chunk (one chunk = one part), `completeMultipartUpload` on finish, `abortMultipartUpload` on abort. No whole-file `Buffer.concat` and no `get`-all read remain on the multipart path. Non-multipart disks (local, in-memory) keep the existing temp-object + concat behavior unchanged.
  - `disk-s3` gains a server-side `uploadPart(path, uploadId, partNumber, body)` for the proxy path (the presigned variant already existed for the direct path).
  - `RedisUploadSessionStore` now round-trips the new `multipartUploadId` / `partETags` session fields through `get()`, so multipart state survives a resume across replicas.

### Patch Changes

- Updated dependencies [b2f3d74]
  - @dudousxd/nestjs-media-core@0.6.0

## 0.5.0

### Minor Changes

- 05af5b4: Add presigned S3 multipart direct uploads (DirectUploadManager + MultipartUploadDriver surface + MediaDirectUploadController + MediaModule.direct option) and a Redis UploadSessionStore adapter (@dudousxd/nestjs-media-upload-redis) for multi-replica resumable proxy uploads. Both modes selectable via uploadMode.

### Patch Changes

- Updated dependencies [05af5b4]
  - @dudousxd/nestjs-media-core@0.5.0
