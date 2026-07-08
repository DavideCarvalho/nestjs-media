import type { AttachmentManager, StorageManager } from '@dudousxd/nestjs-media-core';
import { describe, expect, it } from 'vitest';
import { MediaService } from './media.service';

describe('MediaService.diskNames', () => {
  it('delegates to the storage manager', () => {
    const manager = { diskNames: () => ['pribuy', 'files'] } as unknown as StorageManager;
    const service = new MediaService(manager, null, null, {} as AttachmentManager, null);
    expect(service.diskNames()).toEqual(['pribuy', 'files']);
  });
});
