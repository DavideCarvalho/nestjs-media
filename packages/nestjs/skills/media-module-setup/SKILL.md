---
name: media-module-setup
description: >-
  Register @dudousxd/nestjs-media's MediaModule in a NestJS app on top of
  @nestjs/storage. The disks come from StorageModule.forRoot({ default, disks })
  (LocalDisk / S3Disk / InMemoryDisk from @nestjs/storage); MediaModule.forRoot
  or forRootAsync adds the media-library layer (store: TypeOrmMediaStore /
  MikroOrmMediaStore / DrizzleMediaStore / PrismaMediaStore, or a
  { inject, useFactory } factory such as typeOrmMediaStore({ connectionName })),
  an imageProcessor (SharpImageProcessor), collections with conversions,
  uploads (uploadSessions + tus, direct), multipart side-cars
  (s3Multipart from -disk-s3) and an authorize hook. MediaModule is @Global;
  inject MediaService anywhere. Covers the missing-StorageModule boot error and
  the injection tokens MEDIA_LIBRARY / MEDIA_ATTACHMENTS / MEDIA_UPLOADS /
  MEDIA_TUS / MEDIA_DIRECT / MEDIA_MULTIPART.
license: MIT
metadata:
  type: core
  library: "@dudousxd/nestjs-media"
  library_version: 0.10.0
  framework: nestjs
---

# Registering MediaModule

`@dudousxd/nestjs-media` stores files on the disks of NestJS's first-party
`@nestjs/storage` (https://docs.nestjs.com/application/file-storage). Two
registrations:

- **`StorageModule.forRoot({ default, disks })`** (from `@nestjs/storage`): the disks.
- **`MediaModule.forRoot({ ... })`**: the media library (`store`, `collections`,
  `imageProcessor`), attachments, uploads (`uploadSessions` + `tus`, `direct`,
  `multipart`), and `authorize`.

## Setup

```bash
pnpm add @nestjs/storage @dudousxd/nestjs-media \
  @dudousxd/nestjs-media-database-typeorm @dudousxd/nestjs-media-image-sharp
```

Needs NestJS 12.1+ and Node 24+. Both modules are global: register them
**once**, in `AppModule`.

```ts
// app.module.ts
import { Module } from '@nestjs/common';
import { LocalDisk, S3Disk, StorageModule } from '@nestjs/storage';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MediaModule } from '@dudousxd/nestjs-media';
import { typeOrmMediaStore } from '@dudousxd/nestjs-media-database-typeorm/nest';
import { SharpImageProcessor } from '@dudousxd/nestjs-media-image-sharp';

@Module({
  imports: [
    TypeOrmModule.forRoot({ /* ... */ }),
    StorageModule.forRoot({
      default: 's3',
      disks: {
        s3: new S3Disk({ bucket: 'app-uploads', region: 'eu-west-1' }),
        local: new LocalDisk({ root: './storage' }),
      },
    }),
    MediaModule.forRoot({
      // No upload routes in this app. Mounting them? Protect them: see
      // "Protecting the routes" in the nestjs package docs.
      routes: false,
      store: typeOrmMediaStore(), // Nest injects the default TypeORM DataSource
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
  ],
})
export class AppModule {}
```

## Core patterns

### 1. Stores: an instance, or a factory Nest resolves

```ts
import { MikroOrmMediaStore } from '@dudousxd/nestjs-media-database-mikro-orm'; // new MikroOrmMediaStore(em)
import { DrizzleMediaStore }  from '@dudousxd/nestjs-media-database-drizzle';   // new DrizzleMediaStore(db) — sqlite/libSQL
import { DrizzlePgMediaStore } from '@dudousxd/nestjs-media-database-drizzle/pg'; // new DrizzlePgMediaStore(db) — Postgres
import { PrismaMediaStore }   from '@dudousxd/nestjs-media-database-prisma';    // new PrismaMediaStore(prisma)

// On a named @nestjs/typeorm or @nestjs/drizzle connection:
import { typeOrmMediaStore } from '@dudousxd/nestjs-media-database-typeorm/nest';
import { drizzlePgMediaStore, drizzlePgUploadSessions } from '@dudousxd/nestjs-media-database-drizzle/nest';

MediaModule.forRoot({ store: typeOrmMediaStore({ connectionName: 'media' }) });
```

A factory is `{ inject, useFactory }`. On `forRootAsync` it goes at the top level
(`forRootAsync({ store, useFactory })`), not in the factory's result. Omit `store`
and `media.library` throws; for files that aren't media, use `@nestjs/storage`
directly (`Storage`, `@InjectDisk()`).

### 2. `forRoot` vs `forRootAsync`

`forRootAsync({ imports, inject, useFactory })` resolves the options with DI —
for `ConfigService`, or an `authorize` hook calling an injected
`AuthorizationService`:

```ts
MediaModule.forRootAsync({
  imports: [AuthorizationModule],
  inject: [AuthorizationService],
  useFactory: (authorization: AuthorizationService) => ({
    authorize: (user, action, record) => authorization.authorize(MediaPolicy, action, user, record),
  }),
});
```

`decorators`, `routes`, `mount`, `store` and `uploadSessions` factories are
static fields next to `useFactory`.

### 3. Inject `MediaService`, or the tokens directly

```ts
@Injectable()
export class PhotosService {
  constructor(private readonly media: MediaService) {}
}
```

`media.library`, `media.attachments`, `media.uploads`, `media.directUploads`,
plus `media.serve(id, conversion, { req, res })`, `media.url()`,
`media.attach()`, `media.delete()` (checked by `authorize`). Tokens:
`MEDIA_LIBRARY`, `MEDIA_ATTACHMENTS`, `MEDIA_UPLOADS`, `MEDIA_TUS`,
`MEDIA_DIRECT`, `MEDIA_STORE`, `MEDIA_UPLOAD_SESSIONS`, `MEDIA_MULTIPART`. The
disks are `@nestjs/storage`'s `Storage`.

## Common mistakes

### Mistake 1 — no `StorageModule`

```ts
// Wrong — MediaModule has no disks: boot fails with
// "MediaModule stores files on the disks of @nestjs/storage: register StorageModule.forRoot(...)".
@Module({ imports: [MediaModule.forRoot({ store })] })

// Correct
@Module({ imports: [StorageModule.forRoot({ disks: { local: new LocalDisk({ root: './storage' }) } }), MediaModule.forRoot({ store })] })
```

### Mistake 2 — `default`/`disks` on `MediaModule`

They moved to `StorageModule.forRoot()`. `MediaModuleOptions` has no `default`
or `disks`; TypeScript rejects them.

### Mistake 3 — a multipart side-car built from different options than its disk

```ts
// Wrong — the side-car writes under another prefix/bucket than the disk reads.
StorageModule.forRoot({ disks: { s3: new S3Disk({ bucket: 'a', prefix: 'p/' }) } });
MediaModule.forRoot({ multipart: { s3: s3Multipart({ bucket: 'a' }) } });

// Correct — one options object for both.
const s3 = { bucket: 'a', prefix: 'p/' };
StorageModule.forRoot({ disks: { s3: new S3Disk(s3) } });
MediaModule.forRoot({ multipart: { s3: s3Multipart(s3) } });
```

A `multipart` key that isn't a `StorageModule` disk fails at boot.

### Mistake 4 — importing `MediaModule` again in a feature module

`MediaModule` is `@Global()`: register it once in `AppModule` and inject
`MediaService` downstream.
