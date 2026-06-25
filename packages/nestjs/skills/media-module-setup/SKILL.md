---
name: media-module-setup
description: >-
  Register @dudousxd/nestjs-media's MediaModule in a NestJS app via
  MediaModule.forRoot or MediaModule.forRootAsync. Wire the storage layer
  (default + disks with LocalDriver / S3Driver), optionally the media-library
  layer (store: TypeOrmMediaStore / MikroOrmMediaStore / DrizzleMediaStore /
  PrismaMediaStore), an imageProcessor (SharpImageProcessor), collections with
  conversions, and uploads (uploadSessions + tus, direct). MediaModule is
  @Global; inject MediaService anywhere. Covers MediaModuleOptions, the
  forRoot-vs-forRootAsync (DI) choice, injection tokens MEDIA_STORAGE /
  MEDIA_LIBRARY / MEDIA_ATTACHMENTS / MEDIA_UPLOADS / MEDIA_TUS / MEDIA_DIRECT,
  and the UnknownDiskError when the default disk is missing.
license: MIT
metadata:
  type: core
  library: "@dudousxd/nestjs-media"
  library_version: 0.5.0
  framework: nestjs
---

# Registering MediaModule

`MediaModule` is the single NestJS entry point for `@dudousxd/nestjs-media`. It
has two layers, enabled independently:

- **Layer 1 — storage** (`default` + `disks`): always on.
- **Layer 2 — media-library** (`store`, `collections`, `imageProcessor`):
  on only when you pass a `store`.

Plus optional resumable (`uploadSessions` + `tus`) and direct (`direct`) uploads.

## Setup

Install the umbrella package plus the à-la-carte disk / store / image packages you
use:

```bash
pnpm add @dudousxd/nestjs-media @dudousxd/nestjs-media-disk-local \
  @dudousxd/nestjs-media-disk-s3 @dudousxd/nestjs-media-database-typeorm \
  @dudousxd/nestjs-media-image-sharp
```

`MediaModule` is `@Global()` — import it **once** (in `AppModule`) and inject
`MediaService` anywhere.

```ts
// app.module.ts
import { Module } from '@nestjs/common';
import { MediaModule } from '@dudousxd/nestjs-media';
import { LocalDriver } from '@dudousxd/nestjs-media-disk-local';
import { S3Driver } from '@dudousxd/nestjs-media-disk-s3';
import { TypeOrmMediaStore } from '@dudousxd/nestjs-media-database-typeorm';
import { SharpImageProcessor } from '@dudousxd/nestjs-media-image-sharp';
import { S3Client } from '@aws-sdk/client-s3';
import { getDataSourceToken } from '@nestjs/typeorm';

@Module({
  imports: [
    MediaModule.forRootAsync({
      inject: [getDataSourceToken(), S3Client],
      useFactory: (ds, s3: S3Client) => ({
        default: 's3',
        disks: {
          s3: new S3Driver({ client: s3, bucket: 'app-uploads' }),
          local: new LocalDriver({ root: './storage', baseUrl: 'http://localhost:3000/files' }),
        },
        store: new TypeOrmMediaStore(ds),
        imageProcessor: new SharpImageProcessor(),
        collections: [
          { name: 'avatar', single: true, acceptsMimeTypes: ['image/png', 'image/jpeg'] },
          {
            name: 'gallery',
            conversions: [
              { name: 'thumb', width: 200 },
              { name: 'og', width: 1200, height: 630, eager: true },
            ],
          },
        ],
      }),
    }),
  ],
})
export class AppModule {}
```

## Core patterns

### 1. `forRoot` (static) vs `forRootAsync` (DI)

`forRoot` takes a literal `MediaModuleOptions`. Use it when your disks/stores need
no injected providers:

```ts
import { LocalDriver } from '@dudousxd/nestjs-media-disk-local';

MediaModule.forRoot({
  default: 'local',
  disks: { local: new LocalDriver({ root: './storage', baseUrl: 'http://localhost:3000/files' }) },
});
```

Reach for `forRootAsync` when a disk or store needs an injected dependency (an
`S3Client`, a TypeORM `DataSource`, a MikroORM `EntityManager`, a config service).
`inject` lists the providers; `useFactory` receives them and returns the same
`MediaModuleOptions` shape (sync or `Promise`).

### 2. Pick a store for layer 2

Each ORM store is a plain object you construct in the factory with its connection
(no `@Injectable`, no internal token):

```ts
import { MikroOrmMediaStore } from '@dudousxd/nestjs-media-database-mikro-orm'; // new MikroOrmMediaStore(em)
import { DrizzleMediaStore }  from '@dudousxd/nestjs-media-database-drizzle';   // new DrizzleMediaStore(db)
import { PrismaMediaStore }   from '@dudousxd/nestjs-media-database-prisma';    // new PrismaMediaStore(prisma)
```

TypeORM and MikroORM stores create the `media` table on first use
(non-destructive). Drizzle is migration-first; Prisma's schema is
consumer-managed. Omit `store` entirely for a raw-storage-only app — then
`media.disk(...)` works but `media.library` throws.

### 3. Inject `MediaService`, or the tokens directly

```ts
import { Injectable } from '@nestjs/common';
import { MediaService } from '@dudousxd/nestjs-media';

@Injectable()
export class PhotosService {
  constructor(private readonly media: MediaService) {}
}
```

For advanced wiring the module exports the underlying providers as tokens:
`MEDIA_STORAGE` (`StorageManager`), `MEDIA_LIBRARY` (`MediaLibrary | null`),
`MEDIA_ATTACHMENTS` (`AttachmentManager`), `MEDIA_UPLOADS`
(`ResumableUploadManager | null`), `MEDIA_TUS` (`TusUploadHandler | null`),
`MEDIA_DIRECT` (`DirectUploadManager | null`).

## Common mistakes

### Mistake 1 — `default` names a disk that isn't in `disks`

```ts
// Wrong — StorageManager throws UnknownDiskError at construction.
MediaModule.forRoot({
  default: 's3',
  disks: { local: new LocalDriver({ root: './storage' }) }, // no 's3' key
});

// Correct — the default key must exist in disks.
MediaModule.forRoot({
  default: 'local',
  disks: { local: new LocalDriver({ root: './storage' }) },
});
```

`StorageManager`'s constructor validates `default` against `disks` and throws
`UnknownDiskError` immediately if missing. Source:
`packages/core/src/storage-manager.ts`.

### Mistake 2 — using `forRoot` when a disk needs an injected client

```ts
// Wrong — S3Client isn't resolvable here; you end up newing it by hand,
// duplicating config and losing Nest's lifecycle.
MediaModule.forRoot({
  default: 's3',
  disks: { s3: new S3Driver({ client: new S3Client({}), bucket: 'app-uploads' }) },
});

// Correct — inject the provider through forRootAsync.
MediaModule.forRootAsync({
  inject: [S3Client],
  useFactory: (s3: S3Client) => ({
    default: 's3',
    disks: { s3: new S3Driver({ client: s3, bucket: 'app-uploads' }) },
  }),
});
```

`forRootAsync.useFactory` receives `inject`ed providers; `forRoot` cannot resolve
DI. Source: `packages/nestjs/src/media.module.ts`.

### Mistake 3 — importing `MediaModule` again in a feature module

```ts
// Wrong — MediaModule is @Global(); re-registering it per feature module
// rebuilds StorageManager/MediaLibrary with (possibly) different config.
@Module({ imports: [MediaModule.forRoot({ /* ... */ })] })
export class PhotosModule {}

// Correct — register once in AppModule; just inject MediaService downstream.
@Module({ providers: [PhotosService] })
export class PhotosModule {}
```

`MediaModule` is decorated `@Global()`, so a single root registration exports
`MediaService` and every token app-wide. Source:
`packages/nestjs/src/media.module.ts`.
