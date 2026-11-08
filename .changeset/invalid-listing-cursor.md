---
'@dudousxd/nestjs-media-core': patch
'@dudousxd/nestjs-media-dashboard': patch
---

A forged folder-listing `cursor` throws `InvalidListingCursorError` (a `TypeError` with `status` 400), which the media console answers as 400 instead of 500.
