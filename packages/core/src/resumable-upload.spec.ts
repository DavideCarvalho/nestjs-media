import { InMemoryDriver, InMemoryUploadSessionStore } from '@dudousxd/nestjs-media-testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { UploadOffsetConflictError, UploadSessionNotFoundError } from './errors';
import { ResumableUploadManager } from './resumable-upload';
import { StorageManager } from './storage-manager';

let disk: InMemoryDriver;
let manager: ResumableUploadManager;
let ids: number;

beforeEach(() => {
  disk = new InMemoryDriver();
  ids = 0;
  manager = new ResumableUploadManager({
    storage: new StorageManager({ default: 'local', disks: { local: disk } }),
    sessions: new InMemoryUploadSessionStore(),
    idGenerator: () => `up-${++ids}`,
  });
});

describe('ResumableUploadManager', () => {
  it('uploads in chunks and assembles the final object', async () => {
    const session = await manager.createUpload({ disk: 'local', key: 'videos/clip.bin', size: 6 });
    expect(session.offset).toBe(0);

    expect((await manager.writeChunk(session.id, 0, Buffer.from('abc'))).offset).toBe(3);
    expect((await manager.writeChunk(session.id, 3, Buffer.from('def'))).offset).toBe(6);

    const result = await manager.complete(session.id);
    expect(result).toMatchObject({ key: 'videos/clip.bin', disk: 'local', size: 6 });
    expect((await disk.get('videos/clip.bin')).toString()).toBe('abcdef');
  });

  it('reports status so a client can resume from the offset', async () => {
    const session = await manager.createUpload({ disk: 'local', key: 'f.bin', size: 10 });
    await manager.writeChunk(session.id, 0, Buffer.from('1234'));
    expect(await manager.status(session.id)).toEqual({ offset: 4, size: 10 });
    // resume:
    await manager.writeChunk(session.id, 4, Buffer.from('567890'));
    expect((await manager.complete(session.id)).size).toBe(10);
  });

  it('rejects a chunk written at the wrong offset', async () => {
    const session = await manager.createUpload({ disk: 'local', key: 'f.bin' });
    await manager.writeChunk(session.id, 0, Buffer.from('ab'));
    await expect(manager.writeChunk(session.id, 0, Buffer.from('xx'))).rejects.toBeInstanceOf(
      UploadOffsetConflictError,
    );
  });

  it('cleans up part files on complete', async () => {
    const session = await manager.createUpload({ disk: 'local', key: 'f.bin' });
    await manager.writeChunk(session.id, 0, Buffer.from('ab'));
    await manager.complete(session.id);
    expect(await disk.exists('.uploads/up-1/0')).toBe(false);
  });

  it('abort removes the session and parts', async () => {
    const session = await manager.createUpload({ disk: 'local', key: 'f.bin' });
    await manager.writeChunk(session.id, 0, Buffer.from('ab'));
    await manager.abort(session.id);
    expect(await disk.exists('.uploads/up-1/0')).toBe(false);
    await expect(manager.status(session.id)).rejects.toBeInstanceOf(UploadSessionNotFoundError);
  });

  it('throws for an unknown session', async () => {
    await expect(manager.status('nope')).rejects.toBeInstanceOf(UploadSessionNotFoundError);
  });
});
