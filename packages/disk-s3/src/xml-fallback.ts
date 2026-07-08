import { Sha256 } from '@aws-crypto/sha256-js';
import type { S3Client } from '@aws-sdk/client-s3';
import { HttpRequest } from '@smithy/protocol-http';
import { SignatureV4 } from '@smithy/signature-v4';

// fast-xml-parser v5 (pinned by some hosts for CVE remediation) rejects valid
// numeric character references (`&#xD;`, ...) in S3 XML that the AWS SDK parses.
const ENTITY_NAME_REGEX = /Invalid character.*entity name/i;

export function isXmlEntityDeserializationError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message ?? '';
  return (
    message.includes('EntityReplacer') ||
    message.includes('Deserialization') ||
    ENTITY_NAME_REGEX.test(message)
  );
}

export interface SignedS3GetOptions {
  bucket?: string;
  query?: Record<string, string | undefined>;
}

/** SigV4-signed raw GET against the regional S3 endpoint; returns the raw body.
 *  Bypasses the SDK's XML deserialization when fast-xml-parser rejects valid input. */
export async function signedS3Get(
  client: S3Client,
  options: SignedS3GetOptions = {},
): Promise<string> {
  const credentials = await client.config.credentials();
  const region = await client.config.region();
  const hostname = `s3.${region}.amazonaws.com`;
  const pathname = options.bucket ? `/${options.bucket}/` : '/';

  const cleanedQuery: Record<string, string> = {};
  for (const [name, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined && value !== null && value !== '') cleanedQuery[name] = value;
  }

  const signer = new SignatureV4({ credentials, region, service: 's3', sha256: Sha256 });
  const request = new HttpRequest({
    method: 'GET',
    protocol: 'https:',
    hostname,
    path: pathname,
    query: cleanedQuery,
    headers: { host: hostname },
  });
  const signed = await signer.sign(request);

  const search =
    Object.keys(cleanedQuery).length > 0 ? `?${new URLSearchParams(cleanedQuery).toString()}` : '';
  const response = await fetch(`https://${hostname}${pathname}${search}`, {
    method: 'GET',
    headers: signed.headers,
  });
  if (!response.ok) {
    throw new Error(
      `Signed S3 GET ${pathname} failed: HTTP ${response.status} ${response.statusText}`,
    );
  }
  return response.text();
}

export function decodeXmlEntities(value: string): string {
  return value
    .replace(/&#x([0-9A-Fa-f]+);/g, (_match, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_match, dec) => String.fromCodePoint(Number.parseInt(dec, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

export interface ListObjectsV2Entry {
  key: string;
  size: number;
  lastModified: string | null;
}

export interface ListObjectsV2FromXml {
  folders: string[];
  objects: ListObjectsV2Entry[];
  nextContinuationToken: string | null;
  isTruncated: boolean;
}

export function extractListObjectsV2FromXml(xml: string): ListObjectsV2FromXml {
  const folders = matchAll(
    xml,
    /<CommonPrefixes>[\s\S]*?<Prefix>([\s\S]*?)<\/Prefix>[\s\S]*?<\/CommonPrefixes>/g,
  ).map((match) => decodeXmlEntities(match[1] ?? ''));

  const objects: ListObjectsV2Entry[] = matchAll(xml, /<Contents>([\s\S]*?)<\/Contents>/g).map(
    (match) => {
      const block = match[1] ?? '';
      const keyMatch = block.match(/<Key>([\s\S]*?)<\/Key>/);
      const sizeMatch = block.match(/<Size>([\s\S]*?)<\/Size>/);
      const lastModifiedMatch = block.match(/<LastModified>([\s\S]*?)<\/LastModified>/);
      return {
        key: keyMatch ? decodeXmlEntities(keyMatch[1] ?? '') : '',
        size: sizeMatch ? Number(sizeMatch[1]) : 0,
        lastModified: lastModifiedMatch ? decodeXmlEntities(lastModifiedMatch[1] ?? '') : null,
      };
    },
  );

  const nextContinuationTokenMatch = xml.match(
    /<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/,
  );
  const isTruncatedMatch = xml.match(/<IsTruncated>(true|false)<\/IsTruncated>/);

  return {
    folders,
    objects,
    nextContinuationToken: nextContinuationTokenMatch
      ? decodeXmlEntities(nextContinuationTokenMatch[1] ?? '')
      : null,
    isTruncated: isTruncatedMatch?.[1] === 'true',
  };
}

function matchAll(input: string, regex: RegExp): RegExpExecArray[] {
  const matches: RegExpExecArray[] = [];
  const localRegex = new RegExp(regex.source, regex.flags);
  let match: RegExpExecArray | null = localRegex.exec(input);
  while (match !== null) {
    matches.push(match);
    match = localRegex.exec(input);
  }
  return matches;
}
