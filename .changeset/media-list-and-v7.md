---
"@dudousxd/nestjs-media-core": minor
"@dudousxd/nestjs-media-disk-s3": minor
"@dudousxd/nestjs-media-disk-local": minor
"@dudousxd/nestjs-media-testing": minor
"@dudousxd/nestjs-media-database-mikro-orm": minor
"@dudousxd/nestjs-media": minor
---

Add a driver-agnostic `list(prefix, options?)` to the `StorageDriver` contract (returns `{ folders, files, cursor? }`), implemented for the S3 (ListObjectsV2 with optional bucket override), local (readdir), and in-memory drivers, plus a `list` capability flag. The S3 `list` honours `options.bucket` for admin cross-bucket browsing. The MikroORM database adapter now supports MikroORM 7 (peer `^6 || ^7`).
