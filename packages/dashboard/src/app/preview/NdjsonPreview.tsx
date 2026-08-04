import { useQuery } from '@tanstack/react-query';
import { mediaConsoleClient } from '../../client/media-console-client.js';
import { DataTable } from '../DataTable.js';
import { Alert, Notice, formatBytes } from '../ui.js';
import { FallbackCard, SAMPLE_TEXT_BYTES } from './shared.js';
import type { PreviewItem } from './types.js';

/** Where a line that parsed but isn't an object goes. A `.jsonl` of bare ids, strings or arrays is
 *  still a column of data, and one honest column beats falling back to a wall of raw text. Rows that
 *  genuinely carry a `value` key share the column — a collision costs nothing here, and a synthetic
 *  name like `__value__` would only look like a bug to whoever is reading the export. */
const VALUE_COLUMN = 'value';

export interface NdjsonTable {
  /** Column names in the order the file introduced them (see `parseNdjson`). */
  header: string[];
  body: string[][];
  /** Lines that weren't JSON at all. Counted instead of thrown: the tail of a live log is routinely a
   *  half-written record, and one bad line must not cost the reader the other 40,000. */
  unparseable: number;
}

/** True for a JSON object — the shape that contributes named columns. Arrays are objects to `typeof`
 *  and `null` is too, so both are excluded explicitly. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** One cell's text. Strings render as themselves rather than as JSON, because quoting every message
 *  field would make a log unreadable for the sake of a distinction nobody is making at a glance;
 *  nested objects and arrays keep their JSON so the structure is still legible in a single line; and
 *  `null` renders empty so it reads like the absent field it usually is. */
function formatCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

/**
 * Turn newline-delimited JSON into a table.
 *
 * Columns are the union of the keys across every parsed row, **in first-seen order**. Real NDJSON is
 * ragged — an optional field appears on line 900, an error record carries three keys nothing else
 * does — so the union is the only header that doesn't drop data. Sorting it alphabetically would
 * scramble the field order the producer deliberately wrote (`ts`, `level`, `msg` becoming `level`,
 * `msg`, `ts`), which is exactly the order a human scans a log in. A row missing a key gets an empty
 * cell, indistinguishable from a null — a preview is not the place to litigate that difference.
 */
export function parseNdjson(text: string): NdjsonTable {
  const header: string[] = [];
  const seen = new Set<string>();
  const rows: Record<string, unknown>[] = [];
  let unparseable = 0;

  for (const rawLine of text.split('\n')) {
    // `\r` survives a CRLF file and would make every last field parse-fail; blank lines are padding
    // between records, not malformed ones, so they're skipped without being counted against the file.
    const line = rawLine.trim();
    if (line === '') continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      unparseable++;
      continue;
    }
    const row = isRecord(parsed) ? parsed : { [VALUE_COLUMN]: parsed };
    for (const key of Object.keys(row)) {
      if (seen.has(key)) continue;
      seen.add(key);
      header.push(key);
    }
    rows.push(row);
  }

  return {
    header,
    body: rows.map((row) => header.map((key) => formatCell(row[key]))),
    unparseable,
  };
}

/**
 * Renders `.ndjson` / `.jsonl` as the table it is rather than as the text it is stored as: one row
 * per line, sharing the sortable/filterable grid the CSV and spreadsheet previews use.
 *
 * Sampling matches `TextPreview` exactly — the head of the object and no more, so a multi-GB log
 * previews its start instead of freezing the tab.
 */
export function NdjsonPreview({ item }: { item: PreviewItem }): JSX.Element {
  const query = useQuery({
    queryKey: ['object-text-head', item.disk, item.key],
    queryFn: () => mediaConsoleClient.objectTextHead(item.disk, item.key, SAMPLE_TEXT_BYTES),
    retry: false,
    staleTime: 60_000,
  });

  if (query.isLoading) return <Notice>Loading…</Notice>;
  if (query.isError || !query.data) {
    return <FallbackCard item={item} message="Could not read this file." />;
  }

  const { text, bytesRead } = query.data;
  const truncated = bytesRead < item.size;
  // A truncated sample ends mid-record. Dropping the partial last line keeps that fragment out of the
  // unparseable count, which would otherwise report a parse failure the file doesn't actually have.
  const source = truncated ? text.slice(0, Math.max(0, text.lastIndexOf('\n'))) : text;
  const table = parseNdjson(source);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      {truncated && (
        <Alert variant="warn" className="shrink-0">
          Sample — the first {formatBytes(bytesRead)} of {formatBytes(item.size)}. Filters and sort
          apply to this sample; open the original ↗ for the whole file.
        </Alert>
      )}
      {table.unparseable > 0 && (
        <Alert variant="warn" className="shrink-0">
          {table.unparseable} {table.unparseable === 1 ? 'line' : 'lines'} could not be parsed as
          JSON.
        </Alert>
      )}
      {table.header.length > 0 ? (
        <DataTable header={table.header} body={table.body} />
      ) : (
        <Notice>No JSON records in this sample.</Notice>
      )}
    </div>
  );
}
