import type { MediaRecord, MediaTenantMatch } from '@dudousxd/nestjs-media-core';
import {
  InMemoryMediaStore,
  InMemoryUploadSessionStore,
  storageOf,
} from '@dudousxd/nestjs-media-testing';
import { InMemoryDisk } from '@nestjs/storage';
import { describe, expect, it } from 'vitest';
import { type ConsoleTenancyScope, MediaConsoleService } from './media-console.service.js';

function record(id: string, tenantId: string | null | undefined): MediaRecord {
  return {
    id,
    ownerType: 'Post',
    ownerId: '1',
    collection: 'gallery',
    name: id,
    fileName: `${id}.txt`,
    mimeType: 'text/plain',
    size: 1,
    disk: 'local',
    path: `p/${id}`,
    order: 0,
    customProperties: {},
    conversions: {},
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...(tenantId !== undefined ? { tenantId } : {}),
  };
}

/** What `MediaModule` provides under `MEDIA_TENANCY`, for a request in tenant `t1`. */
function scopeFor(match: MediaTenantMatch | undefined): ConsoleTenancyScope {
  return {
    match: async () => match,
    canSee: async (tenantId) =>
      !match ||
      (tenantId ?? null) === match.id ||
      (match.orNull === true && (tenantId ?? null) === null),
  };
}

async function setup(scope: ConsoleTenancyScope | null) {
  const store = new InMemoryMediaStore();
  const uploads = new InMemoryUploadSessionStore();
  for (const [id, tenant] of [
    ['a', 't1'],
    ['b', 't2'],
    ['c', null],
  ] as const) {
    await store.save(record(id, tenant));
    await uploads.create({
      id,
      disk: 'local',
      key: `k/${id}`,
      contentType: undefined,
      size: 1,
      offset: 0,
      parts: 0,
      tenantId: tenant,
    });
  }
  const service = new MediaConsoleService(
    storageOf({ local: new InMemoryDisk() }, 'local'),
    store,
    uploads,
    true,
    null,
    null,
    null,
    scope,
  );
  return { service, store, uploads };
}

describe('MediaConsoleService tenancy', () => {
  it('without a tenancy scope (tenancy off, or an older MediaModule) shows everything', async () => {
    const { service } = await setup(null);
    expect((await service.listLibrary({})).records.map((r) => r.id)).toEqual(['a', 'b', 'c']);
    expect((await service.listUploads({})).uploads).toHaveLength(3);
    expect((await service.libraryDetail('b')).record.id).toBe('b');
  });

  it("scopes library, collections and uploads to the request's tenant", async () => {
    const { service } = await setup(scopeFor({ id: 't1' }));
    expect((await service.listLibrary({})).records.map((r) => r.id)).toEqual(['a']);
    expect(await service.listCollections()).toEqual({
      collections: [{ key: 'gallery', count: 1, sumSize: 1 }],
    });
    expect((await service.listUploads({})).uploads.map((u) => u.id)).toEqual(['a']);
    expect((await service.libraryDetail('a')).record.id).toBe('a');
    expect((await service.uploadDetail('a')).upload.id).toBe('a');
  });

  it('a row of another tenant is not found (404), never forbidden, and is not deleted', async () => {
    const { service, store, uploads } = await setup(scopeFor({ id: 't1' }));
    for (const id of ['b', 'c']) {
      await expect(service.libraryDetail(id)).rejects.toMatchObject({ status: 404 });
      await expect(service.uploadDetail(id)).rejects.toMatchObject({ status: 404 });
      await expect(service.deleteLibraryRecord(id)).rejects.toMatchObject({ status: 404 });
      await expect(service.abortUpload(id)).rejects.toMatchObject({ status: 404 });
      expect(await store.find(id)).not.toBeNull();
      expect(await uploads.get(id)).not.toBeNull();
    }
  });

  it('with tenancy on, delete and abort of a missing id are a 404 too, like a hidden one', async () => {
    const { service } = await setup(scopeFor({ id: 't1' }));
    await expect(service.deleteLibraryRecord('missing')).rejects.toMatchObject({ status: 404 });
    await expect(service.abortUpload('missing')).rejects.toMatchObject({ status: 404 });
  });

  it('with tenancy off, delete and abort of a missing id stay a no-op', async () => {
    const { service } = await setup(null);
    await expect(service.deleteLibraryRecord('missing')).resolves.toBeUndefined();
    await expect(service.abortUpload('missing')).resolves.toBeUndefined();
  });

  it("a tenantless request sees only rows with no tenant; 'shared' adds them to a tenant", async () => {
    const tenantless = await setup(scopeFor({ id: null }));
    expect((await tenantless.service.listLibrary({})).records.map((r) => r.id)).toEqual(['c']);
    const shared = await setup(scopeFor({ id: 't2', orNull: true }));
    expect((await shared.service.listLibrary({})).records.map((r) => r.id)).toEqual(['b', 'c']);
  });
});

describe('MediaConsoleService tenancy: labels, required, pathPrefix', () => {
  const labelled = (match: MediaTenantMatch | undefined): ConsoleTenancyScope => ({
    ...scopeFor(match),
    labels: async (ids) => Object.fromEntries(ids.map((id) => [id, `Org ${id.toUpperCase()}`])),
  });

  it('shows each row’s tenant with its label, and no tenant as null', async () => {
    const { service } = await setup(labelled(undefined));
    const records = (await service.listLibrary({})).records;
    expect(records.map((r) => r.tenant)).toEqual([
      { id: 't1', label: 'Org T1' },
      { id: 't2', label: 'Org T2' },
      null,
    ]);
    expect((await service.libraryDetail('b')).record.tenant).toEqual({ id: 't2', label: 'Org T2' });
    expect((await service.listUploads({})).uploads.map((u) => u.tenant?.label ?? null)).toEqual([
      'Org T1',
      'Org T2',
      null,
    ]);
    expect((await service.uploadDetail('a')).upload.tenant).toEqual({ id: 't1', label: 'Org T1' });
  });

  it('falls back to the id when the labeler fails or an older MediaModule has none', async () => {
    const failing = await setup({
      ...scopeFor(undefined),
      labels: async () => {
        throw new Error('down');
      },
    });
    expect((await failing.service.listLibrary({})).records[0]?.tenant).toEqual({
      id: 't1',
      label: 't1',
    });
    const older = await setup(scopeFor(undefined));
    expect((await older.service.listLibrary({})).records[0]?.tenant).toEqual({
      id: 't1',
      label: 't1',
    });
  });

  it('carries no tenant field without tenancy', async () => {
    const { service } = await setup(null);
    expect((await service.listLibrary({})).records[0]).not.toHaveProperty('tenant');
  });

  it('search: no tenant where one is required finds nothing, and does not throw', async () => {
    const { service } = await setup({
      match: async () => {
        throw Object.assign(new Error('tenant required'), {
          status: 403,
          code: 'E_TENANT_REQUIRED',
        });
      },
      canSee: async () => false,
    });
    await expect(service.search('a', 5, '/media')).resolves.toEqual([]);
  });

  it('search: any other tenancy failure (a store that cannot scope) fails the search', async () => {
    const { service } = await setup({
      match: async () => {
        throw Object.assign(new Error('no tenant_id column'), {
          code: 'MEDIA_TENANCY_UNAVAILABLE',
        });
      },
      canSee: async () => false,
    });
    await expect(service.search('a', 5, '/media')).rejects.toThrow('no tenant_id column');
  });

  it('search: with pathPrefix, a tenant searches the disks under its own t/<tenantId>/', async () => {
    const store = new InMemoryMediaStore();
    const disk = new InMemoryDisk();
    await disk.put('t/t1/Post/1/gallery/x/report.pdf', Buffer.from('x'));
    await disk.put('t/t2/Post/1/gallery/y/report.pdf', Buffer.from('x'));
    await disk.put('Post/1/gallery/z/report.pdf', Buffer.from('x'));
    const service = new MediaConsoleService(
      storageOf({ local: disk }, 'local'),
      store,
      null,
      false,
      null,
      null,
      null,
      { ...scopeFor({ id: 't1' }), diskPrefixes: async () => ['t/t1/'] },
    );
    const keys = async (q: string) =>
      (await service.search(q, 5, '/media')).map((hit) => hit.subtitle);
    expect(await keys('Post/')).toEqual(['local · t/t1/Post/1/gallery/x/report.pdf']);
    expect(await keys('t/t1/Post')).toEqual(['local · t/t1/Post/1/gallery/x/report.pdf']);
    // Without pathPrefix, a tenant gets no disk hits (objects carry no tenant).
    const plain = new MediaConsoleService(
      storageOf({ local: disk }, 'local'),
      store,
      null,
      false,
      null,
      null,
      null,
      scopeFor({ id: 't1' }),
    );
    expect(await plain.search('Post/', 5, '/media')).toEqual([]);
  });

  it('search: a library hit names the tenant for a viewer who sees several', async () => {
    const { service } = await setup(labelled(undefined));
    expect((await service.search('b', 5, '/media'))[0]?.subtitle).toBe(
      'Library · gallery · b.txt · Org T2',
    );
  });
});

describe('MediaConsoleService tenancy: disk browsing under pathPrefix', () => {
  const OWN = 't/t1/Post/1/a.txt';
  const OTHER = 't/t2/Post/1/b.txt';
  const LEGACY = 'Post/1/c.txt';

  async function browse(prefixes: string[] | undefined, match: MediaTenantMatch | undefined) {
    const disk = new InMemoryDisk();
    for (const key of [OWN, OTHER, LEGACY]) await disk.put(key, Buffer.from('x'));
    const service = new MediaConsoleService(
      storageOf({ local: disk }, 'local'),
      new InMemoryMediaStore(),
      null,
      true,
      null,
      null,
      null,
      { ...scopeFor(match), diskPrefixes: async () => prefixes },
    );
    return { service, disk };
  }
  const names = (listing: {
    folders: Array<{ prefix: string }>;
    files: Array<{ key: string }>;
  }) => [...listing.folders.map((f) => f.prefix), ...listing.files.map((f) => f.key)];
  const serve = { req: {}, res: {} } as never;

  it('a tenant browses only its own t/<tenantId>/, the levels above show just the way there', async () => {
    const { service } = await browse(['t/t1/'], { id: 't1' });
    expect(names(await service.listObjects('local', {}))).toEqual(['t/']);
    expect(names(await service.listObjects('local', { prefix: 't/' }))).toEqual(['t/t1/']);
    expect(names(await service.listObjects('local', { prefix: 't/t1/Post/1' }))).toEqual([OWN]);
    expect((await service.objectDetail('local', OWN)).key).toBe(OWN);
    for (const prefix of ['t/t2/', 'Post/', 't/t2/Post/1/']) {
      await expect(service.listObjects('local', { prefix })).rejects.toMatchObject({ status: 404 });
    }
  });

  it("another tenant's or a pre-prefix object is not found, for every disk operation", async () => {
    const { service, disk } = await browse(['t/t1/'], { id: 't1' });
    for (const key of [OTHER, LEGACY]) {
      await expect(service.objectDetail('local', key)).rejects.toMatchObject({ status: 404 });
      await expect(service.serveObject('local', key, serve)).rejects.toMatchObject({ status: 404 });
      await expect(service.deleteObject('local', key)).rejects.toMatchObject({ status: 404 });
      await expect(
        service.moveObject('local', key, 'local', 't/t1/stolen.txt'),
      ).rejects.toMatchObject({ status: 404 });
      await expect(service.copyObject('local', OWN, 'local', key)).rejects.toMatchObject({
        status: 404,
      });
    }
    await expect(service.deleteFolder('local', 't/t2')).rejects.toMatchObject({ status: 404 });
    await expect(service.copyFolder('local', 't/t2', 'local', 't/t1/x')).rejects.toMatchObject({
      status: 404,
    });
    await expect(service.moveFolder('local', 't/t1/Post', 'local', 'Post/2')).rejects.toMatchObject(
      {
        status: 404,
      },
    );
    await expect(service.createFolder('local', 't/t2/new')).rejects.toMatchObject({ status: 404 });
    expect(await disk.exists(OTHER)).toBe(true);
    expect(await disk.exists(LEGACY)).toBe(true);
    // Its own objects stay fully usable.
    await service.moveObject('local', OWN, 'local', 't/t1/renamed.txt');
    expect(await disk.exists('t/t1/renamed.txt')).toBe(true);
  });

  it('path traversal, encoded slashes and absolute keys never leave the tenant prefix', async () => {
    const { service, disk } = await browse(['t/t1/'], { id: 't1' });
    const escapes = [
      't/t1/../t2/Post/1/b.txt',
      't/t1/./../t2/Post/1/b.txt',
      decodeURIComponent('t%2Ft1%2F..%2Ft2%2FPost%2F1%2Fb.txt'),
      decodeURIComponent('t/t1/%2e%2e/t2/Post/1/b.txt'),
      '/t/t2/Post/1/b.txt',
      '/Post/1/c.txt',
      't/t1\\..\\t2/Post/1/b.txt',
      't/t1//../t2/Post/1/b.txt',
    ];
    for (const key of escapes) {
      await expect(service.objectDetail('local', key)).rejects.toMatchObject({ status: 404 });
      await expect(service.serveObject('local', key, serve)).rejects.toMatchObject({ status: 404 });
      await expect(service.deleteObject('local', key)).rejects.toMatchObject({ status: 404 });
      await expect(service.moveObject('local', OWN, 'local', key)).rejects.toMatchObject({
        status: 404,
      });
    }
    for (const prefix of ['t/t1/../t2', '/t/t2', decodeURIComponent('t/t1/%2e%2e/t2')]) {
      await expect(service.listObjects('local', { prefix })).rejects.toMatchObject({
        status: expect.any(Number),
      });
      await expect(service.deleteFolder('local', prefix)).rejects.toMatchObject({
        status: expect.any(Number),
      });
    }
    // An absolute folder path reads like its relative twin: still another tenant's, so 404.
    await expect(service.listObjects('local', { prefix: '/t/t2/' })).rejects.toMatchObject({
      status: 404,
    });
    expect(await disk.exists(OTHER)).toBe(true);
    // Search: a traversing query finds nothing outside the prefix.
    for (const q of ['../t2/', 't/t1/../t2/', '/../t2', '..']) {
      const hits = await service.search(q, 5, '/media');
      expect(hits.every((hit) => hit.subtitle?.startsWith('local · t/t1/'))).toBe(true);
    }
  });

  it('a request with no tenant browses no disk object', async () => {
    const { service } = await browse([], { id: null });
    expect(await service.listObjects('local', {})).toEqual({ folders: [], files: [] });
    await expect(service.listObjects('local', { prefix: 't/' })).rejects.toMatchObject({
      status: 404,
    });
    await expect(service.objectDetail('local', LEGACY)).rejects.toMatchObject({ status: 404 });
    expect(await service.search('Post/', 5, '/media')).toEqual([]);
  });

  it('a viewer of every tenant (all, system, tenancy off) sees every key, pre-prefix included', async () => {
    const { service } = await browse(undefined, undefined);
    expect(names(await service.listObjects('local', {}))).toEqual(['Post/', 't/']);
    expect(names(await service.listObjects('local', { prefix: 't/' }))).toEqual(['t/t1/', 't/t2/']);
    expect((await service.objectDetail('local', LEGACY)).key).toBe(LEGACY);
    expect((await service.search('Post/', 5, '/media')).map((h) => h.subtitle)).toEqual([
      `local · ${LEGACY}`,
    ]);
  });

  it('without pathPrefix, a tenant browses the disks as before', async () => {
    const { service } = await browse(undefined, { id: 't1' });
    expect(names(await service.listObjects('local', {}))).toEqual(['Post/', 't/']);
    expect((await service.objectDetail('local', OTHER)).key).toBe(OTHER);
    // Search stays library-only for a tenant: disk objects carry no tenant.
    expect(await service.search('Post/', 5, '/media')).toEqual([]);
  });
});
