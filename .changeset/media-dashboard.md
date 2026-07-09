---
"@dudousxd/nestjs-media-core": patch
"@dudousxd/nestjs-media": patch
"@dudousxd/nestjs-media-telescope": patch
"@dudousxd/nestjs-media-database-mikro-orm": patch
"@dudousxd/nestjs-media-database-typeorm": patch
"@dudousxd/nestjs-media-database-prisma": patch
"@dudousxd/nestjs-media-database-drizzle": patch
"@dudousxd/nestjs-media-testing": patch
"@dudousxd/nestjs-media-upload-redis": patch
---

Add a Telescope media dashboard (`mediaTelescopeExtension()`) plus the SPI it needs.

- **core**: optional `list?()` on `ResumableUploadManager` (`UploadSessionListFilter`); optional `count?()`/`aggregate?()` on `MediaStore` (`MediaCountFilter`, `MediaAggregateQuery`, `MediaAggregateBucket`, `MediaAggregateResult`). All additions are optional — no breaking changes.
- **nestjs**: export `MEDIA_STORE`, `MEDIA_UPLOAD_SESSIONS`, `MEDIA_STORAGE_SHARED` DI tokens; wire the shared storage alias.
- **telescope**: new `mediaTelescopeExtension()` declarative extension — a `media.overview` dashboard with 12 data providers (in-progress uploads, active count, success rate, uploads/throughput over time, recent uploads, library totals, by-collection, storage-by-disk, storage writes over time, attachment activity, disks). Every provider degrades to an empty shape when the media module or an optional SPI method is absent (never throws).
- **database adapters** (mikro-orm, typeorm, prisma, drizzle): implement `count()`/`aggregate()` with supporting indexes. MikroORM uses a raw connection query with quoted aliases to avoid Postgres case-folding zeroing the aggregate sums.
- **testing / upload-redis**: in-memory + Redis implementations of the new SPI methods.

> Note: the new adapter indexes are created automatically for fresh tables. For already-deployed media tables, add a manual `CREATE INDEX` migration (see each adapter's index definition).
