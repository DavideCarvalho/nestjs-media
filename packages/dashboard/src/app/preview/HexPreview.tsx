import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { mediaConsoleClient } from '../../client/media-console-client.js';
import { Alert, Button, Notice, formatBytes } from '../ui.js';
import { Input } from '../ui/input.js';
import { FallbackCard, readErrorMessage } from './shared.js';
import type { PreviewItem } from './types.js';

/** How much of the object one screenful reads. Small enough that a page lands in one round trip on a
 *  bad connection, large enough that scrolling within a page is the common case and the range request
 *  is the rare one. The object that motivated this viewer is 302 MB; at this size a reader pages
 *  through it a few kilobytes at a time and never once asks the disk for the whole thing. */
export const PAGE_BYTES = 4 * 1024;

/** The canonical hex-dump row width. Not a preference — 16 is what `xxd` and `hexdump -C` emit, and a
 *  reader counting columns to find a field offset is counting against that muscle memory. */
export const BYTES_PER_ROW = 16;

/** A byte outside this range has no glyph worth printing (control codes, everything above ASCII), so
 *  the ASCII column shows a dot. The range is `hexdump`'s, deliberately: high bytes are *not* decoded
 *  as latin-1 here, because guessing an encoding is exactly the thing that lands an object in the hex
 *  viewer in the first place. */
const PRINTABLE_MIN = 0x20;
const PRINTABLE_MAX = 0x7e;

export interface HexRow {
  /** Absolute offset of this row's first byte within the object, not within the fetched page. */
  offset: number;
  /** Always `BYTES_PER_ROW` entries; a short final row is padded with blanks rather than truncated,
   *  so the ASCII column doesn't slide left on the last line of the file. */
  cells: string[];
  ascii: string;
}

/** Groups a byte count with commas by hand rather than through `toLocaleString`. The footer sets a
 *  grouped total next to ungrouped offsets, and a locale that groups on `.` or spaces would make that
 *  pairing unreadable — the number beside "bytes 0–4095" has to look like the same kind of number
 *  everywhere the console is opened. */
function groupDigits(value: number): string {
  return Math.trunc(value)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** The offset gutter: eight lowercase hex digits, zero-padded. Lowercase throughout (gutter and
 *  bytes both) so an address or a byte string can be pasted straight into or out of `xxd` output
 *  without a case-fold in between. Eight digits addresses 4 GB, past which the column simply grows. */
export function formatOffset(offset: number): string {
  return offset.toString(16).padStart(8, '0');
}

/** Splits a fetched page into rows, tagging each with its *absolute* offset so a row read at the end
 *  of a 302 MB file reports where it actually lives rather than where it landed in the buffer. */
export function hexRows(bytes: Uint8Array, baseOffset: number): HexRow[] {
  const rows: HexRow[] = [];
  for (let index = 0; index < bytes.length; index += BYTES_PER_ROW) {
    const cells: string[] = [];
    let ascii = '';
    for (let column = 0; column < BYTES_PER_ROW; column++) {
      const byte = bytes[index + column];
      // Past the end of a short final row: pad the hex cell so the columns after it stay put, and
      // add nothing to the ASCII text (trailing dots there would read as real NUL bytes in the file).
      if (byte === undefined) {
        cells.push('  ');
        continue;
      }
      cells.push(byte.toString(16).padStart(2, '0'));
      ascii += byte >= PRINTABLE_MIN && byte <= PRINTABLE_MAX ? String.fromCharCode(byte) : '.';
    }
    rows.push({ offset: baseOffset + index, cells, ascii });
  }
  return rows;
}

/** Joins a row's hex cells into the fixed-width middle column, with the traditional double gap at the
 *  halfway mark. That gap is the only reason anyone can count to byte 11 by eye instead of by finger. */
export function formatHexColumn(cells: string[]): string {
  const half = BYTES_PER_ROW / 2;
  return `${cells.slice(0, half).join(' ')}  ${cells.slice(half).join(' ')}`;
}

/** Reads a typed offset in either of the two notations someone actually has to hand: the decimal one
 *  a size or a diff gave them, and the `0x` hex one the gutter of this very viewer prints. Returns
 *  null for anything else — including a bare `4d2`, which is ambiguous between the two and would
 *  otherwise silently jump 1234 bytes short of where its author meant. Bounds are not this function's
 *  business; `clampOffset` owns that. */
export function parseOffset(input: string): number | null {
  const text = input.trim();
  const hex = /^0[xX]([0-9a-fA-F]+)$/.exec(text);
  const digits = hex?.[1];
  if (digits !== undefined) return Number.parseInt(digits, 16);
  if (!/^\d+$/.test(text)) return null;
  return Number.parseInt(text, 10);
}

/** Forces an offset into `[0, size)`. Every navigation runs through here, so "previous page" at the
 *  start and "next page" at the end are no-ops rather than errors, and a typed offset past the end of
 *  the file lands on its last byte instead of asking the disk for a range it will refuse. An empty
 *  object has no valid offset at all; 0 is the honest answer and the caller renders nothing anyway. */
export function clampOffset(offset: number, size: number): number {
  if (!Number.isFinite(offset) || offset < 0 || size <= 0) return 0;
  return Math.min(Math.floor(offset), size - 1);
}

/** The start of the page containing `offset`, aligned down to a page boundary. Alignment is what keeps
 *  the viewer coherent across mixed navigation: paging and jumping land on the same window, so a row
 *  seen after typing an offset is at the same address as the row seen after clicking next twice. */
export function pageStart(offset: number, size: number): number {
  return Math.floor(clampOffset(offset, size) / PAGE_BYTES) * PAGE_BYTES;
}

/** Start of the window holding the object's final byte. */
export function lastPageStart(size: number): number {
  return pageStart(size - 1, size);
}

/** How many bytes the window at `start` actually covers — a full page everywhere but the tail. */
export function windowLength(start: number, size: number): number {
  return Math.max(0, Math.min(PAGE_BYTES, size - start));
}

/** The footer line: which bytes are on screen, against the whole. Offsets stay ungrouped because they
 *  are addresses and get compared against the hex gutter; the total is grouped because it is a
 *  quantity and nobody reads 316669952 at a glance. */
export function describeWindow(start: number, length: number, size: number): string {
  if (length <= 0) return `0 bytes of ${groupDigits(size)}`;
  return `bytes ${start}–${start + length - 1} of ${groupDigits(size)}`;
}

/**
 * The console's renderer of last resort: whatever nobody recognized, shown as the bytes it is.
 *
 * This is reached for genuinely arbitrary objects — a mislabelled upload, a proprietary container, a
 * truncated download — so it is written to survive anything rather than to parse anything. Nothing is
 * decoded as text, no length is trusted, and the object is read through a *window*: one page at a
 * time over a ranged request, never `objectBytes`. The object that prompted this viewer is 302 MB and
 * reading it whole would hang the tab for anyone who merely wanted to check its magic number.
 *
 * Navigation is the whole feature. Somebody in here is looking for a specific offset — a header field,
 * the footer of a container format, the point where a file went wrong — so they get pages, both ends,
 * and a jump box that takes the `0x` address printed in this viewer's own gutter.
 */
export function HexPreview({ item }: { item: PreviewItem }): JSX.Element {
  // Keyed by object rather than held bare: the lightbox can swap `item` under a mounted renderer when
  // someone arrows to the next file, and a bare `start` would then point that new object's viewer at
  // the old one's offset — reading somewhere arbitrary, or off the end of a smaller file.
  const [anchor, setAnchor] = useState({ key: item.key, start: 0 });
  const start = anchor.key === item.key ? anchor.start : 0;
  const [draft, setDraft] = useState('');
  const [jumpError, setJumpError] = useState<string | null>(null);
  const length = windowLength(start, item.size);

  const query = useQuery({
    queryKey: ['object-hex', item.disk, item.key, start, length],
    // `objectRange` takes an inclusive end, per HTTP Range semantics — hence the -1. Off by one here
    // would quietly pull an extra byte into every page and shift the tail row of the file.
    queryFn: () => mediaConsoleClient.objectRange(item.disk, item.key, start, start + length - 1),
    retry: false,
    staleTime: 60_000,
    enabled: length > 0,
    // Hold the current page on screen while the next one is in flight. Paging a large object is a
    // repeated action, and collapsing the pane to "Loading…" on every click makes it feel like the
    // viewer is reloading the file rather than moving through it.
    placeholderData: keepPreviousData,
  });

  function go(offset: number): void {
    setJumpError(null);
    setAnchor({ key: item.key, start: pageStart(offset, item.size) });
  }

  function jump(event: React.FormEvent): void {
    event.preventDefault();
    const parsed = parseOffset(draft);
    if (parsed === null) {
      setJumpError(`Not an offset: "${draft.trim()}". Try 1234 or 0x4d2.`);
      return;
    }
    setDraft('');
    go(parsed);
  }

  // An empty object is a fact about the object, not a failure of the viewer — and a fetch for it would
  // be a zero-length range the disk is entitled to reject. Say so and read nothing.
  if (item.size <= 0) return <Notice>This file is empty — 0 bytes.</Notice>;

  if (query.isError && !query.data) {
    return (
      <FallbackCard
        item={item}
        message={readErrorMessage(query.error, 'Could not read this file.')}
      />
    );
  }

  const rows = query.data ? hexRows(query.data, start) : [];
  const atStart = start === 0;
  const atEnd = start >= lastPageStart(item.size);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <form className="flex shrink-0 flex-wrap items-center gap-1.5" onSubmit={jump}>
        <Button tone="ghost" onClick={() => go(0)} disabled={atStart}>
          ⇤ start
        </Button>
        <Button tone="ghost" onClick={() => go(start - PAGE_BYTES)} disabled={atStart}>
          ◀ prev
        </Button>
        <Button tone="ghost" onClick={() => go(start + PAGE_BYTES)} disabled={atEnd}>
          next ▶
        </Button>
        <Button tone="ghost" onClick={() => go(lastPageStart(item.size))} disabled={atEnd}>
          end ⇥
        </Button>
        <Input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          spellCheck={false}
          aria-label="Jump to offset"
          placeholder="offset — 1234 or 0x4d2"
          className="w-48"
        />
        <Button type="submit" tone="accent">
          Go
        </Button>
      </form>
      {jumpError && <Alert variant="error">{jumpError}</Alert>}
      <div className="mono min-h-0 flex-1 overflow-auto rounded-md border border-border bg-black/30 p-3 text-xs">
        {rows.length === 0 ? (
          <Notice>Reading…</Notice>
        ) : (
          rows.map((row) => (
            <div key={row.offset} className="flex gap-4 whitespace-pre leading-5">
              <span className="tnum shrink-0 text-zinc-600">{formatOffset(row.offset)}</span>
              <span className="shrink-0 text-zinc-300">{formatHexColumn(row.cells)}</span>
              <span className="shrink-0 text-zinc-500">{row.ascii}</span>
            </div>
          ))
        )}
      </div>
      <div className="mono tnum shrink-0 text-[10px] text-zinc-600">
        {describeWindow(start, length, item.size)} · {formatBytes(item.size)}
      </div>
    </div>
  );
}
