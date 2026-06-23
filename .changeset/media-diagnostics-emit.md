---
"@dudousxd/nestjs-media-core": minor
"@dudousxd/nestjs-media-telescope": minor
"@dudousxd/nestjs-media-disk-s3": minor
"@dudousxd/nestjs-media-disk-local": minor
"@dudousxd/nestjs-media-testing": minor
"@dudousxd/nestjs-media-database-mikro-orm": minor
"@dudousxd/nestjs-media": minor
---

Media diagnostics now publish through `@dudousxd/nestjs-diagnostics` (`aviary:media:*`), so any app using `@dudousxd/nestjs-diagnostics-telescope`'s generic watcher auto-captures media events (upload/attach/conversion/delete) with zero per-lib wiring. The standalone `MediaWatcher` is superseded by that bridge but kept for standalone use.
