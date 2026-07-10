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
  /** Resolved fresh before every request (each PATCH/PUT part, the complete POST, and the
   *  initiate call). Use for short-lived tokens that may expire mid-upload; merged over the
   *  static `headers`, with these values winning on key conflict. */
  getHeaders?: () => HeadersInit | Promise<HeadersInit>;
}

export interface UploadMediaResult {
  location: string;
}

export interface StreamChunksOptions {
  chunkSize?: number | undefined;
  onProgress?: ((sent: number, total: number) => void) | undefined;
  fetchImpl?: typeof fetch | undefined;
  headers?: Record<string, string> | undefined;
  /** Resolved fresh before every HEAD/PATCH request. Use for short-lived tokens that may
   *  expire mid-upload; merged over the static `headers`, with these values winning on key
   *  conflict. */
  getHeaders?: (() => HeadersInit | Promise<HeadersInit>) | undefined;
  /** HEAD the session first and resume from its offset. Default true. */
  resume?: boolean | undefined;
  /** Per-chunk retry attempts. Default 3. */
  retries?: number | undefined;
  signal?: AbortSignal | undefined;
}

export interface StreamChunksParallelOptions {
  chunkSize?: number | undefined;
  /** Max in-flight part uploads. Default 3. */
  concurrency?: number | undefined;
  onProgress?: ((sentBytes: number, total: number) => void) | undefined;
  fetchImpl?: typeof fetch | undefined;
  headers?: Record<string, string> | undefined;
  /** Resolved fresh before every part PUT and the complete POST. Use for short-lived tokens
   *  that may expire mid-upload; merged over the static `headers`, with these values winning
   *  on key conflict. */
  getHeaders?: (() => HeadersInit | Promise<HeadersInit>) | undefined;
  /** Per-part retry attempts. Default 3. */
  retries?: number | undefined;
  signal?: AbortSignal | undefined;
}

const DEFAULT_CHUNK = 5 * 1024 * 1024;
const DEFAULT_CONCURRENCY = 3;
const DEFAULT_RETRIES = 3;

function assertOk(res: { ok?: boolean }, message: string): void {
  if (!('ok' in res) || res.ok === false) throw new Error(message);
}

function encodeMetadata(meta: Record<string, string>): string {
  return Object.entries(meta)
    .map(([k, v]) => `${k} ${btoa(v)}`)
    .join(',');
}

function headersInitToRecord(headersInit: HeadersInit): Record<string, string> {
  if (headersInit instanceof Headers) {
    const record: Record<string, string> = {};
    headersInit.forEach((value, key) => {
      record[key] = value;
    });
    return record;
  }
  if (Array.isArray(headersInit)) return Object.fromEntries(headersInit);
  return { ...headersInit };
}

/** Merges static headers with a fresh getHeaders() result; the dynamic values win on key conflict. */
async function mergeHeaders(
  staticHeaders: Record<string, string> | undefined,
  getHeaders: (() => HeadersInit | Promise<HeadersInit>) | undefined,
): Promise<Record<string, string>> {
  if (!getHeaders) return { ...(staticHeaders ?? {}) };
  return { ...(staticHeaders ?? {}), ...headersInitToRecord(await getHeaders()) };
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
    contentType?: string | undefined;
    length: number;
    fetchImpl?: typeof fetch | undefined;
    headers?: Record<string, string> | undefined;
    getHeaders?: (() => HeadersInit | Promise<HeadersInit>) | undefined;
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
      ...(await mergeHeaders(opts.headers, opts.getHeaders)),
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
      headers: { 'Tus-Resumable': '1.0.0', ...(await mergeHeaders(opts.headers, opts.getHeaders)) },
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
          ...(await mergeHeaders(opts.headers, opts.getHeaders)),
        },
        body: slice,
        ...(opts.signal ? { signal: opts.signal } : {}),
      });
      assertOk(res, `media upload: PATCH failed at offset ${offset}`);
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

  // Aborted when ANY worker fails, so sibling workers stop claiming new parts instead
  // of racing to upload a part whose sibling has already doomed the whole upload.
  const pool = new AbortController();
  const combinedSignal = opts.signal ? AbortSignal.any([opts.signal, pool.signal]) : pool.signal;

  const worker = async (): Promise<void> => {
    try {
      while (true) {
        if (opts.signal?.aborted) throw new Error('Upload aborted');
        // A sibling worker already failed and aborted the pool: stop claiming new parts
        // without throwing a second, unrelated rejection — the failing worker's own
        // throw below is the one Promise.all should reject with.
        if (pool.signal.aborted) return;
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
            headers: {
              'Content-Type': 'application/offset+octet-stream',
              ...(await mergeHeaders(opts.headers, opts.getHeaders)),
            },
            body: slice,
            signal: combinedSignal,
          });
          assertOk(res, `media upload: PUT part ${partNumber} failed`);
        });
        sent += end - start;
        opts.onProgress?.(sent, total);
      }
    } catch (error) {
      pool.abort();
      throw error;
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, partCount) }, () => worker()));

  const done = await doFetch(`${location}/complete`, {
    method: 'POST',
    headers: { ...(await mergeHeaders(opts.headers, opts.getHeaders)) },
    signal: combinedSignal,
  });
  assertOk(done, 'media upload: complete failed');
}

/** Resumable sequential upload of a Blob/File through the tus endpoints; returns its Location. */
export async function uploadMedia(
  data: Blob,
  options: UploadMediaOptions,
): Promise<UploadMediaResult> {
  const base = options.basePath ?? '/media/uploads';
  const { location } = await createSession(base, {
    filename: options.filename,
    contentType: options.contentType,
    length: data.size,
    fetchImpl: options.fetchImpl,
    headers: options.headers,
    getHeaders: options.getHeaders,
  });
  await streamChunks(location, data, {
    resume: false, // byte-identical to pre-split: no resume HEAD probe
    chunkSize: options.chunkSize,
    onProgress: options.onProgress,
    fetchImpl: options.fetchImpl,
    headers: options.headers,
    getHeaders: options.getHeaders,
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
    contentType: options.contentType,
    length: data.size,
    fetchImpl: options.fetchImpl,
    headers: options.headers,
    getHeaders: options.getHeaders,
  });
  await streamChunksParallel(location, data, {
    chunkSize: options.chunkSize,
    concurrency: options.concurrency,
    onProgress: options.onProgress,
    fetchImpl: options.fetchImpl,
    headers: options.headers,
    getHeaders: options.getHeaders,
  });
  return { location };
}

/** Build a media URL by id, optionally for a named conversion. */
export function mediaUrl(id: string, conversion?: string): string {
  const query = conversion ? `?conversion=${encodeURIComponent(conversion)}` : '';
  return `/media/${encodeURIComponent(id)}${query}`;
}
