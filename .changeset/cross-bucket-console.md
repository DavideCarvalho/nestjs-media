---
'@dudousxd/nestjs-media-dashboard': minor
---

Disk browser: cross-bucket copy/move, folder move/copy/rename, and toast notifications

- **Cross-bucket copy/move** — copy or move a file or folder to a different disk, not just within the same one. Same-disk transfers still use the driver's native server-side copy/move; cross-disk transfers stream the bytes through the server (buffered, content type preserved, bounded at 100 MB per object). Dragging a row onto another bucket's tree node now works too.
- **Folder actions** — folders gain Copy to…, Move to…, and Rename alongside Delete. The copy/move picker spans every disk so you can relocate a whole folder across buckets.
- **Rename in place** — a dedicated rename dialog for files and folders (a single name input, no tree).
- **Toasts replace `window.alert`** — actions report success and failure through non-blocking corner notifications instead of native browser dialogs.
