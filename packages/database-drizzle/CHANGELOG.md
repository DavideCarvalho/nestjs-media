# @dudousxd/nestjs-media-database-drizzle

## 0.10.0

### Minor Changes

- [#212](https://github.com/DavideCarvalho/nestjs-media/pull/212) [`126491c`](https://github.com/DavideCarvalho/nestjs-media/commit/126491c43d607a5f535eb07d32d9a9015c375d6c) Thanks [@DavideCarvalho](https://github.com/DavideCarvalho)! - Global search across the Aviary consoles. A console entry may expose `search(context, q, limit)`; `GET <api>/consoles/search?q=` fans out to this console and every other console the viewer may open (300 ms and 5 hits each, `partial: true` when one did not answer). The media console searches files: a library record by exact id, library records whose name or file name contains the text (by the request's tenant), and disk objects whose key starts with it (only when no tenant scope applies). The console gets a Ctrl/Cmd-K search palette, a Search button and a "Search all consoles" item in the switcher menu; hits open the record (`#/library/<id>`) or the file preview. While the switcher runs another console's `authorize`, the request carries `aviaryProbe = true`, so an auditing authorizer can skip it.

  `MediaListFilter` gains `nameContains` (name or file name contains the text, ignoring case), implemented by every bundled store and checked by `runMediaStoreConformance`; core exports `matchesNameContains` and `nameContainsPattern` for custom stores.

- [#212](https://github.com/DavideCarvalho/nestjs-media/pull/212) [`126491c`](https://github.com/DavideCarvalho/nestjs-media/commit/126491c43d607a5f535eb07d32d9a9015c375d6c) Thanks [@DavideCarvalho](https://github.com/DavideCarvalho)! - A `schema` option keeps the media tables in a database schema of their own (on MySQL, a database), and every statement names it: `search_path` is never used. Drizzle Postgres: `new DrizzlePgMediaStore(db, { schema })`, the same on `DrizzlePgUploadSessionStore` and the `/nest` factories, `mediaPgTables(schema)` for drizzle-kit, and `createMediaPgTables(db, { schema })` / `mediaPgDdl(schema)` (they create the schema). TypeORM and MikroORM: register `mediaEntity({ schema })` and pass `{ schema }` to the store (and to `ensureMediaSchema`, which creates the schema or MySQL database and heals only the media table). A role that may not create the schema gets the grant it needs; SQLite with `schema` throws. Prisma: documented `@@schema` setup (the store issues no SQL of its own). On MySQL, TypeORM's `ensureMediaSchema` (and MikroORM's with `schema`) now creates `idx_media_tenant` with 191-character prefixes, so it fits InnoDB's key limit. Without `schema`, nothing changes.

## 0.9.0

### Minor Changes

- [#211](https://github.com/DavideCarvalho/nestjs-media/pull/211) [`8f3315e`](https://github.com/DavideCarvalho/nestjs-media/commit/8f3315e3ba7c4825a51dbf413e1a9615a058312b) Thanks [@DavideCarvalho](https://github.com/DavideCarvalho)! - Require Node.js 24 or newer: `engines.node` is now `>=24` (was `>=20`, or unset). CI tests on Node 24 and 26. Upgrade Node, then the packages.

  **Breaking (`@dudousxd/nestjs-media-core`):** the `MediaDiagnosticEnvelope` type, kept only for code written against the old media-specific envelope, is removed. Type a message from an `aviary:media:<event>` channel as `DiagnosticEvent` from `@dudousxd/nestjs-diagnostics` (same shape). See the docs' Upgrading page.

## 0.8.0

### Minor Changes

- [#209](https://github.com/DavideCarvalho/nestjs-media/pull/209) [`d42f192`](https://github.com/DavideCarvalho/nestjs-media/commit/d42f19226f93952584e162cef614d72a8960e967) Thanks [@DavideCarvalho](https://github.com/DavideCarvalho)! - Media follows the request's tenant from `@dudousxd/nestjs-context` (opt-in, off by default).

  - `MediaModule.forRoot({ tenancy })`: `'inherit'` (default, follows `ContextModule`'s `tenancy.enabled`), `false`, or `{ enabled, kinds, nullRows }`.
  - With tenancy on, `attach` and resumable uploads stamp the tenant (an explicit `tenantId` wins); `library.get/list/locate/url`, conversions, `MediaService.serve/url/delete`, upload sessions and the dashboard's library and uploads views apply the matching rule on top of `authorize`. A record or session of another tenant is not found (404), never 403.
  - Every store gains a nullable `tenant_id` (TypeORM, MikroORM, Drizzle sqlite/pg incl. upload sessions, the Prisma model docs) with an index, and `enableTenancy()`. With tenancy on and the column missing, the boot fails with `MediaTenancyUnavailableError` and the fix. With tenancy off, the column is never read or written.
  - Hidden or missing behaves the same: `library.delete()`, `MediaService.delete()` and upload `abort()` are a silent no-op. With tenancy on, the dashboard's delete record and cancel upload are a 404, whether the id belongs to another tenant or doesn't exist.
  - A store's `save` (and the Drizzle pg session store's `create`/`update`) returns the `tenantId` it persisted: none while tenancy is off. TypeORM writes the row and its tenant in one transaction.
  - New `library.get(id)`. Docs: the Tenancy page, with backfill SQL.

## 0.7.0

### Minor Changes

- [#199](https://github.com/DavideCarvalho/nestjs-media/pull/199) [`fa191a3`](https://github.com/DavideCarvalho/nestjs-media/commit/fa191a3e7a982e71e23b8cdd9fd67deec3848437) Thanks [@DavideCarvalho](https://github.com/DavideCarvalho)! - New `/nest` entries with store factories on a named connection, for `MediaModule.forRoot({ store, uploadSessions })`: `typeOrmMediaStore({ connectionName, autoCreateSchema })` (on `getDataSourceToken()` from `@nestjs/typeorm`), and `drizzleMediaStore`, `drizzlePgMediaStore`, `drizzlePgUploadSessions` (on `getDrizzleToken()` from `@nestjs/drizzle`). `@nestjs/typeorm` and `@nestjs/drizzle` are optional peers, loaded only by `/nest`.

### Patch Changes

- [#199](https://github.com/DavideCarvalho/nestjs-media/pull/199) [`fa191a3`](https://github.com/DavideCarvalho/nestjs-media/commit/fa191a3e7a982e71e23b8cdd9fd67deec3848437) Thanks [@DavideCarvalho](https://github.com/DavideCarvalho)! - Fix packages that could be published without files their `exports` point to. The two tsup passes (ESM, CJS) no longer each clean `dist/` while running at the same time; `dist/` is cleaned once before the build. A new `check:exports` step (also `prepack`) fails the release if any `exports`/`main`/`types` path is missing.

## 0.6.0

### Minor Changes

- [#131](https://github.com/DavideCarvalho/nestjs-media/pull/131) [`d302fa4`](https://github.com/DavideCarvalho/nestjs-media/commit/d302fa45d87c642f230361bfe977ce5f13bee203) Thanks [@DavideCarvalho](https://github.com/DavideCarvalho)! - Add Postgres support on a new `@dudousxd/nestjs-media-database-drizzle/pg` subpath (the package root stays the sqlite/libSQL store, unchanged). It exports `mediaPgTable` + `DrizzlePgMediaStore` (a full `MediaStore`, including count/aggregate/keyset-cursor list), `mediaUploadSessionsPgTable` / `mediaUploadPartsPgTable` + `DrizzlePgUploadSessionStore` (a resumable-upload `UploadSessionStore` with atomic `addPart` upserts, `listParts` and filtered `list`), and `createMediaPgTables(db)` / `MEDIA_PG_DDL` for tests and dev. Stores accept any drizzle Postgres database (`PgDatabase`). The `drizzle-orm` peer range is widened to `>=0.38.0 <1.0.0`, so 0.39–0.45 consumers install cleanly.

## 0.5.10

### Patch Changes

- 36dd0b0: Stop the next `core` minor from publishing twelve packages as 1.0.0.

  Twelve packages declared their peer dependency on `@dudousxd/nestjs-media-core` as `workspace:*`. Changesets treats a peer bump as breaking for the dependent, and "breaking" on a `0.x` package means `1.0.0` — so the first minor `core` takes would promote the entire repo at once, with no `major` changeset anywhere in sight.

  This has not fired yet only because `core` has not taken a minor recently. The identical bug did fire in `nestjs-agent`, where six packages were queued to publish as `1.0.0` off a routine SPI change and were caught in the release PR.

  Ranges are now `>=0.8.0 <1.0.0`. `onlyUpdatePeerDependentsWhenOutOfRange` is already set in the changesets config; it just needs a range a `0.9.0` core still satisfies.

  Verified by simulation rather than argument: adding a throwaway `core: minor` changeset and running `changeset version` produces twelve `1.0.0` bumps before this change and zero after — `core` goes to `0.9.0` and every dependent stays on a patch.

  `workspace:*` in `dependencies` is left alone; it is resolved at publish and causes none of this. Only peers matter.

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
