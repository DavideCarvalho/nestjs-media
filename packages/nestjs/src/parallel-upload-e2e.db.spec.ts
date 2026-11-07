// End-to-end: drives the SHIPPED parallel-multipart path over real HTTP against a
// real S3 (MinIO via testcontainers). The client's `uploadMediaParallel` opens a tus
// session (MediaUploadController -> TusUploadHandler -> manager.createUpload, which
// starts an S3 multipart upload), then PUTs each part concurrently to
// MediaMultipartUploadController (`:id/parts/:n` -> manager.writePart), then POSTs
// `/complete` (-> manager.complete, single-source part list). This exercises the exact
// seams the review touched: concurrent writePart, the server-derived key, and the
// complete() contract. Excluded from `pnpm test` (`*.db.spec.ts`); run with Docker via
// `pnpm test:db`.
import { createHash, createHmac, randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { uploadMediaParallel } from '@dudousxd/nestjs-media-client';
import { s3Multipart } from '@dudousxd/nestjs-media-disk-s3';
import { InMemoryUploadSessionStore } from '@dudousxd/nestjs-media-testing';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { S3Disk, type S3DiskOptions, StorageModule } from '@nestjs/storage';
import express from 'express';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MediaModule } from './media.module';

const KEY = 'k/e2e-parallel.bin';
const MIB = 1024 * 1024;

let container: StartedTestContainer;
let disk: S3Disk;
let app: NestExpressApplication;
let baseUrl: string;

/** `PUT /<bucket>` on MinIO, SigV4-signed (S3Disk can't create buckets). */
async function createBucket(endpoint: string, bucket: string): Promise<void> {
  const url = new URL(`${endpoint}/${bucket}`);
  const stamp = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const day = stamp.slice(0, 8);
  const empty = createHash('sha256').update('').digest('hex');
  const canonical = `PUT\n${url.pathname}\n\nhost:${url.host}\nx-amz-content-sha256:${empty}\nx-amz-date:${stamp}\n\nhost;x-amz-content-sha256;x-amz-date\n${empty}`;
  const scope = `${day}/us-east-1/s3/aws4_request`;
  const toSign = `AWS4-HMAC-SHA256\n${stamp}\n${scope}\n${createHash('sha256').update(canonical).digest('hex')}`;
  let key: Buffer = createHmac('sha256', 'AWS4mediaadmin-secret').update(day).digest();
  for (const part of ['us-east-1', 's3', 'aws4_request'])
    key = createHmac('sha256', key).update(part).digest();
  const signature = createHmac('sha256', key).update(toSign).digest('hex');
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      'x-amz-content-sha256': empty,
      'x-amz-date': stamp,
      authorization: `AWS4-HMAC-SHA256 Credential=mediaadmin/${scope}, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=${signature}`,
    },
  });
  if (!res.ok) throw new Error(`CreateBucket: ${res.status} ${await res.text()}`);
}

beforeAll(async () => {
  // MinIO no longer publishes images to Docker Hub; Chainguard's build, pinned by digest.
  container = await new GenericContainer(
    'cgr.dev/chainguard/minio@sha256:869ca3178831d9f521ea02258a0f0d4fbc1e9f84302e707514e1f861b860865d',
  )
    .withName(`media-minio-e2e-${randomBytes(4).toString('hex')}`)
    .withCommand(['server', '/tmp/minio-data'])
    .withExposedPorts(9000)
    .withEnvironment({ MINIO_ROOT_USER: 'mediaadmin', MINIO_ROOT_PASSWORD: 'mediaadmin-secret' })
    .withWaitStrategy(Wait.forHttp('/minio/health/ready', 9000).forStatusCode(200))
    .start();

  const endpoint = `http://${container.getHost()}:${container.getMappedPort(9000)}`;
  await createBucket(endpoint, 'media-e2e');
  const s3: S3DiskOptions = {
    bucket: 'media-e2e',
    region: 'us-east-1',
    endpoint,
    forcePathStyle: true,
    credentials: { accessKeyId: 'mediaadmin', secretAccessKey: 'mediaadmin-secret' },
  };
  disk = new S3Disk(s3);

  @Module({
    imports: [
      StorageModule.forRoot({ disks: { s3: disk } }),
      MediaModule.forRoot({
        uploadSessions: new InMemoryUploadSessionStore(),
        multipart: { s3: s3Multipart(s3) },
        // Deterministic server-derived key so the test knows where to read the object;
        // the client never sees or controls it (GameWarden-safe).
        tus: { disk: 's3', basePath: '/media/uploads', keyFor: () => KEY },
      }),
    ],
  })
  class AppModule {}

  app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
    logger: false,
  });
  // The parts route and tus PATCH arrive as `application/offset+octet-stream`; mount a
  // raw parser with a per-part cap so bodies land as Buffers.
  app.use(express.raw({ type: 'application/offset+octet-stream', limit: '32mb' }));
  await app.listen(0);
  const address = app.getHttpServer().address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
}, 180_000);

afterAll(async () => {
  await app?.close();
  await container?.stop({ remove: true });
});

describe('parallel multipart upload over HTTP (client -> Nest -> MinIO)', () => {
  it('uploads parts concurrently and assembles the exact bytes', async () => {
    // 6 MiB of 0x01 then 2 MiB of 0x02. With chunkSize 6 MiB the client makes two parts:
    // part 1 = the 0x01 run (non-final, >= 5 MiB), part 2 = the 0x02 run (final).
    const part1 = Buffer.alloc(6 * MIB, 1);
    const part2 = Buffer.alloc(2 * MIB, 2);
    const blob = new Blob([part1, part2]);

    // Absolutize relative URLs (the tus handler returns a relative Location, which
    // Node's fetch cannot resolve on its own) AND record how many part PUTs are in
    // flight at once, so we can prove the uploads actually overlap.
    let inFlight = 0;
    let maxInFlight = 0;
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = new URL(String(input), baseUrl);
      const isPart = init?.method === 'PUT' && url.pathname.includes('/parts/');
      if (isPart) {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
      }
      try {
        return await fetch(url, init);
      } finally {
        if (isPart) inFlight -= 1;
      }
    };

    const result = await uploadMediaParallel(blob, {
      filename: 'e2e-parallel.bin',
      basePath: '/media/uploads',
      chunkSize: 6 * MIB,
      concurrency: 3,
      fetchImpl,
    });
    expect(result.location).toBeTruthy();

    // Both parts were genuinely in flight at the same time.
    expect(maxInFlight).toBeGreaterThanOrEqual(2);

    // The assembled object is byte-identical to the original.
    const bytes = await disk.getBuffer(KEY);
    expect(bytes.length).toBe(part1.length + part2.length);
    expect(bytes.equals(Buffer.concat([part1, part2]))).toBe(true);
  }, 120_000);
});
