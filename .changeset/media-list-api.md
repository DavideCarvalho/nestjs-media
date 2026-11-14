---
"@dudousxd/nestjs-media-dashboard": minor
---

The console's HTTP lists now speak the Aviary list API. **Breaking for direct API callers** (the bundled SPA and `mediaConsoleClient` are updated):

- `GET disks/:disk/objects` answers `{ data, folders, meta }`: the level's files under `data`, its folders beside them, and the cursor envelope `meta: { nextCursor, prevCursor, hasNext, hasPrev }`. Page with `after` (a previous `meta.nextCursor`) and `first` (default 50, at most 1000); `cursor` and `limit` are gone. `prefix` stays: it names the folder being listed, not a filter. A forged cursor, a bad `first`, or `before` (it pages forward only) answers 400.
- `GET library` answers `{ data, meta }` with the same cursor envelope. Filters are `filter[collection]` and `filter[disk]`; page with `after` and `first` (default 50, at most 200). `collection`, `disk`, `cursor` and `limit` are gone; an unknown filter field or operator is a 400.
- `GET uploads` answers `{ data }` (was `{ uploads }`), filtered by `filter[disk]` and `filter[key][startsWith]` (were `disk` and `prefix`).
- `GET library/collections` answers `{ data }` (was `{ collections }`); `GET disks` answers `{ data }` (was `{ disks }`).
- `MediaConsoleService.listObjects/listLibrary/listUploads/listCollections/listDisks` return the same shapes. The `media_*` dev tools keep `{ items, next }`.
