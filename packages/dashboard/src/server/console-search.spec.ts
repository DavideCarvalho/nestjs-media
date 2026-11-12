import 'reflect-metadata';
import type { MediaRecord, MediaTenantMatch } from '@dudousxd/nestjs-media-core';
import { InMemoryMediaStore } from '@dudousxd/nestjs-media-testing';
import { type DynamicModule, type ExecutionContext, Global, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { InMemoryDisk, type Storage, StorageModule } from '@nestjs/storage';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type ConsoleDecision, authorizeByToken } from './console-authorize.js';
import {
  AVIARY_CONSOLES_SLOT,
  type AviaryConsoleEntry,
  type AviaryConsoleRegistry,
  listVisibleConsoles,
  registerAviaryConsole,
  sanitizeSearchHits,
  searchConsoles,
  withAviaryProbe,
} from './console-switcher.js';
import { type ConsoleTenancyScope, MediaConsoleService } from './media-console.service.js';
import { MediaDashboardModule } from './media-dashboard.module.js';

const TOKEN = 'console-token-123';
const holder = globalThis as Record<symbol, unknown>;

const allow = async (): Promise<ConsoleDecision> => ({ allowed: true });
const deny = async (): Promise<ConsoleDecision> => ({ allowed: false, reason: 'forbidden' });

function entry(overrides: Partial<AviaryConsoleEntry> & { id: string }): AviaryConsoleEntry {
  return {
    title: overrides.id,
    icon: 'generic',
    path: `/${overrides.id}`,
    order: 50,
    authorize: allow,
    ...overrides,
  };
}

const registry = (...entries: AviaryConsoleEntry[]): AviaryConsoleRegistry => ({
  version: 1,
  entries,
});

/** A context over a plain request object, so a test can read what the switcher set on it. */
function contextOver(req: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => ({}) }),
    getType: () => 'http',
  } as unknown as ExecutionContext;
}

const hit = (id: string) => ({ title: `hit ${id}`, href: `/${id}` });

beforeEach(() => {
  delete holder[AVIARY_CONSOLES_SLOT];
});

afterEach(() => {
  vi.useRealTimers();
});

describe('searchConsoles', () => {
  it('searches this console without its authorize, and the others the viewer may open', async () => {
    const selfAuthorize = vi.fn(deny);
    const result = await searchConsoles(
      registry(
        entry({ id: 'agent', order: 30, authorize: selfAuthorize, search: async () => [hit('a')] }),
        entry({ id: 'durable', order: 10, icon: 'workflow', search: async () => [hit('d')] }),
        entry({ id: 'media', authorize: deny, search: async () => [hit('m')] }),
        entry({ id: 'telescope' }), // no search
      ),
      'agent',
      contextOver({}),
      '  run-1  ',
    );
    expect(selfAuthorize).not.toHaveBeenCalled();
    expect(result).toEqual({
      version: 1,
      q: 'run-1',
      partial: false,
      results: [
        { id: 'durable', title: 'durable', icon: 'workflow', hits: [hit('d')] },
        { id: 'agent', title: 'agent', icon: 'generic', hits: [hit('a')] },
      ],
    });
  });

  it('passes the query and the limit, keeps 5 hits, and drops unsafe ones', async () => {
    const search = vi.fn(async () => [
      { title: 'evil', href: '//evil.test' },
      { title: 'url', href: 'https://x.test' },
      ...Array.from({ length: 9 }, (_, i) => hit(`ok${i}`)),
    ]);
    const result = await searchConsoles(
      registry(entry({ id: 'durable', search })),
      'agent',
      contextOver({}),
      'x',
    );
    expect(search).toHaveBeenCalledWith(expect.anything(), 'x', 5);
    expect(result.results[0]?.hits.map((h) => h.href)).toEqual([
      '/ok0',
      '/ok1',
      '/ok2',
      '/ok3',
      '/ok4',
    ]);
  });

  it('gives each console 300 ms (authorize, then search) and marks a late or failing one partial', async () => {
    vi.useFakeTimers();
    const pending = searchConsoles(
      registry(
        entry({ id: 'fast', search: async () => [hit('f')] }),
        entry({
          id: 'slowgate',
          authorize: () => new Promise(() => {}),
          search: async () => [hit('x')],
        }),
        entry({ id: 'slowsearch', search: () => new Promise(() => {}) }),
        entry({ id: 'broken', search: async () => Promise.reject(new Error('down')) }),
      ),
      'agent',
      contextOver({}),
      'q',
    );
    await vi.advanceTimersByTimeAsync(301);
    await vi.advanceTimersByTimeAsync(301);
    const result = await pending;
    expect(result.partial).toBe(true);
    expect(result.results.map((group) => group.id)).toEqual(['fast']);
  });

  it('a denial is not partial', async () => {
    const result = await searchConsoles(
      registry(entry({ id: 'media', authorize: deny, search: async () => [hit('m')] })),
      'agent',
      contextOver({}),
      'q',
    );
    expect(result).toMatchObject({ results: [], partial: false });
  });

  it('runs nothing for an empty query', async () => {
    const search = vi.fn(async () => [hit('x')]);
    const result = await searchConsoles(
      registry(entry({ id: 'durable', search })),
      'agent',
      contextOver({}),
      '   ',
    );
    expect(search).not.toHaveBeenCalled();
    expect(result).toEqual({ version: 1, q: '', results: [], partial: false });
  });
});

describe('the probe marker', () => {
  it('is never set while a search runs, this console’s or another’s', async () => {
    const req: Record<string, unknown> = {};
    const seen: unknown[] = [];
    const search = async () => {
      seen.push(req.aviaryProbe);
      return [hit('x')];
    };
    await searchConsoles(
      registry(entry({ id: 'agent', search }), entry({ id: 'durable', search })),
      'agent',
      contextOver(req),
      'q',
    );
    expect(seen).toEqual([undefined, undefined]);
  });

  it('is set on the request while another console’s authorize runs, and removed after', async () => {
    const req: Record<string, unknown> = {};
    const seen: unknown[] = [];
    const authorize = async (ctx: ExecutionContext): Promise<ConsoleDecision> => {
      seen.push(ctx.switchToHttp().getRequest<{ aviaryProbe?: boolean }>().aviaryProbe);
      return { allowed: true };
    };
    await listVisibleConsoles(
      registry(entry({ id: 'durable', authorize })),
      'agent',
      contextOver(req),
    );
    await searchConsoles(
      registry(entry({ id: 'durable', authorize, search: async () => [] })),
      'agent',
      contextOver(req),
      'q',
    );
    expect(seen).toEqual([true, true]);
    expect('aviaryProbe' in req).toBe(false);
  });

  it('leaves a marker someone else set', async () => {
    const req: Record<string, unknown> = { aviaryProbe: true };
    await withAviaryProbe(contextOver(req), async () => undefined);
    expect(req.aviaryProbe).toBe(true);
  });
});

describe('sanitizeSearchHits', () => {
  it('keeps titled same-origin hits and their subtitles', () => {
    expect(
      sanitizeSearchHits(
        [
          { title: 'a', subtitle: 's', href: '/a' },
          { title: '', href: '/b' },
          { title: 'c', href: 'javascript:alert(1)' },
          'junk',
        ],
        5,
      ),
    ).toEqual([{ title: 'a', subtitle: 's', href: '/a' }]);
  });
});

// ── the media console's own search ─────────────────────────────────────────────

function record(id: string, name: string, fileName: string, tenantId: string | null): MediaRecord {
  return {
    id,
    ownerType: 'Post',
    ownerId: '1',
    collection: 'gallery',
    name,
    fileName,
    mimeType: 'image/png',
    size: 1,
    disk: 'primary',
    path: `p/${id}`,
    order: 0,
    customProperties: {},
    conversions: {},
    createdAt: new Date(Number(id.replace(/\D/g, '')) || 0),
    updatedAt: new Date(0),
    tenantId,
  };
}

/** What `MediaModule` provides under `MEDIA_TENANCY` for a request in `match`. */
function scopeFor(match: MediaTenantMatch | undefined): ConsoleTenancyScope {
  return {
    match: async () => match,
    canSee: async (tenantId) =>
      !match ||
      (tenantId ?? null) === match.id ||
      (match.orNull === true && (tenantId ?? null) === null),
  };
}

async function fixtures() {
  const store = new InMemoryMediaStore();
  await store.save(record('r1', 'Invoice March', 'invoice-03.pdf', 't1'));
  await store.save(record('r2', 'Cat', 'INVOICE-cat.png', 't2'));
  await store.save(record('r3', 'dog', 'dog.png', null));
  const disk = new InMemoryDisk();
  await disk.put('invoices/2026/march.pdf', Buffer.from('x'));
  await disk.put('invoices/.keep', Buffer.from(''));
  await disk.put('other/invoices.txt', Buffer.from('x'));
  return { store, disk };
}

function serviceOver(
  store: InMemoryMediaStore,
  disk: InMemoryDisk,
  scope: ConsoleTenancyScope | null,
): MediaConsoleService {
  const storage = { names: () => ['primary'], disk: () => disk, defaultDisk: 'primary' };
  return new MediaConsoleService(
    storage as unknown as Storage,
    store,
    null,
    false,
    null,
    null,
    null,
    scope,
  );
}

describe('MediaConsoleService.search', () => {
  it('finds library records by name or file name, an exact id, and disk objects by key prefix', async () => {
    const { store, disk } = await fixtures();
    const service = serviceOver(store, disk, null);
    expect(await service.search('invoice', 5, '/media')).toEqual([
      {
        title: 'Invoice March',
        subtitle: 'Library · gallery · invoice-03.pdf',
        href: '/media#/library/r1',
      },
      { title: 'Cat', subtitle: 'Library · gallery · INVOICE-cat.png', href: '/media#/library/r2' },
      {
        title: 'march.pdf',
        subtitle: 'primary · invoices/2026/march.pdf',
        href: '/media#/disks/primary?prefix=invoices%2F2026%2F&preview=invoices%2F2026%2Fmarch.pdf',
      },
    ]);
    expect((await service.search('r3', 5, '/media'))[0]).toEqual({
      title: 'dog',
      subtitle: 'Library · gallery · dog.png',
      href: '/media#/library/r3',
    });
    expect(await service.search('invoice', 1, '/media')).toHaveLength(1);
  });

  it("keeps to the request's tenant, and leaves the (unscoped) disks out under a tenant", async () => {
    const { store, disk } = await fixtures();
    const service = serviceOver(store, disk, scopeFor({ id: 't1' }));
    expect((await service.search('invoice', 5, '/media')).map((hit) => hit.href)).toEqual([
      '/media#/library/r1',
    ]);
    // Another tenant's record, even by its exact id, is not found.
    expect(await service.search('r2', 5, '/media')).toEqual([]);
    // A request that sees every tenant (system, all) searches the disks too.
    const all = serviceOver(store, disk, scopeFor(undefined));
    expect(await all.search('invoices/', 5, '/media')).toHaveLength(1);
  });

  it('skips a failing source instead of failing the search', async () => {
    const { store, disk } = await fixtures();
    store.list = async () => {
      throw new Error('db down');
    };
    const service = serviceOver(store, disk, null);
    expect((await service.search('invoices', 5, '/media')).map((hit) => hit.title)).toEqual([
      'march.pdf',
    ]);
  });
});

// ── HTTP: GET <api>/consoles/search ───────────────────────────────────────────

let close: (() => Promise<void>) | undefined;

async function boot(dashboard: DynamicModule, store: InMemoryMediaStore): Promise<string> {
  const disk = new InMemoryDisk();
  await disk.put('reports/q3.pdf', Buffer.from('x'));
  @Global()
  @Module({
    imports: [StorageModule.forRoot({ disks: { primary: disk } })],
    providers: [
      { provide: Symbol.for('nestjs-media:store'), useValue: store },
      { provide: Symbol.for('nestjs-media:upload-sessions'), useValue: null },
    ],
    exports: [Symbol.for('nestjs-media:store'), Symbol.for('nestjs-media:upload-sessions')],
  })
  class MockMediaModule {}
  @Module({ imports: [MockMediaModule, dashboard] })
  class AppModule {}
  const app = await NestFactory.create(AppModule, { logger: false, abortOnError: false });
  await app.listen(0);
  close = () => app.close();
  return app.getUrl();
}

afterEach(async () => {
  await close?.();
  close = undefined;
});

const bearer = { authorization: `Bearer ${TOKEN}` };

describe('GET <api>/consoles/search', () => {
  it('is behind the console’s own authorize', async () => {
    const url = await boot(
      MediaDashboardModule.forRoot({ authorize: authorizeByToken({ token: TOKEN }) }),
      new InMemoryMediaStore(),
    );
    const res = await fetch(`${url}/media/api/consoles/search?q=q3`, {
      headers: { accept: 'application/json' },
    });
    expect(res.status).toBe(401);
  });

  it('finds files by name, linking into the console, next to the other consoles', async () => {
    registerAviaryConsole(
      entry({
        id: 'durable',
        order: 10,
        icon: 'workflow',
        title: 'Workflows',
        search: async (_ctx, q) => [{ title: `Run ${q}`, href: `/durable#/runs/${q}` }],
      }),
    );
    const store = new InMemoryMediaStore();
    await store.save(record('m1', 'Q3 report', 'q3-report.pdf', null));
    const url = await boot(
      MediaDashboardModule.forRoot({
        basePath: '/admin/media',
        authorize: authorizeByToken({ token: TOKEN }),
      }),
      store,
    );
    const res = await fetch(`${url}/admin/media/api/consoles/search?q=q3`, { headers: bearer });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(await res.json()).toEqual({
      version: 1,
      q: 'q3',
      partial: false,
      results: [
        {
          id: 'durable',
          title: 'Workflows',
          icon: 'workflow',
          hits: [{ title: 'Run q3', href: '/durable#/runs/q3' }],
        },
        {
          id: 'media',
          title: 'Media',
          icon: 'media',
          hits: [
            {
              title: 'Q3 report',
              subtitle: 'Library · gallery · q3-report.pdf',
              href: '/admin/media#/library/m1',
            },
          ],
        },
      ],
    });
    const byKey = await fetch(`${url}/admin/media/api/consoles/search?q=reports/`, {
      headers: bearer,
    });
    const body = (await byKey.json()) as { results: { id: string; hits: { href: string }[] }[] };
    expect(body.results.find((group) => group.id === 'media')?.hits).toEqual([
      {
        title: 'q3.pdf',
        subtitle: 'primary · reports/q3.pdf',
        href: '/admin/media#/disks/primary?prefix=reports%2F&preview=reports%2Fq3.pdf',
      },
    ]);
  });
});
