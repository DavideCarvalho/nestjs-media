import { subscribe, unsubscribe } from 'node:diagnostics_channel';
import { channelName } from '@dudousxd/nestjs-diagnostics';
import type { DiagnosticEvent } from '@dudousxd/nestjs-diagnostics';
import {
  InMemoryDriver,
  InMemoryMediaStore,
  InMemoryUploadSessionStore,
} from '@dudousxd/nestjs-media-testing';
import { afterEach, describe, expect, it } from 'vitest';
import { AttachmentManager } from './attachment';
import { MediaLibrary } from './media-library';
import { ResumableUploadManager } from './resumable-upload';
import { StorageManager } from './storage-manager';

function library(emitDiagnostics = true) {
  const disk = new InMemoryDriver();
  return new MediaLibrary({
    storage: new StorageManager({ default: 'local', disks: { local: disk } }),
    store: new InMemoryMediaStore(),
    emitDiagnostics,
    idGenerator: () => 'id-1',
    clock: () => new Date(0),
  });
}

const attachInput = {
  ownerType: 'Post',
  ownerId: '1',
  collection: 'gallery',
  fileName: 'a.png',
  mimeType: 'image/png',
  contents: Buffer.from('x'),
};

const listeners: Array<{ name: string; fn: (m: unknown) => void }> = [];
function listen(channel: string): DiagnosticEvent[] {
  const received: DiagnosticEvent[] = [];
  const fn = (m: unknown) => received.push(m as DiagnosticEvent);
  subscribe(channel, fn);
  listeners.push({ name: channel, fn });
  return received;
}

afterEach(() => {
  while (listeners.length) {
    const l = listeners.pop();
    if (l) unsubscribe(l.name, l.fn);
  }
});

describe('media diagnostics channels', () => {
  it('publishes aviary:media:attach with the standard envelope via @dudousxd/nestjs-diagnostics', async () => {
    const events = listen(channelName('media', 'attach'));
    await library().attach(attachInput);
    expect(events).toHaveLength(1);
    expect(events[0]?.lib).toBe('media');
    expect(events[0]?.event).toBe('attach');
    expect(typeof events[0]?.ts).toBe('number');
    expect(events[0]?.payload).toMatchObject({ id: 'id-1', collection: 'gallery', disk: 'local' });
  });

  it('publishes aviary:media:delete', async () => {
    const events = listen(channelName('media', 'delete'));
    const lib = library();
    await lib.attach(attachInput);
    await lib.delete('id-1');
    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toMatchObject({ id: 'id-1' });
  });

  it('does not publish when emitDiagnostics is false', async () => {
    const events = listen(channelName('media', 'attach'));
    await library(false).attach(attachInput);
    expect(events).toHaveLength(0);
  });
});

describe('resumable upload diagnostics', () => {
  function uploads() {
    const disk = new InMemoryDriver();
    return new ResumableUploadManager({
      storage: new StorageManager({ default: 'local', disks: { local: disk } }),
      sessions: new InMemoryUploadSessionStore(),
      idGenerator: () => 'up-1',
    });
  }

  it('publishes start, progress, and complete across an upload lifecycle', async () => {
    const start = listen(channelName('media', 'upload.start'));
    const progress = listen(channelName('media', 'upload.progress'));
    const complete = listen(channelName('media', 'upload.complete'));

    const mgr = uploads();
    const session = await mgr.createUpload({ disk: 'local', key: 'out.bin', size: 4 });
    await mgr.writeChunk(session.id, 0, Buffer.from('ab'));
    await mgr.writeChunk(session.id, 2, Buffer.from('cd'));
    await mgr.complete(session.id);

    expect(start[0]?.payload).toMatchObject({ id: 'up-1', disk: 'local', key: 'out.bin', size: 4 });
    expect(progress.map((e) => (e.payload as { offset: number }).offset)).toEqual([2, 4]);
    expect(complete[0]?.payload).toMatchObject({ id: 'up-1', key: 'out.bin', size: 4 });
  });

  it('publishes abort when a session is discarded', async () => {
    const aborted = listen(channelName('media', 'upload.abort'));
    const mgr = uploads();
    const session = await mgr.createUpload({ disk: 'local', key: 'out.bin' });
    await mgr.abort(session.id);
    expect(aborted[0]?.payload).toMatchObject({ id: 'up-1' });
  });
});

describe('attachment diagnostics', () => {
  function attachments() {
    const disk = new InMemoryDriver();
    return new AttachmentManager({
      storage: new StorageManager({ default: 'local', disks: { local: disk } }),
      idGenerator: () => 'att-1',
    });
  }

  it('publishes attachment.create and attachment.delete', async () => {
    const created = listen(channelName('media', 'attachment.create'));
    const deleted = listen(channelName('media', 'attachment.delete'));

    const mgr = attachments();
    const att = await mgr.createFromFile({
      fileName: 'me.png',
      mimeType: 'image/png',
      contents: Buffer.from('bytes'),
    });
    await mgr.delete(att);

    expect(created[0]?.payload).toMatchObject({
      disk: 'local',
      path: 'attachments/att-1/me.png',
      mimeType: 'image/png',
      name: 'me.png',
      variants: [],
    });
    expect(deleted[0]?.payload).toMatchObject({ disk: 'local', path: 'attachments/att-1/me.png' });
  });
});
