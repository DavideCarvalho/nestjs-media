---
"@dudousxd/nestjs-media-dashboard": minor
"@dudousxd/nestjs-media-core": patch
"@dudousxd/nestjs-media-database-mikro-orm": patch
"@dudousxd/nestjs-media-database-typeorm": patch
"@dudousxd/nestjs-media-database-prisma": patch
"@dudousxd/nestjs-media-database-drizzle": patch
"@dudousxd/nestjs-media-testing": patch
"@dudousxd/nestjs-media-upload-redis": patch
---

Add `@dudousxd/nestjs-media-dashboard` — a standalone, navigable `/media` console.

A self-mounting React SPA + JSON API (like `@dudousxd/nestjs-durable-dashboard`) for browsing storage disks and their object tree, watching live resumable uploads, and browsing the media library by collection with variant thumbnails. Mount with `MediaDashboardModule.forRoot({ basePath, apiBasePath, actions })`; depends only on `-core` and resolves the media tokens by value, degrading to empty shapes when a `MediaStore`/upload store is absent (never throws). Destructive actions (delete/copy/move object, delete record, abort upload) are gated behind `actions: true` (default off). No built-in auth — the host guards the mount.

Supporting SPI added to enable the console (all optional/additive — non-breaking):

- **core**: `MediaStore.list?(filter, page)` — paginated global record listing with an opaque `(createdAt, id)` keyset cursor (`MediaListFilter`/`MediaListPage`/`MediaListResult`); `UploadSession.createdAt?` for upload age.
- **database adapters** (mikro-orm, typeorm, prisma, drizzle): implement `list()` with a `(collection, createdAt, id)` index. For already-deployed tables add a manual `CREATE INDEX` migration.
- **upload-redis / testing**: set `createdAt` on session create; in-memory `MediaStore.list()`.
