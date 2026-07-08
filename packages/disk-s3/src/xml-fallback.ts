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

/** RFC-3986 percent-encoding matching SigV4's canonical form (`@smithy/util-uri-escape`).
 *  `URLSearchParams` encodes space as `+`, which S3 canonicalizes to a literal `+` and
 *  the recomputed signature then mismatches — so encode the wire query ourselves. */
function escapeUri(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/** SigV4-signed raw GET against S3 (path-style); returns the raw body.
 *  Bypasses the SDK's XML deserialization when fast-xml-parser rejects valid input.
 *  Honors a configured `client.config.endpoint` (MinIO, Ceph, LocalStack, GovCloud/China
 *  partitions) and falls back to the regional AWS host only when none is set. */
export async function signedS3Get(
  client: S3Client,
  options: SignedS3GetOptions = {},
): Promise<string> {
  const credentials = await client.config.credentials();
  const region = await client.config.region();

  let protocol = 'https:';
  let hostname = `s3.${region}.amazonaws.com`;
  let port: number | undefined;
  let basePath = '';
  const endpointProvider = client.config.endpoint;
  if (typeof endpointProvider === 'function') {
    const endpoint = await endpointProvider();
    protocol = endpoint.protocol;
    hostname = endpoint.hostname;
    port = endpoint.port;
    basePath = endpoint.path === '/' ? '' : endpoint.path.replace(/\/+$/, '');
  }
  const hostHeader = port === undefined ? hostname : `${hostname}:${port}`;
  const pathname = `${basePath}${options.bucket ? `/${options.bucket}/` : '/'}`;

  const cleanedQuery: Record<string, string> = {};
  for (const [name, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined && value !== null && value !== '') cleanedQuery[name] = value;
  }

  const signer = new SignatureV4({ credentials, region, service: 's3', sha256: Sha256 });
  const request = new HttpRequest({
    method: 'GET',
    protocol,
    hostname,
    ...(port === undefined ? {} : { port }),
    path: pathname,
    query: cleanedQuery,
    headers: { host: hostHeader },
  });
  const signed = await signer.sign(request);

  const search =
    Object.keys(cleanedQuery).length > 0
      ? `?${Object.entries(cleanedQuery)
          .map(([name, value]) => `${escapeUri(name)}=${escapeUri(value)}`)
          .join('&')}`
      : '';
  const response = await fetch(`${protocol}//${hostHeader}${pathname}${search}`, {
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
  size: number | null;
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
        size: sizeMatch ? Number(sizeMatch[1]) : null,
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
