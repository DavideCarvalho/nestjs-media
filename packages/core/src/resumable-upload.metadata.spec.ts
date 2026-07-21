import { subscribe, unsubscribe } from 'node:diagnostics_channel';
import { channelName } from '@dudousxd/nestjs-diagnostics';
import { InMemoryDriver, InMemoryUploadSessionStore } from '@dudousxd/nestjs-media-testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ResumableUploadManager } from './resumable-upload';
import { StorageManager } from './storage-manager';

let manager: ResumableUploadManager;
let sessions: InMemoryUploadSessionStore;
const listeners: { channel: string; fn: (message: unknown) => void }[] = [];

/** Collect the payloads published on one media diagnostics channel. */
function capture(event: 'upload.start' | 'upload.complete'): Record<string, unknown>[] {
  const seen: Record<string, unknown>[] = [];
  const channel = channelName('media', event);
  const fn = (message: unknown) => {
    const payload = (message as { payload?: Record<string, unknown> })?.payload;
    if (payload) seen.push(payload);
  };
  subscribe(channel, fn);
  listeners.push({ channel, fn });
  return seen;
}

beforeEach(() => {
  sessions = new InMemoryUploadSessionStore();
  manager = new ResumableUploadManager({
    storage: new StorageManager({ default: 'd', disks: { d: new InMemoryDriver() } }),
    sessions,
  });
});

afterEach(() => {
  for (const { channel, fn } of listeners.splice(0)) {
    unsubscribe(channel, fn);
  }
});

describe('upload session metadata', () => {
  it('carries host metadata from createUpload through to upload.complete', async () => {
    const completed = capture('upload.complete');
    const metadata = { collectionId: 'c1', audience: ['role:ADMIN'] };

    const session = await manager.createUpload({
      disk: 'd',
      key: 'docs/a.txt',
      size: 5,
      metadata,
    });
    await manager.writeChunk(session.id, 0, Buffer.from('hello'));
    await manager.complete(session.id);

    expect(completed).toHaveLength(1);
    expect(completed[0]?.metadata).toEqual(metadata);
    // ...alongside the fields that were already there
    expect(completed[0]).toMatchObject({ disk: 'd', key: 'docs/a.txt', size: 5 });
  });

  it('also reports it on upload.start', async () => {
    const started = capture('upload.start');
    await manager.createUpload({ disk: 'd', key: 'a.txt', size: 1, metadata: { any: 'thing' } });
    expect(started[0]?.metadata).toEqual({ any: 'thing' });
  });

  it('omits the key entirely when the host supplied none (no behaviour change)', async () => {
    const completed = capture('upload.complete');
    const session = await manager.createUpload({ disk: 'd', key: 'b.txt', size: 2 });
    await manager.writeChunk(session.id, 0, Buffer.from('hi'));
    await manager.complete(session.id);

    expect(completed[0]).not.toHaveProperty('metadata');
  });

  it('survives a store round-trip, so a resumed upload keeps it', async () => {
    const session = await manager.createUpload({
      disk: 'd',
      key: 'c.txt',
      size: 4,
      metadata: { collectionId: 'c9' },
    });
    // a fresh read of the session (what a resumed PATCH does) must still see it
    const reloaded = await sessions.get(session.id);
    expect(reloaded?.metadata).toEqual({ collectionId: 'c9' });
  });
});
