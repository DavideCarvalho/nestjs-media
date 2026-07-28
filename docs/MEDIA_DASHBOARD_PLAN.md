# Media Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a first-class Telescope dashboard tab for `@dudousxd/nestjs-media` (Path A — a declarative Telescope extension, no UI bundle) that renders live uploads, upload activity, the media-library aggregates, and disk config, backed by real `MediaStore` aggregate methods and an exposed upload-session store.

**Architecture:** Mirror `nestjs-durable/packages/telescope` one-for-one. The `@dudousxd/nestjs-media-telescope` package gains a `mediaTelescopeExtension()` factory that calls `defineTelescopeExtension({ name, watchers, entryTypes, dashboards, dataProviders })`. Server-side `DataProvider.resolve()` functions read three source families through the extension's `ctx.moduleRef`: (1) the recorded `aviary:media:*` event history in `TELESCOPE_STORAGE` (aggregated in-process, exactly like durable's `fetchEntries`), (2) new `MediaStore.count()`/`aggregate()` methods exposed via a `MEDIA_STORE` DI token, and (3) the live upload-session store exposed via a new `MEDIA_UPLOAD_SESSIONS` DI token plus a `StorageManager` reached via the existing `MEDIA_STORAGE` token. The generic Telescope UI renders every panel — the library ships **zero frontend**.

**Tech Stack:** TypeScript (strict), pnpm + turbo workspace, tsup (dual ESM+CJS), vitest, biome, changesets. Peer libs: `@dudousxd/nestjs-telescope` (^1.0.0, dev-pinned 1.11.2), `@dudousxd/nestjs-media-core` (workspace), `@dudousxd/nestjs-diagnostics`. ORMs: MikroORM, Prisma, TypeORM, Drizzle. Redis via ioredis-shaped `MinimalRedis`.

## Global Constraints

- **Monorepo publish flow:** changesets Version PR → merge → CI publishes. NEVER `pnpm publish` by hand. `.changeset/config.json` `baseBranch: "main"`, `access: "public"`.
- **Everything stays 0.x.** Optional/additive changes = patch or minor. A `-core` **minor** can major all dependents under changesets 0.x-graduation; keep every bump 0.x by choosing **patch/minor** deliberately and scrutinising the generated Version PR (see Wave D). Current versions: core `0.6.5`, database-* `0.5.5`, upload-redis `0.7.5`, nestjs `0.6.6`, testing `0.5.5`, telescope `0.5.5`.
- **Strict TS. No `as`/`any`/`unknown`/`never` escapes** except the ONE pre-existing Prisma-delegate `any` boundary (`type Args = any`), which already exists and may be extended in kind. Prefer Zod/guards/unions elsewhere.
- **Naming:** descriptive names, no single-letter shorthands, function declarations over arrows for top-level helpers where the file's existing style uses them (durable's data-providers use `function` declarations — match that).
- **Tests:** match each package's existing vitest style. Root runner is `pnpm exec vitest run <path>`. Typecheck per package: `pnpm --filter <pkg-name> typecheck`. Build per package: `pnpm --filter <pkg-name> build`. Adapter DB suites (`*.db.spec.ts`) may be gated behind a real database — run what the package already runs in CI.
- **Commits:** conventional-commit style, no Claude attribution, no `Co-Authored-By`, no "Generated with" footer. Commit explicit paths (no `git add -A`).
- **Cross-package token decoupling:** the new DI tokens (`MEDIA_UPLOAD_SESSIONS`, `MEDIA_STORE`) use `Symbol.for('nestjs-media:<key>')` (the global symbol registry), so the telescope package references them **by value without importing** `@dudousxd/nestjs-media-nestjs` — dodging the ESM/CJS dual-copy problem. Existing plain `Symbol()` tokens are left unchanged.

### Instrumentation legend (from proposal §3, §5)

Every panel is tagged. **[live]** = queryable today. **[new-events]** = provider-only, reads already-recorded `TELESCOPE_STORAGE` events. **[new-store]** = needs the new `MediaStore.count/aggregate` + `MEDIA_STORE` token. **[new-token]** = needs `MEDIA_UPLOAD_SESSIONS` + `UploadSessionStore.list?()`. If an instrumentation piece is descoped, the tagged panels degrade (see each provider's empty-shape fallback) rather than crash.

---

## File Structure

**Wave A — core SPI + tokens**
- Modify `packages/core/src/resumable-upload.ts` — add `UploadSessionListFilter` + `list?()` to the `UploadSessionStore` SPI.
- Modify `packages/core/src/media-store.ts` — add `count()`/`aggregate()` + their filter/query/result types to the `MediaStore` SPI.
- Modify `packages/upload-redis/src/redis-upload-session-store.ts` — import the shared `UploadSessionListFilter` from core (drop the local copy); confirm `list()` conforms.
- Modify `packages/testing/src/in-memory-upload-session-store.ts` — implement `list()`.
- Modify `packages/testing/src/in-memory-media-store.ts` — implement `count()`/`aggregate()`.
- Modify `packages/testing/src/media-store-conformance.ts` — add count/aggregate conformance cases.
- Modify `packages/nestjs/src/tokens.ts` — add `MEDIA_UPLOAD_SESSIONS`, `MEDIA_STORE`.
- Modify `packages/nestjs/src/media.module.ts` — provide + export the two new tokens in `forRoot` and `forRootAsync`.

**Wave B — the 4 database adapters (parallel)**
- Modify `packages/database-mikro-orm/src/mikro-orm-media-store.ts` + `media.entity.ts` (indexes).
- Modify `packages/database-typeorm/src/typeorm-media-store.ts` + `media.entity.ts` (indices).
- Modify `packages/database-prisma/src/prisma-media-store.ts` + `prisma/schema.prisma` (@@index, doc model).
- Modify `packages/database-drizzle/src/drizzle-media-store.ts` + `media.schema.ts` (indexes + `CREATE INDEX IF NOT EXISTS`).

**Wave C — telescope extension**
- Create `packages/telescope/src/media-tokens.ts` — local `Symbol.for` shims for the two tokens.
- Create `packages/telescope/src/media-data-providers.ts` — all providers + shared aggregation helpers.
- Create `packages/telescope/src/media-dashboard.spec-data.ts` — the `DashboardSpec`.
- Create `packages/telescope/src/media-telescope.extension.ts` — `mediaTelescopeExtension()`.
- Modify `packages/telescope/src/index.ts` — export the three new modules.

**Wave D — release + integration**
- Create changeset(s) under `.changeset/`.
- Create/append `packages/telescope/README.md` — host registration snippet.

---

## Interfaces defined by this plan (canonical names — use verbatim across waves)

```ts
// core/src/resumable-upload.ts
export interface UploadSessionListFilter { disk?: string; keyPrefix?: string }
// added to UploadSessionStore:
list?(filter?: UploadSessionListFilter): Promise<UploadSession[]>;

// core/src/media-store.ts
export interface MediaCountFilter { ownerType?: string; collection?: string; disk?: string }
export interface MediaAggregateQuery { groupBy: 'collection' | 'disk'; sum?: 'size' }
export interface MediaAggregateBucket { key: string; count: number; sumSize: number }
export type MediaAggregateResult = MediaAggregateBucket[];
// added to MediaStore (OPTIONAL — additive, non-breaking for external stores;
// first-party adapters implement them, dashboard providers degrade to empty shape
// when a store omits them; keeps the change a safe patch/minor with no 0.x graduation):
count?(filter?: MediaCountFilter): Promise<number>;
aggregate?(query: MediaAggregateQuery): Promise<MediaAggregateResult>;

// nestjs/src/tokens.ts
export const MEDIA_UPLOAD_SESSIONS: unique symbol; // Symbol.for('nestjs-media:upload-sessions')
export const MEDIA_STORE: unique symbol;           // Symbol.for('nestjs-media:store')

// telescope providers (names bound by the dashboard spec)
'media.inProgressUploads' | 'media.activeUploadCount' | 'media.uploadSuccessRate' |
'media.uploadsOverTime' | 'media.uploadThroughput' | 'media.recentUploads' |
'media.libraryTotals' | 'media.byCollection' | 'media.storageByDisk' |
'media.storageWritesOverTime' | 'media.attachmentActivity' | 'media.disks'
```

---

## Wave A — Core SPI + Tokens

### Task A1: `UploadSessionStore.list?()` + `UploadSessionListFilter` in core

**Files:**
- Modify: `packages/core/src/resumable-upload.ts` (the `UploadSessionStore` interface, ~lines 30-40)
- Test: `packages/core/src/resumable-upload.spec.ts` (append; if the file's SPI section doesn't exist, add a small typed-shape test)

**Interfaces:**
- Produces: `UploadSessionListFilter { disk?: string; keyPrefix?: string }`, and `UploadSessionStore.list?(filter?): Promise<UploadSession[]>`.

- [ ] **Step 1: Write the failing test** — a compile-level contract test that a store implementing `list` satisfies the SPI.

```ts
// packages/core/src/resumable-upload.spec.ts (add)
import { describe, expect, it } from 'vitest';
import type { UploadSession, UploadSessionListFilter, UploadSessionStore } from './resumable-upload';

describe('UploadSessionStore.list SPI', () => {
  it('accepts a store that implements the optional list()', async () => {
    const session: UploadSession = {
      id: 'a', disk: 'local', key: 'k', contentType: undefined,
      size: 10, offset: 5, parts: 1,
    };
    const filter: UploadSessionListFilter = { disk: 'local' };
    const store: UploadSessionStore = {
      create: async (s) => s, get: async () => session,
      update: async (s) => s, delete: async () => {},
      list: async (f?: UploadSessionListFilter) => (f?.disk === 'local' ? [session] : []),
    };
    expect(await store.list?.(filter)).toEqual([session]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — `pnpm exec vitest run packages/core/src/resumable-upload.spec.ts` → FAIL (`UploadSessionListFilter` not exported / `list` not on type).

- [ ] **Step 3: Implement** — add the filter type above the `UploadSessionStore` interface and the optional method inside it:

```ts
/** Optional filter for {@link UploadSessionStore.list}. */
export interface UploadSessionListFilter {
  /** Only sessions on this disk. */
  disk?: string;
  /** Only sessions whose `key` starts with this prefix. */
  keyPrefix?: string;
}

/** Persistence SPI for resumable upload sessions (in-memory impl in `-testing`). */
export interface UploadSessionStore {
  create(session: UploadSession): Promise<UploadSession>;
  get(id: string): Promise<UploadSession | null>;
  update(session: UploadSession): Promise<UploadSession>;
  delete(id: string): Promise<void>;
  addPart?(id: string, part: MultipartPart): Promise<void>;
  listParts?(id: string): Promise<MultipartPart[]>;
  /**
   * List currently-stored (in-progress) sessions, optionally filtered. Admin-facing
   * (an "uploads in progress" view), not a hot path. Optional: stores that cannot
   * enumerate (or a minimal impl) omit it, and callers degrade to an empty list.
   */
  list?(filter?: UploadSessionListFilter): Promise<UploadSession[]>;
}
```

- [ ] **Step 4: Run test to verify it passes** — `pnpm exec vitest run packages/core/src/resumable-upload.spec.ts` → PASS.

- [ ] **Step 5: Typecheck** — `pnpm --filter @dudousxd/nestjs-media-core typecheck` → clean.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/resumable-upload.ts packages/core/src/resumable-upload.spec.ts
git commit -m "feat(core): add optional UploadSessionStore.list() + UploadSessionListFilter to the SPI"
```

---

### Task A2: `MediaStore.count()` / `aggregate()` in the core SPI

**Files:**
- Modify: `packages/core/src/media-store.ts`
- Test: `packages/core/src/media-store.spec.ts` (create — a typed-shape contract test)

**Interfaces:**
- Consumes: `MediaRecord` (from `./media-record`).
- Produces: `MediaCountFilter`, `MediaAggregateQuery`, `MediaAggregateBucket`, `MediaAggregateResult`, and the two new **required** methods `count()` / `aggregate()` on `MediaStore`.

> **Decision (proposal Q2):** these are **real first-class SPI methods**, not direct SQL. They are **required** (not optional) so every in-repo store implements them and the conformance suite enforces them. **Risk flagged in Wave D:** this is a breaking change for any *external* custom `MediaStore` — acceptable under 0.x, but the changeset must be a **minor** and the Version PR scrutinised so it doesn't graduate a dependent to 1.0.

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/src/media-store.spec.ts
import { describe, expect, it } from 'vitest';
import type {
  MediaAggregateQuery, MediaAggregateResult, MediaCountFilter, MediaStore,
} from './media-store';

describe('MediaStore aggregate SPI', () => {
  it('types count() and aggregate() on the interface', async () => {
    const filter: MediaCountFilter = { disk: 'local' };
    const query: MediaAggregateQuery = { groupBy: 'collection', sum: 'size' };
    const result: MediaAggregateResult = [{ key: 'gallery', count: 2, sumSize: 8 }];
    const store: Pick<MediaStore, 'count' | 'aggregate'> = {
      count: async (f?: MediaCountFilter) => (f?.disk === 'local' ? 3 : 0),
      aggregate: async (q: MediaAggregateQuery) => (q.groupBy === 'collection' ? result : []),
    };
    expect(await store.count(filter)).toBe(3);
    expect(await store.aggregate(query)).toEqual(result);
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — `pnpm exec vitest run packages/core/src/media-store.spec.ts` → FAIL (types not exported).

- [ ] **Step 3: Implement** — replace `packages/core/src/media-store.ts` body:

```ts
import type { MediaRecord } from './media-record';

/** Filter for {@link MediaStore.count}. All fields AND together; omit for a global count. */
export interface MediaCountFilter {
  ownerType?: string;
  collection?: string;
  disk?: string;
}

/** Group-by aggregate query for {@link MediaStore.aggregate}. */
export interface MediaAggregateQuery {
  /** Column to group rows by. */
  groupBy: 'collection' | 'disk';
  /** Include a summed byte total per group when `'size'`. */
  sum?: 'size';
}

/** One group of the aggregate result. `sumSize` is 0 when `sum` was not requested. */
export interface MediaAggregateBucket {
  key: string;
  count: number;
  sumSize: number;
}

export type MediaAggregateResult = MediaAggregateBucket[];

/**
 * Persistence SPI for media records. Implemented per ORM as a POJO that receives
 * the connection in its constructor (see §3.10 of the ecosystem audit).
 */
export interface MediaStore {
  save(record: MediaRecord): Promise<MediaRecord>;
  find(id: string): Promise<MediaRecord | null>;
  /** Records for an owner, optionally a single collection, ordered by `order` asc. */
  listByOwner(ownerType: string, ownerId: string, collection?: string): Promise<MediaRecord[]>;
  delete(id: string): Promise<void>;
  /** Next `order` value for appending to a collection (0-based). */
  nextOrder(ownerType: string, ownerId: string, collection: string): Promise<number>;
  /** Global record count across all owners, optionally filtered. Dashboard/admin use. */
  count(filter?: MediaCountFilter): Promise<number>;
  /** Group-by rollup ({@link MediaAggregateBucket}[]) across all owners. Dashboard/admin use. */
  aggregate(query: MediaAggregateQuery): Promise<MediaAggregateResult>;
}
```

- [ ] **Step 4: Run test to verify it passes** — `pnpm exec vitest run packages/core/src/media-store.spec.ts` → PASS.

- [ ] **Step 5: Typecheck** — `pnpm --filter @dudousxd/nestjs-media-core typecheck`. NOTE: this will now surface downstream type errors in adapters/testing that don't implement the methods — that is expected; those are fixed in Tasks A5 and Wave B. Core itself must be clean.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/media-store.ts packages/core/src/media-store.spec.ts
git commit -m "feat(core): add required MediaStore.count()/aggregate() aggregate SPI"
```

---

### Task A3: `MEDIA_UPLOAD_SESSIONS` + `MEDIA_STORE` DI tokens (nestjs)

**Files:**
- Modify: `packages/nestjs/src/tokens.ts`
- Modify: `packages/nestjs/src/media.module.ts` (`forRoot` providers/exports ~lines 123-148; `forRootAsync` providers/exports ~lines 152-214)
- Test: `packages/nestjs/src/media.module.spec.ts` (append or create)

**Interfaces:**
- Consumes: `UploadSessionStore`, `MediaStore` (from core — already exported); `MediaModuleOptions.uploadSessions`, `MediaModuleOptions.store`.
- Produces: `MEDIA_UPLOAD_SESSIONS`, `MEDIA_STORE` tokens, each provided as `useValue: options.uploadSessions ?? null` / `options.store ?? null` and exported.

> **Why `Symbol.for`:** the telescope package must resolve these tokens via `moduleRef.get()` **without importing** `@dudousxd/nestjs-media-nestjs` (heavy, pulls controllers). `Symbol.for('nestjs-media:...')` returns the process-global registry singleton, so the telescope package re-declares the same key in `media-tokens.ts` (Task C1) and gets the identical symbol by value. Existing tokens stay plain `Symbol()`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/nestjs/src/media.module.spec.ts (add)
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { InMemoryDriver, InMemoryMediaStore, InMemoryUploadSessionStore } from '@dudousxd/nestjs-media-testing';
import { MediaModule } from './media.module';
import { MEDIA_STORE, MEDIA_UPLOAD_SESSIONS } from './tokens';

describe('MediaModule token exposure', () => {
  it('exposes the store and upload-session store under stable Symbol.for tokens', async () => {
    const store = new InMemoryMediaStore();
    const sessions = new InMemoryUploadSessionStore();
    const moduleRef = await Test.createTestingModule({
      imports: [
        MediaModule.forRoot({
          default: 'local', disks: { local: new InMemoryDriver() },
          store, uploadSessions: sessions,
        }),
      ],
    }).compile();

    expect(moduleRef.get(MEDIA_STORE, { strict: false })).toBe(store);
    expect(moduleRef.get(MEDIA_UPLOAD_SESSIONS, { strict: false })).toBe(sessions);
    // Symbol.for identity: an independently-declared symbol resolves the same provider.
    expect(moduleRef.get(Symbol.for('nestjs-media:store'), { strict: false })).toBe(store);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `pnpm exec vitest run packages/nestjs/src/media.module.spec.ts` → FAIL (tokens undefined).

- [ ] **Step 3: Add tokens** — append to `packages/nestjs/src/tokens.ts`:

```ts
// Cross-package tokens: `Symbol.for` (global registry) so the telescope extension can
// resolve them by value without importing this package (dodges the ESM/CJS dual-copy).
/** The configured `MediaStore` (or `null`). Consumed by the media telescope dashboard. */
export const MEDIA_STORE = Symbol.for('nestjs-media:store');
/** The configured `UploadSessionStore` (or `null`). Consumed by the media telescope dashboard. */
export const MEDIA_UPLOAD_SESSIONS = Symbol.for('nestjs-media:upload-sessions');
```

- [ ] **Step 4: Wire `forRoot`** — in `media.module.ts` `forRoot`, add to `providers` (after `MEDIA_DIRECT`) and to `exports`:

```ts
// providers: (add)
{ provide: MEDIA_STORE, useValue: options.store ?? null },
{ provide: MEDIA_UPLOAD_SESSIONS, useValue: options.uploadSessions ?? null },
// exports: (add MEDIA_STORE, MEDIA_UPLOAD_SESSIONS)
```

Update the import from `./tokens` to include `MEDIA_STORE, MEDIA_UPLOAD_SESSIONS`.

- [ ] **Step 5: Wire `forRootAsync`** — add to the `providers: Provider[]` array (these resolve the same options factory the other providers use):

```ts
{
  provide: MEDIA_STORE,
  inject: options.inject ?? [],
  useFactory: async (...args: any[]) => (await options.useFactory(...args)).store ?? null,
},
{
  provide: MEDIA_UPLOAD_SESSIONS,
  inject: options.inject ?? [],
  useFactory: async (...args: any[]) => (await options.useFactory(...args)).uploadSessions ?? null,
},
```

and add `MEDIA_STORE, MEDIA_UPLOAD_SESSIONS` to the `forRootAsync` `exports` array.

- [ ] **Step 6: Run to verify it passes** — `pnpm exec vitest run packages/nestjs/src/media.module.spec.ts` → PASS. (Requires Task A5's InMemory implementations to typecheck; if running A3 before A5, use a hand-rolled `store`/`sessions` object literal with `count`/`aggregate`/`list` stubs instead of the InMemory classes.)

- [ ] **Step 7: Typecheck** — `pnpm --filter @dudousxd/nestjs-media-nestjs typecheck`.

- [ ] **Step 8: Commit**

```bash
git add packages/nestjs/src/tokens.ts packages/nestjs/src/media.module.ts packages/nestjs/src/media.module.spec.ts
git commit -m "feat(nestjs): expose MEDIA_STORE + MEDIA_UPLOAD_SESSIONS DI tokens (Symbol.for)"
```

---

### Task A4: `upload-redis` adopts the shared `UploadSessionListFilter`

**Files:**
- Modify: `packages/upload-redis/src/redis-upload-session-store.ts` (drop local `UploadSessionListFilter`, import from core)
- Test: `packages/upload-redis/src/redis-upload-session-store.spec.ts` (existing `list()` tests keep passing)

**Interfaces:**
- Consumes: `UploadSessionListFilter` (core, Task A1). `RedisUploadSessionStore.list()` already exists and already matches `list?(filter?): Promise<UploadSession[]>` — this task only unifies the type so the class provably implements the SPI method.

- [ ] **Step 1: Edit the import** — change the top import to pull the filter from core, and delete the locally-declared `UploadSessionListFilter` block:

```ts
import type {
  MultipartPart, UploadSession, UploadSessionListFilter, UploadSessionStore,
} from '@dudousxd/nestjs-media-core';
```

Delete the local `export interface UploadSessionListFilter { ... }` (lines ~34-40). Keep `list(filter: UploadSessionListFilter = {})` as-is — its signature is already `list?`-compatible.

- [ ] **Step 2: Re-export for back-compat** — so any existing importer of `UploadSessionListFilter` from `@dudousxd/nestjs-media-upload-redis` keeps working, add to `packages/upload-redis/src/index.ts`:

```ts
export type { UploadSessionListFilter } from '@dudousxd/nestjs-media-core';
```

- [ ] **Step 3: Run the existing suite** — `pnpm exec vitest run packages/upload-redis/src/redis-upload-session-store.spec.ts` → PASS (behaviour unchanged).

- [ ] **Step 4: Typecheck** — `pnpm --filter @dudousxd/nestjs-media-upload-redis typecheck`.

- [ ] **Step 5: Commit**

```bash
git add packages/upload-redis/src/redis-upload-session-store.ts packages/upload-redis/src/index.ts
git commit -m "refactor(upload-redis): use the shared core UploadSessionListFilter for SPI conformance"
```

---

### Task A5: Testing stores — `InMemoryUploadSessionStore.list()`, `InMemoryMediaStore.count()/aggregate()`, conformance cases

**Files:**
- Modify: `packages/testing/src/in-memory-upload-session-store.ts`
- Modify: `packages/testing/src/in-memory-media-store.ts`
- Modify: `packages/testing/src/media-store-conformance.ts`
- Test: driven by the conformance suite + `packages/testing/src/*.spec.ts` (the in-memory store already runs `runMediaStoreConformance`).

**Interfaces:**
- Consumes: `UploadSessionListFilter` (A1), `MediaCountFilter`/`MediaAggregateQuery`/`MediaAggregateResult` (A2).
- Produces: reference implementations every adapter's conformance run (Wave B) is checked against.

- [ ] **Step 1: Add the conformance cases first (failing).** Append to `runMediaStoreConformance` in `media-store-conformance.ts`, inside the `describe`:

```ts
    it('count returns the global total, and honours filters', async () => {
      const store = await makeStore();
      await store.save(makeRecord({ id: 'a', collection: 'gallery', disk: 'local', size: 3 }));
      await store.save(makeRecord({ id: 'b', collection: 'gallery', disk: 's3', size: 5 }));
      await store.save(makeRecord({ id: 'c', collection: 'avatar', disk: 'local', size: 7 }));
      expect(await store.count()).toBe(3);
      expect(await store.count({ collection: 'gallery' })).toBe(2);
      expect(await store.count({ disk: 'local' })).toBe(2);
      expect(await store.count({ collection: 'gallery', disk: 's3' })).toBe(1);
    });

    it('aggregate groups by collection/disk with counts and summed sizes', async () => {
      const store = await makeStore();
      await store.save(makeRecord({ id: 'a', collection: 'gallery', disk: 'local', size: 3 }));
      await store.save(makeRecord({ id: 'b', collection: 'gallery', disk: 's3', size: 5 }));
      await store.save(makeRecord({ id: 'c', collection: 'avatar', disk: 'local', size: 7 }));

      const byCollection = await store.aggregate({ groupBy: 'collection', sum: 'size' });
      const collectionMap = new Map(byCollection.map((b) => [b.key, b]));
      expect(collectionMap.get('gallery')).toEqual({ key: 'gallery', count: 2, sumSize: 8 });
      expect(collectionMap.get('avatar')).toEqual({ key: 'avatar', count: 1, sumSize: 7 });

      const byDisk = await store.aggregate({ groupBy: 'disk', sum: 'size' });
      const diskMap = new Map(byDisk.map((b) => [b.key, b]));
      expect(diskMap.get('local')).toEqual({ key: 'local', count: 2, sumSize: 10 });
      expect(diskMap.get('s3')).toEqual({ key: 's3', count: 1, sumSize: 5 });
    });
```

Run `pnpm exec vitest run packages/testing` → FAIL (`count`/`aggregate` missing on InMemory).

- [ ] **Step 2: Implement `InMemoryMediaStore`** — add to the class:

```ts
  async count(filter: import('@dudousxd/nestjs-media-core').MediaCountFilter = {}): Promise<number> {
    return [...this.records.values()].filter(
      (r) =>
        (filter.ownerType === undefined || r.ownerType === filter.ownerType) &&
        (filter.collection === undefined || r.collection === filter.collection) &&
        (filter.disk === undefined || r.disk === filter.disk),
    ).length;
  }

  async aggregate(
    query: import('@dudousxd/nestjs-media-core').MediaAggregateQuery,
  ): Promise<import('@dudousxd/nestjs-media-core').MediaAggregateResult> {
    const buckets = new Map<string, { key: string; count: number; sumSize: number }>();
    for (const record of this.records.values()) {
      const key = query.groupBy === 'collection' ? record.collection : record.disk;
      const bucket = buckets.get(key) ?? { key, count: 0, sumSize: 0 };
      bucket.count += 1;
      if (query.sum === 'size') bucket.sumSize += record.size;
      buckets.set(key, bucket);
    }
    return [...buckets.values()];
  }
```

(Prefer named imports at the top of the file rather than inline `import(...)` types — the inline form is shown only to keep the snippet self-contained. Add `MediaCountFilter, MediaAggregateQuery, MediaAggregateResult` to the existing `import type { MediaRecord, MediaStore }` line.)

- [ ] **Step 3: Implement `InMemoryUploadSessionStore.list()`** — add:

```ts
  async list(
    filter: import('@dudousxd/nestjs-media-core').UploadSessionListFilter = {},
  ): Promise<UploadSession[]> {
    return [...this.sessions.values()]
      .filter(
        (session) =>
          (filter.disk === undefined || session.disk === filter.disk) &&
          (filter.keyPrefix === undefined || session.key.startsWith(filter.keyPrefix)),
      )
      .map((session) => ({ ...session }));
  }
```

(Add `UploadSessionListFilter` to the file's `import type { ... }` from core.)

- [ ] **Step 4: Run the suite** — `pnpm exec vitest run packages/testing` → PASS.

- [ ] **Step 5: Typecheck** — `pnpm --filter @dudousxd/nestjs-media-testing typecheck`.

- [ ] **Step 6: Commit**

```bash
git add packages/testing/src/in-memory-media-store.ts packages/testing/src/in-memory-upload-session-store.ts packages/testing/src/media-store-conformance.ts
git commit -m "feat(testing): implement count/aggregate + session list() and add conformance cases"
```

---

## Wave B — Database adapters (parallel-safe)

All four tasks depend only on Task A2 (the core SPI) and Task A5 (the conformance cases they inherit). They **do not depend on each other** — dispatch B1–B4 in parallel. Each adds `count()`/`aggregate()` + indexes and is proven by its own `*.db.spec.ts` running the shared conformance suite (which now includes the count/aggregate cases). If an adapter's DB suite is gated behind a live database in CI, run it the same way CI does; otherwise verify the logic against the in-memory reference (A5) and typecheck.

**Aggregate column mapping (all adapters):** `groupBy: 'collection'` → the `collection` column; `groupBy: 'disk'` → the `disk` column; summed bytes come from the `size` column. `count`/`sumSize` are coerced to `number` (dialect drivers may return `bigint`/string for `COUNT`/`SUM`).

### Task B1: MikroORM adapter

**Files:**
- Modify: `packages/database-mikro-orm/src/mikro-orm-media-store.ts`
- Modify: `packages/database-mikro-orm/src/media.entity.ts` (add indexes)
- Test: `packages/database-mikro-orm/src/*.db.spec.ts` (runs `runMediaStoreConformance`)

- [ ] **Step 1:** Add indexes to `MediaEntity` (`EntitySchema`) — add an `indexes` array after `properties`:

```ts
  indexes: [
    { name: 'idx_media_collection', properties: ['collection'] },
    { name: 'idx_media_disk', properties: ['disk'] },
    { name: 'idx_media_created_at', properties: ['createdAt'] },
  ],
```

- [ ] **Step 2:** Implement the methods on `MikroOrmMediaStore`:

```ts
  async count(filter: MediaCountFilter = {}): Promise<number> {
    const em = this.em.fork();
    return em.count(MediaEntity, {
      ...(filter.ownerType !== undefined ? { ownerType: filter.ownerType } : {}),
      ...(filter.collection !== undefined ? { collection: filter.collection } : {}),
      ...(filter.disk !== undefined ? { disk: filter.disk } : {}),
    });
  }

  async aggregate(query: MediaAggregateQuery): Promise<MediaAggregateResult> {
    const em = this.em.fork();
    const rows = await em
      .createQueryBuilder(MediaEntity, 'm')
      .select([`m.${query.groupBy} as key`, 'count(*) as count', 'sum(m.size) as sumSize'])
      .groupBy(`m.${query.groupBy}`)
      .execute<Array<{ key: string; count: number | string; sumSize: number | string | null }>>();
    return rows.map((row) => ({
      key: row.key,
      count: Number(row.count),
      sumSize: query.sum === 'size' ? Number(row.sumSize ?? 0) : 0,
    }));
  }
```

Add `MediaAggregateQuery, MediaAggregateResult, MediaCountFilter` to the top `import type { MediaRecord, MediaStore }` line.

- [ ] **Step 3:** Run the adapter suite — `pnpm exec vitest run packages/database-mikro-orm` (its conformance run now exercises count/aggregate) → PASS. Note the `updateSchema({ safe: true })` path already picks up the new indexes non-destructively.

- [ ] **Step 4:** Typecheck — `pnpm --filter @dudousxd/nestjs-media-database-mikro-orm typecheck`.

- [ ] **Step 5:** Commit — `git add packages/database-mikro-orm/src/mikro-orm-media-store.ts packages/database-mikro-orm/src/media.entity.ts && git commit -m "feat(mikro-orm): MediaStore count/aggregate + collection/disk/createdAt indexes"`

### Task B2: TypeORM adapter

**Files:**
- Modify: `packages/database-typeorm/src/typeorm-media-store.ts`
- Modify: `packages/database-typeorm/src/media.entity.ts` (append to `indices`)
- Test: `packages/database-typeorm/src/*.db.spec.ts`

- [ ] **Step 1:** Append indices in `MediaEntity`'s `indices` array:

```ts
  indices: [
    { name: 'idx_media_owner', columns: ['ownerType', 'ownerId', 'collection'] },
    { name: 'idx_media_collection', columns: ['collection'] },
    { name: 'idx_media_disk', columns: ['disk'] },
    { name: 'idx_media_created_at', columns: ['createdAt'] },
  ],
```

(`ensureMediaSchema` already adds missing columns non-destructively; index creation for an existing table is handled by TypeORM `synchronize`/migration in the consumer — note in the changeset that pre-existing tables may need a manual `CREATE INDEX` since `ensureMediaSchema` only creates the table + adds columns, not indexes on an already-present table.)

- [ ] **Step 2:** Implement on `TypeOrmMediaStore` (note `m.order` maps to column `position`; `size` is unmapped-name safe):

```ts
  async count(filter: MediaCountFilter = {}): Promise<number> {
    await this.ready();
    return this.repo.count({
      where: {
        ...(filter.ownerType !== undefined ? { ownerType: filter.ownerType } : {}),
        ...(filter.collection !== undefined ? { collection: filter.collection } : {}),
        ...(filter.disk !== undefined ? { disk: filter.disk } : {}),
      },
    });
  }

  async aggregate(query: MediaAggregateQuery): Promise<MediaAggregateResult> {
    await this.ready();
    const rows = await this.repo
      .createQueryBuilder('m')
      .select(`m.${query.groupBy}`, 'key')
      .addSelect('COUNT(*)', 'count')
      .addSelect('SUM(m.size)', 'sumSize')
      .groupBy(`m.${query.groupBy}`)
      .getRawMany<{ key: string; count: string; sumSize: string | null }>();
    return rows.map((row) => ({
      key: row.key,
      count: Number(row.count),
      sumSize: query.sum === 'size' ? Number(row.sumSize ?? 0) : 0,
    }));
  }
```

Add the three types to the top `import type` line.

- [ ] **Step 3:** Run — `pnpm exec vitest run packages/database-typeorm` → PASS.
- [ ] **Step 4:** Typecheck — `pnpm --filter @dudousxd/nestjs-media-database-typeorm typecheck`.
- [ ] **Step 5:** Commit — `git add packages/database-typeorm/src/typeorm-media-store.ts packages/database-typeorm/src/media.entity.ts && git commit -m "feat(typeorm): MediaStore count/aggregate + collection/disk/createdAt indices"`

### Task B3: Prisma adapter

**Files:**
- Modify: `packages/database-prisma/src/prisma-media-store.ts` (extend `PrismaMediaDelegate`, implement)
- Modify: `packages/database-prisma/prisma/schema.prisma` (doc model `@@index`)
- Test: `packages/database-prisma/src/*.db.spec.ts` (real Postgres via generated client)

- [ ] **Step 1:** Extend `PrismaMediaDelegate` with the two delegate methods (structural subset; `Args = any` boundary already present):

```ts
export interface PrismaMediaDelegate {
  upsert(args: Args): Promise<MediaRecord>;
  findUnique(args: Args): Promise<MediaRecord | null>;
  findMany(args: Args): Promise<MediaRecord[]>;
  deleteMany(args: Args): Promise<{ count: number }>;
  aggregate(args: Args): Promise<{ _max: { order: number | null } }>;
  count(args: Args): Promise<number>;
  groupBy(args: Args): Promise<Array<{ [key: string]: unknown; _count: number; _sum: { size: number | null } }>>;
}
```

- [ ] **Step 2:** Implement on `PrismaMediaStore` (Prisma `groupBy` returns the grouped column keyed by its field name; `_count` here uses the scalar `_count: true` form):

```ts
  count(filter: MediaCountFilter = {}): Promise<number> {
    return this.prisma.media.count({
      where: {
        ...(filter.ownerType !== undefined ? { ownerType: filter.ownerType } : {}),
        ...(filter.collection !== undefined ? { collection: filter.collection } : {}),
        ...(filter.disk !== undefined ? { disk: filter.disk } : {}),
      },
    });
  }

  async aggregate(query: MediaAggregateQuery): Promise<MediaAggregateResult> {
    const rows = await this.prisma.media.groupBy({
      by: [query.groupBy],
      _count: true,
      _sum: { size: true },
    });
    return rows.map((row) => {
      const key = row[query.groupBy];
      return {
        key: typeof key === 'string' ? key : String(key),
        count: Number(row._count),
        sumSize: query.sum === 'size' ? Number(row._sum.size ?? 0) : 0,
      };
    });
  }
```

Add the three types to the top import.

- [ ] **Step 3:** Add doc-model indexes to `prisma/schema.prisma` (this schema is **test/doc-only** — consumers own their schema, so this documents the required indexes rather than shipping them):

```prisma
  @@index([ownerType, ownerId, collection])
  @@index([collection])
  @@index([disk])
  @@index([createdAt])
```

Also add a comment above the model: `// Consumers must add matching @@index on collection, disk, createdAt for the media dashboard aggregates.`

- [ ] **Step 4:** If the generated client is regenerated for the db.spec, run `pnpm --filter @dudousxd/nestjs-media-database-prisma <generate-script>` per the package's existing flow, then `pnpm exec vitest run packages/database-prisma` → PASS.
- [ ] **Step 5:** Typecheck — `pnpm --filter @dudousxd/nestjs-media-database-prisma typecheck`.
- [ ] **Step 6:** Commit — `git add packages/database-prisma/src/prisma-media-store.ts packages/database-prisma/prisma/schema.prisma && git commit -m "feat(prisma): MediaStore count/aggregate + documented aggregate indexes"`

### Task B4: Drizzle adapter

**Files:**
- Modify: `packages/database-drizzle/src/drizzle-media-store.ts` (implement)
- Modify: `packages/database-drizzle/src/media.schema.ts` (indexes) + `createMediaTable` (CREATE INDEX)
- Test: `packages/database-drizzle/src/*.db.spec.ts`

- [ ] **Step 1:** Add indexes to `media.schema.ts` — change the table to the callback form:

```ts
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const mediaTable = sqliteTable(
  'media',
  {
    // ...existing columns unchanged...
  },
  (table) => ({
    ownerIdx: index('idx_media_owner').on(table.ownerType, table.ownerId, table.collection),
    collectionIdx: index('idx_media_collection').on(table.collection),
    diskIdx: index('idx_media_disk').on(table.disk),
    createdAtIdx: index('idx_media_created_at').on(table.createdAt),
  }),
);
```

- [ ] **Step 2:** Extend `createMediaTable` to create the indexes (idempotent) after the `CREATE TABLE`:

```ts
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_media_collection ON media (collection)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_media_disk ON media (disk)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_media_created_at ON media (created_at)`);
```

- [ ] **Step 3:** Implement on `DrizzleMediaStore` (import `count`, `sum` from `drizzle-orm` — `count`/`sum` are already available; `sql`/`and`/`eq` already imported):

```ts
  async count(filter: MediaCountFilter = {}): Promise<number> {
    const conditions = [
      ...(filter.ownerType !== undefined ? [eq(mediaTable.ownerType, filter.ownerType)] : []),
      ...(filter.collection !== undefined ? [eq(mediaTable.collection, filter.collection)] : []),
      ...(filter.disk !== undefined ? [eq(mediaTable.disk, filter.disk)] : []),
    ];
    const rows = await this.db
      .select({ value: count() })
      .from(mediaTable)
      .where(conditions.length ? and(...conditions) : undefined);
    return Number(rows[0]?.value ?? 0);
  }

  async aggregate(query: MediaAggregateQuery): Promise<MediaAggregateResult> {
    const column = query.groupBy === 'collection' ? mediaTable.collection : mediaTable.disk;
    const rows = await this.db
      .select({ key: column, count: count(), sumSize: sum(mediaTable.size) })
      .from(mediaTable)
      .groupBy(column);
    return rows.map((row) => ({
      key: row.key,
      count: Number(row.count),
      sumSize: query.sum === 'size' ? Number(row.sumSize ?? 0) : 0,
    }));
  }
```

Update imports: `import { and, asc, count, eq, max, sql, sum } from 'drizzle-orm';` and add the three core types to the top `import type` line.

- [ ] **Step 4:** Run — `pnpm exec vitest run packages/database-drizzle` → PASS.
- [ ] **Step 5:** Typecheck — `pnpm --filter @dudousxd/nestjs-media-database-drizzle typecheck`.
- [ ] **Step 6:** Commit — `git add packages/database-drizzle/src/drizzle-media-store.ts packages/database-drizzle/src/media.schema.ts && git commit -m "feat(drizzle): MediaStore count/aggregate + collection/disk/createdAt indexes"`

---

## Wave C — Telescope extension

Depends on all of Wave A (tokens, list, count/aggregate) and — for a *live* dashboard — Wave B (adapters implement the SPI). The Wave-C tests use fakes/in-memory, so C is authorable as soon as A lands; sequence C after A+B for a coherent PR.

### Task C1: Local token shims (`media-tokens.ts`)

**Files:**
- Create: `packages/telescope/src/media-tokens.ts`

**Interfaces:**
- Produces: `MEDIA_STORE`, `MEDIA_UPLOAD_SESSIONS` — the **same** global symbols the nestjs package provides (Task A3), obtained by value via `Symbol.for` without importing that package.

- [ ] **Step 1: Write the file**

```ts
// packages/telescope/src/media-tokens.ts
// These MUST use the exact same `Symbol.for` keys as `@dudousxd/nestjs-media-nestjs`
// `tokens.ts`. The global symbol registry guarantees identity across packages, so the
// telescope providers resolve the host-provided values without importing the (heavy)
// nestjs package. Do not change these keys without changing them there too.

/** The configured `MediaStore` (or `null`), provided by MediaModule. */
export const MEDIA_STORE: symbol = Symbol.for('nestjs-media:store');
/** The configured `UploadSessionStore` (or `null`), provided by MediaModule. */
export const MEDIA_UPLOAD_SESSIONS: symbol = Symbol.for('nestjs-media:upload-sessions');
```

- [ ] **Step 2: Guard test** — `packages/telescope/src/media-tokens.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { MEDIA_STORE, MEDIA_UPLOAD_SESSIONS } from './media-tokens';

describe('media telescope tokens', () => {
  it('resolve to the shared global-registry symbols', () => {
    expect(MEDIA_STORE).toBe(Symbol.for('nestjs-media:store'));
    expect(MEDIA_UPLOAD_SESSIONS).toBe(Symbol.for('nestjs-media:upload-sessions'));
  });
});
```

- [ ] **Step 3: Run** — `pnpm exec vitest run packages/telescope/src/media-tokens.spec.ts` → PASS.
- [ ] **Step 4: Commit** — `git add packages/telescope/src/media-tokens.ts packages/telescope/src/media-tokens.spec.ts && git commit -m "feat(telescope): shared Symbol.for token shims for media dashboard providers"`

### Task C2: Data providers (`media-data-providers.ts`)

**Files:**
- Create: `packages/telescope/src/media-data-providers.ts`
- Test: `packages/telescope/src/media-data-providers.spec.ts`

**Interfaces:**
- Consumes: `DataProvider`, `ExtensionContext`, `TELESCOPE_STORAGE` (telescope); `StorageManager`, `MediaStore`, `UploadSessionStore` types (core); `MEDIA_STORE`, `MEDIA_UPLOAD_SESSIONS` (C1). `MEDIA_STORAGE` symbol — resolved via `Symbol.for`? **No** — `MEDIA_STORAGE` is a plain `Symbol()` in nestjs and is NOT reachable by value from here. Resolve the StorageManager via the same `Symbol.for('nestjs-media:store')`? No. **Decision:** the disks provider resolves the StorageManager through a THIRD shared token. Add `MEDIA_STORAGE_SHARED = Symbol.for('nestjs-media:storage')` to `media-tokens.ts` **and** to nestjs `tokens.ts`/module (see note below). To avoid expanding Wave A scope, the disks provider instead reaches the StorageManager off the resolved `MediaStore`? It cannot. **Simplest correct choice:** in Task A3, ALSO provide `{ provide: Symbol.for('nestjs-media:storage'), useExisting: MEDIA_STORAGE }` so the existing StorageManager is reachable by a global symbol. Add `MEDIA_STORAGE_SHARED` to C1 and A3.

> **Plan correction (fold into A3 + C1):** provide a `Symbol.for('nestjs-media:storage')` alias for the StorageManager. In `media.module.ts` add `{ provide: MEDIA_STORAGE_SHARED, useExisting: MEDIA_STORAGE }` (both `forRoot` and `forRootAsync`) and export it; in `media-tokens.ts` add `export const MEDIA_STORAGE_SHARED: symbol = Symbol.for('nestjs-media:storage');`. This keeps the disks panel [live] without importing the nestjs package.

- Produces: the twelve `DataProvider` factory functions named in the interfaces block.

- [ ] **Step 1: Write the failing test** (covers event aggregation, store aggregation, session listing, and graceful degradation):

```ts
import type { ExtensionContext } from '@dudousxd/nestjs-telescope';
import { describe, expect, it } from 'vitest';
import {
  mediaActiveUploadCountProvider, mediaByCollectionProvider, mediaDisksProvider,
  mediaInProgressUploadsProvider, mediaLibraryTotalsProvider, mediaRecentUploadsProvider,
  mediaStorageByDiskProvider, mediaUploadSuccessRateProvider, mediaUploadsOverTimeProvider,
} from './media-data-providers';
import { MEDIA_STORAGE_SHARED, MEDIA_STORE, MEDIA_UPLOAD_SESSIONS } from './media-tokens';

// Resolve different host services by token identity.
function ctxWith(map: Map<unknown, unknown>): ExtensionContext {
  return {
    config: {} as ExtensionContext['config'],
    moduleRef: { get: (token: unknown) => map.get(token) } as unknown as ExtensionContext['moduleRef'],
  };
}
function storageCtx(entries: Array<{ content?: unknown; createdAt?: Date }>): ExtensionContext {
  const storage = { get: async () => ({ data: entries }) };
  // TELESCOPE_STORAGE is resolved by its own token; fake .get to always return the page.
  return {
    config: {} as ExtensionContext['config'],
    moduleRef: { get: () => storage } as unknown as ExtensionContext['moduleRef'],
  };
}

describe('mediaInProgressUploadsProvider', () => {
  it('lists sessions with a computed percent', async () => {
    const sessions = { list: async () => [{ id: 'u1', disk: 'local', key: 'k', offset: 5, size: 10, parts: 1 }] };
    const map = new Map<unknown, unknown>([[MEDIA_UPLOAD_SESSIONS, sessions]]);
    const result = (await mediaInProgressUploadsProvider().resolve(undefined, ctxWith(map))) as {
      rows: Array<{ id: string; percent: number }>;
    };
    expect(result.rows[0]).toMatchObject({ id: 'u1', percent: 50 });
  });

  it('degrades to empty rows when the store is null or has no list()', async () => {
    const map = new Map<unknown, unknown>([[MEDIA_UPLOAD_SESSIONS, null]]);
    const result = (await mediaInProgressUploadsProvider().resolve(undefined, ctxWith(map))) as { rows: unknown[] };
    expect(result.rows).toEqual([]);
  });
});

describe('mediaActiveUploadCountProvider', () => {
  it('counts sessions', async () => {
    const sessions = { list: async () => [{ id: 'u1' }, { id: 'u2' }] };
    const result = (await mediaActiveUploadCountProvider().resolve(
      undefined, ctxWith(new Map([[MEDIA_UPLOAD_SESSIONS, sessions]])),
    )) as { value: number };
    expect(result.value).toBe(2);
  });
});

describe('mediaUploadSuccessRateProvider', () => {
  it('computes complete / (complete + abort)', async () => {
    const ctx = storageCtx([
      { content: { event: 'upload.complete' }, createdAt: new Date() },
      { content: { event: 'upload.complete' }, createdAt: new Date() },
      { content: { event: 'upload.abort' }, createdAt: new Date() },
    ]);
    const result = (await mediaUploadSuccessRateProvider().resolve({ windowMs: 0 }, ctx)) as { value: number };
    expect(result.value).toBeCloseTo(2 / 3);
  });
});

describe('mediaLibraryTotalsProvider', () => {
  it('returns count for metric:count and summed bytes for metric:bytes', async () => {
    const store = {
      count: async () => 4,
      aggregate: async () => [{ key: 'local', count: 4, sumSize: 40 }],
    };
    const map = new Map<unknown, unknown>([[MEDIA_STORE, store]]);
    const total = (await mediaLibraryTotalsProvider().resolve({ metric: 'count' }, ctxWith(map))) as { value: number };
    const bytes = (await mediaLibraryTotalsProvider().resolve({ metric: 'bytes' }, ctxWith(map))) as { value: number };
    expect(total.value).toBe(4);
    expect(bytes.value).toBe(40);
  });
  it('degrades to zero when MEDIA_STORE is null', async () => {
    const result = (await mediaLibraryTotalsProvider().resolve(
      { metric: 'count' }, ctxWith(new Map([[MEDIA_STORE, null]])),
    )) as { value: number };
    expect(result.value).toBe(0);
  });
});

describe('mediaByCollectionProvider / mediaStorageByDiskProvider', () => {
  it('map aggregate buckets to breakdown segments', async () => {
    const store = { aggregate: async (q: { groupBy: string }) =>
      q.groupBy === 'collection'
        ? [{ key: 'gallery', count: 2, sumSize: 8 }]
        : [{ key: 'local', count: 3, sumSize: 30 }] };
    const map = new Map<unknown, unknown>([[MEDIA_STORE, store]]);
    const byCollection = (await mediaByCollectionProvider().resolve(undefined, ctxWith(map))) as {
      segments: Array<{ label: string; value: number }>;
    };
    const byDisk = (await mediaStorageByDiskProvider().resolve(undefined, ctxWith(map))) as {
      segments: Array<{ label: string; value: number }>;
    };
    expect(byCollection.segments).toEqual([{ label: 'gallery', value: 2 }]);
    expect(byDisk.segments).toEqual([{ label: 'local', value: 30 }]);
  });
});

describe('mediaDisksProvider', () => {
  it('lists disk names with capability badges + default flag', async () => {
    const manager = {
      defaultDisk: 'local',
      diskNames: () => ['local', 's3'],
      disk: (name: string) => ({ capabilities: { presign: name === 's3', multipart: name === 's3', publicUrls: true, list: true } }),
    };
    const result = (await mediaDisksProvider().resolve(
      undefined, ctxWith(new Map([[MEDIA_STORAGE_SHARED, manager]])),
    )) as { rows: Array<{ name: string; default: string; multipart: string }> };
    expect(result.rows.map((r) => r.name)).toEqual(['local', 's3']);
    expect(result.rows[0].default).toBe('yes');
  });
});

describe('mediaRecentUploads / mediaUploadsOverTime', () => {
  it('shape the recorded upload.* events into a table and series', async () => {
    const ctx = storageCtx([
      { content: { event: 'upload.complete', id: 'u1', disk: 'local', key: 'k', size: 10 }, createdAt: new Date() },
      { content: { event: 'upload.start', id: 'u2' }, createdAt: new Date() },
      { content: { event: 'upload.abort', id: 'u3' }, createdAt: new Date() },
    ]);
    const recent = (await mediaRecentUploadsProvider().resolve(undefined, ctx)) as { rows: Array<{ id: string }> };
    expect(recent.rows.map((r) => r.id)).toContain('u1');
    const series = (await mediaUploadsOverTimeProvider().resolve({ buckets: 4 }, ctx)) as {
      rows: Array<{ label: string; started: number; completed: number; aborted: number }>;
    };
    expect(series.rows).toHaveLength(4);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `pnpm exec vitest run packages/telescope/src/media-data-providers.spec.ts` → FAIL (module not found).

- [ ] **Step 3: Implement `media-data-providers.ts`** — mirror durable's structure (shared helpers, then providers). Full file:

```ts
import type { MediaStore, StorageManager, UploadSession, UploadSessionStore } from '@dudousxd/nestjs-media-core';
import type { DataProvider, ExtensionContext } from '@dudousxd/nestjs-telescope';
import { TELESCOPE_STORAGE } from '@dudousxd/nestjs-telescope';
import { MEDIA_STORAGE_SHARED, MEDIA_STORE, MEDIA_UPLOAD_SESSIONS } from './media-tokens';

// ─── Shared helpers ───────────────────────────────────────────────────────────

type StorageEntry = { content?: unknown; createdAt?: Date };
type MediaEventContent = {
  event?: string; id?: string; disk?: string; key?: string; size?: number;
};

/** Fetch the recorded `media` entries from Telescope's own storage (bounded page). */
async function fetchMediaEntries(ctx: ExtensionContext): Promise<StorageEntry[]> {
  const storage = ctx.moduleRef.get(TELESCOPE_STORAGE, { strict: false }) as {
    get(query: { type?: string; limit?: number }): Promise<{ data: StorageEntry[] }>;
  } | null;
  if (!storage) return [];
  const page = await storage.get({ type: 'media', limit: 5_000 });
  return page.data;
}

function eventOf(entry: StorageEntry): MediaEventContent {
  return (entry.content ?? {}) as MediaEventContent;
}

/** Split entries into current (now-windowMs, now] and previous equal window. windowMs<=0 = all in current. */
function splitWindows(
  entries: StorageEntry[], windowMs: number, now: number,
): { current: StorageEntry[]; previous: StorageEntry[] } {
  if (windowMs <= 0) return { current: entries, previous: [] };
  const start = now - windowMs;
  const prevStart = start - windowMs;
  const at = (entry: StorageEntry) => (entry.createdAt ? +new Date(entry.createdAt) : 0);
  return {
    current: entries.filter((entry) => at(entry) > start && at(entry) <= now),
    previous: entries.filter((entry) => at(entry) > prevStart && at(entry) <= start),
  };
}

function countEvent(entries: StorageEntry[], event: string): number {
  return entries.filter((entry) => eventOf(entry).event === event).length;
}

// ─── Live uploads (MEDIA_UPLOAD_SESSIONS token) ────────────────────────────────

async function listSessions(ctx: ExtensionContext): Promise<UploadSession[]> {
  const store = ctx.moduleRef.get(MEDIA_UPLOAD_SESSIONS, { strict: false }) as UploadSessionStore | null;
  if (!store || typeof store.list !== 'function') return [];
  return store.list();
}

/** In-progress uploads table. [new-token] — empty when the store is null or lacks list(). */
export function mediaInProgressUploadsProvider(): DataProvider {
  return {
    name: 'media.inProgressUploads',
    async resolve(_query, ctx) {
      const sessions = await listSessions(ctx);
      const rows = sessions.map((session) => ({
        id: session.id,
        disk: session.disk,
        key: session.key,
        offset: session.offset,
        size: session.size ?? 0,
        percent: session.size ? Math.round((session.offset / session.size) * 100) : 0,
        parts: session.parts,
        multipart: session.multipartUploadId ? 'yes' : 'no',
      }));
      return { rows };
    },
  };
}

/** Active upload count stat. [new-token] */
export function mediaActiveUploadCountProvider(): DataProvider {
  return {
    name: 'media.activeUploadCount',
    async resolve(_query, ctx) {
      return { value: (await listSessions(ctx)).length };
    },
  };
}

// ─── Upload activity (event history) ───────────────────────────────────────────

/** Upload success rate = complete / (complete + abort) over the window. [new-events] */
export function mediaUploadSuccessRateProvider(): DataProvider {
  return {
    name: 'media.uploadSuccessRate',
    async resolve(query, ctx) {
      const windowMs = Number(query?.windowMs ?? 24 * 60 * 60 * 1000);
      const { current } = splitWindows(await fetchMediaEntries(ctx), windowMs, Date.now());
      const completed = countEvent(current, 'upload.complete');
      const aborted = countEvent(current, 'upload.abort');
      const total = completed + aborted;
      return { value: total === 0 ? 1 : completed / total, min: 0, max: 1 };
    },
  };
}

/** Uploads over time — started/completed/aborted per bucket. [new-events] */
export function mediaUploadsOverTimeProvider(): DataProvider {
  return {
    name: 'media.uploadsOverTime',
    async resolve(query, ctx) {
      const entries = await fetchMediaEntries(ctx);
      const buckets = Number(query?.buckets ?? 24);
      const now = Date.now();
      let minTime = now;
      for (const entry of entries) {
        const at = entry.createdAt ? +new Date(entry.createdAt) : now;
        if (at < minTime) minTime = at;
      }
      const span = Math.max(now - minTime, 1);
      const size = span / buckets;
      const rows = Array.from({ length: buckets }, (_, index) => ({
        label: new Date(minTime + index * size).toISOString().slice(11, 16),
        started: 0, completed: 0, aborted: 0,
      }));
      for (const entry of entries) {
        const event = eventOf(entry).event;
        if (event !== 'upload.start' && event !== 'upload.complete' && event !== 'upload.abort') continue;
        const at = entry.createdAt ? +new Date(entry.createdAt) : minTime;
        const row = rows[Math.min(buckets - 1, Math.floor((at - minTime) / size))];
        if (!row) continue;
        if (event === 'upload.start') row.started += 1;
        else if (event === 'upload.complete') row.completed += 1;
        else row.aborted += 1;
      }
      return { rows };
    },
  };
}

/** Upload throughput (completes per hour) + 8-bucket spark. [new-events]
 *  CAVEAT: direct uploads emit upload.complete { size: 0 } (direct-upload.ts:126), so a
 *  byte-rate would undercount them — we report COMPLETES/hour (count-based), not bytes/s. */
export function mediaUploadThroughputProvider(): DataProvider {
  return {
    name: 'media.uploadThroughput',
    async resolve(query, ctx) {
      const windowMs = Number(query?.windowMs ?? 24 * 60 * 60 * 1000);
      const now = Date.now();
      const { current, previous } = splitWindows(await fetchMediaEntries(ctx), windowMs, now);
      const hours = windowMs > 0 ? windowMs / (60 * 60 * 1000) : 1;
      const value = countEvent(current, 'upload.complete') / hours;
      const previousValue = countEvent(previous, 'upload.complete') / hours;
      const delta = previous.length > 0 ? value - previousValue : undefined;
      const sparkBuckets = 8;
      const bucketMs = (windowMs > 0 ? windowMs : now) / sparkBuckets;
      const bucketHours = bucketMs / (60 * 60 * 1000);
      const start = now - (windowMs > 0 ? windowMs : now);
      const spark = Array.from({ length: sparkBuckets }, (_, index) => {
        const from = start + index * bucketMs;
        const bucket = current.filter((entry) => {
          const at = entry.createdAt ? +new Date(entry.createdAt) : 0;
          return at > from && at <= from + bucketMs;
        });
        return countEvent(bucket, 'upload.complete') / (bucketHours || 1);
      });
      return delta === undefined ? { value, spark } : { value, delta, spark };
    },
  };
}

/** Recent completed uploads (newest first). [new-events] */
export function mediaRecentUploadsProvider(): DataProvider {
  return {
    name: 'media.recentUploads',
    async resolve(query, ctx) {
      const limit = Math.min(200, Math.max(10, Number(query?.limit ?? 50)));
      const rows = (await fetchMediaEntries(ctx))
        .filter((entry) => eventOf(entry).event === 'upload.complete')
        .sort((a, b) => (b.createdAt ? +new Date(b.createdAt) : 0) - (a.createdAt ? +new Date(a.createdAt) : 0))
        .slice(0, limit)
        .map((entry) => {
          const content = eventOf(entry);
          return {
            id: content.id ?? '',
            disk: content.disk ?? '',
            key: content.key ?? '',
            size: content.size ?? 0,
          };
        });
      return { rows };
    },
  };
}

/** Storage-writing over time — `attach` event volume. [new-events] */
export function mediaStorageWritesOverTimeProvider(): DataProvider {
  return {
    name: 'media.storageWritesOverTime',
    async resolve(query, ctx) {
      const entries = await fetchMediaEntries(ctx);
      const buckets = Number(query?.buckets ?? 24);
      const now = Date.now();
      let minTime = now;
      for (const entry of entries) {
        const at = entry.createdAt ? +new Date(entry.createdAt) : now;
        if (at < minTime) minTime = at;
      }
      const span = Math.max(now - minTime, 1);
      const size = span / buckets;
      const rows = Array.from({ length: buckets }, (_, index) => ({
        label: new Date(minTime + index * size).toISOString().slice(11, 16),
        attach: 0,
      }));
      for (const entry of entries) {
        if (eventOf(entry).event !== 'attach') continue;
        const at = entry.createdAt ? +new Date(entry.createdAt) : minTime;
        const row = rows[Math.min(buckets - 1, Math.floor((at - minTime) / size))];
        if (row) row.attach += 1;
      }
      return { rows };
    },
  };
}

/** Attachment create/delete activity over time. [new-events] */
export function mediaAttachmentActivityProvider(): DataProvider {
  return {
    name: 'media.attachmentActivity',
    async resolve(query, ctx) {
      const entries = await fetchMediaEntries(ctx);
      const buckets = Number(query?.buckets ?? 24);
      const now = Date.now();
      let minTime = now;
      for (const entry of entries) {
        const at = entry.createdAt ? +new Date(entry.createdAt) : now;
        if (at < minTime) minTime = at;
      }
      const span = Math.max(now - minTime, 1);
      const size = span / buckets;
      const rows = Array.from({ length: buckets }, (_, index) => ({
        label: new Date(minTime + index * size).toISOString().slice(11, 16),
        created: 0, deleted: 0,
      }));
      for (const entry of entries) {
        const event = eventOf(entry).event;
        if (event !== 'attachment.create' && event !== 'attachment.delete') continue;
        const at = entry.createdAt ? +new Date(entry.createdAt) : minTime;
        const row = rows[Math.min(buckets - 1, Math.floor((at - minTime) / size))];
        if (!row) continue;
        if (event === 'attachment.create') row.created += 1;
        else row.deleted += 1;
      }
      return { rows };
    },
  };
}

// ─── Media library (MEDIA_STORE token) ─────────────────────────────────────────

function getStore(ctx: ExtensionContext): MediaStore | null {
  return ctx.moduleRef.get(MEDIA_STORE, { strict: false }) as MediaStore | null;
}

/** Total media (metric:'count') or total bytes (metric:'bytes'). [new-store] — 0 when store null. */
export function mediaLibraryTotalsProvider(): DataProvider {
  return {
    name: 'media.libraryTotals',
    async resolve(query, ctx) {
      const store = getStore(ctx);
      if (!store) return { value: 0 };
      if ((query?.metric as string) === 'bytes') {
        const byDisk = await store.aggregate({ groupBy: 'disk', sum: 'size' });
        return { value: byDisk.reduce((total, bucket) => total + bucket.sumSize, 0) };
      }
      return { value: await store.count() };
    },
  };
}

/** Media by collection donut. [new-store] */
export function mediaByCollectionProvider(): DataProvider {
  return {
    name: 'media.byCollection',
    async resolve(_query, ctx) {
      const store = getStore(ctx);
      if (!store) return { segments: [] };
      const buckets = await store.aggregate({ groupBy: 'collection', sum: 'size' });
      return { segments: buckets.map((bucket) => ({ label: bucket.key, value: bucket.count })) };
    },
  };
}

/** Storage by disk bar (summed bytes). [new-store] */
export function mediaStorageByDiskProvider(): DataProvider {
  return {
    name: 'media.storageByDisk',
    async resolve(_query, ctx) {
      const store = getStore(ctx);
      if (!store) return { segments: [] };
      const buckets = await store.aggregate({ groupBy: 'disk', sum: 'size' });
      return { segments: buckets.map((bucket) => ({ label: bucket.key, value: bucket.sumSize })) };
    },
  };
}

// ─── Disks & config (MEDIA_STORAGE_SHARED token) ───────────────────────────────

/** Configured disks + capability badges. [live] — empty when the manager isn't reachable. */
export function mediaDisksProvider(): DataProvider {
  return {
    name: 'media.disks',
    async resolve(_query, ctx) {
      const manager = ctx.moduleRef.get(MEDIA_STORAGE_SHARED, { strict: false }) as StorageManager | null;
      if (!manager) return { rows: [] };
      const rows = manager.diskNames().map((name) => {
        const capabilities = manager.disk(name).capabilities;
        return {
          name,
          default: name === manager.defaultDisk ? 'yes' : 'no',
          presign: capabilities.presign ? 'yes' : 'no',
          multipart: capabilities.multipart ? 'yes' : 'no',
          publicUrls: capabilities.publicUrls ? 'yes' : 'no',
          list: capabilities.list ? 'yes' : 'no',
        };
      });
      return { rows };
    },
  };
}
```

> **Type note:** `StorageDriver.capabilities` is `DriverCapabilities { presign; multipart; publicUrls; list }` (already exported from core — confirm the field names against `packages/core/src/types.ts` and adjust the badges if a name differs). If `capabilities` is optional on the driver, guard with `?? {}`.

- [ ] **Step 4: Run to verify it passes** — `pnpm exec vitest run packages/telescope/src/media-data-providers.spec.ts` → PASS.
- [ ] **Step 5: Typecheck** — `pnpm --filter @dudousxd/nestjs-media-telescope typecheck`.
- [ ] **Step 6: Commit** — `git add packages/telescope/src/media-data-providers.ts packages/telescope/src/media-data-providers.spec.ts && git commit -m "feat(telescope): media dashboard data providers (events + store aggregates + sessions)"`

### Task C3: Dashboard spec (`media-dashboard.spec-data.ts`)

**Files:**
- Create: `packages/telescope/src/media-dashboard.spec-data.ts`
- Test: `packages/telescope/src/media-dashboard.spec-data.spec.ts`

**Interfaces:**
- Consumes: `DashboardSpec` (telescope).
- Produces: `mediaDashboard(opts?: { uploadHref?: string }): DashboardSpec` with `id: 'media.overview'`, every panel bound to a Task-C2 provider name.

- [ ] **Step 1: Write the failing test** — assert id, that every referenced provider name is one of the twelve, and that panel counts per section match:

```ts
import { describe, expect, it } from 'vitest';
import { mediaDashboard } from './media-dashboard.spec-data';

const PROVIDER_NAMES = new Set([
  'media.inProgressUploads', 'media.activeUploadCount', 'media.uploadSuccessRate',
  'media.uploadsOverTime', 'media.uploadThroughput', 'media.recentUploads',
  'media.libraryTotals', 'media.byCollection', 'media.storageByDisk',
  'media.storageWritesOverTime', 'media.attachmentActivity', 'media.disks',
]);

describe('mediaDashboard', () => {
  it('has the media.overview id and only binds known providers', () => {
    const spec = mediaDashboard();
    expect(spec.id).toBe('media.overview');
    expect(spec.label).toBe('Media');
    const panels = (spec.sections ?? []).flatMap((section) => section.panels);
    for (const panel of panels) expect(PROVIDER_NAMES.has(panel.data.provider)).toBe(true);
    // Sections present per proposal §3.
    expect((spec.sections ?? []).map((s) => s.title)).toEqual([
      'Uploads (live)', 'Upload activity', 'Media library', 'Attachments', 'Disks & config',
    ]);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — → FAIL (module missing).

- [ ] **Step 3: Implement** — full `DashboardSpec` (mirror durable's sectioned layout; `panels: []` at top, everything in `sections`):

```ts
import type { DashboardSpec } from '@dudousxd/nestjs-telescope';

/**
 * The "Media" overview dashboard. `uploadHref` deep-links an in-progress upload row out
 * to a (future Path-B) media SPA, e.g. '/media/uploads/{id}'; omit to render plain ids.
 */
export function mediaDashboard(opts: { uploadHref?: string } = {}): DashboardSpec {
  const uploadColumn = opts.uploadHref
    ? { key: 'id', label: 'Upload', link: { href: opts.uploadHref } }
    : { key: 'id', label: 'Upload' };
  return {
    id: 'media.overview',
    label: 'Media',
    panels: [],
    sections: [
      {
        title: 'Uploads (live)',
        cols: 4,
        panels: [
          {
            kind: 'stat',
            title: 'Active uploads',
            data: { provider: 'media.activeUploadCount' },
            spark: false,
          },
          {
            kind: 'gauge',
            title: 'Upload success rate',
            data: { provider: 'media.uploadSuccessRate' },
            max: 1,
            format: 'percent',
            thresholds: { warn: 0.98, bad: 0.95, direction: 'down-bad' },
          },
          {
            kind: 'stat',
            title: 'Throughput (completes/h)',
            data: { provider: 'media.uploadThroughput' },
            format: 'rate',
            spark: true,
          },
        ],
      },
      {
        title: 'Upload activity',
        cols: 3,
        panels: [
          {
            kind: 'table',
            title: 'In-progress uploads',
            data: { provider: 'media.inProgressUploads' },
            columns: [
              uploadColumn,
              { key: 'disk', label: 'Disk' },
              { key: 'key', label: 'Key' },
              { key: 'percent', label: '%' },
              { key: 'parts', label: 'Parts' },
              { key: 'multipart', label: 'Multipart' },
            ],
          },
          {
            kind: 'timeseries',
            title: 'Uploads over time',
            data: { provider: 'media.uploadsOverTime' },
            series: ['started', 'completed', 'aborted'],
            style: 'stacked',
          },
          {
            kind: 'table',
            title: 'Recent completed uploads',
            data: { provider: 'media.recentUploads' },
            columns: [
              { key: 'id', label: 'Id' },
              { key: 'disk', label: 'Disk' },
              { key: 'key', label: 'Key' },
              { key: 'size', label: 'Size' },
            ],
          },
        ],
      },
      {
        title: 'Media library',
        cols: 4,
        panels: [
          {
            kind: 'stat',
            title: 'Total media',
            data: { provider: 'media.libraryTotals', query: { metric: 'count' } },
            spark: false,
          },
          {
            kind: 'stat',
            title: 'Total bytes',
            data: { provider: 'media.libraryTotals', query: { metric: 'bytes' } },
            spark: false,
          },
          {
            kind: 'breakdown',
            title: 'Media by collection',
            data: { provider: 'media.byCollection' },
            style: 'donut',
          },
          {
            kind: 'breakdown',
            title: 'Storage by disk',
            data: { provider: 'media.storageByDisk' },
            style: 'bar',
          },
          {
            kind: 'timeseries',
            title: 'Storage writes over time',
            data: { provider: 'media.storageWritesOverTime' },
            series: ['attach'],
            style: 'area',
          },
        ],
      },
      {
        title: 'Attachments',
        cols: 2,
        panels: [
          {
            kind: 'timeseries',
            title: 'Attachment activity',
            data: { provider: 'media.attachmentActivity' },
            series: ['created', 'deleted'],
            style: 'stacked',
          },
        ],
      },
      {
        title: 'Disks & config',
        cols: 2,
        panels: [
          {
            kind: 'table',
            title: 'Configured disks',
            data: { provider: 'media.disks' },
            columns: [
              { key: 'name', label: 'Disk' },
              { key: 'default', label: 'Default' },
              { key: 'presign', label: 'Presign' },
              { key: 'multipart', label: 'Multipart' },
              { key: 'publicUrls', label: 'Public URLs' },
              { key: 'list', label: 'List' },
            ],
          },
        ],
      },
    ],
  };
}
```

- [ ] **Step 4: Run to verify it passes** — → PASS.
- [ ] **Step 5: Typecheck** — `pnpm --filter @dudousxd/nestjs-media-telescope typecheck`.
- [ ] **Step 6: Commit** — `git add packages/telescope/src/media-dashboard.spec-data.ts packages/telescope/src/media-dashboard.spec-data.spec.ts && git commit -m "feat(telescope): media.overview DashboardSpec (uploads/activity/library/attachments/disks)"`

### Task C4: The extension factory + index export + `sections` verification

**Files:**
- Create: `packages/telescope/src/media-telescope.extension.ts`
- Modify: `packages/telescope/src/index.ts`
- Test: `packages/telescope/src/media-telescope.extension.spec.ts`

**Interfaces:**
- Consumes: `defineTelescopeExtension` (telescope), `MediaWatcher` (existing), `mediaDashboard` (C3), all twelve provider factories (C2).
- Produces: `mediaTelescopeExtension(opts?: { uploadHref?: string }): TelescopeExtension` with `name: 'media'`.

- [ ] **Step 1: Write the failing test** (mirror durable's `extension.spec.ts`):

```ts
import type { ExtensionContext } from '@dudousxd/nestjs-telescope';
import { describe, expect, it } from 'vitest';
import { mediaTelescopeExtension } from './media-telescope.extension';

const ctx = { config: {}, moduleRef: {} } as unknown as ExtensionContext;

describe('mediaTelescopeExtension', () => {
  it('bundles the watcher, entry type, dashboard, and all providers', () => {
    const ext = mediaTelescopeExtension();
    expect(ext.name).toBe('media');
    expect(ext.watchers?.(ctx).map((w) => w.type)).toEqual(['media']);
    expect(ext.entryTypes?.(ctx)).toEqual([{ id: 'media', label: 'Media', dot: 'bg-sky-400' }]);
    expect(ext.dashboards?.(ctx).map((d) => d.id)).toEqual(['media.overview']);
    expect(ext.dataProviders?.(ctx).map((p) => p.name).sort()).toEqual([
      'media.activeUploadCount', 'media.attachmentActivity', 'media.byCollection',
      'media.disks', 'media.inProgressUploads', 'media.libraryTotals',
      'media.recentUploads', 'media.storageByDisk', 'media.storageWritesOverTime',
      'media.uploadSuccessRate', 'media.uploadThroughput', 'media.uploadsOverTime',
    ]);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — → FAIL.

- [ ] **Step 3: Implement `media-telescope.extension.ts`**:

```ts
import { defineTelescopeExtension } from '@dudousxd/nestjs-telescope';
import { mediaDashboard } from './media-dashboard.spec-data';
import {
  mediaActiveUploadCountProvider, mediaAttachmentActivityProvider, mediaByCollectionProvider,
  mediaDisksProvider, mediaInProgressUploadsProvider, mediaLibraryTotalsProvider,
  mediaRecentUploadsProvider, mediaStorageByDiskProvider, mediaStorageWritesOverTimeProvider,
  mediaUploadSuccessRateProvider, mediaUploadThroughputProvider, mediaUploadsOverTimeProvider,
} from './media-data-providers';
import { MediaWatcher } from './media.watcher';

/** First-class Telescope extension for nestjs-media: watcher + Media overview dashboard. */
export function mediaTelescopeExtension(opts: { uploadHref?: string } = {}) {
  return defineTelescopeExtension({
    name: 'media',
    watchers: () => [new MediaWatcher()],
    entryTypes: () => [{ id: 'media', label: 'Media', dot: 'bg-sky-400' }],
    dashboards: () => [mediaDashboard(opts)],
    dataProviders: () => [
      mediaInProgressUploadsProvider(),
      mediaActiveUploadCountProvider(),
      mediaUploadSuccessRateProvider(),
      mediaUploadsOverTimeProvider(),
      mediaUploadThroughputProvider(),
      mediaRecentUploadsProvider(),
      mediaLibraryTotalsProvider(),
      mediaByCollectionProvider(),
      mediaStorageByDiskProvider(),
      mediaStorageWritesOverTimeProvider(),
      mediaAttachmentActivityProvider(),
      mediaDisksProvider(),
    ],
  });
}
```

- [ ] **Step 4: Update `index.ts`**:

```ts
export * from './media.watcher';
export * from './media-tokens';
export * from './media-data-providers';
export * from './media-dashboard.spec-data';
export * from './media-telescope.extension';
```

- [ ] **Step 5: Run to verify it passes** — `pnpm exec vitest run packages/telescope` → PASS (all telescope specs).

- [ ] **Step 6: Verify `sections` survives `getMeta` (proposal §2 caveat).** The dev-pinned telescope is `1.11.2` (newer than the `1.10.0` that dropped `sections`), so this is expected to pass. Confirm concretely: build the package and, in a throwaway script or the integration spec, register `TelescopeModule.forRoot({ extensions: [mediaTelescopeExtension()] })` and assert the meta endpoint returns the sections. If `sections` is dropped at the pinned version, **fall back to a flat `panels` array** in `media-dashboard.spec-data.ts` (move every section's panels into the top-level `panels`, drop `sections`) and re-run C3's test with the flat assertion. Record the outcome in the commit message.

- [ ] **Step 7: Typecheck + build** — `pnpm --filter @dudousxd/nestjs-media-telescope typecheck && pnpm --filter @dudousxd/nestjs-media-telescope build`.

- [ ] **Step 8: Commit** — `git add packages/telescope/src/media-telescope.extension.ts packages/telescope/src/index.ts packages/telescope/src/media-telescope.extension.spec.ts && git commit -m "feat(telescope): mediaTelescopeExtension() factory + exports"`

---

## Wave D — Release + integration

### Task D1: Changesets

**Files:**
- Create: `.changeset/media-dashboard-*.md` (one or a few markdown files)

**Bump matrix** (respect 0.x — pick the level deliberately; scrutinise the Version PR):

| Package | Change | Bump |
|---|---|---|
| `@dudousxd/nestjs-media-core` | required `MediaStore.count/aggregate` + optional `UploadSessionStore.list?` + new types | **minor** (breaking for *external* custom stores — acceptable 0.x) |
| `@dudousxd/nestjs-media-database-mikro-orm` | implement methods + indexes | **minor** |
| `@dudousxd/nestjs-media-database-typeorm` | implement methods + indices | **minor** |
| `@dudousxd/nestjs-media-database-prisma` | implement methods + delegate + doc indexes | **minor** |
| `@dudousxd/nestjs-media-database-drizzle` | implement methods + indexes | **minor** |
| `@dudousxd/nestjs-media-upload-redis` | type-only refactor (import shared filter) | **patch** |
| `@dudousxd/nestjs-media-testing` | implement methods + conformance cases | **minor** |
| `@dudousxd/nestjs-media-nestjs` | new `MEDIA_STORE`/`MEDIA_UPLOAD_SESSIONS`/`MEDIA_STORAGE_SHARED` tokens | **minor** |
| `@dudousxd/nestjs-media-telescope` | new `mediaTelescopeExtension()` + providers + dashboard | **minor** |

- [ ] **Step 1: Create the changeset(s).** Use `pnpm changeset` interactively, OR write files directly. Example (`.changeset/media-dashboard-core.md`):

```md
---
'@dudousxd/nestjs-media-core': minor
'@dudousxd/nestjs-media-testing': minor
'@dudousxd/nestjs-media-database-mikro-orm': minor
'@dudousxd/nestjs-media-database-typeorm': minor
'@dudousxd/nestjs-media-database-prisma': minor
'@dudousxd/nestjs-media-database-drizzle': minor
'@dudousxd/nestjs-media-nestjs': minor
'@dudousxd/nestjs-media-upload-redis': patch
'@dudousxd/nestjs-media-telescope': minor
---

Media dashboard (Path A): a `mediaTelescopeExtension()` Telescope tab plus the
instrumentation it needs — real `MediaStore.count()`/`aggregate()` across all four
database adapters (with collection/disk/createdAt indexes), an optional
`UploadSessionStore.list()`, and `MEDIA_STORE` / `MEDIA_UPLOAD_SESSIONS` DI tokens.

BREAKING (0.x, external only): `MediaStore.count()`/`aggregate()` are now required SPI
methods — external custom `MediaStore` implementations must add them.
```

- [ ] **Step 2: Verify the graduation impact** — run `pnpm changeset version` on a **throwaway branch** (do NOT commit the version bump — that's CI's job) purely to inspect the computed versions. Confirm no package is pushed to `1.0.0`. `.changeset/config.json` has `onlyUpdatePeerDependentsWhenOutOfRange: true`, so a `-core` minor should NOT force-major dependents while their peer range still satisfies. If any package graduates to 1.0.0, downgrade the offending bump (core → patch is not an option since it's a real API addition; instead confirm the dependents' peer ranges use `<1.0.0` upper bounds so the minor stays in-range). Reset the throwaway branch afterward.

- [ ] **Step 3: Commit the changeset only** — `git add .changeset/media-dashboard-*.md && git commit -m "chore: changeset for the media telescope dashboard"`

### Task D2: Host registration note + full integration gate

**Files:**
- Create/modify: `packages/telescope/README.md` (usage snippet)

- [ ] **Step 1: Document registration** — mirror how squid registers `durableTelescopeExtension` (`squid-nestjs/src/telescope-options.factory.ts:210`). Add to `packages/telescope/README.md`:

````md
## Register the dashboard

```ts
import { mediaTelescopeExtension } from '@dudousxd/nestjs-media-telescope';

TelescopeModule.forRoot({
  storage: /* your storage provider */,
  extensions: [
    // Contributes the MediaWatcher AND the "Media" overview dashboard tab.
    // uploadHref deep-links in-progress uploads to a future media SPA (optional).
    mediaTelescopeExtension({ uploadHref: '/media/uploads/{id}' }),
  ],
});
```

The dashboard reads the host's `MediaStore`, upload-session store, and `StorageManager`
through the DI tokens `MediaModule` provides (`MEDIA_STORE`, `MEDIA_UPLOAD_SESSIONS`,
`MEDIA_STORAGE_SHARED`) — no extra wiring. Panels that need a piece which isn't
configured (no store, no session `list()`) render empty instead of failing.
````

- [ ] **Step 2: Full monorepo gate** — from the repo root:

```bash
pnpm --filter @dudousxd/nestjs-media-core build
pnpm --filter @dudousxd/nestjs-media-testing build
pnpm --filter @dudousxd/nestjs-media-nestjs build
pnpm --filter @dudousxd/nestjs-media-telescope build
pnpm run typecheck
pnpm exec vitest run packages/core packages/testing packages/nestjs packages/telescope packages/upload-redis packages/database-mikro-orm packages/database-typeorm packages/database-prisma packages/database-drizzle
```

Expected: all green. (DB specs that require a live database run as CI runs them.)

- [ ] **Step 3: Biome** — `pnpm exec biome check packages/core packages/testing packages/nestjs packages/telescope packages/upload-redis packages/database-*` (or the repo's lint script). Fix any drift.

- [ ] **Step 4: Commit** — `git add packages/telescope/README.md && git commit -m "docs(telescope): document mediaTelescopeExtension registration"`

---

## Instrumentation & descope map (proposal §5)

| Panel | Section | Tag | Descope behaviour |
|---|---|---|---|
| Active uploads (stat) | Uploads (live) | [new-token] | `MEDIA_UPLOAD_SESSIONS` null / no `list()` → value 0 |
| In-progress uploads (table) | Upload activity | [new-token] | same → empty rows. Redis-only in practice; in-memory `list()` works for tests/dev |
| Upload success rate (gauge) | Uploads (live) | [new-events] | needs Telescope + MediaWatcher; empty history → 1.0 (no failures) |
| Uploads over time (timeseries) | Upload activity | [new-events] | empty history → zeroed buckets |
| Throughput (stat+spark) | Uploads (live) | [new-events] | count-based (completes/h) because direct uploads emit `size: 0` |
| Recent completed uploads (table) | Upload activity | [new-events] | empty history → empty rows |
| Total media / Total bytes (stat) | Media library | [new-store] | `MEDIA_STORE` null → 0 |
| Media by collection (donut) | Media library | [new-store] | store null → empty segments; needs `collection` index for speed |
| Storage by disk (bar) | Media library | [new-store] | store null → empty; needs `disk` index |
| Storage writes over time (timeseries) | Media library | [new-events] | `attach` events; empty history → zeroed |
| Attachment activity (timeseries) | Attachments | [new-events] | create/delete rates only — **no current inventory possible** (attachments are host-table value objects). Drop the section if events are muted |
| Configured disks (table) | Disks & config | [live] | `MEDIA_STORAGE_SHARED` unreachable → empty rows |

**Not built (Path-A ceiling):** thumbnail grid / image-video previews / gallery — the 7 Telescope panel kinds have no visual-media kind, and an out-of-repo package can't add one (would need a core-UI PR). Deferred to a future Path-B SPA (proposal §4). `upload.progress` per-upload curves are unavailable (not persisted by design).

---

## Self-Review

**1. Spec coverage (proposal §3 panels + the 4 resolved questions):**
- Q1 (Path A only): ✅ no Path-B package; only the telescope extension. 
- Q2 (real `count`/`aggregate` across core + 4 adapters + indexes, NOT SQL): ✅ A2 (SPI), B1–B4 (mikro/typeorm/prisma/drizzle impls + indexes), A5 (in-memory + conformance). 
- Q3 (rate/throughput/history from recorded `aviary:media:*` events): ✅ C2 providers read `TELESCOPE_STORAGE type:'media'`; no media-owned metrics store. 
- Q4 (`MEDIA_UPLOAD_SESSIONS` token + optional `list?()`, Redis + in-memory implement): ✅ A1 (SPI `list?`), A3 (token), A4 (Redis conforms), A5 (in-memory `list`). 
- Every §3 panel maps to a task (see descope map). Attachments section included (timeseries only, per §3's "value objects" caveat). 
- **Correction folded in during review:** the disks panel needs the `StorageManager` reachable by value; added `MEDIA_STORAGE_SHARED = Symbol.for('nestjs-media:storage')` (`useExisting: MEDIA_STORAGE`) to A3 and C1 — otherwise `mediaDisksProvider` had no reachable token (the plain `MEDIA_STORAGE` `Symbol()` can't be shared cross-package). Likewise the `MediaStore` is a private field of `MediaLibrary`, so `MEDIA_STORE` (not `MEDIA_LIBRARY`) is the token the store-aggregate panels resolve.

**2. Placeholder scan:** no TBD/TODO/"handle errors"/"similar to". Every code step has complete code; every provider has an explicit empty-shape fallback. The one deliberate open verification is C4-Step 6 (`sections` at the pinned telescope version) with a concrete fallback path spelled out — a pin-and-test item, not a placeholder.

**3. Type/name consistency:** provider names are identical in the interfaces block, C2 (definitions), C3 (bindings + test set), and C4 (extension list + sorted test) — cross-checked. Token symbol keys match across A3 (`tokens.ts`) and C1 (`media-tokens.ts`): `nestjs-media:store`, `nestjs-media:upload-sessions`, `nestjs-media:storage`. SPI method/type names (`count`, `aggregate`, `MediaCountFilter`, `MediaAggregateQuery`, `MediaAggregateBucket`/`sumSize`, `UploadSessionListFilter`, `list`) are consistent from core (A1/A2) through adapters (B) and providers (C2).
