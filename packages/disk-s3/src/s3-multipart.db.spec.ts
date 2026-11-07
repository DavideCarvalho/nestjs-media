// Integration: the media disk conformance suite against @nestjs/storage's S3Disk on a real MinIO,
// with the s3Multipart side-car on the very same options. Excluded from `pnpm test` (it is a
// `*.db.spec.ts`); `pnpm test:db` runs it with Docker. The container is named `media-minio-*`,
// listens on a random host port, and is removed afterwards.
import { randomBytes } from 'node:crypto';
import { ResumableUploadManager } from '@dudousxd/nestjs-media-core';
import {
  InMemoryUploadSessionStore,
  describeMediaDiskConformance,
  storageOf,
} from '@dudousxd/nestjs-media-testing';
import { S3Disk, type S3DiskOptions } from '@nestjs/storage';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { s3Multipart } from './s3-multipart';
import { createBucket } from './test-support/create-bucket';

let container: StartedTestContainer;
const options = {} as S3DiskOptions;

beforeAll(async () => {
  // MinIO no longer publishes images to Docker Hub; Chainguard's build, pinned by digest.
  container = await new GenericContainer(
    'cgr.dev/chainguard/minio@sha256:869ca3178831d9f521ea02258a0f0d4fbc1e9f84302e707514e1f861b860865d',
  )
    .withName(`media-minio-${randomBytes(4).toString('hex')}`)
    .withCommand(['server', '/tmp/minio-data'])
    .withExposedPorts(9000)
    .withEnvironment({ MINIO_ROOT_USER: 'mediaadmin', MINIO_ROOT_PASSWORD: 'mediaadmin-secret' })
    .withWaitStrategy(Wait.forHttp('/minio/health/ready', 9000).forStatusCode(200))
    .start();
  Object.assign(options, {
    bucket: 'media-conformance',
    region: 'us-east-1',
    endpoint: `http://${container.getHost()}:${container.getMappedPort(9000)}`,
    forcePathStyle: true,
    credentials: { accessKeyId: 'mediaadmin', secretAccessKey: 'mediaadmin-secret' },
    prefix: 'tenant-a/',
  } satisfies S3DiskOptions);
  await createBucket(options);
}, 180_000);

afterAll(async () => {
  await container?.stop({ remove: true });
});

describeMediaDiskConformance('S3Disk on MinIO', () => new S3Disk(options), {
  multipart: () => s3Multipart(options),
});

describe('resumable uploads through the side-car (MinIO)', () => {
  it('concurrent, out-of-order writePart then complete lands the exact bytes on the S3Disk', async () => {
    const disk = new S3Disk(options);
    const manager = new ResumableUploadManager({
      storage: storageOf({ s3: disk }),
      multipart: { s3: s3Multipart(options) },
      sessions: new InMemoryUploadSessionStore(),
      emitDiagnostics: false,
    });
    const MIB = 1024 * 1024;
    const part1 = Buffer.alloc(6 * MIB, 1);
    const part2 = Buffer.alloc(2 * MIB, 2);
    const key = 'k/parallel.bin';
    const session = await manager.createUpload({
      disk: 's3',
      key,
      size: part1.length + part2.length,
      contentType: 'application/x-parallel',
    });
    await Promise.all([
      manager.writePart(session.id, 2, part2),
      manager.writePart(session.id, 1, part1),
    ]);
    expect((await manager.complete(session.id)).key).toBe(key);

    const bytes = await disk.getBuffer(key);
    expect(bytes.length).toBe(part1.length + part2.length);
    expect(bytes.subarray(0, part1.length).equals(part1)).toBe(true);
    expect(bytes.subarray(part1.length).equals(part2)).toBe(true);
    expect((await disk.stat(key)).contentType).toBe('application/x-parallel');
  });

  it('a disk without a side-car assembles temp parts by streaming them into put()', async () => {
    const disk = new S3Disk(options);
    const manager = new ResumableUploadManager({
      storage: storageOf({ s3: disk }),
      sessions: new InMemoryUploadSessionStore(),
      emitDiagnostics: false,
    });
    const session = await manager.createUpload({ disk: 's3', key: 'k/proxy.bin' });
    await manager.writeChunk(session.id, 0, Buffer.from('abc'));
    await manager.writeChunk(session.id, 3, Buffer.from('def'));
    await manager.complete(session.id);
    expect(await disk.getText('k/proxy.bin')).toBe('abcdef');
    expect(await disk.exists(`.uploads/${session.id}/0`)).toBe(false);
  });
});
