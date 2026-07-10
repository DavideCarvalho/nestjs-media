---
"@dudousxd/nestjs-media-core": minor
---

`StorageDriver.stat` is now a required method instead of optional. Every bundled driver
(disk-s3, disk-local, testing's in-memory driver) already implemented it, so this only affects
third-party `StorageDriver` implementations — add a `stat(path): Promise<StatResult>` method to
your driver to stay compatible. `deleteMany` remains optional.
