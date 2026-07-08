// Integration: proves the parallel multipart path (Task 1's writePart/complete +
// Task 2's InMemoryUploadSessionStore.addPart/listParts) assembles a byte-identical
// object in a real S3-compatible server (MinIO via testcontainers), even when parts
// are written concurrently and out of order. Excluded from the default `pnpm test`
// run (it is a `*.db.spec.ts`); run explicitly with Docker available.
import { CreateBucketCommand, GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { ResumableUploadManager } from '@dudousxd/nestjs-media-core';
import { InMemoryUploadSessionStore } from '@dudousxd/nestjs-media-testing';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { S3Driver } from './s3-driver';

let container: StartedTestContainer;
let client: S3Client;
const BUCKET = 'media-parallel';

beforeAll(async () => {
  container = await new GenericContainer('minio/minio:latest')
    .withExposedPorts(9000)
    .withEnvironment({ MINIO_ROOT_USER: 'minioadmin', MINIO_ROOT_PASSWORD: 'minioadmin' })
    .withCommand(['server', '/data'])
    .start();

  const endpoint = `http://${container.getHost()}:${container.getMappedPort(9000)}`;
  client = new S3Client({
    region: 'us-east-1',
    endpoint,
    forcePathStyle: true,
    credentials: { accessKeyId: 'minioadmin', secretAccessKey: 'minioadmin' },
  });
  await client.send(new CreateBucketCommand({ Bucket: BUCKET }));
}, 120_000);

afterAll(async () => {
  await container?.stop();
});

describe('parallel multipart round trip (MinIO)', () => {
  it('concurrent, out-of-order writePart then complete lands the exact bytes', async () => {
    const disk = new S3Driver({ client, bucket: BUCKET });
    const manager = new ResumableUploadManager({
      // `storage.disk(name)` only ever needs to hand back this one driver in this test;
      // `as any` is a minimal StorageManager stub (noExplicitAny is off in this repo's biome config).
      storage: { disk: () => disk } as any,
      sessions: new InMemoryUploadSessionStore(),
      emitDiagnostics: false,
    });

    // 6 MiB + 2 MiB (a non-final S3 multipart part must be >= 5 MiB).
    const MIB = 1024 * 1024;
    const part1 = Buffer.alloc(6 * MIB, 1);
    const part2 = Buffer.alloc(2 * MIB, 2);
    const key = 'k/parallel.bin';
    const session = await manager.createUpload({
      disk: BUCKET,
      key,
      size: part1.length + part2.length,
    });

    // Upload out of order and concurrently: part 2 dispatched before part 1, both in flight.
    await Promise.all([
      manager.writePart(session.id, 2, part2),
      manager.writePart(session.id, 1, part1),
    ]);
    const result = await manager.complete(session.id);
    expect(result.key).toBe(key);

    const got = await client.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
    if (!got.Body) throw new Error('expected GetObject to return a body');
    const bytes = Buffer.from(await got.Body.transformToByteArray());
    expect(bytes.length).toBe(part1.length + part2.length);
    expect(bytes.subarray(0, part1.length).equals(part1)).toBe(true);
    expect(bytes.subarray(part1.length).equals(part2)).toBe(true);
  }, 120_000);
});
