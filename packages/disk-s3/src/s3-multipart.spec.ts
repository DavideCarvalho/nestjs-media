import { describe, expect, it } from 'vitest';
import { s3Multipart } from './s3-multipart';
import { EMPTY_SHA256, presignUrl, signRequest } from './sigv4';

// The examples of AWS's "Signature Version 4 signing" documentation for S3.
const AWS_EXAMPLE = {
  credentials: {
    accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
    secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  },
  region: 'us-east-1',
  date: new Date('2013-05-24T00:00:00Z'),
};

describe('SigV4', () => {
  it('signs a header-authenticated GET like the AWS example', () => {
    const headers = signRequest({
      ...AWS_EXAMPLE,
      method: 'GET',
      url: new URL('https://examplebucket.s3.amazonaws.com/test.txt'),
      headers: { range: 'bytes=0-9' },
      payloadHash: EMPTY_SHA256,
    });
    expect(headers.authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41',
    );
  });

  it('presigns a GET like the AWS example', () => {
    const url = presignUrl({
      ...AWS_EXAMPLE,
      method: 'GET',
      url: new URL('https://examplebucket.s3.amazonaws.com/test.txt'),
      expiresInSeconds: 86400,
    });
    expect(url.searchParams.get('X-Amz-Signature')).toBe(
      'aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404',
    );
  });
});

interface Call {
  method: string;
  url: URL;
  headers: Record<string, string>;
  body?: string;
}

function fakeS3(respond: (call: Call) => Response) {
  const calls: Call[] = [];
  const fetch = (async (input: URL, init: RequestInit) => {
    const call: Call = {
      method: init.method ?? 'GET',
      url: new URL(input),
      headers: init.headers as Record<string, string>,
      ...(init.body ? { body: Buffer.from(init.body as Uint8Array).toString() } : {}),
    };
    calls.push(call);
    return respond(call);
  }) as unknown as typeof globalThis.fetch;
  return { calls, fetch };
}

const base = {
  bucket: 'media-bucket',
  region: 'us-east-1',
  credentials: { accessKeyId: 'a', secretAccessKey: 's' },
};

describe('s3Multipart', () => {
  it('addresses the same object as S3Disk: virtual-hosted, prefixed, segment-encoded', async () => {
    const s3 = fakeS3(
      () =>
        new Response(
          '<InitiateMultipartUploadResult><UploadId>u-1</UploadId></InitiateMultipartUploadResult>',
        ),
    );
    const driver = s3Multipart({ ...base, prefix: 'tenants/t1/', fetch: s3.fetch });
    const { uploadId } = await driver.createMultipartUpload('a b/c.bin', {
      contentType: 'video/mp4',
      metadata: { Owner: 'x' },
    });
    expect(uploadId).toBe('u-1');
    const [call] = s3.calls;
    expect(call?.method).toBe('POST');
    expect(call?.url.host).toBe('media-bucket.s3.us-east-1.amazonaws.com');
    expect(call?.url.pathname).toBe('/tenants/t1/a%20b/c.bin');
    expect(call?.url.search).toBe('?uploads=');
    expect(call?.headers['content-type']).toBe('video/mp4');
    expect(call?.headers['x-amz-meta-owner']).toBe('x');
    expect(call?.headers.authorization).toMatch(/^AWS4-HMAC-SHA256 /);
  });

  it('uses path style for MinIO-like endpoints', async () => {
    const s3 = fakeS3(() => new Response('', { headers: { etag: '"e1"' } }));
    const driver = s3Multipart({
      ...base,
      endpoint: 'http://127.0.0.1:9000',
      forcePathStyle: true,
      fetch: s3.fetch,
    });
    expect(await driver.uploadPart('k', 'u-1', 2, Buffer.from('xy'))).toEqual({
      partNumber: 2,
      etag: '"e1"',
    });
    expect(s3.calls[0]?.url.toString()).toBe(
      'http://127.0.0.1:9000/media-bucket/k?partNumber=2&uploadId=u-1',
    );
  });

  it('refuses a key @nestjs/storage would refuse, before any request', async () => {
    const s3 = fakeS3(() => new Response(''));
    const driver = s3Multipart({ ...base, fetch: s3.fetch });
    await expect(driver.createMultipartUpload('../x')).rejects.toThrow(/Invalid storage key/);
    expect(s3.calls).toHaveLength(0);
  });

  it('turns a 200 with an <Error> body on complete into an error', async () => {
    const s3 = fakeS3(() => new Response('<Error><Code>InternalError</Code></Error>'));
    const driver = s3Multipart({ ...base, fetch: s3.fetch });
    await expect(
      driver.completeMultipartUpload('k', 'u', [{ partNumber: 1, etag: '"e"' }]),
    ).rejects.toThrow(/InternalError/);
    expect(s3.calls[0]?.body).toBe(
      '<CompleteMultipartUpload><Part><PartNumber>1</PartNumber><ETag>&quot;e&quot;</ETag></Part></CompleteMultipartUpload>',
    );
  });

  it('abort of an upload that is already gone is not an error', async () => {
    const s3 = fakeS3(
      () => new Response('<Error><Code>NoSuchUpload</Code></Error>', { status: 404 }),
    );
    await expect(
      s3Multipart({ ...base, fetch: s3.fetch }).abortMultipartUpload('k', 'u'),
    ).resolves.toBeUndefined();
  });

  it('presigns a part URL for the browser', async () => {
    const url = new URL(await s3Multipart(base).presignUploadPart('videos/a.mp4', 'u-1', 3, 600));
    expect(url.pathname).toBe('/videos/a.mp4');
    expect(url.searchParams.get('partNumber')).toBe('3');
    expect(url.searchParams.get('uploadId')).toBe('u-1');
    expect(url.searchParams.get('X-Amz-Expires')).toBe('600');
  });

  it('lists one folder level, without the disk prefix and without a marker object', async () => {
    const s3 = fakeS3(
      () =>
        new Response(
          `<ListBucketResult><IsTruncated>true</IsTruncated><NextContinuationToken>n&amp;1</NextContinuationToken>
          <Contents><Key>p/docs/</Key><Size>0</Size><LastModified>2026-01-01T00:00:00.000Z</LastModified></Contents>
          <Contents><Key>p/docs/a&amp;b.txt</Key><Size>3</Size><LastModified>2026-01-01T00:00:00.000Z</LastModified><ETag>&quot;x&quot;</ETag></Contents>
          <CommonPrefixes><Prefix>p/docs/sub/</Prefix></CommonPrefixes>
          <CommonPrefixes><Prefix>p/docs//</Prefix></CommonPrefixes></ListBucketResult>`,
        ),
    );
    const listing = await s3Multipart({ ...base, prefix: 'p/', fetch: s3.fetch }).listFolders(
      'docs',
    );
    expect(s3.calls[0]?.url.searchParams.get('prefix')).toBe('p/docs/');
    expect(s3.calls[0]?.url.searchParams.get('delimiter')).toBe('/');
    expect(listing.folders).toEqual(['docs/sub/']);
    expect(listing.files.map((f) => [f.key, f.size, f.etag])).toEqual([['docs/a&b.txt', 3, '"x"']]);
    expect(listing.cursor).toBe('n&1');
  });
  it('asks S3 for the same page size as the folded listing: 50 by default, `limit`, 1000 at most', async () => {
    const s3 = fakeS3(
      () => new Response('<ListBucketResult><IsTruncated>false</IsTruncated></ListBucketResult>'),
    );
    const sidecar = s3Multipart({ ...base, prefix: 'p/', fetch: s3.fetch });
    await sidecar.listFolders('docs');
    await sidecar.listFolders('docs', { limit: 7 });
    await sidecar.listFolders('docs', { limit: 5000 });
    expect(s3.calls.map((call) => call.url.searchParams.get('max-keys'))).toEqual([
      '50',
      '7',
      '1000',
    ]);
    await expect(sidecar.listFolders('docs', { limit: 0 })).rejects.toThrow(RangeError);
  });
});
