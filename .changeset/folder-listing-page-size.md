---
"@dudousxd/nestjs-media-core": patch
"@dudousxd/nestjs-media-disk-s3": patch
---

One page size for folder listings. `listFolderLevel()` returned 50 entries per page when it folded a flat listing but 1000 through the S3 side-car's `listFolders`. Both paths now use `limit`, or the new `DEFAULT_FOLDER_LISTING_LIMIT` (50) when absent, capped at `MAX_FOLDER_LISTING_LIMIT` (1000, S3's per-request maximum). `listFolderLevel()` passes the resolved `limit` to the side-car, `s3Multipart().listFolders()` defaults to 50 on its own, and a `limit` that is not a positive integer is a `RangeError` on every path. New export: `folderListingLimit()`.
