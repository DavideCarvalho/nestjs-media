// Integration: runs the shared StorageDriver conformance suite against a real
// S3-compatible server (MinIO via testcontainers). Excluded from the default
// `pnpm test` run (it is a `*.db.spec.ts`); run explicitly with Docker available.
import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { runStorageDriverConformance } from '@dudousxd/nestjs-media-testing';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import { afterAll, beforeAll } from 'vitest';
import { S3Driver } from './s3-driver';

let container: StartedTestContainer;
let client: S3Client;
const BUCKET = 'media-test';

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

runStorageDriverConformance('S3Driver (minio)', () => new S3Driver({ client, bucket: BUCKET }));
