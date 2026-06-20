import type { MediaLibrary, StorageDriver, StorageManager } from '@dudousxd/nestjs-media-core';
import { Inject, Injectable } from '@nestjs/common';
import { MEDIA_LIBRARY, MEDIA_STORAGE } from './tokens';

@Injectable()
export class MediaService {
  constructor(
    @Inject(MEDIA_STORAGE) private readonly manager: StorageManager,
    @Inject(MEDIA_LIBRARY) private readonly mediaLibrary: MediaLibrary | null,
  ) {}

  /** Storage layer (camada 1): `media.disk('s3').put(...)`. */
  disk(name?: string): StorageDriver {
    return this.manager.disk(name);
  }

  /** Media-library layer (camada 2). Throws if no store was configured. */
  get library(): MediaLibrary {
    if (!this.mediaLibrary) {
      throw new Error(
        'MediaLibrary is not configured. Pass a `store` to MediaModule.forRoot to enable the media-library layer.',
      );
    }
    return this.mediaLibrary;
  }
}
