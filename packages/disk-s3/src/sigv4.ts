import { createHash, createHmac } from 'node:crypto';

/** AWS credentials. A session token comes with temporary credentials (STS, SSO, IRSA). */
export interface SigV4Credentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

export const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
export const UNSIGNED_PAYLOAD = 'UNSIGNED-PAYLOAD';

export function sha256Hex(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

/** RFC 3986 unreserved characters stay; everything else is percent-encoded as UTF-8. */
export function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/** A key as a URL path: each segment encoded, the slashes kept (S3 doesn't normalize paths). */
export function encodeKeyPath(key: string): string {
  return key.split('/').map(encodeRfc3986).join('/');
}

/** `20130524T000000Z` */
export function amzDate(date: Date): string {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, '');
}

function canonicalQuery(pairs: Array<[string, string]>): string {
  return pairs
    .map(([name, value]) => [encodeRfc3986(name), encodeRfc3986(value)] as const)
    .sort(([a, av], [b, bv]) => (a < b ? -1 : a > b ? 1 : av < bv ? -1 : av > bv ? 1 : 0))
    .map(([name, value]) => `${name}=${value}`)
    .join('&');
}

function signingKey(secret: string, date: string, region: string, service: string): Buffer {
  const kDate = createHmac('sha256', `AWS4${secret}`).update(date).digest();
  const kRegion = createHmac('sha256', kDate).update(region).digest();
  const kService = createHmac('sha256', kRegion).update(service).digest();
  return createHmac('sha256', kService).update('aws4_request').digest();
}

interface SignInput {
  method: string;
  url: URL;
  /** Lowercase names. `host` is added. */
  headers: Record<string, string>;
  payloadHash: string;
  credentials: SigV4Credentials;
  region: string;
  date: Date;
  service?: string;
}

function sign(input: SignInput, extraQuery: Array<[string, string]> = []) {
  const service = input.service ?? 's3';
  const stamp = amzDate(input.date);
  const day = stamp.slice(0, 8);
  const scope = `${day}/${input.region}/${service}/aws4_request`;
  const headers: Record<string, string> = { host: input.url.host, ...input.headers };
  const names = Object.keys(headers).sort();
  const canonicalHeaders = names
    .map((name) => `${name}:${String(headers[name]).trim().replace(/\s+/g, ' ')}\n`)
    .join('');
  const signedHeaders = names.join(';');
  const query: Array<[string, string]> = [...input.url.searchParams.entries(), ...extraQuery];
  const request = [
    input.method,
    input.url.pathname,
    canonicalQuery(query),
    canonicalHeaders,
    signedHeaders,
    input.payloadHash,
  ].join('\n');
  const toSign = ['AWS4-HMAC-SHA256', stamp, scope, sha256Hex(request)].join('\n');
  const signature = createHmac(
    'sha256',
    signingKey(input.credentials.secretAccessKey, day, input.region, service),
  )
    .update(toSign)
    .digest('hex');
  return { stamp, scope, signedHeaders, signature, headers };
}

/** Header-based SigV4: the headers to send, `authorization` included. */
export function signRequest(
  input: Omit<SignInput, 'headers'> & { headers?: Record<string, string> },
) {
  const headers: Record<string, string> = {
    ...(input.headers ?? {}),
    'x-amz-content-sha256': input.payloadHash,
    'x-amz-date': amzDate(input.date),
    ...(input.credentials.sessionToken
      ? { 'x-amz-security-token': input.credentials.sessionToken }
      : {}),
  };
  const signed = sign({ ...input, headers });
  const { host: _host, ...rest } = signed.headers;
  return {
    ...rest,
    authorization: `AWS4-HMAC-SHA256 Credential=${input.credentials.accessKeyId}/${signed.scope}, SignedHeaders=${signed.signedHeaders}, Signature=${signed.signature}`,
  };
}

/** Query-string SigV4 (a presigned URL), with an unsigned payload. */
export function presignUrl(input: {
  method: string;
  url: URL;
  expiresInSeconds: number;
  credentials: SigV4Credentials;
  region: string;
  date: Date;
  service?: string;
}): URL {
  const service = input.service ?? 's3';
  const stamp = amzDate(input.date);
  const scope = `${stamp.slice(0, 8)}/${input.region}/${service}/aws4_request`;
  const url = new URL(input.url);
  const query: Array<[string, string]> = [
    ['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'],
    ['X-Amz-Credential', `${input.credentials.accessKeyId}/${scope}`],
    ['X-Amz-Date', stamp],
    ['X-Amz-Expires', String(input.expiresInSeconds)],
    ...(input.credentials.sessionToken
      ? ([['X-Amz-Security-Token', input.credentials.sessionToken]] as Array<[string, string]>)
      : []),
    ['X-Amz-SignedHeaders', 'host'],
  ];
  const { signature } = sign({ ...input, headers: {}, payloadHash: UNSIGNED_PAYLOAD }, query);
  const all = [...url.searchParams.entries(), ...query, ['X-Amz-Signature', signature]] as Array<
    [string, string]
  >;
  url.search = all.map(([n, v]) => `${encodeRfc3986(n)}=${encodeRfc3986(v)}`).join('&');
  return url;
}
