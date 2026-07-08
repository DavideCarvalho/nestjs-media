# Storage primitives (`stat` / `deleteMany` / `diskNames`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three storage primitives to `@dudousxd/nestjs-media` so a host can route all direct S3 usage through the library: `StorageDriver.stat()`, `StorageDriver.deleteMany()`, and `StorageManager.diskNames()`.

**Architecture:** Two new **optional** methods on the `StorageDriver` interface (`stat?`, `deleteMany?`), implemented in the three bundled drivers (`S3Driver`, `LocalDriver`, `InMemoryDriver`), plus one concrete method on the `StorageManager` class. Optional interface members keep this non-breaking (patch, 0.x). Behavior of existing methods is untouched.

**Tech Stack:** TypeScript, pnpm workspaces, vitest, biome, changesets, `@aws-sdk/client-s3` (disk-s3), testcontainers/MinIO (disk-s3 integration tests).

## Global Constraints

- Every package bump is **patch**; the `0.x` line is preserved. Verify with `npx changeset status --since=main`: it must report **0 minor, 0 major**.
- The two new `StorageDriver` members are **optional** (`stat?(path)`, `deleteMany?(paths)`). Do not make them required — that breaks third-party drivers and forces a minor.
- **No new runtime dependencies.** `LocalDriver` content-type comes from a tiny internal extension map, not a mime package.
- Biome rules: **no `!` non-null assertions**, no casual `any`/`as` casts. Guard optional methods with an explicit `if (!driver.stat) throw ...` in shared test code.
- **Release via CI only** (changesets action on merge). Do NOT `npm publish` by hand.
- TDD: failing test first. Frequent commits. Conventional-commit messages. No Claude attribution in commits.

## File Structure

- `packages/core/src/types.ts` — add `StatResult` type; add optional `stat?`/`deleteMany?` to `StorageDriver`.
- `packages/core/src/storage-manager.ts` — add `diskNames()`.
- `packages/core/src/storage-manager.spec.ts` — test `diskNames()` (create if absent).
- `packages/disk-s3/src/s3-driver.ts` — implement `stat` (HeadObject) + `deleteMany` (DeleteObjects, chunked).
- `packages/disk-s3/src/s3-driver.spec.ts` — unit test `deleteMany` chunking via aws-sdk-client-mock (create if absent).
- `packages/disk-s3/src/stat-deletemany.db.spec.ts` — MinIO integration for `stat` + `deleteMany`.
- `packages/disk-local/src/local-driver.ts` — implement `stat` + `deleteMany`; add extension→content-type helper; alias the fs `stat` import.
- `packages/disk-local/src/local-driver.spec.ts` — test `stat` + `deleteMany`.
- `packages/testing/src/in-memory-driver.ts` — implement `stat` + `deleteMany`; add a per-key metadata map.
- `packages/testing/src/conformance.ts` — add shared `stat`/`deleteMany` assertions (runs for LocalDriver + InMemoryDriver).
- `packages/testing/src/in-memory-driver.spec.ts` — test in-memory `stat` content-type/lastModified.
- `.changeset/*.md` — one patch changeset per package touched.

---

### Task 1: Core — `StatResult`, optional interface members, `diskNames()`

**Files:**
- Modify: `packages/core/src/types.ts`
- Modify: `packages/core/src/storage-manager.ts`
- Test: `packages/core/src/storage-manager.spec.ts` (create if absent)
- Create: `.changeset/storage-primitives-core.md`

**Interfaces:**
- Produces: `StatResult` (`{ size: number; contentType?: string; lastModified?: Date }`), `StorageDriver.stat?(path: string): Promise<StatResult>`, `StorageDriver.deleteMany?(paths: string[]): Promise<void>`, `StorageManager.diskNames(): string[]`.

- [ ] **Step 1: Write the failing test** — append to `packages/core/src/storage-manager.spec.ts` (create the file with this content if it does not exist):

```ts
import { describe, expect, it } from 'vitest';
import { StorageManager } from './storage-manager';
import type { StorageDriver } from './types';

// diskNames only reads the keys of the disks record; a bare object is a sufficient
// stand-in for a StorageDriver here (no method on it is called).
const driver = {} as unknown as StorageDriver;

describe('StorageManager.diskNames', () => {
  it('returns the configured disk names', () => {
    const manager = new StorageManager({ default: 'a', disks: { a: driver, b: driver } });
    expect(manager.diskNames().sort()).toEqual(['a', 'b']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/src/storage-manager.spec.ts`
Expected: FAIL — `manager.diskNames is not a function`.

- [ ] **Step 3: Add the `StatResult` type and optional members** in `packages/core/src/types.ts`.

Add this type near the other exported interfaces (e.g. just above `StorageDriver`):

```ts
export interface StatResult {
  size: number;
  contentType?: string;
  lastModified?: Date;
}
```

Inside `export interface StorageDriver { ... }`, add these two optional members (place them after `size(path)` for readability):

```ts
  /** Object metadata (size/content-type/last-modified) without downloading the body.
   *  Optional; all bundled drivers implement it. */
  stat?(path: string): Promise<StatResult>;
  /** Delete many objects in one call. Optional; all bundled drivers implement it.
   *  An empty array is a no-op. */
  deleteMany?(paths: string[]): Promise<void>;
```

- [ ] **Step 4: Add `diskNames()`** to `packages/core/src/storage-manager.ts`, inside the `StorageManager` class (after `disk()`):

```ts
  /** Names of the configured disks. */
  diskNames(): string[] {
    return Object.keys(this.disks);
  }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run packages/core/src/storage-manager.spec.ts`
Expected: PASS (1 test).
Run: `pnpm --filter @dudousxd/nestjs-media-core typecheck`
Expected: exit 0.

- [ ] **Step 6: Add the changeset** — create `.changeset/storage-primitives-core.md`:

```md
---
"@dudousxd/nestjs-media-core": patch
---

Add `StatResult` and optional `StorageDriver.stat()` / `StorageDriver.deleteMany()` members, plus `StorageManager.diskNames()`. Optional members keep this non-breaking.
```

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/types.ts packages/core/src/storage-manager.ts packages/core/src/storage-manager.spec.ts .changeset/storage-primitives-core.md
git commit -m "feat(core): StatResult + optional stat/deleteMany members + diskNames()"
```

---

### Task 2: disk-s3 — `stat` + `deleteMany`

**Files:**
- Modify: `packages/disk-s3/src/s3-driver.ts`
- Test: `packages/disk-s3/src/s3-driver.spec.ts` (create if absent) — chunking unit test via `aws-sdk-client-mock` (already a devDep)
- Create: `packages/disk-s3/src/stat-deletemany.db.spec.ts` — MinIO integration
- Create: `.changeset/storage-primitives-disk-s3.md`

**Interfaces:**
- Consumes: `StatResult` from `@dudousxd/nestjs-media-core`.
- Produces: `S3Driver.stat(path)`, `S3Driver.deleteMany(paths)`.

- [ ] **Step 1: Write the failing chunking unit test** — create/append `packages/disk-s3/src/s3-driver.spec.ts`:

```ts
import { DeleteObjectsCommand, S3Client } from '@aws-sdk/client-s3';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it } from 'vitest';
import { S3Driver } from './s3-driver';

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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/disk-s3/src/s3-driver.spec.ts`
Expected: FAIL — `driver.deleteMany is not a function`.

- [ ] **Step 3: Implement `stat` + `deleteMany`** in `packages/disk-s3/src/s3-driver.ts`.

Add `DeleteObjectsCommand` to the existing `@aws-sdk/client-s3` import, and import the type:

```ts
import type { StatResult } from '@dudousxd/nestjs-media-core';
```

Add these methods to the `S3Driver` class (place `stat` next to `size`, `deleteMany` next to `delete`):

```ts
  async stat(path: string): Promise<StatResult> {
    try {
      const res = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: this.key(path) }),
      );
      return {
        size: res.ContentLength ?? 0,
        ...(res.ContentType ? { contentType: res.ContentType } : {}),
        ...(res.LastModified ? { lastModified: res.LastModified } : {}),
      };
    } catch (err) {
      if (isNotFound(err)) throw new FileNotFoundError(path);
      throw err;
    }
  }

  async deleteMany(paths: string[]): Promise<void> {
    // S3 caps a DeleteObjects batch at 1000 keys.
    for (let start = 0; start < paths.length; start += 1000) {
      const batch = paths.slice(start, start + 1000);
      await this.client.send(
        new DeleteObjectsCommand({
          Bucket: this.bucket,
          Delete: { Objects: batch.map((path) => ({ Key: this.key(path) })) },
        }),
      );
    }
  }
```

(The loop naturally no-ops on `[]`: `0 < 0` is false, so no command is sent.)

- [ ] **Step 4: Run the unit test to verify it passes**

Run: `npx vitest run packages/disk-s3/src/s3-driver.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Write the MinIO integration test** — create `packages/disk-s3/src/stat-deletemany.db.spec.ts` (mirror the container setup in `packages/disk-s3/src/parallel-upload.db.spec.ts`):

```ts
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
```

- [ ] **Step 6: Run the MinIO integration test**

Run: `npx vitest run --config vitest.db.config.ts packages/disk-s3/src/stat-deletemany.db.spec.ts`
Expected: PASS (2 tests). (Requires Docker.)

- [ ] **Step 7: Typecheck**

Run: `pnpm --filter @dudousxd/nestjs-media-disk-s3 typecheck`
Expected: exit 0.

- [ ] **Step 8: Add the changeset** — create `.changeset/storage-primitives-disk-s3.md`:

```md
---
"@dudousxd/nestjs-media-disk-s3": patch
---

Implement `S3Driver.stat()` (HeadObject) and `S3Driver.deleteMany()` (DeleteObjects, chunked at 1000 keys).
```

- [ ] **Step 9: Commit**

```bash
git add packages/disk-s3/src/s3-driver.ts packages/disk-s3/src/s3-driver.spec.ts packages/disk-s3/src/stat-deletemany.db.spec.ts .changeset/storage-primitives-disk-s3.md
git commit -m "feat(disk-s3): stat (HeadObject) + deleteMany (chunked DeleteObjects)"
```

---

### Task 3: disk-local — `stat` + `deleteMany`

**Files:**
- Modify: `packages/disk-local/src/local-driver.ts`
- Test: `packages/disk-local/src/local-driver.spec.ts`
- Create: `.changeset/storage-primitives-disk-local.md`

**Interfaces:**
- Consumes: `StatResult` from `@dudousxd/nestjs-media-core`.
- Produces: `LocalDriver.stat(path)`, `LocalDriver.deleteMany(paths)`.

- [ ] **Step 1: Write the failing tests** — add to `packages/disk-local/src/local-driver.spec.ts` (inside the existing `describe('LocalDriver', ...)`):

```ts
  it('stat returns size, last-modified and extension content-type', async () => {
    const d = new LocalDriver({ root });
    await d.put('report.txt', Buffer.from('hello'));
    const meta = await d.stat('report.txt');
    expect(meta.size).toBe(5);
    expect(meta.contentType).toBe('text/plain');
    expect(meta.lastModified).toBeInstanceOf(Date);
  });

  it('stat throws FileNotFoundError when absent', async () => {
    await expect(new LocalDriver({ root }).stat('nope.txt')).rejects.toBeInstanceOf(
      FileNotFoundError,
    );
  });

  it('deleteMany removes every key and no-ops on []', async () => {
    const d = new LocalDriver({ root });
    await d.put('a.txt', Buffer.from('1'));
    await d.put('b.txt', Buffer.from('2'));
    await d.deleteMany(['a.txt', 'b.txt']);
    expect(await d.exists('a.txt')).toBe(false);
    expect(await d.exists('b.txt')).toBe(false);
    await expect(d.deleteMany([])).resolves.toBeUndefined();
  });
```

Ensure `FileNotFoundError` is imported in the spec (it already imports from `@dudousxd/nestjs-media-core`; add `FileNotFoundError` to that import if not present).

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run packages/disk-local/src/local-driver.spec.ts`
Expected: FAIL — `d.stat is not a function`.

- [ ] **Step 3: Implement in `packages/disk-local/src/local-driver.ts`.**

3a. Alias the fs `stat` import so it does not shadow the new method. Change the existing import line:

```ts
import { copyFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
```

to:

```ts
import { copyFile, mkdir, readFile, readdir, rename, rm, stat as fsStat, writeFile } from 'node:fs/promises';
```

Then update the two existing call sites that use the fs `stat` — in `size()` and in `list()` — to use `fsStat` (search the file for `stat(this.abs` and `stat(this.abs(key)` and replace `stat(` with `fsStat(` there). Also confirm `FileNotFoundError` and `StatResult` are importable from core; add `StatResult` (type) to the core import.

3b. Add a module-level extension→content-type helper near the top of the file (after imports):

```ts
const CONTENT_TYPE_BY_EXTENSION: Record<string, string> = {
  txt: 'text/plain',
  csv: 'text/csv',
  json: 'application/json',
  xml: 'application/xml',
  html: 'text/html',
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  zip: 'application/zip',
  sqlite: 'application/vnd.sqlite3',
};

function contentTypeFromExtension(path: string): string | undefined {
  const extension = path.split('.').pop()?.toLowerCase();
  return extension ? CONTENT_TYPE_BY_EXTENSION[extension] : undefined;
}
```

3c. Add the methods to the `LocalDriver` class (place `stat` near `size`, `deleteMany` near `delete`):

```ts
  async stat(path: string): Promise<StatResult> {
    let stats: import('node:fs').Stats;
    try {
      stats = await fsStat(this.abs(path));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') throw new FileNotFoundError(path);
      throw err;
    }
    const contentType = contentTypeFromExtension(path);
    return {
      size: stats.size,
      lastModified: stats.mtime,
      ...(contentType ? { contentType } : {}),
    };
  }

  async deleteMany(paths: string[]): Promise<void> {
    for (const path of paths) await this.delete(path);
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/disk-local/src/local-driver.spec.ts`
Expected: PASS (existing tests + 3 new).

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @dudousxd/nestjs-media-disk-local typecheck`
Expected: exit 0.

- [ ] **Step 6: Add the changeset** — create `.changeset/storage-primitives-disk-local.md`:

```md
---
"@dudousxd/nestjs-media-disk-local": patch
---

Implement `LocalDriver.stat()` (fs stat + extension content-type) and `LocalDriver.deleteMany()`.
```

- [ ] **Step 7: Commit**

```bash
git add packages/disk-local/src/local-driver.ts packages/disk-local/src/local-driver.spec.ts .changeset/storage-primitives-disk-local.md
git commit -m "feat(disk-local): stat (fs + extension content-type) + deleteMany"
```

---

### Task 4: testing — `InMemoryDriver` `stat`/`deleteMany` + shared conformance

**Files:**
- Modify: `packages/testing/src/in-memory-driver.ts`
- Modify: `packages/testing/src/conformance.ts`
- Test: `packages/testing/src/in-memory-driver.spec.ts`
- Create: `.changeset/storage-primitives-testing.md`

**Interfaces:**
- Consumes: `StatResult` from core; the `StorageDriver.stat?`/`deleteMany?` shape from Task 1; `LocalDriver.stat`/`deleteMany` (Task 3) since the shared conformance also runs for `LocalDriver`.
- Produces: `InMemoryDriver.stat(path)`, `InMemoryDriver.deleteMany(paths)`; conformance coverage for `stat`/`deleteMany`.

- [ ] **Step 1: Write the failing in-memory test** — add to `packages/testing/src/in-memory-driver.spec.ts` (inside the existing `describe`):

```ts
  it('stat returns size, stored content-type and last-modified', async () => {
    const d = new InMemoryDriver();
    await d.put('a.bin', Buffer.from('12345'), { contentType: 'application/x-thing' });
    const meta = await d.stat('a.bin');
    expect(meta.size).toBe(5);
    expect(meta.contentType).toBe('application/x-thing');
    expect(meta.lastModified).toBeInstanceOf(Date);
  });

  it('stat throws FileNotFoundError when absent', async () => {
    await expect(new InMemoryDriver().stat('nope')).rejects.toBeInstanceOf(FileNotFoundError);
  });
```

Add `FileNotFoundError` to the spec's core import if not already present.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run packages/testing/src/in-memory-driver.spec.ts`
Expected: FAIL — `d.stat is not a function`.

- [ ] **Step 3: Implement in `packages/testing/src/in-memory-driver.ts`.**

Add a metadata map beside `files`, record it on `put`, clear it on `delete`, carry it on `copy`, and add `stat`/`deleteMany`. Ensure `StatResult` (type) and `FileNotFoundError` are imported from core.

```ts
  private readonly files = new Map<string, Buffer>();
  private readonly metadata = new Map<string, { contentType?: string; lastModified: Date }>();
```

In `put`, after setting `files`, record metadata:

```ts
    this.metadata.set(path, {
      lastModified: new Date(),
      ...(options?.contentType ? { contentType: options.contentType } : {}),
    });
```

(Rename the `put` options param from `_options` to `options` so it can be read.)

In `delete`, also drop metadata:

```ts
  async delete(path: string): Promise<void> {
    this.files.delete(path);
    this.metadata.delete(path);
  }
```

In `copy`, carry metadata to the destination (after copying the buffer):

```ts
    const meta = this.metadata.get(from);
    this.metadata.set(to, { lastModified: new Date(), ...(meta?.contentType ? { contentType: meta.contentType } : {}) });
```

Add the two methods:

```ts
  async stat(path: string): Promise<StatResult> {
    const buffer = this.files.get(path);
    if (!buffer) throw new FileNotFoundError(path);
    const meta = this.metadata.get(path);
    return {
      size: buffer.byteLength,
      ...(meta?.contentType ? { contentType: meta.contentType } : {}),
      ...(meta ? { lastModified: meta.lastModified } : {}),
    };
  }

  async deleteMany(paths: string[]): Promise<void> {
    for (const path of paths) await this.delete(path);
  }
```

- [ ] **Step 4: Run the in-memory test to verify it passes**

Run: `npx vitest run packages/testing/src/in-memory-driver.spec.ts`
Expected: PASS.

- [ ] **Step 5: Add shared conformance** — in `packages/testing/src/conformance.ts`, add two `it` blocks inside the `describe('StorageDriver conformance: ${name}', ...)` body. The `factory` param already returns a `StorageDriver`; guard the optional methods with an explicit throw (biome forbids `!`):

```ts
    it('stat reports the size and a last-modified date', async () => {
      const driver = factory();
      if (!driver.stat) throw new Error('driver does not implement stat');
      await driver.put('s/file.txt', Buffer.from('12345'));
      const meta = await driver.stat('s/file.txt');
      expect(meta.size).toBe(5);
      expect(meta.lastModified).toBeInstanceOf(Date);
    });

    it('deleteMany removes every listed key and no-ops on []', async () => {
      const driver = factory();
      if (!driver.deleteMany) throw new Error('driver does not implement deleteMany');
      await driver.put('m/a', Buffer.from('a'));
      await driver.put('m/b', Buffer.from('b'));
      await driver.deleteMany(['m/a', 'm/b']);
      expect(await driver.exists('m/a')).toBe(false);
      expect(await driver.exists('m/b')).toBe(false);
      await expect(driver.deleteMany([])).resolves.toBeUndefined();
    });
```

(Content-type is asserted per-driver, not here: `LocalDriver` derives it from the extension while `InMemoryDriver` stores the put option, so a shared assertion would diverge. Size + last-modified + deleteMany are driver-agnostic.)

- [ ] **Step 6: Run the full conformance for both drivers**

Run: `npx vitest run packages/testing/src/in-memory-driver.spec.ts packages/disk-local/src/conformance.spec.ts`
Expected: PASS (the shared conformance now runs the two new cases for InMemoryDriver and LocalDriver).

- [ ] **Step 7: Typecheck**

Run: `pnpm --filter @dudousxd/nestjs-media-testing typecheck && pnpm --filter @dudousxd/nestjs-media-disk-local typecheck`
Expected: exit 0.

- [ ] **Step 8: Add the changeset** — create `.changeset/storage-primitives-testing.md`:

```md
---
"@dudousxd/nestjs-media-testing": patch
---

Implement `InMemoryDriver.stat()` / `deleteMany()` and add shared `StorageDriver` conformance coverage for `stat` and `deleteMany`.
```

- [ ] **Step 9: Commit**

```bash
git add packages/testing/src/in-memory-driver.ts packages/testing/src/conformance.ts packages/testing/src/in-memory-driver.spec.ts .changeset/storage-primitives-testing.md
git commit -m "feat(testing): InMemoryDriver stat/deleteMany + shared conformance"
```

---

### Task 5: Whole-suite verification + changeset audit

**Files:** none (verification only).

- [ ] **Step 1: Build the workspace**

Run: `pnpm -r build`
Expected: all packages build.

- [ ] **Step 2: Full unit suite**

Run: `npx vitest run`
Expected: all green (no `*.db.spec.ts` in this run — they are excluded by `vitest.config.ts`).

- [ ] **Step 3: Repo lint + typecheck**

Run: `npx biome check` then `pnpm -r typecheck`
Expected: biome clean; typecheck exit 0 for every package.

- [ ] **Step 4: Changeset audit — MUST be all patch**

Run: `npx changeset status --since=main`
Expected: four packages listed under **patch** (`-core`, `-disk-s3`, `-disk-local`, `-testing`); **0 minor, 0 major**. If anything shows minor/major, stop and fix — the `0.x` line must hold.

- [ ] **Step 5: MinIO integration (Docker required)**

Run: `npx vitest run --config vitest.db.config.ts packages/disk-s3/src/stat-deletemany.db.spec.ts`
Expected: PASS (2 tests).

(No commit — this task only verifies. Release happens via the changesets CI action on merge; do not `npm publish`.)

---

## Self-Review

**Spec coverage:** `stat` (Task 1 type + Tasks 2/3/4 impl), `deleteMany` (Tasks 2/3/4), `diskNames` (Task 1) — all covered. Testing: unit for local/testing + shared conformance (Task 4) + MinIO for S3 (Task 2) — matches the spec. Versioning: optional members + four patch changesets + Task 5 audit — matches. Out-of-scope items (presign, readWithMeta, existing-method changes) are not introduced.

**Type consistency:** `StatResult` (`size`/`contentType?`/`lastModified?`) is used identically in S3Driver, LocalDriver, and InMemoryDriver. `stat?(path)`/`deleteMany?(paths)` signatures match across the interface and all impls. `diskNames(): string[]` is defined and tested in Task 1.

**Placeholder scan:** every code step shows complete code; no TBD/omitted logic.
