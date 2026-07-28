# Media Dashboard — Design Proposal

Status: proposal / research. Nothing here is implemented yet.
Author basis: read-only study of `nestjs-durable`, `nestjs-telescope`, `nestjs-media`
(all under `/home/dudousxd/personal/oss/nestjs/`).

---

## 0. TL;DR

`nestjs-durable` ships **two different "dashboards"**, and the distinction is the whole
decision for media:

- **Path A — a Telescope *declarative extension*** (`packages/telescope`): a tiny package
  that calls `defineTelescopeExtension({ name, watchers, entryTypes, dashboards, dataProviders })`.
  It contributes a **`DashboardSpec`** (a declarative panel IR: stat/gauge/table/topN/…) plus
  server-side **`DataProvider`s**, and Telescope's **existing generic UI renders it as a tab**.
  **No custom UI bundle.** This is the light path.
- **Path B — a standalone embedded SPA** (`packages/dashboard`): a full Vite React SPA + its own
  NestJS module (`DurableDashboardModule.forRoot`) + a bespoke JSON API, served directly by Nest
  at `/durable`. Heavy; justified only because durable needs interactive control-plane actions
  (retry / cancel / fix-and-replay / live SSE timeline).

**Media today** already has the *watcher half* of Path A (`packages/telescope/src/media.watcher.ts`
records `aviary:media:*` events) but **no `defineTelescopeExtension`, no `entryTypes`, no
`dashboards`, no `dataProviders`** — so it feeds Telescope's timeline but contributes **no dashboard
tab**. That is the gap.

**Recommendation: build Path A first** (`@dudousxd/nestjs-media-telescope` gains a
`mediaTelescopeExtension()`). It's ~90% wired, needs no UI bundle, and is the exact analogue of
`durableTelescopeExtension`. Reserve Path B (a `@dudousxd/nestjs-media-dashboard` SPA) for later,
*only if* live in-flight-upload management (abort button, live progress SSE) is wanted — that need
is real but small.

The dominant constraint is the **data inventory** (§3): media is a mostly-stateless library. Only
**two** dashboard data sources are queryable *today* (in-flight upload sessions via Redis `list()`,
and disk names/capabilities). Everything else — event rates, totals, storage-per-disk — needs **new
instrumentation**. §5 enumerates each gap.

---

## 1. How durable's dashboard works (the template)

### 1a. Path A — the Telescope extension (`nestjs-durable/packages/telescope`)

This is the piece to mirror. Package `@dudousxd/nestjs-durable-telescope` (v0.7.1), builds with
**`tsup` only** (dual ESM+CJS), no UI toolchain.
`nestjs-durable/packages/telescope/package.json` scripts: `"build": "tsup"`.

The whole contribution is one factory:

`nestjs-durable/packages/telescope/src/durable-telescope.extension.ts:18-40`
```ts
export function durableTelescopeExtension(opts = {}) {
  return defineTelescopeExtension({
    name: 'durable',
    watchers: () => [new DurableTelescopeWatcher()],
    entryTypes: () => [{ id: 'durable', label: 'Workflows', dot: 'bg-amber-400' }],
    dashboards: () => [durableDashboard(opts)],
    dataProviders: () => [
      durableStateProvider(), durableTimeseriesProvider(), durableRecentFailuresProvider(),
      durableWorkerHealthProvider(), durableWorkerStatusProvider(), durableDurationProvider(),
      durableRunsOverTimeProvider(), durableSuccessRateProvider(), durableThroughputProvider(),
      durableStateBreakdownProvider(),
    ],
  });
}
```

Two flavors of data provider, both worth copying:

1. **Providers that aggregate the recorded event history from Telescope's own storage.**
   `durable-data-providers.ts:17-24` resolves `TELESCOPE_STORAGE` off the extension context's
   `moduleRef` and pages entries by type:
   ```ts
   async function fetchEntries(ctx: ExtensionContext): Promise<StorageEntry[]> {
     const storage = ctx.moduleRef.get(TELESCOPE_STORAGE, { strict: false }) as {...};
     const page = await storage.get({ type: 'durable', limit: 5_000 });
     return page.data;
   }
   ```
   Success-rate, throughput, top-failures, runs-over-time are all computed in-process from that page
   (`successRateOf`, `splitWindows`, dedup by `${event}:${runId}` — see file lines 55-120). **This
   needs no store of durable's own** — Telescope already persisted the events the watcher recorded.

2. **Providers that read the live host services** via `ctx.moduleRef` — worker health / state pull
   `STATE_STORE_CANONICAL` + `WorkflowEngine` straight from DI (imports at
   `durable-data-providers.ts:1-4`).

The declarative dashboard is pure data — `durable-dashboard.spec-data.ts:11-100` returns a
`DashboardSpec` with sections of typed panels, each binding to a provider:
```ts
{ kind: 'gauge', title: 'Success rate', data: { provider: 'durable.successRate' },
  max: 1, format: 'percent', thresholds: { warn: 0.98, bad: 0.95, direction: 'down-bad' } }
...
{ kind: 'table', title: 'Stuck runs', data: { provider: 'durable.recentFailures', query: { windowMs } },
  columns: [ { key: 'runId', label: 'Run', link: { href: runHref } }, ... ] }
```
Note `runHref` deep-links table rows **out to the Path-B SPA** (`/durable/runs/{runId}`) — the two
dashboards compose.

**Data flow (Path A):** browser opens Telescope UI → generic extension page fetches the
`DashboardSpec` → for each panel the UI calls `GET /telescope/ext/:ext/data/:provider?query=…`
(`nestjs-telescope/packages/core/src/nest/telescope.controller.ts:486-496`) → the host looks up the
provider in `ExtensionRegistry` and calls `provider.resolve(query, ctx)` → the generic
`panel-renderer.tsx` draws the result. **The library ships zero frontend.**

### 1b. Path B — the standalone embedded SPA (`nestjs-durable/packages/dashboard`)

Package `@dudousxd/nestjs-durable-dashboard` (v0.29.3). Description: *"Embedded control plane …
bundled React SPA served by NestJS."* Layout:

- **Frontend** `src/app/**` + `src/client/**` — React 18 + `@xyflow/react` + `@tanstack/react-query`,
  built by **Vite** to `dist/spa` (`vite.config.ts`: `base: '/durable/'`, `outDir: 'dist/spa'`,
  inputs `index.html` + `preview.html`).
- **Backend** `src/server/**` — a NestJS module + two controllers + a service, built by **tsup**
  (dual ESM+CJS via the shared `decoratorDualConfig`, `importMetaUrlShim: true` so `new URL('../spa',
  import.meta.url)` survives CJS — see the long rationale comment in `tsup.config.ts`).
- Client types built separately by `tsc`. `package.json` `build`:
  `"vite build && tsup && tsc -p tsconfig.client.json"`.

The Nest wiring (`src/server/durable-dashboard.module.ts`):
```ts
DurableDashboardModule.forRoot({ basePath = '/durable', apiBasePath = '<basePath>/api' })
```
uses `RouterModule.register` to mount a `DurableUiController` (serves the SPA) at `basePath` and a
`DurableApiController` at `apiBasePath`.

- **UI controller** (`durable-ui.controller.ts`): serves `dist/spa/index.html` (no-store) and hashed
  assets from `dist/spa/assets` (immutable). It **rewrites the Vite `base`** to the configured mount
  and **injects `window.__DURABLE_BASE__` / `window.__DURABLE_API__`** into `<head>` so the SPA knows
  where to fetch. That's the trick that lets one prebuilt bundle mount at any path.
- **API controller** (`durable-api.controller.ts`): the JSON API the SPA calls — `GET runs`,
  `GET runs/:id`, `Sse runs/:id/stream`, `GET workers`, `GET metrics` (Prometheus text),
  `POST runs/:id/retry|cancel|continue`, `POST bulk/:action`, webhooks, updates.
- **Service** (`dashboard.service.ts`): the read-model + actions. Reads through the injected
  `RUN_GATEWAY` port and (optionally) `STATE_STORE_CANONICAL` + `WorkflowEngine`.

**The cross-package DI token trick** (`src/server/tokens.ts`) is important for media too: the
dashboard package does **not** import `@dudousxd/nestjs-durable` — it shares the gateway token *by
value* using the **global symbol registry**:
```ts
export const RUN_GATEWAY = Symbol.for('nestjs-durable:run-gateway');
```
`Symbol.for(key)` resolves to the same instance as the owner package's export without an import,
dodging the ESM/CJS dual-copy problem. **Media's tokens do NOT use `Symbol.for`** (see §3, §5) —
they're plain `Symbol()`, which forces a real import dependency or a refactor if a separate media
dashboard package wants them.

---

## 2. The nestjs-telescope extension contract (what a dashboard must implement)

Source of truth: `nestjs-telescope/packages/core/src/extension/types.ts` and `.../nest/watcher.ts`.

### 2a. `TelescopeExtension` (`extension/types.ts:19-40`)
```ts
export interface TelescopeExtension {
  name: string;                                        // unique; collisions fail at boot
  watchers?(ctx): Watcher[];                           // event capture
  entryTypes?(ctx): ExtensionEntryType[];              // { id, label, dot } nav entries
  dashboards?(ctx): DashboardSpec[];                   // declarative panel pages
  dataProviders?(ctx): DataProvider[];                 // named server-side queries
  observeRecord?(input): void;                         // hot-path metric hook
  observeFlush?(entries): void | Promise<void>;        // post-persist hook
}
export function defineTelescopeExtension(ext: TelescopeExtension): TelescopeExtension { return ext; }
```
Registered by the consuming app: `TelescopeModule.forRoot({ extensions: [ mediaTelescopeExtension() ] })`.
`ExtensionRegistry` (`extension/registry.ts:29-76`) resolves all hooks **eagerly at module init** and
throws on duplicate entry-type id / dashboard id / provider name.

### 2b. `ExtensionContext` (`extension/types.ts:45-49`)
```ts
export interface ExtensionContext { readonly moduleRef: ModuleRef; readonly config: ResolvedCoreConfig; }
```
`moduleRef` is how a provider reaches host services — `TELESCOPE_STORAGE` (recorded entries) or any
media DI token (`MEDIA_STORAGE`, the Redis session store, etc.).

### 2c. `Watcher` (`nest/watcher.ts:26-32`) — media already implements this
```ts
export interface Watcher {
  readonly type: string;
  register(ctx: WatcherContext): void | Promise<void>;  // ctx.record({ type, content }) is fire-and-forget
  shouldRecord?(candidate: unknown): boolean;
}
```

### 2d. `DashboardSpec` + `Panel` (`extension/types.ts:76-144`)
A dashboard is data, not code. `DashboardSpec = { id, label, navGroup?, panels, sections? }`; each
`DashboardSection = { title?, cols?: 2|3|4, panels }`. Panel kinds and their **required provider
return shape** (`DataProvider.resolve`, documented at `types.ts:150-166`):

| `kind`         | panel fields                                  | provider must return |
|----------------|-----------------------------------------------|----------------------|
| `stat`         | `format`, `spark?`, `thresholds?`             | `{ value, delta?, deltaLabel?, spark?: number[] }` |
| `gauge`        | `min?`, `max?`, `format?`, `thresholds?`      | `{ value, min?, max? }` |
| `timeseries`   | `series: string[]`, `style?`                  | `{ rows: Array<{ label } & Record<string, number>> }` |
| `topN`         | `limit?`                                       | `{ items: Array<{ label, value, id? }> }` |
| `table`        | `columns: Column[]` (`link?` for deep-links)  | `{ rows: Array<Record<string, unknown>> }` |
| `distribution` | `markers?`, `format?`                          | `{ buckets: [{label,count}], p50?, p95?, p99? }` |
| `breakdown`    | `style?: 'donut'\|'bar'`                       | `{ segments: Array<{ label, value, color? }> }` |

### 2e. `DataProvider` (`extension/types.ts:150-166`)
```ts
export interface DataProvider {
  name: string;                                                    // globally unique
  resolve(query: Record<string, unknown> | undefined, ctx: ExtensionContext): Promise<unknown>;
}
```
Exposed to the UI at `GET /telescope/ext/:ext/data/:provider`
(`nest/telescope.controller.ts:486-496`); 404 for unknown provider, 502 (message surfaced) if
`resolve` throws.

### 2f. Frontend — nothing to ship
Telescope's own `packages/ui` renders every panel generically:
`ui/src/app/pages/extension-dashboard-page.tsx` (the tab) →
`ui/src/react/components/extensions/panel-renderer.tsx` (switch on `kind`) → fetches each provider
via the client. **A Path-A media dashboard contributes no JS/CSS/bundle at all.** (Contrast Path B,
which ships its own Vite SPA.)

**Panel-kind ceiling (a real constraint for *media* specifically):** the `Panel` union
(`extension/types.ts:111-147`) and its renderer (`ui/.../panel-renderer.tsx`, `switch(kind)`,
`default → null`) live in Telescope **core UI**. A Path-A extension can only compose the **7 existing
kinds** (stat/gauge/table/topN/timeseries/distribution/breakdown). Media naturally wants *visual*
panels — a **thumbnail grid, an image/video preview, a gallery of recent uploads**. None of those
exist as a panel kind, and an out-of-repo media package **cannot add one** — it would require a PR to
telescope core (`panel-renderer.tsx` + the `Panel` union). So Path A gives tables/stats/charts of
media *metadata* but **no visual media rendering**. If visual previews are a hard requirement, that
pushes toward Path B (the standalone SPA, which renders whatever it wants) or a core-UI contribution.
This is the single biggest Path-A limitation for a media dashboard — see open question 5.

**Version caveat (verify before relying on `sections`):** at telescope `1.10.0`, the nav/meta
endpoint (`telescope.service` `getMeta`) mapped only `{ id, label, panels, navGroup }` and **dropped
`sections`**, while durable's spec puts all panels inside `sections` with `panels: []`. Media's
telescope peer is `1.11.2` (newer), so this is likely fixed — but before authoring a sectioned
`DashboardSpec`, confirm `sections` survives `getMeta` at the pinned telescope version; if not, fall
back to the flat `panels` array. This is a concrete pin-and-test item, not a blocker.

---

## 3. Media dashboard proposal — panels scaled to the real data

Full inventory in §5. Legend: **[live]** = queryable today, no new code; **[new]** = needs new
instrumentation (flagged inline).

Proposed extension: `mediaTelescopeExtension()` in `@dudousxd/nestjs-media-telescope`, contributing
`entryTypes: [{ id: 'media', label: 'Media', dot: 'bg-sky-400' }]` and one `DashboardSpec`
`{ id: 'media.overview', label: 'Media' }` with these sections/panels:

### Section "Uploads (live)"

- **In-Progress Uploads** — `kind: 'table'` — **[live]**
  Source: `RedisUploadSessionStore.list()` (`packages/upload-redis/src/redis-upload-session-store.ts:102-127`,
  SCANs `media:upload:session:*`). Columns: `id`, `disk`, `key`, `offset`, `size`, `%`
  (offset/size), `parts`, `multipart?`. This is the flip `list-in-progress-media-uploads` precedent.
  **Backend read:** a `mediaInProgressUploadsProvider()` whose `resolve` does
  `ctx.moduleRef.get(<sessionStore token>).list()`. **Blocker:** the session store is a *private
  field* of `ResumableUploadManager` and is **not exposed as a DI token** today, and `list()` is
  **not on the `UploadSessionStore` SPI** (only on the Redis impl). Needs **[new]**: provide the
  session store under a token (e.g. `MEDIA_UPLOAD_SESSIONS`) and/or add `list?()` to the SPI so
  non-Redis stores degrade gracefully. Redis-only capability; the in-memory testing store has no
  `list()`.

- **Active upload count** — `kind: 'stat'` — **[live]** — `sessions.length` from the same provider.

### Section "Upload activity"  (all **[new]** — event history)

- **Upload success rate** — `kind: 'gauge'` (percent, down-bad thresholds)
- **Uploads over time** — `kind: 'timeseries'` (`upload.start` vs `upload.complete` vs `upload.abort`)
- **Throughput (bytes/s or uploads/min)** — `kind: 'stat'` with spark
- **Recent completed uploads** — `kind: 'table'` (from `upload.complete` payloads: `id,disk,key,size`)

  Source for all four: the **recorded `aviary:media:*` event history in Telescope storage**, read
  exactly like durable's `fetchEntries` (`TELESCOPE_STORAGE.get({ type: 'media', limit })`, then
  aggregate in-process). This is **[new] code** (providers don't exist) but needs **no new library
  state** — the events are already recorded by `MediaWatcher`. Caveats: `upload.progress` is
  deliberately **not** persisted (`media.watcher.ts:9-11`), so per-upload progress curves are
  unavailable to Path A; and the direct-upload path emits `upload.complete` with `size: 0`
  (`direct-upload.ts:126`), so byte throughput undercounts direct uploads — flag or exclude.

### Section "Media library"

- **Total media / total bytes** — `kind: 'stat'` — **[new, needs store method]**
  Source: the `media` table (`database-*`). **Blocker:** `MediaStore` SPI has **only**
  `listByOwner(ownerType, ownerId, collection?)` — **no global list, count, or aggregate**
  (`packages/core/src/media-store.ts:7-15`; confirmed none of the 4 adapters add one). Needs **[new]**:
  a `count()` / `aggregate()` on `MediaStore` (or a dashboard that runs direct SQL against the stable
  `media` table). Table columns are stable across adapters (`media.entity.ts`: `id, ownerType,
  ownerId, collection, name, fileName, mimeType, size, disk, path, position, customProperties,
  conversions, createdAt, updatedAt`).

- **Media by collection** — `kind: 'breakdown'` (donut) — **[new, needs store method + index]**
  `GROUP BY collection`. No index on `collection` alone today (only `(ownerType,ownerId,collection)`)
  → unindexed scan unless an index is added.

- **Storage by disk** — `kind: 'breakdown'` (bar) — **[new]**
  Two candidate sources, both need work: (a) `SUM(size) GROUP BY disk` over the `media` table (needs
  the same new aggregate method + a `disk` index); (b) walking `StorageDriver.list()` per disk
  (expensive, and only counts library-managed objects). Recommend (a).

- **Storage-writing over time** — `kind: 'timeseries'` — **[new]** — `attach` / `attachment.create`
  event volume from Telescope storage (same mechanism as the upload panels).

### Section "Disks & config"

- **Configured disks** — `kind: 'table'` — **[live]**
  Source: `StorageManager.diskNames()` (`packages/core/src/storage-manager.ts:27`) + per-disk
  `disk(name).capabilities` (`{ presign, multipart, publicUrls, list }`). Columns: name, default?,
  capability badges. **Blocker (minor):** driver *type* (S3 vs local) is not a field — only
  capability booleans distinguish them; and there are **no usage/object-count stats** on a driver.

### Optional Section "Attachments" — **[new, only via events]**
Attachments (column model) are **value objects embedded in the host app's own tables** — media has
**no attachments table and no enumeration** (`packages/core/src/attachment.ts`). The **only** signal
is the `attachment.create` / `attachment.delete` event stream. So an attachments panel can show
create/delete *rates and counts* (from Telescope storage) but never a *current inventory*. Include as
a `timeseries` + `stat` or omit for v1.

### Panel → data-source summary

| Panel | Source | Read path | Status |
|---|---|---|---|
| In-progress uploads | Redis session store | `RedisUploadSessionStore.list()` via new DI token | **[new: expose token/SPI]** |
| Active upload count | (same) | count of above | **[new: same]** |
| Upload success/rate/timeline/recent | Telescope-recorded `media:*` events | `TELESCOPE_STORAGE.get({type:'media'})` + aggregate | **[new: providers only]** |
| Total media / bytes | `media` table | new `MediaStore.count/aggregate` or direct SQL | **[new: store method]** |
| Media by collection | `media` table | `GROUP BY collection` (+ index) | **[new: store method + index]** |
| Storage by disk | `media` table | `SUM(size) GROUP BY disk` (+ index) | **[new: store method + index]** |
| Attachment activity | `attachment.*` events | Telescope storage aggregate | **[new: providers only]** |
| Configured disks | `StorageManager` | `diskNames()` + `disk(n).capabilities` | **[live]** |

### New instrumentation required (consolidated)
1. **Expose the upload session store** as a DI token (`MEDIA_UPLOAD_SESSIONS`) from
   `packages/nestjs`, and add an optional `list?()` to the `UploadSessionStore` SPI so the panel is
   store-agnostic (Redis implements it; testing/in-memory can too).
2. **Add a global read/aggregate to `MediaStore`** — at minimum `count(filter?)` and
   `aggregate({ groupBy: 'collection' | 'disk', sum: 'size' })`, implemented in all 4 adapters, plus
   supporting indexes (`disk`, `collection`, `createdAt`). Alternatively, the dashboard runs raw SQL
   against the stable `media` table (accept the coupling).
3. **Data providers** for every event-derived panel (aggregators over `TELESCOPE_STORAGE`,
   type `'media'`) — mechanical, mirrors `durable-data-providers.ts`.
4. (If Path B) a `MediaDashboardModule.forRoot` + SPA (see §4).
5. Consider making media's DI tokens `Symbol.for('nestjs-media:…')` if a *separate* dashboard package
   should inject them without importing `@dudousxd/nestjs-media-nestjs` (durable's pattern).

---

## 4. Package / build shape

### Recommended: Path A inside the existing telescope package
Add to **`@dudousxd/nestjs-media-telescope`** (`packages/telescope`, currently v0.5.5, **tsup-only**,
peer-deps already include `@dudousxd/nestjs-telescope ^1.0.0` and `@dudousxd/nestjs-media-core`):

```
packages/telescope/src/
  media.watcher.ts               (exists)
  media-telescope.extension.ts   (new — defineTelescopeExtension: name/entryTypes/dashboards/dataProviders/watchers)
  media-dashboard.spec-data.ts   (new — the DashboardSpec)
  media-data-providers.ts        (new — resolve() fns over TELESCOPE_STORAGE + injected media services)
  index.ts                       (export the extension)
```
No toolchain change: still `"build": "tsup"`, dual ESM+CJS, no UI bundle. This mirrors
`nestjs-durable/packages/telescope` one-for-one. **Changesets:** minor bumps on
`@dudousxd/nestjs-media-telescope` (0.5.x → 0.6.0); it stays 0.x. If the providers need the new
`MediaStore.count/aggregate`, those land in `-core` + each `database-*` adapter as **minor** bumps —
watch the 0.x-graduation rule (a `-core` minor can major all dependents; keep them 0.x). Providers
that read the upload store need the new `MEDIA_UPLOAD_SESSIONS` token exported from `packages/nestjs`
(minor).

### Optional later: Path B standalone SPA `@dudousxd/nestjs-media-dashboard`
Only if interactive control (abort a stuck upload, live progress SSE) is required. Clone durable's
`packages/dashboard` toolchain verbatim:
- Vite SPA → `dist/spa` (`base: '/media/'`), tsup dual-build for the Nest module (`decoratorDualConfig`,
  `importMetaUrlShim: true`), `tsc` for client types; `build = "vite build && tsup && tsc -p tsconfig.client.json"`.
- `MediaDashboardModule.forRoot({ basePath = '/media', apiBasePath })` with a UI controller (serve
  `dist/spa`, rewrite base, inject `window.__MEDIA_BASE__/__MEDIA_API__`) + a JSON API controller
  (`GET uploads`, `Sse uploads/:id/stream`, `POST uploads/:id/abort`, `GET disks`, `GET media`).
- Reads through the media DI tokens — either import them from `@dudousxd/nestjs-media-nestjs` (adds a
  dep) or switch media to `Symbol.for` tokens (durable's decoupling trick). New package, starts 0.1.0.
- Path A's table rows can deep-link into it (`href: '/media/uploads/{id}'`), same as durable.

**Verdict:** ship Path A now; only build Path B when live upload management is a confirmed
requirement — it is ~10× the surface area for one interactive capability.

---

## 5. Open design questions (ask before implementing)

1. **Path A only, or Path A + Path B?** Path A (Telescope tab, declarative, no bundle) covers all
   *read/observability* needs. Path B (standalone SPA) exists only to *act* on live uploads
   (abort button, live progress SSE) and to show non-persisted `upload.progress`. Is interactive
   upload management in scope, or is a read-only Telescope tab enough for v1?

2. **How do we surface global media-library aggregates — new `MediaStore` methods or direct SQL?**
   The SPI is owner-scoped only; "total media / by collection / storage-per-disk" need either
   `count()`/`aggregate()` added to `MediaStore` across all 4 adapters (+ new indexes on
   `disk`/`collection`/`createdAt`), or the dashboard reading the `media` table directly (couples the
   dashboard to the table schema, but it's stable and shared). Which coupling do you prefer?

3. **Is the recorded-event history an acceptable source for rate/throughput panels, given its
   caveats?** Path A reads `TELESCOPE_STORAGE` (so it requires Telescope + the media watcher, and it
   inherits Telescope's retention window). `upload.progress` is intentionally not persisted, and the
   direct-upload path emits `upload.complete { size: 0 }`. Acceptable, or do we want a media-owned
   metrics aggregator (an `observeRecord`/counter store) so numbers are exact and don't depend on
   Telescope retention?

4. **Expose the upload session store via a DI token now?** The in-progress-uploads panel is the one
   genuinely *live* upload view, but `RedisUploadSessionStore.list()` isn't reachable through
   `MediaService`/`ResumableUploadManager` today (flip had to reach the concrete store directly).
   Do we (a) add `MEDIA_UPLOAD_SESSIONS` + an SPI `list?()`, or (b) keep the panel Redis-specific and
   inject `RedisUploadSessionStore` directly (breaks for non-Redis session stores)?
```
