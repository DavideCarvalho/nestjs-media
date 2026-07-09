import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { mediaConsoleClient } from '../../client/media-console-client.js';
import type {
  DiskInfo,
  ObjectEntry,
  ObjectFolder,
  ObjectListResponse,
} from '../../client/types.js';
import type { Route } from '../useHashRoute.js';

interface AccumulatedPage {
  key: string;
  folders: ObjectFolder[];
  files: ObjectEntry[];
  /** Next-page cursor from the most recently merged response (undefined = no further pages). */
  cursor: string | undefined;
  /** Reference to the last response merged in, so re-renders don't re-merge the same page. */
  lastData: ObjectListResponse | undefined;
}

interface Breadcrumb {
  label: string;
  prefix: string;
}

function formatBytes(bytes: number | null): string {
  if (bytes === null) return '—';
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;
  const unit = units[exponent] ?? 'B';
  return exponent === 0 ? `${value} ${unit}` : `${value.toFixed(1)} ${unit}`;
}

function formatDate(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString();
}

function breadcrumbsFor(prefix: string | undefined): Breadcrumb[] {
  if (!prefix) return [];
  const segments = prefix.split('/').filter((segment) => segment.length > 0);
  const crumbs: Breadcrumb[] = [];
  let accumulated = '';
  for (const segment of segments) {
    accumulated = accumulated ? `${accumulated}/${segment}` : segment;
    crumbs.push({ label: segment, prefix: accumulated });
  }
  return crumbs;
}

function navigateToDisk(disk: string): void {
  window.location.hash = `#/disks/${encodeURIComponent(disk)}`;
}

function navigateToPrefix(disk: string, prefix: string): void {
  const query = prefix ? `?prefix=${encodeURIComponent(prefix)}` : '';
  window.location.hash = `#/disks/${encodeURIComponent(disk)}${query}`;
}

function buildObjectsParams(
  prefix: string | undefined,
  cursor: string | undefined,
): { prefix?: string; cursor?: string } {
  const params: { prefix?: string; cursor?: string } = {};
  if (prefix !== undefined) params.prefix = prefix;
  if (cursor !== undefined) params.cursor = cursor;
  return params;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function DisksView({ route, actions }: { route: Route; actions: boolean }): JSX.Element {
  const queryClient = useQueryClient();
  const disksQuery = useQuery({ queryKey: ['disks'], queryFn: () => mediaConsoleClient.disks() });
  const disks = disksQuery.data?.disks ?? [];
  const selectedDisk = route.disk ?? disks[0]?.name;
  const prefix = route.prefix;
  const pageKey = `${selectedDisk ?? ''}::${prefix ?? ''}`;

  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [page, setPage] = useState<AccumulatedPage>({
    key: pageKey,
    folders: [],
    files: [],
    cursor: undefined,
    lastData: undefined,
  });
  const [busyKey, setBusyKey] = useState<string | null>(null);

  if (page.key !== pageKey) {
    setPage({ key: pageKey, folders: [], files: [], cursor: undefined, lastData: undefined });
    setCursor(undefined);
  }

  const selectedDiskInfo: DiskInfo | undefined = disks.find((disk) => disk.name === selectedDisk);
  const listSupported = selectedDiskInfo ? selectedDiskInfo.capabilities.list : true;

  const objectsQuery = useQuery({
    queryKey: ['objects', selectedDisk, prefix, cursor],
    queryFn: () => {
      if (!selectedDisk) throw new Error('No disk selected');
      return mediaConsoleClient.objects(selectedDisk, buildObjectsParams(prefix, cursor));
    },
    enabled: Boolean(selectedDisk) && listSupported,
  });

  const data = objectsQuery.data;
  if (data && page.key === pageKey && page.lastData !== data) {
    if (cursor === undefined) {
      setPage({
        key: pageKey,
        folders: data.folders,
        files: data.files,
        cursor: data.cursor,
        lastData: data,
      });
    } else {
      setPage({
        key: pageKey,
        folders: [...page.folders, ...data.folders],
        files: [...page.files, ...data.files],
        cursor: data.cursor,
        lastData: data,
      });
    }
  }

  function resetPagination(): void {
    setCursor(undefined);
    setPage({ key: pageKey, folders: [], files: [], cursor: undefined, lastData: undefined });
  }

  async function invalidateObjects(disk: string): Promise<void> {
    await queryClient.invalidateQueries({ queryKey: ['objects', disk] });
    resetPagination();
  }

  async function handlePreview(disk: string, key: string): Promise<void> {
    setBusyKey(key);
    try {
      const detail = await mediaConsoleClient.object(disk, key);
      window.open(detail.url, '_blank', 'noopener,noreferrer');
    } catch (error) {
      window.alert(`Failed to open "${key}": ${describeError(error)}`);
    } finally {
      setBusyKey(null);
    }
  }

  async function handleCopyKey(key: string): Promise<void> {
    await navigator.clipboard.writeText(key);
  }

  async function handleDelete(disk: string, key: string): Promise<void> {
    if (!window.confirm(`Delete "${key}"? This cannot be undone.`)) return;
    setBusyKey(key);
    try {
      await mediaConsoleClient.deleteObject(disk, key);
      await invalidateObjects(disk);
    } catch (error) {
      window.alert(`Failed to delete "${key}": ${describeError(error)}`);
    } finally {
      setBusyKey(null);
    }
  }

  async function handleCopyOrMove(kind: 'copy' | 'move', disk: string, key: string): Promise<void> {
    const destination = window.prompt(`${kind === 'copy' ? 'Copy' : 'Move'} "${key}" to key:`, key);
    if (!destination || destination === key) return;
    setBusyKey(key);
    try {
      if (kind === 'copy') {
        await mediaConsoleClient.copyObject(disk, key, destination);
      } else {
        await mediaConsoleClient.moveObject(disk, key, destination);
      }
      await invalidateObjects(disk);
    } catch (error) {
      window.alert(`Failed to ${kind} "${key}": ${describeError(error)}`);
    } finally {
      setBusyKey(null);
    }
  }

  const crumbs = breadcrumbsFor(prefix);

  return (
    <section>
      <h2 className="mb-2 text-base font-semibold">Disks</h2>
      <div className="grid grid-cols-[220px_1fr] gap-4">
        <aside className="rounded border border-slate-200 bg-white p-2">
          <h3 className="px-2 py-1 text-xs font-semibold uppercase text-slate-400">Disks</h3>
          {disksQuery.isLoading && <p className="px-2 py-1 text-sm text-slate-500">Loading…</p>}
          {disksQuery.isError && (
            <p className="px-2 py-1 text-sm text-red-600">{describeError(disksQuery.error)}</p>
          )}
          {!disksQuery.isLoading && disks.length === 0 && (
            <p className="px-2 py-1 text-sm text-slate-500">No disks configured.</p>
          )}
          <ul className="space-y-0.5">
            {disks.map((disk) => (
              <li key={disk.name}>
                <button
                  type="button"
                  onClick={() => navigateToDisk(disk.name)}
                  className={`flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-sm ${
                    disk.name === selectedDisk
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  <span className="truncate">{disk.name}</span>
                  <span className="flex items-center gap-1">
                    {disk.default && (
                      <span
                        className={`text-xs ${
                          disk.name === selectedDisk ? 'text-slate-300' : 'text-slate-400'
                        }`}
                      >
                        default
                      </span>
                    )}
                    {!disk.capabilities.list && (
                      <span
                        title="Listing unsupported on this disk"
                        className="h-1.5 w-1.5 rounded-full bg-amber-400"
                      />
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <div className="rounded border border-slate-200 bg-white p-3">
          {!selectedDisk && (
            <p className="text-sm text-slate-500">Select a disk to browse its objects.</p>
          )}

          {selectedDisk && !listSupported && (
            <p className="text-sm text-slate-500">
              Listing is not supported on disk <span className="font-medium">{selectedDisk}</span>.
            </p>
          )}

          {selectedDisk && listSupported && (
            <>
              <nav className="mb-3 flex flex-wrap items-center gap-1 text-sm text-slate-500">
                <button
                  type="button"
                  onClick={() => navigateToPrefix(selectedDisk, '')}
                  className={`rounded px-1.5 py-0.5 hover:bg-slate-100 ${
                    !prefix ? 'font-semibold text-slate-900' : ''
                  }`}
                >
                  {selectedDisk}
                </button>
                {crumbs.map((crumb, index) => (
                  <span key={crumb.prefix} className="flex items-center gap-1">
                    <span className="text-slate-300">/</span>
                    <button
                      type="button"
                      onClick={() => navigateToPrefix(selectedDisk, crumb.prefix)}
                      className={`rounded px-1.5 py-0.5 hover:bg-slate-100 ${
                        index === crumbs.length - 1 ? 'font-semibold text-slate-900' : ''
                      }`}
                    >
                      {crumb.label}
                    </button>
                  </span>
                ))}
              </nav>

              {objectsQuery.isLoading && <p className="text-sm text-slate-500">Loading objects…</p>}
              {objectsQuery.isError && (
                <p className="text-sm text-red-600">{describeError(objectsQuery.error)}</p>
              )}
              {!objectsQuery.isLoading &&
                !objectsQuery.isError &&
                page.folders.length === 0 &&
                page.files.length === 0 && (
                  <p className="text-sm text-slate-500">This folder is empty.</p>
                )}

              {(page.folders.length > 0 || page.files.length > 0) && (
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-xs uppercase text-slate-400">
                      <th className="py-1.5 pr-2 font-medium">Name</th>
                      <th className="py-1.5 pr-2 font-medium">Size</th>
                      <th className="py-1.5 pr-2 font-medium">Last modified</th>
                      <th className="py-1.5 pr-2 font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {page.folders.map((folder) => (
                      <tr key={folder.prefix} className="border-b border-slate-100">
                        <td className="py-1.5 pr-2">
                          <button
                            type="button"
                            onClick={() => navigateToPrefix(selectedDisk, folder.prefix)}
                            className="text-slate-700 hover:underline"
                          >
                            📁 {folder.name}
                          </button>
                        </td>
                        <td className="py-1.5 pr-2 text-slate-400">—</td>
                        <td className="py-1.5 pr-2 text-slate-400">—</td>
                        <td className="py-1.5 pr-2 text-slate-400">—</td>
                      </tr>
                    ))}
                    {page.files.map((file) => (
                      <tr key={file.key} className="border-b border-slate-100">
                        <td className="py-1.5 pr-2 text-slate-700">{file.name}</td>
                        <td className="py-1.5 pr-2 text-slate-500">
                          {formatBytes(file.sizeBytes)}
                        </td>
                        <td className="py-1.5 pr-2 text-slate-500">
                          {formatDate(file.lastModified)}
                        </td>
                        <td className="py-1.5 pr-2">
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              disabled={busyKey === file.key}
                              onClick={() => handlePreview(selectedDisk, file.key)}
                              className="rounded px-1.5 py-0.5 text-slate-600 hover:bg-slate-100 disabled:opacity-50"
                            >
                              Preview
                            </button>
                            <button
                              type="button"
                              onClick={() => handleCopyKey(file.key)}
                              className="rounded px-1.5 py-0.5 text-slate-600 hover:bg-slate-100"
                            >
                              Copy key
                            </button>
                            {actions && (
                              <>
                                <button
                                  type="button"
                                  disabled={busyKey === file.key}
                                  onClick={() => handleCopyOrMove('copy', selectedDisk, file.key)}
                                  className="rounded px-1.5 py-0.5 text-slate-600 hover:bg-slate-100 disabled:opacity-50"
                                >
                                  Copy to…
                                </button>
                                <button
                                  type="button"
                                  disabled={busyKey === file.key}
                                  onClick={() => handleCopyOrMove('move', selectedDisk, file.key)}
                                  className="rounded px-1.5 py-0.5 text-slate-600 hover:bg-slate-100 disabled:opacity-50"
                                >
                                  Move to…
                                </button>
                                <button
                                  type="button"
                                  disabled={busyKey === file.key}
                                  onClick={() => handleDelete(selectedDisk, file.key)}
                                  className="rounded px-1.5 py-0.5 text-red-600 hover:bg-red-50 disabled:opacity-50"
                                >
                                  Delete
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {page.cursor !== undefined && (
                <div className="mt-3">
                  <button
                    type="button"
                    disabled={objectsQuery.isFetching}
                    onClick={() => setCursor(page.cursor)}
                    className="rounded border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                  >
                    {objectsQuery.isFetching ? 'Loading…' : 'Load more'}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}
