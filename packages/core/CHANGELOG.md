# @dudousxd/nestjs-media-core

## 0.4.0

### Minor Changes

- be47230: Media diagnostics now publish through `@dudousxd/nestjs-diagnostics` (`aviary:media:*`), so any app using `@dudousxd/nestjs-diagnostics-telescope`'s generic watcher auto-captures media events (upload/attach/conversion/delete) with zero per-lib wiring. The standalone `MediaWatcher` is superseded by that bridge but kept for standalone use.

## 0.3.0

### Minor Changes

- 99777bb: Add a driver-agnostic `list(prefix, options?)` to the `StorageDriver` contract (returns `{ folders, files, cursor? }`), implemented for the S3 (ListObjectsV2 with optional bucket override), local (readdir), and in-memory drivers, plus a `list` capability flag. The S3 `list` honours `options.bucket` for admin cross-bucket browsing. The MikroORM database adapter now supports MikroORM 7 (peer `^6 || ^7`).
