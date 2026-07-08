import { Readable } from 'node:stream';
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CopyObjectCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
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
  it('advertises presign + multipart + list capabilities; publicUrls follows publicBaseUrl', () => {
    expect(new S3Driver({ client, bucket: 'b' }).capabilities).toEqual({
      presign: true,
      multipart: true,
      publicUrls: false,
      list: true,
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

  it('list returns folders from CommonPrefixes and files from Contents', async () => {
    mock.on(ListObjectsV2Command).resolves({
      CommonPrefixes: [{ Prefix: 'docs/sub/' }],
      Contents: [
        { Key: 'docs/a.txt', Size: 10, LastModified: new Date('2024-01-01') },
        { Key: 'docs/b.txt', Size: 20, LastModified: new Date('2024-01-02') },
      ],
      IsTruncated: false,
    });
    const d = new S3Driver({ client, bucket: 'b' });
    const result = await d.list('docs/', { delimiter: '/' });
    expect(result.folders).toEqual(['docs/sub/']);
    expect(result.files).toHaveLength(2);
    expect(result.files[0]).toMatchObject({ key: 'docs/a.txt', name: 'a.txt', sizeBytes: 10 });
    expect(result.files[1]).toMatchObject({ key: 'docs/b.txt', name: 'b.txt', sizeBytes: 20 });
    expect(result.cursor).toBeUndefined();
  });

  it('list passes cursor and limit and returns next cursor when truncated', async () => {
    mock.on(ListObjectsV2Command).resolves({
      CommonPrefixes: [],
      Contents: [{ Key: 'docs/a.txt', Size: 5, LastModified: new Date() }],
      IsTruncated: true,
      NextContinuationToken: 'tok-next',
    });
    const d = new S3Driver({ client, bucket: 'b' });
    const result = await d.list('docs/', { cursor: 'tok-prev', limit: 1 });
    const calls = mock.commandCalls(ListObjectsV2Command);
    expect(calls[0]?.args[0].input).toMatchObject({ ContinuationToken: 'tok-prev', MaxKeys: 1 });
    expect(result.cursor).toBe('tok-next');
  });

  it('list uses bucket override from options', async () => {
    mock
      .on(ListObjectsV2Command)
      .resolves({ CommonPrefixes: [], Contents: [], IsTruncated: false });
    const d = new S3Driver({ client, bucket: 'default-bucket' });
    await d.list('docs/', { bucket: 'other-bucket' });
    const calls = mock.commandCalls(ListObjectsV2Command);
    expect(calls[0]?.args[0].input).toMatchObject({ Bucket: 'other-bucket' });
  });

  describe('multipart', () => {
    it('createMultipartUpload returns the uploadId from S3', async () => {
      mock.on(CreateMultipartUploadCommand).resolves({ UploadId: 'u1' });
      const d = new S3Driver({ client, bucket: 'b' });
      const result = await d.createMultipartUpload('video.mp4', { contentType: 'video/mp4' });
      expect(result).toEqual({ uploadId: 'u1' });
      expect(mock.commandCalls(CreateMultipartUploadCommand)[0]?.args[0].input).toMatchObject({
        Bucket: 'b',
        Key: 'video.mp4',
        ContentType: 'video/mp4',
      });
    });

    it('createMultipartUpload throws when S3 returns no UploadId', async () => {
      mock.on(CreateMultipartUploadCommand).resolves({});
      const d = new S3Driver({ client, bucket: 'b' });
      await expect(d.createMultipartUpload('video.mp4')).rejects.toThrow(
        'S3 did not return an UploadId',
      );
    });

    it('presignUploadPart returns a non-empty signed URL string', async () => {
      const d = new S3Driver({ client: makeClient(), bucket: 'b' });
      const url = await d.presignUploadPart('video.mp4', 'u1', 1, 600);
      expect(typeof url).toBe('string');
      expect(url.length).toBeGreaterThan(0);
      expect(url).toContain('X-Amz-Signature=');
    });

    it('completeMultipartUpload sends the command with mapped Parts and UploadId', async () => {
      mock.on(CompleteMultipartUploadCommand).resolves({});
      const d = new S3Driver({ client, bucket: 'b', keyPrefix: 'up' });
      await d.completeMultipartUpload('video.mp4', 'u1', [
        { partNumber: 1, etag: 'etag1' },
        { partNumber: 2, etag: 'etag2' },
      ]);
      expect(mock.commandCalls(CompleteMultipartUploadCommand)[0]?.args[0].input).toMatchObject({
        Bucket: 'b',
        Key: 'up/video.mp4',
        UploadId: 'u1',
        MultipartUpload: {
          Parts: [
            { PartNumber: 1, ETag: 'etag1' },
            { PartNumber: 2, ETag: 'etag2' },
          ],
        },
      });
    });

    it('abortMultipartUpload sends AbortMultipartUploadCommand with UploadId', async () => {
      mock.on(AbortMultipartUploadCommand).resolves({});
      const d = new S3Driver({ client, bucket: 'b', keyPrefix: 'up' });
      await d.abortMultipartUpload('video.mp4', 'u1');
      expect(mock.commandCalls(AbortMultipartUploadCommand)[0]?.args[0].input).toMatchObject({
        Bucket: 'b',
        Key: 'up/video.mp4',
        UploadId: 'u1',
      });
    });

    it('uploadPart sends UploadPartCommand and returns the ETag', async () => {
      mock.on(UploadPartCommand).resolves({ ETag: '"etag-1"' });
      const d = new S3Driver({ client, bucket: 'b' });
      const part = await d.uploadPart('videos/clip.bin', 'upload-123', 1, Buffer.from('abc'));
      expect(part).toEqual({ partNumber: 1, etag: '"etag-1"' });
      const call = mock.commandCalls(UploadPartCommand)[0]?.args[0].input;
      expect(call).toMatchObject({ UploadId: 'upload-123', PartNumber: 1 });
    });

    it('uploadPart throws when S3 returns no ETag', async () => {
      mock.on(UploadPartCommand).resolves({});
      const d = new S3Driver({ client, bucket: 'b' });
      await expect(
        d.uploadPart('videos/clip.bin', 'upload-123', 1, Buffer.from('abc')),
      ).rejects.toThrow('S3 did not return an ETag for the uploaded part');
    });
  });
});

const s3Mock = mockClient(S3Client);
beforeEach(() => s3Mock.reset());

describe('S3Driver.deleteMany', () => {
  it('chunks into batches of 1000 DeleteObjects', async () => {
    s3Mock.on(DeleteObjectsCommand).resolves({});
    const driver = new S3Driver({ client: new S3Client({ region: 'us-east-1' }), bucket: 'b' });
    const keys = Array.from({ length: 1001 }, (_, i) => `k/${i}`);
    await driver.deleteMany(keys);
    const calls = s3Mock.commandCalls(DeleteObjectsCommand);
    expect(calls.length).toBe(2);
    expect(calls[0].args[0].input.Delete?.Objects?.length).toBe(1000);
    expect(calls[1].args[0].input.Delete?.Objects?.length).toBe(1);
  });

  it('is a no-op on an empty array', async () => {
    s3Mock.on(DeleteObjectsCommand).resolves({});
    const driver = new S3Driver({ client: new S3Client({ region: 'us-east-1' }), bucket: 'b' });
    await driver.deleteMany([]);
    expect(s3Mock.commandCalls(DeleteObjectsCommand).length).toBe(0);
  });
});
