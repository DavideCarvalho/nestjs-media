import type {
  AttachmentManager,
  DirectUploadManager,
  MediaLibrary,
  ResumableUploadManager,
  StorageDriver,
  StorageManager,
} from '@dudousxd/nestjs-media-core';
import { Inject, Injectable } from '@nestjs/common';
import {
  MEDIA_ATTACHMENTS,
  MEDIA_DIRECT,
  MEDIA_LIBRARY,
  MEDIA_STORAGE,
  MEDIA_UPLOADS,
} from './tokens';

@Injectable()
export class MediaService {
  constructor(
    @Inject(MEDIA_STORAGE) private readonly manager: StorageManager,
    @Inject(MEDIA_LIBRARY) private readonly mediaLibrary: MediaLibrary | null,
    @Inject(MEDIA_UPLOADS) private readonly uploadManager: ResumableUploadManager | null,
    @Inject(MEDIA_ATTACHMENTS) private readonly attachmentManager: AttachmentManager,
    @Inject(MEDIA_DIRECT) private readonly directManager: DirectUploadManager | null,
  ) {}

  /** Attachment-as-column API (adonis-attachment style): `media.attachments.createFromFile(...)`. */
  get attachments(): AttachmentManager {
    return this.attachmentManager;
  }

  /** Storage layer (layer 1): `media.disk('s3').put(...)`. */
  disk(name?: string): StorageDriver {
    return this.manager.disk(name);
  }

  /** Media-library layer (layer 2). Throws if no store was configured. */
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
        'Direct uploads are not configured. Pass `direct` to MediaModule.forRoot to enable them.',
      );
    }
    return this.directManager;
  }
}
