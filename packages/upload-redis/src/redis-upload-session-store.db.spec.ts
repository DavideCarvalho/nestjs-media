import type { UploadSession } from '@dudousxd/nestjs-media-core';
import { Redis } from 'ioredis';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RedisUploadSessionStore } from './redis-upload-session-store';

let container: StartedTestContainer;
let redis: Redis;

beforeAll(async () => {
  container = await new GenericContainer('redis:7-alpine')
    .withExposedPorts(6379)
    .withWaitStrategy(Wait.forLogMessage('Ready to accept connections'))
    .start();
  redis = new Redis({ host: container.getHost(), port: container.getMappedPort(6379) });
}, 120_000);

afterAll(async () => {
  redis?.disconnect();
  await container?.stop();
});

function session(id: string, overrides: Partial<UploadSession> = {}): UploadSession {
  return {
    id,
    disk: 's3',
    key: `uploads/${id}.bin`,
    contentType: undefined,
    size: undefined,
    offset: 0,
    parts: 0,
    ...overrides,
  };
}

describe('RedisUploadSessionStore.list (real Redis)', () => {
  it('lists sessions alongside their recorded parts hashes', async () => {
    const store = new RedisUploadSessionStore(redis, { keyPrefix: 'it:list' });
    for (let i = 0; i < 250; i += 1) {
      await store.create(session(`s${i}`, { multipartUploadId: `mp-${i}` }));
    }
    await store.addPart('s0', { partNumber: 1, etag: 'e1' });
    await store.addPart('s7', { partNumber: 2, etag: 'e2' });

    const listed = await store.list({ keyPrefix: 'uploads/' });

    expect(listed).toHaveLength(250);
    expect(listed.find((s) => s.id === 's7')?.multipartUploadId).toBe('mp-7');
    expect(await store.listParts('s7')).toEqual([{ partNumber: 2, etag: 'e2' }]);
  });
});
