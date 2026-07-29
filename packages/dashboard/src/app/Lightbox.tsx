import { useQuery } from '@tanstack/react-query';
import { useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { mediaConsoleClient } from '../client/media-console-client.js';
import type { ObjectDetailResponse } from '../client/types.js';
import { DataTable } from './DataTable.js';
import { Alert, Button, Notice, formatBytes } from './ui.js';
import {
  DialogBackdrop,
  DialogClose,
  DialogPopup,
  DialogPortal,
  DialogRoot,
  DialogTitle,
} from './ui/dialog.js';

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

/** How much of a text/CSV file we pull into the tab. Small files arrive whole; a larger one is
 *  *sampled* — we read this many bytes of its head and stop, so even a multi-GB CSV previews (its
 *  start) without freezing. Filters/sort then operate on the loaded sample. */
const SAMPLE_TEXT_BYTES = 8 * 1024 * 1024;

/** The shared fallback surface: a glyph, a message, and a link to the original in a new tab. Used
 *  whenever inline rendering isn't available (unknown type, too large, or a read error). */
function FallbackCard({ item, message }: { item: PreviewItem; message: string }): JSX.Element {
  return (
    <div className="grid h-full min-h-[320px] place-items-center gap-4 px-6 text-center">
      <div className="flex flex-col items-center gap-4">
        <div className="grid h-14 w-14 place-items-center rounded-lg border border-border bg-zinc-900 text-2xl text-zinc-600">
          ⬡
        </div>
        <div className="mono max-w-md text-sm text-zinc-400">{message}</div>
        <Button
          tone="accent"
          size="sm"
          // biome-ignore lint/a11y/useAnchorContent: Base UI's `render` prop clones this element with the Button's children; the link is not empty at runtime
          render={<a href={item.url} target="_blank" rel="noopener noreferrer" />}
        >
          Open original ↗
        </Button>
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

function DelimitedTable({ text, delimiter }: { text: string; delimiter: string }): JSX.Element {
  const rows = parseDelimited(text.trimEnd(), delimiter);
  const header = rows[0];
  if (!header) return <Notice>Empty file.</Notice>;
  return <DataTable header={header} body={rows.slice(1)} />;
}

/** Above this compressed size we skip fetching a spreadsheet for inline preview. Unlike text, a
 *  workbook is a zip — it can't be head-sampled, so the whole file has to be parsed; past this the
 *  parse is too slow/heavy for the tab. The "Open ↗" link still serves the original. */
const MAX_SHEET_PREVIEW_BYTES = 15 * 1024 * 1024;

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
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      {workbook.SheetNames.length > 1 && (
        <div className="flex flex-wrap gap-1">
          {workbook.SheetNames.map((name, index) => (
            <Button
              key={name}
              tone={index === sheetIndex ? 'selected' : 'quiet'}
              onClick={() => setSheetIndex(index)}
              className="px-2 py-0.5"
            >
              {name}
            </Button>
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

function PreviewBody({ item, kind }: { item: PreviewItem; kind: PreviewKind }): JSX.Element {
  switch (kind) {
    case 'image':
      return (
        <div className="grid min-h-0 flex-1 place-items-center">
          <img
            src={item.url}
            alt={item.name}
            className="max-h-full max-w-full rounded-md object-contain"
          />
        </div>
      );
    case 'video':
      return (
        <div className="grid min-h-0 flex-1 place-items-center">
          {/* biome-ignore lint/a11y/useMediaCaption: preview of an arbitrary stored object; no track available */}
          <video src={item.url} controls className="max-h-full max-w-full rounded-md" />
        </div>
      );
    case 'audio':
      return (
        <div className="grid min-h-0 flex-1 place-items-center">
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
          className="min-h-0 w-full flex-1 rounded-md border border-border bg-white"
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

/** A modal preview of a disk object: the object's name + metadata over an inline renderer chosen by
 *  content type. Same Dialog primitive as every other modal in the console (see `./ui/dialog.tsx`),
 *  so Escape, outside-press, the focus trap and focus restore all behave identically — a preview
 *  opened from a row hands focus back to that row on close. */
export function Lightbox({
  item,
  onClose,
}: {
  item: PreviewItem | null;
  onClose: () => void;
}): JSX.Element | null {
  const popupRef = useRef<HTMLDivElement>(null);
  if (!item) return null;
  const kind = previewKind(item);

  return (
    <DialogRoot
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogPortal>
        <DialogBackdrop />
        <DialogPopup
          ref={popupRef}
          // Focus the panel itself, not the first tabbable thing in it — that is the "Open ↗" link,
          // and opening a preview should not leave Enter armed to launch a new tab.
          initialFocus={popupRef}
          className="h-[86vh] max-h-[calc(100vh-3rem)] max-w-5xl"
        >
          <div className="flex items-center gap-3 border-b border-border px-4 py-2.5">
            <div className="min-w-0 flex-1">
              <DialogTitle className="truncate normal-case tracking-normal text-sm text-zinc-200">
                {item.name}
              </DialogTitle>
              <div className="mono tnum mt-0.5 flex items-center gap-2 text-[10px] text-zinc-600">
                <span>{formatBytes(item.size)}</span>
                {item.contentType && (
                  <span className="rounded border border-border px-1 text-zinc-500">
                    {item.contentType}
                  </span>
                )}
              </div>
            </div>
            <Button
              tone="ghost"
              className="shrink-0"
              // biome-ignore lint/a11y/useAnchorContent: Base UI's `render` prop clones this element with the Button's children; the link is not empty at runtime
              render={<a href={item.url} target="_blank" rel="noopener noreferrer" />}
            >
              Open ↗
            </Button>
            <Button
              render={<DialogClose />}
              tone="ghost"
              aria-label="Close preview"
              className="shrink-0"
            >
              ✕
            </Button>
          </div>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-4">
            <PreviewBody item={item} kind={kind} />
          </div>
        </DialogPopup>
      </DialogPortal>
    </DialogRoot>
  );
}
