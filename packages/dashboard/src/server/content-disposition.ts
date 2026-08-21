/** What a download is called when the key cannot name it — a folder marker, a blank key. */
const FALLBACK_FILENAME = 'download';

/**
 * RFC 5987 `attr-char`: the only bytes that may stand unescaped inside an `ext-value`. Everything
 * else is percent-encoded. `encodeURIComponent` alone is not enough — it leaves `'`, `(`, `)` and
 * `*` intact, and a bare `'` closes the ext-value early, truncating the name from that point on.
 */
const ATTR_CHAR = /^[A-Za-z0-9!#$&+\-.^_`|~]$/;

/** Percent-encode a name into an RFC 5987 `ext-value` payload (the part after `UTF-8''`). */
function toExtValue(name: string): string {
  let encoded = '';
  for (const byte of new TextEncoder().encode(name)) {
    const char = String.fromCharCode(byte);
    encoded += ATTR_CHAR.test(char) ? char : `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
  }
  return encoded;
}

/** The name to offer for an object key — its last segment, or a fallback when it has none. */
export function downloadFilename(key: string): string {
  const segment = key.split('/').pop() ?? '';
  return segment.trim() === '' ? FALLBACK_FILENAME : segment;
}

/**
 * Build a `Content-Disposition` that makes the browser SAVE the body under `filename`, in both the
 * forms RFC 6266 defines: a quoted ASCII `filename` every user agent understands, and the
 * `filename*` ext-value that carries the real, possibly non-ASCII name for those that prefer it.
 *
 * The quoted form is a header field value, so it is stripped down to what one can legally hold:
 * control characters (which would forge a header break), `"` and `\` (which would close the quoted
 * string and let a crafted object key append parameters of its own), and anything outside printable
 * ASCII. That strip is a security boundary, not tidiness — the name reaching here comes from a
 * storage key, which the console does not control.
 */
export function attachmentDisposition(filename: string): string {
  const name = filename.trim() === '' ? FALLBACK_FILENAME : filename;
  const ascii = name
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/["\\]/g, '')
    .trim();
  const quoted = ascii === '' ? FALLBACK_FILENAME : ascii;
  return `attachment; filename="${quoted}"; filename*=UTF-8''${toExtValue(name)}`;
}
