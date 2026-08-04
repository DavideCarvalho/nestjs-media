import { useQuery } from '@tanstack/react-query';
import {
  type AsyncBuffer,
  type FileMetaData,
  type SchemaElement,
  type SchemaTree,
  cachedAsyncBuffer,
  parquetMetadataAsync,
  parquetReadObjects,
  parquetSchema,
} from 'hyparquet';
// Importing this evaluates a snappy WASM module at module scope, which is why this renderer is
// behind the registry's `lazy()` boundary: nobody who never opens a Parquet file pays for it.
import { compressors } from 'hyparquet-compressors';
import { mediaConsoleClient } from '../../client/media-console-client.js';
import { DataTable } from '../DataTable.js';
import { Alert, Notice, formatBytes } from '../ui.js';
import { FallbackCard, readErrorMessage } from './shared.js';
import type { PreviewItem } from './types.js';

/** Rows materialized into the grid. Matched to the SQLite preview's limit so the two tabular
 *  renderers truncate at the same place, and low enough that a billion-row file costs a couple of
 *  column-chunk reads rather than a download. */
const PARQUET_ROW_LIMIT = 500;

/** Codecs whose pages we can actually inflate: the two hyparquet decodes on its own, plus everything
 *  `hyparquet-compressors` brings (gzip, brotli, zstd, lz4, its faster snappy). Notably absent is
 *  LZO, which no JS decoder implements — a file written with it is checked for *before* the read so
 *  the message can name the codec, instead of the reader dying on the first page it cannot inflate. */
const DECODABLE_CODECS: ReadonlySet<string> = new Set([
  'UNCOMPRESSED',
  'SNAPPY',
  ...Object.keys(compressors),
]);

/** How the caller reads bytes: `end` is INCLUSIVE, matching `mediaConsoleClient.objectRange` and the
 *  HTTP `Range` header it writes. Injected rather than hardcoded so the wiring is testable without a
 *  network. */
export type RangeFetch = (start: number, endInclusive: number) => Promise<Uint8Array>;

/** One row of the schema table: the dotted path to a field, its type, and whether it may be null. */
export interface ParquetSchemaRow {
  path: string;
  type: string;
  nullability: string;
}

export interface ParquetPreviewData {
  metadata: FileMetaData;
  schema: ParquetSchemaRow[];
  /** Top-level column names, in file order — the header of the row grid. */
  columns: string[];
  rows: string[][];
  codecs: string[];
  /** Codecs present in the file that nothing here can inflate; non-empty means no rows were read. */
  unsupportedCodecs: string[];
  bytesFetched: number;
}

/**
 * An `AsyncBuffer` over an object we never download, plus a running total of what crossed the wire.
 *
 * The whole renderer stands on this: Parquet keeps its schema and row-group index in a footer and
 * its data in seekable column chunks, so hyparquet asks for a few ranges — the tail, then the chunks
 * the requested rows live in — and a 2 GB file previews for a few hundred KB.
 */
export function createRangeAsyncBuffer(
  byteLength: number,
  fetchRange: RangeFetch,
): { file: AsyncBuffer; bytesFetched: () => number } {
  let fetched = 0;
  return {
    bytesFetched: () => fetched,
    file: {
      byteLength,
      async slice(start: number, end?: number): Promise<ArrayBuffer> {
        // THE BOUNDARY. hyparquet's `end` is EXCLUSIVE and may be omitted entirely, meaning "to
        // EOF"; `objectRange`'s `end` is INCLUSIVE because it goes straight into `Range:
        // bytes=start-end`. So the last byte wanted is `end - 1`, and an absent `end` is the last
        // byte of the object. Get this wrong by one and nothing here fails — the read succeeds and
        // hands the parser a page one byte short or one byte long, which surfaces much later as a
        // thrift or decompression error naming a byte offset nowhere near this function.
        const lastByte = (end ?? byteLength) - 1;
        // An empty range is a legal ask (`slice(n, n)`); asking the disk for `bytes=n-(n-1)` is not.
        if (lastByte < start) return new ArrayBuffer(0);
        const bytes = await fetchRange(start, lastByte);
        fetched += bytes.byteLength;
        // Copy rather than hand back `bytes.buffer`: the response view may sit inside a larger
        // allocation, and the parser reads the ArrayBuffer it is given from offset 0.
        const buffer = new ArrayBuffer(bytes.byteLength);
        new Uint8Array(buffer).set(bytes);
        return buffer;
      },
    },
  };
}

/** `value instanceof Uint8Array` is realm-bound, and it is exactly the values that reach here which
 *  tend to cross a realm — bytes minted inside a worker, an iframe, or a `TextEncoder` borrowed from
 *  another context are genuine Uint8Arrays that the operator still answers `false` for, and the cell
 *  would then render as `{"0":104,"1":105}`. The brand string is what actually holds. */
function isBytes(value: unknown): value is Uint8Array {
  return Object.prototype.toString.call(value) === '[object Uint8Array]';
}

/** Bytes that decode as text are shown as text; anything else is shown as bytes. A BYTE_ARRAY column
 *  usually arrives already decoded (hyparquet's `utf8` default), so what reaches here is the genuinely
 *  binary leftovers — FIXED_LEN_BYTE_ARRAY, unannotated blobs — where a row of replacement glyphs
 *  would tell the reader nothing about what is actually stored. */
function bytesToText(bytes: Uint8Array): string {
  const text = new TextDecoder().decode(bytes);
  if (readsAsText(text)) return text;
  const head = Array.from(bytes.slice(0, 16), (byte) => byte.toString(16).padStart(2, '0')).join(
    '',
  );
  return `0x${head}${bytes.length > 16 ? '…' : ''}`;
}

/** Two tells that a decode produced noise rather than text: a C0 control character that is not
 *  whitespace, or U+FFFD, which is precisely what an invalid UTF-8 byte sequence leaves behind. */
function readsAsText(text: string): boolean {
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    if (code === 0xfffd) return false;
    if (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) return false;
  }
  return true;
}

/** hyparquet's default parsers hand back a `Date` for DATE, TIMESTAMP_* and the deprecated INT96 —
 *  after strings, the commonest thing in a Parquet file. A NANOS timestamp past Date's ±8.64e15 ms
 *  range arrives as an Invalid Date, and `toISOString()` THROWS on those, so one absurd row would
 *  otherwise take down the whole preview. */
function formatTimestamp(value: Date): string {
  return Number.isNaN(value.getTime()) ? 'Invalid Date' : value.toISOString();
}

/** Recursively replaces the values `JSON.stringify` cannot represent (BigInt throws outright, Dates
 *  and byte arrays stringify into noise) so a list/map/struct column can be shown as compact JSON. */
function jsonSafe(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return formatTimestamp(value);
  if (isBytes(value)) return bytesToText(value);
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value !== null && typeof value === 'object') {
    const plain: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) plain[key] = jsonSafe(nested);
    return plain;
  }
  return value;
}

/**
 * One decoded Parquet value as a display string. Parquet's value space is much wider than a table
 * cell's, and two of the conversions are not cosmetic: a `BigInt` reaching React throws outright
 * ("Cannot convert a BigInt value to a number"), and INT64 columns — ids, counts, epoch micros — are
 * exactly where BigInts come from.
 */
export function formatCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) return formatTimestamp(value);
  if (isBytes(value)) return bytesToText(value);
  return JSON.stringify(jsonSafe(value)) ?? '';
}

/** The logical annotation on a field, if it has one — the part that says an INT64 is really a
 *  microsecond timestamp, or a BYTE_ARRAY really a string. Reads the modern `logical_type` first and
 *  falls back to the older `converted_type` that pre-2.4 writers emit. */
function describeAnnotation(element: SchemaElement): string | undefined {
  const logical = element.logical_type;
  if (logical) {
    if (logical.type === 'DECIMAL') return `DECIMAL(${logical.precision},${logical.scale})`;
    if (logical.type === 'TIMESTAMP' || logical.type === 'TIME') {
      return `${logical.type}(${logical.unit}${logical.isAdjustedToUTC ? ', UTC' : ''})`;
    }
    if (logical.type === 'INTEGER') {
      return `INT${logical.bitWidth}${logical.isSigned ? '' : ' unsigned'}`;
    }
    return logical.type;
  }
  if (element.converted_type === 'DECIMAL') {
    return `DECIMAL(${element.precision ?? 0},${element.scale ?? 0})`;
  }
  return element.converted_type;
}

/** Physical type plus logical annotation. An element with no physical type is a group node — the
 *  struct/list/map wrapper the flat schema list encodes as a parent with children. */
export function describeType(element: SchemaElement): string {
  const annotation = describeAnnotation(element);
  const physical = element.type ?? 'group';
  return annotation ? `${physical} · ${annotation}` : physical;
}

/** Flattens the schema tree into table rows. The root element is skipped — it is the file, not a
 *  column — and nested fields keep their full dotted path so `address.city` is not just `city`. */
export function describeSchema(metadata: FileMetaData): ParquetSchemaRow[] {
  const rows: ParquetSchemaRow[] = [];
  function walk(node: SchemaTree): void {
    if (node.path.length > 0) {
      const repetition = node.element.repetition_type;
      rows.push({
        path: node.path.join('.'),
        type: describeType(node.element),
        nullability:
          repetition === 'REQUIRED'
            ? 'required'
            : repetition === 'REPEATED'
              ? 'repeated'
              : 'optional',
      });
    }
    for (const child of node.children) walk(child);
  }
  walk(parquetSchema(metadata));
  return rows;
}

/** Every compression codec any column chunk in the file was written with, deduplicated. Files are
 *  routinely mixed — a writer may leave a tiny dictionary column uncompressed and zstd the rest. */
export function codecsInUse(metadata: FileMetaData): string[] {
  const seen = new Set<string>();
  for (const group of metadata.row_groups) {
    for (const chunk of group.columns) {
      const codec = chunk.meta_data?.codec;
      if (codec) seen.add(codec);
    }
  }
  return [...seen].sort();
}

/**
 * Reads a Parquet file's footer and the first `rowLimit` rows out of it, over byte ranges only.
 *
 * Separated from the component and given its byte source by injection, because the interesting part
 * — how much was fetched to answer this — is a property of the read, not of a React tree.
 */
export async function readParquetPreview({
  byteLength,
  fetchRange,
  rowLimit = PARQUET_ROW_LIMIT,
}: {
  byteLength: number;
  fetchRange: RangeFetch;
  rowLimit?: number;
}): Promise<ParquetPreviewData> {
  const counted = createRangeAsyncBuffer(byteLength, fetchRange);
  // The cache sits OUTSIDE the counter, so a range hyparquet asks for twice is charged to the wire
  // once. It matters for small files, where the 512 KB footer window already covers the row groups
  // the grid then reads — without this the footer would claim to have read more than the file holds.
  const file = cachedAsyncBuffer(counted.file);
  const metadata = await parquetMetadataAsync(file);
  const columns = parquetSchema(metadata).children.map((child) => child.element.name);
  const codecs = codecsInUse(metadata);
  const unsupportedCodecs = codecs.filter((codec) => !DECODABLE_CODECS.has(codec));

  const rowEnd = Math.min(rowLimit, Number(metadata.num_rows));
  let rows: string[][] = [];
  if (unsupportedCodecs.length === 0 && rowEnd > 0) {
    // `rowEnd` is exclusive and is what keeps this cheap: hyparquet plans the read from the row-group
    // index and fetches only the chunks rows [0, rowEnd) live in, not the file.
    const objects = await parquetReadObjects({ file, metadata, compressors, rowStart: 0, rowEnd });
    rows = objects.map((row) => columns.map((column) => formatCell(row[column])));
  }

  return {
    metadata,
    schema: describeSchema(metadata),
    columns,
    rows,
    codecs,
    unsupportedCodecs,
    bytesFetched: counted.bytesFetched(),
  };
}

function Stat({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="flex min-w-0 flex-col">
      <span className="text-[9px] uppercase tracking-wide text-zinc-600">{label}</span>
      <span className="mono tnum truncate text-[11px] text-zinc-300" title={value}>
        {value}
      </span>
    </div>
  );
}

/**
 * Previews a Parquet file *where it lies*. Parquet is built for this — a footer carrying the schema
 * and a row-group index, then column chunks addressable by byte offset — so the file is never
 * downloaded: the tail comes back in one range request, and the first few hundred rows cost the
 * column chunks they happen to live in. A multi-GB table previews for a few hundred KB, and the
 * footer line says so, because that claim is the entire reason this renderer exists rather than a
 * "too large to preview" card.
 */
export function ParquetPreview({ item }: { item: PreviewItem }): JSX.Element {
  const query = useQuery({
    queryKey: ['parquet-preview', item.disk, item.key, item.size],
    queryFn: () =>
      readParquetPreview({
        byteLength: item.size,
        fetchRange: (start, endInclusive) =>
          mediaConsoleClient.objectRange(item.disk, item.key, start, endInclusive),
      }),
    retry: false,
    staleTime: 60_000,
  });

  if (query.isLoading) return <Notice>Reading Parquet footer…</Notice>;
  if (query.isError || !query.data) {
    return (
      <FallbackCard
        item={item}
        message={readErrorMessage(query.error, 'Could not read this Parquet file.')}
      />
    );
  }

  const { metadata, schema, columns, rows, codecs, unsupportedCodecs, bytesFetched } = query.data;
  const totalRows = metadata.num_rows;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="grid shrink-0 grid-cols-3 gap-x-4 gap-y-1.5 rounded-md border border-border bg-black/20 px-3 py-2 sm:grid-cols-5">
        <Stat label="Rows" value={totalRows.toLocaleString()} />
        <Stat label="Row groups" value={String(metadata.row_groups.length)} />
        <Stat label="File size" value={formatBytes(item.size)} />
        <Stat label="Writer" value={metadata.created_by ?? 'not recorded'} />
        <Stat label="Compression" value={codecs.join(', ') || 'none'} />
      </div>

      <div className="flex shrink-0 flex-col gap-1">
        <div className="text-[10px] uppercase tracking-wide text-zinc-500">Schema</div>
        <div className="max-h-36 overflow-auto rounded-md border border-border">
          <table className="w-full text-left text-[11px]">
            <thead className="sticky top-0 z-10 bg-panel">
              <tr className="border-b border-border">
                <th className="mono px-3 py-1 uppercase tracking-wider text-zinc-500">Column</th>
                <th className="mono px-3 py-1 uppercase tracking-wider text-zinc-500">Type</th>
                <th className="mono px-3 py-1 uppercase tracking-wider text-zinc-500">Null</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-soft">
              {schema.map((column) => (
                <tr key={column.path}>
                  <td className="mono whitespace-nowrap px-3 py-0.5 text-zinc-300">
                    {column.path}
                  </td>
                  <td className="mono whitespace-nowrap px-3 py-0.5 text-zinc-500">
                    {column.type}
                  </td>
                  <td className="mono whitespace-nowrap px-3 py-0.5 text-zinc-500">
                    {column.nullability}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {unsupportedCodecs.length > 0 ? (
        <Alert variant="error">
          No decoder for the {unsupportedCodecs.join(', ')} compression{' '}
          {unsupportedCodecs.length === 1 ? 'codec' : 'codecs'} this file uses, so its rows can't be
          read here — the schema above came from the footer, which is uncompressed. Open the
          original ↗ to read it with a tool that has one.
        </Alert>
      ) : (
        <DataTable header={columns} body={rows} />
      )}

      <div className="mono tnum shrink-0 text-[10px] text-zinc-600">
        {rows.length} of {totalRows.toLocaleString()} row{totalRows === 1n ? '' : 's'}
        {BigInt(rows.length) < totalRows && ` (first ${PARQUET_ROW_LIMIT})`} · read{' '}
        {formatBytes(bytesFetched)} of {formatBytes(item.size)}
      </div>
    </div>
  );
}
