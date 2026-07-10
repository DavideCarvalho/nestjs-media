---
'@dudousxd/nestjs-media-dashboard': minor
---

Console disk browser: a collapsible file-structure tree and a themed copy/move dialog.

- **File-structure tree.** The left rail is now a lazy, collapsible explorer: each disk (bucket) is an expandable root, and expanding a node fetches only that level's sub-folders (sharing the main pane's `objects` query cache). Clicking any node navigates the contents pane; the current location is highlighted. This doubles as the bucket switcher — every configured disk is a root you can expand and browse without leaving the tree.
- **Themed copy/move dialog.** "Copy to…" / "Move to…" now open a styled modal with a destination-key input pre-filled with the source key (the filename is preselected for a one-keystroke rename), replacing the old `window.prompt`.
