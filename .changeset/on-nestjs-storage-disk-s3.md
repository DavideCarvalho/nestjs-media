---
"@dudousxd/nestjs-media-disk-s3": minor
---

**Breaking:** `S3Driver` is removed — store files on `@nestjs/storage`'s `S3Disk`. This package is now the side-car for what `S3Disk` keeps private: `s3Multipart(options)` takes the same `S3DiskOptions` object (so prefix, endpoint and addressing style line up) and implements `MultipartUploadDriver` (`createMultipartUpload`, `uploadPart`, `presignUploadPart`, `completeMultipartUpload`, `abortMultipartUpload`) plus `listFolders(prefix)` (`ListObjectsV2` with a delimiter). Over `fetch` + SigV4, like `S3Disk`: the `@aws-sdk/*` peers and the `@smithy/*` dependencies are gone. `hardenBodyStream` and the XML-entity fallback are removed with the driver.

`@dudousxd/nestjs-media-disk-local` is discontinued: use `LocalDisk` from `@nestjs/storage`.
