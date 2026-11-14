# @dudousxd/nestjs-media-core

## 0.14.0

### Minor Changes

- [#218](https://github.com/DavideCarvalho/nestjs-media/pull/218) [`61ddb58`](https://github.com/DavideCarvalho/nestjs-media/commit/61ddb5854f618b4525e37d2c117d0b4b2455f890) Thanks [@DavideCarvalho](https://github.com/DavideCarvalho)! - `MediaStore` gains an optional `isListCursor(cursor)`: whether a cursor is one `list()` could have returned. `list()` itself still reads a cursor it cannot decode as "no cursor" and starts from the first page; a caller that must tell a forged cursor apart asks first. Every bundled store (in-memory, Drizzle SQLite/Postgres, MikroORM, Prisma, TypeORM) implements it, and the store conformance suite checks it when a store has it. Optional and additive: a third-party store without it keeps working as before.

## 0.13.0

### Minor Changes

- [#212](https://github.com/DavideCarvalho/nestjs-media/pull/212) [`126491c`](https://github.com/DavideCarvalho/nestjs-media/commit/126491c43d607a5f535eb07d32d9a9015c375d6c) Thanks [@DavideCarvalho](https://github.com/DavideCarvalho)! - Global search across the Aviary consoles. A console entry may expose `search(context, q, limit)`; `GET <api>/consoles/search?q=` fans out to this console and every other console the viewer may open (300 ms and 5 hits each, `partial: true` when one did not answer). The media console searches files: a library record by exact id, library records whose name or file name contains the text (by the request's tenant), and disk objects whose key starts with it (only when no tenant scope applies). The console gets a Ctrl/Cmd-K search palette, a Search button and a "Search all consoles" item in the switcher menu; hits open the record (`#/library/<id>`) or the file preview. While the switcher runs another console's `authorize`, the request carries `aviaryProbe = true`, so an auditing authorizer can skip it.

  `MediaListFilter` gains `nameContains` (name or file name contains the text, ignoring case), implemented by every bundled store and checked by `runMediaStoreConformance`; core exports `matchesNameContains` and `nameContainsPattern` for custom stores.

- [#212](https://github.com/DavideCarvalho/nestjs-media/pull/212) [`126491c`](https://github.com/DavideCarvalho/nestjs-media/commit/126491c43d607a5f535eb07d32d9a9015c375d6c) Thanks [@DavideCarvalho](https://github.com/DavideCarvalho)! - The full tenancy contract of `@dudousxd/nestjs-context` (2.1+), feature-detected so older contexts keep working. Media's reader is now the context's reference reader, so `tenancy.kinds` scopes by the matching level of a nested tenant chain (`kinds: ['clinic']` stamps and reads the clinic of a unit), and the `tenancy` option gains `family` and `required` (a read or write with no tenant throws the context's `TenantRequiredError`, 403; the boot check never does). New `tenancy.pathPrefix` (default `false`): new library files of a tenant are stored under `t/<tenantId>/`; existing files never move. The console shows each library record's and upload session's organization (`tenant: { id, label }`, labelled by the context's `tenancy.label`, else the id), and with `pathPrefix` a tenant's disk browsing (the object browser, its dev tools and the search) is confined to its own `t/<tenantId>/`: any other key, pre-prefix ones and `..`/encoded/absolute escapes included, is a 404, while a viewer of every tenant still sees every key. The search answers no hits instead of failing when a tenant is required. Core exports `tenantLabels`, `tenantPathPrefix` and the `MediaTenantLevel` type.

## 0.12.0

### Minor Changes

- [#211](https://github.com/DavideCarvalho/nestjs-media/pull/211) [`8f3315e`](https://github.com/DavideCarvalho/nestjs-media/commit/8f3315e3ba7c4825a51dbf413e1a9615a058312b) Thanks [@DavideCarvalho](https://github.com/DavideCarvalho)! - Require Node.js 24 or newer: `engines.node` is now `>=24` (was `>=20`, or unset). CI tests on Node 24 and 26. Upgrade Node, then the packages.

  **Breaking (`@dudousxd/nestjs-media-core`):** the `MediaDiagnosticEnvelope` type, kept only for code written against the old media-specific envelope, is removed. Type a message from an `aviary:media:<event>` channel as `DiagnosticEvent` from `@dudousxd/nestjs-diagnostics` (same shape). See the docs' Upgrading page.

## 0.11.0

### Minor Changes

- [#209](https://github.com/DavideCarvalho/nestjs-media/pull/209) [`d42f192`](https://github.com/DavideCarvalho/nestjs-media/commit/d42f19226f93952584e162cef614d72a8960e967) Thanks [@DavideCarvalho](https://github.com/DavideCarvalho)! - Media follows the request's tenant from `@dudousxd/nestjs-context` (opt-in, off by default).

  - `MediaModule.forRoot({ tenancy })`: `'inherit'` (default, follows `ContextModule`'s `tenancy.enabled`), `false`, or `{ enabled, kinds, nullRows }`.
  - With tenancy on, `attach` and resumable uploads stamp the tenant (an explicit `tenantId` wins); `library.get/list/locate/url`, conversions, `MediaService.serve/url/delete`, upload sessions and the dashboard's library and uploads views apply the matching rule on top of `authorize`. A record or session of another tenant is not found (404), never 403.
  - Every store gains a nullable `tenant_id` (TypeORM, MikroORM, Drizzle sqlite/pg incl. upload sessions, the Prisma model docs) with an index, and `enableTenancy()`. With tenancy on and the column missing, the boot fails with `MediaTenancyUnavailableError` and the fix. With tenancy off, the column is never read or written.
  - Hidden or missing behaves the same: `library.delete()`, `MediaService.delete()` and upload `abort()` are a silent no-op. With tenancy on, the dashboard's delete record and cancel upload are a 404, whether the id belongs to another tenant or doesn't exist.
  - A store's `save` (and the Drizzle pg session store's `create`/`update`) returns the `tenantId` it persisted: none while tenancy is off. TypeORM writes the row and its tenant in one transaction.
  - New `library.get(id)`. Docs: the Tenancy page, with backfill SQL.

## 0.10.1

### Patch Changes

- [#203](https://github.com/DavideCarvalho/nestjs-media/pull/203) [`5f7e5ba`](https://github.com/DavideCarvalho/nestjs-media/commit/5f7e5ba932b980d15589b4902be48854c60af76a) Thanks [@DavideCarvalho](https://github.com/DavideCarvalho)! - Accept the current `@dudousxd/nestjs-diagnostics` and `@dudousxd/nestjs-telescope` releases. `@dudousxd/nestjs-media-core` depends on `@dudousxd/nestjs-diagnostics` `>=0.7.0 <1.0.0` instead of the exact `0.7.2`, so an app on 0.8.0 shares one copy instead of installing a second one. `@dudousxd/nestjs-media-telescope`'s peers are now diagnostics `>=0.7.0 <1.0.0` (was `^0.7.0`) and telescope `^1.0.0 || ^2.0.0` (was `^1.0.0`).

## 0.10.0

### Minor Changes

- [#199](https://github.com/DavideCarvalho/nestjs-media/pull/199) [`fa191a3`](https://github.com/DavideCarvalho/nestjs-media/commit/fa191a3e7a982e71e23b8cdd9fd67deec3848437) Thanks [@DavideCarvalho](https://github.com/DavideCarvalho)! - **Breaking:** the media layer runs on the disks of NestJS's first-party `@nestjs/storage` (new peer, `>=0.0.5 <0.1.0`, type-only in core).

  - `MediaLibrary`, `AttachmentManager`, `ResumableUploadManager`, `DirectUploadManager` and the tus handler take `storage: Storage` (or any `MediaDisks`: `disk(name)`, `names()`, `defaultDisk`) and use `StorageDisk`'s `put`/`getBuffer`/`get().body`/`delete([...])`/`url`/`signedUrl`.
  - Removed, with no shims: `StorageManager`, `StorageManagerOptions`, `StorageDriver`, `DriverCapabilities`, `PutOptions`, `ListOptions`, `ListResult`, `ListEntry`, `StatResult`, `ReadRangeOptions`, `TemporaryUrlOptions`, `Visibility`, `isMultipartCapable`, `collectStream`, `FileNotFoundError`, `UnknownDiskError`, `AttachmentManager.temporaryUrl`.
  - Native multipart is a per-disk side-car: `MultipartUploadDriver` (optional `listFolders`) passed as `multipart: { [disk]: driver }` to the upload managers; `multipartFor()`, `requireMultipart()`.
  - New: `diskCapabilities(disk, sidecar)`, `listFolderLevel()` / `foldListing()` (one folder level from a flat listing, cursor-paged without repeats), `keySegment()` / `assertMediaKey()` / `folderPrefix()` / `InvalidMediaKeyError` (the `@nestjs/storage` key rule), `fileUrl()`, `MediaLibrary.locate()`, `AttachmentManager.signedUrl()`.
  - `MediaLibrary.url()` and `AttachmentManager.url()` return the public URL when the disk has a `publicUrl`, else a signed one.
  - Keys built from user input (file names, owner ids, the default tus key) go through `keySegment()`; ordinary names are unchanged. A custom tus `keyFor` returning an invalid key answers 400. Resumable assembly passes the received byte count as `contentLength`.
  - `resolveUploadMode()` takes `{ presign, multipart }` (`MediaDiskCapabilities`).

### Patch Changes

- [#199](https://github.com/DavideCarvalho/nestjs-media/pull/199) [`fa191a3`](https://github.com/DavideCarvalho/nestjs-media/commit/fa191a3e7a982e71e23b8cdd9fd67deec3848437) Thanks [@DavideCarvalho](https://github.com/DavideCarvalho)! - Fix packages that could be published without files their `exports` point to. The two tsup passes (ESM, CJS) no longer each clean `dist/` while running at the same time; `dist/` is cleaned once before the build. A new `check:exports` step (also `prepack`) fails the release if any `exports`/`main`/`types` path is missing.

- [#199](https://github.com/DavideCarvalho/nestjs-media/pull/199) [`fa191a3`](https://github.com/DavideCarvalho/nestjs-media/commit/fa191a3e7a982e71e23b8cdd9fd67deec3848437) Thanks [@DavideCarvalho](https://github.com/DavideCarvalho)! - `DirectUploadManager.presignPart()`, `completeUpload()` and `abortUpload()` check the key with `assertMediaKey` before calling the multipart side-car, as `createUpload()` does.

- [#199](https://github.com/DavideCarvalho/nestjs-media/pull/199) [`fa191a3`](https://github.com/DavideCarvalho/nestjs-media/commit/fa191a3e7a982e71e23b8cdd9fd67deec3848437) Thanks [@DavideCarvalho](https://github.com/DavideCarvalho)! - One page size for folder listings. `listFolderLevel()` returned 50 entries per page when it folded a flat listing but 1000 through the S3 side-car's `listFolders`. Both paths now use `limit`, or the new `DEFAULT_FOLDER_LISTING_LIMIT` (50) when absent, capped at `MAX_FOLDER_LISTING_LIMIT` (1000, S3's per-request maximum). `listFolderLevel()` passes the resolved `limit` to the side-car, `s3Multipart().listFolders()` defaults to 50 on its own, and a `limit` that is not a positive integer is a `RangeError` on every path. New export: `folderListingLimit()`.

- [#199](https://github.com/DavideCarvalho/nestjs-media/pull/199) [`fa191a3`](https://github.com/DavideCarvalho/nestjs-media/commit/fa191a3e7a982e71e23b8cdd9fd67deec3848437) Thanks [@DavideCarvalho](https://github.com/DavideCarvalho)! - A forged folder-listing `cursor` throws `InvalidListingCursorError` (a `TypeError` with `status` 400), which the media console answers as 400 instead of 500.

## 0.9.2

### Patch Changes

- [#172](https://github.com/DavideCarvalho/nestjs-media/pull/172) [`fa54cc3`](https://github.com/DavideCarvalho/nestjs-media/commit/fa54cc3c477c4e8f0821074b5752f39350340bab) Thanks [@DavideCarvalho](https://github.com/DavideCarvalho)! - Cut memory and round trips on the upload and conversion paths:

  - `ResumableUploadManager.complete()` on a disk without native multipart streams the parts, one at a time, into a single `put` instead of concatenating them in memory.
  - `LocalDriver.put()` writes a stream to disk as it arrives (via a temp file renamed into place) instead of buffering it whole.
  - Eager conversions during `attach()` read the original once (or not at all when it was passed as a Buffer) and save the record once, instead of a store lookup, a disk read and a save per preset.
  - Concurrent `ensureConversion()` calls for the same media and conversion share one generation.
  - The dashboard's folder delete uses the disk's `deleteMany` per listed page.
  - `RedisUploadSessionStore.list()` no longer fails with `WRONGTYPE` when a session has recorded multipart parts, and reads sessions with one `MGET` per scan page (falling back to `GET` when the client has no `mget`).

## 0.9.1

### Patch Changes

- fix(deps): update dependency @dudousxd/nestjs-diagnostics to v0.7.2 ([#129](https://github.com/DavideCarvalho/nestjs-media/issues/129))

## 0.9.0

### Minor Changes

- c03d5c7: Byte-range reads: `stream(path, { start, end })`, and a range-honouring `object/raw`.

  Every read in this library was all-or-nothing. `stream()` gave you the object from byte zero, so
  anything that wanted a slice — a file header, a footer, one page in the middle — had to transfer the
  whole object to reach it. For a thumbnail that is fine. For the 302 MB SQLite database or the 2 GB
  Parquet file someone dropped in a bucket, it means the console can either download it or show
  nothing, and it showed nothing.

  `StorageDriver.stream(path, range?)` now takes a `ReadRangeOptions { start, end? }` — both bounds
  inclusive, `end` omitted meaning "to EOF", the same convention as HTTP `Range`, because that is what
  it becomes at both ends of the wire. The S3 driver passes it through as `Range:` on `GetObject`; the
  local driver hands it to `createReadStream` (whose `end` is inclusive too, so no ±1); the in-memory
  test driver slices its buffer. The shared conformance suite gained cases for a mid-file range, a
  range running past EOF (clamps, never throws), and an open-ended one, so every driver has to agree.

  `DriverCapabilities.ranged` is **required**, not optional, and that is the breaking edge of this
  change: a third-party driver will stop compiling until it answers the question. That is the point. A
  driver that accepts the argument and quietly ignores it returns the whole object to a caller who
  asked for 64 KB, and the caller cannot tell — it just reads a few hundred megabytes believing it
  holds one page. A compile error is a much better way to find out than a memory spike in production.

  On the console side, `GET disks/:disk/object/raw` now speaks the protocol properly: `Accept-Ranges:
bytes` on every response, `206` with `Content-Range` and a sliced `Content-Length` for a satisfiable
  range, `416` with `Content-Range: bytes */<size>` for one that isn't, and a plain `200` — byte for
  byte what it served before — when there is no `Range` header or the header is malformed, per RFC 9110. `bytes=a-b`, `bytes=a-`, and the suffix form `bytes=-n` are all understood; a multi-range
  request is ignored rather than half-answered. A range against a disk whose driver reports
  `ranged: false` fails loudly instead of silently returning everything.

  The browser client gained `objectRange(disk, key, start, end)`. It throws when the server answers
  `200`, which is the entire reason it exists as a function rather than a `fetch` call at each call
  site: a reverse proxy that strips `Range` turns a 64 KB page read into a 302 MB one, and the failure
  would otherwise surface as a hang rather than an error.

## 0.8.0

### Minor Changes

- 8852c83: Resumable uploads can now carry **opaque application metadata** from `createUpload` through to the
  upload diagnostics events. `CreateUploadInput` and `UploadSession` gain an optional
  `metadata?: Record<string, unknown>`, and it is echoed on the `upload.start` / `upload.complete`
  payloads. The library never reads it.

  This closes the gap that forced every host into a client round-trip after the bytes landed. Before,
  `upload.complete` told you only _that_ an object arrived at `disk`/`key` — not what it was for — so
  acting on it (index it, attach it to a record, start a workflow) meant the client had to call a
  finalize endpoint afterwards, and an abandoned or crashed client left the object orphaned in storage,
  uploaded but never processed. Now the host stamps its own correlation data up front and acts purely
  on the server-side event:

  ```ts
  await uploads.createUpload({ disk, key, size, metadata: { collectionId } });

  subscribe(channelName("media", "upload.complete"), (message) => {
    const { key, disk, metadata } = message.payload;
    // metadata.collectionId is right here — no finalize call, no orphans
  });
  ```

  Omitting `metadata` changes nothing: the key is absent from the session and from both payloads.

  `@dudousxd/nestjs-media-upload-redis` is updated to round-trip the field. Its `create()` already
  serialised the whole session, but `deserialize()` rebuilds sessions field by field, so without this
  the metadata would have been silently dropped on read and never reached `upload.complete`.

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
