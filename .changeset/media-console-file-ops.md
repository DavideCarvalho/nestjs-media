---
"@dudousxd/nestjs-media-dashboard": patch
---

Media console: a durable-style dark theme (Space Grotesk + JetBrains Mono, blueprint backdrop, emerald accent), an object-preview lightbox, and disk file management.

- **Preview lightbox** — images, video, audio and PDF render inline; CSV/TSV/JSON stream through a new same-origin inline object proxy and render as a filterable table / pretty-printed text; XLSX/XLS/ODS workbooks are parsed with SheetJS into a per-sheet filterable table. Large files fall back to an "open original" card.
- **File management** (actions-gated) — upload files (button + drag-drop) and create folders, via new `POST disks/:disk/upload` (raw stream) and `POST disks/:disk/folder` routes.
- Adds `xlsx` (bundled into the SPA) and a `GET disks/:disk/object/raw` inline-streaming proxy.
