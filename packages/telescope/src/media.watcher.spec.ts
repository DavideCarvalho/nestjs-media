import { publishMedia } from '@dudousxd/nestjs-media-core';
import type { WatcherContext } from '@dudousxd/nestjs-telescope';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MediaWatcher } from './media.watcher';

let watcher: MediaWatcher;

afterEach(() => watcher?.dispose());

function mockCtx() {
  return { record: vi.fn() } as unknown as WatcherContext & { record: ReturnType<typeof vi.fn> };
}

describe('MediaWatcher', () => {
  it('declares the media entry type', () => {
    expect(new MediaWatcher().type).toBe('media');
  });

  it('records a media entry for each emitted event', () => {
    const ctx = mockCtx();
    watcher = new MediaWatcher();
    watcher.register(ctx);

    publishMedia('attach', { id: 'm1', collection: 'gallery', disk: 's3' });
    publishMedia('conversion', { id: 'm1', conversion: 'thumb' });

    expect(ctx.record).toHaveBeenCalledTimes(2);
    expect(ctx.record).toHaveBeenNthCalledWith(1, {
      type: 'media',
      content: { event: 'attach', id: 'm1', collection: 'gallery', disk: 's3' },
    });
    expect(ctx.record).toHaveBeenNthCalledWith(2, {
      type: 'media',
      content: { event: 'conversion', id: 'm1', conversion: 'thumb' },
    });
  });

  it('stops recording after dispose', () => {
    const ctx = mockCtx();
    watcher = new MediaWatcher();
    watcher.register(ctx);
    watcher.dispose();
    publishMedia('delete', { id: 'gone' });
    expect(ctx.record).not.toHaveBeenCalled();
  });
});
