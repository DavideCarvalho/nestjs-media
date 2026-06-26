---
name: raw-storage
description: >-
  Use @dudousxd/nestjs-media's layer-1 disk-agnostic storage through
  MediaService.disk(name?), which returns a StorageDriver with put / get /
  stream / exists / delete / copy / move / size / url / temporaryUrl / list.
  Covers multi-disk routing (default vs named disk), PutOptions (contentType,
  visibility, metadata), DriverCapabilities (presign, multipart, publicUrls,
  list), LocalDriver vs S3Driver behaviour, and importing the framework-agnostic
  facade from @dudousxd/nestjs-media/storage. Explains UnknownDiskError, why
  temporaryUrl needs a presign-capable disk (S3, not local), and why url() on the
  local disk requires a baseUrl.
license: MIT
metadata:
  type: core
  library: "@dudousxd/nestjs-media"
  library_version: 0.5.0
  framework: nestjs
---

# Raw storage (layer 1)

When you just need a file on a disk — no entity, no media table — use the storage
layer. `MediaService.disk(name?)` returns a `StorageDriver`; with no name it
returns the configured `default` disk.

## Setup

The storage layer is always on (it needs only `default` + `disks`, no `store`):

```ts
import { Injectable } from '@nestjs/common';
import { MediaService } from '@dudousxd/nestjs-media';

@Injectable()
export class ReportsService {
  constructor(private readonly media: MediaService) {}

  async save(id: string, csv: Buffer) {
    await this.media.disk('s3').put(`reports/${id}.csv`, csv, { contentType: 'text/csv' });
    // a signed, expiring link (presign-capable disks only):
    return this.media.disk('s3').temporaryUrl(`reports/${id}.csv`, 300);
  }
}
```

The full `StorageDriver` surface: `put`, `get`, `stream`, `exists`, `delete`,
`copy`, `move`, `size`, `url`, `temporaryUrl`, `list`. Source:
`packages/core/src/types.ts`.

## Core patterns

### 1. Multi-disk routing

`disk()` with no argument is the default; pass a name to target another disk.
Stream large reads instead of buffering them:

```ts
await this.media.disk().put('tmp/import.json', buf);        // default disk
const stream = await this.media.disk('local').stream('tmp/import.json');
await this.media.disk('s3').copy('a/key.bin', 'b/key.bin'); // copy within a disk
```

### 2. `PutOptions` and capabilities

`put` accepts `{ contentType, visibility, metadata }`. Branch on the driver's
`capabilities` (`presign`, `multipart`, `publicUrls`, `list`) before calling
something a disk can't do:

```ts
const disk = this.media.disk('s3');
const link = disk.capabilities.presign
  ? await disk.temporaryUrl('reports/x.csv', 300)
  : await disk.url('reports/x.csv');
```

### 3. The framework-agnostic facade — `/storage`

A library that needs only filesystem access (no NestJS, no media-library) imports
the storage facade directly instead of `MediaService`:

```ts
import { StorageManager } from '@dudousxd/nestjs-media/storage';
import { LocalDriver } from '@dudousxd/nestjs-media-disk-local';

const storage = new StorageManager({
  default: 'local',
  disks: { local: new LocalDriver({ root: './storage', baseUrl: 'http://localhost:3000/files' }) },
});
await storage.disk().put('a.txt', Buffer.from('hi'));
```

`@dudousxd/nestjs-media/storage` re-exports the core SPI, so there is no separate
`nestjs-storage` package. Source: `packages/nestjs/src/storage.ts`.

## Common mistakes

### Mistake 1 — `temporaryUrl` on the local disk

```ts
// Wrong — the local driver can't presign; this throws UnsupportedOperationError.
await this.media.disk('local').temporaryUrl('a.txt', 300);

// Correct — signed/expiring URLs need a presign-capable disk (S3).
await this.media.disk('s3').temporaryUrl('a.txt', 300);
```

`LocalDriver.capabilities.presign` is `false`; signed URLs require S3. Source:
`packages/disk-local/src/local-driver.ts`.

### Mistake 2 — `url()` on a local disk with no `baseUrl`

```ts
// Wrong — LocalDriver without baseUrl has no public URL to return.
const local = new LocalDriver({ root: './storage' });
// new MediaModule disk: { local }, then media.disk('local').url('a.txt') fails.

// Correct — give the local driver a baseUrl so it can build public URLs.
const local = new LocalDriver({ root: './storage', baseUrl: 'http://localhost:3000/files' });
```

`LocalDriver` only sets `capabilities.publicUrls` (and can serve `url()`) when a
`baseUrl` is configured. Source: `packages/disk-local/src/local-driver.ts`.

### Mistake 3 — addressing an unregistered disk name

```ts
// Wrong — 'cdn' was never registered in `disks`; throws UnknownDiskError.
await this.media.disk('cdn').put('a.txt', buf);

// Correct — use a registered disk name (or add 'cdn' to the module's disks).
await this.media.disk('s3').put('a.txt', buf);
```

`StorageManager.disk(name)` looks the name up in the `disks` map and throws
`UnknownDiskError` when absent. Source: `packages/core/src/storage-manager.ts`.
