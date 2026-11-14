---
"@dudousxd/nestjs-media-dashboard": patch
---

`disks/:disk/objects`: a forged or garbage `after` is now a 400 (`Malformed cursor in "after".`), never a 500 from the store (S3 `InvalidArgument`, a disk's cursor `TypeError`). The cursor is now an opaque console cursor wrapping the driver token and bound to its disk and folder, so a raw token or one from another folder is rejected before the store sees it. `last` is a 400 with a hint on the forward-only lists (`disks/:disk/objects`, `library`) instead of acting like `first`.
