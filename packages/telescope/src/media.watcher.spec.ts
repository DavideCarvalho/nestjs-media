import { isDiagnosticClaimed } from '@dudousxd/nestjs-diagnostics';
import { publishMedia } from '@dudousxd/nestjs-media-core';
import type { WatcherContext } from '@dudousxd/nestjs-telescope';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MediaWatcher } from './media.watcher';

const RECORDED_EVENTS = [
  'attach',
  'delete',
  'conversion',
  'upload.start',
  'upload.complete',
  'upload.abort',
  'attachment.create',
  'attachment.delete',
] as const;

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

    const attachPayload = {
      id: 'm1',
      ownerType: 'Post',
      ownerId: 'p1',
      collection: 'gallery',
      disk: 's3',
      path: 'gallery/m1.jpg',
      size: 1024,
      mimeType: 'image/jpeg',
    };
    const conversionPayload = { id: 'm1', conversion: 'thumb', path: 'gallery/m1-thumb.jpg' };
    publishMedia('attach', attachPayload);
    publishMedia('conversion', conversionPayload);

    expect(ctx.record).toHaveBeenCalledTimes(2);
    expect(ctx.record).toHaveBeenNthCalledWith(1, {
      type: 'media',
      content: { event: 'attach', ...attachPayload },
    });
    expect(ctx.record).toHaveBeenNthCalledWith(2, {
      type: 'media',
      content: { event: 'conversion', ...conversionPayload },
    });
  });

  it('stops recording after dispose', () => {
    const ctx = mockCtx();
    watcher = new MediaWatcher();
    watcher.register(ctx);
    watcher.dispose();
    publishMedia('delete', { id: 'gone', ownerType: 'Post', ownerId: 'p1' });
    expect(ctx.record).not.toHaveBeenCalled();
  });

  it('claims every recorded event, but not upload.progress', () => {
    watcher = new MediaWatcher();
    watcher.register(mockCtx());

    for (const event of RECORDED_EVENTS) {
      expect(isDiagnosticClaimed('media', event)).toBe(true);
    }
    expect(isDiagnosticClaimed('media', 'upload.progress')).toBe(false);
  });

  it('releases the claim on dispose', () => {
    watcher = new MediaWatcher();
    watcher.register(mockCtx());
    watcher.dispose();

    for (const event of RECORDED_EVENTS) {
      expect(isDiagnosticClaimed('media', event)).toBe(false);
    }
  });
});
