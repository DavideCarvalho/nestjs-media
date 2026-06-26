---
name: resumable-and-direct-uploads
description: >-
  Configure large-file uploads in @dudousxd/nestjs-media. The proxy path streams
  bytes through NestJS via a resumable tus 1.0.0 server — enable it with
  uploadSessions (e.g. RedisUploadSessionStore or InMemoryUploadSessionStore) plus
  the tus option, which mounts MediaUploadController at media/uploads and REQUIRES
  an application/offset+octet-stream raw-body parser. The direct path uses
  presigned S3 multipart — enable it with the direct option, which mounts
  MediaDirectUploadController at media/uploads/direct and needs a presign/multipart
  disk (no session store). resolveUploadMode picks proxy vs direct
  (per-call > per-disk > global > auto). Reach the engines via
  MediaService.uploads (ResumableUploadManager) and MediaService.directUploads
  (DirectUploadManager). Explains the missing-raw-parser failure and the
  UnsupportedOperationError when forcing direct on a non-presign disk.
license: MIT
metadata:
  type: core
  library: "@dudousxd/nestjs-media"
  library_version: 0.5.0
  framework: nestjs
---

# Resumable (tus) and direct (presigned multipart) uploads

Two upload shapes:

- **proxy** — bytes flow through NestJS in chunks over a resumable **tus 1.0.0**
  server. Works on any disk; lets you scan/transform on the way in.
- **direct** — the browser PUTs chunks straight to S3 via presigned URLs; your
  backend only orchestrates. Needs a presign/multipart-capable disk (S3).

## Setup — proxy (tus)

Give the module an `uploadSessions` store and the `tus` option, then register the
raw-body parser for tus PATCH bodies.

```ts
// app.module.ts
import { MediaModule } from '@dudousxd/nestjs-media';
import { RedisUploadSessionStore } from '@dudousxd/nestjs-media-upload-redis';

MediaModule.forRootAsync({
  inject: ['REDIS'],
  useFactory: (redis) => ({
    default: 'local',
    disks: { local },
    uploadSessions: new RedisUploadSessionStore(redis), // or InMemoryUploadSessionStore from -testing
    uploadTmpPrefix: '.uploads',                         // where in-progress chunks stage (default)
    tus: { disk: 'local', basePath: '/media/uploads', maxSize: 100 * 1024 * 1024 },
  }),
});
```

```ts
// main.ts — REQUIRED for the proxy path
import express from 'express';
app.use('/media/uploads', express.raw({ type: 'application/offset+octet-stream', limit: '50mb' }));
```

This mounts `MediaUploadController` (OPTIONS / POST / HEAD / PATCH / DELETE) at
`media/uploads`. Source: `packages/nestjs/src/media-upload.controller.ts`.

## Setup — direct (presigned S3 multipart)

```ts
MediaModule.forRoot({
  default: 's3',
  disks: { s3 },
  direct: { disk: 's3', partSize: 8 * 1024 * 1024 }, // partSize optional, default 8 MiB
});
```

This mounts `MediaDirectUploadController` at `media/uploads/direct` (initiate /
parts / complete / abort) and exposes `media.directUploads`. No session store and
no raw-body parser are needed — S3 holds the in-progress upload, keyed by its
`uploadId`. Source: `packages/nestjs/src/media-direct-upload.controller.ts`.

## Core patterns

### 1. `resolveUploadMode` — who picks the path

```ts
type UploadMode = 'auto' | 'proxy' | 'direct';
```

Resolution is most-specific-wins: **per-call ▸ per-disk ▸ global ▸ `auto`**.
`auto` resolves to `direct` when the driver is presign/multipart-capable (S3),
else `proxy` (local). `proxy` is always allowed; `direct` throws on a disk that
can't presign — so forcing it fails loudly rather than silently degrading.
Source: `packages/core/src/upload-mode.ts`.

### 2. Drive the proxy engine directly

`media.uploads` is the framework-agnostic `ResumableUploadManager` behind the tus
controller — use it from your own transport:

```ts
const session = await this.media.uploads.createUpload({ disk: 's3', key: 'videos/clip.bin', size });
await this.media.uploads.writeChunk(session.id, 0, chunkA);      // -> { offset }
await this.media.uploads.writeChunk(session.id, offset, chunkB);
const { key } = await this.media.uploads.complete(session.id);   // assembles + cleans up parts
```

### 3. Drive the direct engine directly

`media.directUploads` is the `DirectUploadManager`:

```ts
const { uploadId, parts } = await this.media.directUploads.createUpload({
  disk: 's3', key: 'videos/clip.mp4', contentType: 'video/mp4', size,
}); // parts: [{ partNumber, url }, ...] presigned

// browser PUTs each part to its url, collects the ETag, then:
await this.media.directUploads.completeUpload({
  key: 'videos/clip.mp4', uploadId, parts: [{ partNumber: 1, etag: '"abc"' }],
});
```

## Common mistakes

### Mistake 1 — no raw-body parser for tus PATCH

```ts
// Wrong — without the raw parser, PATCH bodies aren't Buffers and chunks never
// assemble. This is the single most common setup mistake.
// (tus enabled, but main.ts registers no express.raw for the offset stream)

// Correct — register the raw parser on the tus base path.
app.use('/media/uploads', express.raw({ type: 'application/offset+octet-stream', limit: '50mb' }));
```

`MediaUploadController.patch` reads `req.body` as a `Buffer`; the offset
content-type must be parsed raw. Source:
`packages/nestjs/src/media-upload.controller.ts` and
`website/content/docs/concepts/uploads.mdx`.

### Mistake 2 — forcing `direct` on a non-presign disk

```ts
// Wrong — local can't presign multipart; createUpload throws UnsupportedOperationError.
await this.media.directUploads.createUpload({ disk: 'local', key: 'a.bin' });

// Correct — direct uploads require an S3 (presign/multipart) disk.
await this.media.directUploads.createUpload({ disk: 's3', key: 'a.bin' });
```

`DirectUploadManager.createUpload` checks `isMultipartCapable(driver)` and throws
`UnsupportedOperationError` otherwise. Source:
`packages/core/src/direct-upload.ts`.

### Mistake 3 — adding an `UploadSessionStore` for the direct path

```ts
// Wrong — the direct path is stateless on your side; a session store does nothing
// for it and `direct` won't enable the proxy/tus controller.
MediaModule.forRoot({ default: 's3', disks: { s3 }, uploadSessions: store, direct: { disk: 's3' } });

// Correct — uploadSessions/tus is the proxy path; direct needs only `direct`.
MediaModule.forRoot({ default: 's3', disks: { s3 }, direct: { disk: 's3' } });
```

`uploadSessions` powers the resumable proxy/tus engine where the backend tracks
the resume offset; the direct path keeps state in S3 under its `uploadId`.
Source: `website/content/docs/concepts/uploads.mdx`.
