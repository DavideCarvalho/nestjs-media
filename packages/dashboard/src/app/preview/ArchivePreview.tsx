import { useQuery } from '@tanstack/react-query';
import { Gunzip, inflateSync } from 'fflate';
import { useState } from 'react';
import { mediaConsoleClient } from '../../client/media-console-client.js';
import { DataTable } from '../DataTable.js';
import { Alert, Button, Notice, formatBytes } from '../ui.js';
import { Input } from '../ui/input.js';
import { FallbackCard, readErrorMessage } from './shared.js';
import type { PreviewItem } from './types.js';

/**
 * Archive listings, read the way the formats allow rather than the way that is convenient.
 *
 * A ZIP keeps its index — every entry's name, size, method and offset — in a *central directory* at
 * the very end of the file, so two ranged reads list it: the tail (to find the End of Central
 * Directory record) and the directory itself. Listing a 2 GB zip costs tens of kilobytes, and
 * clicking a text entry inside it costs that entry's compressed bytes and nothing else.
 *
 * A TAR has no index at all — it is 512-byte headers interleaved with the data they describe — and a
 * `.tar.gz` cannot even be read from the middle, since a DEFLATE stream only makes sense from byte
 * zero. Neither can be indexed from the tail, so both are *sampled* from the head and labelled as a
 * sample in the same voice `TextPreview` uses. Pretending otherwise would mean quietly showing
 * someone the first few entries of a thousand as if that were the archive.
 */

/** Worst-case distance from EOF to the start of the End of Central Directory record: the 22-byte
 *  record itself, an archive comment of up to 65535 bytes, and the 20-byte ZIP64 locator that sits
 *  immediately before it. Reading exactly this much means the scan can never miss the record. */
const ZIP_TAIL_BYTES = 22 + 0xffff + 20;

/** Ceiling on the central directory read. ~46 bytes plus a path per entry, so this covers a couple of
 *  hundred thousand entries; beyond it the listing is truncated and says so rather than pulling a
 *  directory that is itself a download. */
const ZIP_DIRECTORY_MAX_BYTES = 16 * 1024 * 1024;

/** Head sample walked for `.tar`. Headers are interleaved with payload, so how many entries this
 *  covers depends entirely on how big the archived files are — one 4 MB file inside buries the rest. */
const TAR_SAMPLE_BYTES = 2 * 1024 * 1024;

/** Compressed head sample gunzipped for `.tar.gz`. Kept small because DEFLATE expands up to ~1000×
 *  and the sample is arbitrary uploaded bytes: a hostile 256 KB could otherwise ask for 256 MB. The
 *  decompressed output is capped separately (`TAR_SAMPLE_BYTES`) and the push is chunked so the cap
 *  actually stops the work instead of being checked after it. */
const GZIP_SAMPLE_BYTES = 256 * 1024;

/** Bytes pushed into the gunzip per step, so hitting the output cap abandons the rest of the input. */
const GZIP_PUSH_CHUNK = 64 * 1024;

/** Largest entry extracted and shown inline. A preview pane is not a file viewer; anything bigger is
 *  a download, and the listing already said how big it is. */
const EXTRACT_MAX_BYTES = 512 * 1024;

const SIGNATURE_END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const SIGNATURE_ZIP64_LOCATOR = 0x07064b50;
const SIGNATURE_ZIP64_END_RECORD = 0x06064b50;
const SIGNATURE_CENTRAL_FILE_HEADER = 0x02014b50;
const SIGNATURE_LOCAL_FILE_HEADER = 0x04034b50;

/** The value a 32-bit ZIP field carries when the real number lives in a ZIP64 record instead. */
const U32_SATURATED = 0xffffffff;
const U16_SATURATED = 0xffff;

function viewOf(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/** ZIP64 counts and offsets are 64-bit. `Number` loses precision above 2^53, but a ZIP that large is
 *  not a thing anyone is previewing in a browser tab, and the alternative — BigInt arithmetic through
 *  every offset — buys nothing at the sizes that exist. */
function readU64(view: DataView, offset: number): number {
  return Number(view.getBigUint64(offset, true));
}

/** Compression method numbers, from APPNOTE 4.4.5. Anything unlisted is shown by number rather than
 *  guessed at, which is also the honest answer for the ones no browser can inflate. */
const ZIP_METHODS: Readonly<Record<number, string>> = {
  0: 'stored',
  1: 'shrunk',
  6: 'imploded',
  8: 'deflate',
  9: 'deflate64',
  12: 'bzip2',
  14: 'lzma',
  93: 'zstd',
  95: 'xz',
  96: 'jpeg',
  97: 'wavpack',
  98: 'ppmd',
  99: 'aes',
};

export function zipMethodName(method: number): string {
  return ZIP_METHODS[method] ?? `method ${method}`;
}

/** MS-DOS packed date/time, the only timestamp a plain ZIP entry is guaranteed to carry: 2-second
 *  resolution, no timezone, years counted from 1980. Rendered as the local wall clock it literally
 *  is rather than converted into a UTC instant it never was. */
export function formatDosDateTime(date: number, time: number): string {
  const year = 1980 + ((date >> 9) & 0x7f);
  const month = (date >> 5) & 0x0f;
  const day = date & 0x1f;
  if (month === 0 || day === 0) return '—';
  const hour = (time >> 11) & 0x1f;
  const minute = (time >> 5) & 0x3f;
  const second = (time & 0x1f) * 2;
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${year}-${pad(month)}-${pad(day)} ${pad(hour)}:${pad(minute)}:${pad(second)}`;
}

/** Seconds since the epoch (tar's `mtime`) as a UTC stamp — tar stores UTC, so showing it as UTC is
 *  the truthful rendering. */
export function formatEpochSeconds(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '—';
  const date = new Date(seconds * 1000);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

/** How much smaller the entry got, as a percentage. Empty entries have no ratio to report. */
export function formatRatio(uncompressed: number, compressed: number): string {
  if (uncompressed <= 0) return '—';
  return `${Math.round((1 - compressed / uncompressed) * 100)}%`;
}

export interface ZipEntry {
  path: string;
  directory: boolean;
  encrypted: boolean;
  method: number;
  uncompressedSize: number;
  compressedSize: number;
  modified: string;
  localHeaderOffset: number;
}

export interface ZipTailScan {
  centralDirectoryOffset: number;
  centralDirectorySize: number;
  entryCount: number;
  /** Absolute offset of the ZIP64 End of Central Directory record, when the tail carried a locator. */
  zip64RecordOffset: number | null;
  /** The 32-bit fields are pegged at their maximum: the real values are only in the ZIP64 record. */
  needsZip64: boolean;
}

/**
 * Find the End of Central Directory record by scanning the tail *backwards*, and read where the
 * central directory starts from it.
 *
 * Backwards, because the record has no length prefix and its 4-byte signature can occur inside stored
 * file data — the last match is the real one. The comment-length check is what makes a match
 * trustworthy: a genuine record's comment runs exactly to EOF, so an archive with a trailing comment
 * is found exactly like one without. A candidate that fails the check is remembered but not trusted,
 * so an archive with trailing garbage still lists instead of failing.
 *
 * The offsets returned are absolute: ZIP records address the file from byte zero, not from the tail.
 */
export function scanZipTail(tail: Uint8Array): ZipTailScan {
  const view = viewOf(tail);
  let fallback: number | null = null;
  let found: number | null = null;
  for (let at = tail.byteLength - 22; at >= 0; at--) {
    if (view.getUint32(at, true) !== SIGNATURE_END_OF_CENTRAL_DIRECTORY) continue;
    const commentLength = view.getUint16(at + 20, true);
    if (at + 22 + commentLength === tail.byteLength) {
      found = at;
      break;
    }
    if (fallback === null) fallback = at;
  }
  const at = found ?? fallback;
  if (at === null) {
    throw new Error(
      'No end-of-central-directory record in the last 64 KB — this is not a ZIP archive, or it is truncated.',
    );
  }

  const entryCount = view.getUint16(at + 10, true);
  const centralDirectorySize = view.getUint32(at + 12, true);
  const centralDirectoryOffset = view.getUint32(at + 16, true);
  const needsZip64 =
    entryCount === U16_SATURATED ||
    centralDirectorySize === U32_SATURATED ||
    centralDirectoryOffset === U32_SATURATED;

  // The ZIP64 locator, when there is one, sits in the 20 bytes immediately before the record.
  let zip64RecordOffset: number | null = null;
  if (at >= 20 && view.getUint32(at - 20, true) === SIGNATURE_ZIP64_LOCATOR) {
    zip64RecordOffset = readU64(view, at - 20 + 8);
  }

  return {
    centralDirectoryOffset,
    centralDirectorySize,
    entryCount,
    zip64RecordOffset,
    needsZip64,
  };
}

/** Read the ZIP64 End of Central Directory record — the 56-byte version, which is all any writer in
 *  the field emits — for the counts and offsets that did not fit in 32 bits. */
export function parseZip64EndRecord(bytes: Uint8Array): {
  centralDirectoryOffset: number;
  centralDirectorySize: number;
  entryCount: number;
} {
  if (bytes.byteLength < 56) throw new Error('The ZIP64 end record is truncated.');
  const view = viewOf(bytes);
  if (view.getUint32(0, true) !== SIGNATURE_ZIP64_END_RECORD) {
    throw new Error('The ZIP64 locator points at something that is not a ZIP64 end record.');
  }
  return {
    entryCount: readU64(view, 32),
    centralDirectorySize: readU64(view, 40),
    centralDirectoryOffset: readU64(view, 48),
  };
}

/** Pull the true sizes and local-header offset out of an entry's ZIP64 extra field (header id 1).
 *  The fields appear only for the base values that were saturated, in a fixed order, so which ones
 *  are present is decided by the 32-bit values we already read — not by the extra field's length. */
function applyZip64Extra(
  extra: Uint8Array,
  base: { uncompressedSize: number; compressedSize: number; localHeaderOffset: number },
): { uncompressedSize: number; compressedSize: number; localHeaderOffset: number } {
  const view = viewOf(extra);
  for (let at = 0; at + 4 <= extra.byteLength; ) {
    const id = view.getUint16(at, true);
    const size = view.getUint16(at + 2, true);
    const body = at + 4;
    if (body + size > extra.byteLength) break;
    if (id !== 0x0001) {
      at = body + size;
      continue;
    }
    let cursor = body;
    const result = { ...base };
    if (result.uncompressedSize === U32_SATURATED && cursor + 8 <= body + size) {
      result.uncompressedSize = readU64(view, cursor);
      cursor += 8;
    }
    if (result.compressedSize === U32_SATURATED && cursor + 8 <= body + size) {
      result.compressedSize = readU64(view, cursor);
      cursor += 8;
    }
    if (result.localHeaderOffset === U32_SATURATED && cursor + 8 <= body + size) {
      result.localHeaderOffset = readU64(view, cursor);
    }
    return result;
  }
  return { ...base };
}

/** Entry paths are UTF-8 whenever bit 11 of the flags says so, and in practice whenever they are
 *  ASCII — which covers everything but pre-2007 archives with non-English names. Those are CP437,
 *  which `TextDecoder` cannot do; UTF-8 leaves their ASCII bytes exact and mangles only the accents,
 *  which beats refusing to list the archive. */
function decodePath(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

/**
 * Walk the central directory into entries. Stops cleanly at the first record that is not a central
 * file header or that runs off the end of the bytes we read, reporting `truncated` — a directory can
 * legitimately be cut short here, because the read is capped, and a corrupt one should degrade to
 * "here is what was readable" rather than to nothing.
 */
export function parseZipCentralDirectory(bytes: Uint8Array): {
  entries: ZipEntry[];
  truncated: boolean;
} {
  const view = viewOf(bytes);
  const entries: ZipEntry[] = [];
  let at = 0;
  let truncated = false;

  while (at + 46 <= bytes.byteLength) {
    if (view.getUint32(at, true) !== SIGNATURE_CENTRAL_FILE_HEADER) {
      truncated = true;
      break;
    }
    const flags = view.getUint16(at + 8, true);
    const method = view.getUint16(at + 10, true);
    const time = view.getUint16(at + 12, true);
    const date = view.getUint16(at + 14, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const externalAttributes = view.getUint32(at + 38, true);
    const total = 46 + nameLength + extraLength + commentLength;
    if (at + total > bytes.byteLength) {
      truncated = true;
      break;
    }

    const sizes = applyZip64Extra(
      bytes.subarray(at + 46 + nameLength, at + 46 + nameLength + extraLength),
      {
        uncompressedSize: view.getUint32(at + 24, true),
        compressedSize: view.getUint32(at + 20, true),
        localHeaderOffset: view.getUint32(at + 42, true),
      },
    );
    const path = decodePath(bytes.subarray(at + 46, at + 46 + nameLength));
    // A directory is marked by the trailing slash every writer adds, or by the Unix mode in the high
    // half of the external attributes for the writers that do not.
    const unixMode = (externalAttributes >>> 16) & 0xffff;
    entries.push({
      path,
      directory: path.endsWith('/') || (unixMode & 0o170000) === 0o040000,
      encrypted: (flags & 0x0001) !== 0,
      method,
      uncompressedSize: sizes.uncompressedSize,
      compressedSize: sizes.compressedSize,
      modified: formatDosDateTime(date, time),
      localHeaderOffset: sizes.localHeaderOffset,
    });
    at += total;
  }

  if (entries.length === 0) {
    throw new Error('The central directory holds no readable entries — the archive looks corrupt.');
  }
  // A complete directory ends exactly where its last record does. Bytes left over — fewer than a
  // header's worth, so the loop simply stopped — mean the read was cut short mid-record.
  return { entries, truncated: truncated || at < bytes.byteLength };
}

export interface TarEntry {
  path: string;
  kind: 'file' | 'dir' | 'symlink' | 'hardlink' | 'other';
  size: number;
  mode: string;
  owner: string;
  modified: string;
}

/** A NUL-terminated fixed-width tar string field. */
function readTarString(bytes: Uint8Array, at: number, length: number): string {
  const slice = bytes.subarray(at, at + length);
  const end = slice.indexOf(0);
  return new TextDecoder().decode(end < 0 ? slice : slice.subarray(0, end));
}

/** A tar numeric field: NUL/space-padded octal, or GNU's base-256 escape (high bit of the first byte)
 *  for the sizes and timestamps that no longer fit in 11 octal digits. `null` means unparseable, which
 *  the caller treats as "this is not a header". */
function readTarNumber(bytes: Uint8Array, at: number, length: number): number | null {
  const first = bytes[at];
  if (first === undefined) return null;
  if ((first & 0x80) !== 0) {
    let value = 0;
    for (let i = 1; i < length; i++) value = value * 256 + (bytes[at + i] ?? 0);
    return value;
  }
  let text = '';
  for (let i = 0; i < length; i++) text += String.fromCharCode(bytes[at + i] ?? 0);
  const trimmed = text.replace(/\0/g, ' ').trim();
  if (trimmed === '') return 0;
  if (!/^[0-7]+$/.test(trimmed)) return null;
  return Number.parseInt(trimmed, 8);
}

/** The header checksum, computed with the checksum field itself read as spaces. This is the only
 *  thing that distinguishes a tar header from 512 arbitrary bytes, so it is also how this parser
 *  decides that what it is pointed at is a tar at all. Historic writers disagreed on whether the
 *  bytes are signed, so both sums are accepted. */
function tarChecksumMatches(bytes: Uint8Array, at: number): boolean {
  const stored = readTarNumber(bytes, at + 148, 8);
  if (stored === null) return false;
  let unsigned = 0;
  let signed = 0;
  for (let i = 0; i < 512; i++) {
    const raw = i >= 148 && i < 156 ? 32 : (bytes[at + i] ?? 0);
    unsigned += raw;
    signed += raw > 127 ? raw - 256 : raw;
  }
  return stored === unsigned || stored === signed;
}

function isZeroBlock(bytes: Uint8Array, at: number): boolean {
  for (let i = 0; i < 512; i++) {
    if ((bytes[at + i] ?? 0) !== 0) return false;
  }
  return true;
}

function tarKind(typeflag: string, path: string): TarEntry['kind'] {
  if (typeflag === '5') return 'dir';
  if (typeflag === '2') return 'symlink';
  if (typeflag === '1') return 'hardlink';
  if (typeflag === '0' || typeflag === '\u0000' || typeflag === '7') {
    return path.endsWith('/') ? 'dir' : 'file';
  }
  return 'other';
}

/** Pull `path=` out of a PAX extended header's records — the modern way a long or non-ASCII name is
 *  carried, since the ustar name field is 100 bytes. Records are `<len> <key>=<value>\n`. */
function paxPath(data: Uint8Array): string | null {
  const text = new TextDecoder().decode(data);
  const match = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(text);
  return match?.[1] ?? null;
}

/**
 * Walk 512-byte tar headers into entries.
 *
 * `truncated` means the walk ran off the end of the bytes it was given rather than reaching the two
 * zero blocks that end an archive — i.e. this is a sample of a longer tar, which is the normal case
 * here and must be said out loud. Throws only when the very first block is not a tar header, since
 * that is the difference between "a sample" and "not a tar".
 */
export function parseTarEntries(bytes: Uint8Array): { entries: TarEntry[]; truncated: boolean } {
  const entries: TarEntry[] = [];
  let at = 0;
  // GNU 'L' and PAX 'x' blocks describe the *next* entry rather than being entries themselves.
  let pendingPath: string | null = null;

  while (at + 512 <= bytes.byteLength) {
    if (isZeroBlock(bytes, at)) return { entries, truncated: false };
    if (!tarChecksumMatches(bytes, at)) {
      if (entries.length === 0) {
        throw new Error(
          'This is not a TAR archive — the first block has no valid header checksum.',
        );
      }
      return { entries, truncated: true };
    }

    const size = readTarNumber(bytes, at + 124, 12) ?? 0;
    const modified = readTarNumber(bytes, at + 136, 12) ?? 0;
    const typeflag = String.fromCharCode(bytes[at + 156] ?? 0);
    const dataAt = at + 512;
    const dataBlocks = Math.ceil(size / 512) * 512;
    const hasData = dataAt + size <= bytes.byteLength;

    if (typeflag === 'L' || typeflag === 'x' || typeflag === 'g') {
      if (!hasData) return { entries, truncated: true };
      const data = bytes.subarray(dataAt, dataAt + size);
      // A global PAX header ('g') sets defaults for the whole archive; taking its path as an entry
      // name would be wrong, so only the per-entry forms feed `pendingPath`.
      if (typeflag === 'L') pendingPath = readTarString(data, 0, size);
      else if (typeflag === 'x') pendingPath = paxPath(data);
      at = dataAt + dataBlocks;
      continue;
    }

    const name = readTarString(bytes, at, 100);
    const prefix = readTarString(bytes, at + 257, 6).startsWith('ustar')
      ? readTarString(bytes, at + 345, 155)
      : '';
    const path = pendingPath ?? (prefix ? `${prefix}/${name}` : name);
    pendingPath = null;
    const user =
      readTarString(bytes, at + 265, 32) || String(readTarNumber(bytes, at + 108, 8) ?? 0);
    const group =
      readTarString(bytes, at + 297, 32) || String(readTarNumber(bytes, at + 116, 8) ?? 0);
    entries.push({
      path,
      kind: tarKind(typeflag, path),
      size,
      mode: (readTarNumber(bytes, at + 100, 8) ?? 0).toString(8).padStart(4, '0'),
      owner: `${user}/${group}`,
      modified: formatEpochSeconds(modified),
    });

    at = dataAt + dataBlocks;
  }

  return { entries, truncated: true };
}

export type ArchiveFormat = 'zip' | 'tar' | 'tar.gz' | 'bzip2' | 'xz' | 'unknown';

/** Which container this object is, from its name and declared type. Extensions win over content
 *  types here for the same reason `kinds.ts` prefers them: a disk that labels everything
 *  `application/octet-stream` is the common case, and `application/zip` is what half the world calls
 *  a `.jar`, a `.whl` and an `.xpi` too. */
export function archiveFormat(name: string, contentType: string | undefined): ArchiveFormat {
  if (/\.(tar\.bz2|tbz2?|bz2)$/i.test(name)) return 'bzip2';
  if (/\.(tar\.xz|txz|xz)$/i.test(name)) return 'xz';
  if (/\.(tar\.gz|tgz|gz)$/i.test(name)) return 'tar.gz';
  if (/\.tar$/i.test(name)) return 'tar';
  if (/\.(zip|jar|war|whl|xpi)$/i.test(name)) return 'zip';
  const type = contentType?.toLowerCase().split(';')[0]?.trim() ?? '';
  if (type === 'application/zip' || type === 'application/x-zip-compressed') return 'zip';
  if (type === 'application/x-tar') return 'tar';
  if (type === 'application/gzip' || type === 'application/x-gzip') return 'tar.gz';
  if (type === 'application/x-bzip2') return 'bzip2';
  if (type === 'application/x-xz') return 'xz';
  return 'unknown';
}

/** Last resort when neither the name nor the type committed to anything: the magic bytes. `ustar` at
 *  257 is the tar header's own signature, which is why the sample has to be a whole block. */
export function sniffArchiveFormat(head: Uint8Array): ArchiveFormat {
  const magic = (...bytes: number[]): boolean => bytes.every((byte, index) => head[index] === byte);
  if (magic(0x50, 0x4b)) return 'zip';
  if (magic(0x1f, 0x8b)) return 'tar.gz';
  if (magic(0x42, 0x5a, 0x68)) return 'bzip2';
  if (magic(0xfd, 0x37, 0x7a, 0x58, 0x5a)) return 'xz';
  if (head.byteLength >= 512 && readTarString(head, 257, 6).startsWith('ustar')) return 'tar';
  return 'unknown';
}

/** File extensions worth offering to extract and show. Anything else is bytes, and a `<pre>` full of
 *  replacement characters is not a preview — the listing already said how big it is. */
const TEXT_ENTRY =
  /\.(txt|md|markdown|json|ndjson|jsonl|csv|tsv|xml|ya?ml|toml|ini|cfg|conf|properties|log|sql|html?|css|scss|jsx?|mjs|cjs|tsx?|sh|bash|py|rb|go|rs|java|kt|kts|c|h|cpp|hpp|cs|php|pl|lua|gradle|env|lock|gitignore|dockerfile|mf|classpath|project)$/i;
const TEXT_ENTRY_BASENAME =
  /^(readme|license|licence|notice|changelog|authors|copying|makefile|dockerfile|\.gitignore|\.npmrc|\.editorconfig)$/i;

export function isTextEntryPath(path: string): boolean {
  const base = path.split('/').pop() ?? '';
  return TEXT_ENTRY.test(base) || TEXT_ENTRY_BASENAME.test(base);
}

/** Whether clicking this entry can produce something readable: a small, unencrypted, non-directory
 *  entry in a method this page can actually decompress. */
export function isExtractable(entry: ZipEntry): boolean {
  return (
    !entry.directory &&
    !entry.encrypted &&
    (entry.method === 0 || entry.method === 8) &&
    entry.uncompressedSize > 0 &&
    entry.uncompressedSize <= EXTRACT_MAX_BYTES &&
    isTextEntryPath(entry.path)
  );
}

type ArchiveListing =
  | {
      kind: 'zip';
      entries: ZipEntry[];
      /** What the archive claims it holds — larger than `entries.length` when the read was capped. */
      declaredCount: number;
      zip64: boolean;
      truncated: boolean;
      bytesRead: number;
    }
  | {
      kind: 'tar';
      entries: TarEntry[];
      compression: 'none' | 'gzip';
      sampled: boolean;
      bytesRead: number;
    }
  | { kind: 'unsupported'; message: string };

/** A ranged read clamped to the object, so a bad offset in a corrupt header cannot ask a disk for
 *  bytes past EOF (which some answer with a 416 and others with the whole file). */
async function readRange(item: PreviewItem, start: number, length: number): Promise<Uint8Array> {
  if (item.size <= 0) throw new Error('This object is empty.');
  const from = Math.max(0, Math.min(start, item.size - 1));
  const to = Math.min(item.size - 1, from + Math.max(1, length) - 1);
  return mediaConsoleClient.objectRange(item.disk, item.key, from, to);
}

async function readZipListing(item: PreviewItem): Promise<ArchiveListing> {
  if (item.size < 22) throw new Error('This file is too small to be a ZIP archive.');
  const tailLength = Math.min(ZIP_TAIL_BYTES, item.size);
  const tailStart = item.size - tailLength;
  const tail = await readRange(item, tailStart, tailLength);
  let bytesRead = tail.byteLength;

  const scan = scanZipTail(tail);
  let { centralDirectoryOffset, centralDirectorySize, entryCount } = scan;
  let zip64 = false;

  if (scan.zip64RecordOffset !== null) {
    // The record is usually inside the tail we already hold; only a huge archive comment pushes it
    // out of reach, and then it is worth one more 56-byte read rather than a bigger tail every time.
    const inTail = scan.zip64RecordOffset - tailStart;
    let record: Uint8Array;
    if (inTail >= 0 && inTail + 56 <= tail.byteLength) {
      record = tail.subarray(inTail, inTail + 56);
    } else {
      record = await readRange(item, scan.zip64RecordOffset, 56);
      bytesRead += record.byteLength;
    }
    const zip64Record = parseZip64EndRecord(record);
    centralDirectoryOffset = zip64Record.centralDirectoryOffset;
    centralDirectorySize = zip64Record.centralDirectorySize;
    entryCount = zip64Record.entryCount;
    zip64 = true;
  } else if (scan.needsZip64) {
    // The 32-bit fields are pegged and there is no locator to resolve them: the offsets we hold are
    // placeholders, not addresses. Listing from them would show a confidently wrong archive.
    throw new Error(
      'This is a ZIP64 archive (over 4 GB or over 65,535 entries) whose ZIP64 locator is missing, so its central directory cannot be found.',
    );
  }

  if (centralDirectoryOffset + centralDirectorySize > item.size) {
    throw new Error('The central directory points outside the file — the archive is truncated.');
  }

  const readSize = Math.min(centralDirectorySize, ZIP_DIRECTORY_MAX_BYTES);
  const directory = await readRange(item, centralDirectoryOffset, readSize);
  bytesRead += directory.byteLength;
  const parsed = parseZipCentralDirectory(directory);

  return {
    kind: 'zip',
    entries: parsed.entries,
    declaredCount: entryCount,
    zip64,
    truncated: parsed.truncated || readSize < centralDirectorySize,
    bytesRead,
  };
}

/** Gunzip a compressed head sample, stopping as soon as enough plain bytes exist to walk. The stream
 *  is fed in chunks and never told it is final, because it is not: a truncated DEFLATE stream is the
 *  expected input here, and only the incremental API tolerates one. */
export function gunzipSample(compressed: Uint8Array): Uint8Array {
  const chunks: Uint8Array[] = [];
  let total = 0;
  const gunzip = new Gunzip((chunk) => {
    if (total >= TAR_SAMPLE_BYTES) return;
    chunks.push(chunk);
    total += chunk.byteLength;
  });
  try {
    for (
      let at = 0;
      at < compressed.byteLength && total < TAR_SAMPLE_BYTES;
      at += GZIP_PUSH_CHUNK
    ) {
      gunzip.push(compressed.subarray(at, at + GZIP_PUSH_CHUNK), false);
    }
  } catch (error) {
    // A header that is not gzip fails on the first push and there is nothing to show; a stream that
    // fails partway still has everything decoded before the failure, which is a usable sample.
    if (total === 0)
      throw new Error(readErrorMessage(error, 'Could not decompress this gzip stream.'));
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}

/** `parseTarEntries` with the caller's wording for "the first block is not a tar header", which means
 *  something different depending on how the bytes got here. */
function tryParseTar(
  bytes: Uint8Array,
  message: string,
): { entries: TarEntry[]; truncated: boolean } {
  try {
    return parseTarEntries(bytes);
  } catch {
    throw new Error(message);
  }
}

async function readTarListing(item: PreviewItem, compressed: boolean): Promise<ArchiveListing> {
  const budget = compressed ? GZIP_SAMPLE_BYTES : TAR_SAMPLE_BYTES;
  const sampleLength = Math.min(budget, item.size);
  const sample = await readRange(item, 0, sampleLength);
  const plain = compressed ? gunzipSample(sample) : sample;
  // `.gz` on its own is routed here too, since a gzip stream carries no hint of what is inside it —
  // and when what is inside is not a tar, saying that beats reporting a broken tar.
  const parsed = compressed
    ? tryParseTar(plain, 'This gzip stream does not contain a TAR archive.')
    : parseTarEntries(plain);
  return {
    kind: 'tar',
    entries: parsed.entries,
    compression: compressed ? 'gzip' : 'none',
    sampled: parsed.truncated || sample.byteLength < item.size,
    bytesRead: sample.byteLength,
  };
}

async function readArchive(item: PreviewItem): Promise<ArchiveListing> {
  let format = archiveFormat(item.name, item.contentType);
  if (format === 'unknown') {
    format = sniffArchiveFormat(await readRange(item, 0, 512));
  }
  switch (format) {
    case 'zip':
      return readZipListing(item);
    case 'tar':
      return readTarListing(item, false);
    case 'tar.gz':
      return readTarListing(item, true);
    case 'bzip2':
    case 'xz':
      return {
        kind: 'unsupported',
        // Naming the compression matters: it is the difference between "this tool is broken" and
        // "this needs bunzip2/xz, which no browser ships".
        message: `This is a ${format === 'bzip2' ? 'bzip2' : 'xz'}-compressed archive. Only its compressed bytes are here, and ${format === 'bzip2' ? 'bzip2' : 'xz'} cannot be decompressed in the browser, so its contents cannot be listed inline.`,
      };
    case 'unknown':
      return { kind: 'unsupported', message: 'This file is not a ZIP, TAR or gzip archive.' };
  }
}

/**
 * Read one entry out of the archive without reading the archive.
 *
 * The central directory gave us the entry's local header offset, but not where its data starts — the
 * local header repeats the name and carries its *own* extra field, which is routinely a different
 * length from the central one (writers pad it for alignment). So this reads the 30-byte local header
 * first for those two lengths, and only then the compressed bytes themselves.
 */
export async function extractZipEntry(
  item: PreviewItem,
  entry: ZipEntry,
): Promise<{ text: string; binary: boolean; bytesRead: number }> {
  const header = await readRange(item, entry.localHeaderOffset, 30);
  if (header.byteLength < 30 || viewOf(header).getUint32(0, true) !== SIGNATURE_LOCAL_FILE_HEADER) {
    throw new Error('This entry does not start with a local file header — the archive is corrupt.');
  }
  // An entry with no bytes has nothing to inflate, and asking a disk for a zero-length range is how
  // you get a 416 or, worse, the whole object.
  if (entry.compressedSize <= 0) return { text: '', binary: false, bytesRead: header.byteLength };
  const headerView = viewOf(header);
  const dataStart =
    entry.localHeaderOffset + 30 + headerView.getUint16(26, true) + headerView.getUint16(28, true);
  const compressed = await readRange(item, dataStart, entry.compressedSize);
  // `inflateSync` wants a *raw* DEFLATE stream, which is exactly what a ZIP entry holds — no zlib or
  // gzip wrapper. It throws on a corrupt one, and the caller turns that into a message.
  const bytes = entry.method === 0 ? compressed : inflateSync(compressed);
  const text = new TextDecoder().decode(bytes.subarray(0, EXTRACT_MAX_BYTES));
  return {
    text,
    // A NUL byte is the cheap, reliable tell that this is not text after all, whatever the extension
    // claimed. Showing the `<pre>` anyway would fill the pane with replacement characters.
    binary: text.includes('\u0000'),
    bytesRead: header.byteLength + compressed.byteLength,
  };
}

function zipTable(entries: ZipEntry[]): { header: string[]; body: string[][] } {
  return {
    header: ['path', 'kind', 'size', 'compressed', 'ratio', 'method', 'modified'],
    body: entries.map((entry) => [
      entry.path,
      entry.directory ? 'dir' : entry.encrypted ? 'file (encrypted)' : 'file',
      entry.directory ? '—' : formatBytes(entry.uncompressedSize),
      entry.directory ? '—' : formatBytes(entry.compressedSize),
      entry.directory ? '—' : formatRatio(entry.uncompressedSize, entry.compressedSize),
      entry.directory ? '—' : zipMethodName(entry.method),
      entry.modified,
    ]),
  };
}

function tarTable(entries: TarEntry[]): { header: string[]; body: string[][] } {
  return {
    header: ['path', 'kind', 'size', 'mode', 'owner', 'modified'],
    body: entries.map((entry) => [
      entry.path,
      entry.kind,
      entry.kind === 'dir' ? '—' : formatBytes(entry.size),
      entry.mode,
      entry.owner,
      entry.modified,
    ]),
  };
}

/**
 * Lists an archive's contents from ranged reads, and — for a ZIP — extracts a single text entry on
 * demand. Opening a 2 GB zip costs the tail plus its central directory; reading one 3 KB file out of
 * it costs 3 KB. That is the whole point of the format's layout, and almost nothing takes advantage
 * of it.
 */
export function ArchivePreview({ item }: { item: PreviewItem }): JSX.Element {
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  const listing = useQuery({
    queryKey: ['archive-listing', item.disk, item.key],
    queryFn: () => readArchive(item),
    retry: false,
    staleTime: 60_000,
  });

  const zipEntries = listing.data?.kind === 'zip' ? listing.data.entries : [];
  const selectedEntry = zipEntries.find((entry) => entry.path === selected) ?? null;

  const extraction = useQuery({
    queryKey: ['archive-entry', item.disk, item.key, selected],
    queryFn: () => {
      if (!selectedEntry) throw new Error('No entry selected.');
      return extractZipEntry(item, selectedEntry);
    },
    enabled: selectedEntry !== null,
    retry: false,
    staleTime: 60_000,
  });

  if (listing.isLoading) return <Notice>Reading archive…</Notice>;
  if (listing.isError || !listing.data) {
    return (
      <FallbackCard
        item={item}
        message={readErrorMessage(listing.error, 'Could not read this archive.')}
      />
    );
  }

  const data = listing.data;
  if (data.kind === 'unsupported') return <FallbackCard item={item} message={data.message} />;

  if (data.kind === 'tar') {
    const table = tarTable(data.entries);
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-2">
        {data.sampled && (
          <Alert variant="warn" className="shrink-0">
            Sample — a TAR has no index, so this is what fits in the first{' '}
            {formatBytes(data.bytesRead)} of {formatBytes(item.size)}
            {data.compression === 'gzip' ? ', gunzipped from the start of the stream' : ''}. Filters
            and sort apply to these {data.entries.length}{' '}
            {data.entries.length === 1 ? 'entry' : 'entries'}; open the original ↗ for the whole
            archive.
          </Alert>
        )}
        {data.entries.length === 0 ? (
          <Notice>No entries in the sample.</Notice>
        ) : (
          <DataTable header={table.header} body={table.body} />
        )}
        <div className="mono tnum shrink-0 text-[10px] text-zinc-600">
          {data.entries.length} {data.entries.length === 1 ? 'entry' : 'entries'} · read{' '}
          {formatBytes(data.bytesRead)} of {formatBytes(item.size)}
          {data.compression === 'gzip' && ' · gunzipped'}
        </div>
      </div>
    );
  }

  const extractable = data.entries.filter(isExtractable);
  const needle = filter.trim().toLowerCase();
  const offered = (
    needle ? extractable.filter((entry) => entry.path.toLowerCase().includes(needle)) : extractable
  ).slice(0, 300);
  const table = zipTable(data.entries);

  return (
    <div className="flex min-h-0 flex-1 gap-3">
      {extractable.length > 0 && (
        <div className="flex w-56 shrink-0 flex-col gap-1 overflow-auto">
          <div className="shrink-0 text-[10px] uppercase tracking-wide text-zinc-500">
            Readable entries
          </div>
          <Input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="find an entry…"
            className="shrink-0"
          />
          {offered.map((entry) => (
            <Button
              key={entry.path}
              tone={entry.path === selected ? 'selected' : 'quiet'}
              title={`${entry.path} · ${formatBytes(entry.uncompressedSize)}`}
              className="justify-start px-2 py-0.5 text-left"
              onClick={() => setSelected(entry.path === selected ? null : entry.path)}
            >
              <span className="truncate">{entry.path.split('/').pop() || entry.path}</span>
            </Button>
          ))}
          {offered.length < extractable.length && (
            <div className="mono shrink-0 px-2 text-[10px] text-zinc-600">
              {extractable.length - offered.length} more — narrow the filter
            </div>
          )}
        </div>
      )}

      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
        {data.zip64 && (
          <Alert variant="warn" className="shrink-0">
            ZIP64 archive — over 4 GB or over 65,535 entries. Its 64-bit directory was read in full.
          </Alert>
        )}
        {data.truncated && (
          <Alert variant="warn" className="shrink-0">
            Partial listing — the central directory was cut short after {data.entries.length} of{' '}
            {data.declaredCount} entries.
          </Alert>
        )}

        {selectedEntry ? (
          <>
            <div className="flex shrink-0 items-center gap-2">
              <Button tone="ghost" onClick={() => setSelected(null)}>
                ← Listing
              </Button>
              <span className="mono truncate text-[11px] text-zinc-400">{selectedEntry.path}</span>
            </div>
            {extraction.isLoading && <Notice>Extracting…</Notice>}
            {extraction.isError && (
              <Alert variant="error">
                {readErrorMessage(extraction.error, 'Could not extract this entry.')}
              </Alert>
            )}
            {extraction.data &&
              (extraction.data.binary ? (
                <Alert variant="warn">
                  This entry is binary despite its name — showing it as text would be noise.
                </Alert>
              ) : (
                <pre className="mono min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-black/30 p-3 text-xs text-zinc-300">
                  {extraction.data.text}
                </pre>
              ))}
            {extraction.data && (
              <div className="mono tnum shrink-0 text-[10px] text-zinc-600">
                read {formatBytes(extraction.data.bytesRead)} of {formatBytes(item.size)} ·{' '}
                {zipMethodName(selectedEntry.method)} ·{' '}
                {formatBytes(selectedEntry.uncompressedSize)} uncompressed
              </div>
            )}
          </>
        ) : (
          <>
            <DataTable header={table.header} body={table.body} />
            <div className="mono tnum shrink-0 text-[10px] text-zinc-600">
              {data.entries.length} {data.entries.length === 1 ? 'entry' : 'entries'} · read{' '}
              {formatBytes(data.bytesRead)} of {formatBytes(item.size)}
              {extractable.length > 0 && ' · pick an entry on the left to read it'}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
