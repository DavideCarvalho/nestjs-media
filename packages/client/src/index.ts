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
      if (res.ok === false) throw new Error(`media upload: PATCH failed at offset ${offset}`);
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
        if (res.ok === false) throw new Error(`media upload: PUT part ${partNumber} failed`);
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
  if (done.ok === false) throw new Error('media upload: complete failed');
}

/** Resumable sequential upload of a Blob/File through the tus endpoints; returns its Location. */
export async function uploadMedia(
  data: Blob,
  options: UploadMediaOptions,
): Promise<UploadMediaResult> {
  const base = options.basePath ?? '/media/uploads';
  const { location } = await createSession(base, {
    filename: options.filename,
    ...(options.contentType ? { contentType: options.contentType } : {}),
    length: data.size,
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    ...(options.headers ? { headers: options.headers } : {}),
  });
  await streamChunks(location, data, {
    // byte-identical to the pre-split implementation: no resume HEAD probe.
    resume: false,
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
