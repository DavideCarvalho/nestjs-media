/** S3's limit, which `@nestjs/storage` applies to every disk. */
const MAX_KEY_BYTES = 1024;
// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what it matches
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;

/** A key that `@nestjs/storage` refuses. Carries `status` 400, like `StorageInvalidKeyError`. */
export class InvalidMediaKeyError extends Error {
  readonly code = 'MEDIA_INVALID_KEY';
  readonly status = 400;
  constructor(reason: string) {
    super(`Invalid storage key: ${reason}`);
    this.name = 'InvalidMediaKeyError';
  }
}

/**
 * Makes untrusted text (a client's file name, an owner id) usable as ONE key segment under
 * `@nestjs/storage`'s key rule: `/` and `\` and control characters become `_`, and an empty,
 * `.` or `..` segment becomes `_`. Other characters are kept, so ordinary names don't change.
 */
export function keySegment(value: string): string {
  const cleaned = String(value).replace(/[/\\]/g, '_').replace(CONTROL, '_');
  if (cleaned === '' || cleaned === '.' || cleaned === '..') return '_';
  return cleaned;
}

/**
 * `@nestjs/storage`'s key rule (it doesn't export its own check): a relative, `/`-separated path
 * without empty, `.` or `..` segments, backslashes or control characters, at most 1024 UTF-8
 * bytes. Used where a key reaches a store without going through a `StorageDisk` (the multipart
 * side-car), so an object is never created at a key the disk can't read back.
 */
export function assertMediaKey(key: string): void {
  if (typeof key !== 'string' || key.length === 0) throw new InvalidMediaKeyError('empty');
  if (Buffer.byteLength(key, 'utf8') > MAX_KEY_BYTES) {
    throw new InvalidMediaKeyError(`longer than ${MAX_KEY_BYTES} bytes`);
  }
  if (new RegExp(CONTROL.source).test(key)) throw new InvalidMediaKeyError('control character');
  if (key.includes('\\')) throw new InvalidMediaKeyError('backslash');
  for (const segment of key.split('/')) {
    if (segment === '') throw new InvalidMediaKeyError('empty segment, or a leading/trailing "/"');
    if (segment === '.' || segment === '..') throw new InvalidMediaKeyError('"." or ".." segment');
  }
}

/** A folder prefix (`a/b` or `a/b/`) as `a/b/`, checked against the key rule. `''` stays `''`. */
export function folderPrefix(prefix: string): string {
  const trimmed = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
  if (trimmed === '') return '';
  assertMediaKey(trimmed);
  return `${trimmed}/`;
}
