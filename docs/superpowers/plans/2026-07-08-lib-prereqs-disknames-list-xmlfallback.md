# Phase 0.5 — Library prerequisites (`MediaService.diskNames` + `S3Driver.list` xml-fallback) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the two library primitives flip's Phase 1 migration needs so flip can inject `MediaService` directly (no DI token) and route `ListObjectsV2` through the driver without losing its fast-xml-parser fallback.

**Architecture:** (1) `MediaService.diskNames()` delegates to the Phase-0 `StorageManager.diskNames()`. (2) `S3Driver.list()` catches the fast-xml-parser v5 entity-deserialization error and retries via a SigV4-signed raw GET, parsing the `ListObjectsV2` XML manually into the same `ListResult` shape. Logic is ported from flip's proven `s3-xml-fallback.util.ts`.

**Tech Stack:** TypeScript, pnpm workspaces, vitest, biome, changesets, `@aws-sdk/client-s3`, `@smithy/signature-v4`, `@smithy/protocol-http`, `@aws-crypto/sha256-js`.

## Global Constraints

- Both package bumps are **patch**; the `0.x` line is preserved. Verify the changesets are patch and `npx changeset status` shows **0 minor, 0 major**.
- New disk-s3 runtime deps pinned exactly: `@smithy/signature-v4` `5.3.14`, `@smithy/protocol-http` `5.3.14`, `@aws-crypto/sha256-js` `5.2.0` (the versions flip runs, matching `@aws-sdk/client-s3` 3.726.1).
- Biome: no `!` non-null assertions; casts kept minimal (this repo's biome has `noExplicitAny` off, so a narrow `as unknown as` stub in a test is acceptable).
- The fallback triggers **only** inside `S3Driver.list()` on `isXmlEntityDeserializationError`; the happy path is unchanged. No other driver method is touched.
- Release via CI (changesets action on merge). Do NOT `npm publish` by hand.
- TDD. Frequent commits. Conventional commits. No Claude attribution.

## File Structure

- `packages/nestjs/src/media.service.ts` — add `diskNames()`.
- `packages/nestjs/src/media.service.spec.ts` — test it (create if absent).
- `packages/disk-s3/src/xml-fallback.ts` — ported pure helpers + signed GET (new file).
- `packages/disk-s3/src/xml-fallback.spec.ts` — ported pure-function tests (new file).
- `packages/disk-s3/src/s3-driver.ts` — wrap `list()` with the fallback.
- `packages/disk-s3/src/s3-driver.spec.ts` — add the list-fallback integration test.
- `packages/disk-s3/package.json` — add the three runtime deps.
- `.changeset/*.md` — one patch changeset per package.

---

### Task 1: `MediaService.diskNames()`

**Files:**
- Modify: `packages/nestjs/src/media.service.ts`
- Test: `packages/nestjs/src/media.service.spec.ts` (create if absent)
- Create: `.changeset/media-service-disknames.md`

**Interfaces:**
- Consumes: `StorageManager.diskNames(): string[]` (Phase 0, already published in core 0.6.2).
- Produces: `MediaService.diskNames(): string[]`.

- [ ] **Step 1: Write the failing test** — create `packages/nestjs/src/media.service.spec.ts` (or append if it exists):

```ts
import type { AttachmentManager, StorageManager } from '@dudousxd/nestjs-media-core';
import { describe, expect, it } from 'vitest';
import { MediaService } from './media.service';

describe('MediaService.diskNames', () => {
  it('delegates to the storage manager', () => {
    const manager = { diskNames: () => ['pribuy', 'files'] } as unknown as StorageManager;
    const service = new MediaService(manager, null, null, {} as AttachmentManager, null);
    expect(service.diskNames()).toEqual(['pribuy', 'files']);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/nestjs/src/media.service.spec.ts`
Expected: FAIL — `service.diskNames is not a function`.

- [ ] **Step 3: Implement** — in `packages/nestjs/src/media.service.ts`, add this method to `MediaService` (right after `disk()`):

```ts
  /** Names of the configured disks (delegates to the storage manager). */
  diskNames(): string[] {
    return this.manager.diskNames();
  }
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run packages/nestjs/src/media.service.spec.ts`
Expected: PASS.
Run: `pnpm --filter @dudousxd/nestjs-media typecheck`
Expected: exit 0.

- [ ] **Step 5: Add the changeset** — create `.changeset/media-service-disknames.md`:

```md
---
"@dudousxd/nestjs-media": patch
---

Add `MediaService.diskNames()` (delegates to `StorageManager.diskNames()`), so hosts can enumerate configured disks through the injectable `MediaService` without the `MEDIA_STORAGE` token.
```

- [ ] **Step 6: Commit**

```bash
git add packages/nestjs/src/media.service.ts packages/nestjs/src/media.service.spec.ts .changeset/media-service-disknames.md
git commit -m "feat(nestjs): MediaService.diskNames() delegate"
```

---

### Task 2: `S3Driver.list()` fast-xml-parser fallback

**Files:**
- Create: `packages/disk-s3/src/xml-fallback.ts`
- Create: `packages/disk-s3/src/xml-fallback.spec.ts`
- Modify: `packages/disk-s3/src/s3-driver.ts` (the `list()` method)
- Modify: `packages/disk-s3/src/s3-driver.spec.ts` (add integration test)
- Modify: `packages/disk-s3/package.json` (three runtime deps)
- Create: `.changeset/s3-driver-list-xml-fallback.md`

**Interfaces:**
- Consumes: `ListResult`, `ListEntry` from core; `S3Client` from `@aws-sdk/client-s3`.
- Produces: `isXmlEntityDeserializationError(error): boolean`, `signedS3Get(client, options): Promise<string>`, `extractListObjectsV2FromXml(xml): ListObjectsV2FromXml`, `decodeXmlEntities(value): string`. `S3Driver.list()` now falls back on the entity error and still returns a `ListResult`.

- [ ] **Step 1: Add the three runtime deps** to `packages/disk-s3/package.json`. Add a `dependencies` block (the package currently has only `peerDependencies` + `devDependencies`):

```json
  "dependencies": {
    "@aws-crypto/sha256-js": "5.2.0",
    "@smithy/protocol-http": "5.3.14",
    "@smithy/signature-v4": "5.3.14"
  },
```

Then run `pnpm install` (from repo root) and confirm it resolves.

- [ ] **Step 2: Write the failing helper tests** — create `packages/disk-s3/src/xml-fallback.spec.ts`:

```ts
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
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run packages/disk-s3/src/xml-fallback.spec.ts`
Expected: FAIL — cannot find module `./xml-fallback`.

- [ ] **Step 4: Create `packages/disk-s3/src/xml-fallback.ts`** (ported from flip's `s3-xml-fallback.util.ts`, minus the ListBuckets helper which Phase 1 replaces with `diskNames`):

```ts
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
export async function signedS3Get(client: S3Client, options: SignedS3GetOptions = {}): Promise<string> {
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
    Object.keys(cleanedQuery).length > 0
      ? `?${new URLSearchParams(cleanedQuery).toString()}`
      : '';
  const response = await fetch(`https://${hostname}${pathname}${search}`, {
    method: 'GET',
    headers: signed.headers,
  });
  if (!response.ok) {
    throw new Error(`Signed S3 GET ${pathname} failed: HTTP ${response.status} ${response.statusText}`);
  }
  return response.text();
}

export function decodeXmlEntities(value: string): string {
  return value
    .replace(/&#x([0-9A-Fa-f]+);/g, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number.parseInt(dec, 10)))
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
  ).map((match) => decodeXmlEntities(match[1]));

  const objects: ListObjectsV2Entry[] = matchAll(xml, /<Contents>([\s\S]*?)<\/Contents>/g).map(
    (match) => {
      const block = match[1];
      const keyMatch = block.match(/<Key>([\s\S]*?)<\/Key>/);
      const sizeMatch = block.match(/<Size>([\s\S]*?)<\/Size>/);
      const lastModifiedMatch = block.match(/<LastModified>([\s\S]*?)<\/LastModified>/);
      return {
        key: keyMatch ? decodeXmlEntities(keyMatch[1]) : '',
        size: sizeMatch ? Number(sizeMatch[1]) : 0,
        lastModified: lastModifiedMatch ? decodeXmlEntities(lastModifiedMatch[1]) : null,
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
      ? decodeXmlEntities(nextContinuationTokenMatch[1])
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
```

- [ ] **Step 5: Run the helper tests to verify they pass**

Run: `npx vitest run packages/disk-s3/src/xml-fallback.spec.ts`
Expected: PASS.

- [ ] **Step 6: Wrap `S3Driver.list()`** in `packages/disk-s3/src/s3-driver.ts`. Add the import:

```ts
import {
  extractListObjectsV2FromXml,
  isXmlEntityDeserializationError,
  signedS3Get,
} from './xml-fallback';
```

Replace the body of `list()` so the existing SDK path is tried first, and the fallback runs only on the entity error (keep the happy-path mapping exactly as-is):

```ts
  async list(prefix: string, options?: ListOptions): Promise<ListResult> {
    const bucket = options?.bucket ?? this.bucket;
    const fullPrefix = this.key(prefix);
    try {
      const out = await this.client.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: fullPrefix,
          Delimiter: options?.delimiter ?? '/',
          MaxKeys: options?.limit,
          ContinuationToken: options?.cursor,
        }),
      );
      const folders = (out.CommonPrefixes ?? [])
        .map((commonPrefix) => commonPrefix.Prefix)
        .filter((value): value is string => typeof value === 'string');
      const files: ListEntry[] = (out.Contents ?? [])
        .filter((object) => object.Key !== undefined && object.Key !== fullPrefix)
        .map((object) => {
          const key = object.Key as string;
          return {
            key,
            name: key.slice(fullPrefix.length),
            sizeBytes: object.Size ?? null,
            lastModified: object.LastModified ?? null,
          };
        });
      const result: ListResult = { folders, files };
      if (out.IsTruncated && out.NextContinuationToken !== undefined) {
        result.cursor = out.NextContinuationToken;
      }
      return result;
    } catch (err) {
      if (!isXmlEntityDeserializationError(err)) throw err;
      // fast-xml-parser rejected valid entity refs in the ListObjectsV2 XML —
      // re-issue a signed raw GET and parse it by hand into the same shape.
      const xml = await signedS3Get(this.client, {
        bucket,
        query: {
          'list-type': '2',
          prefix: fullPrefix,
          delimiter: options?.delimiter ?? '/',
          'max-keys': options?.limit !== undefined ? String(options.limit) : undefined,
          'continuation-token': options?.cursor,
        },
      });
      const parsed = extractListObjectsV2FromXml(xml);
      const files: ListEntry[] = parsed.objects
        .filter((object) => object.key !== fullPrefix)
        .map((object) => ({
          key: object.key,
          name: object.key.slice(fullPrefix.length),
          sizeBytes: object.size,
          lastModified: object.lastModified ? new Date(object.lastModified) : null,
        }));
      const result: ListResult = { folders: parsed.folders, files };
      if (parsed.isTruncated && parsed.nextContinuationToken) {
        result.cursor = parsed.nextContinuationToken;
      }
      return result;
    }
  }
```

- [ ] **Step 7: Write the list-fallback integration test** — append to `packages/disk-s3/src/s3-driver.spec.ts`:

```ts
import { ListObjectsV2Command } from '@aws-sdk/client-s3';
import { afterEach, vi } from 'vitest';

describe('S3Driver.list fallback', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('falls back to a signed GET when fast-xml-parser rejects the XML', async () => {
    s3Mock.reset();
    s3Mock.on(ListObjectsV2Command).rejects(new Error('EntityReplacer: Invalid character in entity name'));
    const xml =
      '<ListBucketResult><CommonPrefixes><Prefix>sub/</Prefix></CommonPrefixes>' +
      '<Contents><Key>sub/f.txt</Key><Size>3</Size><LastModified>2026-01-01T00:00:00.000Z</LastModified></Contents>' +
      '<IsTruncated>false</IsTruncated></ListBucketResult>';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, status: 200, statusText: 'OK', text: async () => xml }) as unknown as Response),
    );

    const client = new S3Client({
      region: 'us-east-1',
      credentials: { accessKeyId: 'a', secretAccessKey: 'b' },
    });
    const driver = new S3Driver({ client, bucket: 'b' });
    const result = await driver.list('sub/');
    expect(result.folders).toEqual(['sub/']);
    expect(result.files).toEqual([
      { key: 'sub/f.txt', name: 'f.txt', sizeBytes: 3, lastModified: new Date('2026-01-01T00:00:00.000Z') },
    ]);
    expect(result.cursor).toBeUndefined();
  });
});
```

(This reuses the `s3Mock` declared at the top of `s3-driver.spec.ts` in Phase 0's Task 2. If the file's imports do not yet include `S3Client`/`vi`/`afterEach`, add them.)

- [ ] **Step 8: Run the disk-s3 unit tests + typecheck**

Run: `npx vitest run packages/disk-s3/src/xml-fallback.spec.ts packages/disk-s3/src/s3-driver.spec.ts`
Expected: PASS (helper tests + the fallback integration).
Run: `pnpm --filter @dudousxd/nestjs-media-disk-s3 typecheck`
Expected: exit 0.
Run: `npx biome check --write packages/disk-s3/src/xml-fallback.ts packages/disk-s3/src/xml-fallback.spec.ts packages/disk-s3/src/s3-driver.ts packages/disk-s3/src/s3-driver.spec.ts`
Expected: clean.

- [ ] **Step 9: Confirm the MinIO happy-path still works** (the fallback must not disturb normal `list()`):

Run: `npx vitest run --config vitest.db.config.ts packages/disk-s3/src/s3-driver.db.spec.ts`
Expected: PASS (Docker required).

- [ ] **Step 10: Add the changeset** — create `.changeset/s3-driver-list-xml-fallback.md`:

```md
---
"@dudousxd/nestjs-media-disk-s3": patch
---

`S3Driver.list()` now falls back to a SigV4-signed raw GET + manual XML parse when fast-xml-parser rejects valid entity references in the `ListObjectsV2` response (a failure mode for consumers pinning fast-xml-parser >= 5.7). Happy path unchanged.
```

- [ ] **Step 11: Commit**

```bash
git add packages/disk-s3/src/xml-fallback.ts packages/disk-s3/src/xml-fallback.spec.ts packages/disk-s3/src/s3-driver.ts packages/disk-s3/src/s3-driver.spec.ts packages/disk-s3/package.json .changeset/s3-driver-list-xml-fallback.md pnpm-lock.yaml
git commit -m "feat(disk-s3): list() fast-xml-parser fallback via signed GET"
```

---

### Task 3: Whole-suite verification + changeset audit

**Files:** none (verification only).

- [ ] **Step 1: Build**

Run: `pnpm -r build`
Expected: all packages build.

- [ ] **Step 2: Full unit suite**

Run: `npx vitest run`
Expected: all green.

- [ ] **Step 3: Repo lint + typecheck**

Run: `npx biome check` then `pnpm -r typecheck`
Expected: biome clean; typecheck exit 0.

- [ ] **Step 4: Changeset audit — MUST be all patch**

Run: `ls .changeset/*.md` (expect `media-service-disknames.md` + `s3-driver-list-xml-fallback.md`) and confirm each frontmatter is `patch`. Run `npx changeset status` and confirm **0 minor, 0 major**.

- [ ] **Step 5: MinIO integration (Docker required)**

Run: `npx vitest run --config vitest.db.config.ts packages/disk-s3/src/s3-driver.db.spec.ts`
Expected: PASS.

(No commit — verification only. Release happens via the changesets CI action on merge; do not `npm publish`.)

---

## Self-Review

**Spec coverage:** Prereq (1) `MediaService.diskNames()` → Task 1. Prereq (2) `S3Driver.list()` fast-xml-parser fallback ported from flip's util → Task 2 (helpers + wrap + deps + tests). Both patch/0.x with changesets + Task 3 audit. The flip call-site swaps are correctly excluded (separate plan).

**Type consistency:** `ListResult`/`ListEntry` shapes in the fallback branch match the happy-path mapping exactly (`key`/`name`/`sizeBytes`/`lastModified`, `cursor` only when truncated); `lastModified` is converted to `Date` to match `ListEntry.lastModified: Date | null`. `signedS3Get`/`extractListObjectsV2FromXml`/`isXmlEntityDeserializationError`/`decodeXmlEntities` signatures are consistent between `xml-fallback.ts`, its spec, and the `list()` call site.

**Placeholder scan:** every code step contains complete code; no TBD/omissions.
