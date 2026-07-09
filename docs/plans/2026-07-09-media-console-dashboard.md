# `@dudousxd/nestjs-media-dashboard` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A standalone, self-mounting `/media` console (Disks/object-tree, Live uploads, Library) as a new package `@dudousxd/nestjs-media-dashboard`, mirroring `@dudousxd/nestjs-durable-dashboard`. Spec: `docs/specs/2026-07-09-media-console-dashboard-design.md`.

**Architecture:** One package, three build outputs — `src/server/` (NestJS module, tsup dual ESM/CJS), `src/app/` (React 18 + Vite + tanstack-query + Tailwind + hash router), `src/client/` (typed API client, `./client` entry, tsc). Core-only decoupling via `Symbol.for(...)` tokens with `{strict:false}` degradation. Self-mounts with `RouterModule.register`; serves the SPA from a controller with runtime base-path rewrite.

**Tech Stack:** NestJS 11, `@dudousxd/nestjs-media-core`, React 18, Vite 5, TanStack Query, Tailwind 3, tsup, vitest, changesets.

## Global Constraints
- Strict typing: no `as`/`any`/`unknown`/`never`. No Claude attribution in commits. Stage explicit paths (no `git add -A`).
- **Decoupled:** the dashboard package depends ONLY on `-core` (+ `@nestjs/*` peers). Never import `@dudousxd/nestjs-media` (the nestjs package). Resolve tokens by-value: `MEDIA_STORAGE_SHARED`=`Symbol.for('nestjs-media:storage')`, `MEDIA_UPLOAD_SESSIONS`=`Symbol.for('nestjs-media:upload-sessions')`, `MEDIA_STORE`=`Symbol.for('nestjs-media:store')`, all via `moduleRef.get(token,{strict:false})`.
- **Degrade-safe:** every API handler returns an empty shape (never throws) when its token resolves `null` or an optional SPI method is `undefined` — mirror `packages/telescope/src/media-data-providers.ts`.
- **Dual ESM/CJS** for `src/server/` via tsup (`decoratorDualConfig`, `importMetaUrlShim:true`) — matching the durable dashboard; a single-format build risks two `-core` copies at the host.
- **0.x graduation guard:** changeset = **minor** for the new package, **patch** for `-core`/adapters/testing/upload-redis (additive SPI). Scrutinize the Version PR — nothing may hit 1.0.0. (See the `feedback_changesets_0x_graduation` rule.)
- **SPI additions are optional (`?`)** on the interface so existing impls keep compiling.
- Reference implementations to MIRROR (read them): `nestjs-durable/packages/dashboard/` (whole package — mount, UI controller, client, tsup/vite build) and `packages/telescope/src/media-{data-providers,tokens,telescope.extension}.ts` (token wiring + degradation).

---

## Wave 1 — Lib SPI (additive, non-breaking)

### Task 1: `MediaStore.list?()` SPI types + in-memory impl
**Files:** Modify `packages/core/src/media-store.ts`; Modify `packages/testing/src/*` (the in-memory MediaStore) + its spec.
**Produces:** `MediaListFilter { ownerType?; collection?; disk? }`, `MediaListPage { cursor?; limit? }`, `MediaListResult { records: MediaRecord[]; cursor? }`, and `MediaStore.list?(filter?, page?): Promise<MediaListResult>`.
- [ ] Add the three interfaces + optional `list?` to `MediaStore` in core; export them from the core index.
- [ ] Implement `list()` in the in-memory testing store: filter by ownerType/collection/disk, stable sort by `(createdAt,id)`, `limit` default 50, opaque cursor = base64 of the last `createdAt.toISOString()+'|'+id`; decode to resume. Test: seed 3 collections, page with limit 2, assert cursor round-trip returns the next records and terminates with no cursor.
- [ ] `pnpm --filter @dudousxd/nestjs-media-core --filter @dudousxd/nestjs-media-testing build && vitest run` green. Commit `feat(core): MediaStore.list SPI + in-memory impl`.

### Tasks 2-5: `list()` in each ORM adapter (PARALLELIZABLE — one per adapter)
**Files (each):** Modify `packages/database-<orm>/src/*` (the store impl) + its db-spec.
**Consumes:** the Task 1 interfaces.
- [ ] For each of `database-mikro-orm`, `database-typeorm`, `database-prisma`, `database-drizzle`: implement `list(filter,page)` — `WHERE` on ownerType/collection/disk (all optional), `ORDER BY created_at ASC, id ASC`, `LIMIT page.limit+1` to detect a next page, opaque cursor keyset `(created_at,id) > (cursorCreatedAt,cursorId)`. Return `{records, cursor}`.
- [ ] Add index `(collection, created_at, id)` in the adapter's schema/migration helper next to the existing count/aggregate indexes.
- [ ] **MikroORM caveat** (from the aggregate work): if raw SQL is used, quote aliases; prefer the QueryBuilder/EM `find` with `orderBy` + `limit` and keyset `$or` for the cursor to stay portable. Verify against the adapter's real-DB spec if it has one.
- [ ] Adapter build + spec green. Commit per adapter `feat(<orm>): MediaStore.list impl + index`.

### Task 6: `UploadSession.createdAt?`
**Files:** Modify `packages/core/src/resumable-upload.ts` (add `createdAt?: Date` to `UploadSession`); Modify `packages/upload-redis/src/*` (set on `create`, parse on read) + `packages/testing/src/*` (set on create) + specs.
- [ ] Add `createdAt?: Date`. In upload-redis store the ISO string in the session hash on `create` and parse it back on `get`/`list`. In testing set `new Date()`... NOTE: `Date.now()`/`new Date()` are fine in library runtime code (only the workflow-script sandbox forbids them). Test: `create` then `get`/`list` returns a `createdAt` within tolerance.
- [ ] Builds + specs green. Commit `feat(core): UploadSession.createdAt + redis/testing impls`.

---

## Wave 2 — Dashboard package: scaffold + server

### Task 7: Package scaffold
**Files:** Create `packages/dashboard/` — `package.json`, `tsconfig.json`, `tsconfig.client.json`, `tsup.config.ts`, `vite.config.ts`, `tailwind.config.js`, `postcss.config.js`, `src/server/tokens.ts` (copy of telescope's `media-tokens.ts` + the two path tokens), `src/index.ts` placeholder. Modify root `pnpm-workspace.yaml` if needed (glob likely already covers `packages/*`).
**Consumes:** nothing (scaffold). **Produces:** the buildable package skeleton, exports `.` (server) + `./client`.
- [ ] Mirror `nestjs-durable/packages/dashboard/package.json`: `build: "vite build && tsup && tsc -p tsconfig.client.json"`, exports map (`.` -> dist/server dual, `./client` -> dist/client), `files: ["dist"]`, deps `@dudousxd/nestjs-media-core` (workspace), peer `@nestjs/common`/`@nestjs/core`, devDeps react/vite/tsup/tailwind. Version `0.1.0`.
- [ ] `tsup.config.ts`: reuse the durable `decoratorDualConfig` shape (ESM+CJS, `importMetaUrlShim:true`, entry `src/server/index.ts`). `vite.config.ts`: `base:'/media/'`, plugin-react, build to `dist/spa`, plus a `preview.html` input. `tsconfig.client.json`: emit `src/client` to `dist/client`.
- [ ] `pnpm install` at root resolves the new package; `pnpm --filter @dudousxd/nestjs-media-dashboard build` succeeds on the empty skeleton (stub index files). Commit `chore(dashboard): package scaffold`.

### Task 8: `MediaConsoleService` (read + action logic)
**Files:** Create `packages/dashboard/src/server/media-console.service.ts` (+ spec).
**Consumes:** Task 1/6 SPI, tokens (Task 7). **Produces:** methods used by the controllers:
`listDisks()`, `listObjects(disk,{prefix,cursor,limit})`, `objectDetail(disk,key)`, `deleteObject(disk,key)`, `copyObject(disk,from,to)`, `moveObject(disk,from,to)`, `listUploads({disk,prefix})`, `uploadDetail(id)`, `abortUpload(id)`, `listCollections()`, `listLibrary({collection,disk,cursor,limit})`, `libraryDetail(id)`, `deleteLibraryRecord(id)`, `topology()`.
- [ ] Inject the three tokens with `@Optional()`/`{strict:false}` via `ModuleRef` (constructor resolves them lazily as telescope does). Storage always present; store/uploads may be `null`.
- [ ] Each method maps core types to the API shapes in the spec's "JSON API" section; the store/uploads-absent path returns the empty shape. `objectDetail`/`libraryDetail` build URLs via `storage.disk(d).temporaryUrl(path, ttl)` (ttl e.g. 300s). Variants from `record.conversions` (`{name,url}` per entry).
- [ ] Unit tests: mocked StorageManager/MediaStore/UploadSessionStore -> assert each mapping; assert empty shapes when store/uploads are `null`. Commit `feat(dashboard): MediaConsoleService`.

### Task 9: API controllers + module (mount)
**Files:** Create `packages/dashboard/src/server/media-console-api.controller.ts`, `media-console-api.module.ts`, `media-dashboard.module.ts` (`forRoot`), `media-dashboard-ui.controller.ts` scaffolding of routes only (serving in Task 10). Update `src/server/index.ts` exports.
**Consumes:** Task 8 service, path tokens.
- [ ] API controller: bare `@Controller()`, relative routes exactly per the spec's JSON API table. **Actions gating:** in `forRoot`, when `options.actions !== true`, do NOT include the action routes — cleanest is a separate `MediaConsoleActionsController` only added to the API module's `controllers` when `actions:true` (read controller always present).
- [ ] `forRoot(options)` -> `RouterModule.register([{ path: apiBasePath, module: MediaConsoleApiModule }, { path: basePath, module: MediaDashboardModule }])`; provide `MEDIA_DASHBOARD_BASE_PATH`/`_API_PATH` from resolved options; default `basePath:"/media"`, `apiBasePath: base+"/api"`.
- [ ] Test: bootstrap a Nest testing app with `forRoot({actions:false})` -> `GET <api>/disks` 200 with empty/real shape, action route 404; with `{actions:true}` the action route exists. Commit `feat(dashboard): api controllers + forRoot mount`.

### Task 10: UI controller (SPA serve + rewrite) + client entry
**Files:** Modify `media-dashboard-ui.controller.ts`; Create `packages/dashboard/src/client/media-console-client.ts` + `src/client/index.ts` + `src/client/types.ts`.
**Consumes:** path tokens.
- [ ] UI controller mirrors durable's: locate `../spa` via `import.meta.url`; `@Get()` serve `index.html` with base-path string-replace (`/media/` -> basePath) + inject `window.__MEDIA_BASE__`/`__MEDIA_API__`; `@Get('assets/:file')` stream with basename guard; correct cache headers.
- [ ] `src/client/`: typed `fetch` client reading `window.__MEDIA_API__`; export the response types (`DiskInfo`, `ObjectPage`, `UploadInfo`, `CollectionInfo`, `LibraryRecord`, `Topology`) for host reuse.
- [ ] Test: UI controller unit test for the rewrite + traversal guard (no real SPA needed — stub `dist/spa/index.html`). Commit `feat(dashboard): ui controller + typed client`.

---

## Wave 3 — SPA (React)

### Task 11: SPA shell
**Files:** Create `packages/dashboard/src/app/` — `main.tsx`, `App.tsx` (hash router: `#/disks|#/uploads|#/library` + drill-in), `index.html`, `preview.html`, `api.ts` (uses `src/client`), `styles.css` (Tailwind), a layout with tab nav + topology badge.
**Consumes:** Task 10 client.
- [ ] React 18 + QueryClientProvider; hand-rolled hash router off `window.location.hash` (mirror durable `App.tsx`). Tabs + empty-state wiring from `GET topology`. Commit `feat(dashboard): spa shell`.

### Tasks 12-14: the three views (PARALLELIZABLE after Task 11)
**Files (each):** Create the view component(s) under `src/app/views/`.
- [ ] **Task 12 — Disks:** disk rail + breadcrumb + folder/file table from `disks/:disk/objects` with cursor "load more"; row preview/download/copy-key; action buttons gated on topology. Commit.
- [ ] **Task 13 — Uploads:** live table (`refetchInterval:2000`) with percent bars; drill-in parts; abort when actions. Commit.
- [ ] **Task 14 — Library:** collection chips -> record grid (paginated) -> detail with variant thumbnails; "no store" empty state. Commit.

### Task 15: preview mock entry
**Files:** Create `src/app/preview.tsx` + mock fixtures.
- [ ] A mock-data mount (like durable's `preview.html`) rendering all three views with fixture data for visual verification without a backend. Commit.

---

## Wave 4 — Build, publish, flip mount

### Task 16: Build wiring + changeset + repo checks
**Files:** finalize `tsup.config.ts`/`vite.config.ts`/`tsconfig.client.json`; add `.changeset/media-console.md`.
- [ ] `pnpm --filter @dudousxd/nestjs-media-dashboard build` produces `dist/server` (dual), `dist/spa`, `dist/client`. Whole-repo `turbo typecheck` + `biome check` clean.
- [ ] Changeset: `@dudousxd/nestjs-media-dashboard` **minor** (new pkg), `-core`/`database-*`/`testing`/`upload-redis` **patch**. Verify `changeset status` shows nothing at 1.0.0. Commit.

### Task 17: Publish (owner-triggered)
- [ ] Push branch -> PR to `main` -> CI green -> merge -> Changesets Version PR -> **scrutinize bumps** -> merge -> Release publishes. Verify npm has `@dudousxd/nestjs-media-dashboard@0.1.0` + the patch bumps. (Confirm the release trigger with the owner, per the established pattern.)

### Task 18: flip mount
**Files (flip-nestjs, new branch off master):** a `media-dashboard.module.ts` or app-module import of `MediaDashboardModule.forRoot({ basePath:"/media", apiBasePath:"/api/media/console", actions:false })`; `src/main.ts` add `media`,`media/{*splat}` to the `setGlobalPrefix` exclude; gate `/media` with the ADMIN guard (mirror `/telescope`/durable). Add dep `@dudousxd/nestjs-media-dashboard@0.1.0`.
- [ ] `tsc --noEmit` + `nest build` clean. Prod-mode boot smoke (NODE_ENV=production APP_TYPE=API) reaches "listening" (extension registers without DI crash). PR to master. Verify `/media` on dev after deploy: Disks + Uploads populate, Library empty.

## Final verification
- New package builds all three outputs; whole-repo typecheck + biome clean; SPI specs green in every adapter; server specs green; degrade-to-empty verified with null store/uploads.
- flip mount additive; `/media` renders; Disks/Uploads live; Library empty (no store) with the empty-state.

## Self-review (spec coverage)
3 views -> Tasks 12-14 (SPA) + 8/9 (API). SPI list() -> Tasks 1-5. createdAt -> Task 6. Self-mount -> Tasks 7/9/10. Actions-gating -> Task 9. Decoupling/degradation -> Global Constraints + Task 8. flip mount -> Task 18. Publish/0.x guard -> Tasks 16-17.
