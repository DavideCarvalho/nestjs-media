import { InMemoryDriver, InMemoryUploadSessionStore } from '@dudousxd/nestjs-media-testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { ResumableUploadManager } from './resumable-upload';
import { StorageManager } from './storage-manager';
import { TusUploadHandler, parseTusMetadata } from './tus';

let disk: InMemoryDriver;
let handler: TusUploadHandler;
let tokens: number;

beforeEach(() => {
  disk = new InMemoryDriver();
  tokens = 0;
  const manager = new ResumableUploadManager({
    storage: new StorageManager({ default: 'local', disks: { local: disk } }),
    sessions: new InMemoryUploadSessionStore(),
    idGenerator: () => `s-${++tokens}`,
  });
  handler = new TusUploadHandler({
    manager,
    disk: 'local',
    basePath: '/files',
    maxSize: 1000,
    keyFor: (filename) => `up/${filename}`,
    idGenerator: () => 'tok',
  });
});

const b64 = (s: string) => Buffer.from(s).toString('base64');

describe('parseTusMetadata', () => {
  it('decodes base64 key/value pairs', () => {
    expect(parseTusMetadata(`filename ${b64('a.png')},filetype ${b64('image/png')}`)).toEqual({
      filename: 'a.png',
      filetype: 'image/png',
    });
  });
});

describe('TusUploadHandler', () => {
  it('OPTIONS advertises version + extensions + max size', async () => {
    const res = await handler.handle({ method: 'OPTIONS', headers: {} });
    expect(res.status).toBe(204);
    expect(res.headers['Tus-Version']).toBe('1.0.0');
    expect(res.headers['Tus-Extension']).toContain('creation');
    expect(res.headers['Tus-Max-Size']).toBe('1000');
  });

  it('POST creates an upload and returns its Location', async () => {
    const res = await handler.handle({
      method: 'POST',
      headers: { 'upload-length': '5', 'upload-metadata': `filename ${b64('a.png')}` },
    });
    expect(res.status).toBe(201);
    expect(res.headers.Location).toBe('/files/s-1');
    expect(res.headers['Upload-Offset']).toBe('0');
  });

  it('POST rejects an oversize upload', async () => {
    const res = await handler.handle({ method: 'POST', headers: { 'upload-length': '5000' } });
    expect(res.status).toBe(413);
  });

  it('HEAD reports the current offset; 404 when unknown', async () => {
    await handler.handle({ method: 'POST', headers: { 'upload-length': '5' } });
    const head = await handler.handle({ method: 'HEAD', uploadId: 's-1', headers: {} });
    expect(head.status).toBe(200);
    expect(head.headers['Upload-Offset']).toBe('0');
    expect(head.headers['Upload-Length']).toBe('5');
    expect((await handler.handle({ method: 'HEAD', uploadId: 'ghost', headers: {} })).status).toBe(
      404,
    );
  });

  it('PATCH appends chunks and auto-completes at the declared length', async () => {
    await handler.handle({ method: 'POST', headers: { 'upload-length': '5' } });
    const p1 = await handler.handle({
      method: 'PATCH',
      uploadId: 's-1',
      headers: { 'content-type': 'application/offset+octet-stream', 'upload-offset': '0' },
      body: Buffer.from('he'),
    });
    expect(p1.status).toBe(204);
    expect(p1.headers['Upload-Offset']).toBe('2');

    const p2 = await handler.handle({
      method: 'PATCH',
      uploadId: 's-1',
      headers: { 'content-type': 'application/offset+octet-stream', 'upload-offset': '2' },
      body: Buffer.from('llo'),
    });
    expect(p2.headers['Upload-Offset']).toBe('5');
    // auto-completed → final object assembled, session gone
    expect((await disk.get('up/upload')).toString()).toBe('hello');
    expect((await handler.handle({ method: 'HEAD', uploadId: 's-1', headers: {} })).status).toBe(
      404,
    );
  });

  it('PATCH returns 409 on offset mismatch and 415 on wrong content-type', async () => {
    await handler.handle({ method: 'POST', headers: { 'upload-length': '5' } });
    const conflict = await handler.handle({
      method: 'PATCH',
      uploadId: 's-1',
      headers: { 'content-type': 'application/offset+octet-stream', 'upload-offset': '3' },
      body: Buffer.from('x'),
    });
    expect(conflict.status).toBe(409);
    const badType = await handler.handle({
      method: 'PATCH',
      uploadId: 's-1',
      headers: { 'content-type': 'text/plain', 'upload-offset': '0' },
      body: Buffer.from('x'),
    });
    expect(badType.status).toBe(415);
  });

  it('DELETE aborts an upload', async () => {
    await handler.handle({ method: 'POST', headers: { 'upload-length': '5' } });
    expect((await handler.handle({ method: 'DELETE', uploadId: 's-1', headers: {} })).status).toBe(
      204,
    );
    expect((await handler.handle({ method: 'HEAD', uploadId: 's-1', headers: {} })).status).toBe(
      404,
    );
  });
});
