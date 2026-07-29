# @dudousxd/nestjs-media-dashboard

## 0.12.2

### Patch Changes

- 8f72bff: Fix: `useOpenMediaConsole` no longer leaves a stuck spinner after a Back from the console.

  `useOpenMediaConsole` deliberately keeps `isPending` true after a successful mint, because the
  navigation to the console is already underway and going back to idle flashes "ready to click again"
  on a page that is leaving. That reasoning assumed the page is destroyed — but the browser's
  back/forward cache does not destroy it. Pressing Back restores the launcher page from memory with
  React state intact, so the user returned to a spinner that never stopped, on a button that
  `disabled={disabled || isPending}` had locked. The only way out was a manual reload.

  The hook now listens for `pageshow` and clears `isPending` when `event.persisted` is true, which is
  the only observable signal of a bfcache restore — there is no unmount, no re-render and no fresh
  mount to hang the reset off. Everything else is unchanged: `isPending` still stays true right after
  a successful mint (the anti-flicker guarantee), and an ordinary `pageshow` from a fresh load is
  ignored. The listener is registered in an effect (so SSR never touches `window`) and removed on
  unmount.

  Covered by four new specs, including one that pins the anti-flicker behaviour so the fix cannot be
  "simplified" into clearing the flag on the success path.

## 0.12.1

### Patch Changes

- 60ece0d: Fix: scope the console session cookie to `/` so it reaches the SPA shell.

  The cookie was scoped to `apiBasePath`. When a host mounts the API outside `basePath` — e.g. a
  `/media` UI with a `/api/media/console` API — the browser withheld the cookie on the full-page
  navigation to `basePath`, so a freshly minted session could not open the console it had just been
  minted for. The launcher landed on the unauthenticated page, which reads as "you lack access".

  This surfaced once the SPA shell itself became gated (0.10.0). Before that only the JSON API was
  guarded, and a cookie scoped to the API base was enough.

  `Path=/` now matches `@dudousxd/nestjs-durable-dashboard` and `@dudousxd/nestjs-agent-dashboard`,
  which reached the same conclusion for the same reason. (`@dudousxd/nestjs-telescope-ui` correctly
  keeps its narrower mount-scoped cookie: it has a single `path` option, so its UI and API always
  share one root and a tighter scope is both correct and safer.)

  Guarded by a new spec that reads the `Path` attribute and applies the RFC 6265 path-match rule.
  Every existing test replayed the cookie as `setCookie.split(';')[0]`, discarding the attribute that
  was wrong — `fetch` and supertest send whatever header they are handed, so no amount of round-trip
  testing through them could have caught this.

## 0.12.0

### Minor Changes

- b80563a: **React tier for the console launcher: `useOpenMediaConsole`, `openMediaConsoleMutationOptions` and `<OpenMediaConsoleButton>`, exported from the new `@dudousxd/nestjs-media-dashboard/react` subpath.**

  `openMediaConsole` (the headless function shipped last release) left every host re-deriving the same
  three things: a `useState` for in-flight, a `useState` for the refusal, and a button that renders
  both. That is the same code in every host, and the interesting parts of it — not clearing the
  pending state on success, not swallowing the refusal — are exactly the parts a host gets wrong.

  Three levels, pick the one that fits:

  ```tsx
  import {
    OpenMediaConsoleButton, // drop-in, unstyled
    useOpenMediaConsole, // state for a launcher UI, your markup
    openMediaConsole, // no React at all — also on ./client
  } from "@dudousxd/nestjs-media-dashboard/react";

  <OpenMediaConsoleButton
    className="btn btn-primary"
    apiBasePath="/api/media"
  />;
  ```

  `<OpenMediaConsoleButton>` ships **no CSS**: it emits a bare `<button>` and forwards
  `className`/`style`/every other button prop, so it inherits the host's design system instead of
  importing styles that fight it. It disables itself and sets `aria-busy` while the mint is in flight
  (a double-click otherwise fires a second mint that can land after the navigation), and it renders
  the refusal by default as `<p role="alert">` — a launcher that silently does nothing reads as broken
  rather than forbidden. `renderError` substitutes your own node; `renderError={null}` opts out for a
  host that surfaces errors its own way.

  `useOpenMediaConsole` gives the same behaviour with your markup. Its `open()` never rejects — read
  `error`. It deliberately does **not** clear `isPending` on success: the navigation is already
  underway, and flipping back to idle flickers "ready to click again" on a page that is leaving.

  `openMediaConsoleMutationOptions` returns the shape `useMutation` takes, so a host already on
  TanStack Query wires the launcher into its own cache, devtools and error handling with no adapter —
  **and this package never imports `@tanstack/react-query`**, so a host that doesn't use Query pays
  nothing. Its key includes both `basePath` and `apiBasePath`, since `apiBasePath` decides which
  endpoint mints the session: two mounts differing only in it must not share cache state.

  `react` and `react-dom` are **optional** peer dependencies, and the tier lives on its own subpath, so
  a host that only mounts `MediaDashboardModule` still never pulls React in.

  Additive only: nothing existing changes.

## 0.11.0

### Minor Changes

- 621cbfa: **Headless console launcher: `openMediaConsole` / `mintMediaConsoleSession` / `mediaConsoleSessionUrl`, exported from `@dudousxd/nestjs-media-dashboard/client`.**

  The console is entered from the HOST's app: a browser navigation to it carries no identity, so
  something inside the host has to mint the Mode A session cookie first (an XHR that _does_ carry the
  host's auth), then navigate. Every host was writing that by hand, which meant hardcoding two things
  this package owns:

  - **the session endpoint's path** — `<apiBasePath>/session`. Nothing tells a host when that moves; the break
    only shows up as a runtime 404 after a version bump.
  - **`redirect: 'manual'`** — and this one is a real trap. `fetch` follows redirects by default, so a
    host whose auth layer rewrites a 401 into a sign-in redirect gets a resolved 200 against the
    sign-in HTML. `response.ok` reads true, the caller navigates, and the user lands in a console with
    no session — indistinguishable from a permissions bug. The helper detects the redirect (browser
    opaque response _and_ Node/undici 3xx) and throws a message naming the likely cause.

  ```ts
  import { openMediaConsole } from "@dudousxd/nestjs-media-dashboard/client";

  await openMediaConsole({
    headers: () => ({ Authorization: `Bearer ${token()}` }),
  });
  ```

  No UI: the host owns the button, the page and the copy. `headers` accepts a sync or async function
  so a refreshing token is read at call time rather than captured at wiring time. `fetch` and
  `navigate` are injectable (tests, routers, non-browser callers). A refused mint throws
  `ConsoleSessionError` (carrying `status` and `url`) and **does not navigate** — a denied user gets a
  real error instead of the console's "no session" page.

  Note this package's session endpoint hangs off **`apiBasePath`**, not `basePath` — the auth
  controller ships with the console's JSON API, which mounts separately from the SPA. The helper
  mirrors the module's own `apiBasePath ?? `${basePath}/api`` defaulting, so a host that only moved
  the SPA still reaches the right endpoint instead of a 404.

  Additive only: nothing existing changes.

## 0.10.0

### Minor Changes

- 93214cf: **`auth.unauthenticatedPage` — hosts can now render the console's unauthenticated page themselves.**

  Under Mode A, a visitor navigating straight to `/media` with no cookie got the SPA shell, which then
  rendered the built-in auth screen: _"open this console from your application."_ Deliberately
  generic, because the library cannot know who hosts it — it can't name the host's launcher, link to
  it, or look like the rest of the host's product.

  ```ts
  auth: {
    secret: process.env.CONSOLE_SECRET,
    session: (request) => resolveAdmin(request),
    unauthenticatedPage: ({ request, response, basePath }) => {
      (response as Response).status(401).render('console-locked', { returnTo: basePath });
    },
  }
  ```

  Unlike `@dudousxd/nestjs-durable-dashboard` and `@dudousxd/nestjs-agent-dashboard`, this console's
  auth screen is a React component inside the published bundle — there is no server-rendered page to
  replace. So the hook gates the **SPA shell route** instead: the session is checked before the shell
  is served, which also means the bundle no longer loads at all for a visitor with no session.

  `MediaConsoleApiModule` now **exports** `MEDIA_CONSOLE_AUTH`. `MediaDashboardUiController` is hosted
  in `MediaDashboardModule` while the auth provider lives in the API module, so without the export the
  controller resolved `null` and the hook would silently never fire. Exporting (rather than
  re-providing) keeps a single provider instance — re-providing the same factory would run a
  `forRootAsync` host's `useAuth` twice.

  **Mode-A-only by design.** With `login` configured the hook is ignored: under Mode B the login form
  the visitor needs is _inside_ the bundle this page would replace, so gating the shell would lock a
  Mode B host out of its own console.

  Fail-closed by construction: it only runs when the request has no valid session, and every data
  route stays behind `MediaConsoleGuard` regardless — a test asserts the API stays `401` even when the
  hook answers `200`. A hook that throws, or returns without writing, logs one warning and serves the
  SPA rather than hanging the request or turning a navigation into a `500`.

  The index route became non-passthrough `@Res()` so the host can own the response; its
  `Content-Type`/`Cache-Control` moved from decorators into the new `sendHtml` helper, unchanged.

  Fully backward compatible — omit the option and the shell is served exactly as before, with no
  session check on that route at all.

## 0.9.0

### Minor Changes

- 85fc820: Console session sliding renewal now re-checks the user: add an optional `auth.revalidate` hook, called at most once per `ttl/2` per session on the renewal path.

  Previously, sliding renewal re-issued the session cookie without ever consulting the host, so a deactivated or demoted operator kept console access for as long as the tab stayed open. `auth.revalidate(session)` receives the already-minted session (not a raw request — the console's own XHRs carry no host credential) and returning `false` (or throwing) clears the cookie and denies the request with the same 401 an absent cookie gets. `revalidate` is not an auth mode on its own — it cannot mint a session — and behavior is unchanged when it's omitted.

  Because it only runs on the renewal path, revocation isn't immediate: a revoked operator can keep console access for up to `ttl / 2` after the change lands host-side.

## 0.8.0

### Minor Changes

- b36b6dc: Deep-linkable file preview: the Disks-tab preview panel now reads/writes a `preview=<key>` hash param, so a file preview can be opened directly via URL.

  `parseHash` picks up `preview=<objectKey>` (only when a disk segment is present) and exposes it as `route.preview`. Opening a file's preview now writes that param (alongside the existing `prefix`), closing it clears the param, and a deep link like `#/disks/<disk>?prefix=<folder>/&preview=<fullObjectKey>` opens the console with that file's preview already open. Keys containing slashes round-trip through `URLSearchParams`.

## 1.0.0

### Patch Changes

- Updated dependencies [8852c83]
  - @dudousxd/nestjs-media-core@0.8.0

## 0.7.1

### Patch Changes

- b527326: Docs + regression tests confirming the console's built-in `auth.login` hook already receives the
  submitted password verbatim end-to-end — including an empty string, since `AuthScreen`'s password
  input never marks the field `required` and `MediaConsoleAuthController` only checks the body value
  is a string, not a non-empty one. No code path was blocking empty passwords; this closes the gap
  for hosts whose `login` hook gates on username alone (e.g. email must be an active admin) and
  deliberately ignores the password. Documented the pass-through in the dashboard config reference
  and added tests asserting: the hook is called with `''`, a hook rejecting an empty password still
  uniform-fails with `401`, and a hook accepting one mints the session.

## 0.7.0

### Minor Changes

- 334d09f: Add first-class `guards` (`Array<Type<CanActivate> | CanActivate>`) and `imports` options to
  `MediaDashboardModule.forRoot`/`forRootAsync`, mirroring `@dudousxd/nestjs-agent`'s dashboard
  module and `@dudousxd/nestjs-telescope`'s console guards. Hosts with header-only auth can't gate a
  full-page navigation to the console (browsers send only cookies, never an `Authorization` header),
  so there was previously no seam to hang a cookie/session guard on the page controller.

  `guards` fronts BOTH surfaces: the page/asset controller (`MediaDashboardUiController` — a plain
  REPLACE, it ships with no guard of its own) and the read + action JSON API controllers (APPENDED to
  their own built-in `MediaConsoleGuard` session-cookie gate via a `stampGuards` helper, so a request
  must pass both). It is deliberately NOT applied to the auth controller that mints that session
  cookie — it can't require the very auth it grants. `guards` and the built-in `auth` cookie login
  compose (set one, the other, or both).

  Adds a "Securing the console with your own guards" docs section
  (`website/content/docs/packages/dashboard.mdx`, a new package doc page).

## 0.6.1

### Patch Changes

- 991c55d: Disk browser: fix a frozen page when a bucket has a stray leading-slash key

  A key with a leading slash makes S3 emit an empty-named `/` "folder" (CommonPrefix). Because the driver normalizes an all-slash prefix back to the root, listing _into_ that folder returned the root again — the phantom included — a self-reference that infinite-looped the folder tree and froze the page.

  - The listing now drops folders whose name is empty (all-slash CommonPrefixes). Those leading-slash keys are unreachable from the console anyway (the driver strips the leading slash).
  - The folder tree gained a cycle guard: a child that repeats an ancestor node is skipped, so no self-referential listing can recurse forever.

## 0.6.0

### Minor Changes

- 5767e88: Disk browser: cross-bucket copy/move, folder move/copy/rename, and toast notifications

  - **Cross-bucket copy/move** — copy or move a file or folder to a different disk, not just within the same one. Same-disk transfers still use the driver's native server-side copy/move; cross-disk transfers stream the bytes through the server (buffered, content type preserved, bounded at 100 MB per object). Dragging a row onto another bucket's tree node now works too.
  - **Folder actions** — folders gain Copy to…, Move to…, and Rename alongside Delete. The copy/move picker spans every disk so you can relocate a whole folder across buckets.
  - **Rename in place** — a dedicated rename dialog for files and folders (a single name input, no tree).
  - **Toasts replace `window.alert`** — actions report success and failure through non-blocking corner notifications instead of native browser dialogs.

## 0.5.0

### Minor Changes

- f45f7c8: Console disk browser: drag-and-drop move onto the tree, and a folder-tree picker in the copy/move dialog.

  - **Drag-and-drop move.** File and folder rows are now draggable; drop one onto any node in the left file-tree (a folder or a bucket root) to move it there. Folders move recursively, preserving their internal structure. Same-disk only — dropping onto a different bucket is rejected (cross-bucket move needs server-side cross-disk copy).
  - **Folder-tree destination picker.** The "Copy to…" / "Move to…" dialog now shows the disk's folder tree; pick the destination folder and edit the filename instead of typing a raw key. A live "To …" line previews the resulting key.
  - **New `moveFolder` endpoint.** `POST /disks/:disk/move-folder` relocates every object under a prefix (nested included), preserving relative paths and the folder marker, and rejects moving a folder into itself or a descendant.

## 0.4.1

### Patch Changes

- cd818fc: Auto-expand the selected disk's root in the file tree. The tree mounted before the disk list resolved, so its initial-expand never captured the selected disk and every bucket loaded collapsed. It now mounts only once disks are available, so the current disk's root opens by default.

## 0.4.0

### Minor Changes

- 57aee37: Console disk browser: a collapsible file-structure tree and a themed copy/move dialog.

  - **File-structure tree.** The left rail is now a lazy, collapsible explorer: each disk (bucket) is an expandable root, and expanding a node fetches only that level's sub-folders (sharing the main pane's `objects` query cache). Clicking any node navigates the contents pane; the current location is highlighted. This doubles as the bucket switcher — every configured disk is a root you can expand and browse without leaving the tree.
  - **Themed copy/move dialog.** "Copy to…" / "Move to…" now open a styled modal with a destination-key input pre-filled with the source key (the filename is preselected for a one-keystroke rename), replacing the old `window.prompt`.

## 0.3.1

### Patch Changes

- 4775e1e: Fix folder uploads and recursive folder delete.

  - **Upload/create inside a folder no longer double-slashes the key.** The browsed prefix arrives from S3 folder navigation with a trailing slash (CommonPrefixes end in the delimiter), so joining it to a filename produced `folder//file`, which surfaced as a phantom nested folder. The key builder now strips the trailing slash before joining.
  - **Folder delete is now genuinely recursive.** The sweep listed with the driver's default `/` delimiter, which groups nested keys into CommonPrefixes — so only direct children were deleted and anything nested survived. It now lists flat (empty delimiter) and deletes the zero-byte marker explicitly (its key equals the sweep prefix, which listing filters out).

## 0.3.0

### Minor Changes

- 0807477: Console disk browser: recursive folder delete, buffered uploads, and themed action dialogs.

  - **Delete folders.** New `DELETE /disks/:disk/folder` endpoint (and `deleteFolder` client method) recursively removes every object under a prefix plus its marker, paginating the sweep. Folder rows now carry a Delete action.
  - **Fix upload 500s.** `putObject` now buffers the request stream before writing, so S3's `PutObject` gets the Content-Length it requires instead of failing on an unbounded stream. Bounded at 100 MB (413 past that) to keep a runaway upload off the pod heap — larger files belong on the resumable path.
  - **Themed dialogs.** Upload (file picker + drop zone + per-file progress), New folder (named input), and delete confirmation now render as styled modals instead of `window.prompt`/`confirm`/`alert`.

## 0.2.1

### Patch Changes

- 74e9f4d: Call `driver.stat()` directly in the console service now that `StorageDriver.stat` is required — the
  `driver.size()` fallback ternaries were dead code.
- Updated dependencies [74e9f4d]
  - @dudousxd/nestjs-media-core@0.7.0

## 0.2.0

### Minor Changes

- 5d84138: Add a built-in login gate to the console, telescope-style. Pass `auth: { secret, login?, session? }` to `MediaDashboardModule.forRoot(...)` and the console (SPA + API) sits behind a signed, stateless HMAC session cookie: the SPA renders a login screen until a valid cookie exists, `login`/`session` hooks validate the credentials/request, and the read + action controllers are gated (401 → the SPA shows the login screen). Omit `auth` to leave the console open as before. No new runtime dependency — `node:crypto` only.

## 0.1.3

### Patch Changes

- ed4fd93: Preview very large text/CSV files by sampling their head: the client streams only the first few MB and aborts the transfer, so a multi-hundred-MB CSV previews (its start) instead of hitting a "too large" wall. A banner marks the sample, and the grid's sort/filters operate on the loaded portion. Spreadsheets can't be head-sampled (a workbook is a zip), so their inline-preview size cap is raised instead.

## 0.1.2

### Patch Changes

- 628606d: Preview lightbox: render into a `document.body` portal so the modal is always centered against the viewport (a transformed/blurred ancestor no longer offsets it and forces the page to scroll), and give the panel a stable large height with each preview filling it — short text/JSON no longer collapse the modal to a sliver.

  Data grid (CSV/TSV + spreadsheet previews): sortable columns (click a header to cycle asc → desc → off, numeric-aware), a per-column filter box plus the global filter, and row windowing that renders only the visible rows — the 500-row cap is gone, so large files scroll smoothly.

## 0.1.1

### Patch Changes

- 8d1c700: Media console: a durable-style dark theme (Space Grotesk + JetBrains Mono, blueprint backdrop, emerald accent), an object-preview lightbox, and disk file management.

  - **Preview lightbox** — images, video, audio and PDF render inline; CSV/TSV/JSON stream through a new same-origin inline object proxy and render as a filterable table / pretty-printed text; XLSX/XLS/ODS workbooks are parsed with SheetJS into a per-sheet filterable table. Large files fall back to an "open original" card.
  - **File management** (actions-gated) — upload files (button + drag-drop) and create folders, via new `POST disks/:disk/upload` (raw stream) and `POST disks/:disk/folder` routes.
  - Adds `xlsx` (bundled into the SPA) and a `GET disks/:disk/object/raw` inline-streaming proxy.

## 0.1.0

### Minor Changes

- 9901000: Add `@dudousxd/nestjs-media-dashboard` — a standalone, navigable `/media` console.

  A self-mounting React SPA + JSON API (like `@dudousxd/nestjs-durable-dashboard`) for browsing storage disks and their object tree, watching live resumable uploads, and browsing the media library by collection with variant thumbnails. Mount with `MediaDashboardModule.forRoot({ basePath, apiBasePath, actions })`; depends only on `-core` and resolves the media tokens by value, degrading to empty shapes when a `MediaStore`/upload store is absent (never throws). Destructive actions (delete/copy/move object, delete record, cancel session) are gated behind `actions: true` (default off). No built-in auth — the host guards the mount.

  Note on "Cancel session": it removes the resumable session record from the upload store (so it stops showing as in-progress) but does NOT tear down an underlying native multipart upload — the decoupled console resolves only the `UploadSessionStore`, not the `ResumableUploadManager` that owns `abort()`. An incomplete multipart is reaped by the bucket lifecycle policy.

  Supporting SPI added to enable the console (all optional/additive — non-breaking):

  - **core**: `MediaStore.list?(filter, page)` — paginated global record listing with an opaque `(createdAt, id)` keyset cursor (`MediaListFilter`/`MediaListPage`/`MediaListResult`); `UploadSession.createdAt?` for upload age.
  - **database adapters** (mikro-orm, typeorm, prisma, drizzle): implement `list()` with a `(collection, createdAt, id)` index. For already-deployed tables add a manual `CREATE INDEX` migration.
  - **upload-redis / testing**: set `createdAt` on session create; in-memory `MediaStore.list()`.

### Patch Changes

- Updated dependencies [9901000]
  - @dudousxd/nestjs-media-core@0.6.7
