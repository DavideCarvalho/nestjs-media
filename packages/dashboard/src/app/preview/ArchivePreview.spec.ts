// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { gzipSync, zipSync } from 'fflate';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mediaConsoleClient } from '../../client/media-console-client.js';
import {
  ArchivePreview,
  archiveFormat,
  extractZipEntry,
  formatDosDateTime,
  formatRatio,
  gunzipSample,
  isTextEntryPath,
  parseTarEntries,
  parseZip64EndRecord,
  parseZipCentralDirectory,
  scanZipTail,
  sniffArchiveFormat,
  zipMethodName,
} from './ArchivePreview.js';
import type { PreviewItem } from './types.js';

/** Every fixture below is a real archive: the ZIPs come out of fflate's writer, the gzip out of its
 *  gzip writer, and the TARs are assembled byte-for-byte to the ustar layout with a real header
 *  checksum — which is the only thing that makes a tar parseable at all, so a fake one would not
 *  survive the parser. */

const encoder = new TextEncoder();

/** Re-issue a ZIP with an archive comment appended, the way a writer that supports comments would:
 *  the comment length in the End of Central Directory record is patched and the bytes follow it. This
 *  is what moves the record off the end of the file, which is the case a naive "read the last 22
 *  bytes" parser gets wrong. */
function withArchiveComment(zip: Uint8Array, comment: string): Uint8Array {
  const commentBytes = encoder.encode(comment);
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  let eocd = -1;
  for (let at = zip.byteLength - 22; at >= 0; at--) {
    if (view.getUint32(at, true) === 0x06054b50) {
      eocd = at;
      break;
    }
  }
  if (eocd < 0) throw new Error('fixture zip has no EOCD');
  const out = new Uint8Array(zip.byteLength + commentBytes.byteLength);
  out.set(zip, 0);
  out.set(commentBytes, zip.byteLength);
  new DataView(out.buffer).setUint16(eocd + 20, commentBytes.byteLength, true);
  return out;
}

/** The central directory bytes of a zip, sliced out using its own End of Central Directory record —
 *  i.e. exactly what `ArchivePreview` fetches with its second range read. */
function centralDirectoryOf(zip: Uint8Array): Uint8Array {
  const scan = scanZipTail(zip);
  return zip.subarray(
    scan.centralDirectoryOffset,
    scan.centralDirectoryOffset + scan.centralDirectorySize,
  );
}

/** One 512-byte ustar header block with a correctly computed checksum. */
function tarHeader(options: {
  name: string;
  size: number;
  typeflag?: string;
  mode?: number;
  mtime?: number;
  prefix?: string;
}): Uint8Array {
  const block = new Uint8Array(512);
  const put = (text: string, at: number): void => block.set(encoder.encode(text), at);
  const octal = (value: number, at: number, width: number): void =>
    put(value.toString(8).padStart(width - 1, '0'), at);

  put(options.name, 0);
  octal(options.mode ?? 0o644, 100, 8);
  octal(0, 108, 8);
  octal(0, 116, 8);
  octal(options.size, 124, 12);
  octal(options.mtime ?? 1_700_000_000, 136, 12);
  block.fill(32, 148, 156); // checksum field reads as spaces while the checksum is computed
  put(options.typeflag ?? '0', 156);
  put('ustar', 257);
  put('00', 263);
  put('root', 265);
  put('wheel', 297);
  if (options.prefix) put(options.prefix, 345);

  let sum = 0;
  for (const byte of block) sum += byte;
  put(sum.toString(8).padStart(6, '0'), 148);
  block[154] = 0;
  block[155] = 32;
  return block;
}

/** A tar: header + NUL-padded data per entry, terminated by the two zero blocks. */
function buildTar(
  files: Array<{ name: string; body?: string; typeflag?: string; prefix?: string }>,
): Uint8Array {
  const blocks: Uint8Array[] = [];
  for (const file of files) {
    const data = encoder.encode(file.body ?? '');
    blocks.push(
      tarHeader({
        name: file.name,
        size: data.byteLength,
        ...(file.typeflag ? { typeflag: file.typeflag } : {}),
        ...(file.prefix ? { prefix: file.prefix } : {}),
      }),
    );
    if (data.byteLength > 0) {
      const padded = new Uint8Array(Math.ceil(data.byteLength / 512) * 512);
      padded.set(data, 0);
      blocks.push(padded);
    }
  }
  blocks.push(new Uint8Array(1024));
  const total = blocks.reduce((sum, block) => sum + block.byteLength, 0);
  const tar = new Uint8Array(total);
  let at = 0;
  for (const block of blocks) {
    tar.set(block, at);
    at += block.byteLength;
  }
  return tar;
}

/** Deterministic, badly-compressible text — a fixture that gzips to something with more than one
 *  block in it, seeded so every run produces the same bytes. */
function noise(length: number, seed: number): string {
  let state = seed * 2_654_435_761;
  let text = '';
  while (text.length < length) {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    text += state.toString(36);
  }
  return text.slice(0, length);
}

const SMALL_ZIP = zipSync({
  'readme.txt': encoder.encode('hello from a zip\n'),
  'src/app.js': encoder.encode(`console.log(${'"x".repeat(200)'});\n`.repeat(40)),
  'empty/': new Uint8Array(0),
});

describe('scanZipTail', () => {
  it('finds the end-of-central-directory record in a real zip', () => {
    const scan = scanZipTail(SMALL_ZIP);
    expect(scan.entryCount).toBe(3);
    expect(scan.zip64RecordOffset).toBeNull();
    expect(scan.needsZip64).toBe(false);
    // The directory it points at really is the directory: the first record starts with its signature.
    const directory = centralDirectoryOf(SMALL_ZIP);
    expect(new DataView(directory.buffer, directory.byteOffset).getUint32(0, true)).toBe(
      0x02014b50,
    );
  });

  it('finds it behind a trailing archive comment, where it is not the last bytes of the file', () => {
    const commented = withArchiveComment(SMALL_ZIP, 'built by the media console on a Tuesday');
    expect(commented.byteLength).toBeGreaterThan(SMALL_ZIP.byteLength);
    const scan = scanZipTail(commented);
    expect(scan.entryCount).toBe(3);
    expect(scan.centralDirectoryOffset).toBe(scanZipTail(SMALL_ZIP).centralDirectoryOffset);
  });

  it('is not fooled by an end-of-central-directory signature stored inside file data', () => {
    // A stored (uncompressed) entry whose bytes literally contain the EOCD signature — the classic
    // false positive for a parser that scans forwards or takes the first match it sees.
    const decoy = new Uint8Array(64);
    decoy.set([0x50, 0x4b, 0x05, 0x06], 8);
    const zip = zipSync({ 'decoy.bin': [decoy, { level: 0 }] });
    const scan = scanZipTail(zip);
    expect(scan.entryCount).toBe(1);
    const entries = parseZipCentralDirectory(centralDirectoryOf(zip)).entries;
    expect(entries.map((entry) => entry.path)).toEqual(['decoy.bin']);
  });

  it('refuses a file that has no record at all rather than guessing', () => {
    expect(() => scanZipTail(encoder.encode('not an archive, just some prose'))).toThrow(
      /no end-of-central-directory/i,
    );
  });
});

describe('parseZipCentralDirectory', () => {
  it('lists every entry with its sizes, method and modified time', () => {
    const { entries, truncated } = parseZipCentralDirectory(centralDirectoryOf(SMALL_ZIP));
    expect(truncated).toBe(false);
    expect(entries.map((entry) => entry.path)).toEqual(['readme.txt', 'src/app.js', 'empty/']);

    const readme = entries[0];
    if (!readme) throw new Error('missing entry');
    expect(readme.directory).toBe(false);
    expect(readme.uncompressedSize).toBe(17);
    expect(readme.encrypted).toBe(false);
    expect(zipMethodName(readme.method)).toBe('deflate');
    expect(readme.modified).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);

    // The deflated source entry is the one where the compression is visible.
    const source = entries[1];
    if (!source) throw new Error('missing entry');
    expect(source.compressedSize).toBeLessThan(source.uncompressedSize);
    expect(formatRatio(source.uncompressedSize, source.compressedSize)).toMatch(/^\d+%$/);
  });

  it('marks the trailing-slash entry as a directory', () => {
    const entries = parseZipCentralDirectory(centralDirectoryOf(SMALL_ZIP)).entries;
    expect(entries.find((entry) => entry.path === 'empty/')?.directory).toBe(true);
  });

  it('points each entry at a real local file header', () => {
    const entries = parseZipCentralDirectory(centralDirectoryOf(SMALL_ZIP)).entries;
    const view = new DataView(SMALL_ZIP.buffer, SMALL_ZIP.byteOffset, SMALL_ZIP.byteLength);
    for (const entry of entries) {
      expect(view.getUint32(entry.localHeaderOffset, true)).toBe(0x04034b50);
    }
  });

  it('reports a directory cut short by the read budget instead of pretending it ended', () => {
    const directory = centralDirectoryOf(SMALL_ZIP);
    const { entries, truncated } = parseZipCentralDirectory(
      directory.subarray(0, directory.byteLength - 20),
    );
    expect(truncated).toBe(true);
    expect(entries.length).toBeLessThan(3);
    expect(entries.length).toBeGreaterThan(0);
  });

  it('throws when the bytes are not a central directory at all', () => {
    expect(() => parseZipCentralDirectory(encoder.encode('PK, but nothing after it'))).toThrow(
      /corrupt|no readable entries/i,
    );
  });
});

describe('ZIP64', () => {
  /** A real ZIP64 tail: the small zip's own directory, addressed the way a >4 GB archive addresses
   *  it — a ZIP64 end record and locator, and an End of Central Directory whose 32-bit fields are
   *  pegged at 0xFFFFFFFF because the true values no longer fit. */
  function zip64Tail(
    directoryOffset: number,
    directorySize: number,
    entryCount: number,
  ): Uint8Array {
    const bytes = new Uint8Array(56 + 20 + 22);
    const view = new DataView(bytes.buffer);
    view.setUint32(0, 0x06064b50, true);
    view.setBigUint64(4, BigInt(44), true); // size of this record, minus its first 12 bytes
    view.setBigUint64(24, BigInt(entryCount), true); // entries on this disk
    view.setBigUint64(32, BigInt(entryCount), true); // entries in total
    view.setBigUint64(40, BigInt(directorySize), true);
    view.setBigUint64(48, BigInt(directoryOffset), true);
    view.setUint32(56, 0x07064b50, true);
    view.setBigUint64(56 + 8, BigInt(0), true); // the record starts at offset 0 of this tail
    view.setUint32(56 + 16, 1, true);
    view.setUint32(76, 0x06054b50, true);
    view.setUint16(76 + 8, 0xffff, true);
    view.setUint16(76 + 10, 0xffff, true);
    view.setUint32(76 + 12, 0xffffffff, true);
    view.setUint32(76 + 16, 0xffffffff, true);
    return bytes;
  }

  it('follows the locator to the 64-bit counts instead of reading the pegged 32-bit ones', () => {
    const tail = zip64Tail(9_000_000_000, 4_800, 70_000);
    const scan = scanZipTail(tail);
    expect(scan.needsZip64).toBe(true);
    expect(scan.zip64RecordOffset).toBe(0);
    expect(scan.entryCount).toBe(0xffff);

    const record = parseZip64EndRecord(tail.subarray(0, 56));
    expect(record.entryCount).toBe(70_000);
    expect(record.centralDirectorySize).toBe(4_800);
    expect(record.centralDirectoryOffset).toBe(9_000_000_000);
  });

  it('rejects a locator that points at something else rather than reading garbage as offsets', () => {
    expect(() => parseZip64EndRecord(new Uint8Array(56))).toThrow(/not a ZIP64 end record/i);
    expect(() => parseZip64EndRecord(new Uint8Array(12))).toThrow(/truncated/i);
  });

  /** Re-issue the first record of a real central directory the way a ZIP64 writer would: the three
   *  32-bit fields pegged, their true values moved into an extra field with header id 1. Only the
   *  fields that were pegged appear there, in a fixed order, which is exactly the part a parser gets
   *  wrong by reading the extra field positionally. */
  function withZip64Extra(directory: Uint8Array): Uint8Array {
    const source = new DataView(directory.buffer, directory.byteOffset, directory.byteLength);
    const nameLength = source.getUint16(28, true);
    const extraLength = source.getUint16(30, true);
    const commentLength = source.getUint16(32, true);
    const head = 46 + nameLength;
    const oldRecord = head + extraLength + commentLength;

    const zip64Extra = new Uint8Array(4 + 24);
    const extraView = new DataView(zip64Extra.buffer);
    extraView.setUint16(0, 0x0001, true);
    extraView.setUint16(2, 24, true);
    extraView.setBigUint64(4, BigInt(source.getUint32(24, true)), true); // uncompressed
    extraView.setBigUint64(12, BigInt(source.getUint32(20, true)), true); // compressed
    extraView.setBigUint64(20, BigInt(source.getUint32(42, true)), true); // local header offset

    const out = new Uint8Array(directory.byteLength + zip64Extra.byteLength);
    out.set(directory.subarray(0, head), 0);
    out.set(directory.subarray(head, head + extraLength), head);
    out.set(zip64Extra, head + extraLength);
    out.set(
      directory.subarray(head + extraLength, directory.byteLength),
      head + extraLength + zip64Extra.byteLength,
    );

    const view = new DataView(out.buffer);
    view.setUint16(30, extraLength + zip64Extra.byteLength, true);
    view.setUint32(20, 0xffffffff, true);
    view.setUint32(24, 0xffffffff, true);
    view.setUint32(42, 0xffffffff, true);
    // Every later record is unchanged, so the walk must still land on them: proof the extra field's
    // length was accounted for rather than assumed.
    expect(oldRecord).toBeLessThan(directory.byteLength);
    return out;
  }

  it('reads an entry whose sizes and offset live in its ZIP64 extra field', () => {
    const original = parseZipCentralDirectory(centralDirectoryOf(SMALL_ZIP)).entries;
    const { entries, truncated } = parseZipCentralDirectory(
      withZip64Extra(centralDirectoryOf(SMALL_ZIP)),
    );
    expect(truncated).toBe(false);
    expect(entries.map((entry) => entry.path)).toEqual(original.map((entry) => entry.path));
    expect(entries[0]).toEqual(original[0]);
  });
});

describe('parseTarEntries', () => {
  const TAR = buildTar([
    { name: 'project/', typeflag: '5' },
    { name: 'project/README.md', body: '# hello\n' },
    { name: 'project/data.csv', body: 'a,b\n1,2\n'.repeat(400) },
  ]);

  it('walks the 512-byte headers into entries', () => {
    const { entries, truncated } = parseTarEntries(TAR);
    expect(truncated).toBe(false);
    expect(entries.map((entry) => entry.path)).toEqual([
      'project/',
      'project/README.md',
      'project/data.csv',
    ]);
    expect(entries.map((entry) => entry.kind)).toEqual(['dir', 'file', 'file']);
    expect(entries[1]?.size).toBe(8);
    expect(entries[2]?.size).toBe(3200);
    expect(entries[1]?.owner).toBe('root/wheel');
    expect(entries[1]?.mode).toBe('0644');
    expect(entries[1]?.modified).toBe('2023-11-14 22:13:20');
  });

  it('joins the ustar prefix onto names too long for the 100-byte name field', () => {
    const tar = buildTar([{ name: 'deep.txt', prefix: 'a/very/long/path', body: 'x' }]);
    expect(parseTarEntries(tar).entries[0]?.path).toBe('a/very/long/path/deep.txt');
  });

  it('reports a head sample as truncated, since a tar has no index to say what follows', () => {
    // Cut mid-archive, exactly as a ranged head read does.
    const { entries, truncated } = parseTarEntries(TAR.subarray(0, 512 * 3));
    expect(truncated).toBe(true);
    expect(entries.map((entry) => entry.path)).toEqual(['project/', 'project/README.md']);
  });

  it('refuses bytes whose first block has no valid header checksum', () => {
    expect(() => parseTarEntries(new Uint8Array(2048).fill(0x41))).toThrow(/not a TAR/i);
  });

  it('stops at a corrupt header instead of walking off into the payload', () => {
    const corrupt = new Uint8Array(TAR);
    corrupt.fill(0x41, 512, 512 + 16); // scribble over the second entry's header
    const { entries, truncated } = parseTarEntries(corrupt);
    expect(truncated).toBe(true);
    expect(entries.map((entry) => entry.path)).toEqual(['project/']);
  });

  describe('through gunzipSample, which is how a .tar.gz gets listed', () => {
    it('gunzips a whole stream back into the tar it was made from', () => {
      const { entries, truncated } = parseTarEntries(gunzipSample(gzipSync(TAR)));
      expect(truncated).toBe(false);
      expect(entries).toHaveLength(3);
    });

    it('gunzips a head sample of the stream — the case a ranged read always produces', () => {
      // Bodies that do not compress, so the gzip stream is long enough for a prefix of it to be a
      // genuine partial stream. A tar of repeated text gzips to a few dozen bytes, where "half the
      // stream" is half a header and proves nothing.
      const many = buildTar(
        Array.from({ length: 40 }, (_, index) => ({
          name: `logs/${index}.log`,
          body: noise(2048, index + 1),
        })),
      );
      const gzipped = gzipSync(many);
      const head = gzipped.subarray(0, Math.floor(gzipped.byteLength * 0.3));
      const plain = gunzipSample(head);
      expect(plain.byteLength).toBeGreaterThan(0);
      expect(plain.byteLength).toBeLessThan(many.byteLength);

      const { entries, truncated } = parseTarEntries(plain);
      expect(truncated).toBe(true);
      expect(entries.length).toBeGreaterThan(0);
      expect(entries.length).toBeLessThan(40);
      expect(entries[0]?.path).toBe('logs/0.log');
    });

    it('says so plainly when the bytes are not a gzip stream at all', () => {
      expect(() => gunzipSample(encoder.encode('this is not gzip, it is a sentence'))).toThrow();
    });
  });
});

describe('extractZipEntry', () => {
  /** Serve `SMALL_ZIP` through the console client's ranged read, recording what was asked for. This
   *  is the claim under test: one entry comes out of the archive without the archive coming down. */
  function serve(zip: Uint8Array): { item: PreviewItem; requested: () => number } {
    let bytes = 0;
    vi.spyOn(mediaConsoleClient, 'objectRange').mockImplementation(
      async (_disk: string, _key: string, start: number, end: number) => {
        bytes += end - start + 1;
        return zip.slice(start, end + 1);
      },
    );
    return {
      item: {
        disk: 'fixtures',
        name: 'bundle.zip',
        key: 'bundle.zip',
        size: zip.byteLength,
        url: 'about:blank',
      },
      requested: () => bytes,
    };
  }

  afterEach(() => vi.restoreAllMocks());

  it('inflates one entry from its local header, reading only that entry', async () => {
    const { item, requested } = serve(SMALL_ZIP);
    const entries = parseZipCentralDirectory(centralDirectoryOf(SMALL_ZIP)).entries;
    const readme = entries.find((entry) => entry.path === 'readme.txt');
    if (!readme) throw new Error('missing entry');

    const extracted = await extractZipEntry(item, readme);
    expect(extracted.text).toBe('hello from a zip\n');
    expect(extracted.binary).toBe(false);
    // The 30-byte local header plus the entry's compressed bytes — nothing else.
    expect(requested()).toBe(30 + readme.compressedSize);
    expect(requested()).toBeLessThan(SMALL_ZIP.byteLength / 2);
  });

  it('inflates a deflated entry, not just a stored one', async () => {
    const { item } = serve(SMALL_ZIP);
    const entries = parseZipCentralDirectory(centralDirectoryOf(SMALL_ZIP)).entries;
    const source = entries.find((entry) => entry.path === 'src/app.js');
    if (!source) throw new Error('missing entry');
    expect(source.method).toBe(8);
    const extracted = await extractZipEntry(item, source);
    expect(extracted.text).toHaveLength(source.uncompressedSize);
    expect(extracted.text.startsWith('console.log(')).toBe(true);
  });

  it('calls a binary entry binary rather than filling the pane with replacement characters', async () => {
    const zip = zipSync({
      'logo.png': [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3]), { level: 0 }],
    });
    const { item } = serve(zip);
    const entry = parseZipCentralDirectory(centralDirectoryOf(zip)).entries[0];
    if (!entry) throw new Error('missing entry');
    expect((await extractZipEntry(item, entry)).binary).toBe(true);
  });

  it('refuses an entry whose local header offset points at nothing', async () => {
    const { item } = serve(SMALL_ZIP);
    const entry = parseZipCentralDirectory(centralDirectoryOf(SMALL_ZIP)).entries[0];
    if (!entry) throw new Error('missing entry');
    await expect(extractZipEntry(item, { ...entry, localHeaderOffset: 12 })).rejects.toThrow(
      /local file header/i,
    );
  });
});

describe('format detection', () => {
  it('names the container from the file name first', () => {
    expect(archiveFormat('bundle.zip', undefined)).toBe('zip');
    expect(archiveFormat('lib.jar', 'application/octet-stream')).toBe('zip');
    expect(archiveFormat('pkg.whl', undefined)).toBe('zip');
    expect(archiveFormat('logs.tar', undefined)).toBe('tar');
    expect(archiveFormat('logs.tar.gz', undefined)).toBe('tar.gz');
    expect(archiveFormat('logs.tgz', undefined)).toBe('tar.gz');
    expect(archiveFormat('logs.tar.bz2', undefined)).toBe('bzip2');
    expect(archiveFormat('logs.tar.xz', undefined)).toBe('xz');
  });

  it('falls back to the content type, then to nothing', () => {
    expect(archiveFormat('download', 'application/zip')).toBe('zip');
    expect(archiveFormat('download', 'application/gzip; charset=binary')).toBe('tar.gz');
    expect(archiveFormat('download', 'application/octet-stream')).toBe('unknown');
  });

  it('sniffs the magic bytes of the real fixtures when the name says nothing', () => {
    expect(sniffArchiveFormat(SMALL_ZIP)).toBe('zip');
    expect(sniffArchiveFormat(gzipSync(encoder.encode('x')))).toBe('tar.gz');
    expect(sniffArchiveFormat(buildTar([{ name: 'a.txt', body: 'a' }]))).toBe('tar');
    expect(sniffArchiveFormat(encoder.encode('just prose, 512 bytes short'))).toBe('unknown');
  });
});

describe('presentation helpers', () => {
  it('renders the DOS timestamp a zip entry actually carries', () => {
    // 2024-03-07 14:22:52 → date = ((2024-1980) << 9) | (3 << 5) | 7, time = (14 << 11) | (22 << 5) | 26
    expect(formatDosDateTime((44 << 9) | (3 << 5) | 7, (14 << 11) | (22 << 5) | 26)).toBe(
      '2024-03-07 14:22:52',
    );
  });

  it('has no date to show for the zero timestamp writers leave on synthetic entries', () => {
    expect(formatDosDateTime(0, 0)).toBe('—');
  });

  it('offers to extract text-shaped entries only', () => {
    expect(isTextEntryPath('src/app.ts')).toBe(true);
    expect(isTextEntryPath('META-INF/MANIFEST.MF')).toBe(true);
    expect(isTextEntryPath('LICENSE')).toBe(true);
    expect(isTextEntryPath('assets/logo.png')).toBe(false);
    expect(isTextEntryPath('bin/server')).toBe(false);
  });

  it('reports compression as a ratio, and says nothing for empty entries', () => {
    expect(formatRatio(1000, 250)).toBe('75%');
    expect(formatRatio(0, 0)).toBe('—');
  });

  it('names the methods it can decompress and numbers the ones it cannot', () => {
    expect(zipMethodName(0)).toBe('stored');
    expect(zipMethodName(8)).toBe('deflate');
    expect(zipMethodName(200)).toBe('method 200');
  });
});

/** A smoke pass over the component itself. The parsers above are where the format lives, but a
 *  listing nobody can see is not a preview — these two cases are "it mounted and showed the archive"
 *  and "it mounted and said what went wrong", which is the whole contract of the pane. */
describe('ArchivePreview', () => {
  // jsdom ships no ResizeObserver, and the shared DataTable uses one to size its scroll window. This
  // stubs the browser API the environment is missing — nothing about the component under test.
  class StubResizeObserver implements ResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  globalThis.ResizeObserver = StubResizeObserver;

  function mount(zip: Uint8Array, name: string): void {
    vi.spyOn(mediaConsoleClient, 'objectRange').mockImplementation(
      async (_disk: string, _key: string, start: number, end: number) => zip.slice(start, end + 1),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const item: PreviewItem = {
      disk: 'fixtures',
      name,
      key: name,
      size: zip.byteLength,
      url: 'about:blank',
    };
    render(createElement(QueryClientProvider, { client }, createElement(ArchivePreview, { item })));
  }

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('lists the entries of a real zip in the table', async () => {
    mount(SMALL_ZIP, 'bundle.zip');
    // Twice over: once as a row in the listing, once as a button in the readable-entries sidebar.
    expect(await screen.findAllByText('readme.txt')).toHaveLength(2);
    expect(screen.getByText('src/app.js')).toBeDefined();
    // The directory entry is distinguishable from the files.
    expect(screen.getAllByText('dir')).toHaveLength(1);
    expect(screen.getByPlaceholderText('find an entry…')).toBeDefined();
  });

  it('reads a single entry out of the archive when it is clicked', async () => {
    mount(SMALL_ZIP, 'bundle.zip');
    fireEvent.click(await screen.findByTitle(/^readme\.txt /));
    expect(await screen.findByText('hello from a zip')).toBeDefined();
  });

  it('says what went wrong instead of crashing on bytes that are not an archive', async () => {
    mount(encoder.encode('this is a text file that someone named .zip'), 'broken.zip');
    expect(await screen.findByText(/no end-of-central-directory/i)).toBeDefined();
  });
});
