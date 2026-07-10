---
'@dudousxd/nestjs-media-dashboard': minor
---

Console disk browser: drag-and-drop move onto the tree, and a folder-tree picker in the copy/move dialog.

- **Drag-and-drop move.** File and folder rows are now draggable; drop one onto any node in the left file-tree (a folder or a bucket root) to move it there. Folders move recursively, preserving their internal structure. Same-disk only — dropping onto a different bucket is rejected (cross-bucket move needs server-side cross-disk copy).
- **Folder-tree destination picker.** The "Copy to…" / "Move to…" dialog now shows the disk's folder tree; pick the destination folder and edit the filename instead of typing a raw key. A live "To …" line previews the resulting key.
- **New `moveFolder` endpoint.** `POST /disks/:disk/move-folder` relocates every object under a prefix (nested included), preserving relative paths and the folder marker, and rejects moving a folder into itself or a descendant.
