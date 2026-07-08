import { InMemoryDriver, InMemoryUploadSessionStore } from '@dudousxd/nestjs-media-testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { UploadOffsetConflictError, UploadSessionNotFoundError } from './errors';
import { ResumableUploadManager } from './resumable-upload';
import { StorageManager } from './storage-manager';
import type { MultipartPart, StorageDriver } from './types';

let disk: InMemoryDriver;
let manager: ResumableUploadManager;
let ids: number;

/** Build a manager whose only disk ('d') is the given (possibly fake) driver. */
function makeManager(driver: StorageDriver): ResumableUploadManager {
  return new ResumableUploadManager({
    storage: new StorageManager({ default: 'd', disks: { d: driver } }),
    sessions: new InMemoryUploadSessionStore(),
  });
}

function fakeMultipartDisk() {
  const parts: Record<string, Buffer[]> = {};
  const completed: Record<string, Buffer> = {};
  let aborted = false;
  return {
    driver: {
      capabilities: { presign: false, multipart: true, publicUrls: false, list: false },
      async createMultipartUpload() {
        parts['u'] = [];
        return { uploadId: 'u' };
      },
      async uploadPart(_p: string, _u: string, n: number, body: Buffer) {
        parts['u'][n - 1] = body;
        return { partNumber: n, etag: `etag-${n}` };
      },
      async completeMultipartUpload(_p: string, _u: string, ps: MultipartPart[]) {
        completed['done'] = Buffer.concat(ps.map((x) => parts['u'][x.partNumber - 1]));
      },
      async abortMultipartUpload() {
        aborted = true;
      },
      async get() {
        throw new Error('must not read parts back in multipart mode');
      },
      async put() {
        throw new Error('must not put whole file in multipart mode');
      },
      async stream() {
        throw new Error('not used by the multipart resumable-upload path');
      },
      async exists() {
        throw new Error('not used by the multipart resumable-upload path');
      },
      async delete() {
        throw new Error('not used by the multipart resumable-upload path');
      },
      async copy() {
        throw new Error('not used by the multipart resumable-upload path');
      },
      async move() {
        throw new Error('not used by the multipart resumable-upload path');
      },
      async size() {
        throw new Error('not used by the multipart resumable-upload path');
      },
      async url() {
        throw new Error('not used by the multipart resumable-upload path');
      },
      async temporaryUrl() {
        throw new Error('not used by the multipart resumable-upload path');
      },
      async list() {
        throw new Error('not used by the multipart resumable-upload path');
      },
    },
    result: () => completed['done'],
    wasAborted: () => aborted,
  };
}

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

  it('multipart disk: each chunk is one part, complete stitches without buffering', async () => {
    const multipartDisk = fakeMultipartDisk();
    const multipartManager = makeManager(multipartDisk.driver);
    const session = await multipartManager.createUpload({ disk: 'd', key: 'k', size: 9 });
    await multipartManager.writeChunk(session.id, 0, Buffer.from('AAAAA')); // part 1
    await multipartManager.writeChunk(session.id, 5, Buffer.from('BBBB')); // part 2 (last, <5MiB ok)
    const result = await multipartManager.complete(session.id);
    expect(result.key).toBe('k');
    expect(multipartDisk.result().toString()).toBe('AAAAABBBB');
  });

  it('multipart disk: abort calls abortMultipartUpload', async () => {
    const multipartDisk = fakeMultipartDisk();
    const multipartManager = makeManager(multipartDisk.driver);
    const session = await multipartManager.createUpload({ disk: 'd', key: 'k' });
    await multipartManager.writeChunk(session.id, 0, Buffer.from('AAAAA'));
    await multipartManager.abort(session.id);
    expect(multipartDisk.wasAborted()).toBe(true);
  });
});
