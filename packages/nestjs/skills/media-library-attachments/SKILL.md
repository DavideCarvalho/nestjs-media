---
name: media-library-attachments
description: >-
  Attach files to entities with @dudousxd/nestjs-media's media-library layer
  (spatie-style). Use MediaService.library.attach({ ownerType, ownerId,
  collection, fileName, mimeType, contents }), library.for(ownerType, id),
  library.list, library.delete, and library.url(id, conversion?) where image
  conversions are generated lazily on first url() and cached (or eagerly on
  attach). Covers MediaCollectionConfig single-file collections, acceptsMimeTypes
  validation (MimeNotAllowedError), customProperties, plus the column model
  MediaService.attachments.createFromFile(...) returning an Attachment value
  object with Attachment.fromJSON / toJSON. Explains the MediaLibrary-not-
  configured, ImageProcessorMissingError, and ConversionNotDefinedError failures.
license: MIT
metadata:
  type: core
  library: "@dudousxd/nestjs-media"
  library_version: 0.5.0
  framework: nestjs
---

# Attaching files to entities

The media-library layer records files against an owning entity (the spatie
media-library model). It needs a `store` configured on `MediaModule` (see the
`media-module-setup` skill). Reach it through `MediaService.library`.

## Setup

A normal NestJS controller accepts the upload; Multer memory storage gives you a
`Buffer`:

```ts
import { Controller, Injectable, Param, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { MediaService } from '@dudousxd/nestjs-media';

@Controller('posts/:id/photos')
export class PhotosController {
  constructor(private readonly media: MediaService) {}

  @Post()
  @UseInterceptors(FileInterceptor('file'))
  upload(@Param('id') postId: string, @UploadedFile() file: Express.Multer.File) {
    return this.media.library.attach({
      ownerType: 'Post',
      ownerId: postId,
      collection: 'gallery',
      fileName: file.originalname,
      mimeType: file.mimetype,
      contents: file.buffer,
    });
  }
}
```

`attach` writes the bytes to the collection's disk, saves a `MediaRecord`, runs
any `eager` conversions, and returns the saved record (including its `id`).

## Core patterns

### 1. Bind an owner, list, and serve URLs

`library.for(ownerType, id)` returns a binding so you don't repeat owner
type/id; the id is coerced to a string. Conversions are produced lazily and
cached on the first `url(id, name)` call:

```ts
@Injectable()
export class PhotosService {
  constructor(private readonly media: MediaService) {}

  attach(postId: string, file: Express.Multer.File) {
    return this.media.library
      .for('Post', postId)
      .attach({ collection: 'gallery', fileName: file.originalname, mimeType: file.mimetype, contents: file.buffer });
  }

  async list(postId: string) {
    const records = await this.media.library.list('Post', postId, 'gallery');
    return Promise.all(
      records.map(async (m) => ({
        id: m.id,
        full: await this.media.library.url(m.id),
        thumb: await this.media.library.url(m.id, 'thumb'), // generated + cached on first call
      })),
    );
  }

  remove(id: string) {
    return this.media.library.delete(id); // deletes the original + every conversion
  }
}
```

### 2. Single-file collections, MIME allow-lists, customProperties

Collection rules come from `MediaCollectionConfig` in the module config. A
`single: true` collection replaces whatever is already attached; `acceptsMimeTypes`
is an allow-list; arbitrary metadata rides along in `customProperties`:

```ts
await this.media.library.attach({
  ownerType: 'User',
  ownerId: userId,
  collection: 'avatar', // configured { single: true, acceptsMimeTypes: ['image/png', 'image/jpeg'] }
  fileName: file.originalname,
  mimeType: file.mimetype,
  contents: file.buffer,
  customProperties: { uploadedBy: userId, alt: 'Profile photo' },
});
```

### 3. The column model — `Attachment` as a model field

When you'd rather store the file as a JSON column on your own row (adonis-attachment
style) than in the `media` table, use `media.attachments`. It is always available
(no `store` needed):

```ts
const attachment = await this.media.attachments.createFromFile(
  { fileName: file.originalname, mimeType: file.mimetype, contents: file.buffer },
  { disk: 's3', variants: [{ name: 'thumb', width: 200 }] },
);
user.avatar = attachment.toJSON();           // persist the JSON on your column
const url = await this.media.attachments.url(attachment, 'thumb');

// rehydrate a stored column value later:
import { Attachment } from '@dudousxd/nestjs-media/storage';
const restored = Attachment.fromJSON(user.avatar);
```

## Common mistakes

### Mistake 1 — calling `media.library` without a `store`

```ts
// Wrong — no `store` was passed to MediaModule, so this getter throws:
//   "MediaLibrary is not configured. Pass a `store` to MediaModule.forRoot ..."
this.media.library.attach({ /* ... */ });

// Correct — either configure a store, or use the column model / raw storage.
const attachment = await this.media.attachments.createFromFile(
  { fileName, mimeType, contents },
);
```

`library`, `uploads`, and `directUploads` throw a named error when their feature
was not configured, instead of returning `undefined`. Source:
`packages/nestjs/src/media.service.ts`.

### Mistake 2 — requesting a conversion with no `imageProcessor`

```ts
// Wrong — collection declares `conversions` but the module has no imageProcessor,
// so the first url(id, 'thumb') throws ImageProcessorMissingError.
await this.media.library.url(id, 'thumb');

// Correct — pass an imageProcessor in the module config.
//   imageProcessor: new SharpImageProcessor()
```

Conversions need an `ImageProcessor`; without one `ensureConversion` raises
`ImageProcessorMissingError`. Source: `packages/core/src/media-library.ts`.

### Mistake 3 — asking for a conversion the collection never declared

```ts
// Wrong — 'gallery' defines 'thumb' and 'og' only; 'banner' is undefined,
// so this throws ConversionNotDefinedError.
await this.media.library.url(id, 'banner');

// Correct — request a preset that exists, or add it to the collection's
// `conversions` array in the module config.
await this.media.library.url(id, 'thumb');
```

`ensureConversion` looks the preset up by name in the collection config and throws
`ConversionNotDefinedError` if it's absent — it never silently invents one.
Source: `packages/core/src/media-library.ts`.
