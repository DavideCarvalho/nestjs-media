export interface UploadMediaOptions {
  filename: string;
  contentType?: string;
  /** tus base path. Default `/media/uploads`. */
  basePath?: string;
  /** Bytes per PATCH chunk. Default 5 MiB. */
  chunkSize?: number;
  onProgress?: (sent: number, total: number) => void;
  fetchImpl?: typeof fetch;
}

export interface UploadMediaResult {
  location: string;
}

const DEFAULT_CHUNK = 5 * 1024 * 1024;

function encodeMetadata(meta: Record<string, string>): string {
  return Object.entries(meta)
    .map(([k, v]) => `${k} ${btoa(v)}`)
    .join(',');
}

/** Resumable upload of a Blob/File through the tus endpoints; returns its Location. */
export async function uploadMedia(
  data: Blob,
  options: UploadMediaOptions,
): Promise<UploadMediaResult> {
  const doFetch = options.fetchImpl ?? fetch;
  const base = options.basePath ?? '/media/uploads';
  const total = data.size;

  const create = await doFetch(base, {
    method: 'POST',
    headers: {
      'Tus-Resumable': '1.0.0',
      'Upload-Length': String(total),
      'Upload-Metadata': encodeMetadata({
        filename: options.filename,
        ...(options.contentType ? { filetype: options.contentType } : {}),
      }),
    },
  });
  const location = create.headers.get('Location');
  if (!location) throw new Error('media upload: server did not return a Location');

  const chunkSize = options.chunkSize ?? DEFAULT_CHUNK;
  let offset = 0;
  while (offset < total) {
    const slice = data.slice(offset, Math.min(offset + chunkSize, total));
    const res = await doFetch(location, {
      method: 'PATCH',
      headers: {
        'Tus-Resumable': '1.0.0',
        'Content-Type': 'application/offset+octet-stream',
        'Upload-Offset': String(offset),
      },
      body: slice,
    });
    offset = Number(res.headers.get('Upload-Offset') ?? offset);
    options.onProgress?.(offset, total);
  }

  return { location };
}

/** Build a media URL by id, optionally for a named conversion. */
export function mediaUrl(id: string, conversion?: string): string {
  const query = conversion ? `?conversion=${encodeURIComponent(conversion)}` : '';
  return `/media/${encodeURIComponent(id)}${query}`;
}
