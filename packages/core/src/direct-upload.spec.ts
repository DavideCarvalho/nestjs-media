import { subscribe, unsubscribe } from 'node:diagnostics_channel';
import { channelName } from '@dudousxd/nestjs-diagnostics';
import type { DiagnosticEvent } from '@dudousxd/nestjs-diagnostics';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DirectUploadManager } from './direct-upload';
import { UnsupportedOperationError } from './errors';
import { StorageManager } from './storage-manager';
import type {
  DriverCapabilities,
  ListOptions,
  ListResult,
  MultipartPart,
  PutOptions,
  StorageDriver,
} from './types';

// --- Fake multipart-capable driver ---

interface FakeMultipartDriver extends StorageDriver {
  createMultipartUpload: ReturnType<typeof vi.fn>;
  presignUploadPart: ReturnType<typeof vi.fn>;
  completeMultipartUpload: ReturnType<typeof vi.fn>;
  abortMultipartUpload: ReturnType<typeof vi.fn>;
}

function makeFakeDriver(): FakeMultipartDriver {
  let partCounter = 0;
  return {
    capabilities: {
      presign: true,
      multipart: true,
      publicUrls: false,
      list: false,
    } satisfies DriverCapabilities,
    put: vi.fn(),
    get: vi.fn(),
    stream: vi.fn(),
    exists: vi.fn(),
    delete: vi.fn(),
    copy: vi.fn(),
    move: vi.fn(),
    size: vi.fn(),
    url: vi.fn(),
    temporaryUrl: vi.fn(),
    list: vi.fn<[string, ListOptions?], Promise<ListResult>>(),
    createMultipartUpload: vi.fn((_path: string, _options?: PutOptions) =>
      Promise.resolve({ uploadId: 'uid-1' }),
    ),
    presignUploadPart: vi.fn(
      (_path: string, _uploadId: string, partNumber: number, _expiry: number) =>
        Promise.resolve(`https://s3.example.com/part-${partNumber}-${++partCounter}`),
    ),
    completeMultipartUpload: vi.fn((_path: string, _uploadId: string, _parts: MultipartPart[]) =>
      Promise.resolve(),
    ),
    abortMultipartUpload: vi.fn((_path: string, _uploadId: string) => Promise.resolve()),
  };
}

// --- Fake non-multipart driver ---

function makeBasicDriver(): StorageDriver {
  return {
    capabilities: {
      presign: false,
      multipart: false,
      publicUrls: false,
      list: false,
    } satisfies DriverCapabilities,
    put: vi.fn(),
    get: vi.fn(),
    stream: vi.fn(),
    exists: vi.fn(),
    delete: vi.fn(),
    copy: vi.fn(),
    move: vi.fn(),
    size: vi.fn(),
    url: vi.fn(),
    temporaryUrl: vi.fn(),
    list: vi.fn<[string, ListOptions?], Promise<ListResult>>(),
  };
}

// --- Diagnostics helpers ---

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

// --- Tests ---

describe('DirectUploadManager', () => {
  let fakeDriver: FakeMultipartDriver;
  let manager: DirectUploadManager;

  beforeEach(() => {
    fakeDriver = makeFakeDriver();
    manager = new DirectUploadManager({
      storage: new StorageManager({ default: 'm', disks: { m: fakeDriver } }),
      defaultPartSize: 8 * 1024 * 1024,
      presignExpirySeconds: 3600,
    });
  });

  it('createUpload with size=20MB partSize=8MB creates 3 parts and emits upload.start', async () => {
    const startEvents = listen(channelName('media', 'upload.start'));

    const result = await manager.createUpload({
      key: 'uploads/video.mp4',
      contentType: 'video/mp4',
      size: 20 * 1024 * 1024,
      partSize: 8 * 1024 * 1024,
    });

    expect(fakeDriver.createMultipartUpload).toHaveBeenCalledWith('uploads/video.mp4', {
      contentType: 'video/mp4',
    });
    expect(result.uploadId).toBe('uid-1');
    expect(result.key).toBe('uploads/video.mp4');
    expect(result.disk).toBe('m');
    expect(result.partSize).toBe(8 * 1024 * 1024);
    expect(result.parts).toHaveLength(3);
    expect(result.parts[0]).toMatchObject({ partNumber: 1 });
    expect(result.parts[1]).toMatchObject({ partNumber: 2 });
    expect(result.parts[2]).toMatchObject({ partNumber: 3 });
    expect(result.parts[0]?.url).toContain('part-1');
    expect(result.parts[1]?.url).toContain('part-2');
    expect(result.parts[2]?.url).toContain('part-3');

    expect(startEvents).toHaveLength(1);
    expect(startEvents[0]?.payload).toMatchObject({
      id: 'uid-1',
      disk: 'm',
      key: 'uploads/video.mp4',
      size: 20 * 1024 * 1024,
      contentType: 'video/mp4',
    });
  });

  it('presignPart returns url for the requested part', async () => {
    const result = await manager.presignPart({
      key: 'uploads/video.mp4',
      uploadId: 'uid-1',
      partNumber: 2,
    });

    expect(fakeDriver.presignUploadPart).toHaveBeenCalledWith(
      'uploads/video.mp4',
      'uid-1',
      2,
      3600,
    );
    expect(result.url).toContain('part-2');
  });

  it('completeUpload calls driver.completeMultipartUpload and emits upload.complete', async () => {
    const completeEvents = listen(channelName('media', 'upload.complete'));

    const parts: MultipartPart[] = [
      { partNumber: 1, etag: 'etag-1' },
      { partNumber: 2, etag: 'etag-2' },
    ];

    const result = await manager.completeUpload({
      key: 'uploads/video.mp4',
      uploadId: 'uid-1',
      parts,
    });

    expect(fakeDriver.completeMultipartUpload).toHaveBeenCalledWith(
      'uploads/video.mp4',
      'uid-1',
      parts,
    );
    expect(result).toEqual({ key: 'uploads/video.mp4', disk: 'm' });

    expect(completeEvents).toHaveLength(1);
    expect(completeEvents[0]?.payload).toMatchObject({
      id: 'uid-1',
      disk: 'm',
      key: 'uploads/video.mp4',
    });
  });

  it('abortUpload calls driver.abortMultipartUpload and emits upload.abort', async () => {
    const abortEvents = listen(channelName('media', 'upload.abort'));

    await manager.abortUpload({ key: 'uploads/video.mp4', uploadId: 'uid-1' });

    expect(fakeDriver.abortMultipartUpload).toHaveBeenCalledWith('uploads/video.mp4', 'uid-1');

    expect(abortEvents).toHaveLength(1);
    expect(abortEvents[0]?.payload).toMatchObject({ id: 'uid-1' });
  });

  it('createUpload on a non-multipart disk throws UnsupportedOperationError', async () => {
    const basicDriver = makeBasicDriver();
    const mgr = new DirectUploadManager({
      storage: new StorageManager({ default: 'basic', disks: { basic: basicDriver } }),
    });

    await expect(mgr.createUpload({ key: 'file.bin' })).rejects.toBeInstanceOf(
      UnsupportedOperationError,
    );
  });
});
