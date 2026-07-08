import { InMemoryDriver, InMemoryUploadSessionStore } from '@dudousxd/nestjs-media-testing';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  InvalidPartNumberError,
  UploadOffsetConflictError,
  UploadSessionNotFoundError,
} from './errors';
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
        parts.u = [];
        return { uploadId: 'u' };
      },
      async uploadPart(_p: string, _u: string, n: number, body: Buffer) {
        parts.u[n - 1] = body;
        return { partNumber: n, etag: `etag-${n}` };
      },
      async completeMultipartUpload(_p: string, _u: string, ps: MultipartPart[]) {
        completed.done = Buffer.concat(ps.map((x) => parts.u[x.partNumber - 1]));
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
    result: () => completed.done,
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

describe('ResumableUploadManager.writePart (parallel multipart)', () => {
  interface FakeDisk {
    capabilities: { multipart: boolean };
    uploadPart: (
      key: string,
      uploadId: string,
      partNumber: number,
      chunk: Buffer,
    ) => Promise<{ partNumber: number; etag: string }>;
    completeMultipartUpload: (
      key: string,
      uploadId: string,
      parts: Array<{ partNumber: number; etag: string }>,
    ) => Promise<void>;
    createMultipartUpload: (key: string) => Promise<{ uploadId: string }>;
  }

  function makeStore() {
    const sessions = new Map<string, any>();
    const parts = new Map<string, Map<number, string>>();
    return {
      sessions,
      parts,
      async create(s: any) {
        sessions.set(s.id, { ...s });
        return { ...s };
      },
      async get(id: string) {
        const s = sessions.get(id);
        return s ? { ...s } : null;
      },
      async update(s: any) {
        sessions.set(s.id, { ...s });
        return { ...s };
      },
      async delete(id: string) {
        sessions.delete(id);
        parts.delete(id);
      },
      async addPart(id: string, part: { partNumber: number; etag: string }) {
        if (!parts.has(id)) parts.set(id, new Map());
        parts.get(id)?.set(part.partNumber, part.etag);
      },
      async listParts(id: string) {
        return [...(parts.get(id) ?? new Map()).entries()].map(([partNumber, etag]) => ({
          partNumber,
          etag,
        }));
      },
    };
  }

  function makeMultipartManager(
    store: any,
    completed: { parts?: Array<{ partNumber: number; etag: string }> },
  ) {
    const multipartDisk: FakeDisk = {
      capabilities: { multipart: true },
      async createMultipartUpload() {
        return { uploadId: 'mp-1' };
      },
      async uploadPart(_k, _u, partNumber) {
        return { partNumber, etag: `etag-${partNumber}` };
      },
      async completeMultipartUpload(_k, _u, parts) {
        completed.parts = parts;
      },
    };
    const storage = { disk: () => multipartDisk } as any;
    return new ResumableUploadManager({ storage, sessions: store, emitDiagnostics: false });
  }

  it('records concurrent, out-of-order parts and completes them sorted ascending', async () => {
    const store = makeStore();
    const completed: { parts?: Array<{ partNumber: number; etag: string }> } = {};
    const partManager = makeMultipartManager(store, completed);
    const session = await partManager.createUpload({ disk: 's3', key: 'k/obj.bin', size: 30 });

    // Upload parts out of order and concurrently.
    await Promise.all([
      partManager.writePart(session.id, 3, Buffer.alloc(10)),
      partManager.writePart(session.id, 1, Buffer.alloc(10)),
      partManager.writePart(session.id, 2, Buffer.alloc(10)),
    ]);
    await partManager.complete(session.id);

    expect(completed.parts).toEqual([
      { partNumber: 1, etag: 'etag-1' },
      { partNumber: 2, etag: 'etag-2' },
      { partNumber: 3, etag: 'etag-3' },
    ]);
  });

  it('rejects a part number outside 1..10000', async () => {
    const store = makeStore();
    const partManager = makeMultipartManager(store, {});
    const session = await partManager.createUpload({ disk: 's3', key: 'k/o.bin', size: 10 });
    await expect(partManager.writePart(session.id, 0, Buffer.alloc(1))).rejects.toBeInstanceOf(
      InvalidPartNumberError,
    );
  });

  it('throws when the store cannot record parts atomically (no addPart)', async () => {
    const store = makeStore();
    (store as any).addPart = undefined;
    const partManager = makeMultipartManager(store, {});
    const session = await partManager.createUpload({ disk: 's3', key: 'k/o.bin', size: 10 });
    await expect(partManager.writePart(session.id, 1, Buffer.alloc(1))).rejects.toThrow(
      /concurrent part writes/,
    );
  });
});
