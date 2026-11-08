/** What a download is called when the key cannot name it — a blank key. */
const FALLBACK_FILENAME = 'download';

/**
 * The name to offer for an object key — its last segment, or a fallback when it has none. The
 * `Content-Disposition` itself (RFC 6266, with the `filename*` form for non-ASCII names) is built
 * by `@nestjs/storage`'s `serveFile()`.
 */
export function downloadFilename(key: string): string {
  const segment = key.split('/').pop() ?? '';
  return segment.trim() === '' ? FALLBACK_FILENAME : segment;
}
