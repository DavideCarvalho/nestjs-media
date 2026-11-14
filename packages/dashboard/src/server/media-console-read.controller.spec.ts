import { InMemoryMediaStore, InMemoryUploadSessionStore } from '@dudousxd/nestjs-media-testing';
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

describe('disk routes of a tenant under pathPrefix (mounted)', () => {
  const tenantDisk = new InMemoryDisk();
  const TENANCY = Symbol.for('nestjs-media:tenancy');

  @Global()
  @Module({
    providers: [
      { provide: STORE, useValue: null },
      { provide: UPLOADS, useValue: null },
      {
        provide: TENANCY,
        useValue: {
          match: async () => ({ id: 't1' }),
          canSee: async (tenantId: string | null | undefined) => tenantId === 't1',
          diskPrefixes: async () => ['t/t1/'],
        },
      },
    ],
    exports: [STORE, UPLOADS, TENANCY],
  })
  class TenantMediaModule {}

  @Module({
    imports: [
      StorageModule.forRoot({ disks: { primary: tenantDisk } }),
      TenantMediaModule,
      MediaDashboardModule.forRoot({
        basePath: '/media',
        apiBasePath: '/api/media',
        actions: false,
      }),
    ],
  })
  class TenantAppModule {}

  let base: string;
  let app: Awaited<ReturnType<typeof NestFactory.create>>;

  beforeAll(async () => {
    await tenantDisk.put('t/t1/own.txt', CONTENT);
    await tenantDisk.put('t/t2/other.txt', CONTENT);
    app = await NestFactory.create(TenantAppModule, { logger: false });
    await app.listen(0);
    base = `${await app.getUrl()}/api/media/disks/primary`;
  });

  afterAll(async () => {
    await app.close();
  });

  it('serves its own objects', async () => {
    expect((await fetch(`${base}/object/raw?key=t%2Ft1%2Fown.txt`)).status).toBe(200);
  });

  it('never reaches another prefix: traversal, encoded slashes, absolute keys', async () => {
    for (const key of [
      't%2Ft2%2Fother.txt',
      't%2Ft1%2F..%2Ft2%2Fother.txt',
      't/t1/../t2/other.txt',
      't%2Ft1%2F%2e%2e%2Ft2%2Fother.txt',
      't%252Ft1%252F..%252Ft2%252Fother.txt',
      '%2Ft%2Ft2%2Fother.txt',
      't%2Ft1%5C..%5Ct2%2Fother.txt',
    ]) {
      for (const route of ['object/raw', 'object/download', 'object']) {
        const response = await fetch(`${base}/${route}?key=${key}`);
        expect([route, key, response.status]).toEqual([route, key, 404]);
      }
    }
    const listing = await fetch(`${base}/objects?prefix=t%2Ft1%2F..%2Ft2%2F`);
    expect(listing.status).toBeGreaterThanOrEqual(400);
    expect(await listing.text()).not.toContain('other.txt');
  });
});

describe('list endpoints — the Aviary list wire (mounted)', () => {
  const listDisk = new InMemoryDisk();
  const store = new InMemoryMediaStore();
  const uploads = new InMemoryUploadSessionStore();

  @Global()
  @Module({
    providers: [
      { provide: STORE, useValue: store },
      { provide: UPLOADS, useValue: uploads },
    ],
    exports: [STORE, UPLOADS],
  })
  class ListMediaModule {}

  @Module({
    imports: [
      StorageModule.forRoot({ disks: { primary: listDisk } }),
      ListMediaModule,
      MediaDashboardModule.forRoot({
        basePath: '/media',
        apiBasePath: '/api/media',
        actions: false,
      }),
    ],
  })
  class ListAppModule {}

  let api: string;
  let app: Awaited<ReturnType<typeof NestFactory.create>>;

  beforeAll(async () => {
    for (const key of ['docs/a.txt', 'b.txt', 'c.txt', 'd.txt']) await listDisk.put(key, CONTENT);
    for (const [i, collection] of ['gallery', 'gallery', 'avatars'].entries()) {
      await store.save({
        id: `r${i}`,
        ownerType: 'Post',
        ownerId: '1',
        collection,
        name: `r${i}`,
        fileName: `r${i}.png`,
        mimeType: 'image/png',
        size: 1,
        disk: 'primary',
        path: `p/r${i}`,
        order: 0,
        customProperties: {},
        conversions: {},
        createdAt: new Date(i * 1000),
        updatedAt: new Date(i * 1000),
      });
    }
    for (const [id, key] of [
      ['u1', 'in/a.bin'],
      ['u2', 'out/b.bin'],
    ] as const) {
      await uploads.create({
        id,
        disk: 'primary',
        key,
        contentType: undefined,
        size: 4,
        offset: 1,
        parts: 0,
      });
    }
    app = await NestFactory.create(ListAppModule, { logger: false });
    await app.listen(0);
    api = `${await app.getUrl()}/api/media`;
  });

  afterAll(async () => {
    await app.close();
  });

  const json = async (path: string): Promise<{ status: number; body: any }> => {
    const response = await fetch(`${api}${path}`);
    return { status: response.status, body: await response.json() };
  };

  it('disks/:disk/objects: files under data, folders beside it, paged by after/first', async () => {
    const first = await json('/disks/primary/objects?first=2');
    expect(first.status).toBe(200);
    // Byte order: b.txt, c.txt, d.txt, then the docs/ folder.
    expect(first.body.folders).toEqual([]);
    expect(first.body.data.map((f: { key: string }) => f.key)).toEqual(['b.txt', 'c.txt']);
    expect(first.body.meta).toMatchObject({ hasNext: true, prevCursor: null, hasPrev: false });
    const next = await json(
      `/disks/primary/objects?first=2&after=${encodeURIComponent(first.body.meta.nextCursor)}`,
    );
    expect(next.body.data.map((f: { key: string }) => f.key)).toEqual(['d.txt']);
    expect(next.body.folders).toEqual([{ name: 'docs', prefix: 'docs/' }]);
    expect(next.body.meta).toEqual({
      nextCursor: null,
      prevCursor: null,
      hasNext: false,
      hasPrev: false,
    });
    const docs = await json('/disks/primary/objects?prefix=docs');
    expect(docs.body.data.map((f: { key: string }) => f.key)).toEqual(['docs/a.txt']);
  });

  it('disks/:disk/objects: 400 for a forged cursor, a bad size, or paging backward', async () => {
    for (const query of ['after=forged', 'first=0', 'first=abc', 'before=x', 'after=a&before=b']) {
      expect([query, (await fetch(`${api}/disks/primary/objects?${query}`)).status]).toEqual([
        query,
        400,
      ]);
    }
  });

  it('library: filter[collection] / filter[disk], cursor envelope, unknown filter is a 400', async () => {
    const all = await json('/library?first=2');
    expect(all.body.data.map((r: { id: string }) => r.id)).toEqual(['r0', 'r1']);
    expect(all.body.meta.hasNext).toBe(true);
    const rest = await json(
      `/library?first=2&after=${encodeURIComponent(all.body.meta.nextCursor)}`,
    );
    expect(rest.body.data.map((r: { id: string }) => r.id)).toEqual(['r2']);
    expect(rest.body.meta.nextCursor).toBeNull();
    const gallery = await json('/library?filter[collection]=gallery&filter[disk]=primary');
    expect(gallery.body.data.map((r: { id: string }) => r.id)).toEqual(['r0', 'r1']);
    expect((await fetch(`${api}/library?filter[owner]=x`)).status).toBe(400);
    expect((await fetch(`${api}/library?filter[collection][gt]=a`)).status).toBe(400);
    expect((await fetch(`${api}/library?before=x`)).status).toBe(400);
  });

  it('library: a forged cursor is a 400, not a silent restart from the first page', async () => {
    for (const after of ['forged', 'Zm9v', 'bm90fGEgY3Vyc29y']) {
      const res = await json(`/library?after=${encodeURIComponent(after)}`);
      expect([after, res.status, res.body.message]).toEqual([
        after,
        400,
        'Malformed cursor in "after".',
      ]);
    }
  });

  it.each([
    ['/library?cursor=x', /"after"/],
    ['/library?limit=10', /"first"/],
    ['/library?collection=gallery', /filter\[collection\]/],
    ['/library?page=2', /"page"/],
    ['/disks/primary/objects?limit=10', /"first"/],
    ['/disks/primary/objects?cursor=x', /"after"/],
    ['/uploads?disk=primary', /filter\[disk\]/],
    ['/uploads?prefix=in/', /filter\[key\]\[startsWith\]/],
    ['/uploads?first=10', /"first"/],
  ])('%s answers 400 naming the replacement, instead of being ignored', async (path, message) => {
    const res = await json(path);
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(message);
  });

  it('uploads and library/collections answer { data }', async () => {
    const all = await json('/uploads');
    expect(all.body.data.map((u: { id: string }) => u.id).sort()).toEqual(['u1', 'u2']);
    const filtered = await json('/uploads?filter[disk]=primary&filter[key][startsWith]=in/');
    expect(filtered.body.data.map((u: { id: string }) => u.id)).toEqual(['u1']);
    expect((await fetch(`${api}/uploads?filter[prefix]=in/`)).status).toBe(400);
    const collections = await json('/library/collections');
    expect(collections.body).toEqual({
      data: expect.arrayContaining([expect.objectContaining({ key: 'gallery', count: 2 })]),
    });
    expect((await json('/disks')).body.data.map((d: { name: string }) => d.name)).toEqual([
      'primary',
    ]);
  });
});
