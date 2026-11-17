import { useQuery } from '@tanstack/react-query';
import { parseAsString, useQueryState } from 'nuqs';
import { type JSX, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { mediaConsoleClient } from '../../client/media-console-client.js';
import { DataTable } from '../DataTable.js';
import { Button, Notice, formatBytes } from '../ui.js';
import { FallbackCard } from './shared.js';
import type { PreviewItem } from './types.js';

/** Above this compressed size we skip fetching a spreadsheet for inline preview. Unlike text, a
 *  workbook is a zip — it can't be head-sampled, so the whole file has to be parsed; past this the
 *  parse is too slow/heavy for the tab. The "Open ↗" link still serves the original. */
const MAX_SHEET_PREVIEW_BYTES = 15 * 1024 * 1024;

/** Fetches an XLSX/XLS/ODS workbook's bytes and renders a sheet as a filterable table, with a tab per
 *  sheet when there's more than one. Parsed with SheetJS off the same-origin inline proxy. */
export function SheetPreview({ item }: { item: PreviewItem }): JSX.Element {
  const tooLarge = item.size > MAX_SHEET_PREVIEW_BYTES;
  const query = useQuery({
    queryKey: ['object-bytes', item.disk, item.key],
    queryFn: () => mediaConsoleClient.objectBytes(item.disk, item.key),
    retry: false,
    staleTime: 60_000,
    enabled: !tooLarge,
  });
  // `?sheet=<name>` (the first sheet is the default); switching adds a history entry.
  const [sheetName, setSheetName] = useQueryState(
    'sheet',
    parseAsString.withOptions({ history: 'push' }),
  );
  const workbook = useMemo(
    () => (query.data ? XLSX.read(query.data, { type: 'array' }) : undefined),
    [query.data],
  );
  // An unknown name (a link to a sheet since renamed) falls back to the first sheet.
  const sheetIndex = Math.max(0, workbook?.SheetNames.indexOf(sheetName ?? '') ?? 0);
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
              onClick={() => void setSheetName(index === 0 ? null : name)}
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
