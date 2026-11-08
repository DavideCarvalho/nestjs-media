---
"@dudousxd/nestjs-media-testing": minor
---

**Breaking:** `InMemoryDriver` and `runStorageDriverConformance` are removed (use `InMemoryDisk` from `@nestjs/storage`). New `describeMediaDiskConformance(name, makeDisk, { multipart, prefix })` checks a `StorageDisk` (and optionally its multipart side-car) against what nestjs-media relies on; the repo runs it on `LocalDisk`, `InMemoryDisk` and `S3Disk` on MinIO. New `storageOf({ name: disk }, default?)` builds a `Storage` for unit tests. New peer `@nestjs/storage`.
