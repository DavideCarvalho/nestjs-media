// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  BYTES_PER_ROW,
  PAGE_BYTES,
  clampOffset,
  describeWindow,
  formatHexColumn,
  formatOffset,
  hexRows,
  lastPageStart,
  pageStart,
  parseOffset,
  windowLength,
} from './HexPreview.js';

/** The size of the 302 MB object this viewer was written for; it divides evenly into pages, which is
 *  what makes it a useful check that the last page is a whole one rather than a stub. */
const BIG = 316_669_952;

describe('hexRows', () => {
  it('lays out 16 lowercase bytes per row, tagged with their absolute offset', () => {
    const rows = hexRows(new Uint8Array([0x00, 0x41, 0xff, 0x0a]), 0);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.offset).toBe(0);
    expect(rows[0]?.cells.slice(0, 4)).toEqual(['00', '41', 'ff', '0a']);
    expect(rows[0]?.cells).toHaveLength(BYTES_PER_ROW);
  });

  it('reports offsets within the object, not within the fetched page', () => {
    const rows = hexRows(new Uint8Array(BYTES_PER_ROW * 2), 316_665_856);
    expect(rows.map((row) => row.offset)).toEqual([316_665_856, 316_665_872]);
  });

  it('substitutes a dot for every byte outside printable ASCII', () => {
    // NUL, "A", DEL (0x7f, one past printable), space (0x20, the first printable), 0xff.
    const rows = hexRows(new Uint8Array([0x00, 0x41, 0x7f, 0x20, 0xff]), 0);
    expect(rows[0]?.ascii).toBe('.A. .');
  });

  it('pads a short final row so the ASCII column does not slide left', () => {
    const rows = hexRows(new Uint8Array([0xde, 0xad]), 0);
    expect(rows[0]?.cells).toEqual(['de', 'ad', ...Array(BYTES_PER_ROW - 2).fill('  ')]);
    // Padding is hex-column only: the two real bytes are the whole ASCII text.
    expect(rows[0]?.ascii).toBe('..');
  });

  it('splits a page into whole rows plus a remainder', () => {
    expect(hexRows(new Uint8Array(BYTES_PER_ROW * 3 + 1), 0)).toHaveLength(4);
    expect(hexRows(new Uint8Array(0), 0)).toEqual([]);
  });
});

describe('formatOffset / formatHexColumn', () => {
  it('zero-pads the gutter to eight lowercase hex digits', () => {
    expect(formatOffset(0)).toBe('00000000');
    expect(formatOffset(4096)).toBe('00001000');
    expect(formatOffset(0x4d2)).toBe('000004d2');
  });

  it('keeps every row the same width, with a double gap at the halfway mark', () => {
    const full = formatHexColumn(hexRows(new Uint8Array(BYTES_PER_ROW), 0)[0]?.cells ?? []);
    const short = formatHexColumn(hexRows(new Uint8Array([0xde, 0xad]), 0)[0]?.cells ?? []);
    expect(full).toBe('00 00 00 00 00 00 00 00  00 00 00 00 00 00 00 00');
    expect(short).toHaveLength(full.length);
    expect(short.startsWith('de ad ')).toBe(true);
  });
});

describe('parseOffset', () => {
  it('reads decimal', () => {
    expect(parseOffset('1234')).toBe(1234);
    expect(parseOffset('  42  ')).toBe(42);
    expect(parseOffset('0')).toBe(0);
  });

  it('reads the 0x form the gutter prints, in either case', () => {
    expect(parseOffset('0x4d2')).toBe(1234);
    expect(parseOffset('0X4D2')).toBe(1234);
    expect(parseOffset(' 0x00001000 ')).toBe(4096);
  });

  it('rejects anything ambiguous or unparseable rather than guessing', () => {
    // A bare `4d2` could be either notation; guessing hex would land 1234 bytes from where its
    // author meant, with no sign that anything went wrong.
    expect(parseOffset('4d2')).toBeNull();
    expect(parseOffset('')).toBeNull();
    expect(parseOffset('   ')).toBeNull();
    expect(parseOffset('-5')).toBeNull();
    expect(parseOffset('12.5')).toBeNull();
    expect(parseOffset('0x')).toBeNull();
    expect(parseOffset('1e3')).toBeNull();
  });
});

describe('clampOffset', () => {
  it('holds an offset inside [0, size)', () => {
    expect(clampOffset(50, 100)).toBe(50);
    expect(clampOffset(-1, 100)).toBe(0);
    expect(clampOffset(100, 100)).toBe(99);
    expect(clampOffset(BIG * 10, BIG)).toBe(BIG - 1);
  });

  it('answers 0 for an empty object and for garbage', () => {
    expect(clampOffset(5, 0)).toBe(0);
    expect(clampOffset(Number.NaN, 100)).toBe(0);
    expect(clampOffset(Number.POSITIVE_INFINITY, 100)).toBe(0);
  });
});

describe('pageStart / lastPageStart / windowLength', () => {
  it('aligns down so paging and jumping land on the same window', () => {
    expect(pageStart(0, BIG)).toBe(0);
    expect(pageStart(1234, BIG)).toBe(0);
    expect(pageStart(PAGE_BYTES, BIG)).toBe(PAGE_BYTES);
    expect(pageStart(PAGE_BYTES + 1, BIG)).toBe(PAGE_BYTES);
  });

  it('clamps both ends: a page before the start and past the end are no-ops', () => {
    expect(pageStart(-PAGE_BYTES, BIG)).toBe(0);
    expect(pageStart(BIG + PAGE_BYTES, BIG)).toBe(lastPageStart(BIG));
  });

  it('puts the final byte on the last page', () => {
    expect(lastPageStart(BIG)).toBe(BIG - PAGE_BYTES);
    expect(lastPageStart(10)).toBe(0);
    expect(lastPageStart(0)).toBe(0);
    // A size one byte past a page boundary gets a page of its own, holding that one byte.
    expect(lastPageStart(PAGE_BYTES + 1)).toBe(PAGE_BYTES);
    expect(windowLength(PAGE_BYTES, PAGE_BYTES + 1)).toBe(1);
  });

  it('shortens only the tail window', () => {
    expect(windowLength(0, BIG)).toBe(PAGE_BYTES);
    expect(windowLength(lastPageStart(BIG), BIG)).toBe(PAGE_BYTES);
    expect(windowLength(0, 10)).toBe(10);
    expect(windowLength(0, 0)).toBe(0);
  });
});

describe('describeWindow', () => {
  it('states the window against a grouped total', () => {
    expect(describeWindow(0, PAGE_BYTES, BIG)).toBe('bytes 0–4095 of 316,669,952');
    expect(describeWindow(PAGE_BYTES, PAGE_BYTES, BIG)).toBe('bytes 4096–8191 of 316,669,952');
  });

  it('handles a one-byte tail and an empty object', () => {
    expect(describeWindow(4096, 1, 4097)).toBe('bytes 4096–4096 of 4,097');
    expect(describeWindow(0, 0, 0)).toBe('0 bytes of 0');
  });
});
