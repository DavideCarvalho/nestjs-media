import type { UploadSession } from '@dudousxd/nestjs-media-core';
import { beforeEach, describe, expect, it } from 'vitest';
import type { MinimalRedis } from './redis-upload-session-store';
import { RedisUploadSessionStore } from './redis-upload-session-store';

interface SetCall {
  key: string;
  value: string;
  args: unknown[];
}

function makeFakeRedis(): MinimalRedis & {
  store: Map<string, string>;
  setCalls: SetCall[];
  hashes: Map<string, Map<string, string>>;
} {
  const store = new Map<string, string>();
  const setCalls: SetCall[] = [];
  const hashes = new Map<string, Map<string, string>>();

  return {
    store,
    setCalls,
    hashes,
    async get(key: string): Promise<string | null> {
      return store.get(key) ?? null;
    },
    async set(key: string, value: string, ...args: unknown[]): Promise<unknown> {
      store.set(key, value);
      setCalls.push({ key, value, args });
      return 'OK';
    },
    async del(...keys: string[]): Promise<unknown> {
      for (const key of keys) {
        store.delete(key);
        hashes.delete(key);
      }
      return keys.length;
    },
    async scan(cursor: string | number, ...args: unknown[]): Promise<[string, string[]]> {
      const matchIndex = args.indexOf('MATCH');
      const pattern = matchIndex >= 0 ? String(args[matchIndex + 1]) : '*';
      const regex = new RegExp(
        `^${pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`,
      );
      const keys = [...store.keys()].filter((key) => regex.test(key));
      // Single-pass fake: return every match with a terminal '0' cursor.
      return ['0', keys];
    },
    async hset(key: string, field: string, value: string): Promise<unknown> {
      const hash = hashes.get(key) ?? new Map<string, string>();
      hash.set(field, value);
      hashes.set(key, hash);
      return 1;
    },
    async hgetall(key: string): Promise<Record<string, string>> {
      return Object.fromEntries(hashes.get(key) ?? new Map<string, string>());
    },
    async expire(): Promise<unknown> {
      return 1;
    },
  };
}

function makeSession(overrides: Partial<UploadSession> = {}): UploadSession {
  return {
    id: 'test-id',
    disk: 'default',
    key: 'uploads/file.png',
    contentType: undefined,
    size: undefined,
    offset: 0,
    parts: 0,
    ...overrides,
  };
}

describe('RedisUploadSessionStore', () => {
  let redis: ReturnType<typeof makeFakeRedis>;
  let store: RedisUploadSessionStore;

  beforeEach(() => {
    redis = makeFakeRedis();
    store = new RedisUploadSessionStore(redis);
  });

  it('create then get round-trips an UploadSession with all fields (undefined contentType/size)', async () => {
    const session = makeSession({ id: 'abc', contentType: undefined, size: undefined });
    await store.create(session);
    const result = await store.get('abc');
    expect(result).not.toBeNull();
    expect(result?.id).toBe('abc');
    expect(result?.disk).toBe('default');
    expect(result?.key).toBe('uploads/file.png');
    expect(result?.offset).toBe(0);
    expect(result?.parts).toBe(0);
    expect(result?.contentType).toBeUndefined();
    expect(result?.size).toBeUndefined();
  });

  it('create then get round-trips all fields including contentType and size when set', async () => {
    const session = makeSession({ id: 'xyz', contentType: 'image/png', size: 1024 });
    await store.create(session);
    const result = await store.get('xyz');
    expect(result?.contentType).toBe('image/png');
    expect(result?.size).toBe(1024);
  });

  it('update overwrites the stored session', async () => {
    const session = makeSession({ id: 'upd', offset: 0, parts: 0 });
    await store.create(session);
    const updated: UploadSession = { ...session, offset: 512, parts: 1 };
    await store.update(updated);
    const result = await store.get('upd');
    expect(result?.offset).toBe(512);
    expect(result?.parts).toBe(1);
  });

  it('get returns null for unknown id', async () => {
    const result = await store.get('no-such-id');
    expect(result).toBeNull();
  });

  it('delete removes the session (get returns null after)', async () => {
    const session = makeSession({ id: 'del-me' });
    await store.create(session);
    await store.delete('del-me');
    const result = await store.get('del-me');
    expect(result).toBeNull();
  });

  it('set is called with EX and 86400 by default', async () => {
    const session = makeSession({ id: 'ttl-default' });
    await store.create(session);
    const call = redis.setCalls.find((c) => c.key === 'media:upload:session:ttl-default');
    expect(call).toBeDefined();
    expect(call?.args).toEqual(['EX', 86400]);
  });

  it('honors custom ttlSeconds', async () => {
    const customStore = new RedisUploadSessionStore(redis, { ttlSeconds: 3600 });
    const session = makeSession({ id: 'ttl-custom' });
    await customStore.create(session);
    const call = redis.setCalls.find((c) => c.key === 'media:upload:session:ttl-custom');
    expect(call?.args).toEqual(['EX', 3600]);
  });

  it('honors custom keyPrefix', async () => {
    const customStore = new RedisUploadSessionStore(redis, { keyPrefix: 'my:prefix' });
    const session = makeSession({ id: 'pfx' });
    await customStore.create(session);
    const call = redis.setCalls.find((c) => c.key === 'my:prefix:pfx');
    expect(call).toBeDefined();
    const result = await customStore.get('pfx');
    expect(result?.id).toBe('pfx');
  });

  it('stored key is media:upload:session:<id> by default', async () => {
    const session = makeSession({ id: 'key-check' });
    await store.create(session);
    expect(redis.store.has('media:upload:session:key-check')).toBe(true);
  });

  it('list() returns all stored sessions', async () => {
    await store.create(makeSession({ id: 'a', disk: 'pribuy', key: 'pribuy/elms/1.sqlite' }));
    await store.create(makeSession({ id: 'b', disk: 'files', key: 'reports/x.csv' }));
    const all = await store.list();
    expect(all.map((s) => s.id).sort()).toEqual(['a', 'b']);
  });

  it('list({ disk }) filters by disk', async () => {
    await store.create(makeSession({ id: 'a', disk: 'pribuy', key: 'pribuy/elms/1.sqlite' }));
    await store.create(makeSession({ id: 'b', disk: 'files', key: 'reports/x.csv' }));
    const filesOnly = await store.list({ disk: 'files' });
    expect(filesOnly.map((s) => s.id)).toEqual(['b']);
  });

  it('list({ disk, keyPrefix }) filters by disk and key prefix', async () => {
    await store.create(makeSession({ id: 'a', disk: 'files', key: 'reports/2026/x.csv' }));
    await store.create(makeSession({ id: 'b', disk: 'files', key: 'reports/2025/y.csv' }));
    await store.create(makeSession({ id: 'c', disk: 'files', key: 'other/z.csv' }));
    const scoped = await store.list({ disk: 'files', keyPrefix: 'reports/2026/' });
    expect(scoped.map((s) => s.id)).toEqual(['a']);
  });

  it('list() throws when the redis client lacks scan', async () => {
    const noScan = { ...redis, scan: undefined } as unknown as MinimalRedis;
    const noScanStore = new RedisUploadSessionStore(noScan);
    await expect(noScanStore.list()).rejects.toThrow(/scan/);
  });

  it('create() sets createdAt to now; get()/list() return it as a Date', async () => {
    const before = Date.now();
    const created = await store.create(makeSession({ id: 'ts' }));
    const after = Date.now();
    expect(created.createdAt).toBeInstanceOf(Date);
    expect(created.createdAt?.getTime()).toBeGreaterThanOrEqual(before);
    expect(created.createdAt?.getTime()).toBeLessThanOrEqual(after);

    const fetched = await store.get('ts');
    expect(fetched?.createdAt).toBeInstanceOf(Date);
    expect(fetched?.createdAt?.getTime()).toBe(created.createdAt?.getTime());

    const [listed] = await store.list({ keyPrefix: 'uploads/' });
    expect(listed.createdAt).toBeInstanceOf(Date);
    expect(listed.createdAt?.getTime()).toBe(created.createdAt?.getTime());
  });

  it('leaves createdAt undefined for an older session stored without the field', async () => {
    const legacySession = makeSession({ id: 'legacy' });
    // Simulate a pre-existing record written before createdAt existed: bypass
    // create()'s defaulting and write the raw JSON directly.
    await redis.set('media:upload:session:legacy', JSON.stringify(legacySession), 'EX', 86400);
    const result = await store.get('legacy');
    expect(result).not.toBeNull();
    expect(result?.createdAt).toBeUndefined();
  });

  it('round-trips multipartUploadId through get()', async () => {
    const session = makeSession({
      id: 's1',
      offset: 5,
      parts: 1,
      size: 9,
      multipartUploadId: 'mpu-1',
    });
    await store.create(session);
    const result = await store.get('s1');
    expect(result?.multipartUploadId).toBe('mpu-1');
  });

  it('round-trips host metadata through serialization', async () => {
    // create() serialises the whole session, but deserialize() picks fields explicitly — without
    // restoring metadata there it would be silently dropped on read and never reach upload.complete.
    await store.create({
      id: 'meta-1',
      disk: 'd',
      key: 'k',
      contentType: undefined,
      size: 10,
      offset: 0,
      parts: 0,
      metadata: { collectionId: 'c1', audience: ['role:ADMIN'] },
    });

    const loaded = await store.get('meta-1');
    expect(loaded?.metadata).toEqual({ collectionId: 'c1', audience: ['role:ADMIN'] });
  });

  it('omits metadata when none was stored', async () => {
    await store.create({
      id: 'meta-2',
      disk: 'd',
      key: 'k',
      contentType: undefined,
      size: 1,
      offset: 0,
      parts: 0,
    });
    const loaded = await store.get('meta-2');
    expect(loaded).not.toHaveProperty('metadata');
  });
});

describe('RedisUploadSessionStore parts (HSET)', () => {
  it('records parts to a per-session hash, lists them, and delete removes the hash', async () => {
    const redis = makeFakeRedis();
    const store = new RedisUploadSessionStore(redis);
    await store.create(makeSession({ id: 'a', key: 'k/a', size: 30 }));
    await store.addPart('a', { partNumber: 2, etag: 'e2' });
    await store.addPart('a', { partNumber: 1, etag: 'e1' });

    const parts = await store.listParts('a');
    expect([...parts].sort((x, y) => x.partNumber - y.partNumber)).toEqual([
      { partNumber: 1, etag: 'e1' },
      { partNumber: 2, etag: 'e2' },
    ]);

    await store.delete('a');
    expect(await store.listParts('a')).toEqual([]);
  });
});
