---
'@dudousxd/nestjs-media-dashboard': minor
---

Console disk browser: recursive folder delete, buffered uploads, and themed action dialogs.

- **Delete folders.** New `DELETE /disks/:disk/folder` endpoint (and `deleteFolder` client method) recursively removes every object under a prefix plus its marker, paginating the sweep. Folder rows now carry a Delete action.
- **Fix upload 500s.** `putObject` now buffers the request stream before writing, so S3's `PutObject` gets the Content-Length it requires instead of failing on an unbounded stream. Bounded at 100 MB (413 past that) to keep a runaway upload off the pod heap — larger files belong on the resumable path.
- **Themed dialogs.** Upload (file picker + drop zone + per-file progress), New folder (named input), and delete confirmation now render as styled modals instead of `window.prompt`/`confirm`/`alert`.
