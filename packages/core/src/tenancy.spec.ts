import {
  InMemoryMediaStore,
  InMemoryUploadSessionStore,
  storageOf,
} from '@dudousxd/nestjs-media-testing';
import { InMemoryDisk, type Storage } from '@nestjs/storage';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MediaLibrary } from './media-library';
import type { MediaRecord } from './media-record';
import type { MediaStore } from './media-store';
import { ResumableUploadManager } from './resumable-upload';
import {
  type MediaTenancyOption,
  type MediaTenantFilter,
  canSeeRow,
  readTenancy,
  rowTenantId,
  tenantMatch,
} from './tenancy';

/**
 * A structural stand-in for `@dudousxd/nestjs-context`'s accessor: `tenancy()` and
 * `tenantFilter()`, with the context's `kinds` rule (a tenant of another kind is tenantless).
 */
function fakeContext(enabled = true) {
  const state: { enabled: boolean; filter: MediaTenantFilter } = {
    enabled,
    filter: { mode: 'system' },
  };
  const accessor = {
    tenancy: () => ({ enabled: state.enabled }),
    tenantFilter: (options?: { kinds?: string[] }): MediaTenantFilter => {
      const f = state.filter;
      if (f.mode === 'tenant' && options?.kinds && !options.kinds.includes(f.tenant.kind)) {
        return { mode: 'tenantless' };
      }
      return f;
    },
  };
  return {
    accessor,
    state,
    as(filter: MediaTenantFilter) {
      state.filter = filter;
    },
    tenant(id: string, kind = 'organization') {
      state.filter = { mode: 'tenant', tenant: { id, kind, source: 'app' } };
    },
  };
}

const SLOT = Symbol.for('@dudousxd/nestjs-diagnostics:accessor');
const slots = globalThis as unknown as Record<symbol, { current?: unknown } | undefined>;

let storage: Storage;
let store: InMemoryMediaStore;
let ids: number;

function makeLibrary(
  contextAccessor: unknown,
  tenancy?: MediaTenancyOption,
  s: MediaStore = store,
) {
  ids = 0;
  return new MediaLibrary({
    storage,
    store: s,
    idGenerator: () => `id-${++ids}`,
    clock: () => new Date(0),
    ...(contextAccessor ? { contextAccessor } : {}),
    ...(tenancy !== undefined ? { tenancy } : {}),
  });
}

const file = (over: Record<string, unknown> = {}) => ({
  ownerType: 'Post',
  ownerId: '1',
  collection: 'gallery',
  fileName: 'a.txt',
  mimeType: 'text/plain',
  contents: Buffer.from('a'),
  ...over,
});

beforeEach(() => {
  storage = storageOf({ local: new InMemoryDisk() }, 'local');
  store = new InMemoryMediaStore();
});

afterEach(() => {
  delete slots[SLOT];
});

describe('readTenancy', () => {
  it('is off with no context, an old accessor, or tenancy off in the context', () => {
    expect(readTenancy('inherit')).toEqual({ enabled: false });
    expect(readTenancy('inherit', { tenantId: () => 'x' })).toEqual({ enabled: false });
    expect(readTenancy('inherit', fakeContext(false).accessor)).toEqual({ enabled: false });
  });

  it('is off, without throwing, when the accessor methods are not functions', () => {
    const enabled = () => ({ enabled: true });
    const filter = () => ({ mode: 'system' }) as const;
    expect(readTenancy('inherit', { tenancy: enabled, tenantFilter: {} })).toEqual({
      enabled: false,
    });
    expect(readTenancy('inherit', { tenancy: enabled, tenantFilter: 'x' })).toEqual({
      enabled: false,
    });
    expect(readTenancy('inherit', { tenancy: true, tenantFilter: filter })).toEqual({
      enabled: false,
    });
  });

  it('`false` keeps media out even when the context turns tenancy on', () => {
    expect(readTenancy(false, fakeContext(true).accessor)).toEqual({ enabled: false });
  });

  it('an explicit `enabled` wins over the context switch', () => {
    expect(readTenancy({ enabled: true }, fakeContext(false).accessor).enabled).toBe(true);
    expect(readTenancy({ enabled: false }, fakeContext(true).accessor).enabled).toBe(false);
  });

  it('reads the global slot when no accessor is passed', () => {
    const ctx = fakeContext();
    slots[SLOT] = { current: ctx.accessor };
    expect(readTenancy().enabled).toBe(true);
  });

  it('applies the matching rule (Agora spec §4)', () => {
    const ctx = fakeContext();
    const t = readTenancy('inherit', ctx.accessor);
    const shared = readTenancy({ nullRows: 'shared' }, ctx.accessor);
    const see = (tenancy: typeof t) =>
      [canSeeRow(tenancy, 't1'), canSeeRow(tenancy, 't2'), canSeeRow(tenancy, null)] as const;

    ctx.tenant('t1');
    expect(see(t)).toEqual([true, false, false]);
    expect(see(shared)).toEqual([true, false, true]);
    expect(tenantMatch(t)).toEqual({ id: 't1' });
    expect(tenantMatch(shared)).toEqual({ id: 't1', orNull: true });
    expect(rowTenantId(t)).toBe('t1');

    ctx.as({ mode: 'tenantless' });
    expect(see(t)).toEqual([false, false, true]);
    expect(tenantMatch(t)).toEqual({ id: null });
    expect(rowTenantId(t)).toBeNull();

    for (const mode of ['all', 'system'] as const) {
      ctx.as({ mode });
      expect(see(t)).toEqual([true, true, true]);
      expect(tenantMatch(t)).toBeUndefined();
      expect(rowTenantId(t)).toBeNull();
    }
  });

  it('passes media `kinds` to the context: a tenant of another kind is tenantless', () => {
    const ctx = fakeContext();
    ctx.tenant('c1', 'clinic');
    expect(canSeeRow(readTenancy({ kinds: ['organization'] }, ctx.accessor), 'c1')).toBe(false);
    expect(canSeeRow(readTenancy({ kinds: ['clinic'] }, ctx.accessor), 'c1')).toBe(true);
  });
});

describe('MediaLibrary tenancy', () => {
  it('off: behaves as before, never stamps, never enables the store', async () => {
    const enable = vi.spyOn(store, 'enableTenancy');
    const ctx = fakeContext(false);
    ctx.tenant('t1');
    const lib = makeLibrary(ctx.accessor);
    const media = await lib.attach(file({ tenantId: 't9' }));
    expect(media).not.toHaveProperty('tenantId');
    expect(await store.find(media.id)).not.toHaveProperty('tenantId');
    expect((await lib.get(media.id))?.id).toBe(media.id);
    expect(await lib.list('Post', '1')).toHaveLength(1);
    expect(await lib.prepareTenancy()).toBe(false);
    expect(enable).not.toHaveBeenCalled();
  });

  it('off without any context (no accessor, no slot)', async () => {
    const lib = makeLibrary(undefined);
    const media = await lib.attach(file());
    expect(media).not.toHaveProperty('tenantId');
    expect(await lib.prepareTenancy()).toBe(false);
  });

  it('stamps the request tenant, null when tenantless, and an explicit tenantId wins', async () => {
    const ctx = fakeContext();
    const lib = makeLibrary(ctx.accessor);
    ctx.tenant('t1');
    expect((await lib.attach(file())).tenantId).toBe('t1');
    expect((await lib.attach(file({ tenantId: 't2' }))).tenantId).toBe('t2');
    expect((await lib.attach(file({ tenantId: null }))).tenantId).toBeNull();
    ctx.as({ mode: 'tenantless' });
    expect((await lib.attach(file())).tenantId).toBeNull();
    ctx.as({ mode: 'system' });
    expect((await lib.attach(file({ tenantId: 't3' }))).tenantId).toBe('t3');
  });

  describe('reads apply the matching rule', () => {
    async function seed(ctx: ReturnType<typeof fakeContext>, lib: MediaLibrary) {
      ctx.as({ mode: 'system' });
      const t1 = await lib.attach(file({ tenantId: 't1', fileName: 't1.txt' }));
      const t2 = await lib.attach(file({ tenantId: 't2', fileName: 't2.txt' }));
      const none = await lib.attach(file({ tenantId: null, fileName: 'none.txt' }));
      return { t1: t1.id, t2: t2.id, none: none.id };
    }

    const cases: Array<{
      name: string;
      filter: MediaTenantFilter;
      tenancy?: MediaTenancyOption;
      visible: Array<'t1' | 't2' | 'none'>;
    }> = [
      {
        name: 'tenant t1',
        filter: { mode: 'tenant', tenant: { id: 't1', kind: 'organization', source: 'app' } },
        visible: ['t1'],
      },
      {
        name: "tenant t1, nullRows: 'shared'",
        filter: { mode: 'tenant', tenant: { id: 't1', kind: 'organization', source: 'app' } },
        tenancy: { nullRows: 'shared' },
        visible: ['t1', 'none'],
      },
      { name: 'tenantless', filter: { mode: 'tenantless' }, visible: ['none'] },
      { name: 'all', filter: { mode: 'all' }, visible: ['t1', 't2', 'none'] },
      { name: 'system', filter: { mode: 'system' }, visible: ['t1', 't2', 'none'] },
    ];

    for (const c of cases) {
      it(c.name, async () => {
        const ctx = fakeContext();
        const lib = makeLibrary(ctx.accessor, c.tenancy);
        const rows = await seed(ctx, lib);
        ctx.as(c.filter);
        const all = ['t1', 't2', 'none'] as const;
        const listed = (await lib.list('Post', '1')).map((r) => r.id);
        expect(listed.sort()).toEqual(c.visible.map((k) => rows[k]).sort());
        for (const key of all) {
          const id = rows[key];
          if (c.visible.includes(key)) {
            expect((await lib.get(id))?.id).toBe(id);
            expect((await lib.locate(id)).record.id).toBe(id);
          } else {
            expect(await lib.get(id)).toBeNull();
            await expect(lib.locate(id)).rejects.toMatchObject({ name: 'MediaNotFoundError' });
            await expect(lib.url(id)).rejects.toMatchObject({ name: 'MediaNotFoundError' });
            await expect(lib.ensureConversion(id, 'thumb')).rejects.toMatchObject({
              name: 'MediaNotFoundError',
            });
            // Delete of a hidden record is a no-op, as for a missing one.
            await lib.delete(id);
            expect(await store.find(id)).not.toBeNull();
          }
        }
      });
    }
  });

  it("reads the context's tenant filter once per list and per replacement scan, not per row", async () => {
    const ctx = fakeContext();
    // Seed 5 gallery files and 5 avatars for t1 through a library with no single-file collection.
    const seeder = makeLibrary(ctx.accessor);
    ctx.tenant('t1');
    for (let i = 0; i < 5; i++) {
      await seeder.attach(file({ fileName: `${i}.txt` }));
      await seeder.attach(file({ collection: 'avatar', fileName: `${i}.txt` }));
    }
    const lib = new MediaLibrary({
      storage,
      store,
      collections: [{ name: 'avatar', single: true }],
      contextAccessor: ctx.accessor,
    });
    const spy = vi.spyOn(ctx.accessor, 'tenantFilter');

    expect(await lib.list('Post', '1', 'gallery')).toHaveLength(5);
    expect(spy).toHaveBeenCalledTimes(1);

    // One read for the replacement scan, one per delete (each is its own operation), one to stamp
    // the new row. Per row, the scan alone would add 4 more.
    spy.mockClear();
    await lib.attach(file({ collection: 'avatar' }));
    expect(spy).toHaveBeenCalledTimes(1 + 5 + 1);
    expect(await lib.list('Post', '1', 'avatar')).toHaveLength(1);
  });

  it('a single-file collection only replaces what the request can see', async () => {
    const ctx = fakeContext();
    ids = 0;
    const lib = new MediaLibrary({
      storage,
      store,
      collections: [{ name: 'avatar', single: true }],
      contextAccessor: ctx.accessor,
    });
    ctx.tenant('t2');
    const other = await lib.attach(file({ collection: 'avatar' }));
    ctx.tenant('t1');
    await lib.attach(file({ collection: 'avatar' }));
    expect(await store.find(other.id)).not.toBeNull();
  });

  it('fails with the fix when the store cannot scope by tenant', async () => {
    const ctx = fakeContext();
    const legacy: MediaStore = {
      save: async (r: MediaRecord) => r,
      find: async () => null,
      listByOwner: async () => [],
      delete: async () => {},
      nextOrder: async () => 0,
    };
    const lib = makeLibrary(ctx.accessor, undefined, legacy);
    await expect(lib.prepareTenancy()).rejects.toMatchObject({
      name: 'MediaTenancyUnavailableError',
      message: expect.stringContaining('enableTenancy()'),
    });
    await expect(lib.attach(file())).rejects.toMatchObject({
      name: 'MediaTenancyUnavailableError',
    });
  });

  it("retries the store's enableTenancy after a failure (a migration ran meanwhile)", async () => {
    const ctx = fakeContext();
    const enable = vi
      .spyOn(store, 'enableTenancy')
      .mockRejectedValueOnce(new Error('no tenant_id column'));
    const lib = makeLibrary(ctx.accessor);
    await expect(lib.prepareTenancy()).rejects.toThrow('no tenant_id column');
    expect(await lib.prepareTenancy()).toBe(true);
    expect(await lib.prepareTenancy()).toBe(true);
    expect(enable).toHaveBeenCalledTimes(2);
  });
});

describe('ResumableUploadManager tenancy', () => {
  function makeManager(contextAccessor: unknown, sessions = new InMemoryUploadSessionStore()) {
    let n = 0;
    return {
      sessions,
      manager: new ResumableUploadManager({
        storage,
        sessions,
        idGenerator: () => `u-${++n}`,
        emitDiagnostics: false,
        ...(contextAccessor ? { contextAccessor } : {}),
      }),
    };
  }

  it('off: sessions carry no tenant and stay visible', async () => {
    const ctx = fakeContext(false);
    ctx.tenant('t1');
    const { manager } = makeManager(ctx.accessor);
    const session = await manager.createUpload({ disk: 'local', key: 'k/a.bin', tenantId: 'x' });
    expect(session).not.toHaveProperty('tenantId');
    ctx.tenant('t2');
    expect(await manager.status(session.id)).toEqual({ offset: 0, size: undefined });
  });

  it('stamps the session, and another tenant gets not-found', async () => {
    const ctx = fakeContext();
    const { manager, sessions } = makeManager(ctx.accessor);
    ctx.tenant('t1');
    const session = await manager.createUpload({ disk: 'local', key: 'k/a.bin', size: 1 });
    expect(session.tenantId).toBe('t1');
    expect(
      (await manager.createUpload({ disk: 'local', key: 'k/b.bin', tenantId: 't9' })).tenantId,
    ).toBe('t9');

    ctx.tenant('t2');
    await expect(manager.status(session.id)).rejects.toMatchObject({
      name: 'UploadSessionNotFoundError',
    });
    await expect(manager.writeChunk(session.id, 0, Buffer.from('a'))).rejects.toMatchObject({
      name: 'UploadSessionNotFoundError',
    });
    await expect(manager.complete(session.id)).rejects.toMatchObject({
      name: 'UploadSessionNotFoundError',
    });
    await manager.abort(session.id); // hidden: a no-op, as for a missing session
    expect(await sessions.get(session.id)).not.toBeNull();

    ctx.tenant('t1');
    await manager.writeChunk(session.id, 0, Buffer.from('a'));
    expect(await manager.complete(session.id)).toMatchObject({ key: 'k/a.bin', size: 1 });
  });
});
