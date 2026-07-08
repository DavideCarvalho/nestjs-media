import { S3Client } from '@aws-sdk/client-s3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  decodeXmlEntities,
  extractListObjectsV2FromXml,
  isXmlEntityDeserializationError,
  signedS3Get,
} from './xml-fallback';

function stubFetch(): { calls: Array<{ url: string; headers: Record<string, string> }> } {
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: { headers: Record<string, string> }) => {
      calls.push({ url, headers: init.headers });
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () => '<ListBucketResult></ListBucketResult>',
      } as unknown as Response;
    }),
  );
  return { calls };
}

const creds = { accessKeyId: 'AKIA', secretAccessKey: 'secret' };

describe('isXmlEntityDeserializationError', () => {
  it('matches fast-xml-parser v5 entity errors', () => {
    expect(isXmlEntityDeserializationError(new Error('EntityReplacer failed'))).toBe(true);
    expect(isXmlEntityDeserializationError(new Error('Invalid character in entity name'))).toBe(
      true,
    );
    expect(isXmlEntityDeserializationError(new Error('some other error'))).toBe(false);
    expect(isXmlEntityDeserializationError('not an error')).toBe(false);
  });
});

describe('signedS3Get', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('targets the regional AWS host (path-style) and signs the request', async () => {
    const { calls } = stubFetch();
    const client = new S3Client({ region: 'us-east-1', credentials: creds });
    await signedS3Get(client, { bucket: 'my-bucket', query: { 'list-type': '2' } });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://s3.us-east-1.amazonaws.com/my-bucket/?list-type=2');
    expect(calls[0]?.headers.authorization).toContain('AWS4-HMAC-SHA256');
    expect(calls[0]?.headers.host).toBe('s3.us-east-1.amazonaws.com');
  });

  it('honors a configured custom endpoint (MinIO/Ceph) with host:port', async () => {
    const { calls } = stubFetch();
    const client = new S3Client({
      region: 'us-east-1',
      credentials: creds,
      endpoint: 'http://localhost:9000',
    });
    await signedS3Get(client, { bucket: 'my-bucket', query: { 'list-type': '2' } });
    expect(calls[0]?.url).toBe('http://localhost:9000/my-bucket/?list-type=2');
    expect(calls[0]?.headers.host).toBe('localhost:9000');
  });

  it('encodes spaces as %20 and preserves continuation-token bytes', async () => {
    const { calls } = stubFetch();
    const client = new S3Client({ region: 'us-east-1', credentials: creds });
    await signedS3Get(client, {
      bucket: 'b',
      query: { prefix: 'my docs/', 'continuation-token': 'a+b/c=' },
    });
    const url = calls[0]?.url ?? '';
    expect(url).toContain('prefix=my%20docs%2F');
    expect(url).toContain('continuation-token=a%2Bb%2Fc%3D');
    expect(url).not.toContain('+');
  });

  it('drops empty/undefined query params', async () => {
    const { calls } = stubFetch();
    const client = new S3Client({ region: 'us-east-1', credentials: creds });
    await signedS3Get(client, { bucket: 'b', query: { 'list-type': '2', 'max-keys': undefined } });
    expect(calls[0]?.url).toBe('https://s3.us-east-1.amazonaws.com/b/?list-type=2');
  });
});

describe('decodeXmlEntities', () => {
  it('decodes numeric and named refs, &amp; last', () => {
    expect(decodeXmlEntities('a&#xD;b')).toBe('a\rb');
    expect(decodeXmlEntities('&lt;tag&gt;')).toBe('<tag>');
    expect(decodeXmlEntities('&amp;lt;')).toBe('&lt;');
  });
});

describe('extractListObjectsV2FromXml', () => {
  it('parses folders, objects and pagination', () => {
    const xml = `<?xml version="1.0"?><ListBucketResult>
      <CommonPrefixes><Prefix>docs/</Prefix></CommonPrefixes>
      <Contents><Key>a&#x2F;b.txt</Key><Size>12</Size><LastModified>2026-01-01T00:00:00.000Z</LastModified></Contents>
      <IsTruncated>true</IsTruncated>
      <NextContinuationToken>tok123</NextContinuationToken>
    </ListBucketResult>`;
    const parsed = extractListObjectsV2FromXml(xml);
    expect(parsed.folders).toEqual(['docs/']);
    expect(parsed.objects).toEqual([
      { key: 'a/b.txt', size: 12, lastModified: '2026-01-01T00:00:00.000Z' },
    ]);
    expect(parsed.isTruncated).toBe(true);
    expect(parsed.nextContinuationToken).toBe('tok123');
  });

  it('yields size null when <Size> is absent (matches happy-path Size ?? null)', () => {
    const xml =
      '<ListBucketResult><Contents><Key>k.txt</Key>' +
      '<LastModified>2026-01-01T00:00:00.000Z</LastModified></Contents></ListBucketResult>';
    expect(extractListObjectsV2FromXml(xml).objects[0]?.size).toBeNull();
  });
});
