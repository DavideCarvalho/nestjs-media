# `@dudousxd/nestjs-media`

The media library for NestJS — the spatie feel for files — on top of NestJS's first-party
[`@nestjs/storage`](https://docs.nestjs.com/application/file-storage). `@nestjs/storage` owns the
disks (`LocalDisk`, `S3Disk`, `InMemoryDisk`), signed URLs, `serveFile()` and `uploadToDisk()`;
nestjs-media adds what it doesn't have:

- **Media library:** attach files to entities in collections, single-file replace, MIME validation,
  image conversions (lazy or eager), `MediaService.serve()` with an `authorize` hook.
- **Attachments:** a file as a JSON column on your own entity.
- **Uploads:** resumable **tus** and proxy-parallel parts, presigned **direct** S3 multipart
  (through the `s3Multipart()` side-car for `S3Disk`).
- **A `/media` console**, Telescope panels, a typed client and React hooks.

Upgrading from the versions with their own storage layer (`StorageManager`, `LocalDriver`,
`S3Driver`)? See the [migration guide](website/content/docs/reference/migration.mdx).

## Packages

| Package | Role |
|---|---|
| `@dudousxd/nestjs-media-core` | MediaLibrary, attachments, MediaStore/ImageProcessor/MultipartUploadDriver SPIs, uploadMode, folder listing, capabilities, diagnostics, resumable-upload engine, tus handler |
| `@dudousxd/nestjs-media` | NestJS `MediaModule` + `MediaService` + upload controllers |
| `@dudousxd/nestjs-media-disk-s3` | `s3Multipart()`: native multipart + delimiter listing for `S3Disk` |
| `@dudousxd/nestjs-media-database-typeorm` | TypeORM media store (non-destructive auto-schema); `/nest`: `typeOrmMediaStore({ connectionName })` |
| `@dudousxd/nestjs-media-database-mikro-orm` | MikroORM media store (safe auto-schema) |
| `@dudousxd/nestjs-media-database-drizzle` | Drizzle media stores (sqlite, `/pg`); `/nest`: factories on `@nestjs/drizzle` |
| `@dudousxd/nestjs-media-database-prisma` | Prisma media store (consumer-managed schema) |
| `@dudousxd/nestjs-media-upload-redis` | Redis upload-session store |
| `@dudousxd/nestjs-media-image-sharp` | sharp-backed image processor |
| `@dudousxd/nestjs-media-dashboard` | `/media` console (disks, live uploads, media library) |
| `@dudousxd/nestjs-media-telescope` | Telescope watcher + media dashboard |
| `@dudousxd/nestjs-media-codegen` | Codegen extension emitting a typed media client |
| `@dudousxd/nestjs-media-client` | framework-agnostic browser client (`uploadMedia` tus + `mediaUrl`) |
| `@dudousxd/nestjs-media-react` | `useMediaUpload` hook + `MediaUploader` (wraps the client) |
| `@dudousxd/nestjs-media-testing` | in-memory store/upload-session, `storageOf()`, disk + store conformance suites |

Requires NestJS 12.1+ and Node 20.19+ (the floor of `@nestjs/storage`).

## Quick start

```ts
import { LocalDisk, S3Disk, StorageModule } from '@nestjs/storage';
import { MediaModule } from '@dudousxd/nestjs-media';
import { typeOrmMediaStore } from '@dudousxd/nestjs-media-database-typeorm/nest';
import { SharpImageProcessor } from '@dudousxd/nestjs-media-image-sharp';

@Module({
  imports: [
    TypeOrmModule.forRoot({ /* … */ }),
    StorageModule.forRoot({
      default: 's3',
      disks: {
        s3: new S3Disk({ bucket: 'app-uploads', region: 'eu-west-1' }),
        local: new LocalDisk({ root: './storage' }),
      },
    }),
    MediaModule.forRoot({
      // No upload routes in this app. Mounting them? Protect them — see "Protecting the routes".
      routes: false,
      store: typeOrmMediaStore(),
      imageProcessor: new SharpImageProcessor(),
      collections: [
        { name: 'avatar', single: true, acceptsMimeTypes: ['image/png', 'image/jpeg'] },
        { name: 'gallery', conversions: [{ name: 'thumb', width: 200 }, { name: 'og', width: 1200, eager: true }] },
      ],
    }),
  ],
})
export class AppModule {}
```

```ts
@Injectable()
export class PhotosService {
  constructor(private readonly media: MediaService) {}

  upload(postId: string, file: { buffer: Buffer; mimetype: string; originalname: string }) {
    return this.media.library.attach({
      ownerType: 'Post',
      ownerId: postId,
      collection: 'gallery',
      fileName: file.originalname, // made one safe key segment
      mimeType: file.mimetype,
      contents: file.buffer,
    });
  }

  thumbUrl(mediaId: string) {
    return this.media.library.url(mediaId, 'thumb'); // public URL, else signed; generated on first call
  }
}

@Controller('media')
export class FilesController {
  constructor(private readonly media: MediaService) {}

  @Get(':id')
  file(@Param('id') id: string, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.media.serve(id, undefined, { req, res }); // serveFile(): Range, ETag, nosniff
  }
}
```

Files that aren't media records: use `@nestjs/storage` directly (`Storage`, `@InjectDisk()`).

## Upload modes (multipart)

`resolveUploadMode` (`'auto' | 'proxy' | 'direct'`, resolved global → per-disk → per-call) picks
proxied (resumable **tus**) vs direct (presigned S3 multipart) from the disk's capabilities: a disk
presigns when `signedUrl()` works, and has native multipart when you give it a side-car:

```ts
const s3 = { bucket: 'app-uploads', region: 'eu-west-1' };
StorageModule.forRoot({ disks: { s3: new S3Disk(s3) } });
MediaModule.forRoot({ uploadSessions, multipart: { s3: s3Multipart(s3) }, direct: { disk: 's3' } });
```

The proxy path works on any disk: `ResumableUploadManager` engine → framework-agnostic
`TusUploadHandler` → NestJS `MediaUploadController` → React `useMediaUpload`/`MediaUploader`.

## Folder listing

`listFolderLevel(disk, prefix, { limit, cursor }, sidecar)` returns one folder level (sub-folders
and files) a page at a time. With a side-car that has `listFolders` (the S3 one), S3 lists the
folder with a delimiter. On any other disk the flat listing is folded. Both paths use the same page
size: `limit`, or `DEFAULT_FOLDER_LISTING_LIMIT` (50) when you pass none, at most
`MAX_FOLDER_LISTING_LIMIT` (1000, S3's own cap per request). A `limit` that is not a positive integer
is a `RangeError`. A page holds at most `limit` entries. While it has a `cursor` it can hold fewer
(S3 leaves out a folder's marker object), so page on the `cursor`, not on the count.

## Protecting the routes

The upload controllers ship with **no auth of their own**: you protect them with NestJS's
first-party tools (`@nestjs/authentication`, `@nestjs/authorization`), one of two ways.

1. **Mount them yourself.** Pass `routes: false` (every provider keeps working) and extend the
   exported controllers in your own module, decorated like any other controller:

   ```ts
   MediaModule.forRoot({ /* … */, tus: { disk: 'local', basePath: '/api/uploads' }, routes: false });

   @Can(MediaPolicy, 'upload')
   @Controller('api/uploads')
   export class UploadsController extends MediaUploadController {}
   ```

2. **`decorators` on the mounted controllers**, applied to every controller the module mounts:

   ```ts
   MediaModule.forRoot({ /* … */, decorators: [UseGuards(AuthenticationGuard), Can(MediaPolicy, 'upload')] });
   ```

**Production rule:** when `NODE_ENV === 'production'`, a `MediaModule` that mounts upload routes
without `decorators` (an empty list counts as none) refuses to boot, with an error naming both
ways. Outside production undecorated routes mount open.

The `/media` console takes one `authorize` option instead (a function, an `@Injectable()` class, a
lazy import, an `@nestjs/authorization` policy, or a gate name). Without it the console is open
outside production and answers 403 in production:

```ts
MediaDashboardModule.forRoot({
  decorators: [UseGuards(AuthenticationGuard)],
  authorize: (ctx) => ctx.switchToHttp().getRequest().user?.isAdmin === true,
});
```

Every controller this library mounts is marked `@Can.Anyone()`-open, so `@nestjs/authorization`'s
deny-by-default global guard doesn't refuse it; a `@Can(...)` you add is still checked. `mount`
(`{ tus?, multipart?, direct? }`) still turns single upload surfaces off.

## Build output check

Packages that build ESM and CJS in two tsup passes clean `dist/` **once**, with an `rmSync` at the top of
`tsup.config.ts`; no pass sets `clean: true`. tsup runs the passes of a config array at the same time,
so a pass that cleans can delete files another pass already wrote (seen as a missing `dist/index.d.cts`
under a loaded `turbo run build`).

`pnpm check:exports` (also each package's `prepack`, and a CI step after the build) fails if a path in a
package's `exports`, `main`, `module`, `types` or `bin` does not exist. `release` runs it before
`changeset publish`. Run it after any build you are about to pack.

## Status

Media library, attachments, conversions, all four ORM stores against a shared conformance suite,
uploadMode resolution, `aviary:media:*` diagnostics, resumable tus + parallel parts + direct S3
multipart, the `/media` console, telescope, codegen and React — on `@nestjs/storage` disks.

Integration (`pnpm test:db`, testcontainers): the disk conformance suite on `S3Disk` +
`s3Multipart()` against MinIO, end-to-end parallel uploads over HTTP, and the TypeORM, MikroORM,
Drizzle (Postgres) and Prisma stores on real Postgres.

Build: `pnpm install && pnpm build && pnpm typecheck && pnpm test`.
