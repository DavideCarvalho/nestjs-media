# @dudousxd/nestjs-media-disk-s3

## 1.0.0

### Patch Changes

- Updated dependencies [74e9f4d]
  - @dudousxd/nestjs-media-core@0.7.0

## 0.6.8

### Patch Changes

- Updated dependencies [9901000]
  - @dudousxd/nestjs-media-core@0.6.7

## 0.6.7

### Patch Changes

- Updated dependencies [70cba69]
  - @dudousxd/nestjs-media-core@0.6.6

## 0.6.6

### Patch Changes

- Updated dependencies [1410953]
  - @dudousxd/nestjs-media-core@0.6.5

## 0.6.5

### Patch Changes

- Updated dependencies [7c87433]
  - @dudousxd/nestjs-media-core@0.6.4

## 0.6.4

### Patch Changes

- caa8eea: `temporaryUrl()` gains an optional `TemporaryUrlOptions` argument (`responseContentType` / `responseContentDisposition`). The S3 driver maps these to the presigned GET's `response-content-type` / `response-content-disposition` overrides so a signed download can force a filename and content type. Backwards-compatible: the third argument is optional and existing 2-argument calls are unchanged.
- Updated dependencies [caa8eea]
  - @dudousxd/nestjs-media-core@0.6.3

## 0.6.3

### Patch Changes

- 76e953c: `S3Driver.list()` now falls back to a SigV4-signed raw GET + manual XML parse when fast-xml-parser rejects valid entity references in the `ListObjectsV2` response (a failure mode for consumers pinning fast-xml-parser >= 5.7). Happy path unchanged.

## 0.6.2

### Patch Changes

- 1d93957: Implement `S3Driver.stat()` (HeadObject) and `S3Driver.deleteMany()` (DeleteObjects, chunked at 1000 keys).
- Updated dependencies [03d5b48]
  - @dudousxd/nestjs-media-core@0.6.2

## 0.6.1

### Patch Changes

- Updated dependencies [28734af]
  - @dudousxd/nestjs-media-core@0.6.1

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

## 0.4.0

### Minor Changes

- be47230: Media diagnostics now publish through `@dudousxd/nestjs-diagnostics` (`aviary:media:*`), so any app using `@dudousxd/nestjs-diagnostics-telescope`'s generic watcher auto-captures media events (upload/attach/conversion/delete) with zero per-lib wiring. The standalone `MediaWatcher` is superseded by that bridge but kept for standalone use.

### Patch Changes

- Updated dependencies [be47230]
  - @dudousxd/nestjs-media-core@0.4.0

## 0.3.0

### Minor Changes

- 99777bb: Add a driver-agnostic `list(prefix, options?)` to the `StorageDriver` contract (returns `{ folders, files, cursor? }`), implemented for the S3 (ListObjectsV2 with optional bucket override), local (readdir), and in-memory drivers, plus a `list` capability flag. The S3 `list` honours `options.bucket` for admin cross-bucket browsing. The MikroORM database adapter now supports MikroORM 7 (peer `^6 || ^7`).

### Patch Changes

- Updated dependencies [99777bb]
  - @dudousxd/nestjs-media-core@0.3.0
