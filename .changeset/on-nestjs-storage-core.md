---
"@dudousxd/nestjs-media-core": minor
---

**Breaking:** the media layer runs on the disks of NestJS's first-party `@nestjs/storage` (new peer, `>=0.0.5 <0.1.0`, type-only in core).

- `MediaLibrary`, `AttachmentManager`, `ResumableUploadManager`, `DirectUploadManager` and the tus handler take `storage: Storage` (or any `MediaDisks`: `disk(name)`, `names()`, `defaultDisk`) and use `StorageDisk`'s `put`/`getBuffer`/`get().body`/`delete([...])`/`url`/`signedUrl`.
- Removed, with no shims: `StorageManager`, `StorageManagerOptions`, `StorageDriver`, `DriverCapabilities`, `PutOptions`, `ListOptions`, `ListResult`, `ListEntry`, `StatResult`, `ReadRangeOptions`, `TemporaryUrlOptions`, `Visibility`, `isMultipartCapable`, `collectStream`, `FileNotFoundError`, `UnknownDiskError`, `AttachmentManager.temporaryUrl`.
- Native multipart is a per-disk side-car: `MultipartUploadDriver` (optional `listFolders`) passed as `multipart: { [disk]: driver }` to the upload managers; `multipartFor()`, `requireMultipart()`.
- New: `diskCapabilities(disk, sidecar)`, `listFolderLevel()` / `foldListing()` (one folder level from a flat listing, cursor-paged without repeats), `keySegment()` / `assertMediaKey()` / `folderPrefix()` / `InvalidMediaKeyError` (the `@nestjs/storage` key rule), `fileUrl()`, `MediaLibrary.locate()`, `AttachmentManager.signedUrl()`.
- `MediaLibrary.url()` and `AttachmentManager.url()` return the public URL when the disk has a `publicUrl`, else a signed one.
- Keys built from user input (file names, owner ids, the default tus key) go through `keySegment()`; ordinary names are unchanged. A custom tus `keyFor` returning an invalid key answers 400. Resumable assembly passes the received byte count as `contentLength`.
- `resolveUploadMode()` takes `{ presign, multipart }` (`MediaDiskCapabilities`).
