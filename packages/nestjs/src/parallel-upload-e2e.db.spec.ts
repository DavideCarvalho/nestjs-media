// End-to-end: drives the SHIPPED parallel-multipart path over real HTTP against a
// real S3 (MinIO via testcontainers). The client's `uploadMediaParallel` opens a tus
// session (MediaUploadController -> TusUploadHandler -> manager.createUpload, which
// starts an S3 multipart upload), then PUTs each part concurrently to
// MediaMultipartUploadController (`:id/parts/:n` -> manager.writePart), then POSTs
// `/complete` (-> manager.complete, single-source part list). This exercises the exact
// seams the review touched: concurrent writePart, the server-derived key, and the
// complete() contract. Excluded from `pnpm test` (`*.db.spec.ts`); run with Docker via
// `pnpm test:db`.
import type { AddressInfo } from 'node:net';
import { CreateBucketCommand, GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { uploadMediaParallel } from '@dudousxd/nestjs-media-client';
import { S3Driver } from '@dudousxd/nestjs-media-disk-s3';
import { InMemoryUploadSessionStore } from '@dudousxd/nestjs-media-testing';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import express from 'express';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MediaModule } from './media.module';

const BUCKET = 'media-e2e';
const KEY = 'k/e2e-parallel.bin';
const MIB = 1024 * 1024;

let container: StartedTestContainer;
let s3: S3Client;
let app: NestExpressApplication;
let baseUrl: string;

beforeAll(async () => {
  container = await new GenericContainer('minio/minio:latest')
    .withExposedPorts(9000)
    .withEnvironment({ MINIO_ROOT_USER: 'minioadmin', MINIO_ROOT_PASSWORD: 'minioadmin' })
    .withCommand(['server', '/data'])
    .start();

  const endpoint = `http://${container.getHost()}:${container.getMappedPort(9000)}`;
  s3 = new S3Client({
    region: 'us-east-1',
    endpoint,
    forcePathStyle: true,
    credentials: { accessKeyId: 'minioadmin', secretAccessKey: 'minioadmin' },
  });
  await s3.send(new CreateBucketCommand({ Bucket: BUCKET }));

  app = await NestFactory.create<NestExpressApplication>(
    MediaModule.forRoot({
      default: BUCKET,
      disks: { [BUCKET]: new S3Driver({ client: s3, bucket: BUCKET }) },
      uploadSessions: new InMemoryUploadSessionStore(),
      // Deterministic server-derived key so the test knows where to read the object;
      // the client never sees or controls it (GameWarden-safe).
      tus: { disk: BUCKET, basePath: '/media/uploads', keyFor: () => KEY },
    }),
    { bodyParser: false, logger: false },
  );
  // The parts route and tus PATCH arrive as `application/offset+octet-stream`; mount a
  // raw parser with a per-part cap so bodies land as Buffers.
  app.use(express.raw({ type: 'application/offset+octet-stream', limit: '32mb' }));
  await app.listen(0);
  const address = app.getHttpServer().address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
}, 180_000);

afterAll(async () => {
  await app?.close();
  await container?.stop();
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
    const got = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: KEY }));
    if (!got.Body) throw new Error('expected GetObject to return a body');
    const bytes = Buffer.from(await got.Body.transformToByteArray());
    expect(bytes.length).toBe(part1.length + part2.length);
    expect(bytes.equals(Buffer.concat([part1, part2]))).toBe(true);
  }, 120_000);
});
