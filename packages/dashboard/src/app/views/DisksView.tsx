import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { mediaConsoleClient } from '../../client/media-console-client.js';
import type {
  DiskInfo,
  ObjectEntry,
  ObjectFolder,
  ObjectListResponse,
} from '../../client/types.js';
import { Lightbox, type PreviewItem } from '../Lightbox.js';
import { Button, Dot, GhostButton, Modal, Notice, Panel, formatBytes, formatDate } from '../ui.js';
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

/** Which action dialog (if any) is open over the disk browser. */
type Dialog =
  | { kind: 'upload' }
  | { kind: 'folder' }
  | { kind: 'delete-file'; key: string; name: string }
  | { kind: 'delete-folder'; prefix: string; name: string };

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

/** The full object key for a name placed into `prefix`: the browsed prefix + the name. The prefix
 *  arrives from S3 folder navigation with a trailing slash (CommonPrefixes end in the delimiter), so
 *  strip it before joining — otherwise the key double-slashes (`a//file`) into a phantom subfolder. */
function keyIn(prefix: string | undefined, name: string): string {
  const parent = prefix?.replace(/\/+$/, '');
  return parent ? `${parent}/${name}` : name;
}

/** Modal file uploader: pick or drop files, see them listed, upload with per-file progress. */
function UploadDialog({
  disk,
  prefix,
  onClose,
  onUploaded,
}: {
  disk: string;
  prefix: string | undefined;
  onClose: () => void;
  onUploaded: () => Promise<void>;
}): JSX.Element {
  const [files, setFiles] = useState<File[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function addFiles(incoming: FileList | File[]): void {
    setFiles((current) => [...current, ...Array.from(incoming)]);
  }

  async function upload(): Promise<void> {
    if (files.length === 0) return;
    setProgress({ done: 0, total: files.length });
    setError(null);
    try {
      for (let index = 0; index < files.length; index++) {
        const file = files[index];
        if (!file) continue;
        await mediaConsoleClient.uploadObject(disk, keyIn(prefix, file.name), file);
        setProgress({ done: index + 1, total: files.length });
      }
      await onUploaded();
      onClose();
    } catch (uploadError) {
      setError(describeError(uploadError));
      setProgress(null);
    }
  }

  const busy = progress !== null;
  return (
    <Modal
      title={`Upload to ${prefix ? `/${prefix}` : disk}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button tone="emerald" onClick={upload} disabled={busy || files.length === 0}>
            {busy ? `Uploading ${progress.done}/${progress.total}…` : 'Upload'}
          </Button>
        </>
      }
    >
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: click opens the native file picker; keyboard users reach it via the same hidden input's label semantics */}
      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={(event) => {
          event.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragOver(false);
          addFiles(event.dataTransfer.files);
        }}
        className={`mono cursor-pointer rounded-md border border-dashed px-3 py-6 text-center text-xs transition-colors ${
          dragOver
            ? 'border-emerald-500/50 bg-emerald-500/5 text-emerald-300'
            : 'border-[var(--line)] text-zinc-500 hover:text-zinc-300'
        }`}
      >
        Drop files here, or click to choose
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(event) => {
            if (event.target.files) addFiles(event.target.files);
            event.target.value = '';
          }}
        />
      </div>
      {files.length > 0 && (
        <ul className="mt-3 max-h-48 space-y-1 overflow-auto">
          {files.map((file, index) => (
            <li
              key={`${file.name}-${index}`}
              className="mono flex items-center justify-between gap-2 rounded border border-[var(--line)] px-2 py-1 text-[11px]"
            >
              <span className="truncate text-zinc-300">{file.name}</span>
              <span className="flex shrink-0 items-center gap-2">
                <span className="tnum text-zinc-600">{formatBytes(file.size)}</span>
                {!busy && (
                  <button
                    type="button"
                    aria-label={`Remove ${file.name}`}
                    onClick={() => setFiles((current) => current.filter((_, i) => i !== index))}
                    className="text-zinc-600 hover:text-rose-400"
                  >
                    ✕
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="mono mt-3 text-[11px] s-error">{error}</p>}
    </Modal>
  );
}

/** Modal folder creator: a name input that writes a `<prefix>/name/` marker. */
function FolderDialog({
  disk,
  prefix,
  onClose,
  onCreated,
}: {
  disk: string;
  prefix: string | undefined;
  onClose: () => void;
  onCreated: () => Promise<void>;
}): JSX.Element {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  async function create(): Promise<void> {
    const trimmed = name.trim();
    if (trimmed === '') return;
    setBusy(true);
    setError(null);
    try {
      await mediaConsoleClient.createFolder(disk, keyIn(prefix, trimmed));
      await onCreated();
      onClose();
    } catch (createError) {
      setError(describeError(createError));
      setBusy(false);
    }
  }

  return (
    <Modal
      title="New folder"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button tone="emerald" onClick={create} disabled={busy || name.trim() === ''}>
            {busy ? 'Creating…' : 'Create'}
          </Button>
        </>
      }
    >
      <label className="mono flex flex-col gap-1 text-[10px] uppercase tracking-wider text-zinc-600">
        Folder name
        <input
          ref={inputRef}
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') create();
          }}
          placeholder="reports"
          className="mono rounded-md border border-[var(--line)] bg-black/30 px-3 py-2 text-sm normal-case tracking-normal text-zinc-100 focus:border-emerald-500/40 focus:outline-none"
        />
      </label>
      <p className="mono mt-2 text-[10px] text-zinc-600">
        Creates {prefix ? `/${prefix}/` : ''}
        <span className="text-zinc-400">{name.trim() || 'name'}</span>/
      </p>
      {error && <p className="mono mt-3 text-[11px] s-error">{error}</p>}
    </Modal>
  );
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
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [dragOver, setDragOver] = useState(false);

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

  /** Quick drag-drop-to-panel upload (the modal is the click path). */
  async function handleDropUpload(disk: string, files: FileList): Promise<void> {
    const list = Array.from(files);
    if (list.length === 0) return;
    setBusyKey('__drop__');
    try {
      for (const file of list) {
        await mediaConsoleClient.uploadObject(disk, keyIn(prefix, file.name), file);
      }
      await invalidateObjects(disk);
    } catch (error) {
      window.alert(`Upload failed: ${describeError(error)}`);
    } finally {
      setBusyKey(null);
    }
  }

  async function confirmDelete(disk: string): Promise<void> {
    if (!dialog || (dialog.kind !== 'delete-file' && dialog.kind !== 'delete-folder')) return;
    const target = dialog;
    setBusyKey('__delete__');
    try {
      if (target.kind === 'delete-file') {
        await mediaConsoleClient.deleteObject(disk, target.key);
      } else {
        await mediaConsoleClient.deleteFolder(disk, target.prefix);
      }
      await invalidateObjects(disk);
      setDialog(null);
    } catch (error) {
      window.alert(`Failed to delete: ${describeError(error)}`);
    } finally {
      setBusyKey(null);
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
                      handleDropUpload(selectedDisk, event.dataTransfer.files);
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
                    <GhostButton tone="emerald" onClick={() => setDialog({ kind: 'upload' })}>
                      ↑ Upload
                    </GhostButton>
                    <GhostButton onClick={() => setDialog({ kind: 'folder' })}>
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
                        <td className="py-2 pr-2">
                          {actions && (
                            <GhostButton
                              tone="rose"
                              onClick={() =>
                                setDialog({
                                  kind: 'delete-folder',
                                  prefix: folder.prefix,
                                  name: folder.name,
                                })
                              }
                            >
                              Delete
                            </GhostButton>
                          )}
                        </td>
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
                                  onClick={() =>
                                    setDialog({
                                      kind: 'delete-file',
                                      key: file.key,
                                      name: file.name,
                                    })
                                  }
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

      {selectedDisk && dialog?.kind === 'upload' && (
        <UploadDialog
          disk={selectedDisk}
          prefix={prefix}
          onClose={() => setDialog(null)}
          onUploaded={() => invalidateObjects(selectedDisk)}
        />
      )}
      {selectedDisk && dialog?.kind === 'folder' && (
        <FolderDialog
          disk={selectedDisk}
          prefix={prefix}
          onClose={() => setDialog(null)}
          onCreated={() => invalidateObjects(selectedDisk)}
        />
      )}
      {selectedDisk && (dialog?.kind === 'delete-file' || dialog?.kind === 'delete-folder') && (
        <Modal
          title={dialog.kind === 'delete-folder' ? 'Delete folder' : 'Delete object'}
          onClose={() => setDialog(null)}
          footer={
            <>
              <Button onClick={() => setDialog(null)} disabled={busyKey === '__delete__'}>
                Cancel
              </Button>
              <Button
                tone="rose"
                onClick={() => confirmDelete(selectedDisk)}
                disabled={busyKey === '__delete__'}
              >
                {busyKey === '__delete__' ? 'Deleting…' : 'Delete'}
              </Button>
            </>
          }
        >
          <p className="text-sm text-zinc-300">
            Delete <span className="mono text-zinc-100">{dialog.name}</span>?
          </p>
          <p className="mono mt-2 text-[11px] text-zinc-600">
            {dialog.kind === 'delete-folder'
              ? 'Every object inside this folder is removed. This cannot be undone.'
              : 'This cannot be undone.'}
          </p>
        </Modal>
      )}

      <Lightbox item={preview} onClose={() => setPreview(null)} />
    </section>
  );
}
