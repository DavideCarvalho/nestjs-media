import { Global, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { InMemoryDisk, StorageModule } from '@nestjs/storage';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MediaDashboardModule } from './index.js';

const STORE = Symbol.for('nestjs-media:store');
const UPLOADS = Symbol.for('nestjs-media:upload-sessions');

const CONTENT = 'abcdefghij';
const disk = new InMemoryDisk();

@Global()
@Module({
  providers: [
    { provide: STORE, useValue: null },
    { provide: UPLOADS, useValue: null },
  ],
  exports: [STORE, UPLOADS],
})
class MockMediaModule {}

@Module({
  imports: [
    StorageModule.forRoot({ disks: { primary: disk } }),
    MockMediaModule,
    MediaDashboardModule.forRoot({ basePath: '/media', apiBasePath: '/api/media', actions: false }),
  ],
})
class AppModule {}

beforeAll(async () => {
  for (const key of [
    'a.txt',
    'reports/2026/q1.csv',
    'relatório.csv',
    'q1.csv',
    'reports/q1 final.csv',
  ]) {
    await disk.put(key, CONTENT);
  }
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
    expect(response.headers.get('content-disposition')).toBe('inline; filename="a.txt"');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
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

  it('answers If-None-Match with 304', async () => {
    const etag = (await get()).headers.get('etag') ?? '';
    const response = await fetch(url, { headers: { 'If-None-Match': etag } });
    expect(response.status).toBe(304);
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

describe('GET disks/:disk/object/download — saving a file (mounted)', () => {
  let base: string;
  let app: Awaited<ReturnType<typeof NestFactory.create>>;

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false });
    await app.listen(0);
    base = `${await app.getUrl()}/api/media/disks/primary/object/download`;
  });

  afterAll(async () => {
    await app.close();
  });

  const download = (key: string, range?: string) =>
    fetch(
      `${base}?key=${encodeURIComponent(key)}`,
      range === undefined ? {} : { headers: { Range: range } },
    );

  it('serves the same bytes as /raw, but as an attachment named after the key', async () => {
    const response = await download('reports/2026/q1.csv');
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(CONTENT);
    expect(response.headers.get('content-length')).toBe(String(CONTENT.length));
    // The name is the key's LAST segment — a browser must not be asked to save `reports/2026/q1.csv`.
    expect(response.headers.get('content-disposition')).toBe('attachment; filename="q1.csv"');
  });

  it('carries a non-ASCII name in filename* with an ASCII fallback beside it', async () => {
    const response = await download('relatório.csv');
    expect(response.headers.get('content-disposition')).toBe(
      `attachment; filename="relat_rio.csv"; filename*=UTF-8''relat%C3%B3rio.csv`,
    );
  });

  it('404s a key no disk can hold (a folder path)', async () => {
    const response = await download('reports/2026/');
    expect(response.status).toBe(404);
  });

  it('resumes: a Range on a download is answered 206 with the slice', async () => {
    const response = await download('q1.csv', 'bytes=4-6');
    expect(response.status).toBe(206);
    expect(await response.text()).toBe('efg');
    expect(response.headers.get('content-range')).toBe('bytes 4-6/10');
    expect(response.headers.get('accept-ranges')).toBe('bytes');
    // The disposition survives the partial response — otherwise a resumed download renders inline.
    expect(response.headers.get('content-disposition')).toBe('attachment; filename="q1.csv"');
  });

  it('reads back the form encoding the client actually sends', async () => {
    // The client builds its query with `URLSearchParams`, which writes a space as `+`, not `%20`.
    // If the server read that literally the saved file would be named `q1+final.csv`.
    const response = await fetch(`${base}?key=reports%2Fq1+final.csv`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-disposition')).toBe('attachment; filename="q1 final.csv"');
  });

  it('404s an unknown disk instead of streaming from nowhere', async () => {
    const response = await fetch(
      `${await app.getUrl()}/api/media/disks/nope/object/download?key=a.txt`,
    );
    expect(response.status).toBe(404);
  });

  it('/raw is inline for types that cannot run script here, attachment for the rest', async () => {
    const text = await fetch(`${await app.getUrl()}/api/media/disks/primary/object/raw?key=a.txt`);
    expect(text.headers.get('content-disposition')).toBe('inline; filename="a.txt"');
    // CSV (like HTML or SVG) is not in serveFile's inline-safe list: the previews `fetch` it, which
    // ignores the disposition; opening it directly downloads it.
    const csv = await fetch(`${await app.getUrl()}/api/media/disks/primary/object/raw?key=q1.csv`);
    expect(csv.headers.get('content-disposition')).toBe('attachment; filename="q1.csv"');
  });
});
