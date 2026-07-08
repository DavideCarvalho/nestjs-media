# nestjs-media: client split + GW-safe proxy-parallel multipart — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the media client `uploadMedia` into reusable pieces and add a GameWarden-safe proxy-parallel multipart upload mode (concurrent part uploads, all bytes through the backend).

**Architecture:** Reuse `ResumableUploadManager` + `UploadSessionStore`. A new `writePart(id, partNumber, chunk)` uploads one S3 multipart part by explicit number and records its ETag in a concurrency-safe side store (never the session JSON); `complete()` sorts parts by number. New HTTP routes proxy the part bodies. The client gains a concurrency-pooled `streamChunksParallel`. React + codegen surface the parallel path.

**Tech Stack:** TypeScript, NestJS, `@aws-sdk/client-s3` (S3 multipart), ioredis, pnpm+turbo monorepo, changesets, vitest, biome.

## Global Constraints

- **GameWarden-safe:** every byte proxies through the backend. NO client→S3 presigned/direct path is added or reachable in the parallel mode.
- **Server-derived key:** the part-upload and complete routes NEVER accept a client-supplied key/disk — everything is resolved from the session id.
- **Memory-bounded:** each part upload is raw-parsed under a host-configured per-part cap; worst-case in-flight is `concurrency × maxPartSize`, never the whole file.
- **Backward compatible:** `uploadMedia`, `writeChunk`, the tus routes, and the existing `UploadSessionStore` members are unchanged. New store methods are OPTIONAL; `writePart` requires them and throws a clear error when absent.
- **Stay 0.x — all PATCH bumps:** every touched published package gets a **patch** changeset so no dependent graduates to 1.0.0. The changesets Version PR must show **0 major bumps**.
- **flip is untouched.** No file under any `flip-*` repo changes.
- **Types (verbatim):** `MultipartPart = { partNumber: number; etag: string }`. Session store default key prefix `media:upload:session`. Client default chunk `5 * 1024 * 1024`; parallel default `concurrency = 3`. S3 part numbers are 1-based, max 10000; non-final parts ≥ 5 MiB.
- **Release via CI:** do NOT `npm publish` by hand. Changesets + the Release workflow publish on merge.

## Execution Waves (for subagent-driven execution)

- **Wave 1:** Task 1 (core) — foundational; everything else consumes it.
- **Wave 2 (parallel):** Task 2 (testing in-memory store) ∥ Task 3 (upload-redis store) ∥ Task 5 (client — independent package, HTTP-only).
- **Wave 3 (parallel):** Task 4 (nestjs routes, needs Task 1) ∥ Task 8 (disk-s3 e2e, needs Tasks 1+2).
- **Wave 4 (parallel):** Task 6 (react, needs Task 5) ∥ Task 7 (codegen, needs Task 5).

---

### Task 1: core — `writePart`, `listParts`, `complete()` ordering, store interface

**Files:**
- Modify: `packages/core/src/resumable-upload.ts` (add `addPart?`/`listParts?` to `UploadSessionStore`; add `writePart`, `listParts` to the manager; reorder parts in `complete`)
- Modify: `packages/core/src/errors.ts` (add `InvalidPartNumberError`)
- Test: `packages/core/src/resumable-upload.spec.ts` (existing file — append)
- Add: `.changeset/media-core-parallel-writepart.md`

**Interfaces:**
- Consumes: `MultipartPart = { partNumber: number; etag: string }` (from `packages/core/src/types.ts`); `disk.uploadPart(key, uploadId, partNumber, chunk): Promise<MultipartPart>`; `isMultipartCapable(disk)`; `UnsupportedOperationError(subject, operation)`.
- Produces: `ResumableUploadManager.writePart(id: string, partNumber: number, chunk: Buffer): Promise<MultipartPart>`; `ResumableUploadManager.listParts(id: string): Promise<MultipartPart[]>`; `UploadSessionStore.addPart?(id: string, part: MultipartPart): Promise<void>`; `UploadSessionStore.listParts?(id: string): Promise<MultipartPart[]>`; `InvalidPartNumberError`.

- [ ] **Step 1: Write the failing test** — append to `packages/core/src/resumable-upload.spec.ts`. Use an in-line fake store + fake storage in the file's existing style (a multipart-capable disk). If the file already has helpers `makeManager()`/fake disk, reuse them; otherwise add this self-contained block:

```ts
import { InvalidPartNumberError } from './errors';

describe('ResumableUploadManager.writePart (parallel multipart)', () => {
  interface FakeDisk {
    capabilities: { multipart: boolean };
    uploadPart: (key: string, uploadId: string, partNumber: number, chunk: Buffer) => Promise<{ partNumber: number; etag: string }>;
    completeMultipartUpload: (key: string, uploadId: string, parts: Array<{ partNumber: number; etag: string }>) => Promise<void>;
    createMultipartUpload: (key: string) => Promise<{ uploadId: string }>;
  }

  function makeStore() {
    const sessions = new Map<string, any>();
    const parts = new Map<string, Map<number, string>>();
    return {
      sessions,
      parts,
      async create(s: any) { sessions.set(s.id, { ...s }); return { ...s }; },
      async get(id: string) { const s = sessions.get(id); return s ? { ...s } : null; },
      async update(s: any) { sessions.set(s.id, { ...s }); return { ...s }; },
      async delete(id: string) { sessions.delete(id); parts.delete(id); },
      async addPart(id: string, part: { partNumber: number; etag: string }) {
        if (!parts.has(id)) parts.set(id, new Map());
        parts.get(id)!.set(part.partNumber, part.etag);
      },
      async listParts(id: string) {
        return [...(parts.get(id) ?? new Map()).entries()].map(([partNumber, etag]) => ({ partNumber, etag }));
      },
    };
  }

  function makeManager(store: any, completed: { parts?: Array<{ partNumber: number; etag: string }> }) {
    const disk: FakeDisk = {
      capabilities: { multipart: true },
      async createMultipartUpload() { return { uploadId: 'mp-1' }; },
      async uploadPart(_k, _u, partNumber) { return { partNumber, etag: `etag-${partNumber}` }; },
      async completeMultipartUpload(_k, _u, parts) { completed.parts = parts; },
    };
    const storage = { disk: () => disk } as any;
    return new ResumableUploadManager({ storage, sessions: store, emitDiagnostics: false });
  }

  it('records concurrent, out-of-order parts and completes them sorted ascending', async () => {
    const store = makeStore();
    const completed: { parts?: Array<{ partNumber: number; etag: string }> } = {};
    const manager = makeManager(store, completed);
    const session = await manager.createUpload({ disk: 's3', key: 'k/obj.bin', size: 30 });

    // Upload parts out of order and concurrently.
    await Promise.all([
      manager.writePart(session.id, 3, Buffer.alloc(10)),
      manager.writePart(session.id, 1, Buffer.alloc(10)),
      manager.writePart(session.id, 2, Buffer.alloc(10)),
    ]);
    await manager.complete(session.id);

    expect(completed.parts).toEqual([
      { partNumber: 1, etag: 'etag-1' },
      { partNumber: 2, etag: 'etag-2' },
      { partNumber: 3, etag: 'etag-3' },
    ]);
  });

  it('rejects a part number outside 1..10000', async () => {
    const store = makeStore();
    const manager = makeManager(store, {});
    const session = await manager.createUpload({ disk: 's3', key: 'k/o.bin', size: 10 });
    await expect(manager.writePart(session.id, 0, Buffer.alloc(1))).rejects.toBeInstanceOf(InvalidPartNumberError);
  });

  it('throws when the store cannot record parts atomically (no addPart)', async () => {
    const store = makeStore();
    delete (store as any).addPart;
    const manager = makeManager(store, {});
    const session = await manager.createUpload({ disk: 's3', key: 'k/o.bin', size: 10 });
    await expect(manager.writePart(session.id, 1, Buffer.alloc(1))).rejects.toThrow(/concurrent part writes/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/core && npx vitest run src/resumable-upload.spec.ts`
Expected: FAIL — `manager.writePart is not a function` / `InvalidPartNumberError` not exported.

- [ ] **Step 3: Add `InvalidPartNumberError`** to `packages/core/src/errors.ts` (append, following the existing error class style):

```ts
export class InvalidPartNumberError extends Error {
  constructor(partNumber: number) {
    super(`Invalid multipart part number: ${partNumber} (must be an integer in 1..10000)`);
    this.name = 'InvalidPartNumberError';
  }
}
```

- [ ] **Step 4: Extend the store interface** in `packages/core/src/resumable-upload.ts` — add two OPTIONAL methods to `UploadSessionStore`:

```ts
export interface UploadSessionStore {
  create(session: UploadSession): Promise<UploadSession>;
  get(id: string): Promise<UploadSession | null>;
  update(session: UploadSession): Promise<UploadSession>;
  delete(id: string): Promise<void>;
  /** Atomically record one part's ETag, keyed by partNumber. Enables parallel `writePart`. */
  addPart?(id: string, part: MultipartPart): Promise<void>;
  /** All recorded parts for a session (unordered). Used by `complete()` + resume. */
  listParts?(id: string): Promise<MultipartPart[]>;
}
```

- [ ] **Step 5: Add `writePart` + `listParts` to the manager** and import `InvalidPartNumberError`. Add to the imports at the top of `resumable-upload.ts`:

```ts
import { InvalidPartNumberError, UploadOffsetConflictError, UploadSessionNotFoundError } from './errors';
```

Add these methods to the `ResumableUploadManager` class (place `writePart` next to `writeChunk`):

```ts
/**
 * Upload ONE S3 multipart part by explicit number (the parallel path). Unlike
 * `writeChunk` this does not touch `offset`/`parts` and does not auto-complete —
 * the client uploads parts concurrently, then calls `complete()`. Requires a
 * session store with atomic `addPart` (no read-modify-write fallback is safe
 * under concurrency).
 */
async writePart(id: string, partNumber: number, chunk: Buffer): Promise<MultipartPart> {
  const session = await this.require(id);
  const disk = this.storage.disk(session.disk);
  if (!session.multipartUploadId || !isMultipartCapable(disk)) {
    throw new UnsupportedOperationError(session.disk, 'parallel multipart upload');
  }
  if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10_000) {
    throw new InvalidPartNumberError(partNumber);
  }
  if (typeof this.sessions.addPart !== 'function') {
    throw new UnsupportedOperationError('session store', 'concurrent part writes');
  }
  const part = await disk.uploadPart(session.key, session.multipartUploadId, partNumber, chunk);
  await this.sessions.addPart(id, part);
  this.emit('upload.progress', { id: session.id, offset: session.offset, parts: partNumber, size: session.size });
  return part;
}

/** All recorded parts for a session (parallel side store first, else the sequential session list). */
async listParts(id: string): Promise<MultipartPart[]> {
  const session = await this.require(id);
  const stored = typeof this.sessions.listParts === 'function' ? await this.sessions.listParts(id) : [];
  return [...(session.partETags ?? []), ...stored];
}
```

- [ ] **Step 6: Order parts in `complete()`** — in `resumable-upload.ts`, replace the multipart branch of `complete()`:

```ts
if (session.multipartUploadId && isMultipartCapable(disk)) {
  await disk.completeMultipartUpload(
    session.key,
    session.multipartUploadId,
    session.partETags ?? [],
  );
}
```
with:
```ts
if (session.multipartUploadId && isMultipartCapable(disk)) {
  // Sequential tus writes go to session.partETags (in order); parallel writePart
  // writes to the store's part side-index (out of order). One of the two is
  // always empty for a given session — concatenate and sort ascending, which S3
  // requires for completeMultipartUpload.
  const stored = typeof this.sessions.listParts === 'function' ? await this.sessions.listParts(id) : [];
  const parts = [...(session.partETags ?? []), ...stored].sort((a, b) => a.partNumber - b.partNumber);
  await disk.completeMultipartUpload(session.key, session.multipartUploadId, parts);
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd packages/core && npx vitest run src/resumable-upload.spec.ts`
Expected: PASS (all new cases + the existing ones).

- [ ] **Step 8: Typecheck + lint**

Run: `cd packages/core && npx tsc --noEmit && cd ../.. && npx biome check packages/core/src/resumable-upload.ts packages/core/src/errors.ts packages/core/src/resumable-upload.spec.ts`
Expected: exit 0 (fix formatting with `npx biome check --write <files>` if needed).

- [ ] **Step 9: Add the changeset** — create `.changeset/media-core-parallel-writepart.md`:

```markdown
---
"@dudousxd/nestjs-media-core": patch
---

Add `ResumableUploadManager.writePart(id, partNumber, chunk)` and `listParts(id)` for a
proxy-parallel multipart upload path, plus optional `addPart`/`listParts` on
`UploadSessionStore`. `complete()` now orders parts ascending by `partNumber`. The
sequential tus path is unchanged.
```

- [ ] **Step 10: Commit**

```bash
git add packages/core/src/resumable-upload.ts packages/core/src/errors.ts packages/core/src/resumable-upload.spec.ts .changeset/media-core-parallel-writepart.md
git commit -m "feat(core): parallel multipart writePart/listParts + ordered complete"
```

---

### Task 2: testing — in-memory store `addPart`/`listParts`

**Files:**
- Modify: `packages/testing/src/in-memory-upload-session-store.ts`
- Test: `packages/testing/src/in-memory-upload-session-store.spec.ts` (create if absent)
- Add: `.changeset/media-testing-addpart.md` (skip if `packages/testing/package.json` has `"private": true`)

**Interfaces:**
- Consumes: `UploadSessionStore.addPart?`/`listParts?` (Task 1); `MultipartPart`.
- Produces: `InMemoryUploadSessionStore` implementing `addPart`/`listParts`.

- [ ] **Step 1: Write the failing test** — create `packages/testing/src/in-memory-upload-session-store.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { InMemoryUploadSessionStore } from './in-memory-upload-session-store';

function session(id: string) {
  return { id, disk: 's3', key: `k/${id}`, contentType: undefined, size: 30, offset: 0, parts: 0 };
}

describe('InMemoryUploadSessionStore parts', () => {
  it('records parts by number and lists them; delete clears parts', async () => {
    const store = new InMemoryUploadSessionStore();
    await store.create(session('a'));
    await store.addPart!('a', { partNumber: 2, etag: 'e2' });
    await store.addPart!('a', { partNumber: 1, etag: 'e1' });
    const parts = await store.listParts!('a');
    expect([...parts].sort((x, y) => x.partNumber - y.partNumber)).toEqual([
      { partNumber: 1, etag: 'e1' },
      { partNumber: 2, etag: 'e2' },
    ]);
    await store.delete('a');
    expect(await store.listParts!('a')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/testing && npx vitest run src/in-memory-upload-session-store.spec.ts`
Expected: FAIL — `store.addPart is not a function`.

- [ ] **Step 3: Implement** — replace `packages/testing/src/in-memory-upload-session-store.ts`:

```ts
import type { MultipartPart, UploadSession, UploadSessionStore } from '@dudousxd/nestjs-media-core';

/** In-memory UploadSessionStore for tests. */
export class InMemoryUploadSessionStore implements UploadSessionStore {
  private readonly sessions = new Map<string, UploadSession>();
  private readonly parts = new Map<string, Map<number, string>>();

  async create(session: UploadSession): Promise<UploadSession> {
    this.sessions.set(session.id, { ...session });
    return { ...session };
  }

  async get(id: string): Promise<UploadSession | null> {
    const found = this.sessions.get(id);
    return found ? { ...found } : null;
  }

  async update(session: UploadSession): Promise<UploadSession> {
    this.sessions.set(session.id, { ...session });
    return { ...session };
  }

  async delete(id: string): Promise<void> {
    this.sessions.delete(id);
    this.parts.delete(id);
  }

  async addPart(id: string, part: MultipartPart): Promise<void> {
    if (!this.parts.has(id)) this.parts.set(id, new Map());
    this.parts.get(id)!.set(part.partNumber, part.etag);
  }

  async listParts(id: string): Promise<MultipartPart[]> {
    return [...(this.parts.get(id) ?? new Map<number, string>()).entries()].map(
      ([partNumber, etag]) => ({ partNumber, etag }),
    );
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd packages/testing && npx vitest run src/in-memory-upload-session-store.spec.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + lint + changeset**

Run: `cd packages/testing && npx tsc --noEmit && cd ../.. && npx biome check packages/testing/src/in-memory-upload-session-store.ts packages/testing/src/in-memory-upload-session-store.spec.ts`
Then, only if `packages/testing/package.json` does NOT have `"private": true`, create `.changeset/media-testing-addpart.md`:

```markdown
---
"@dudousxd/nestjs-media-testing": patch
---

`InMemoryUploadSessionStore` implements the new optional `addPart`/`listParts` so tests can
exercise the parallel multipart path.
```

- [ ] **Step 6: Commit**

```bash
git add packages/testing/src/in-memory-upload-session-store.ts packages/testing/src/in-memory-upload-session-store.spec.ts
git add .changeset/media-testing-addpart.md 2>/dev/null || true
git commit -m "feat(testing): in-memory session store addPart/listParts"
```

---

### Task 3: upload-redis — `addPart`/`listParts` via per-session HSET

**Files:**
- Modify: `packages/upload-redis/src/redis-upload-session-store.ts`
- Test: `packages/upload-redis/src/redis-upload-session-store.spec.ts` (existing — append)
- Add: `.changeset/media-upload-redis-parts.md`

**Interfaces:**
- Consumes: `UploadSessionStore.addPart?`/`listParts?` (Task 1); `MultipartPart`.
- Produces: `RedisUploadSessionStore.addPart`/`listParts`; `MinimalRedis` gains optional `hset`/`hgetall`/`expire`; parts key = `${keyPrefix}:${id}:parts`; `delete` removes both keys.

- [ ] **Step 1: Write the failing test** — append to `packages/upload-redis/src/redis-upload-session-store.spec.ts`. Use a small in-memory fake `MinimalRedis` (mirror any existing fake in that file; else add this):

```ts
describe('RedisUploadSessionStore parts (HSET)', () => {
  function fakeRedis() {
    const strings = new Map<string, string>();
    const hashes = new Map<string, Map<string, string>>();
    return {
      strings,
      hashes,
      async get(k: string) { return strings.get(k) ?? null; },
      async set(k: string, v: string) { strings.set(k, v); return 'OK'; },
      async del(k: string) { strings.delete(k); hashes.delete(k); return 1; },
      async hset(k: string, field: string, value: string) {
        if (!hashes.has(k)) hashes.set(k, new Map());
        hashes.get(k)!.set(field, value);
        return 1;
      },
      async hgetall(k: string) {
        return Object.fromEntries(hashes.get(k) ?? new Map());
      },
      async expire() { return 1; },
    };
  }

  it('records parts to a per-session hash, lists them, and delete removes the hash', async () => {
    const redis = fakeRedis();
    const store = new RedisUploadSessionStore(redis as any);
    await store.create({ id: 'a', disk: 's3', key: 'k/a', contentType: undefined, size: 30, offset: 0, parts: 0 });
    await store.addPart('a', { partNumber: 2, etag: 'e2' });
    await store.addPart('a', { partNumber: 1, etag: 'e1' });

    const parts = await store.listParts('a');
    expect([...parts].sort((x, y) => x.partNumber - y.partNumber)).toEqual([
      { partNumber: 1, etag: 'e1' },
      { partNumber: 2, etag: 'e2' },
    ]);

    await store.delete('a');
    expect(await store.listParts('a')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/upload-redis && npx vitest run src/redis-upload-session-store.spec.ts`
Expected: FAIL — `store.addPart is not a function`.

- [ ] **Step 3: Extend `MinimalRedis`** in `redis-upload-session-store.ts` — add three optional methods after `scan?`:

```ts
export interface MinimalRedis {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ...args: unknown[]): Promise<unknown>;
  del(key: string): Promise<unknown>;
  scan?(cursor: string | number, ...args: unknown[]): Promise<[string, string[]]>;
  /** Hash field set (ioredis signature). Optional — only `addPart` requires it. */
  hset?(key: string, field: string, value: string): Promise<unknown>;
  /** Read all hash fields (ioredis signature). Optional — only `listParts` requires it. */
  hgetall?(key: string): Promise<Record<string, string>>;
  /** Set a key TTL in seconds (ioredis signature). Optional — bounds orphaned part hashes. */
  expire?(key: string, seconds: number): Promise<unknown>;
}
```

- [ ] **Step 4: Import `MultipartPart` + implement the methods.** Change the top import to:

```ts
import type { MultipartPart, UploadSession, UploadSessionStore } from '@dudousxd/nestjs-media-core';
```

Add a `partsKey` helper next to `key`:

```ts
private partsKey(id: string): string {
  return `${this.keyPrefix}:${id}:parts`;
}
```

Add the two methods (place after `update`):

```ts
async addPart(id: string, part: MultipartPart): Promise<void> {
  if (typeof this.redis.hset !== 'function') {
    throw new Error('RedisUploadSessionStore.addPart() requires a redis client with `hset` (e.g. ioredis).');
  }
  const partsKey = this.partsKey(id);
  await this.redis.hset(partsKey, String(part.partNumber), part.etag);
  // Bound orphaned part hashes (a crashed upload never reaching delete()).
  if (typeof this.redis.expire === 'function') {
    await this.redis.expire(partsKey, this.ttlSeconds);
  }
}

async listParts(id: string): Promise<MultipartPart[]> {
  if (typeof this.redis.hgetall !== 'function') {
    throw new Error('RedisUploadSessionStore.listParts() requires a redis client with `hgetall` (e.g. ioredis).');
  }
  const map = await this.redis.hgetall(this.partsKey(id));
  return Object.entries(map ?? {}).map(([partNumber, etag]) => ({ partNumber: Number(partNumber), etag }));
}
```

- [ ] **Step 5: Delete the parts hash with the session** — update `delete`:

```ts
async delete(id: string): Promise<void> {
  await this.redis.del(this.key(id));
  await this.redis.del(this.partsKey(id));
}
```

- [ ] **Step 6: Run to verify it passes**

Run: `cd packages/upload-redis && npx vitest run src/redis-upload-session-store.spec.ts`
Expected: PASS.

- [ ] **Step 7: Typecheck + lint**

Run: `cd packages/upload-redis && npx tsc --noEmit && cd ../.. && npx biome check packages/upload-redis/src/redis-upload-session-store.ts packages/upload-redis/src/redis-upload-session-store.spec.ts`
Expected: exit 0.

- [ ] **Step 8: Add the changeset** — `.changeset/media-upload-redis-parts.md`:

```markdown
---
"@dudousxd/nestjs-media-upload-redis": patch
---

`RedisUploadSessionStore` implements `addPart`/`listParts` backed by a per-session
`…:<id>:parts` hash (atomic `HSET` per part number, out-of-order safe), TTL-bounded, and
removed with the session on `delete`. Enables the parallel multipart upload path.
```

- [ ] **Step 9: Commit**

```bash
git add packages/upload-redis/src/redis-upload-session-store.ts packages/upload-redis/src/redis-upload-session-store.spec.ts .changeset/media-upload-redis-parts.md
git commit -m "feat(upload-redis): addPart/listParts via per-session hash"
```

---

### Task 4: nestjs — multipart upload controller (`PUT parts`, `POST complete`, `GET parts`)

**Files:**
- Create: `packages/nestjs/src/media-multipart-upload.controller.ts`
- Modify: `packages/nestjs/src/media.module.ts` (register the controller)
- Modify: `packages/nestjs/src/index.ts` (export the controller)
- Test: `packages/nestjs/src/media-multipart-upload.controller.spec.ts`
- Add: `.changeset/media-nestjs-multipart-routes.md`

**Interfaces:**
- Consumes: `MEDIA_UPLOADS` token (from `packages/nestjs/src/tokens.ts`) = `ResumableUploadManager`; `ResumableUploadManager.writePart`/`complete`/`listParts` (Task 1).
- Produces: `MediaMultipartUploadController` with `PUT media/uploads/:id/parts/:partNumber`, `POST media/uploads/:id/complete`, `GET media/uploads/:id/parts`.

- [ ] **Step 1: Write the failing test** — `packages/nestjs/src/media-multipart-upload.controller.spec.ts`:

```ts
import { NotImplementedException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { MediaMultipartUploadController } from './media-multipart-upload.controller';

function managerStub() {
  return {
    writePart: vi.fn(async (_id: string, partNumber: number) => ({ partNumber, etag: `e${partNumber}` })),
    complete: vi.fn(async () => ({ key: 'k/o.bin', disk: 's3', size: 30 })),
    listParts: vi.fn(async () => [{ partNumber: 2, etag: 'e2' }, { partNumber: 1, etag: 'e1' }]),
  };
}

describe('MediaMultipartUploadController', () => {
  it('uploadPart forwards the raw body Buffer and returns the part', async () => {
    const manager = managerStub();
    const controller = new MediaMultipartUploadController(manager as any);
    const body = Buffer.from('chunk');
    const res = await controller.uploadPart('id1', '3', { body });
    expect(manager.writePart).toHaveBeenCalledWith('id1', 3, body);
    expect(res).toEqual({ partNumber: 3, etag: 'e3' });
  });

  it('complete calls the manager', async () => {
    const manager = managerStub();
    const controller = new MediaMultipartUploadController(manager as any);
    expect(await controller.complete('id1')).toEqual({ key: 'k/o.bin', disk: 's3', size: 30 });
    expect(manager.complete).toHaveBeenCalledWith('id1');
  });

  it('listParts returns the uploaded part numbers', async () => {
    const manager = managerStub();
    const controller = new MediaMultipartUploadController(manager as any);
    expect(await controller.listParts('id1')).toEqual({ parts: [2, 1] });
  });

  it('501s when the manager is not configured', async () => {
    const controller = new MediaMultipartUploadController(null);
    await expect(controller.complete('id1')).rejects.toBeInstanceOf(NotImplementedException);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/nestjs && npx vitest run src/media-multipart-upload.controller.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the controller** — `packages/nestjs/src/media-multipart-upload.controller.ts`:

```ts
import type { ResumableUploadManager } from '@dudousxd/nestjs-media-core';
import {
  Controller,
  Get,
  Inject,
  NotImplementedException,
  Param,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import { MEDIA_UPLOADS } from './tokens';

/** Express-like request exposing the raw body Buffer (host must mount a raw parser on the parts path). */
interface ReqLike {
  body?: Buffer;
}

/**
 * Proxy-parallel multipart routes. Bytes flow through the backend: the client
 * PUTs each part (by explicit number) and the backend forwards it to a native
 * S3 multipart part, then a single complete call assembles them. The key/disk
 * are resolved from the session id — never from the client — so this is
 * GameWarden-safe and cannot be pointed at another object.
 *
 * The app MUST mount a raw-body parser with a per-part size cap on
 * `…/media/uploads/:id/parts/:n` so the PUT body arrives as a Buffer.
 */
@Controller('media/uploads')
export class MediaMultipartUploadController {
  constructor(@Inject(MEDIA_UPLOADS) private readonly manager: ResumableUploadManager | null) {}

  @Put(':id/parts/:partNumber')
  uploadPart(
    @Param('id') id: string,
    @Param('partNumber') partNumber: string,
    @Req() req: ReqLike,
  ) {
    if (!this.manager) throw new NotImplementedException('Uploads are not configured.');
    return this.manager.writePart(id, Number(partNumber), req.body ?? Buffer.alloc(0));
  }

  @Post(':id/complete')
  complete(@Param('id') id: string) {
    if (!this.manager) throw new NotImplementedException('Uploads are not configured.');
    return this.manager.complete(id);
  }

  @Get(':id/parts')
  async listParts(@Param('id') id: string): Promise<{ parts: number[] }> {
    if (!this.manager) throw new NotImplementedException('Uploads are not configured.');
    const parts = await this.manager.listParts(id);
    return { parts: parts.map((p) => p.partNumber) };
  }
}
```

- [ ] **Step 4: Register + export the controller.** In `packages/nestjs/src/media.module.ts`, add `MediaMultipartUploadController` to the `controllers` array wherever `MediaUploadController` is listed (same base path, no route collision: tus owns `POST /`, `PATCH|HEAD|DELETE :id`, `OPTIONS`; this owns `PUT :id/parts/:n`, `POST :id/complete`, `GET :id/parts`). Import it at the top:

```ts
import { MediaMultipartUploadController } from './media-multipart-upload.controller';
```

In `packages/nestjs/src/index.ts`, add an export line next to the other controller exports:

```ts
export { MediaMultipartUploadController } from './media-multipart-upload.controller';
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd packages/nestjs && npx vitest run src/media-multipart-upload.controller.spec.ts`
Expected: PASS.

- [ ] **Step 6: Full package test + typecheck + lint**

Run: `cd packages/nestjs && npx vitest run && npx tsc --noEmit && cd ../.. && npx biome check packages/nestjs/src/media-multipart-upload.controller.ts packages/nestjs/src/media.module.ts packages/nestjs/src/index.ts packages/nestjs/src/media-multipart-upload.controller.spec.ts`
Expected: exit 0 (existing module spec still green — confirms no route-collision regression).

- [ ] **Step 7: Add the changeset** — `.changeset/media-nestjs-multipart-routes.md`:

```markdown
---
"@dudousxd/nestjs-media": patch
---

Add `MediaMultipartUploadController` with `PUT /media/uploads/:id/parts/:partNumber` (raw
body → S3 multipart part), `POST /media/uploads/:id/complete`, and `GET /media/uploads/:id/parts`
(for resume). Key/disk are resolved from the session id (server-derived, no client→S3 path).
Mount a raw-body parser with a per-part cap on the parts route.
```

- [ ] **Step 8: Commit**

```bash
git add packages/nestjs/src/media-multipart-upload.controller.ts packages/nestjs/src/media-multipart-upload.controller.spec.ts packages/nestjs/src/media.module.ts packages/nestjs/src/index.ts .changeset/media-nestjs-multipart-routes.md
git commit -m "feat(nestjs): proxy-parallel multipart controller routes"
```

---

### Task 5: client — split `uploadMedia` + add `streamChunksParallel`/`uploadMediaParallel`

**Files:**
- Modify: `packages/client/src/index.ts` (full rewrite below)
- Test: `packages/client/src/index.spec.ts` (existing — append; if none, create)
- Add: `.changeset/media-client-parallel.md`

**Interfaces:**
- Consumes: the tus routes (create `POST base`, `PATCH location`, `HEAD location`) and the new parallel routes (`PUT location/parts/:n`, `POST location/complete`) from Task 4.
- Produces: `createSession`, `streamChunks`, `streamChunksParallel`, `uploadMediaParallel`, unchanged `uploadMedia`/`mediaUrl`; exported types `UploadMediaOptions`, `UploadMediaResult`, `StreamChunksOptions`, `StreamChunksParallelOptions`.

- [ ] **Step 1: Write the failing test** — append to `packages/client/src/index.spec.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { streamChunksParallel, uploadMedia } from './index';

function blobOf(bytes: number): Blob {
  return new Blob([new Uint8Array(bytes)]);
}

describe('streamChunksParallel', () => {
  it('PUTs each part by number, respects the concurrency cap, then completes', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: string, init: any) => {
      calls.push(`${init.method} ${url}`);
      if (init.method === 'PUT') {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight -= 1;
      }
      return { ok: true, headers: new Map() } as any;
    });

    // 25 bytes @ 10-byte chunks => 3 parts (1,2,3).
    await streamChunksParallel('/api/media/uploads/xyz', blobOf(25), {
      chunkSize: 10,
      concurrency: 2,
      fetchImpl: fetchImpl as any,
    });

    expect(calls).toContain('PUT /api/media/uploads/xyz/parts/1');
    expect(calls).toContain('PUT /api/media/uploads/xyz/parts/2');
    expect(calls).toContain('PUT /api/media/uploads/xyz/parts/3');
    expect(calls).toContain('POST /api/media/uploads/xyz/complete');
    expect(maxInFlight).toBeLessThanOrEqual(2);
  });
});

describe('uploadMedia (back-compat)', () => {
  it('still creates a session then PATCHes sequentially', async () => {
    const fetchImpl = vi.fn(async (_url: string, init: any) => ({
      ok: true,
      headers: new Map([['Location', '/media/uploads/abc'], ['Upload-Offset', '10']]),
    })) as any;
    const result = await uploadMedia(blobOf(10), { filename: 'f.bin', basePath: '/media/uploads', fetchImpl });
    expect(result.location).toBe('/media/uploads/abc');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/client && npx vitest run src/index.spec.ts`
Expected: FAIL — `streamChunksParallel` not exported.

- [ ] **Step 3: Rewrite the client** — replace `packages/client/src/index.ts` with:

```ts
export interface UploadMediaOptions {
  filename: string;
  contentType?: string;
  /** tus base path. Default `/media/uploads`. */
  basePath?: string;
  /** Bytes per chunk/part. Default 5 MiB. */
  chunkSize?: number;
  onProgress?: (sent: number, total: number) => void;
  fetchImpl?: typeof fetch;
  /** Extra headers merged into every request (e.g. Authorization). */
  headers?: Record<string, string>;
}

export interface UploadMediaResult {
  location: string;
}

export interface StreamChunksOptions {
  chunkSize?: number;
  onProgress?: (sent: number, total: number) => void;
  fetchImpl?: typeof fetch;
  headers?: Record<string, string>;
  /** HEAD the session first and resume from its offset. Default true. */
  resume?: boolean;
  /** Per-chunk retry attempts. Default 3. */
  retries?: number;
  signal?: AbortSignal;
}

export interface StreamChunksParallelOptions {
  chunkSize?: number;
  /** Max in-flight part uploads. Default 3. */
  concurrency?: number;
  onProgress?: (sentBytes: number, total: number) => void;
  fetchImpl?: typeof fetch;
  headers?: Record<string, string>;
  /** Per-part retry attempts. Default 3. */
  retries?: number;
  signal?: AbortSignal;
}

const DEFAULT_CHUNK = 5 * 1024 * 1024;
const DEFAULT_CONCURRENCY = 3;
const DEFAULT_RETRIES = 3;

function encodeMetadata(meta: Record<string, string>): string {
  return Object.entries(meta)
    .map(([k, v]) => `${k} ${btoa(v)}`)
    .join(',');
}

async function withRetry<T>(attempts: number, fn: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise((r) => setTimeout(r, attempt * 500));
    }
  }
  throw lastError;
}

/** Open a tus session via the lib's own POST; returns its Location. */
export async function createSession(
  basePath: string,
  opts: {
    filename: string;
    contentType?: string;
    length: number;
    fetchImpl?: typeof fetch;
    headers?: Record<string, string>;
  },
): Promise<{ location: string }> {
  const doFetch = opts.fetchImpl ?? fetch;
  const create = await doFetch(basePath, {
    method: 'POST',
    headers: {
      'Tus-Resumable': '1.0.0',
      'Upload-Length': String(opts.length),
      'Upload-Metadata': encodeMetadata({
        filename: opts.filename,
        ...(opts.contentType ? { filetype: opts.contentType } : {}),
      }),
      ...(opts.headers ?? {}),
    },
  });
  const location = create.headers.get('Location');
  if (!location) throw new Error('media upload: server did not return a Location');
  return { location };
}

/** Sequential tus streaming against an already-opened session location. */
export async function streamChunks(
  location: string,
  data: Blob,
  opts: StreamChunksOptions = {},
): Promise<void> {
  const doFetch = opts.fetchImpl ?? fetch;
  const chunkSize = opts.chunkSize ?? DEFAULT_CHUNK;
  const retries = opts.retries ?? DEFAULT_RETRIES;
  const total = data.size;

  let offset = 0;
  if (opts.resume !== false) {
    const head = await doFetch(location, {
      method: 'HEAD',
      headers: { 'Tus-Resumable': '1.0.0', ...(opts.headers ?? {}) },
    });
    if (head.ok) offset = Number(head.headers.get('Upload-Offset') ?? '0') || 0;
  }
  opts.onProgress?.(offset, total);

  while (offset < total) {
    if (opts.signal?.aborted) throw new Error('Upload aborted');
    const end = Math.min(offset + chunkSize, total);
    const slice = data.slice(offset, end);
    const reported = await withRetry(retries, async () => {
      const res = await doFetch(location, {
        method: 'PATCH',
        headers: {
          'Tus-Resumable': '1.0.0',
          'Content-Type': 'application/offset+octet-stream',
          'Upload-Offset': String(offset),
          ...(opts.headers ?? {}),
        },
        body: slice,
      });
      if (!('ok' in res) || res.ok === false) throw new Error(`media upload: PATCH failed at offset ${offset}`);
      const value = Number(res.headers.get('Upload-Offset') ?? '');
      return Number.isFinite(value) && value > offset ? value : end;
    });
    offset = reported;
    opts.onProgress?.(offset, total);
  }
}

/** Parallel streaming: PUT each part by number (concurrency-pooled), then complete. */
export async function streamChunksParallel(
  location: string,
  data: Blob,
  opts: StreamChunksParallelOptions = {},
): Promise<void> {
  const doFetch = opts.fetchImpl ?? fetch;
  const chunkSize = opts.chunkSize ?? DEFAULT_CHUNK;
  const concurrency = opts.concurrency ?? DEFAULT_CONCURRENCY;
  const retries = opts.retries ?? DEFAULT_RETRIES;
  const total = data.size;
  const partCount = Math.max(1, Math.ceil(total / chunkSize));

  let nextIndex = 0; // 0-based part index the next worker will claim
  let sent = 0;

  const worker = async (): Promise<void> => {
    while (true) {
      if (opts.signal?.aborted) throw new Error('Upload aborted');
      const index = nextIndex;
      nextIndex += 1;
      if (index >= partCount) return;
      const start = index * chunkSize;
      const end = Math.min(start + chunkSize, total);
      const slice = data.slice(start, end);
      const partNumber = index + 1; // S3 parts are 1-based
      await withRetry(retries, async () => {
        const res = await doFetch(`${location}/parts/${partNumber}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/offset+octet-stream', ...(opts.headers ?? {}) },
          body: slice,
        });
        if (!('ok' in res) || res.ok === false) throw new Error(`media upload: PUT part ${partNumber} failed`);
      });
      sent += end - start;
      opts.onProgress?.(sent, total);
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, partCount) }, () => worker()));

  const done = await doFetch(`${location}/complete`, {
    method: 'POST',
    headers: { ...(opts.headers ?? {}) },
  });
  if (!('ok' in done) || done.ok === false) throw new Error('media upload: complete failed');
}

/** Resumable sequential upload of a Blob/File through the tus endpoints; returns its Location. */
export async function uploadMedia(data: Blob, options: UploadMediaOptions): Promise<UploadMediaResult> {
  const base = options.basePath ?? '/media/uploads';
  const { location } = await createSession(base, {
    filename: options.filename,
    ...(options.contentType ? { contentType: options.contentType } : {}),
    length: data.size,
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    ...(options.headers ? { headers: options.headers } : {}),
  });
  await streamChunks(location, data, {
    ...(options.chunkSize ? { chunkSize: options.chunkSize } : {}),
    ...(options.onProgress ? { onProgress: options.onProgress } : {}),
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    ...(options.headers ? { headers: options.headers } : {}),
  });
  return { location };
}

/** Parallel upload: create a session, PUT parts concurrently, then complete. */
export async function uploadMediaParallel(
  data: Blob,
  options: UploadMediaOptions & { concurrency?: number },
): Promise<UploadMediaResult> {
  const base = options.basePath ?? '/media/uploads';
  const { location } = await createSession(base, {
    filename: options.filename,
    ...(options.contentType ? { contentType: options.contentType } : {}),
    length: data.size,
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    ...(options.headers ? { headers: options.headers } : {}),
  });
  await streamChunksParallel(location, data, {
    ...(options.chunkSize ? { chunkSize: options.chunkSize } : {}),
    ...(options.concurrency ? { concurrency: options.concurrency } : {}),
    ...(options.onProgress ? { onProgress: options.onProgress } : {}),
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    ...(options.headers ? { headers: options.headers } : {}),
  });
  return { location };
}

/** Build a media URL by id, optionally for a named conversion. */
export function mediaUrl(id: string, conversion?: string): string {
  const query = conversion ? `?conversion=${encodeURIComponent(conversion)}` : '';
  return `/media/${encodeURIComponent(id)}${query}`;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd packages/client && npx vitest run src/index.spec.ts`
Expected: PASS (parallel + back-compat).

- [ ] **Step 5: Typecheck + lint**

Run: `cd packages/client && npx tsc --noEmit && cd ../.. && npx biome check packages/client/src/index.ts packages/client/src/index.spec.ts`
Expected: exit 0.

- [ ] **Step 6: Add the changeset** — `.changeset/media-client-parallel.md`:

```markdown
---
"@dudousxd/nestjs-media-client": patch
---

Split `uploadMedia` into reusable `createSession` + `streamChunks`, add
`streamChunksParallel` (concurrency-pooled part PUTs) and `uploadMediaParallel`, and a
`headers` option so hosts can inject auth. `uploadMedia` behaviour is unchanged.
```

- [ ] **Step 7: Commit**

```bash
git add packages/client/src/index.ts packages/client/src/index.spec.ts .changeset/media-client-parallel.md
git commit -m "feat(client): split uploadMedia + parallel streaming"
```

---

### Task 6: react — `useMediaUpload` parallel option

**Files:**
- Modify: `packages/react/src/use-media-upload.ts`
- Test: `packages/react/src/use-media-upload.spec.ts` (existing — append) or `media-uploader.spec.ts` per the package's convention
- Add: `.changeset/media-react-parallel.md`

**Interfaces:**
- Consumes: `uploadMedia`, `uploadMediaParallel` (Task 5).
- Produces: `UseMediaUploadOptions` gains `parallel?: boolean` and `concurrency?: number`.

- [ ] **Step 1: Write the failing test** — append to the react hook's spec (mirror its existing render/act setup):

```ts
it('routes to uploadMediaParallel when parallel is set', async () => {
  // Follow the file's existing pattern for stubbing the client + rendering the hook.
  // Assert the parallel client function is invoked (spy) when options.parallel === true,
  // and the sequential one when it is not.
});
```

Fill this in against the file's actual test harness (the existing spec shows how it stubs `@dudousxd/nestjs-media-client` and drives `upload(...)`). The assertion: with `parallel: true`, `uploadMediaParallel` is called; default calls `uploadMedia`.

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/react && npx vitest run`
Expected: FAIL on the new assertion.

- [ ] **Step 3: Implement.** In `packages/react/src/use-media-upload.ts`:

1. Change the import to include the parallel function:
```ts
import { type UploadMediaResult, uploadMedia, uploadMediaParallel } from '@dudousxd/nestjs-media-client';
```
2. Add to `UseMediaUploadOptions` (find the interface in the file):
```ts
  /** Upload parts concurrently through the backend (proxy-parallel). Default false. */
  parallel?: boolean;
  /** Max in-flight parts when `parallel` is set. Default 3. */
  concurrency?: number;
```
3. In the `upload` callback, choose the client function and pass concurrency:
```ts
const uploadFn = options.parallel ? uploadMediaParallel : uploadMedia;
const result = await uploadFn(file, {
  filename: meta.filename,
  ...(meta.contentType ? { contentType: meta.contentType } : {}),
  ...(options.basePath ? { basePath: options.basePath } : {}),
  ...(options.chunkSize ? { chunkSize: options.chunkSize } : {}),
  ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
  ...(options.parallel && options.concurrency ? { concurrency: options.concurrency } : {}),
  onProgress: (sent, total) => setState((s) => ({ ...s, progress: total ? sent / total : 0 })),
});
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd packages/react && npx vitest run`
Expected: PASS.

- [ ] **Step 5: Typecheck + lint + changeset**

Run: `cd packages/react && npx tsc --noEmit && cd ../.. && npx biome check packages/react/src/use-media-upload.ts packages/react/src/use-media-upload.spec.ts`
Add `.changeset/media-react-parallel.md`:

```markdown
---
"@dudousxd/nestjs-media-react": patch
---

`useMediaUpload` gains opt-in `parallel` + `concurrency` options that route to
`uploadMediaParallel`. Default behaviour (sequential) is unchanged.
```

- [ ] **Step 6: Commit**

```bash
git add packages/react/src/use-media-upload.ts packages/react/src/use-media-upload.spec.ts .changeset/media-react-parallel.md
git commit -m "feat(react): useMediaUpload parallel option"
```

---

### Task 7: codegen — emit `uploadMediaParallel` + re-export the split

**Files:**
- Modify: `packages/codegen/src/media-client-template.ts`
- Test: `packages/codegen/src/media.extension.spec.ts` (existing — append a template assertion)
- Add: `.changeset/media-codegen-parallel.md`

**Interfaces:**
- Consumes: the client exports (Task 5).
- Produces: generated `uploadMediaParallel()` bound to `BASE_PATH`; re-exported `createSession`/`streamChunks`/`streamChunksParallel` and their option types.

- [ ] **Step 1: Write the failing test** — append to `packages/codegen/src/media.extension.spec.ts` (or wherever `renderMediaClient` is tested):

```ts
import { renderMediaClient } from './media-client-template';

it('generated client exposes uploadMediaParallel bound to the base path', () => {
  const out = renderMediaClient('/api/media/uploads');
  expect(out).toContain('export function uploadMediaParallel');
  expect(out).toContain('uploadMediaParallelBase(data, { basePath: BASE_PATH');
  expect(out).toContain("export { mediaUrl, createSession, streamChunks, streamChunksParallel }");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/codegen && npx vitest run`
Expected: FAIL — the template lacks the parallel binding.

- [ ] **Step 3: Implement** — replace `renderMediaClient` in `packages/codegen/src/media-client-template.ts`:

```ts
export function renderMediaClient(basePath: string): string {
  return `// Generated by @dudousxd/nestjs-media-codegen — do not edit.
// Thin binding over @dudousxd/nestjs-media-client with the project's tus base path.
import {
  mediaUrl,
  createSession,
  streamChunks,
  streamChunksParallel,
  uploadMedia as uploadMediaBase,
  uploadMediaParallel as uploadMediaParallelBase,
  type UploadMediaOptions,
  type UploadMediaResult,
} from '@dudousxd/nestjs-media-client';

const BASE_PATH = ${JSON.stringify(basePath)};

/** Resumable (tus, sequential) upload to this project's media endpoint. */
export function uploadMedia(
  data: Blob,
  options: Omit<UploadMediaOptions, 'basePath'>,
): Promise<UploadMediaResult> {
  return uploadMediaBase(data, { basePath: BASE_PATH, ...options });
}

/** Proxy-parallel upload (concurrent part uploads through the backend). */
export function uploadMediaParallel(
  data: Blob,
  options: Omit<UploadMediaOptions, 'basePath'> & { concurrency?: number },
): Promise<UploadMediaResult> {
  return uploadMediaParallelBase(data, { basePath: BASE_PATH, ...options });
}

export { mediaUrl, createSession, streamChunks, streamChunksParallel };
export type { UploadMediaOptions, UploadMediaResult };
`;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd packages/codegen && npx vitest run`
Expected: PASS.

- [ ] **Step 5: Typecheck + lint + changeset**

Run: `cd packages/codegen && npx tsc --noEmit && cd ../.. && npx biome check packages/codegen/src/media-client-template.ts packages/codegen/src/media.extension.spec.ts`
Add `.changeset/media-codegen-parallel.md`:

```markdown
---
"@dudousxd/nestjs-media-codegen": patch
---

The generated media client now also emits `uploadMediaParallel()` bound to the project's
base path and re-exports `createSession`/`streamChunks`/`streamChunksParallel`.
```

- [ ] **Step 6: Commit**

```bash
git add packages/codegen/src/media-client-template.ts packages/codegen/src/media.extension.spec.ts .changeset/media-codegen-parallel.md
git commit -m "feat(codegen): generate uploadMediaParallel binding"
```

---

### Task 8: disk-s3 — real parallel round-trip over MinIO (e2e)

**Files:**
- Create: `packages/disk-s3/src/parallel-upload.db.spec.ts`
- (No changeset — this is a test-only addition to a package already bumped elsewhere? No: disk-s3 is untouched by production code here, so NO changeset.)

**Interfaces:**
- Consumes: `S3Driver` (disk-s3), `ResumableUploadManager` (core), `InMemoryUploadSessionStore` (testing, Tasks 1+2), MinIO via `testcontainers` (pattern from `s3-driver.db.spec.ts`).
- Produces: proof that concurrent `writePart` → `complete` lands a byte-identical object in S3.

- [ ] **Step 1: Write the test** — `packages/disk-s3/src/parallel-upload.db.spec.ts`, mirroring the MinIO setup in `s3-driver.db.spec.ts` (`GenericContainer('minio/minio:latest')`, `forcePathStyle: true`, a created bucket):

```ts
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { ResumableUploadManager } from '@dudousxd/nestjs-media-core';
import { InMemoryUploadSessionStore } from '@dudousxd/nestjs-media-testing';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { S3Driver } from './s3-driver';
// Reuse the bucket-creation + client wiring exactly as s3-driver.db.spec.ts does.

describe('parallel multipart round trip (MinIO)', () => {
  let container: StartedTestContainer;
  let client: S3Client;
  const bucket = 'media-parallel';

  beforeAll(async () => {
    // Copy the container + client + CreateBucket setup from s3-driver.db.spec.ts,
    // pointing `client` at the MinIO endpoint with forcePathStyle:true and creating `bucket`.
  }, 120_000);

  afterAll(async () => {
    await container?.stop();
  });

  it('concurrent, out-of-order writePart then complete lands the exact bytes', async () => {
    const disk = new S3Driver({ client, bucket });
    const manager = new ResumableUploadManager({
      storage: { disk: () => disk } as any,
      sessions: new InMemoryUploadSessionStore(),
      emitDiagnostics: false,
    });

    // 6 MiB + 2 MiB (first part must be >= 5 MiB for S3 multipart).
    const MIB = 1024 * 1024;
    const part1 = Buffer.alloc(6 * MIB, 1);
    const part2 = Buffer.alloc(2 * MIB, 2);
    const key = 'k/parallel.bin';
    const session = await manager.createUpload({ disk: bucket, key, size: part1.length + part2.length });

    // Upload out of order + concurrently.
    await Promise.all([
      manager.writePart(session.id, 2, part2),
      manager.writePart(session.id, 1, part1),
    ]);
    const result = await manager.complete(session.id);
    expect(result.key).toBe(key);

    const got = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const bytes = Buffer.from(await got.Body!.transformToByteArray());
    expect(bytes.length).toBe(part1.length + part2.length);
    expect(bytes.subarray(0, part1.length).equals(part1)).toBe(true);
    expect(bytes.subarray(part1.length).equals(part2)).toBe(true);
  }, 120_000);
});
```

> Note: `manager.createUpload({ disk, key, size })` must set up the S3 multipart upload (it already does when the disk is multipart-capable — verify against Task 1's `create`). `storage.disk(name)` returns the S3Driver regardless of `name` in this harness. Confirm the `S3Driver` constructor arg shape against `s3-driver.db.spec.ts` and match it.

- [ ] **Step 2: Run the e2e**

Run: `cd packages/disk-s3 && npx vitest run src/parallel-upload.db.spec.ts`
Expected: PASS (a real MinIO multipart assembled from out-of-order concurrent parts, byte-identical).

- [ ] **Step 3: Lint**

Run: `cd ../.. && npx biome check packages/disk-s3/src/parallel-upload.db.spec.ts`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add packages/disk-s3/src/parallel-upload.db.spec.ts
git commit -m "test(disk-s3): parallel multipart round trip over MinIO"
```

---

## Post-implementation (controller/reviewer handles)

- [ ] **Whole-repo gate:** `pnpm -w run build && pnpm -w run test && pnpm -w run lint` (or the repo's turbo equivalents) — all green.
- [ ] **Changeset audit:** `npx changeset status --verbose` — every touched published package is **patch**, and the summary reports **0 major bumps** (stay-0.x constraint). Investigate any major before merging the Version PR.
- [ ] **README:** document the parallel routes + the host raw-body-parser-with-per-part-cap requirement, and the telescope request-capture skip recommendation for the `…/media/uploads` subtree (from the spec's Ecosystem section). Fold into the nestjs package README in Task 4 if the reviewer prefers.

---

## Self-review notes (author)

- **Spec coverage:** client split (T5), parallel core writePart/listParts/ordered-complete (T1), store addPart/listParts — redis (T3) + in-memory (T2), nestjs routes (T4), react (T6), codegen (T7), e2e MinIO (T8), telescope/adapters no-change (no task needed — verified in spec), all-patch changesets (each task), README/host-guidance (post-impl). No gaps.
- **Type consistency:** `MultipartPart = { partNumber; etag }` used identically in T1/T2/T3/T8; `writePart(id, partNumber, chunk)`, `listParts(id)`, `addPart(id, part)` signatures match across manager/store/controller; client `streamChunksParallel(location, data, opts)` and route shapes (`/parts/:n`, `/complete`) match T4 routes.
- **Stay-0.x:** every changeset is `patch`; audit step enforces 0 majors.
