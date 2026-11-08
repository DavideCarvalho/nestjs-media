import type {
  AttachInput,
  AttachmentManager,
  DirectUploadManager,
  MediaLibrary,
  MediaRecord,
  ResumableUploadManager,
} from '@dudousxd/nestjs-media-core';
import {
  Inject,
  Injectable,
  NotFoundException,
  Optional,
  type StreamableFile,
} from '@nestjs/common';
import {
  type ServeFileOptions,
  Storage,
  type StorageSignedUrlRequest,
  serveFile,
} from '@nestjs/storage';
import {
  type MediaAction,
  type MediaAttachTarget,
  type MediaModuleRuntimeOptions,
  requireStorage,
} from './media.module';
import {
  MEDIA_ATTACHMENTS,
  MEDIA_DIRECT,
  MEDIA_LIBRARY,
  MEDIA_OPTIONS,
  MEDIA_UPLOADS,
} from './tokens';

/** Who is asking: checked by `MediaModuleOptions.authorize`. Default: `req.user`, when a `req` is given. */
export interface MediaCaller {
  user?: unknown;
}

/** `serveFile()`'s options (`req`, `res`, `disposition`, `cacheControl`, `filename`) plus the caller. */
export type MediaServeOptions = ServeFileOptions & MediaCaller;

@Injectable()
export class MediaService {
  constructor(
    @Optional() @Inject(Storage) private readonly storage: Storage | null,
    @Inject(MEDIA_LIBRARY) private readonly mediaLibrary: MediaLibrary | null,
    @Inject(MEDIA_UPLOADS) private readonly uploadManager: ResumableUploadManager | null,
    @Inject(MEDIA_ATTACHMENTS) private readonly attachmentManager: AttachmentManager,
    @Inject(MEDIA_DIRECT) private readonly directManager: DirectUploadManager | null,
    @Optional()
    @Inject(MEDIA_OPTIONS)
    private readonly options: MediaModuleRuntimeOptions | null = null,
  ) {}

  /** Attachment-as-column API (adonis-attachment style): `media.attachments.createFromFile(...)`. */
  get attachments(): AttachmentManager {
    return this.attachmentManager;
  }

  /**
   * Media-library layer (layer 2). Throws if no store was configured. Its methods are not
   * checked by `authorize`; use `serve()`, `url()`, `attach()` and `delete()` on this service
   * for that.
   */
  get library(): MediaLibrary {
    if (!this.mediaLibrary) {
      throw new Error(
        'MediaLibrary is not configured. Pass a `store` to MediaModule.forRoot to enable the media-library layer.',
      );
    }
    return this.mediaLibrary;
  }

  /** Resumable (proxy) uploads. Throws if no upload session store was configured. */
  get uploads(): ResumableUploadManager {
    if (!this.uploadManager) {
      throw new Error(
        'Resumable uploads are not configured. Pass `uploadSessions` to MediaModule.forRoot to enable them.',
      );
    }
    return this.uploadManager;
  }

  /** Direct (S3 multipart presign) uploads. Throws if not configured. */
  get directUploads(): DirectUploadManager {
    if (!this.directManager) {
      throw new Error(
        'Direct uploads are not configured. Pass `direct` (and a `multipart` side-car) to MediaModule.forRoot to enable them.',
      );
    }
    return this.directManager;
  }

  /**
   * Streams a media record (or one of its conversions, generated on first use) as the response,
   * through `@nestjs/storage`'s `serveFile()`: `Range` (206), `If-None-Match` (304), `ETag`,
   * `nosniff`, and `inline` only for types that can't run script. Checked by `authorize` (`read`).
   * An unknown id is a 404.
   *
   * ```ts
   * @Get(':id/:conversion?')
   * file(@Param('id') id: string, @Param('conversion') conversion: string | undefined,
   *      @Req() req: Request, @Res({ passthrough: true }) res: Response) {
   *   return this.media.serve(id, conversion, { req, res });
   * }
   * ```
   */
  async serve(
    id: string,
    conversion: string | undefined,
    options: MediaServeOptions,
  ): Promise<StreamableFile | undefined> {
    const { user, ...serve } = options;
    const record = await this.find(id);
    await this.check(this.caller(user, serve.req), 'read', record);
    const target = await this.library.locate(id, conversion);
    return serveFile(requireStorage(this.storage).disk(target.disk), target.path, {
      disposition: 'inline',
      filename: target.fileName,
      ...serve,
    });
  }

  /**
   * The URL of a media record or conversion (public when the disk has a `publicUrl`, else
   * signed), after `authorize` (`read`).
   */
  async url(
    id: string,
    conversion?: string,
    options: StorageSignedUrlRequest & MediaCaller = {},
  ): Promise<string> {
    const { user, ...signed } = options;
    await this.check(user, 'read', await this.find(id));
    return this.library.url(id, conversion, signed);
  }

  /** `library.attach()`, after `authorize` (`attach`) on the owner and collection. */
  async attach(input: AttachInput, caller: MediaCaller = {}): Promise<MediaRecord> {
    const target: MediaAttachTarget = {
      ownerType: input.ownerType,
      ownerId: input.ownerId,
      collection: input.collection,
    };
    await this.check(caller.user, 'attach', target);
    return this.library.attach(input);
  }

  /** `library.delete()`, after `authorize` (`delete`). A missing id is a no-op, as in the library. */
  async delete(id: string, caller: MediaCaller = {}): Promise<void> {
    let record: MediaRecord;
    try {
      record = (await this.library.locate(id)).record;
    } catch (error) {
      if (isNotFound(error)) return;
      throw error;
    }
    await this.check(caller.user, 'delete', record);
    await this.library.delete(id);
  }

  private async find(id: string): Promise<MediaRecord> {
    try {
      return (await this.library.locate(id)).record;
    } catch (error) {
      if (isNotFound(error)) {
        throw new NotFoundException();
      }
      throw error;
    }
  }

  private caller(user: unknown, req: unknown): unknown {
    return user !== undefined ? user : (req as { user?: unknown } | undefined)?.user;
  }

  private async check(
    user: unknown,
    action: MediaAction,
    subject: MediaRecord | MediaAttachTarget,
  ): Promise<void> {
    await this.options?.authorize?.(user, action, subject);
  }
}

function isNotFound(error: unknown): boolean {
  return error instanceof Error && error.name === 'MediaNotFoundError';
}
