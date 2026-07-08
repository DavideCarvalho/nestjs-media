import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { S3Driver } from './s3-driver';

let container: StartedTestContainer;
let client: S3Client;
const BUCKET = 'stat-deletemany';

beforeAll(async () => {
  container = await new GenericContainer('minio/minio:latest')
    .withExposedPorts(9000)
    .withEnvironment({ MINIO_ROOT_USER: 'minioadmin', MINIO_ROOT_PASSWORD: 'minioadmin' })
    .withCommand(['server', '/data'])
    .start();
  client = new S3Client({
    region: 'us-east-1',
    endpoint: `http://${container.getHost()}:${container.getMappedPort(9000)}`,
    forcePathStyle: true,
    credentials: { accessKeyId: 'minioadmin', secretAccessKey: 'minioadmin' },
  });
  await client.send(new CreateBucketCommand({ Bucket: BUCKET }));
}, 120_000);

afterAll(async () => {
  await container?.stop();
});

describe('S3Driver stat + deleteMany (MinIO)', () => {
  it('stat returns size, content-type and last-modified', async () => {
    const driver = new S3Driver({ client, bucket: BUCKET });
    await driver.put('docs/a.txt', Buffer.from('hello world'), { contentType: 'text/plain' });
    const meta = await driver.stat('docs/a.txt');
    expect(meta.size).toBe(11);
    expect(meta.contentType).toBe('text/plain');
    expect(meta.lastModified).toBeInstanceOf(Date);
  });

  it('deleteMany removes every listed key', async () => {
    const driver = new S3Driver({ client, bucket: BUCKET });
    await driver.put('m/a', Buffer.from('a'));
    await driver.put('m/b', Buffer.from('b'));
    await driver.deleteMany(['m/a', 'm/b']);
    expect(await driver.exists('m/a')).toBe(false);
    expect(await driver.exists('m/b')).toBe(false);
    await expect(driver.deleteMany([])).resolves.toBeUndefined();
  });
}, 120_000);
