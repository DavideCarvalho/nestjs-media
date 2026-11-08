# Skill spec — @dudousxd/nestjs-media

Autonomous pass (no maintainer interview). Sources: `README.md`,
`website/content/docs/**`, `packages/*/src/**`. Scope bounded to the two
client-facing packages a consumer actually imports.

## Covered packages
- `@dudousxd/nestjs-media` (packages/nestjs) — the NestJS adapter. 4 skills.
- `@dudousxd/nestjs-media-react` (packages/react) — browser uploader. 1 skill.

## Skills (flat; all type `core`; <5 per package so no router skill)

1. **media-module-setup** (packages/nestjs) — Register `StorageModule.forRoot`
   (`@nestjs/storage`: `default` + `disks`, LocalDisk / S3Disk) then `MediaModule.forRoot` /
   `forRootAsync`: optional `store` (instance or `{ inject, useFactory }`)
   (TypeOrmMediaStore / MikroOrmMediaStore / DrizzleMediaStore / PrismaMediaStore),
   `imageProcessor` (SharpImageProcessor), `collections`, `uploadSessions`, `tus`,
   `direct`, `multipart` side-cars, `authorize`. `@Global()` module, inject `MediaService`. Tokens.
   Mistakes: no StorageModule, default/disks on MediaModule, side-car options differing from the
   disk's, importing module per-feature-module.

2. **media-library-attachments** (packages/nestjs) — Layer-2 table model via
   `media.library`: `attach`, `for(ownerType,id)`, `list`, `url(id, conversion?)`,
   `delete`, single collections, MIME allow-list, customProperties; plus the
   column model `media.attachments.createFromFile(...)` -> `Attachment`,
   `Attachment.fromJSON`. Mistakes: `media.library` without `store`, conversion
   without imageProcessor, undefined conversion preset.

3. **resumable-and-direct-uploads** (packages/nestjs) — proxy/tus
   (`uploadSessions` + `tus`, raw-body parser, RedisUploadSessionStore) vs direct
   presigned multipart (`direct`, S3). `resolveUploadMode` precedence. Engine
   access via `media.uploads` / `media.directUploads`. Mistakes: missing
   raw-body parser, forcing `direct` on non-presign disk, assuming a session
   store is needed for the direct path.

5. **react-media-uploader** (packages/react) — `useMediaUpload` hook (status,
   progress, upload, reset), `MediaUploader` component, and re-exported
   `uploadMedia` / `mediaUrl` from `@dudousxd/nestjs-media-client`. Mistakes:
   `basePath` mismatch with the server `tus.basePath`, treating progress as
   0..100 (it is 0..1), forgetting the server-side raw-body parser.

## Remaining gaps (interview-only; recorded so they are not silently dropped)
See `domain_map.yaml` `gaps:`. Highlights:
- No production usage-ranking of the four ORM stores; skills present all four as
  equals plugged via the factory.
- Eager-conversion runs synchronously today; a durable/bullmq dispatcher is a
  "later phase" (code comment) — skills document the sync behavior only.
- Controllers ship without auth guards; the right authorization pattern is not
  documented, so skills note the endpoints exist but do not prescribe guards.
- No GitHub issue access in this environment, so AI-agent footguns are derived
  from `errors.ts` + docs callouts, not from real reported failures.
- Future drivers/features (GCS, video/pdf thumbnails, srcset, antivirus) are not
  shipped and are excluded.

## Uncovered public packages (intentionally out of scope for this pass)
core, disk-s3, image-sharp, database-typeorm, database-mikro-orm,
database-drizzle, database-prisma, upload-redis, client, codegen, telescope,
testing. Their constructors are referenced (and grounded) inside the covered
skills, but they do not each receive their own SKILL.md in this focused pass.

Note: raw storage (layer 1) is `@nestjs/storage` and documented at
https://docs.nestjs.com/application/file-storage; the former raw-storage skill was removed.
