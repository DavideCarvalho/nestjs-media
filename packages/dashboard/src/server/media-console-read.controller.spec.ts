import { Readable } from 'node:stream';
import { Global, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MediaDashboardModule } from './index.js';
import { parseRangeHeader } from './media-console-read.controller.js';

const STORAGE = Symbol.for('nestjs-media:storage');
const STORE = Symbol.for('nestjs-media:store');
const UPLOADS = Symbol.for('nestjs-media:upload-sessions');

const CONTENT = 'abcdefghij';

const driver = {
  capabilities: { presign: true, multipart: true, publicUrls: false, list: true, ranged: true },
  stat: async () => ({ size: CONTENT.length, contentType: 'text/plain' }),
  stream: async (_key: string, range?: { start: number; end?: number }) => {
    const slice = range
      ? CONTENT.slice(range.start, range.end === undefined ? undefined : range.end + 1)
      : CONTENT;
    return Readable.from(Buffer.from(slice));
  },
};

const fakeStorage = {
  defaultDisk: 'primary',
  diskNames: () => ['primary'],
  disk: () => driver,
};

@Global()
@Module({
  providers: [
    { provide: STORAGE, useValue: fakeStorage },
    { provide: STORE, useValue: null },
    { provide: UPLOADS, useValue: null },
  ],
  exports: [STORAGE, STORE, UPLOADS],
})
class MockMediaModule {}

@Module({
  imports: [
    MockMediaModule,
    MediaDashboardModule.forRoot({ basePath: '/media', apiBasePath: '/api/media', actions: false }),
  ],
})
class AppModule {}

describe('parseRangeHeader', () => {
  it('parses the three forms we serve', () => {
    expect(parseRangeHeader('bytes=0-99')).toEqual({ start: 0, end: 99 });
    expect(parseRangeHeader('bytes=1024-')).toEqual({ start: 1024 });
    expect(parseRangeHeader('bytes=-500')).toEqual({ suffixLength: 500 });
    // Header values arrive with whatever whitespace a client felt like sending.
    expect(parseRangeHeader('  bytes=4-8  ')).toEqual({ start: 4, end: 8 });
  });

  it('returns null — "no range" — for anything it cannot read exactly', () => {
    for (const header of [
      undefined,
      '',
      'bytes=',
      'bytes=-', // names neither bound
      'bytes=0-1,5-6', // multi-range: we serve one range or none, never a guess at the first
      'items=0-1', // unit we do not understand
      'bytes=abc-def',
      'bytes=0-1 ,', // trailing junk
      '0-99', // no unit at all
    ]) {
      expect(parseRangeHeader(header)).toBeNull();
    }
  });
});

describe('GET disks/:disk/object/raw — Range handling (mounted)', () => {
  let url: string;
  let app: Awaited<ReturnType<typeof NestFactory.create>>;

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false });
    await app.listen(0);
    url = `${await app.getUrl()}/api/media/disks/primary/object/raw?key=a.txt`;
  });

  afterAll(async () => {
    await app.close();
  });

  const get = (range?: string) =>
    fetch(url, range === undefined ? {} : { headers: { Range: range } });

  it('serves the full body on a plain request, and still advertises ranges', async () => {
    const response = await get();
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(CONTENT);
    expect(response.headers.get('content-type')).toContain('text/plain');
    expect(response.headers.get('content-disposition')).toBe('inline');
    expect(response.headers.get('content-length')).toBe(String(CONTENT.length));
    expect(response.headers.get('content-range')).toBeNull();
    // Present on the 200 path too — it is the only way a client learns ranges are available here.
    expect(response.headers.get('accept-ranges')).toBe('bytes');
  });

  it('answers a bounded range with 206, Content-Range and the SLICE length', async () => {
    const response = await get('bytes=2-4');
    expect(response.status).toBe(206);
    expect(await response.text()).toBe('cde');
    expect(response.headers.get('content-range')).toBe('bytes 2-4/10');
    expect(response.headers.get('content-length')).toBe('3');
    expect(response.headers.get('accept-ranges')).toBe('bytes');
  });

  it('answers an open-ended and a suffix range', async () => {
    const openEnded = await get('bytes=7-');
    expect(openEnded.status).toBe(206);
    expect(await openEnded.text()).toBe('hij');
    expect(openEnded.headers.get('content-range')).toBe('bytes 7-9/10');

    const suffix = await get('bytes=-4');
    expect(suffix.status).toBe(206);
    expect(await suffix.text()).toBe('ghij');
    expect(suffix.headers.get('content-range')).toBe('bytes 6-9/10');
  });

  it('clamps a range overrunning EOF rather than erroring', async () => {
    const response = await get('bytes=8-100000');
    expect(response.status).toBe(206);
    expect(await response.text()).toBe('ij');
    expect(response.headers.get('content-range')).toBe('bytes 8-9/10');
  });

  it('416s an unsatisfiable range and names the real size', async () => {
    const response = await get('bytes=50-60');
    expect(response.status).toBe(416);
    // RFC 9110's unsatisfied-range form: no bounds, just the size, so the client can re-ask.
    expect(response.headers.get('content-range')).toBe('bytes */10');
  });

  it('ignores a malformed Range and serves the full 200 body (RFC 9110)', async () => {
    for (const header of ['bytes=abc-def', 'items=0-1', 'bytes=0-1,5-6']) {
      const response = await get(header);
      expect(response.status).toBe(200);
      expect(await response.text()).toBe(CONTENT);
      expect(response.headers.get('content-range')).toBeNull();
    }
  });
});
