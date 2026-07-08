---
"@dudousxd/nestjs-media-disk-s3": patch
---

`S3Driver.list()` now falls back to a SigV4-signed raw GET + manual XML parse when fast-xml-parser rejects valid entity references in the `ListObjectsV2` response (a failure mode for consumers pinning fast-xml-parser >= 5.7). Happy path unchanged.
