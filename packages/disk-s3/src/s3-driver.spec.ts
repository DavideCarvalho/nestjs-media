import { Readable } from 'node:stream';
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { FileNotFoundError, UnsupportedOperationError } from '@dudousxd/nestjs-media-core';
import { sdkStreamMixin } from '@smithy/util-stream';
import { type AwsClientStub, mockClient } from 'aws-sdk-client-mock';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { S3Driver } from './s3-driver';

const makeClient = () =>
  new S3Client({
    region: 'us-east-1',
    credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
  });

const notFound = (name: string) => Object.assign(new Error(name), { name });

let client: S3Client;
let mock: AwsClientStub<S3Client>;

beforeEach(() => {
  client = makeClient();
  mock = mockClient(client);
});
afterEach(() => {
  mock.restore();
});

describe('S3Driver', () => {
  it('advertises presign + multipart capabilities; publicUrls follows publicBaseUrl', () => {
    expect(new S3Driver({ client, bucket: 'b' }).capabilities).toEqual({
      presign: true,
      multipart: true,
      publicUrls: false,
    });
    expect(
      new S3Driver({ client, bucket: 'b', publicBaseUrl: 'https://cdn.test' }).capabilities
        .publicUrls,
    ).toBe(true);
  });

  it('applies the key prefix', () => {
    const d = new S3Driver({ client, bucket: 'b', keyPrefix: '/uploads/' });
    expect(d.key('a/b.png')).toBe('uploads/a/b.png');
    expect(new S3Driver({ client, bucket: 'b' }).key('/a.png')).toBe('a.png');
  });

  it('put issues a PutObjectCommand with the prefixed key', async () => {
    mock.on(PutObjectCommand).resolves({});
    const d = new S3Driver({ client, bucket: 'b', keyPrefix: 'up' });
    await d.put('a.txt', Buffer.from('hi'), { contentType: 'text/plain' });
    const calls = mock.commandCalls(PutObjectCommand);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.args[0].input).toMatchObject({
      Bucket: 'b',
      Key: 'up/a.txt',
      ContentType: 'text/plain',
    });
  });

  it('get round-trips the object body', async () => {
    mock
      .on(GetObjectCommand)
      .resolves({ Body: sdkStreamMixin(Readable.from(Buffer.from('hello'))) });
    const d = new S3Driver({ client, bucket: 'b' });
    expect((await d.get('a.txt')).toString()).toBe('hello');
  });

  it('get maps NoSuchKey to FileNotFoundError', async () => {
    mock.on(GetObjectCommand).rejects(notFound('NoSuchKey'));
    const d = new S3Driver({ client, bucket: 'b' });
    await expect(d.get('missing')).rejects.toBeInstanceOf(FileNotFoundError);
  });

  it('exists reflects HeadObject success / NotFound', async () => {
    const d = new S3Driver({ client, bucket: 'b' });
    mock.on(HeadObjectCommand).resolves({ ContentLength: 4 });
    expect(await d.exists('a')).toBe(true);
    mock.on(HeadObjectCommand).rejects(notFound('NotFound'));
    expect(await d.exists('a')).toBe(false);
  });

  it('size returns ContentLength and maps NotFound', async () => {
    const d = new S3Driver({ client, bucket: 'b' });
    mock.on(HeadObjectCommand).resolves({ ContentLength: 7 });
    expect(await d.size('a')).toBe(7);
    mock.on(HeadObjectCommand).rejects(notFound('NotFound'));
    await expect(d.size('a')).rejects.toBeInstanceOf(FileNotFoundError);
  });

  it('delete issues DeleteObjectCommand', async () => {
    mock.on(DeleteObjectCommand).resolves({});
    await new S3Driver({ client, bucket: 'b' }).delete('a');
    expect(mock.commandCalls(DeleteObjectCommand)).toHaveLength(1);
  });

  it('copy sets CopySource to bucket/key; move also deletes source', async () => {
    mock.on(CopyObjectCommand).resolves({});
    mock.on(DeleteObjectCommand).resolves({});
    const d = new S3Driver({ client, bucket: 'b', keyPrefix: 'up' });
    await d.move('from.txt', 'to.txt');
    const copy = mock.commandCalls(CopyObjectCommand)[0]?.args[0].input;
    expect(copy).toMatchObject({ Bucket: 'b', CopySource: 'b/up/from.txt', Key: 'up/to.txt' });
    expect(mock.commandCalls(DeleteObjectCommand)[0]?.args[0].input).toMatchObject({
      Key: 'up/from.txt',
    });
  });

  it('url needs publicBaseUrl', async () => {
    await expect(new S3Driver({ client, bucket: 'b' }).url('a')).rejects.toBeInstanceOf(
      UnsupportedOperationError,
    );
    const d = new S3Driver({
      client,
      bucket: 'b',
      keyPrefix: 'up',
      publicBaseUrl: 'https://cdn.test/',
    });
    expect(await d.url('a/b.png')).toBe('https://cdn.test/up/a/b.png');
  });

  it('temporaryUrl produces a signed URL', async () => {
    const d = new S3Driver({ client: makeClient(), bucket: 'b' });
    const url = await d.temporaryUrl('a/b.png', 120);
    expect(url).toContain('X-Amz-Signature=');
    expect(url).toContain('X-Amz-Expires=120');
  });
});
