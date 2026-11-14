---
"@dudousxd/nestjs-media-dashboard": minor
---

The console's HTTP lists now speak the Aviary list API. **Breaking for direct API callers** (the bundled SPA and `mediaConsoleClient` are updated):

- `GET disks/:disk/objects` answers `{ data, folders, meta }`: the level's files under `data`, its folders beside them, and the cursor envelope `meta: { nextCursor, prevCursor, hasNext, hasPrev }`. Page with `after` (a previous `meta.nextCursor`) and `first` (default 50, at most 1000); `cursor` and `limit` are gone. `prefix` stays: it names the folder being listed, not a filter. A forged cursor, a bad `first`, or `before` (it pages forward only) answers 400.
- `GET library` answers `{ data, meta }` with the same cursor envelope. Filters are `filter[collection]` and `filter[disk]`; page with `after` and `first` (default 50, at most 200). `collection`, `disk`, `cursor` and `limit` are gone; an unknown filter field or operator is a 400. A forged `after` is a 400 too when the store implements the new optional `MediaStore.isListCursor` (every bundled store does); with a third-party store that lacks it, the listing restarts from the first page as before.
- `GET uploads` answers `{ data }` (was `{ uploads }`), filtered by `filter[disk]` and `filter[key][startsWith]` (were `disk` and `prefix`).
- Every list answers 400, naming the replacement, for a query param it does not read: the old `cursor` / `limit`, a bare `collection` / `disk` / `prefix` on `library` or `uploads`, paging params on the unpaged `uploads`.
- `GET library/collections` answers `{ data }` (was `{ collections }`); `GET disks` answers `{ data }` (was `{ disks }`).
- `MediaConsoleService.listObjects/listLibrary/listUploads/listCollections/listDisks` return the same shapes. The `media_*` dev tools keep `{ items, next }`.
