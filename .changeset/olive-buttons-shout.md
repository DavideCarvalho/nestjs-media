---
'@dudousxd/nestjs-media-dashboard': minor
---

Let the console download a file, and let the host choose how object URLs are reached.

The /media console could preview a file and copy its key, but never save it. The only way out was
the preview's `Open ↗`, a presigned URL straight to the object store — which is no use at all on a
host whose browser cannot reach that store.

- **`GET disks/:disk/object/download`** — the same bytes as `object/raw`, but as
  `Content-Disposition: attachment` named after the key's last segment, in both RFC 6266 forms so a
  non-ASCII name survives. Honours `Range`, so an interrupted download of a large object resumes.
  Same-origin and unconditional: saving a file is the console's own action, so it works wherever the
  console does. It is a read, so it needs no `actions: true`. `object/raw` stays `inline` — every
  preview depends on that.
- **`Download` in the UI** — on each file row in Disks, in the preview header beside `Open ↗`, and
  on a library record and each of its variants.
- **`objectUrls?: 'auto' | 'proxy'`** — a new option governing the `url` reported by
  `disks/:disk/object` and `library/:id` (what `Open ↗` and an image variant's `src` point at).
  `'auto'` (the default) is the existing behaviour: presigned straight to the store. `'proxy'`
  routes it same-origin through the console instead, for a host with no client-to-store path.
  Downloading is unaffected either way.
- `LibraryVariant` now carries `disk` and `path` alongside `url`, so the UI can reach the object
  routes for a variant.

`mediaConsoleClient` gains `objectDownloadUrl(disk, key)`, the download twin of `objectRawUrl`.
