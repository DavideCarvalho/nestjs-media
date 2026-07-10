---
'@dudousxd/nestjs-media-dashboard': patch
---

Auto-expand the selected disk's root in the file tree. The tree mounted before the disk list resolved, so its initial-expand never captured the selected disk and every bucket loaded collapsed. It now mounts only once disks are available, so the current disk's root opens by default.
