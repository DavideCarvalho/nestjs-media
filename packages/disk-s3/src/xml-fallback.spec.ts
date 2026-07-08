import { describe, expect, it } from 'vitest';
import {
  decodeXmlEntities,
  extractListObjectsV2FromXml,
  isXmlEntityDeserializationError,
} from './xml-fallback';

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
});
