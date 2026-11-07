---
"@dudousxd/nestjs-media": minor
---

**Breaking:** `MediaModule` runs on `StorageModule` from `@nestjs/storage` (new peer `>=0.0.5 <0.1.0`; Nest peer floor `^12.1`, which `@nestjs/storage` requires).

- `default` and `disks` are removed from `MediaModuleOptions`: register `StorageModule.forRoot({ default, disks })`. `MediaModule` injects `Storage` and fails at boot, naming `StorageModule`, when it's missing.
- New `multipart?: Record<disk, MultipartUploadDriver>` (e.g. `{ s3: s3Multipart(opts) }`); a name that isn't a `StorageModule` disk fails at boot. Direct uploads need one.
- `store` and `uploadSessions` accept `{ inject, useFactory }` (static on `forRootAsync`), e.g. `typeOrmMediaStore({ connectionName })`. `forRootAsync`'s factory now runs once.
- New `MediaService.serve(id, conversion, { req, res, ... })` through `serveFile()` (Range, ETag/304, nosniff, safe inline), plus `url()`, `attach()`, `delete()`; the optional `authorize(user, action, record)` hook checks them (`read` / `attach` / `delete`).
- Removed: `MediaService.disk()` / `diskNames()`, the `MEDIA_STORAGE` and `MEDIA_STORAGE_SHARED` tokens, the `@dudousxd/nestjs-media/storage` entry, the `FileNotFoundError` / `UnknownDiskError` / storage-type re-exports. New `MEDIA_MULTIPART` token (`Symbol.for('nestjs-media:multipart')`).
- The direct-upload routes answer 400 for a key `@nestjs/storage` would refuse.
- The `raw-storage` skill is removed (raw storage is `@nestjs/storage`); `media-module-setup` and `resumable-and-direct-uploads` are updated.
