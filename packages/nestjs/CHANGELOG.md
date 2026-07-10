# @dudousxd/nestjs-media

## 0.7.0

### Minor Changes

- 74e9f4d: Three fixes for consumer friction on the upload controllers:

  - **`guards` option** on `MediaModule.forRoot`/`forRootAsync` — pass `guards: [YourGuard]` to gate all three upload controllers (tus, multipart, direct) uniformly, instead of reimplementing auth in a `NestMiddleware` because third-party controller classes can't take `@UseGuards`. On `forRootAsync` this is a STATIC field on the config object (not resolved via `useFactory`), since controllers/enhancers are wired at module-build time. **Uploads remain unauthenticated by default when `guards` is omitted — gate this module before exposing it.**
  - **`mount` option** on `forRootAsync` (`{ tus?, multipart?, direct? }`, default all `true`) — `forRootAsync` used to always mount all three controllers unconditionally, 501-ing the ones you never configured. Set the ones you don't use to `false` so they 404 instead of existing as dead, always-501 surface.
  - **Facade re-exports** — `@dudousxd/nestjs-media`'s `index.ts` now re-exports the error classes (`FileNotFoundError`, etc.), `ResumableUploadManager`, `mediaDiagnosticKey`, `MediaDiagnosticEvent`, `publishMedia`, and the storage-consumer/upload-session types (`StatResult`, `TemporaryUrlOptions`, `ListResult`, `ListEntry`, `ListOptions`, `MultipartPart`, `UploadSession`, `UploadSessionStore`, `UploadSessionListFilter`, `CreateUploadInput`) from `@dudousxd/nestjs-media-core`, so consumers no longer need a direct dependency on `-core` for these.

### Patch Changes

- Updated dependencies [74e9f4d]
  - @dudousxd/nestjs-media-core@0.7.0

## 0.6.8

### Patch Changes

- Updated dependencies [9901000]
  - @dudousxd/nestjs-media-core@0.6.7

## 0.6.7

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

- Updated dependencies [caa8eea]
  - @dudousxd/nestjs-media-core@0.6.3

## 0.6.3

### Patch Changes

- c883286: Add `MediaService.diskNames()` (delegates to `StorageManager.diskNames()`), so hosts can enumerate configured disks through the injectable `MediaService` without the `MEDIA_STORAGE` token.

## 0.6.2

### Patch Changes

- Updated dependencies [03d5b48]
  - @dudousxd/nestjs-media-core@0.6.2

## 0.6.1

### Patch Changes

- 7dccf2b: Add `MediaMultipartUploadController` with `PUT /media/uploads/:id/parts/:partNumber` (raw
  body → S3 multipart part), `POST /media/uploads/:id/complete`, and `GET /media/uploads/:id/parts`
  (for resume). Key/disk are resolved from the session id (server-derived, no client→S3 path).
  Mount a raw-body parser with a per-part cap on the parts route.
- Updated dependencies [28734af]
  - @dudousxd/nestjs-media-core@0.6.1

## 0.6.0

### Patch Changes

- Updated dependencies [b2f3d74]
  - @dudousxd/nestjs-media-core@0.6.0

## 0.5.1

### Patch Changes

- 39466b6: Document why `forRootAsync` always mounts both upload controllers and verify the uniform 501 NotImplemented behavior when tus/direct are unconfigured. Unlike `forRoot` (which knows its options at build time and mounts the controllers conditionally), `forRootAsync` resolves options later via `useFactory`, so it cannot mount conditionally; the controllers cleanly respond 501 via their nullable injected manager tokens. No behavior change.
- fcddaf0: Ship TanStack Intent agent skills (SKILL.md) inside the package.

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
