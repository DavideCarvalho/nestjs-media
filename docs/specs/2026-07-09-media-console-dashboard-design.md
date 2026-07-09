# `@dudousxd/nestjs-media-dashboard` — navigable `/media` console — Design

**Date:** 2026-07-09
**Repo:** nestjs-media, branch `feat/media-console` (off `main`)
**Status:** approved (design confirmed by owner)

## Goal

Ship a standalone, self-mounting **`/media` console** — a navigable SPA (like
`@dudousxd/nestjs-durable-dashboard` mounts `/durable` and the agent lib mounts
`/ai-gateway`) where an operator can **browse disks and walk the object tree,
watch live uploads with drill-in, and browse the media library by collection
with variants/thumbnails**. It is a NEW package in the media monorepo,
`@dudousxd/nestjs-media-dashboard`.

This is distinct from `@dudousxd/nestjs-media-telescope` (already shipped),
which is a read-only **stats tab inside `/telescope`** — the equivalent of
durable's "Workflows" tab. The console is the equivalent of the standalone
`/durable` SPA.

## Scope

- **In:** a new package with three build outputs (server module, React SPA,
  typed `./client`); the three views (Disks/object-tree, Live uploads, Library);
  a JSON API; destructive **actions gated behind an opt-in option** (default
  off); the additive lib-SPI changes the Library view requires; a flip mount.
- **Out:** auth (host guards the mount, mirroring durable); any change to the
  existing tus/multipart/direct upload controllers; adopting a `MediaStore` in
  flip (flip mounts the console and gets Disks + Uploads immediately; the
  Library view stays empty until a consumer configures a `MediaStore`).

## Key decisions (owner-confirmed)

1. **Full library manager** scope — the console has all three views.
2. **Lib-complete, flip gets Disks + Uploads now.** Build the whole console +
   the `MediaStore.list()` SPI in the lib. flip mounts it: Disks + Live uploads
   light up immediately (S3 `list()` + `RedisUploadSessionStore.list()`); the
   Library view is present but empty in flip (no `MediaStore`).
3. **Destructive actions included in v1, gated by `opts.actions` (default
   `false`).** Delete object / delete library record / abort upload / copy /
   move are only mounted when the host opts in.
4. **Mount path `/media`** (UI) + `/api/media/console` (JSON API). `/media` is a
   clean namespace; the tus controller lives at `/api/media/uploads`, so the
   console API sits under the distinct `/api/media/console` prefix — no route
   collision. The host excludes `media` + `media/{*splat}` from its global
   `/api` prefix (exactly as flip excludes `durable`).

## Architecture (mirror `nestjs-durable-dashboard`)

One npm package, `packages/dashboard/`, three build outputs:

- **`src/server/`** — NestJS module + controllers + a read/action service.
  Built with **tsup**, dual **ESM+CJS** (load-bearing: the host `require`s both
  this and `MediaModule`; a single-format build would risk two `-core` copies).
  `importMetaUrlShim: true` so the CJS build can locate `dist/spa`.
- **`src/app/`** — the React 18 SPA (Vite + `@tanstack/react-query` +
  Tailwind 3 + a hand-rolled hash router, matching durable). Built with **Vite**
  to `dist/spa` with a fixed `base: '/media/'`, rewritten at serve time.
- **`src/client/`** — framework-agnostic typed API client + shared types,
  shipped as the secondary entry `./client` (built with `tsc`). Consumed by the
  SPA and by host apps that want the response types.

**Decoupled (core-only).** The package depends **only on `-core`** (+ the
peer `@nestjs/*`). It resolves the three cross-package by-value tokens with
`{ strict: false }` and degrades gracefully — copy `packages/telescope/src/
media-tokens.ts` verbatim:

```ts
MEDIA_STORAGE_SHARED  = Symbol.for('nestjs-media:storage')          // StorageManager (always present)
MEDIA_UPLOAD_SESSIONS = Symbol.for('nestjs-media:upload-sessions')  // UploadSessionStore | null
MEDIA_STORE           = Symbol.for('nestjs-media:store')            // MediaStore | null
```

Thumbnails/variant URLs are built **directly** from a record's conversion
paths via `storage.disk(conv.disk).temporaryUrl(conv.path, ttl)` — no
`MediaLibrary`/`AttachmentManager` facade is needed, so the package stays on
`-core` only.

### Self-mount mechanism

`MediaDashboardModule.forRoot(options)`:

```ts
interface MediaDashboardOptions {
  basePath?: string;      // UI mount, default "/media"
  apiBasePath?: string;   // JSON API mount, default "<basePath>/api" -> here "/media/api"
  actions?: boolean;      // enable destructive endpoints, default false
}
```

- Two inner modules: `MediaConsoleApiModule` (controllers for the JSON API,
  provider `MediaConsoleService`) and the outer module (UI controller).
- `forRoot` binds them with `@nestjs/core` **`RouterModule.register([...])`**:
  `basePath -> UI module`, `apiBasePath -> API module`. Controllers use bare
  `@Controller()` + relative routes; the prefix comes from RouterModule.
- Path DI tokens `MEDIA_DASHBOARD_BASE_PATH` / `MEDIA_DASHBOARD_API_PATH`
  (symbols) carry resolved paths to the UI controller for the runtime rewrite.

**flip note:** flip sets a global `/api` prefix. To keep the console API at a
readable `/api/media/console`, flip passes `apiBasePath: "/api/media/console"`
and excludes `media` + `media/{*splat}` from the global prefix (the API path
already carries the literal `api/` segment, matching how flip mounts durable at
`/api/durable`). Documented in the README + the flip mount task.

### SPA serving (UI controller)

- Locate `dist/spa` via `fileURLToPath(new URL('../spa', import.meta.url))`.
- `@Get()` returns `index.html` with the durable-style runtime rewrite:
  string-replace the Vite `base` (`/media/`) with the configured `basePath`,
  and inject `<script>window.__MEDIA_BASE__=...; window.__MEDIA_API__=...`
  before `</head>`. `Cache-Control: no-store` on HTML, `immutable` on assets.
- `@Get('assets/:file')` streams hashed assets with a `basename` path-traversal
  guard.

## JSON API (`MediaConsoleService` -> controllers, relative to `apiBasePath`)

```
Disks
  GET  disks                              -> { disks: [{ name, default, capabilities }] }
  GET  disks/:disk/objects?prefix&cursor&limit
                                          -> { folders: string[], files: ListEntry[], cursor? }
  GET  disks/:disk/object?key             -> { key, stat: {size,contentType,lastModified}, url }   (temporaryUrl)
  [actions] DELETE disks/:disk/object?key
            POST   disks/:disk/copy   { from, to }
            POST   disks/:disk/move   { from, to }

Uploads
  GET  uploads?disk&prefix                -> { uploads: [{ id, disk, key, offset, size, percent, parts, multipart, createdAt? }] }
  GET  uploads/:id                        -> { upload, parts: MultipartPart[] }
  [action] POST uploads/:id/abort

Library
  GET  library/collections                -> { collections: [{ key, count, sumSize }] }   (aggregate)
  GET  library?collection&disk&cursor&limit
                                          -> { records: MediaRecord[], cursor? }          (list() SPI)
  GET  library/:id                        -> { record, variants: [{ name, url }] }         (temporaryUrl per conversion)
  [action] DELETE library/:id

Meta
  GET  topology                           -> { hasStore, hasUploads, disks: number }       (header badges / empty-state copy)
```

Every handler resolves its token with `{ strict: false }` and returns an empty
shape when the capability is absent (no `MediaStore` -> `library/*` returns
empty; no upload store -> `uploads` returns empty) — never throws. Mirrors the
telescope providers' degradation exactly.

### Actions gating

When `options.actions !== true`, the action routes are **not registered** (the
controller is built without them, or a guard 404s them). Read endpoints are
always available. flip mounts with `actions: false` for v1 (Disks/Uploads are
browse-only there); a future flip opt-in can enable them behind its ADMIN gate.

## Frontend (SPA)

Three top-level tabs, hash-routed (`#/disks`, `#/uploads`, `#/library`), plus
drill-in routes (`#/disks/:disk?prefix=`, `#/uploads/:id`, `#/library/:id`).

- **Disks:** left rail of disk names (+ capability badges); main pane is a
  breadcrumb + folder/file table from `disks/:disk/objects` with cursor
  "load more". Row actions: preview (open `url`), copy-key, download; delete/
  copy/move shown only when `topology`/build indicates actions are on.
- **Uploads:** live table (react-query `refetchInterval: 2000`) of in-progress
  sessions with a percent bar; drill-in shows parts. Abort button when actions.
- **Library:** collection chips (from `library/collections`) -> paginated record
  grid; record detail shows metadata + variant thumbnails (from `library/:id`).
  Empty state: "No media store configured" when `topology.hasStore` is false.

Reuse `@dudousxd/nestjs-media-client` for any upload widget; author a
durable-client-style typed client in `src/client/` for the browse/read API
(reads `window.__MEDIA_API__`, plain `fetch`, ambient cookies — no auth
headers, rides the host's guards).

## Lib SPI changes (additive, non-breaking)

These are the only changes outside the new package. Each is optional on the
interface (`?`) so existing implementations keep compiling.

1. **`MediaStore.list?(filter, page)`** — the one gap that blocks the Library
   view. In `packages/core/src/media-store.ts`:
   ```ts
   interface MediaListFilter { ownerType?: string; collection?: string; disk?: string; }
   interface MediaListPage   { cursor?: string; limit?: number; }
   interface MediaListResult { records: MediaRecord[]; cursor?: string; }
   interface MediaStore {
     // ...existing...
     list?(filter?: MediaListFilter, page?: MediaListPage): Promise<MediaListResult>;
   }
   ```
   Implement in all four ORM adapters (`database-mikro-orm`, `-typeorm`,
   `-prisma`, `-drizzle`) with a stable `ORDER BY createdAt, id` + opaque cursor
   (encode the last `(createdAt,id)`), and in `packages/testing` (in-memory).
   Add a supporting index `(collection, createdAt, id)` alongside the existing
   count/aggregate indexes; note the manual `CREATE INDEX` migration for
   already-deployed tables (same caveat as the count/aggregate release).

2. **`UploadSession.createdAt?`** — for upload age in the live view. In
   `packages/core/src/resumable-upload.ts` add `createdAt?: Date` to
   `UploadSession`; set it on `create` in `packages/upload-redis` (store an
   ISO string in the hash) and `packages/testing`. Absent -> the UI just omits
   age. `status` is derived client-side from `offset/size`, no field needed.

## Testing

- **SPI:** unit tests for `list()` in each adapter (pagination, cursor
  round-trip, filter by collection/disk) mirroring the existing count/aggregate
  db-spec structure; in-memory `list()` in testing; `createdAt` set on session
  create in upload-redis + testing.
- **Server:** `MediaConsoleService` unit tests — each endpoint returns the
  mapped shape from a mocked store/storage, and the **degrade-to-empty** path
  when a token resolves `null`; actions-gating (routes absent when
  `actions:false`). UI controller: base-path rewrite + asset traversal guard.
- **SPA:** a `preview.html` mock-data entry (like durable) for visual
  verification; light component tests optional.
- Whole-repo typecheck + biome across all packages; the new package builds
  (vite + tsup + tsc) clean.

## Rollout / safety

- New package -> first publish is a fresh version (0.x); changeset **minor**
  for the new package, **patch** for `-core` and the adapters (additive SPI) to
  avoid the 0.x -> 1.0.0 graduation footgun. Scrutinize the Version PR.
- No built-in auth: the README states the host must guard the mount and exclude
  the UI/API paths from any global prefix. flip fronts `/media` with an ADMIN
  gate (as it does `/telescope` and the media upload controllers).
- Degrade-safe throughout: a host with no `MediaStore`/upload store still boots
  and renders the console (empty Library/Uploads), exactly like the telescope
  extension.
- flip mount is additive (one module import + prefix exclude + guard); Disks +
  Uploads populate immediately, Library awaits a store.
