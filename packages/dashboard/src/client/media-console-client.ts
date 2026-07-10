import type {
  CollectionsResponse,
  DiskListResponse,
  LibraryDetailResponse,
  LibraryListResponse,
  ObjectDetailResponse,
  ObjectListResponse,
  Topology,
  UploadDetailResponse,
  UploadListResponse,
} from './types.js';

declare global {
  interface Window {
    __MEDIA_API__?: string;
    __MEDIA_BASE__?: string;
  }
}

/** Where the SPA fetches the JSON API — injected by the UI controller, or a sensible default. */
export function apiBase(): string {
  if (typeof window !== 'undefined') {
    if (window.__MEDIA_API__) return window.__MEDIA_API__;
    if (window.__MEDIA_BASE__) return `${window.__MEDIA_BASE__}/api`;
  }
  return '/media/api';
}

function withQuery(path: string, params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `${path}?${query}` : path;
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${apiBase()}${path}`, { credentials: 'same-origin' });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}

async function send(
  method: 'POST' | 'DELETE',
  path: string,
  body?: Record<string, string>,
): Promise<void> {
  const response = await fetch(`${apiBase()}${path}`, {
    method,
    credentials: 'same-origin',
    ...(body
      ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      : {}),
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
}

/** POST raw bytes as `application/octet-stream` (a file upload) — the host's JSON parser leaves the
 *  stream intact, so the server reads it straight from the request. */
async function sendRaw(path: string, body: Blob): Promise<void> {
  const response = await fetch(`${apiBase()}${path}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/octet-stream' },
    body,
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
}

/** Typed browser client for the /media console JSON API. Rides ambient cookies (host guards). */
export const mediaConsoleClient = {
  topology: (): Promise<Topology> => getJson('/topology'),
  disks: (): Promise<DiskListResponse> => getJson('/disks'),
  objects: (
    disk: string,
    params: { prefix?: string; cursor?: string; limit?: number } = {},
  ): Promise<ObjectListResponse> =>
    getJson(withQuery(`/disks/${encodeURIComponent(disk)}/objects`, params)),
  object: (disk: string, key: string): Promise<ObjectDetailResponse> =>
    getJson(withQuery(`/disks/${encodeURIComponent(disk)}/object`, { key })),
  /** Same-origin URL that streams the object bytes inline (Content-Disposition: inline) — used to
   *  embed previews that a cross-origin signed URL would download (PDFs) or that CORS would block. */
  objectRawUrl: (disk: string, key: string): string =>
    `${apiBase()}${withQuery(`/disks/${encodeURIComponent(disk)}/object/raw`, { key })}`,
  /** Read up to `maxBytes` of an object as text through the inline proxy, aborting the stream once the
   *  budget is reached — so a many-MB CSV/text file is *sampled* (its head) without downloading the
   *  whole thing. Returns the decoded text and the bytes actually read (compare to the object's size
   *  to know whether it was truncated). Falls back to a full read when the body isn't streamable. */
  objectTextHead: async (
    disk: string,
    key: string,
    maxBytes: number,
  ): Promise<{ text: string; bytesRead: number }> => {
    const response = await fetch(mediaConsoleClient.objectRawUrl(disk, key), {
      credentials: 'same-origin',
    });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    if (!response.body) {
      const text = await response.text();
      return { text, bytesRead: text.length };
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let bytesRead = 0;
    while (bytesRead < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      bytesRead += value.length;
    }
    // Stop the transfer if we bailed on the budget rather than EOF — don't pull the whole file down.
    if (bytesRead >= maxBytes) await reader.cancel();
    const merged = new Uint8Array(bytesRead);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }
    return { text: new TextDecoder().decode(merged), bytesRead };
  },
  /** Fetch an object's raw bytes (for binary previews like XLSX) through the inline proxy. */
  objectBytes: async (disk: string, key: string): Promise<ArrayBuffer> => {
    const response = await fetch(mediaConsoleClient.objectRawUrl(disk, key), {
      credentials: 'same-origin',
    });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return response.arrayBuffer();
  },
  uploads: (params: { disk?: string; prefix?: string } = {}): Promise<UploadListResponse> =>
    getJson(withQuery('/uploads', params)),
  upload: (id: string): Promise<UploadDetailResponse> =>
    getJson(`/uploads/${encodeURIComponent(id)}`),
  collections: (): Promise<CollectionsResponse> => getJson('/library/collections'),
  library: (
    params: { collection?: string; disk?: string; cursor?: string; limit?: number } = {},
  ): Promise<LibraryListResponse> => getJson(withQuery('/library', params)),
  libraryRecord: (id: string): Promise<LibraryDetailResponse> =>
    getJson(`/library/${encodeURIComponent(id)}`),
  deleteObject: (disk: string, key: string): Promise<void> =>
    send('DELETE', withQuery(`/disks/${encodeURIComponent(disk)}/object`, { key })),
  copyObject: (disk: string, from: string, to: string): Promise<void> =>
    send('POST', `/disks/${encodeURIComponent(disk)}/copy`, { from, to }),
  moveObject: (disk: string, from: string, to: string): Promise<void> =>
    send('POST', `/disks/${encodeURIComponent(disk)}/move`, { from, to }),
  abortUpload: (id: string): Promise<void> =>
    send('POST', `/uploads/${encodeURIComponent(id)}/abort`),
  deleteLibraryRecord: (id: string): Promise<void> =>
    send('DELETE', `/library/${encodeURIComponent(id)}`),
  /** Upload a file to `key` on the disk (raw bytes; MIME preserved via the `type` param). */
  uploadObject: (disk: string, key: string, file: Blob & { type: string }): Promise<void> =>
    sendRaw(
      withQuery(`/disks/${encodeURIComponent(disk)}/upload`, {
        key,
        ...(file.type ? { type: file.type } : {}),
      }),
      file,
    ),
  /** Create a folder (a zero-byte marker at `<prefix>/`) on the disk. */
  createFolder: (disk: string, prefix: string): Promise<void> =>
    send('POST', `/disks/${encodeURIComponent(disk)}/folder`, { prefix }),
};

export type MediaConsoleClient = typeof mediaConsoleClient;
