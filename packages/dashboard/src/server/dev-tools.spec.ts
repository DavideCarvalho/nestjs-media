import 'reflect-metadata';
import type { MediaRecord, MediaTenantMatch } from '@dudousxd/nestjs-media-core';
import {
  InMemoryMediaStore,
  InMemoryUploadSessionStore,
  storageOf,
} from '@dudousxd/nestjs-media-testing';
import { type DynamicModule, type ExecutionContext, Global, Logger, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { InMemoryDisk, StorageModule } from '@nestjs/storage';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authorizeByToken } from './console-authorize.js';
import { DEV_TOOLS_SLOT, type MediaDevTool, mediaDevTools } from './dev-tools.js';
import { MediaConsoleService } from './media-console.service.js';
import { MediaDashboardModule } from './media-dashboard.module.js';

const holder = globalThis as Record<symbol, unknown>;

function record(id: string, tenantId: string | null): MediaRecord {
  return {
    id,
    ownerType: 'Post',
    ownerId: '1',
    collection: 'gallery',
    name: id,
    fileName: `${id}.png`,
    mimeType: 'image/png',
    size: 10,
    disk: 'local',
    path: `p/${id}.png`,
    order: 0,
    customProperties: {},
    conversions: { thumb: { disk: 'local', path: `p/${id}-thumb.png` } } as never,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    tenantId,
  };
}

async function setup(
  options: { actions?: boolean; tenant?: MediaTenantMatch; diskPrefixes?: string[] } = {},
) {
  const disk = new InMemoryDisk();
  const tenantKeys = options.diskPrefixes ? ['t/t1/own.txt', 't/t2/other.txt'] : [];
  for (const key of ['a.txt', 'docs/b.txt', 'docs/c.txt', ...tenantKeys]) {
    await disk.put(key, `body of ${key}`);
  }
  const store = new InMemoryMediaStore();
  const uploads = new InMemoryUploadSessionStore();
  for (const [id, tenant] of [
    ['m1', 't1'],
    ['m2', 't2'],
  ] as const) {
    await store.save(record(id, tenant));
    await uploads.create({
      id,
      disk: 'local',
      key: `up/${id}`,
      contentType: undefined,
      size: 4,
      offset: 2,
      parts: 1,
      tenantId: tenant,
    });
  }
  const match = options.tenant;
  const scope = match
    ? {
        match: async () => match,
        canSee: async (tenantId: string | null | undefined) => (tenantId ?? null) === match.id,
        diskPrefixes: async () => options.diskPrefixes,
      }
    : null;
  const service = new MediaConsoleService(
    storageOf({ local: disk }, 'local'),
    store,
    uploads,
    options.actions ?? false,
    null,
    null,
    null,
    scope,
  );
  const tools = mediaDevTools(service, { actions: options.actions ?? false });
  const tool = (name: string): MediaDevTool => {
    const found = tools.find((t) => t.name === name);
    if (!found) throw new Error(`no tool ${name}`);
    return found;
  };
  return { tools, tool, disk, store, uploads };
}

describe('mediaDevTools', () => {
  it('names, kinds and annotations', async () => {
    const { tools } = await setup();
    expect(tools.map((t) => [t.name, t.kind, t.destructive === true])).toEqual([
      ['media_list_disks', 'read', false],
      ['media_list_objects', 'read', false],
      ['media_get_object', 'read', false],
      ['media_list_uploads', 'read', false],
      ['media_get_upload', 'read', false],
      ['media_list_collections', 'read', false],
      ['media_get_media', 'read', false],
      ['media_abort_upload', 'action', false],
      ['media_delete_objects', 'action', true],
    ]);
    for (const t of tools) expect(t.name).toMatch(/^media_[a-z]+_[a-z_]+$/);
  });

  it('the actions are available only when the console’s actions are on', async () => {
    const off = await setup();
    const on = await setup({ actions: true });
    for (const name of ['media_abort_upload', 'media_delete_objects']) {
      expect(await off.tool(name).available?.()).toBe(false);
      expect(await on.tool(name).available?.()).toBe(true);
    }
    expect(off.tool('media_list_disks').available).toBeUndefined();
  });

  it('media_list_disks', async () => {
    const { tool } = await setup();
    const result = (await tool('media_list_disks').run({})) as {
      items: { name: string; default: boolean }[];
      next: null;
    };
    expect(result.items.map((d) => [d.name, d.default])).toEqual([['local', true]]);
    expect(result.next).toBeNull();
  });

  it('media_list_objects: one folder level, paged by cursor', async () => {
    const { tool } = await setup();
    const root = (await tool('media_list_objects').run({ disk: 'local' })) as {
      folders: { prefix: string }[];
      items: { key: string }[];
      next: string | null;
    };
    expect(root.folders.map((f) => f.prefix)).toEqual(['docs/']);
    expect(root.items.map((f) => f.key)).toEqual(['a.txt']);
    expect(root.next).toBeNull();

    const first = (await tool('media_list_objects').run({
      disk: 'local',
      prefix: 'docs/',
      limit: 1,
    })) as { items: { key: string }[]; next: string | null };
    expect(first.items.map((f) => f.key)).toEqual(['docs/b.txt']);
    expect(first.next).toEqual(expect.any(String));
    const second = (await tool('media_list_objects').run({
      disk: 'local',
      prefix: 'docs/',
      limit: 1,
      cursor: first.next,
    })) as { items: { key: string }[] };
    expect(second.items.map((f) => f.key)).toEqual(['docs/c.txt']);
  });

  it('media_get_object returns the metadata and insights, never a URL', async () => {
    const { tool } = await setup();
    const object = (await tool('media_get_object').run({ disk: 'local', key: 'a.txt' })) as Record<
      string,
      unknown
    >;
    expect(object).toMatchObject({ key: 'a.txt', size: 13, insights: [] });
    expect(object).not.toHaveProperty('url');
  });

  it('unknown disks, keys and ids are a "not found" error', async () => {
    const { tool } = await setup({ actions: true });
    await expect(tool('media_list_objects').run({ disk: 'nope' })).rejects.toThrow(
      'disk "nope" not found',
    );
    await expect(tool('media_get_object').run({ disk: 'local', key: 'zz.txt' })).rejects.toThrow(
      'object "zz.txt" on disk "local" not found',
    );
    await expect(tool('media_get_upload').run({ id: 'nope' })).rejects.toThrow(
      'upload nope not found',
    );
    await expect(tool('media_get_media').run({ id: 'nope' })).rejects.toThrow(
      'media nope not found',
    );
    await expect(tool('media_abort_upload').run({ id: 'nope' })).rejects.toThrow(
      'upload nope not found',
    );
    await expect(
      tool('media_delete_objects').run({ disk: 'nope', keys: ['a.txt'] }),
    ).rejects.toThrow('disk "nope" not found');
    // The console's own reason stays in the message.
    await expect(tool('media_get_object').run({ disk: 'nope', key: 'x' })).rejects.toThrow(/nope/);
  });

  it('media_list_uploads and media_get_upload', async () => {
    const { tool } = await setup();
    const list = (await tool('media_list_uploads').run({})) as { items: { id: string }[] };
    expect(list.items.map((u) => u.id)).toEqual(['m1', 'm2']);
    const limited = (await tool('media_list_uploads').run({ limit: 1 })) as {
      items: { id: string }[];
      next: string | null;
    };
    expect(limited.items.map((u) => u.id)).toEqual(['m1']);
    expect(limited.next).toBe('1');
    const second = (await tool('media_list_uploads').run({ limit: 1, cursor: limited.next })) as {
      items: { id: string }[];
      next: string | null;
    };
    expect(second.items.map((u) => u.id)).toEqual(['m2']);
    expect(second.next).toBeNull();
    await expect(tool('media_list_uploads').run({ cursor: 'nope' })).rejects.toThrow(/cursor/);
    const detail = (await tool('media_get_upload').run({ id: 'm1' })) as {
      upload: { id: string; percent: number };
    };
    expect(detail.upload).toMatchObject({ id: 'm1', percent: 50 });
  });

  it('media_list_collections: the summary, or one collection’s records', async () => {
    const { tool } = await setup();
    expect(await tool('media_list_collections').run({})).toEqual({
      items: [{ key: 'gallery', count: 2, sumSize: 20 }],
      next: null,
    });
    const page = (await tool('media_list_collections').run({
      collection: 'gallery',
      limit: 1,
    })) as { items: { id: string }[]; next: string | null };
    expect(page.items).toHaveLength(1);
    expect(page.next).toEqual(expect.any(String));
  });

  it('media_get_media drops the variants’ URLs', async () => {
    const { tool } = await setup();
    const detail = (await tool('media_get_media').run({ id: 'm1' })) as {
      record: { id: string };
      variants: Record<string, unknown>[];
    };
    expect(detail.record.id).toBe('m1');
    expect(detail.variants).toEqual([{ name: 'thumb', disk: 'local', path: 'p/m1-thumb.png' }]);
    expect(JSON.stringify(detail)).not.toContain('url');
  });

  it("follows the request's tenant: another tenant's rows are not found", async () => {
    const { tool, uploads } = await setup({ actions: true, tenant: { id: 't1' } });
    const list = (await tool('media_list_uploads').run({})) as { items: { id: string }[] };
    expect(list.items.map((u) => u.id)).toEqual(['m1']);
    await expect(tool('media_get_media').run({ id: 'm2' })).rejects.toThrow('not found');
    await expect(tool('media_abort_upload').run({ id: 'm2' })).rejects.toThrow('not found');
    expect(await uploads.get('m2')).not.toBeNull();
  });

  it("with pathPrefix, a tenant's disk tools stay inside its t/<tenantId>/", async () => {
    const { tool, disk } = await setup({
      actions: true,
      tenant: { id: 't1' },
      diskPrefixes: ['t/t1/'],
    });
    const listed = (await tool('media_list_objects').run({ disk: 'local', prefix: 't/t1/' })) as {
      items: Array<{ key?: string }>;
    };
    expect(JSON.stringify(listed)).toContain('t/t1/own.txt');
    await expect(
      tool('media_list_objects').run({ disk: 'local', prefix: 't/t2/' }),
    ).rejects.toThrow('not found');
    for (const key of ['t/t2/other.txt', 'a.txt', 't/t1/../t2/other.txt', '/t/t2/other.txt']) {
      await expect(tool('media_get_object').run({ disk: 'local', key })).rejects.toThrow(
        'not found',
      );
      await expect(
        tool('media_delete_objects').run({ disk: 'local', keys: [key] }),
      ).rejects.toThrow('not found');
    }
    expect(await disk.exists('t/t2/other.txt')).toBe(true);
    expect(await disk.exists('a.txt')).toBe(true);
  });

  it('media_abort_upload removes the session', async () => {
    const { tool, uploads } = await setup({ actions: true });
    expect(await tool('media_abort_upload').run({ id: 'm1' })).toEqual({ aborted: 'm1' });
    expect(await uploads.get('m1')).toBeNull();
  });

  it('media_delete_objects deletes up to 100 keys', async () => {
    const { tool, disk } = await setup({ actions: true });
    expect(
      await tool('media_delete_objects').run({ disk: 'local', keys: ['a.txt', 'docs/b.txt'] }),
    ).toEqual({ deleted: ['a.txt', 'docs/b.txt'] });
    expect(await disk.exists('a.txt')).toBe(false);
    expect(await disk.exists('docs/c.txt')).toBe(true);
    await expect(tool('media_delete_objects').run({ disk: 'local', keys: [] })).rejects.toThrow(
      /at least one/,
    );
    const many = Array.from({ length: 101 }, (_, i) => `k${i}`);
    await expect(tool('media_delete_objects').run({ disk: 'local', keys: many })).rejects.toThrow(
      /at most 100/,
    );
  });

  it('media_delete_objects reports partial progress when a key fails mid-list', async () => {
    const { tool, disk } = await setup({ actions: true });
    const original = MediaConsoleService.prototype.deleteObject;
    const spy = vi
      .spyOn(MediaConsoleService.prototype, 'deleteObject')
      .mockImplementation(async function (this: MediaConsoleService, name, key) {
        if (key === 'docs/b.txt') throw new Error('storage said 500');
        return original.call(this, name, key);
      });
    try {
      expect(
        await tool('media_delete_objects').run({
          disk: 'local',
          keys: ['a.txt', 'docs/b.txt', 'docs/c.txt'],
        }),
      ).toEqual({
        deleted: ['a.txt'],
        failed: { key: 'docs/b.txt', error: expect.stringContaining('storage said 500') },
        skipped: ['docs/c.txt'],
      });
      expect(await disk.exists('a.txt')).toBe(false);
      expect(await disk.exists('docs/c.txt')).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });
});

// ── registration ─────────────────────────────────────────────────────────────

interface Slot {
  version: 1;
  libs: {
    lib: string;
    title: string;
    authorize(context: ExecutionContext): Promise<{ allowed: boolean; caller?: string }>;
    tools: MediaDevTool[];
  }[];
}

const slot = () => holder[DEV_TOOLS_SLOT] as Slot | undefined;
const mediaLib = () => slot()?.libs.find((lib) => lib.lib === 'media');

@Global()
@Module({
  imports: [StorageModule.forRoot({ disks: { primary: new InMemoryDisk() } })],
  providers: [
    { provide: Symbol.for('nestjs-media:store'), useValue: null },
    { provide: Symbol.for('nestjs-media:upload-sessions'), useValue: null },
  ],
  exports: [Symbol.for('nestjs-media:store'), Symbol.for('nestjs-media:upload-sessions')],
})
class MockMediaModule {}

let close: (() => Promise<void>) | undefined;

async function boot(dashboard: DynamicModule) {
  @Module({ imports: [MockMediaModule, dashboard] })
  class AppModule {}
  const app = await NestFactory.create(AppModule, { logger: false, abortOnError: false });
  await app.init();
  close = () => app.close();
}

function httpContext(headers: Record<string, string>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ headers }), getResponse: () => ({}) }),
    getType: () => 'http',
    getHandler: () => () => undefined,
    getClass: () => class {},
  } as unknown as ExecutionContext;
}

beforeEach(() => {
  delete holder[DEV_TOOLS_SLOT];
});

async function shutdown() {
  await close?.();
  close = undefined;
}

afterEach(async () => {
  await shutdown();
  vi.restoreAllMocks();
});

describe('the media dev tools in the dev-tools slot', () => {
  it('register while the console is mounted, gated by its own authorize, and leave on close', async () => {
    await boot(MediaDashboardModule.forRoot({ authorize: authorizeByToken({ token: 'tok' }) }));
    const lib = mediaLib();
    expect(lib?.title).toBe('Media');
    expect(lib?.tools.map((t) => t.name)).toContain('media_list_disks');
    expect(await lib?.authorize(httpContext({ authorization: 'Bearer tok' }))).toEqual({
      allowed: true,
      caller: expect.stringMatching(/^token:[0-9a-f]{12}$/),
    });
    expect((await lib?.authorize(httpContext({})))?.allowed).toBe(false);
    // The tools reach the app's disks through the console service.
    const disks = (await lib?.tools[0]?.run({})) as { items: { name: string }[] };
    expect(disks.items.map((d) => d.name)).toEqual(['primary']);
    await shutdown();
    expect(mediaLib()).toBeUndefined();
  });

  it('follow the console’s actions switch', async () => {
    await boot(MediaDashboardModule.forRoot({ actions: true, authorize: () => true }));
    const abort = mediaLib()?.tools.find((t) => t.name === 'media_abort_upload');
    expect(await abort?.available?.()).toBe(true);
  });

  it('are off with routes: false, unless devTools: true; devTools: false turns them off', async () => {
    await boot(MediaDashboardModule.forRoot({ routes: false, authorize: () => true }));
    expect(mediaLib()).toBeUndefined();
    await shutdown();

    await boot(
      MediaDashboardModule.forRoot({ routes: false, devTools: true, authorize: () => true }),
    );
    expect(mediaLib()).toBeDefined();
    await shutdown();

    await boot(MediaDashboardModule.forRoot({ devTools: false, authorize: () => true }));
    expect(mediaLib()).toBeUndefined();
  });

  it('a second registration in the same process warns instead of failing the boot', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    (holder as Record<symbol, unknown>)[DEV_TOOLS_SLOT] = {
      version: 1,
      libs: [],
      register() {
        throw new Error('dev tools: the lib "media" is already registered');
      },
    };
    await boot(MediaDashboardModule.forRoot({ authorize: () => true }));
    expect(warn).toHaveBeenCalledWith(
      'media dev tools not registered: dev tools: the lib "media" is already registered',
    );
  });

  it('leave a slot of another version alone', async () => {
    const future = { version: 2, libs: [] as unknown[], register: vi.fn() };
    holder[DEV_TOOLS_SLOT] = future;
    await boot(MediaDashboardModule.forRoot({ authorize: () => true }));
    expect(future.register).not.toHaveBeenCalled();
  });
});
