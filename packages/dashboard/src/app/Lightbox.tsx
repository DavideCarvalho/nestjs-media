import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { mediaConsoleClient } from '../client/media-console-client.js';
import type { ObjectDetailResponse } from '../client/types.js';
import { Notice, formatBytes } from './ui.js';

/** An object opened in the preview lightbox: the detail (signed `url`, size, type) plus the disk and
 *  display name from the row it was opened from. `disk` lets the text/PDF previews stream inline
 *  through the same-origin proxy. */
export interface PreviewItem extends ObjectDetailResponse {
  disk: string;
  name: string;
}

type PreviewKind = 'image' | 'pdf' | 'video' | 'audio' | 'text' | 'sheet' | 'other';

const EXTENSION_KIND: ReadonlyArray<[RegExp, PreviewKind]> = [
  [/\.(png|jpe?g|gif|webp|avif|svg|bmp|ico)$/i, 'image'],
  [/\.pdf$/i, 'pdf'],
  [/\.(mp4|webm|mov|m4v|ogv)$/i, 'video'],
  [/\.(mp3|wav|ogg|oga|flac|m4a|aac)$/i, 'audio'],
  [/\.(xlsx|xls|xlsm|ods)$/i, 'sheet'],
  [/\.(txt|json|csv|tsv|md|log|xml|ya?ml)$/i, 'text'],
];

/** Excel/OpenDocument spreadsheet content types (xlsx, xls, xlsm, ods) — parsed with SheetJS. */
function isSpreadsheetType(type: string): boolean {
  return (
    type.includes('spreadsheetml') ||
    type === 'application/vnd.ms-excel' ||
    type === 'application/vnd.oasis.opendocument.spreadsheet'
  );
}

/** Pick a renderer from the object's content type, falling back to its filename extension when the
 *  disk didn't report one (S3 objects without an explicit Content-Type). */
function previewKind(item: PreviewItem): PreviewKind {
  const type = item.contentType?.toLowerCase() ?? '';
  if (type.startsWith('image/')) return 'image';
  if (type === 'application/pdf') return 'pdf';
  if (type.startsWith('video/')) return 'video';
  if (type.startsWith('audio/')) return 'audio';
  if (isSpreadsheetType(type)) return 'sheet';
  if (type.startsWith('text/') || type === 'application/json') return 'text';
  for (const [pattern, kind] of EXTENSION_KIND) {
    if (pattern.test(item.name)) return kind;
  }
  return 'other';
}

/** Whether to render fetched text as a CSV/TSV table, pretty-printed JSON, or raw. */
function textFlavor(item: PreviewItem): 'csv' | 'tsv' | 'json' | 'plain' {
  const type = item.contentType?.toLowerCase() ?? '';
  if (type.includes('csv') || /\.csv$/i.test(item.name)) return 'csv';
  if (type.includes('tab-separated') || /\.tsv$/i.test(item.name)) return 'tsv';
  if (type.includes('json') || /\.json$/i.test(item.name)) return 'json';
  return 'plain';
}

/** Cap on rendered CSV rows — a preview, not a data grid; the "Open ↗" link has the full file. */
const MAX_TABLE_ROWS = 500;

/** Above this size we don't fetch the object for an inline text/CSV preview — a multi-MB CSV would
 *  pull the whole file into the tab and freeze parsing. The "Open ↗" link still serves the original. */
const MAX_TEXT_PREVIEW_BYTES = 2 * 1024 * 1024;

/** The shared fallback surface: a glyph, a message, and a link to the original in a new tab. Used
 *  whenever inline rendering isn't available (unknown type, too large, or a read error). */
function FallbackCard({ item, message }: { item: PreviewItem; message: string }): JSX.Element {
  return (
    <div className="grid h-full min-h-[320px] place-items-center gap-4 px-6 text-center">
      <div className="flex flex-col items-center gap-4">
        <div className="grid h-14 w-14 place-items-center rounded-lg border border-[var(--line)] bg-zinc-900 text-2xl text-zinc-600">
          ⬡
        </div>
        <div className="mono max-w-md text-sm text-zinc-400">{message}</div>
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          className="mono rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-300 transition-colors hover:bg-emerald-500/20"
        >
          Open original ↗
        </a>
      </div>
    </div>
  );
}

/** Split delimited text into rows of fields, honoring double-quoted fields (with "" escapes) that may
 *  contain the delimiter or newlines. Good enough for previewing well-formed CSV/TSV. */
function parseDelimited(text: string, delimiter: string): string[][] {
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

/** A scrollable, filterable grid shared by the CSV/TSV and XLSX previews: a substring filter across
 *  all cells (case-insensitive), the first row as a sticky-styled header, and a cap on rendered rows
 *  (applied after filtering) — a preview, not a data grid. */
function DataTable({ header, body }: { header: string[]; body: string[][] }): JSX.Element {
  const [filter, setFilter] = useState('');
  const needle = filter.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      needle
        ? body.filter((cells) => cells.some((cell) => cell.toLowerCase().includes(needle)))
        : body,
    [body, needle],
  );
  const shown = filtered.slice(0, MAX_TABLE_ROWS);
  return (
    <div className="flex max-h-[78vh] min-h-0 flex-col gap-2">
      <div className="flex items-center gap-2">
        <div className="flex flex-1 items-center gap-1.5 rounded-md border border-[var(--line)] px-2">
          <span className="text-zinc-600">⌕</span>
          <input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="filter rows…"
            className="mono w-full bg-transparent py-1.5 text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none"
          />
        </div>
        <span className="mono tnum shrink-0 text-[10px] text-zinc-600">
          {filtered.length}
          {needle ? ` / ${body.length}` : ''} {body.length === 1 ? 'row' : 'rows'}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto rounded-md border border-[var(--line)]">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 bg-[var(--panel)]">
            <tr className="mono border-b border-[var(--line)] uppercase tracking-wider text-zinc-600">
              {header.map((cell, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: table header cells have no stable id
                <th key={index} className="whitespace-nowrap px-3 py-1.5 font-normal">
                  {cell}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--line-soft)]">
            {shown.map((cells, rowIndex) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: table rows have no stable id
              <tr key={rowIndex} className="hover:bg-zinc-900/40">
                {header.map((_, cellIndex) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: table cells have no stable id
                  <td key={cellIndex} className="mono whitespace-nowrap px-3 py-1 text-zinc-300">
                    {cells[cellIndex] ?? ''}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {filtered.length > shown.length && (
        <p className="mono shrink-0 text-[10px] text-zinc-600">
          Showing first {shown.length} of {filtered.length} rows — open the original for the full
          file.
        </p>
      )}
    </div>
  );
}

function DelimitedTable({ text, delimiter }: { text: string; delimiter: string }): JSX.Element {
  const rows = parseDelimited(text.trimEnd(), delimiter);
  const header = rows[0];
  if (!header) return <Notice>Empty file.</Notice>;
  return <DataTable header={header} body={rows.slice(1)} />;
}

/** Above this compressed size we skip fetching a spreadsheet for inline preview — parsing a large
 *  workbook in the tab is slow. The "Open ↗" link still serves the original. */
const MAX_SHEET_PREVIEW_BYTES = 5 * 1024 * 1024;

/** Fetches an XLSX/XLS/ODS workbook's bytes and renders a sheet as a filterable table, with a tab per
 *  sheet when there's more than one. Parsed with SheetJS off the same-origin inline proxy. */
function SheetPreview({ item }: { item: PreviewItem }): JSX.Element {
  const tooLarge = item.size > MAX_SHEET_PREVIEW_BYTES;
  const query = useQuery({
    queryKey: ['object-bytes', item.disk, item.key],
    queryFn: () => mediaConsoleClient.objectBytes(item.disk, item.key),
    retry: false,
    staleTime: 60_000,
    enabled: !tooLarge,
  });
  const [sheetIndex, setSheetIndex] = useState(0);
  const workbook = useMemo(
    () => (query.data ? XLSX.read(query.data, { type: 'array' }) : undefined),
    [query.data],
  );
  const grid = useMemo(() => {
    if (!workbook) return undefined;
    const name = workbook.SheetNames[Math.min(sheetIndex, workbook.SheetNames.length - 1)];
    const sheet = name ? workbook.Sheets[name] : undefined;
    if (!sheet) return { header: [], body: [] };
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      blankrows: false,
      defval: '',
    });
    const rows = matrix.map((row) => row.map((cell) => (cell == null ? '' : String(cell))));
    return { header: rows[0] ?? [], body: rows.slice(1) };
  }, [workbook, sheetIndex]);

  if (tooLarge) {
    return (
      <FallbackCard
        item={item}
        message={`Too large to preview inline (${formatBytes(item.size)}). Open the original to view it.`}
      />
    );
  }
  if (query.isLoading) return <Notice>Loading…</Notice>;
  if (query.isError || !workbook || !grid) {
    return <FallbackCard item={item} message="Could not read this spreadsheet." />;
  }
  return (
    <div className="flex flex-col gap-2">
      {workbook.SheetNames.length > 1 && (
        <div className="flex flex-wrap gap-1">
          {workbook.SheetNames.map((name, index) => (
            <button
              key={name}
              type="button"
              onClick={() => setSheetIndex(index)}
              className={`mono rounded-md border px-2 py-0.5 text-[11px] transition-colors ${
                index === sheetIndex
                  ? 'border-zinc-600 bg-zinc-900 text-zinc-100'
                  : 'border-transparent text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {name}
            </button>
          ))}
        </div>
      )}
      <DataTable header={grid.header} body={grid.body} />
    </div>
  );
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
function TextPreview({ item }: { item: PreviewItem }): JSX.Element {
  const tooLarge = item.size > MAX_TEXT_PREVIEW_BYTES;
  const query = useQuery({
    queryKey: ['object-text', item.disk, item.key],
    queryFn: () => mediaConsoleClient.objectText(item.disk, item.key),
    retry: false,
    staleTime: 60_000,
    enabled: !tooLarge,
  });

  if (tooLarge) {
    return (
      <FallbackCard
        item={item}
        message={`Too large to preview inline (${formatBytes(item.size)}). Open the original to view it.`}
      />
    );
  }
  if (query.isLoading) return <Notice>Loading…</Notice>;
  if (query.isError || query.data === undefined) {
    return <FallbackCard item={item} message="Could not read this file." />;
  }

  const flavor = textFlavor(item);
  if (flavor === 'csv') return <DelimitedTable text={query.data} delimiter="," />;
  if (flavor === 'tsv') return <DelimitedTable text={query.data} delimiter={'\t'} />;
  const body = flavor === 'json' ? prettyJson(query.data) : query.data;
  return (
    <pre className="mono max-h-[74vh] overflow-auto whitespace-pre-wrap break-words rounded-md border border-[var(--line)] bg-black/30 p-3 text-xs text-zinc-300">
      {body}
    </pre>
  );
}

function PreviewBody({ item, kind }: { item: PreviewItem; kind: PreviewKind }): JSX.Element {
  switch (kind) {
    case 'image':
      return (
        <img
          src={item.url}
          alt={item.name}
          className="mx-auto max-h-[78vh] max-w-full rounded-md object-contain"
        />
      );
    case 'video':
      return (
        <div className="grid place-items-center">
          {/* biome-ignore lint/a11y/useMediaCaption: preview of an arbitrary stored object; no track available */}
          <video src={item.url} controls className="mx-auto max-h-[78vh] max-w-full rounded-md" />
        </div>
      );
    case 'audio':
      return (
        <div className="grid place-items-center py-16">
          {/* biome-ignore lint/a11y/useMediaCaption: preview of an arbitrary stored object */}
          <audio src={item.url} controls className="w-full max-w-md" />
        </div>
      );
    case 'pdf':
      // Streamed inline through the same-origin proxy so the browser renders it instead of a signed
      // URL that may carry Content-Disposition: attachment (which would download).
      return (
        <iframe
          src={mediaConsoleClient.objectRawUrl(item.disk, item.key)}
          title={item.name}
          className="h-[78vh] w-full rounded-md border border-[var(--line)] bg-white"
        />
      );
    case 'text':
      return <TextPreview item={item} />;
    case 'sheet':
      return <SheetPreview item={item} />;
    default:
      return (
        <FallbackCard
          item={item}
          message={`No inline preview for ${item.contentType ?? 'this type'}`}
        />
      );
  }
}

/** A modal preview overlay for a disk object: dark backdrop, a bordered panel with the object's name +
 *  metadata, and an inline renderer chosen by content type. Closes on Escape, a direct backdrop click,
 *  or the × button. Matches the durable console's popover surfaces. */
export function Lightbox({
  item,
  onClose,
}: {
  item: PreviewItem | null;
  onClose: () => void;
}): JSX.Element | null {
  useEffect(() => {
    if (!item) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [item, onClose]);

  if (!item) return null;
  const kind = previewKind(item);

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: closes only on a direct backdrop click; Escape is handled globally above
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/80 p-6 backdrop-blur-sm"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="flex max-h-full w-full max-w-5xl flex-col overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--panel)] shadow-2xl"
        aria-label={`Preview of ${item.name}`}
      >
        <div className="flex items-center gap-3 border-b border-[var(--line)] px-4 py-2.5">
          <div className="min-w-0 flex-1">
            <div className="mono truncate text-sm text-zinc-200">{item.name}</div>
            <div className="mono tnum mt-0.5 flex items-center gap-2 text-[10px] text-zinc-600">
              <span>{formatBytes(item.size)}</span>
              {item.contentType && (
                <span className="rounded border border-[var(--line)] px-1 text-zinc-500">
                  {item.contentType}
                </span>
              )}
            </div>
          </div>
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            className="mono shrink-0 rounded-md border border-[var(--line)] px-2 py-1 text-[11px] text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
          >
            Open ↗
          </a>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close preview"
            className="mono shrink-0 rounded-md border border-[var(--line)] px-2 py-1 text-[11px] text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
          >
            ✕
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-4">
          <PreviewBody item={item} kind={kind} />
        </div>
      </div>
    </div>
  );
}
