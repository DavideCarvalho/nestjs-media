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

  it("a tenantless request sees only rows with no tenant; 'shared' adds them to a tenant", async () => {
    const tenantless = await setup(scopeFor({ id: null }));
    expect((await tenantless.service.listLibrary({})).records.map((r) => r.id)).toEqual(['c']);
    const shared = await setup(scopeFor({ id: 't2', orNull: true }));
    expect((await shared.service.listLibrary({})).records.map((r) => r.id)).toEqual(['b', 'c']);
  });
});
