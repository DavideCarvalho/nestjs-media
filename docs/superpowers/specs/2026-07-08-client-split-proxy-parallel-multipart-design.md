# nestjs-media: client split + GW-safe proxy-parallel multipart — Design

**Goal:** Split the client `uploadMedia` helper into reusable `createSession` /
`streamChunks` pieces, and add a GameWarden-safe **proxy-parallel** multipart
upload mode that restores concurrent part uploads (like the old flip
chunked-upload) with the whole transfer proxied through the backend — no
client→S3 direct path.

**Architecture:** Reuse the existing `ResumableUploadManager` and
`UploadSessionStore`. The tus sequential path (`writeChunk`, offset-ordered)
stays untouched; a new `writePart(id, partNumber, chunk)` uploads a single S3
multipart part by explicit number, and `complete()` sorts parts by number
before `completeMultipartUpload`. Part ETags move OUT of the serialized session
JSON into a concurrency-safe side structure so out-of-order/concurrent part
writes never race. New HTTP routes proxy the part bodies (raw, per-part
byte-capped) and an explicit complete. The client gains a concurrency-pooled
`streamChunksParallel`.

**Tech Stack:** TypeScript, NestJS, S3 multipart (`@aws-sdk/client-s3`),
ioredis (upload-redis store), pnpm + turbo monorepo, changesets, vitest.

## Global Constraints

- **GameWarden-safe:** every byte proxies through the backend. NO client→S3
  presigned/direct path is added or reachable in the parallel mode.
- **Server-derived key:** the S3 key + disk are fixed at session create. The
  part-upload and complete routes NEVER accept a client-supplied key/disk —
  they resolve everything from the session id. (Anti-spoofing parity with the
  host's create endpoint, e.g. flip's `create-upload`.)
- **Memory-bounded:** each part upload is raw-parsed under a per-part byte cap
  (host-configured, e.g. 8–16 MiB). Worst-case in-flight memory is
  `concurrency × maxPartSize`, never the whole file.
- **Backward compatible:** `uploadMedia`, `writeChunk`, the tus routes, and the
  `UploadSessionStore` interface's existing members are unchanged. New store
  methods are OPTIONAL; `writePart` requires them and throws a clear error when
  absent.
- **Stay 0.x:** all media packages are pre-1.0. Release these changes as
  **patch** bumps on every touched package so no dependent graduates to 1.0.0.
  Scrutinize the changesets Version PR: it must show 0 major bumps.
- **flip is untouched by this work.** flip keeps its current sequential
  `resumable-upload.ts`; migrating flip to `streamChunksParallel` is a separate
  future effort, out of scope here.

---

## Component 1 — Client split (`@dudousxd/nestjs-media-client`)

Today `uploadMedia(blob, opts)` bundles session-create (tus `POST` with
`Upload-Metadata`) + the sequential PATCH loop. Split it so a host with its own
server-derived-key create endpoint can reuse just the streaming half and inject
auth.

**New/changed public API:**

```ts
// Create a tus session via the lib's own POST (unchanged create behavior).
export async function createSession(
  basePath: string,
  opts: {
    filename: string;
    contentType?: string;
    length: number;
    fetchImpl?: typeof fetch;
    headers?: Record<string, string>;
  },
): Promise<{ location: string }>;

// Sequential tus streaming against an ALREADY-OPENED session location.
export async function streamChunks(
  location: string,
  data: Blob,
  opts: {
    chunkSize?: number;            // default 8 MiB
    onProgress?: (sent: number, total: number) => void;
    fetchImpl?: typeof fetch;
    headers?: Record<string, string>;
    resume?: boolean;              // HEAD first; default true
    retries?: number;              // per-chunk; default 3
    signal?: AbortSignal;
  },
): Promise<void>;

// Parallel streaming against an already-opened session location.
export async function streamChunksParallel(
  location: string,
  data: Blob,
  opts: {
    chunkSize?: number;            // default 8 MiB (>= 5 MiB S3 floor for non-final parts)
    concurrency?: number;          // default 3
    onProgress?: (sentBytes: number, total: number) => void;
    fetchImpl?: typeof fetch;
    headers?: Record<string, string>;
    retries?: number;              // per-part; default 3
    signal?: AbortSignal;
  },
): Promise<void>;

// Back-compat wrapper (unchanged behavior): create + sequential stream.
export async function uploadMedia(
  data: Blob,
  options: UploadMediaOptions,
): Promise<UploadMediaResult>;

// Convenience: create + parallel stream + complete.
export async function uploadMediaParallel(
  data: Blob,
  options: UploadMediaOptions & { concurrency?: number },
): Promise<UploadMediaResult>;
```

`headers` merges into every request (a host passes `{ Authorization: 'Bearer …' }`);
`fetchImpl` overrides `fetch` for exotic auth. `streamChunksParallel`:

1. Splits `data` into fixed `chunkSize` parts numbered `1..N` (S3 part numbers
   are 1-based; every non-final part must be ≥ 5 MiB).
2. Runs a concurrency pool of `concurrency` in-flight `PUT :location/parts/:n`
   requests, each carrying its slice as the raw body; retries a failed part up
   to `retries` times.
3. After all parts succeed, `POST :location/complete`.
4. `onProgress` reports cumulative bytes across completed parts.

Version: `@dudousxd/nestjs-media-client` **patch** (0.2.0 → 0.2.1).

## Component 2 — `ResumableUploadManager.writePart` (`@dudousxd/nestjs-media-core`)

```ts
async writePart(id: string, partNumber: number, chunk: Buffer): Promise<MultipartPart> {
  const session = await this.require(id);
  const disk = this.storage.disk(session.disk);
  if (!session.multipartUploadId || !isMultipartCapable(disk)) {
    throw new UnsupportedOperationError(session.disk, 'parallel multipart upload');
  }
  if (partNumber < 1) throw new InvalidPartNumberError(partNumber);
  if (typeof this.sessions.addPart !== 'function') {
    throw new UnsupportedOperationError('session store', 'concurrent part writes');
  }
  const part = await disk.uploadPart(session.key, session.multipartUploadId, partNumber, chunk);
  await this.sessions.addPart(id, part);   // atomic, keyed by partNumber (NOT the JSON blob)
  this.emit('upload.progress', { id, offset: session.offset, parts: partNumber, size: session.size });
  return part;
}
```

- `writePart` REQUIRES a store that implements `addPart`: it checks up front and
  throws `UnsupportedOperationError('session store', 'concurrent part writes')`
  when the method is missing — a clear config error, never a silent race. There
  is deliberately no `update()` fallback for the parallel path (read-modify-write
  cannot be concurrency-safe). The sequential tus path keeps using `update()`
  unchanged — it has no concurrency.
- `writePart` does NOT touch `session.offset`/`session.parts` (those are the
  sequential tus counters) and does NOT auto-complete — the parallel client
  calls `complete()` explicitly once all parts land. (`upload.progress` carries
  the just-written `partNumber` for observability; the authoritative completed
  count is `listParts(id).length`.)
- `complete()` gains a sort: it reads the parts (via `listParts` when the store
  provides one, else `session.partETags`) and passes them to
  `completeMultipartUpload` **sorted ascending by `partNumber`** (S3 requires
  ascending order). Sequential tus already produces ascending parts, so its
  behavior is unchanged.

Version: `@dudousxd/nestjs-media-core` **patch** (0.6.0 → 0.6.1).

## Component 3 — Session store (`core` interface + `@dudousxd/nestjs-media-upload-redis`)

The interface gains two OPTIONAL methods so existing implementors keep
compiling:

```ts
interface UploadSessionStore {
  // …existing get/create/update/delete…
  /** Atomically record one part's ETag, keyed by partNumber. Enables parallel writePart. */
  addPart?(id: string, part: MultipartPart): Promise<void>;
  /** All recorded parts for a session (unordered). Used by complete() + resume. */
  listParts?(id: string): Promise<MultipartPart[]>;
}
```

**Why parts leave the session JSON:** today `partETags` lives inside the
serialized session object, so two concurrent `writePart`s doing
read-modify-write `update()` would clobber each other. The parallel path stores
each part in a separate atomic structure:

- **RedisUploadSessionStore:** a per-session hash
  `media:upload:session:<id>:parts`, `HSET partNumber → etag`. `addPart` is a
  single `HSET` (atomic, out-of-order safe). `listParts` is `HGETALL` mapped to
  `MultipartPart[]`. The hash shares the session's TTL and is deleted alongside
  the session on `delete`.
- **In-memory store (core/testing):** a `Map<partNumber, etag>` per session;
  JS is single-threaded so pushes are inherently safe.

Version: `@dudousxd/nestjs-media-upload-redis` **patch** (0.7.0 → 0.7.1),
`@dudousxd/nestjs-media-core` already bumped above.

## Component 4 — HTTP routes (`@dudousxd/nestjs-media`)

New routes on the media upload controller (same base path as tus). All resolve
`key`/`disk`/`multipartUploadId` from the session id — never from the client.

```
PUT   /media/uploads/:id/parts/:partNumber   body = raw chunk  → { partNumber, etag }
POST  /media/uploads/:id/complete            → { key, disk, size }
GET   /media/uploads/:id/parts               → { parts: number[] }   (uploaded part numbers, for resume)
```

- `PUT …/parts/:n` reads the raw body (`application/offset+octet-stream` or
  `application/octet-stream`) and calls `manager.writePart(id, n, body)`. The
  host mounts a raw body-parser on this path with a per-part cap (the lib
  documents the recommended cap; flip already does this for the tus PATCH
  path).
- `POST …/complete` calls `manager.complete(id)`.
- `GET …/parts` calls `manager.listParts(id)` (via the store) so a resumed
  client skips already-uploaded part numbers.
- These routes carry no auth of their own (same as the tus controller); the
  host gates them (flip's `MediaAdminGuard` already covers the whole
  `media/uploads` subtree).

Version: `@dudousxd/nestjs-media` **patch** (0.6.0 → 0.6.1).

## Data flow

**Sequential (tus, unchanged):** `POST create → PATCH×N (offset-ordered) →
auto-complete on final chunk`.

**Parallel (new):**
```
create (host's create-upload OR lib POST)            → { location/id, key }
  ├─ PUT :id/parts/1  (chunk 1) ─┐
  ├─ PUT :id/parts/2  (chunk 2) ─┼─ up to `concurrency` in flight, each → S3 uploadPart, HSET etag
  ├─ PUT :id/parts/3  (chunk 3) ─┘
  └─ … remaining parts as the pool drains …
POST :id/complete   → completeMultipartUpload(sorted parts) → { key, size }
```

## Error handling

- **Missing `addPart` store:** `writePart` throws
  `UnsupportedOperationError(store, 'concurrent part writes')` at the first call
  — a clear config error, not a silent race.
- **Non-multipart disk:** `writePart` throws
  `UnsupportedOperationError(disk, 'parallel multipart upload')`.
- **Part retry:** the client retries a failed `PUT part` up to `retries`;
  re-uploading the same partNumber is idempotent (S3 overwrites the part;
  `HSET` overwrites the etag).
- **Abort:** `DELETE /media/uploads/:id` (existing) aborts the S3 multipart and
  deletes the session + its parts hash.
- **Invalid part number:** `partNumber < 1` or `> 10_000` (S3 limit) →
  `InvalidPartNumberError` (400).
- **Complete with a gap:** S3 rejects a completeMultipartUpload whose parts
  aren't contiguous/valid; the error surfaces as a 4xx from `complete`.

## Testing

- **core:** `writePart` records a part; concurrent `writePart`s (out of order)
  all land; `complete` orders parts ascending by number before
  `completeMultipartUpload`; `writePart` throws without `addPart`; `writePart`
  throws on a non-multipart disk.
- **upload-redis:** N concurrent `addPart`s to one session all persist (HSET);
  `listParts` returns them; parts hash is deleted with the session.
- **client:** `streamChunksParallel` honors the concurrency cap (never more than
  N in flight), retries a failed part, then completes; `uploadMedia` behavior is
  byte-identical to before (back-compat).
- **e2e (testing package / MinIO):** a real parallel upload of a multi-part
  file → the assembled object is byte-identical to the source.

## Ecosystem integration

This feature ripples through the monorepo. The analysis below is the integration
contract — what changes, what deliberately does not, and why.

**Telescope — media watcher (`@dudousxd/nestjs-media-telescope`): NO CHANGE.**
The watcher subscribes to the `aviary:media:*` diagnostics channels and already
excludes `upload.progress` to avoid per-chunk flooding, recording only the
`upload.start`/`complete`/`abort` milestones. `writePart` reuses the existing
`upload.progress` event (no new diagnostics event type), so the parallel path
flows through the diagnostics → telescope bridge with zero watcher changes. The
milestone entries carry small structured payloads (`{ id, key, size }`), never
request bodies.

**Telescope — external request watcher (`@dudousxd/nestjs-telescope`): NO LIB
CHANGE; host guidance.** The new `PUT :id/parts/:n` route carries a raw binary
part body, exactly like the tus `PATCH`. Two independent safety nets already
cover it: (1) `@dudousxd/nestjs-telescope` ≥ 1.15.1 bounds binary blobs in
`redact()` (a Buffer is summarized as an O(1) marker instead of being walked
byte-by-byte), so capturing a part body can no longer stall the event loop;
(2) hosts should still skip request capture on the whole `…/media/uploads`
subtree — capturing many concurrent binary parts is pure noise. flip's existing
`req.originalUrl.startsWith("/api/media/uploads")` capture skip already covers
the new parts/complete routes (they live under that prefix). The lib README
documents this recommendation for other hosts.

**React (`@dudousxd/nestjs-media-react`): patch.** `useMediaUpload` currently
wraps `uploadMedia` (sequential). Add an opt-in `parallel?: boolean` +
`concurrency?: number` to `UseMediaUploadOptions`; when `parallel` is set the
hook calls `uploadMediaParallel` instead. Progress state wiring is unchanged
(both report cumulative bytes via `onProgress`). Default stays sequential — no
behavior change for existing callers.

**Codegen (`@dudousxd/nestjs-media-codegen`): patch.** The generated
`media-client-template` currently emits a single `uploadMedia()` bound to the
project's tus base path. Add a generated `uploadMediaParallel()` (and re-export
the `createSession`/`streamChunks`/`streamChunksParallel` split) bound to the
same base path, so codegen consumers get the parallel helper with zero manual
wiring. No change to `media.extension` options beyond documenting the new export.

**media-library + DB adapters (drizzle/mikro-orm/prisma/typeorm): NO CHANGE.**
`MediaLibrary` and the record persistence adapters live strictly downstream of
`complete()`'s `{ key, disk, size }` result and never touch upload part/session
state (verified: the adapters have no reference to sessions, parts, or
multipart). The parallel `complete()` returns the identical shape, so record
creation is agnostic to how the bytes arrived.

**Full touched-package list (all patch, all stay 0.x):**
`core` 0.6.0→0.6.1, `upload-redis` 0.7.0→0.7.1, `nestjs` 0.6.0→0.6.1,
`client` 0.2.0→0.2.1, `react` (patch), `codegen` (patch). The changesets
Version PR must show **0 major bumps** — scrutinize it before merge.

## Out of scope

- Migrating flip to `streamChunksParallel` (separate future effort).
- The tus Concatenation extension (S3 multipart via explicit part numbers is
  the chosen mechanism).
- Any client→S3 direct/presigned parallelism (GameWarden-forbidden).
