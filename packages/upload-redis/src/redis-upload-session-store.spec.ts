import type { UploadSession } from '@dudousxd/nestjs-media-core';
import { beforeEach, describe, expect, it } from 'vitest';
import type { MinimalRedis } from './redis-upload-session-store';
import { RedisUploadSessionStore } from './redis-upload-session-store';

interface SetCall {
  key: string;
  value: string;
  args: unknown[];
}

function makeFakeRedis(): MinimalRedis & { store: Map<string, string>; setCalls: SetCall[] } {
  const store = new Map<string, string>();
  const setCalls: SetCall[] = [];

  return {
    store,
    setCalls,
    async get(key: string): Promise<string | null> {
      return store.get(key) ?? null;
    },
    async set(key: string, value: string, ...args: unknown[]): Promise<unknown> {
      store.set(key, value);
      setCalls.push({ key, value, args });
      return 'OK';
    },
    async del(key: string): Promise<unknown> {
      store.delete(key);
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

  it('round-trips multipartUploadId and partETags through get()', async () => {
    const session = makeSession({
      id: 's1',
      offset: 5,
      parts: 1,
      size: 9,
      multipartUploadId: 'mpu-1',
      partETags: [{ partNumber: 1, etag: 'etag-1' }],
    });
    await store.create(session);
    const result = await store.get('s1');
    expect(result?.multipartUploadId).toBe('mpu-1');
    expect(result?.partETags).toEqual([{ partNumber: 1, etag: 'etag-1' }]);
  });
});
