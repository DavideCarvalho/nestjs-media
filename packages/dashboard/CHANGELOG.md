# @dudousxd/nestjs-media-dashboard

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
