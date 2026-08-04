// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  type RangeFetch,
  codecsInUse,
  createRangeAsyncBuffer,
  describeSchema,
  describeType,
  formatCell,
  readParquetPreview,
} from './ParquetPreview.js';

/**
 * A Parquet file is written here rather than checked in, because the thing worth proving is that the
 * `AsyncBuffer` wiring — the exclusive/inclusive boundary above all — hands hyparquet bytes it can
 * actually parse. A fixture binary would prove the same thing, but nobody could read it in review;
 * this one states its own offsets.
 *
 * What follows is a minimal TCompactProtocol writer, which is what Parquet metadata and page headers
 * are serialized with. Field ids are written ascending so every field header fits the 4-bit delta
 * form, and every struct ends with the STOP byte the reader scans for.
 */
function pushVarint(out: number[], value: number): void {
  let remaining = value;
  while (remaining >= 0x80) {
    out.push((remaining & 0x7f) | 0x80);
    remaining >>>= 7;
  }
  out.push(remaining);
}

/** Zigzag folds negatives into the positive varint space; for the non-negative values this fixture
 *  writes it is just `value * 2`, but the shift is written out so the encoder stays honest. */
function pushZigZag(out: number[], value: bigint): void {
  let zigzag = (value << 1n) ^ (value >> 63n);
  while (zigzag >= 0x80n) {
    out.push(Number(zigzag & 0x7fn) | 0x80);
    zigzag >>= 7n;
  }
  out.push(Number(zigzag));
}

const T_I32 = 5;
const T_I64 = 6;
const T_BINARY = 8;
const T_LIST = 9;
const T_STRUCT = 12;

function pushListHeader(out: number[], size: number, elementType: number): void {
  if (size < 15) out.push((size << 4) | elementType);
  else {
    out.push((15 << 4) | elementType);
    pushVarint(out, size);
  }
}

function encode(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

class ThriftStruct {
  private readonly bytes: number[] = [];
  private lastFid = 0;

  private header(fid: number, type: number): void {
    const delta = fid - this.lastFid;
    if (delta > 0 && delta <= 15) this.bytes.push((delta << 4) | type);
    else {
      this.bytes.push(type);
      pushZigZag(this.bytes, BigInt(fid));
    }
    this.lastFid = fid;
  }

  i32(fid: number, value: number): this {
    this.header(fid, T_I32);
    pushZigZag(this.bytes, BigInt(value));
    return this;
  }

  i64(fid: number, value: bigint): this {
    this.header(fid, T_I64);
    pushZigZag(this.bytes, value);
    return this;
  }

  binary(fid: number, value: string): this {
    this.header(fid, T_BINARY);
    const encoded = encode(value);
    pushVarint(this.bytes, encoded.length);
    this.bytes.push(...encoded);
    return this;
  }

  struct(fid: number, inner: ThriftStruct): this {
    this.header(fid, T_STRUCT);
    this.bytes.push(...inner.finish());
    return this;
  }

  listOfStructs(fid: number, items: ThriftStruct[]): this {
    this.header(fid, T_LIST);
    pushListHeader(this.bytes, items.length, T_STRUCT);
    for (const item of items) this.bytes.push(...item.finish());
    return this;
  }

  listOfI32(fid: number, values: number[]): this {
    this.header(fid, T_LIST);
    pushListHeader(this.bytes, values.length, T_I32);
    for (const value of values) pushZigZag(this.bytes, BigInt(value));
    return this;
  }

  listOfBinary(fid: number, values: string[]): this {
    this.header(fid, T_LIST);
    pushListHeader(this.bytes, values.length, T_BINARY);
    for (const value of values) {
      const encoded = encode(value);
      pushVarint(this.bytes, encoded.length);
      this.bytes.push(...encoded);
    }
    return this;
  }

  finish(): number[] {
    return [...this.bytes, 0];
  }
}

/** A v1 data page: the PageHeader struct followed by its (here uncompressed) payload. RLE is named as
 *  the level encoding even though a REQUIRED, non-repeated column writes no levels at all. */
function dataPage(payload: Uint8Array, numValues: number): Uint8Array {
  const pageHeader = new ThriftStruct()
    .i32(1, 0) // DATA_PAGE
    .i32(2, payload.length) // uncompressed_page_size
    .i32(3, payload.length) // compressed_page_size
    .struct(
      5,
      new ThriftStruct()
        .i32(1, numValues)
        .i32(2, 0) // PLAIN
        .i32(3, 3) // definition_level_encoding: RLE
        .i32(4, 3), // repetition_level_encoding: RLE
    );
  const header = pageHeader.finish();
  const page = new Uint8Array(header.length + payload.length);
  page.set(header);
  page.set(payload, header.length);
  return page;
}

function plainInt64Page(values: bigint[]): Uint8Array {
  const payload = new Uint8Array(values.length * 8);
  const view = new DataView(payload.buffer);
  values.forEach((value, index) => view.setBigInt64(index * 8, value, true));
  return dataPage(payload, values.length);
}

function plainByteArrayPage(values: string[]): Uint8Array {
  const encoded = values.map(encode);
  const payload = new Uint8Array(encoded.reduce((sum, item) => sum + 4 + item.length, 0));
  const view = new DataView(payload.buffer);
  let offset = 0;
  for (const item of encoded) {
    view.setUint32(offset, item.length, true);
    offset += 4;
    payload.set(item, offset);
    offset += item.length;
  }
  return dataPage(payload, values.length);
}

/**
 * Two required columns, one row group, three rows: `id` INT64 and `name` BYTE_ARRAY/UTF8.
 * `codec` is the CompressionCodec *enum index* recorded in the column metadata — the payload is
 * always uncompressed, so passing a codec the reader cannot inflate exercises the pre-read check
 * without needing a real LZO encoder.
 */
function buildParquetFixture({ codec = 0 }: { codec?: number } = {}): Uint8Array {
  const idChunk = plainInt64Page([1n, 2n, 3n]);
  const nameChunk = plainByteArrayPage(['alpha', 'beta', 'gamma']);
  const idOffset = 4; // straight after the leading "PAR1"
  const nameOffset = idOffset + idChunk.length;

  const columnMetaData = (type: number, path: string, offset: number, length: number) =>
    new ThriftStruct()
      .i32(1, type)
      .listOfI32(2, [0]) // encodings: PLAIN
      .listOfBinary(3, [path])
      .i32(4, codec)
      .i64(5, 3n) // num_values
      .i64(6, BigInt(length)) // total_uncompressed_size — page header included, as writers do
      .i64(7, BigInt(length)) // total_compressed_size: what the reader slices
      .i64(9, BigInt(offset)); // data_page_offset

  const rowGroup = new ThriftStruct()
    .listOfStructs(1, [
      new ThriftStruct()
        .i64(2, BigInt(idOffset))
        .struct(3, columnMetaData(2, 'id', idOffset, idChunk.length)),
      new ThriftStruct()
        .i64(2, BigInt(nameOffset))
        .struct(3, columnMetaData(6, 'name', nameOffset, nameChunk.length)),
    ])
    .i64(2, BigInt(idChunk.length + nameChunk.length))
    .i64(3, 3n);

  const metadata = new ThriftStruct()
    .i32(1, 2) // version
    .listOfStructs(2, [
      new ThriftStruct()
        .binary(4, 'root')
        .i32(5, 2), // root group, 2 children
      new ThriftStruct()
        .i32(1, 2)
        .i32(3, 0)
        .binary(4, 'id'), // INT64, REQUIRED
      new ThriftStruct()
        .i32(1, 6)
        .i32(3, 0)
        .binary(4, 'name')
        .i32(6, 0), // BYTE_ARRAY, REQUIRED, UTF8
    ])
    .i64(3, 3n) // num_rows
    .listOfStructs(4, [rowGroup])
    .binary(6, 'ParquetPreview spec fixture'); // created_by

  const metadataBytes = Uint8Array.from(metadata.finish());
  const magic = encode('PAR1');
  const metadataOffset = nameOffset + nameChunk.length;
  const file = new Uint8Array(metadataOffset + metadataBytes.length + 8);
  file.set(magic, 0);
  file.set(idChunk, idOffset);
  file.set(nameChunk, nameOffset);
  file.set(metadataBytes, metadataOffset);
  new DataView(file.buffer).setUint32(
    metadataOffset + metadataBytes.length,
    metadataBytes.length,
    true,
  );
  file.set(magic, metadataOffset + metadataBytes.length + 4);
  return file;
}

/** Serves a byte range out of an in-memory object, with `end` inclusive — the same convention
 *  `mediaConsoleClient.objectRange` uses, so an off-by-one in the buffer shows up as bad bytes. */
function serve(file: Uint8Array): { fetchRange: RangeFetch; calls: Array<[number, number]> } {
  const calls: Array<[number, number]> = [];
  return {
    calls,
    fetchRange: async (start, endInclusive) => {
      calls.push([start, endInclusive]);
      return file.slice(start, endInclusive + 1);
    },
  };
}

describe('createRangeAsyncBuffer', () => {
  it("converts hyparquet's exclusive end into an inclusive one", async () => {
    const calls: Array<[number, number]> = [];
    const { file } = createRangeAsyncBuffer(1000, async (start, endInclusive) => {
      calls.push([start, endInclusive]);
      return new Uint8Array(endInclusive - start + 1);
    });

    await file.slice(0, 16);
    await file.slice(64, 128);

    expect(calls).toEqual([
      [0, 15],
      [64, 127],
    ]);
  });

  it('reads to the last byte of the object when the end is omitted', async () => {
    const calls: Array<[number, number]> = [];
    const { file } = createRangeAsyncBuffer(1000, async (start, endInclusive) => {
      calls.push([start, endInclusive]);
      return new Uint8Array(endInclusive - start + 1);
    });

    await file.slice(900);

    expect(calls).toEqual([[900, 999]]);
  });

  it('asks for nothing when the range is empty', async () => {
    const calls: Array<[number, number]> = [];
    const { file } = createRangeAsyncBuffer(1000, async (start, endInclusive) => {
      calls.push([start, endInclusive]);
      return new Uint8Array(endInclusive - start + 1);
    });

    const slice = await file.slice(500, 500);

    expect(slice.byteLength).toBe(0);
    expect(calls).toEqual([]);
  });

  it('returns exactly the fetched bytes, not the buffer they arrived in', async () => {
    const backing = new Uint8Array([9, 9, 1, 2, 3, 9, 9]);
    const { file } = createRangeAsyncBuffer(3, async () => backing.subarray(2, 5));

    const slice = await file.slice(0, 3);

    expect([...new Uint8Array(slice)]).toEqual([1, 2, 3]);
  });

  it('counts every byte that crossed the wire, and only those', async () => {
    const { file, bytesFetched } = createRangeAsyncBuffer(
      1000,
      async (start, endInclusive) => new Uint8Array(endInclusive - start + 1),
    );

    expect(bytesFetched()).toBe(0);
    await file.slice(0, 100);
    expect(bytesFetched()).toBe(100);
    await file.slice(200, 210);
    expect(bytesFetched()).toBe(110);
    await file.slice(5, 5); // no request, no bytes
    expect(bytesFetched()).toBe(110);
  });

  it('counts what actually arrived when a disk answers short', async () => {
    const { file, bytesFetched } = createRangeAsyncBuffer(1000, async () => new Uint8Array(7));

    await file.slice(0, 500);

    expect(bytesFetched()).toBe(7);
  });
});

describe('formatCell', () => {
  it('renders nothing for null and undefined', () => {
    expect(formatCell(null)).toBe('');
    expect(formatCell(undefined)).toBe('');
  });

  it('renders a BigInt without losing digits, and without throwing', () => {
    expect(formatCell(9007199254740993n)).toBe('9007199254740993');
    expect(formatCell(-1n)).toBe('-1');
    expect(formatCell(0n)).toBe('0');
  });

  it('renders a timestamp as ISO 8601', () => {
    expect(formatCell(new Date(Date.UTC(2024, 0, 2, 3, 4, 5, 6)))).toBe('2024-01-02T03:04:05.006Z');
  });

  it('survives a timestamp outside the representable range', () => {
    // toISOString() throws on an Invalid Date; a NANOS column can produce one, and one bad row must
    // not take the grid down.
    expect(formatCell(new Date(Number.NaN))).toBe('Invalid Date');
  });

  it('renders strings, numbers and booleans as themselves', () => {
    expect(formatCell('alpha')).toBe('alpha');
    expect(formatCell(1.5)).toBe('1.5');
    expect(formatCell(false)).toBe('false');
  });

  it('renders byte arrays as text when they are text, and as bytes when they are not', () => {
    expect(formatCell(new TextEncoder().encode('hi'))).toBe('hi');
    expect(formatCell(new Uint8Array([0x00, 0x01, 0xff]))).toBe('0x0001ff');
  });

  it('renders lists, maps and structs as compact JSON', () => {
    expect(formatCell([1, 2, 3])).toBe('[1,2,3]');
    expect(formatCell({ city: 'Rio', zip: null })).toBe('{"city":"Rio","zip":null}');
  });

  it('renders nested BigInts and Dates that JSON.stringify would throw on or mangle', () => {
    expect(formatCell([1n, 2n])).toBe('["1","2"]');
    expect(formatCell({ at: new Date(Date.UTC(2024, 0, 1)), id: 7n })).toBe(
      '{"at":"2024-01-01T00:00:00.000Z","id":"7"}',
    );
  });
});

describe('describeType', () => {
  it('names the physical type on its own when there is no annotation', () => {
    expect(describeType({ name: 'id', type: 'INT64' })).toBe('INT64');
  });

  it('adds the logical annotation that says what the physical type means', () => {
    expect(
      describeType({
        name: 'at',
        type: 'INT64',
        logical_type: { type: 'TIMESTAMP', unit: 'MICROS', isAdjustedToUTC: true },
      }),
    ).toBe('INT64 · TIMESTAMP(MICROS, UTC)');
    expect(
      describeType({
        name: 'price',
        type: 'FIXED_LEN_BYTE_ARRAY',
        logical_type: { type: 'DECIMAL', precision: 10, scale: 2 },
      }),
    ).toBe('FIXED_LEN_BYTE_ARRAY · DECIMAL(10,2)');
  });

  it('falls back to the converted_type older writers emit', () => {
    expect(describeType({ name: 'name', type: 'BYTE_ARRAY', converted_type: 'UTF8' })).toBe(
      'BYTE_ARRAY · UTF8',
    );
  });

  it('calls a typeless element a group', () => {
    expect(describeType({ name: 'address', num_children: 2 })).toBe('group');
  });
});

describe('readParquetPreview', () => {
  it('reads a real Parquet file through byte ranges alone', async () => {
    const file = buildParquetFixture();
    const { fetchRange, calls } = serve(file);

    const preview = await readParquetPreview({ byteLength: file.length, fetchRange });

    expect(preview.columns).toEqual(['id', 'name']);
    expect(preview.rows).toEqual([
      ['1', 'alpha'],
      ['2', 'beta'],
      ['3', 'gamma'],
    ]);
    expect(preview.metadata.num_rows).toBe(3n);
    expect(preview.metadata.row_groups).toHaveLength(1);
    expect(preview.metadata.created_by).toBe('ParquetPreview spec fixture');
    expect(preview.codecs).toEqual(['UNCOMPRESSED']);
    expect(preview.unsupportedCodecs).toEqual([]);
    // Every byte came from a range request, and the accounting matches what the fake served.
    expect(calls.length).toBeGreaterThan(0);
    expect(preview.bytesFetched).toBe(
      calls.reduce((sum, [start, end]) => sum + (end - start + 1), 0),
    );
  });

  it('describes the schema it found in the footer', async () => {
    const file = buildParquetFixture();
    const { fetchRange } = serve(file);

    const preview = await readParquetPreview({ byteLength: file.length, fetchRange });

    expect(preview.schema).toEqual([
      { path: 'id', type: 'INT64', nullability: 'required' },
      { path: 'name', type: 'BYTE_ARRAY · UTF8', nullability: 'required' },
    ]);
  });

  it('stops at the row limit instead of reading the file', async () => {
    const file = buildParquetFixture();
    const { fetchRange } = serve(file);

    const preview = await readParquetPreview({ byteLength: file.length, fetchRange, rowLimit: 2 });

    expect(preview.rows).toEqual([
      ['1', 'alpha'],
      ['2', 'beta'],
    ]);
    // The footer still reports the whole file's row count, which is what makes truncation visible.
    expect(preview.metadata.num_rows).toBe(3n);
  });

  it('names the codec it cannot inflate rather than failing on the first page', async () => {
    const file = buildParquetFixture({ codec: 3 }); // LZO: no JS decoder exists
    const { fetchRange } = serve(file);

    const preview = await readParquetPreview({ byteLength: file.length, fetchRange });

    expect(preview.unsupportedCodecs).toEqual(['LZO']);
    expect(preview.codecs).toEqual(['LZO']);
    // The schema still came through — the footer is never compressed.
    expect(preview.schema.map((column) => column.path)).toEqual(['id', 'name']);
    expect(preview.rows).toEqual([]);
  });
});

describe('codecsInUse', () => {
  it('deduplicates and sorts the codecs across every column chunk', async () => {
    const file = buildParquetFixture();
    const { fetchRange } = serve(file);
    const { metadata } = await readParquetPreview({ byteLength: file.length, fetchRange });

    const group = metadata.row_groups[0];
    if (!group) throw new Error('fixture should have one row group');
    const [first, second] = group.columns;
    if (!first?.meta_data || !second?.meta_data) throw new Error('fixture should have two chunks');
    second.meta_data.codec = 'ZSTD';

    expect(codecsInUse(metadata)).toEqual(['UNCOMPRESSED', 'ZSTD']);
  });
});

describe('describeSchema', () => {
  it('flattens nested fields to dotted paths and skips the root element', () => {
    const rows = describeSchema({
      version: 2,
      num_rows: 0n,
      row_groups: [],
      metadata_length: 0,
      schema: [
        { name: 'root', num_children: 1 },
        { name: 'address', num_children: 2, repetition_type: 'OPTIONAL' },
        { name: 'city', type: 'BYTE_ARRAY', repetition_type: 'OPTIONAL', converted_type: 'UTF8' },
        { name: 'zip', type: 'INT32', repetition_type: 'REQUIRED' },
      ],
    });

    expect(rows).toEqual([
      { path: 'address', type: 'group', nullability: 'optional' },
      { path: 'address.city', type: 'BYTE_ARRAY · UTF8', nullability: 'optional' },
      { path: 'address.zip', type: 'INT32', nullability: 'required' },
    ]);
  });
});
