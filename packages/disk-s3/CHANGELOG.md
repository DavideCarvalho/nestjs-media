# @dudousxd/nestjs-media-disk-s3

## 0.8.0

### Minor Changes

- c03d5c7: Byte-range reads: `stream(path, { start, end })`, and a range-honouring `object/raw`.

  Every read in this library was all-or-nothing. `stream()` gave you the object from byte zero, so
  anything that wanted a slice — a file header, a footer, one page in the middle — had to transfer the
  whole object to reach it. For a thumbnail that is fine. For the 302 MB SQLite database or the 2 GB
  Parquet file someone dropped in a bucket, it means the console can either download it or show
  nothing, and it showed nothing.

  `StorageDriver.stream(path, range?)` now takes a `ReadRangeOptions { start, end? }` — both bounds
  inclusive, `end` omitted meaning "to EOF", the same convention as HTTP `Range`, because that is what
  it becomes at both ends of the wire. The S3 driver passes it through as `Range:` on `GetObject`; the
  local driver hands it to `createReadStream` (whose `end` is inclusive too, so no ±1); the in-memory
  test driver slices its buffer. The shared conformance suite gained cases for a mid-file range, a
  range running past EOF (clamps, never throws), and an open-ended one, so every driver has to agree.

  `DriverCapabilities.ranged` is **required**, not optional, and that is the breaking edge of this
  change: a third-party driver will stop compiling until it answers the question. That is the point. A
  driver that accepts the argument and quietly ignores it returns the whole object to a caller who
  asked for 64 KB, and the caller cannot tell — it just reads a few hundred megabytes believing it
  holds one page. A compile error is a much better way to find out than a memory spike in production.

  On the console side, `GET disks/:disk/object/raw` now speaks the protocol properly: `Accept-Ranges:
bytes` on every response, `206` with `Content-Range` and a sliced `Content-Length` for a satisfiable
  range, `416` with `Content-Range: bytes */<size>` for one that isn't, and a plain `200` — byte for
  byte what it served before — when there is no `Range` header or the header is malformed, per RFC 9110. `bytes=a-b`, `bytes=a-`, and the suffix form `bytes=-n` are all understood; a multi-range
  request is ignored rather than half-answered. A range against a disk whose driver reports
  `ranged: false` fails loudly instead of silently returning everything.

  The browser client gained `objectRange(disk, key, start, end)`. It throws when the server answers
  `200`, which is the entire reason it exists as a function rather than a `fetch` call at each call
  site: a reverse proxy that strips `Range` turns a 64 KB page read into a 302 MB one, and the failure
  would otherwise surface as a hang rather than an error.

## 0.7.2

### Patch Changes

- 36dd0b0: Stop the next `core` minor from publishing twelve packages as 1.0.0.

  Twelve packages declared their peer dependency on `@dudousxd/nestjs-media-core` as `workspace:*`. Changesets treats a peer bump as breaking for the dependent, and "breaking" on a `0.x` package means `1.0.0` — so the first minor `core` takes would promote the entire repo at once, with no `major` changeset anywhere in sight.

  This has not fired yet only because `core` has not taken a minor recently. The identical bug did fire in `nestjs-agent`, where six packages were queued to publish as `1.0.0` off a routine SPI change and were caught in the release PR.

  Ranges are now `>=0.8.0 <1.0.0`. `onlyUpdatePeerDependentsWhenOutOfRange` is already set in the changesets config; it just needs a range a `0.9.0` core still satisfies.

  Verified by simulation rather than argument: adding a throwaway `core: minor` changeset and running `changeset version` produces twelve `1.0.0` bumps before this change and zero after — `core` goes to `0.9.0` and every dependent stays on a patch.

  `workspace:*` in `dependencies` is left alone; it is resolved at publish and causes none of this. Only peers matter.

## 1.0.0

### Patch Changes

- Updated dependencies [8852c83]
  - @dudousxd/nestjs-media-core@0.8.0

## 0.7.0

### Minor Changes

- 556cae9: `stream()` now returns a hardened Body: connection death surfaces as a stream error instead of a silent permanent hang.

  Since response-checksum validation became the AWS SDK default, GetObject bodies are smithy `ChecksumStream`s wired to the socket with a bare legacy `pipe()`, which drops source errors. If S3/MinIO kills the connection mid-stream (e.g. idle timeout while the consumer applies backpressure), the Body never emits anything — pending reads hang forever and GC can collect the consumer's suspended await chain. `hardenBodyStream` (also exported) walks the `.source` wrapper chain and bridges error/premature-close from every layer into the Body, and tears the chain down (releasing the socket) when the Body is destroyed early.

## 0.6.9

### Patch Changes

- Updated dependencies [74e9f4d]
  - @dudousxd/nestjs-media-core@0.7.0

## 0.6.8

### Patch Changes

- Updated dependencies [9901000]
  - @dudousxd/nestjs-media-core@0.6.7

## 0.6.7

### Patch Changes

- Updated dependencies [70cba69]
  - @dudousxd/nestjs-media-core@0.6.6

## 0.6.6

### Patch Changes

- Updated dependencies [1410953]
  - @dudousxd/nestjs-media-core@0.6.5

## 0.6.5

### Patch Changes

- Updated dependencies [7c87433]
  - @dudousxd/nestjs-media-core@0.6.4

## 0.6.4

### Patch Changes

- caa8eea: `temporaryUrl()` gains an optional `TemporaryUrlOptions` argument (`responseContentType` / `responseContentDisposition`). The S3 driver maps these to the presigned GET's `response-content-type` / `response-content-disposition` overrides so a signed download can force a filename and content type. Backwards-compatible: the third argument is optional and existing 2-argument calls are unchanged.
- Updated dependencies [caa8eea]
  - @dudousxd/nestjs-media-core@0.6.3

## 0.6.3

### Patch Changes

- 76e953c: `S3Driver.list()` now falls back to a SigV4-signed raw GET + manual XML parse when fast-xml-parser rejects valid entity references in the `ListObjectsV2` response (a failure mode for consumers pinning fast-xml-parser >= 5.7). Happy path unchanged.

## 0.6.2

### Patch Changes

- 1d93957: Implement `S3Driver.stat()` (HeadObject) and `S3Driver.deleteMany()` (DeleteObjects, chunked at 1000 keys).
- Updated dependencies [03d5b48]
  - @dudousxd/nestjs-media-core@0.6.2

## 0.6.1

### Patch Changes

- Updated dependencies [28734af]
  - @dudousxd/nestjs-media-core@0.6.1

## 0.6.0

### Minor Changes

- b2f3d74: Proxy/tus uploads now stream each chunk into a native S3 multipart upload instead of buffering the whole file at `complete()`.

  - `ResumableUploadManager` uses the target disk's native multipart when `capabilities.multipart` is set: `createMultipartUpload` on start, one `uploadPart` per PATCH chunk (one chunk = one part), `completeMultipartUpload` on finish, `abortMultipartUpload` on abort. No whole-file `Buffer.concat` and no `get`-all read remain on the multipart path. Non-multipart disks (local, in-memory) keep the existing temp-object + concat behavior unchanged.
  - `disk-s3` gains a server-side `uploadPart(path, uploadId, partNumber, body)` for the proxy path (the presigned variant already existed for the direct path).
  - `RedisUploadSessionStore` now round-trips the new `multipartUploadId` / `partETags` session fields through `get()`, so multipart state survives a resume across replicas.

### Patch Changes

- Updated dependencies [b2f3d74]
  - @dudousxd/nestjs-media-core@0.6.0

## 0.5.0

### Minor Changes

- 05af5b4: Add presigned S3 multipart direct uploads (DirectUploadManager + MultipartUploadDriver surface + MediaDirectUploadController + MediaModule.direct option) and a Redis UploadSessionStore adapter (@dudousxd/nestjs-media-upload-redis) for multi-replica resumable proxy uploads. Both modes selectable via uploadMode.

### Patch Changes

- Updated dependencies [05af5b4]
  - @dudousxd/nestjs-media-core@0.5.0

## 0.4.0

### Minor Changes

- be47230: Media diagnostics now publish through `@dudousxd/nestjs-diagnostics` (`aviary:media:*`), so any app using `@dudousxd/nestjs-diagnostics-telescope`'s generic watcher auto-captures media events (upload/attach/conversion/delete) with zero per-lib wiring. The standalone `MediaWatcher` is superseded by that bridge but kept for standalone use.

### Patch Changes

- Updated dependencies [be47230]
  - @dudousxd/nestjs-media-core@0.4.0

## 0.3.0

### Minor Changes

- 99777bb: Add a driver-agnostic `list(prefix, options?)` to the `StorageDriver` contract (returns `{ folders, files, cursor? }`), implemented for the S3 (ListObjectsV2 with optional bucket override), local (readdir), and in-memory drivers, plus a `list` capability flag. The S3 `list` honours `options.bucket` for admin cross-bucket browsing. The MikroORM database adapter now supports MikroORM 7 (peer `^6 || ^7`).

### Patch Changes

- Updated dependencies [99777bb]
  - @dudousxd/nestjs-media-core@0.3.0
