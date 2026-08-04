import { useQuery } from '@tanstack/react-query';
import { mediaConsoleClient } from '../../client/media-console-client.js';
import { DataTable } from '../DataTable.js';
import { Alert, Notice, formatBytes } from '../ui.js';
import { textFlavor } from './kinds.js';
import { FallbackCard, SAMPLE_TEXT_BYTES } from './shared.js';
import type { PreviewItem } from './types.js';

/** Split delimited text into rows of fields, honoring double-quoted fields (with "" escapes) that may
 *  contain the delimiter or newlines. Good enough for previewing well-formed CSV/TSV. */
export function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === delimiter) {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function DelimitedTable({ text, delimiter }: { text: string; delimiter: string }): JSX.Element {
  const rows = parseDelimited(text.trimEnd(), delimiter);
  const header = rows[0];
  if (!header) return <Notice>Empty file.</Notice>;
  return <DataTable header={header} body={rows.slice(1)} />;
}

function prettyJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

/** Fetches the object's bytes as text through the same-origin inline proxy and renders it: a CSV/TSV
 *  table, pretty-printed JSON, or raw monospace text. */
export function TextPreview({ item }: { item: PreviewItem }): JSX.Element {
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
  // A truncated sample ends mid-line — drop the partial last line so the final row/character isn't
  // garbled (an incomplete CSV row, a broken JSON tail).
  const source = truncated ? text.slice(0, Math.max(0, text.lastIndexOf('\n'))) : text;
  const flavor = textFlavor(item);
  const content =
    flavor === 'csv' ? (
      <DelimitedTable text={source} delimiter="," />
    ) : flavor === 'tsv' ? (
      <DelimitedTable text={source} delimiter={'\t'} />
    ) : (
      <pre className="mono min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-black/30 p-3 text-xs text-zinc-300">
        {flavor === 'json' ? prettyJson(source) : source}
      </pre>
    );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      {truncated && (
        <Alert variant="warn" className="shrink-0">
          Sample — the first {formatBytes(bytesRead)} of {formatBytes(item.size)}. Filters and sort
          apply to this sample; open the original ↗ for the whole file.
        </Alert>
      )}
      {content}
    </div>
  );
}
