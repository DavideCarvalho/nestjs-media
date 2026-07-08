---
"@dudousxd/nestjs-media-core": patch
"@dudousxd/nestjs-media-disk-s3": patch
---

`temporaryUrl()` gains an optional `TemporaryUrlOptions` argument (`responseContentType` / `responseContentDisposition`). The S3 driver maps these to the presigned GET's `response-content-type` / `response-content-disposition` overrides so a signed download can force a filename and content type. Backwards-compatible: the third argument is optional and existing 2-argument calls are unchanged.
