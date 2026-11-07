---
"@dudousxd/nestjs-media-dashboard": minor
---

**Breaking:** the console reads the disks from `@nestjs/storage`'s `Storage` (new peer; Nest `^12.1`) and the multipart side-cars from `MEDIA_MULTIPART`; `MEDIA_STORAGE_SHARED` is removed.

- Capabilities are computed from the disk (`presign` when it signs, `publicUrls` with a `publicUrl`, `multipart` with a side-car; `ranged` is always true).
- Folders come from the side-car's delimiter listing, else are folded from the flat listing. A new folder is a hidden `<folder>/.keep` (`prefix/` markers are invalid keys); legacy markers show as folders but are skipped by deletes.
- `/raw` and `/download` go through `serveFile()`: `/raw` is `inline` only for script-safe types (images, PDF, audio, video, plain text), `If-None-Match` answers 304. `MediaConsoleService.objectStream`, `RangeNotSatisfiableException` and `parseRangeHeader` are replaced by `serveObject()`.
- Console uploads and cross-disk copies/moves stream, with no 100 MB caps; storage errors map to their HTTP status.
- `auto` object URLs: public URL, else signed, else the console's own `/raw` route.
