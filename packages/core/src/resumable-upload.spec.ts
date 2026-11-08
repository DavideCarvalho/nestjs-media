import { Readable } from 'node:stream';
import { InMemoryUploadSessionStore, storageOf } from '@dudousxd/nestjs-media-testing';
import { InMemoryDisk, type StorageDisk, type StorageDownload } from '@nestjs/storage';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  InvalidPartNumberError,
  UploadOffsetConflictError,
  UploadSessionNotFoundError,
} from './errors';
import { ResumableUploadManager } from './resumable-upload';
import type {
  UploadSession,
  UploadSessionListFilter,
  UploadSessionStore,
} from './resumable-upload';
import type { MultipartPart, MultipartUploadDriver } from './types';

let disk: InMemoryDisk;
let manager: ResumableUploadManager;
let ids: number;

/** Build a manager whose only disk ('d') is the given disk, with an optional multipart side-car. */
function makeManager(
  driver: StorageDisk,
  multipart?: MultipartUploadDriver,
): ResumableUploadManager {
  return new ResumableUploadManager({
    storage: storageOf({ d: driver }, 'd'),
    ...(multipart ? { multipart: { d: multipart } } : {}),
    sessions: new InMemoryUploadSessionStore(),
  });
}

/** A disk that fails any use: the multipart path must not touch the disk itself. */
class UntouchableDisk extends InMemoryDisk {
  override async get(): Promise<never> {
    throw new Error('must not read parts back in multipart mode');
  }
  override async put(): Promise<never> {
    throw new Error('must not put whole file in multipart mode');
  }
  override async delete(): Promise<never> {
    throw new Error('not used by the multipart resumable-upload path');
  }
}

function fakeMultipartDisk() {
  // Single-upload fake: only one multipart upload is ever in flight per
  // `fakeMultipartDisk()` instance, so a plain array/variable (rather than a
  // Record keyed by uploadId) sidesteps noUncheckedIndexedAccess entirely.
  let parts: Buffer[] = [];
  let completed: Buffer | undefined;
  let aborted = false;
  const multipart: MultipartUploadDriver = {
    async createMultipartUpload() {
      parts = [];
      return { uploadId: 'u' };
    },
    async uploadPart(_p: string, _u: string, n: number, body: Buffer) {
      parts[n - 1] = body;
      return { partNumber: n, etag: `etag-${n}` };
    },
    async presignUploadPart() {
      throw new Error('not used by the resumable-upload path');
    },
    async completeMultipartUpload(_p: string, _u: string, ps: MultipartPart[]) {
      completed = Buffer.concat(ps.map((x) => parts[x.partNumber - 1] ?? Buffer.alloc(0)));
    },
    async abortMultipartUpload() {
      aborted = true;
    },
  };
  return {
    disk: new UntouchableDisk(),
    multipart,
    result: () => completed,
    wasAborted: () => aborted,
  };
}

beforeEach(() => {
  disk = new InMemoryDisk();
  ids = 0;
  manager = new ResumableUploadManager({
    storage: storageOf({ local: disk }, 'local'),
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
    expect(await disk.getText('videos/clip.bin')).toBe('abcdef');
  });

  it('assembles parts by streaming them into put, opening each part only after the previous one drains', async () => {
    const events: string[] = [];
    class TracingDriver extends InMemoryDisk {
      override async get(key: string): Promise<StorageDownload> {
        events.push(`open ${key}`);
        return super.get(key);
      }
      override async put(
        key: string,
        body: Parameters<InMemoryDisk['put']>[1],
        options?: Parameters<InMemoryDisk['put']>[2],
      ) {
        if (key !== 'big.bin') return super.put(key, body, options);
        if (Buffer.isBuffer(body)) {
          events.push('put buffer');
          return super.put(key, body, options);
        }
        const received: Buffer[] = [];
        for await (const chunk of body as Readable) {
          events.push(`read ${chunk.toString()}`);
          received.push(chunk);
        }
        return super.put(key, Buffer.concat(received), options);
      }
    }
    const tracing = new TracingDriver();
    const streaming = makeManager(tracing);
    const session = await streaming.createUpload({ disk: 'd', key: 'big.bin' });
    await streaming.writeChunk(session.id, 0, Buffer.from('aa'));
    await streaming.writeChunk(session.id, 2, Buffer.from('bb'));
    await streaming.writeChunk(session.id, 4, Buffer.from('cc'));

    await streaming.complete(session.id);

    const prefix = `.uploads/${session.id}`;
    expect(events).toEqual([
      `open ${prefix}/0`,
      'read aa',
      `open ${prefix}/1`,
      'read bb',
      `open ${prefix}/2`,
      'read cc',
    ]);
    expect(await tracing.getText('big.bin')).toBe('aabbcc');
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
    const multipartManager = makeManager(multipartDisk.disk, multipartDisk.multipart);
    const session = await multipartManager.createUpload({ disk: 'd', key: 'k', size: 9 });
    await multipartManager.writeChunk(session.id, 0, Buffer.from('AAAAA')); // part 1
    await multipartManager.writeChunk(session.id, 5, Buffer.from('BBBB')); // part 2 (last, <5MiB ok)
    const result = await multipartManager.complete(session.id);
    expect(result.key).toBe('k');
    expect(multipartDisk.result()?.toString()).toBe('AAAAABBBB');
  });

  it('multipart disk: abort calls abortMultipartUpload', async () => {
    const multipartDisk = fakeMultipartDisk();
    const multipartManager = makeManager(multipartDisk.disk, multipartDisk.multipart);
    const session = await multipartManager.createUpload({ disk: 'd', key: 'k' });
    await multipartManager.writeChunk(session.id, 0, Buffer.from('AAAAA'));
    await multipartManager.abort(session.id);
    expect(multipartDisk.wasAborted()).toBe(true);
  });
});

describe('ResumableUploadManager.writePart (parallel multipart)', () => {
  interface FakeDisk {
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
    return new ResumableUploadManager({
      storage: storageOf({ s3: new InMemoryDisk() }),
      multipart: { s3: multipartDisk as unknown as MultipartUploadDriver },
      sessions: store,
      emitDiagnostics: false,
    });
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

  it('listParts returns the recorded parts after writePart', async () => {
    const store = makeStore();
    const partManager = makeMultipartManager(store, {});
    const session = await partManager.createUpload({ disk: 's3', key: 'k/o.bin', size: 10 });

    await partManager.writePart(session.id, 1, Buffer.alloc(5));
    await partManager.writePart(session.id, 2, Buffer.alloc(5));

    const recorded = await partManager.listParts(session.id);
    expect(recorded).toEqual(
      expect.arrayContaining([
        { partNumber: 1, etag: 'etag-1' },
        { partNumber: 2, etag: 'etag-2' },
      ]),
    );
    expect(recorded).toHaveLength(2);
  });

  it('complete() reports the declared session size, not the (unmoved) offset', async () => {
    const store = makeStore();
    const completed: { parts?: Array<{ partNumber: number; etag: string }> } = {};
    const partManager = makeMultipartManager(store, completed);
    const session = await partManager.createUpload({ disk: 's3', key: 'k/obj.bin', size: 30 });

    await partManager.writePart(session.id, 1, Buffer.alloc(15));
    await partManager.writePart(session.id, 2, Buffer.alloc(15));

    const result = await partManager.complete(session.id);
    expect(result.size).toBe(30);
    expect(result.size).not.toBe(0);
  });

  it('writePart does not mutate session.offset or session.parts', async () => {
    const store = makeStore();
    const partManager = makeMultipartManager(store, {});
    const session = await partManager.createUpload({ disk: 's3', key: 'k/o.bin', size: 10 });

    const before = await store.get(session.id);
    expect(before?.offset).toBe(0);
    expect(before?.parts).toBe(0);

    await partManager.writePart(session.id, 1, Buffer.alloc(5));

    const after = await store.get(session.id);
    expect(after?.offset).toBe(0);
    expect(after?.parts).toBe(0);
  });
});

describe('UploadSessionStore.list SPI', () => {
  it('accepts a store that implements the optional list()', async () => {
    const session: UploadSession = {
      id: 'a',
      disk: 'local',
      key: 'k',
      contentType: undefined,
      size: 10,
      offset: 5,
      parts: 1,
    };
    const filter: UploadSessionListFilter = { disk: 'local' };
    const store: UploadSessionStore = {
      create: async (s) => s,
      get: async () => session,
      update: async (s) => s,
      delete: async () => {},
      list: async (f?: UploadSessionListFilter) => (f?.disk === 'local' ? [session] : []),
    };
    expect(await store.list?.(filter)).toEqual([session]);
  });
});
