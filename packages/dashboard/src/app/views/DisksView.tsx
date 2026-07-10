import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { mediaConsoleClient } from '../../client/media-console-client.js';
import type {
  DiskInfo,
  ObjectEntry,
  ObjectFolder,
  ObjectListResponse,
} from '../../client/types.js';
import { Lightbox, type PreviewItem } from '../Lightbox.js';
import { Dot, GhostButton, Notice, Panel, formatBytes, formatDate } from '../ui.js';
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
  const [preview, setPreview] = useState<PreviewItem | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  async function handlePreview(disk: string, key: string, name: string): Promise<void> {
    setBusyKey(key);
    try {
      const detail = await mediaConsoleClient.object(disk, key);
      setPreview({ ...detail, disk, name });
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

  /** The full object key for a name dropped into the current folder: the browsed prefix + the name. */
  function keyIn(name: string): string {
    return prefix ? `${prefix}/${name}` : name;
  }

  async function handleUpload(disk: string, files: FileList | File[]): Promise<void> {
    const list = Array.from(files);
    if (list.length === 0) return;
    setUploading(true);
    try {
      for (const file of list) {
        await mediaConsoleClient.uploadObject(disk, keyIn(file.name), file);
      }
      await invalidateObjects(disk);
    } catch (error) {
      window.alert(`Upload failed: ${describeError(error)}`);
    } finally {
      setUploading(false);
    }
  }

  async function handleCreateFolder(disk: string): Promise<void> {
    const name = window.prompt('New folder name:');
    if (!name) return;
    try {
      await mediaConsoleClient.createFolder(disk, keyIn(name));
      await invalidateObjects(disk);
    } catch (error) {
      window.alert(`Failed to create folder: ${describeError(error)}`);
    }
  }

  const crumbs = breadcrumbsFor(prefix);
  const isEmpty =
    !objectsQuery.isLoading &&
    !objectsQuery.isError &&
    page.folders.length === 0 &&
    page.files.length === 0;

  return (
    <section className="rise">
      <div className="grid grid-cols-[220px_1fr] gap-4">
        <Panel className="h-fit p-2">
          <h3 className="mono px-2 py-1 text-[10px] uppercase tracking-wider text-zinc-600">
            disks
          </h3>
          {disksQuery.isLoading && <Notice>Loading…</Notice>}
          {disksQuery.isError && (
            <p className="px-2 py-1 text-sm s-error">{describeError(disksQuery.error)}</p>
          )}
          {!disksQuery.isLoading && disks.length === 0 && <Notice>No disks configured.</Notice>}
          <ul className="space-y-0.5">
            {disks.map((disk) => {
              const active = disk.name === selectedDisk;
              return (
                <li key={disk.name}>
                  <button
                    type="button"
                    onClick={() => navigateToDisk(disk.name)}
                    className={`mono flex w-full items-center justify-between gap-2 rounded-md border px-2 py-1.5 text-left text-xs transition-colors ${
                      active
                        ? 'border-[var(--line)] bg-zinc-900 text-zinc-100'
                        : 'border-transparent text-zinc-400 hover:bg-zinc-900/50 hover:text-zinc-200'
                    }`}
                  >
                    <span className="truncate">{disk.name}</span>
                    <span className="flex shrink-0 items-center gap-1.5">
                      {disk.default && (
                        <span className="text-[9px] uppercase tracking-wider text-zinc-600">
                          default
                        </span>
                      )}
                      {!disk.capabilities.list && (
                        <span title="Listing unsupported on this disk">
                          <Dot tone="warn" />
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </Panel>

        <Panel className="p-3">
          {!selectedDisk && <Notice>Select a disk to browse its objects.</Notice>}

          {selectedDisk && !listSupported && (
            <Notice>
              Listing is not supported on disk{' '}
              <span className="mono text-zinc-300">{selectedDisk}</span>.
            </Notice>
          )}

          {selectedDisk && listSupported && (
            <div
              onDragOver={
                actions
                  ? (event) => {
                      event.preventDefault();
                      setDragOver(true);
                    }
                  : undefined
              }
              onDragLeave={actions ? () => setDragOver(false) : undefined}
              onDrop={
                actions
                  ? (event) => {
                      event.preventDefault();
                      setDragOver(false);
                      handleUpload(selectedDisk, event.dataTransfer.files);
                    }
                  : undefined
              }
              className={`rounded-md ${dragOver ? 'ring-2 ring-inset ring-emerald-500/50' : ''}`}
            >
              <div className="mb-3 flex items-center justify-between gap-2">
                <nav className="mono flex flex-wrap items-center gap-1 text-xs text-zinc-500">
                  <button
                    type="button"
                    onClick={() => navigateToPrefix(selectedDisk, '')}
                    className={`rounded px-1.5 py-0.5 hover:bg-zinc-800/60 ${
                      !prefix ? 'text-zinc-100' : ''
                    }`}
                  >
                    {selectedDisk}
                  </button>
                  {crumbs.map((crumb, index) => (
                    <span key={crumb.prefix} className="flex items-center gap-1">
                      <span className="text-zinc-700">/</span>
                      <button
                        type="button"
                        onClick={() => navigateToPrefix(selectedDisk, crumb.prefix)}
                        className={`rounded px-1.5 py-0.5 hover:bg-zinc-800/60 ${
                          index === crumbs.length - 1 ? 'text-zinc-100' : ''
                        }`}
                      >
                        {crumb.label}
                      </button>
                    </span>
                  ))}
                </nav>
                {actions && (
                  <div className="flex shrink-0 items-center gap-1.5">
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      className="hidden"
                      onChange={(event) => {
                        if (event.target.files) handleUpload(selectedDisk, event.target.files);
                        event.target.value = '';
                      }}
                    />
                    <GhostButton
                      tone="emerald"
                      disabled={uploading}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      {uploading ? 'Uploading…' : '↑ Upload'}
                    </GhostButton>
                    <GhostButton onClick={() => handleCreateFolder(selectedDisk)}>
                      + New folder
                    </GhostButton>
                  </div>
                )}
              </div>

              {objectsQuery.isLoading && <Notice>Loading objects…</Notice>}
              {objectsQuery.isError && (
                <p className="text-sm s-error">{describeError(objectsQuery.error)}</p>
              )}
              {isEmpty && <Notice>This folder is empty.</Notice>}

              {(page.folders.length > 0 || page.files.length > 0) && (
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="mono border-b border-[var(--line)] text-[10px] uppercase tracking-wider text-zinc-600">
                      <th className="py-2 pr-2 font-normal">Name</th>
                      <th className="py-2 pr-2 font-normal">Size</th>
                      <th className="py-2 pr-2 font-normal">Last modified</th>
                      <th className="py-2 pr-2 font-normal">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--line-soft)]">
                    {page.folders.map((folder) => (
                      <tr key={folder.prefix} className="hover:bg-zinc-900/40">
                        <td className="py-2 pr-2">
                          <button
                            type="button"
                            onClick={() => navigateToPrefix(selectedDisk, folder.prefix)}
                            className="flex items-center gap-2 text-zinc-200 hover:text-emerald-300"
                          >
                            <span className="text-zinc-600">▸</span>
                            {folder.name}
                          </button>
                        </td>
                        <td className="py-2 pr-2 text-zinc-700">—</td>
                        <td className="py-2 pr-2 text-zinc-700">—</td>
                        <td className="py-2 pr-2 text-zinc-700">—</td>
                      </tr>
                    ))}
                    {page.files.map((file) => (
                      <tr key={file.key} className="hover:bg-zinc-900/40">
                        <td className="mono py-2 pr-2 text-[13px] text-zinc-200">{file.name}</td>
                        <td className="mono tnum py-2 pr-2 text-xs text-zinc-500">
                          {formatBytes(file.sizeBytes)}
                        </td>
                        <td className="py-2 pr-2 text-xs text-zinc-500">
                          {formatDate(file.lastModified)}
                        </td>
                        <td className="py-2 pr-2">
                          <div className="flex flex-wrap gap-1.5">
                            <GhostButton
                              disabled={busyKey === file.key}
                              onClick={() => handlePreview(selectedDisk, file.key, file.name)}
                            >
                              Preview
                            </GhostButton>
                            <GhostButton onClick={() => handleCopyKey(file.key)}>
                              Copy key
                            </GhostButton>
                            {actions && (
                              <>
                                <GhostButton
                                  disabled={busyKey === file.key}
                                  onClick={() => handleCopyOrMove('copy', selectedDisk, file.key)}
                                >
                                  Copy to…
                                </GhostButton>
                                <GhostButton
                                  disabled={busyKey === file.key}
                                  onClick={() => handleCopyOrMove('move', selectedDisk, file.key)}
                                >
                                  Move to…
                                </GhostButton>
                                <GhostButton
                                  tone="rose"
                                  disabled={busyKey === file.key}
                                  onClick={() => handleDelete(selectedDisk, file.key)}
                                >
                                  Delete
                                </GhostButton>
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
                  <GhostButton
                    disabled={objectsQuery.isFetching}
                    onClick={() => setCursor(page.cursor)}
                  >
                    {objectsQuery.isFetching ? 'Loading…' : 'Load more'}
                  </GhostButton>
                </div>
              )}
              {actions && dragOver && (
                <p className="mono mt-3 rounded-md border border-dashed border-emerald-500/40 bg-emerald-500/5 px-3 py-4 text-center text-xs text-emerald-300/80">
                  Drop files to upload to {prefix ? `/${prefix}` : selectedDisk}
                </p>
              )}
            </div>
          )}
        </Panel>
      </div>
      <Lightbox item={preview} onClose={() => setPreview(null)} />
    </section>
  );
}
