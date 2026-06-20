import type { StorageDriver, StorageManager } from '@dudousxd/nestjs-media-core';
import { Inject, Injectable } from '@nestjs/common';
import { MEDIA_STORAGE } from './tokens';

@Injectable()
export class MediaService {
  constructor(@Inject(MEDIA_STORAGE) private readonly manager: StorageManager) {}

  disk(name?: string): StorageDriver {
    return this.manager.disk(name);
  }
}
