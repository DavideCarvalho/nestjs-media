# @dudousxd/nestjs-media-database-typeorm

## 1.0.0

### Patch Changes

- Updated dependencies [8852c83]
  - @dudousxd/nestjs-media-core@0.8.0

## 0.5.8

### Patch Changes

- Updated dependencies [74e9f4d]
  - @dudousxd/nestjs-media-core@0.7.0

## 0.5.7

### Patch Changes

- 9901000: Add `@dudousxd/nestjs-media-dashboard` — a standalone, navigable `/media` console.

  A self-mounting React SPA + JSON API (like `@dudousxd/nestjs-durable-dashboard`) for browsing storage disks and their object tree, watching live resumable uploads, and browsing the media library by collection with variant thumbnails. Mount with `MediaDashboardModule.forRoot({ basePath, apiBasePath, actions })`; depends only on `-core` and resolves the media tokens by value, degrading to empty shapes when a `MediaStore`/upload store is absent (never throws). Destructive actions (delete/copy/move object, delete record, cancel session) are gated behind `actions: true` (default off). No built-in auth — the host guards the mount.

  Note on "Cancel session": it removes the resumable session record from the upload store (so it stops showing as in-progress) but does NOT tear down an underlying native multipart upload — the decoupled console resolves only the `UploadSessionStore`, not the `ResumableUploadManager` that owns `abort()`. An incomplete multipart is reaped by the bucket lifecycle policy.

  Supporting SPI added to enable the console (all optional/additive — non-breaking):

  - **core**: `MediaStore.list?(filter, page)` — paginated global record listing with an opaque `(createdAt, id)` keyset cursor (`MediaListFilter`/`MediaListPage`/`MediaListResult`); `UploadSession.createdAt?` for upload age.
  - **database adapters** (mikro-orm, typeorm, prisma, drizzle): implement `list()` with a `(collection, createdAt, id)` index. For already-deployed tables add a manual `CREATE INDEX` migration.
  - **upload-redis / testing**: set `createdAt` on session create; in-memory `MediaStore.list()`.

- Updated dependencies [9901000]
  - @dudousxd/nestjs-media-core@0.6.7

## 0.5.6

### Patch Changes

- 70cba69: Add a Telescope media dashboard (`mediaTelescopeExtension()`) plus the SPI it needs.

  - **core**: optional `list?()` on `ResumableUploadManager` (`UploadSessionListFilter`); optional `count?()`/`aggregate?()` on `MediaStore` (`MediaCountFilter`, `MediaAggregateQuery`, `MediaAggregateBucket`, `MediaAggregateResult`). All additions are optional — no breaking changes.
  - **nestjs**: export `MEDIA_STORE`, `MEDIA_UPLOAD_SESSIONS`, `MEDIA_STORAGE_SHARED` DI tokens; wire the shared storage alias.
  - **telescope**: new `mediaTelescopeExtension()` declarative extension — a `media.overview` dashboard with 12 data providers (in-progress uploads, active count, success rate, uploads/throughput over time, recent uploads, library totals, by-collection, storage-by-disk, storage writes over time, attachment activity, disks). Every provider degrades to an empty shape when the media module or an optional SPI method is absent (never throws).
  - **database adapters** (mikro-orm, typeorm, prisma, drizzle): implement `count()`/`aggregate()` with supporting indexes. MikroORM uses a raw connection query with quoted aliases to avoid Postgres case-folding zeroing the aggregate sums.
  - **testing / upload-redis**: in-memory + Redis implementations of the new SPI methods.

  > Note: the new adapter indexes are created automatically for fresh tables. For already-deployed media tables, add a manual `CREATE INDEX` migration (see each adapter's index definition).

- Updated dependencies [70cba69]
  - @dudousxd/nestjs-media-core@0.6.6

## 0.5.5

### Patch Changes

- Updated dependencies [1410953]
  - @dudousxd/nestjs-media-core@0.6.5

## 0.5.4

### Patch Changes

- Updated dependencies [7c87433]
  - @dudousxd/nestjs-media-core@0.6.4

## 0.5.3

### Patch Changes

- Updated dependencies [caa8eea]
  - @dudousxd/nestjs-media-core@0.6.3

## 0.5.2

### Patch Changes

- Updated dependencies [03d5b48]
  - @dudousxd/nestjs-media-core@0.6.2

## 0.5.1

### Patch Changes

- Updated dependencies [28734af]
  - @dudousxd/nestjs-media-core@0.6.1

## 0.5.0

### Patch Changes

- Updated dependencies [05af5b4]
  - @dudousxd/nestjs-media-core@0.5.0

## 0.4.0

### Patch Changes

- Updated dependencies [be47230]
  - @dudousxd/nestjs-media-core@0.4.0

## 0.3.0

### Patch Changes

- Updated dependencies [99777bb]
  - @dudousxd/nestjs-media-core@0.3.0
