# `@dudousxd/nestjs-media`

Filesystem **and** media-library for NestJS, in one package — the Laravel/spatie
feel for files. It **absorbs the storage abstraction**: there is no separate
`nestjs-storage`. Libraries that need raw filesystem access depend on this and
import `@dudousxd/nestjs-media/storage`.

Two layers, one package:

- **Camada 1 — Storage:** disk-agnostic `put/get/url/temporaryUrl/stream/delete`.
- **Camada 2 — Media-library:** attach files to entities, collections, image conversions.

## Packages

| Package | Role |
|---|---|
| `@dudousxd/nestjs-media-core` | StorageDriver SPI, StorageManager, MediaStore SPI, MediaLibrary, ImageProcessor SPI |
| `@dudousxd/nestjs-media` | NestJS `MediaModule` + `MediaService` (+ `/storage` subpath) |
| `@dudousxd/nestjs-media-disk-local` | local filesystem driver |
| `@dudousxd/nestjs-media-disk-s3` | S3 driver (presign + multipart-capable) |
| `@dudousxd/nestjs-media-database-typeorm` | TypeORM media store (non-destructive auto-schema) |
| `@dudousxd/nestjs-media-image-sharp` | sharp-backed image processor |
| `@dudousxd/nestjs-media-testing` | in-memory driver/store + conformance suites |

## Quick start

```ts
import { MediaModule } from '@dudousxd/nestjs-media';
import { LocalDriver } from '@dudousxd/nestjs-media-disk-local';
import { S3Driver } from '@dudousxd/nestjs-media-disk-s3';
import { TypeOrmMediaStore } from '@dudousxd/nestjs-media-database-typeorm';
import { SharpImageProcessor } from '@dudousxd/nestjs-media-image-sharp';

@Module({
  imports: [
    MediaModule.forRootAsync({
      inject: [getDataSourceToken(), S3Client],
      useFactory: (ds, s3) => ({
        default: 's3',
        disks: {
          s3: new S3Driver({ client: s3, bucket: 'app-uploads' }),
          local: new LocalDriver({ root: './storage', baseUrl: 'http://localhost/files' }),
        },
        store: new TypeOrmMediaStore(ds),
        imageProcessor: new SharpImageProcessor(),
        collections: [
          { name: 'avatar', single: true, acceptsMimeTypes: ['image/png', 'image/jpeg'] },
          { name: 'gallery', conversions: [{ name: 'thumb', width: 200 }, { name: 'og', width: 1200, eager: true }] },
        ],
      }),
    }),
  ],
})
export class AppModule {}
```

```ts
@Injectable()
export class PhotosService {
  constructor(private readonly media: MediaService) {}

  async upload(postId: string, file: { buffer: Buffer; mimetype: string; originalname: string }) {
    // Camada 2 — attach to an entity
    return this.media.library.attach({
      ownerType: 'Post',
      ownerId: postId,
      collection: 'gallery',
      fileName: file.originalname,
      mimeType: file.mimetype,
      contents: file.buffer,
    });
  }

  thumbUrl(mediaId: string) {
    return this.media.library.url(mediaId, 'thumb'); // generated lazily on first call
  }

  // Camada 1 — raw storage
  putRaw(path: string, data: Buffer) {
    return this.media.disk('s3').put(path, data);
  }
}
```

## Upload modes (multipart)

Drivers advertise `capabilities = { presign, multipart, publicUrls }`. The planned
`uploadMode: 'auto' | 'proxy' | 'direct'` (global → per-disk → per-call) uses this to
pick proxied (resumable **tus**) vs direct (presigned S3 multipart). Driver capabilities
are in place; the tus server + Uppy client land in a later phase.

## Status

Implemented & tested: storage layer (local/s3/in-memory), media-library (collections,
single-file replace, MIME validation, delete), image conversions (sharp, lazy + eager),
TypeORM store with non-destructive auto-schema, NestJS wiring. See
`docs/superpowers/specs/2026-06-20-nestjs-media-design.md` for the full design and the
remaining roadmap (tus multipart, mikro/prisma/drizzle stores, codegen/telescope/react).

Build: `pnpm install && pnpm test && pnpm typecheck`.
