# Storage primitives: `stat`, `deleteMany`, `diskNames` — Design

**Date:** 2026-07-08
**Status:** Approved
**Repo:** `@dudousxd/nestjs-media`

## Goal

Add three storage primitives to the media library so a downstream host (flip-nestjs)
can route **all** of its direct `@aws-sdk/client-s3` usage through the library's
storage abstraction without losing behavior. This is **Phase 0** (the library
prerequisite) of a larger flip-nestjs migration; Phases 1 (mechanical consolidation)
and 2 (client↔S3 elimination) live in flip and are out of scope here.

## Background

flip-nestjs currently calls the S3 SDK directly in ~35 files. The library's
`StorageDriver` already covers `get`/`stream`/`put`/`delete`/`exists`/`size`/`copy`/
`move`/`list`/`url`/`temporaryUrl` plus multipart. Three gaps block a full swap:

1. **Proxy downloads lose Content-Type.** `stream(path)` returns only a `Readable`;
   the `GetObject` response's `ContentType`/`ContentLength` are discarded. A faithful
   backend-proxied download (the `download-object` controller pattern) needs them.
2. **No batch delete.** Two flip sites use `DeleteObjectsCommand`; the driver only
   exposes single `delete(path)`.
3. **No way to enumerate configured disks.** An admin tool lists buckets via
   `ListBucketsCommand`; the disk abstraction has no account-level surface. Listing
   the *configured* disks is both sufficient and safer (shows only the allowlist).

## Scope

Three additions. Nothing else changes; existing `get`/`put`/`stream`/`list` are untouched.

### 1. `stat(path)` — object metadata without downloading the body

New result type (core `types.ts`):

```ts
export interface StatResult {
  size: number;
  contentType?: string;
  lastModified?: Date;
}
```

New **optional** method on `StorageDriver`:

```ts
stat?(path: string): Promise<StatResult>;
```

Per-driver implementation:

- **disk-s3 (`S3Driver`):** `HeadObjectCommand` (already used by `exists`/`size`).
  Map `ContentLength` → `size`, `ContentType` → `contentType`, `LastModified` →
  `lastModified`. Reuse the existing not-found handling: a missing object throws the
  same error `size()` throws today (do not invent a new error).
- **disk-local:** `fs.promises.stat` for `size`/`mtime`; `contentType` from the file
  extension via the same mime lookup the driver already uses for `url`/content typing
  (if none exists in the driver today, derive from extension with a minimal internal
  map — do not add a new dependency).
- **testing (`InMemoryDriver`):** return the stored blob's byte length as `size`, the
  stored `contentType` if the put recorded one, and the stored write timestamp as
  `lastModified` (omit fields the in-memory model does not track rather than faking them).

Downstream (Phase 1) usage — the proxy download becomes:

```ts
const meta = await disk.stat(key);
const body = await disk.stream(key);
return new StreamableFile(body, {
  type: meta.contentType ?? "application/octet-stream",
  length: meta.size,
  disposition: `attachment; filename="..."`,
});
```

Two S3 calls per download (`HeadObject` + `GetObject`) is acceptable; downloads are not
a hot path, and `stat` is independently reusable. A one-call `readWithMeta` was
explicitly rejected as premature (YAGNI).

### 2. `deleteMany(paths)` — batch delete

New **optional** method on `StorageDriver`:

```ts
deleteMany?(paths: string[]): Promise<void>;
```

- **disk-s3:** `DeleteObjectsCommand` with `{ Objects: paths.map(Key => ...) }`. S3
  caps a batch at 1000 keys; chunk the input into groups of 1000 and issue one command
  per chunk. An empty `paths` array is a no-op (return without an S3 call). Prefix each
  key through the driver's existing `key(path)` mapping, exactly like `delete`.
- **disk-local / testing:** loop over `delete(path)`. Empty array is a no-op.

Semantics: resolves when all deletes succeed; throws on the first failure (match the
SDK's default — do not swallow per-key errors). S3 delete is idempotent (deleting a
missing key is not an error), consistent with single `delete`.

### 3. `StorageManager.diskNames(): string[]`

New method on the `StorageManager` **class** (not the interface):

```ts
diskNames(): string[] {
  return Object.keys(this.disks);
}
```

Returns the configured disk names. Downstream, the admin "list buckets" tool switches
from a live `ListBucketsCommand` to `manager.diskNames()` — which is safer (only the
configured allowlist, never an account-wide enumeration).

## Versioning

All three land as **patch** bumps; the `0.x` line is preserved.

- The two `StorageDriver` additions are **optional** methods (`stat?`, `deleteMany?`).
  An optional interface member is not a breaking change: existing custom drivers that
  do not implement them still satisfy the interface. Callers that need them guard
  (`if (disk.stat)`) or, in flip's case, rely on `S3Driver` always providing them.
- Making them **required** would break third-party `StorageDriver` implementors and,
  per the changesets 0.x graduation rule, a minor on a `0.x` core would force
  dependents to `1.0.0`. Optional keeps everything patch and `0.x`.
- Packages bumped (patch): `-core` (types + `StorageManager`), `-disk-s3`,
  `-disk-local`, `-testing`. `MediaService.disk()` already returns the `StorageDriver`,
  so nestjs needs no change. Release via CI (changesets), then flip bumps its pins.

## Testing

- **Unit:** disk-local and testing drivers — `stat` returns correct size/contentType/
  lastModified for a written object; `deleteMany` removes all listed keys and is a
  no-op on `[]`. Extend the existing conformance spec if there is one shared across
  drivers.
- **Integration (`*.db.spec.ts`, MinIO via testcontainers):** `S3Driver.stat` on a real
  object returns the real `ContentType`/`ContentLength`/`LastModified`; `deleteMany`
  removes a multi-key set (including a >1000-key chunking case if cheap to construct,
  otherwise a small set plus a unit-level assertion on the chunking) and is a no-op on
  `[]`.
- No new tests for `diskNames` beyond a trivial unit assertion (constructed manager
  returns its configured keys).

## Out of scope (Phase 0)

- Any presign changes (Phase 2 replaces client→S3 with proxy flows, not new presign).
- Any change to existing `get`/`put`/`stream`/`list`/`exists`/`size` behavior.
- A one-call `readWithMeta` (revisit only if downloads become a measured hot path).
- The flip-nestjs call-site swaps themselves (Phase 1) and the client↔S3 rewrites
  (Phase 2).
