// A federated media console over HTTP: a central app mounts the console with two other apps
// (`orders`, `billing`), each with its OWN media store, upload store and disks. `?app=` (or the
// `x-media-app` header) selects the app; reads come from that app's stores, the record delete and
// the upload abort land in that app's stores only, disk writes answer 501 for a federated app, and
// an `authorize` `apps` grant confines a viewer to the apps it names.
import 'reflect-metadata';
import type { MediaRecord } from '@dudousxd/nestjs-media-core';
import {
  InMemoryMediaStore,
  InMemoryUploadSessionStore,
  storageOf,
} from '@dudousxd/nestjs-media-testing';
import {
  type CanActivate,
  type DynamicModule,
  type ExecutionContext,
  Global,
  Injectable,
  Module,
  UseGuards,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { InMemoryDisk, StorageModule } from '@nestjs/storage';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type ConsoleAuthorizeResult, MediaDashboardModule } from './index.js';

const STORE = Symbol.for('nestjs-media:store');
const UPLOADS = Symbol.for('nestjs-media:upload-sessions');

function record(id: string, collection = 'gallery'): MediaRecord {
  return {
    id,
    ownerType: 'Post',
    ownerId: '1',
    collection,
    name: id,
    fileName: `${id}.txt`,
    mimeType: 'text/plain',
    size: 1,
    disk: 'files',
    path: `p/${id}.txt`,
    order: 0,
    customProperties: {},
    conversions: {},
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}

/** One app's media: what its own `MediaModule` writes, read in place by the central console. */
async function appMedia(name: string) {
  const store = new InMemoryMediaStore();
  await store.save(record(`${name}-1`, `${name}-photos`));
  const uploads = new InMemoryUploadSessionStore();
  await uploads.create({
    id: `${name}-up`,
    disk: 'files',
    key: `in/${name}.bin`,
    contentType: undefined,
    size: 10,
    offset: 5,
    parts: 1,
  });
  const disk = new InMemoryDisk();
  await disk.put(`docs/${name}.txt`, `hello from ${name}`);
  return { store, uploads, storage: storageOf({ files: disk }), disk };
}

type Media = Awaited<ReturnType<typeof appMedia>>;

let app: Awaited<ReturnType<typeof NestFactory.create>> | undefined;
let central: Media;
let orders: Media;
let billing: Media;

beforeEach(async () => {
  central = await appMedia('central');
  orders = await appMedia('orders');
  billing = await appMedia('billing');
});

afterEach(async () => {
  await app?.close();
  app = undefined;
});

/** The viewer's role, from a header standing in for a session cookie. */
@Injectable()
class FakeAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context
      .switchToHttp()
      .getRequest<{ headers: Record<string, string>; user?: unknown }>();
    if (req.headers['x-role']) req.user = { role: req.headers['x-role'] };
    return true;
  }
}

/** admin: every app; orders-team: only `orders`; anyone else: denied. */
function authorize(ctx: ExecutionContext): ConsoleAuthorizeResult {
  const role = ctx.switchToHttp().getRequest<{ user?: { role: string } }>().user?.role;
  if (role === 'admin') return { allowed: true, apps: '*' };
  if (role === 'orders-team') return { allowed: true, apps: ['orders'] };
  return false;
}

async function boot(): Promise<string> {
  @Global()
  @Module({
    imports: [StorageModule.forRoot({ disks: { files: central.disk } })],
    providers: [
      { provide: STORE, useValue: central.store },
      { provide: UPLOADS, useValue: central.uploads },
    ],
    exports: [STORE, UPLOADS],
  })
  class CentralMediaModule {}

  const dashboard: DynamicModule = MediaDashboardModule.forRoot({
    actions: true,
    decorators: [UseGuards(FakeAuthGuard)],
    authorize,
    federation: {
      localLabel: 'Central',
      apps: {
        orders: { ...orders, label: 'Orders' },
        billing: { store: billing.store, uploads: billing.uploads, storage: billing.storage },
      },
    },
  });
  @Module({ imports: [CentralMediaModule, dashboard] })
  class AppModule {}
  app = await NestFactory.create(AppModule, { logger: false });
  await app.listen(0);
  return `${await app.getUrl()}/media/api`;
}

const as = (role: string, init: RequestInit = {}): RequestInit => ({
  ...init,
  headers: { accept: 'application/json', 'x-role': role, ...(init.headers ?? {}) },
});

async function json(url: string, init: RequestInit): Promise<any> {
  const res = await fetch(url, init);
  expect(res.status, `${init.method ?? 'GET'} ${url}`).toBe(200);
  return res.json();
}

describe('federated media console', () => {
  it('reads the library, collections, uploads and disks of the selected app', async () => {
    const api = await boot();
    const ids = async (query: string) =>
      (await json(`${api}/library${query}`, as('admin'))).data.map((r: { id: string }) => r.id);

    expect(await ids('')).toEqual(['central-1']);
    expect(await ids('?app=orders')).toEqual(['orders-1']);
    expect(await ids('?app=billing')).toEqual(['billing-1']);
    // The header the SPA sends selects the same way.
    const viaHeader = await json(
      `${api}/library`,
      as('admin', { headers: { 'x-media-app': 'billing' } }),
    );
    expect(viaHeader.data.map((r: { id: string }) => r.id)).toEqual(['billing-1']);

    const collections = await json(`${api}/library/collections?app=orders`, as('admin'));
    expect(collections.data.map((c: { key: string }) => c.key)).toEqual(['orders-photos']);
    const uploads = await json(`${api}/uploads?app=orders`, as('admin'));
    expect(uploads.data.map((u: { id: string }) => u.id)).toEqual(['orders-up']);

    const listing = await json(`${api}/disks/files/objects?prefix=docs&app=billing`, as('admin'));
    expect(listing.data.map((o: { key: string }) => o.key)).toEqual(['docs/billing.txt']);
    const raw = await fetch(
      `${api}/disks/files/object/raw?key=docs/orders.txt&app=orders`,
      as('admin'),
    );
    expect(await raw.text()).toBe('hello from orders');
    // Another app's key is not there.
    const missing = await fetch(
      `${api}/disks/files/object/raw?key=docs/central.txt&app=orders`,
      as('admin'),
    );
    expect(missing.status).toBe(404);

    expect((await fetch(`${api}/library/central-1?app=orders`, as('admin'))).status).toBe(404);
    const detail = await json(`${api}/library/orders-1?app=orders`, as('admin'));
    expect(detail.record.id).toBe('orders-1');
  });

  it('describes the federation in topology, for the app the request is for', async () => {
    const api = await boot();
    expect((await json(`${api}/topology`, as('admin'))).federation).toEqual({
      local: { label: 'Central' },
      apps: [
        { name: 'orders', label: 'Orders' },
        { name: 'billing', label: 'billing' },
      ],
    });
    expect((await json(`${api}/topology?app=orders`, as('admin'))).federation.current).toBe(
      'orders',
    );
  });

  it('runs the record delete and the upload abort in the selected app only', async () => {
    const api = await boot();
    const del = await fetch(
      `${api}/library/orders-1?app=orders`,
      as('admin', { method: 'DELETE' }),
    );
    expect(del.status).toBe(204);
    expect(await orders.store.find('orders-1')).toBeNull();
    expect(await central.store.find('central-1')).not.toBeNull();
    expect(await billing.store.find('billing-1')).not.toBeNull();

    // An id of another app deletes nothing there.
    const wrong = await fetch(
      `${api}/library/billing-1?app=orders`,
      as('admin', { method: 'DELETE' }),
    );
    expect(wrong.status).toBe(204); // the store's delete is idempotent, like on the console's own app
    expect(await billing.store.find('billing-1')).not.toBeNull();

    const abort = await fetch(
      `${api}/uploads/billing-up/abort`,
      as('admin', { method: 'POST', headers: { 'x-media-app': 'billing' } }),
    );
    expect(abort.status).toBe(204);
    expect(await billing.uploads.get('billing-up')).toBeNull();
    expect(await orders.uploads.get('orders-up')).not.toBeNull();
    expect(await central.uploads.get('central-up')).not.toBeNull();
  });

  it('answers 501 to disk writes on a federated app, and leaves its disk untouched', async () => {
    const api = await boot();
    const remove = await fetch(
      `${api}/disks/files/object?key=docs/orders.txt&app=orders`,
      as('admin', { method: 'DELETE' }),
    );
    expect(remove.status).toBe(501);
    expect(await orders.disk.exists('docs/orders.txt')).toBe(true);
    const folder = await fetch(
      `${api}/disks/files/folder?app=orders`,
      as('admin', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prefix: 'new' }),
      }),
    );
    expect(folder.status).toBe(501);
    // The console's own disk still takes writes.
    const own = await fetch(
      `${api}/disks/files/object?key=docs/central.txt`,
      as('admin', { method: 'DELETE' }),
    );
    expect(own.status).toBe(204);
    expect(await central.disk.exists('docs/central.txt')).toBe(false);
  });

  it('answers 404 for an unknown app', async () => {
    const api = await boot();
    expect((await fetch(`${api}/library?app=nope`, as('admin'))).status).toBe(404);
    expect((await fetch(`${api}/library?app=__proto__`, as('admin'))).status).toBe(404);
  });

  it('confines a viewer to the apps its grant names', async () => {
    const api = await boot();
    const topology = await json(`${api}/topology`, as('orders-team'));
    expect(topology.federation).toEqual({
      local: null,
      apps: [{ name: 'orders', label: 'Orders' }],
    });
    expect(topology.hasStore).toBe(false);

    expect((await fetch(`${api}/library?app=orders`, as('orders-team'))).status).toBe(200);
    expect((await fetch(`${api}/library?app=billing`, as('orders-team'))).status).toBe(404);
    // The console's own app is not in the grant either.
    expect((await fetch(`${api}/library`, as('orders-team'))).status).toBe(404);
    const del = await fetch(
      `${api}/library/billing-1?app=billing`,
      as('orders-team', { method: 'DELETE' }),
    );
    expect(del.status).toBe(404);
    expect(await billing.store.find('billing-1')).not.toBeNull();
  });

  it('refuses a malformed federation at boot', () => {
    expect(() => MediaDashboardModule.forRoot({ federation: { apps: {} } })).toThrow(
      /names no app/,
    );
    expect(() =>
      MediaDashboardModule.forRoot({ federation: { apps: { 'a b': { store: orders.store } } } }),
    ).toThrow(/must be 1–100/);
    expect(() => MediaDashboardModule.forRoot({ federation: { apps: { a: {} } } })).toThrow(
      /at least one of/,
    );
  });
});
