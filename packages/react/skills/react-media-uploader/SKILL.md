---
name: react-media-uploader
description: >-
  Upload files from a React app to a @dudousxd/nestjs-media tus endpoint. Use the
  useMediaUpload() hook (returns status: idle|uploading|done|error, progress
  0..1, location, error, plus upload(file, { filename, contentType }) and reset),
  or the ready-made MediaUploader component (file input + progress bar,
  onUploaded / onError). Both wrap uploadMedia() — the resumable tus client that
  POSTs to create, PATCHes chunks with offset tracking, and reports progress —
  re-exported from @dudousxd/nestjs-media-client alongside mediaUrl(id,
  conversion?). Covers matching basePath to the server tus.basePath, chunkSize,
  fetchImpl injection, and the 0..1 (not 0..100) progress scale.
license: MIT
metadata:
  type: core
  library: "@dudousxd/nestjs-media-react"
  library_version: 0.2.0
  framework: react
---

# React media uploader

The React package wraps the framework-agnostic tus client (`uploadMedia`) in a
hook and a component, so a browser can upload directly to a
`@dudousxd/nestjs-media` tus endpoint with resume + progress.

This is the client half: it talks to the server's tus controller. The server must
have the proxy/tus path enabled (`uploadSessions` + `tus`) and a raw-body parser
registered — see the `resumable-and-direct-uploads` skill.

## Setup

```bash
pnpm add @dudousxd/nestjs-media-react
```

```tsx
import { useMediaUpload } from '@dudousxd/nestjs-media-react';

function Uploader() {
  const { upload, status, progress, location, error } = useMediaUpload({
    basePath: '/media/uploads', // must match the server tus.basePath
  });

  const onChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await upload(file, { filename: file.name, contentType: file.type });
  };

  return (
    <div>
      <input type="file" onChange={onChange} disabled={status === 'uploading'} />
      <progress value={progress} max={1} />
      {status === 'done' && <a href={location}>uploaded</a>}
      {error && <p role="alert">{error.message}</p>}
    </div>
  );
}
```

`status` is `'idle' | 'uploading' | 'done' | 'error'`; `progress` is a fraction
`0..1`; `location` is the created upload's URL once done. Source:
`packages/react/src/use-media-upload.ts`.

## Core patterns

### 1. The drop-in `MediaUploader` component

When you don't need custom markup, `MediaUploader` renders a file input + a
`<progress>` and calls back with the upload Location:

```tsx
import { MediaUploader } from '@dudousxd/nestjs-media-react';

<MediaUploader
  basePath="/media/uploads"
  accept="image/*"
  onUploaded={(location) => console.log('done', location)}
  onError={(err) => console.error(err)}
/>;
```

It's authored with `createElement` (no JSX runtime required by the package) and
takes `basePath`, `chunkSize`, `fetchImpl`, `accept`, `onUploaded`, `onError`.
Source: `packages/react/src/media-uploader.ts`.

### 2. The raw client — `uploadMedia` / `mediaUrl`

Both are re-exported from the React package (and live in
`@dudousxd/nestjs-media-client`). Use them outside React, or to build a URL:

```ts
import { uploadMedia, mediaUrl } from '@dudousxd/nestjs-media-react';

const { location } = await uploadMedia(file, {
  filename: file.name,
  contentType: file.type,
  basePath: '/media/uploads',
  chunkSize: 5 * 1024 * 1024,                 // default 5 MiB
  onProgress: (sent, total) => setPct(sent / total),
});

const thumb = mediaUrl(mediaId, 'thumb');     // -> /media/<id>?conversion=thumb
```

Source: `packages/client/src/index.ts`.

### 3. Inject `fetchImpl` for SSR / tests

`fetchImpl` overrides the global `fetch` (e.g. a polyfill or a mock):

```ts
const { upload } = useMediaUpload({ basePath: '/media/uploads', fetchImpl: myFetch });
```

## Common mistakes

### Mistake 1 — `basePath` doesn't match the server's `tus.basePath`

```ts
// Wrong — server mounts tus at '/media/uploads' but the client POSTs to '/uploads',
// so creation 404s (no Location header) and uploadMedia throws.
useMediaUpload({ basePath: '/uploads' });

// Correct — use the same path you passed to MediaModule's tus.basePath.
useMediaUpload({ basePath: '/media/uploads' });
```

`uploadMedia` POSTs to `basePath` to create the upload and reads the `Location`
header; a wrong path means no Location. Source: `packages/client/src/index.ts`.

### Mistake 2 — treating `progress` as a percentage (0..100)

```tsx
// Wrong — progress is a fraction; this renders a stuck/near-zero bar.
<progress value={progress} max={100} />

// Correct — progress is 0..1; use max={1} (or multiply by 100 yourself).
<progress value={progress} max={1} />
```

The hook computes `progress` as `sent / total`, a value in `[0, 1]`. Source:
`packages/react/src/use-media-upload.ts`.

### Mistake 3 — server missing the raw-body parser

```ts
// Wrong — client uploads "work" on POST but every PATCH chunk fails to assemble
// because the server didn't register the offset raw-body parser.

// Correct — on the NestJS side (main.ts):
app.use('/media/uploads', express.raw({ type: 'application/offset+octet-stream', limit: '50mb' }));
```

The tus client sends `application/offset+octet-stream` PATCH bodies; the server
must parse them raw or chunks never assemble. Source:
`website/content/docs/concepts/uploads.mdx`.
