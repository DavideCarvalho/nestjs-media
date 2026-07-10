# @dudousxd/nestjs-media-core

## 0.7.0

### Minor Changes

- 74e9f4d: `StorageDriver.stat` is now a required method instead of optional. Every bundled driver
  (disk-s3, disk-local, testing's in-memory driver) already implemented it, so this only affects
  third-party `StorageDriver` implementations — add a `stat(path): Promise<StatResult>` method to
  your driver to stay compatible. `deleteMany` remains optional.

## 0.6.7

### Patch Changes

- 9901000: Add `@dudousxd/nestjs-media-dashboard` — a standalone, navigable `/media` console.

  A self-mounting React SPA + JSON API (like `@dudousxd/nestjs-durable-dashboard`) for browsing storage disks and their object tree, watching live resumable uploads, and browsing the media library by collection with variant thumbnails. Mount with `MediaDashboardModule.forRoot({ basePath, apiBasePath, actions })`; depends only on `-core` and resolves the media tokens by value, degrading to empty shapes when a `MediaStore`/upload store is absent (never throws). Destructive actions (delete/copy/move object, delete record, cancel session) are gated behind `actions: true` (default off). No built-in auth — the host guards the mount.

  Note on "Cancel session": it removes the resumable session record from the upload store (so it stops showing as in-progress) but does NOT tear down an underlying native multipart upload — the decoupled console resolves only the `UploadSessionStore`, not the `ResumableUploadManager` that owns `abort()`. An incomplete multipart is reaped by the bucket lifecycle policy.

  Supporting SPI added to enable the console (all optional/additive — non-breaking):

  - **core**: `MediaStore.list?(filter, page)` — paginated global record listing with an opaque `(createdAt, id)` keyset cursor (`MediaListFilter`/`MediaListPage`/`MediaListResult`); `UploadSession.createdAt?` for upload age.
  - **database adapters** (mikro-orm, typeorm, prisma, drizzle): implement `list()` with a `(collection, createdAt, id)` index. For already-deployed tables add a manual `CREATE INDEX` migration.
  - **upload-redis / testing**: set `createdAt` on session create; in-memory `MediaStore.list()`.

## 0.6.6

### Patch Changes

- 70cba69: Add a Telescope media dashboard (`mediaTelescopeExtension()`) plus the SPI it needs.

  - **core**: optional `list?()` on `ResumableUploadManager` (`UploadSessionListFilter`); optional `count?()`/`aggregate?()` on `MediaStore` (`MediaCountFilter`, `MediaAggregateQuery`, `MediaAggregateBucket`, `MediaAggregateResult`). All additions are optional — no breaking changes.
  - **nestjs**: export `MEDIA_STORE`, `MEDIA_UPLOAD_SESSIONS`, `MEDIA_STORAGE_SHARED` DI tokens; wire the shared storage alias.
  - **telescope**: new `mediaTelescopeExtension()` declarative extension — a `media.overview` dashboard with 12 data providers (in-progress uploads, active count, success rate, uploads/throughput over time, recent uploads, library totals, by-collection, storage-by-disk, storage writes over time, attachment activity, disks). Every provider degrades to an empty shape when the media module or an optional SPI method is absent (never throws).
  - **database adapters** (mikro-orm, typeorm, prisma, drizzle): implement `count()`/`aggregate()` with supporting indexes. MikroORM uses a raw connection query with quoted aliases to avoid Postgres case-folding zeroing the aggregate sums.
  - **testing / upload-redis**: in-memory + Redis implementations of the new SPI methods.

  > Note: the new adapter indexes are created automatically for fresh tables. For already-deployed media tables, add a manual `CREATE INDEX` migration (see each adapter's index definition).

## 0.6.5

### Patch Changes

- 1410953: Add optional `id` to `AttachmentManager.createFromFile` options: a caller-supplied id segment replaces the generated UUID in the key, enabling deterministic, idempotent-overwrite paths (e.g. durable steps that re-render the same file).

## 0.6.4

### Patch Changes

- 7c87433: Export `mediaDiagnosticKey(event)` and the `MediaDiagnosticKey` type — the typed `media:<event>` telescope key (the exact key `@dudousxd/nestjs-diagnostics-telescope`'s `exclude` option matches against). The library owns the `media` lib name, so it owns the composed key; callers get a compile error on a misspelled event instead of a silently-non-matching magic string.

## 0.6.3

### Patch Changes

- caa8eea: `temporaryUrl()` gains an optional `TemporaryUrlOptions` argument (`responseContentType` / `responseContentDisposition`). The S3 driver maps these to the presigned GET's `response-content-type` / `response-content-disposition` overrides so a signed download can force a filename and content type. Backwards-compatible: the third argument is optional and existing 2-argument calls are unchanged.

## 0.6.2

### Patch Changes

- 03d5b48: Add `StatResult` and optional `StorageDriver.stat()` / `StorageDriver.deleteMany()` members, plus `StorageManager.diskNames()`. Optional members keep this non-breaking.

## 0.6.1

### Patch Changes

- 28734af: Add `ResumableUploadManager.writePart(id, partNumber, chunk)` and `listParts(id)` for a
  proxy-parallel multipart upload path, plus optional `addPart`/`listParts` on
  `UploadSessionStore`. `complete()` now orders parts ascending by `partNumber`. The
  sequential tus path is unchanged.

## 0.6.0

### Minor Changes

- b2f3d74: Proxy/tus uploads now stream each chunk into a native S3 multipart upload instead of buffering the whole file at `complete()`.

  - `ResumableUploadManager` uses the target disk's native multipart when `capabilities.multipart` is set: `createMultipartUpload` on start, one `uploadPart` per PATCH chunk (one chunk = one part), `completeMultipartUpload` on finish, `abortMultipartUpload` on abort. No whole-file `Buffer.concat` and no `get`-all read remain on the multipart path. Non-multipart disks (local, in-memory) keep the existing temp-object + concat behavior unchanged.
  - `disk-s3` gains a server-side `uploadPart(path, uploadId, partNumber, body)` for the proxy path (the presigned variant already existed for the direct path).
  - `RedisUploadSessionStore` now round-trips the new `multipartUploadId` / `partETags` session fields through `get()`, so multipart state survives a resume across replicas.

## 0.5.0

### Minor Changes

- 05af5b4: Add presigned S3 multipart direct uploads (DirectUploadManager + MultipartUploadDriver surface + MediaDirectUploadController + MediaModule.direct option) and a Redis UploadSessionStore adapter (@dudousxd/nestjs-media-upload-redis) for multi-replica resumable proxy uploads. Both modes selectable via uploadMode.

## 0.4.0

### Minor Changes

- be47230: Media diagnostics now publish through `@dudousxd/nestjs-diagnostics` (`aviary:media:*`), so any app using `@dudousxd/nestjs-diagnostics-telescope`'s generic watcher auto-captures media events (upload/attach/conversion/delete) with zero per-lib wiring. The standalone `MediaWatcher` is superseded by that bridge but kept for standalone use.

## 0.3.0

### Minor Changes

- 99777bb: Add a driver-agnostic `list(prefix, options?)` to the `StorageDriver` contract (returns `{ folders, files, cursor? }`), implemented for the S3 (ListObjectsV2 with optional bucket override), local (readdir), and in-memory drivers, plus a `list` capability flag. The S3 `list` honours `options.bucket` for admin cross-bucket browsing. The MikroORM database adapter now supports MikroORM 7 (peer `^6 || ^7`).
