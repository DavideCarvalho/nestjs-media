import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { mediaConsoleClient } from '../../client/media-console-client.js';
import type {
  DiskInfo,
  ObjectEntry,
  ObjectFolder,
  ObjectListResponse,
} from '../../client/types.js';
import { DRAG_MIME, type DragItem, FolderTree } from '../FolderTree.js';
import { Lightbox, type PreviewItem } from '../Lightbox.js';
import {
  Button,
  GhostButton,
  Modal,
  Notice,
  Panel,
  ToastStack,
  formatBytes,
  formatDate,
  useToasts,
} from '../ui.js';
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

/** A file or a folder targeted by a copy/move/rename. A file is addressed by its full key; a folder
 *  by its prefix (which carries a trailing slash from S3 listing). */
type MoveTarget =
  | { type: 'file'; key: string; name: string }
  | { type: 'folder'; prefix: string; name: string };

/** Which action dialog (if any) is open over the disk browser. */
type Dialog =
  | { kind: 'upload' }
  | { kind: 'folder' }
  | { kind: 'copy' | 'move'; target: MoveTarget }
  | { kind: 'rename'; target: MoveTarget }
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

function navigateToPrefix(disk: string, prefix: string): void {
  const query = prefix ? `?prefix=${encodeURIComponent(prefix)}` : '';
  window.location.hash = `#/disks/${encodeURIComponent(disk)}${query}`;
}

/** Rebuild the Disks-tab hash preserving `prefix` while setting (key) or clearing (null) the open
 *  preview. Uses URLSearchParams so params are percent-encoded exactly once — `parseHash` reads them
 *  back via `params.get(...)`, which decodes, so keys containing slashes round-trip. */
function navigateToPreview(disk: string, prefix: string | undefined, key: string | null): void {
  const base = `#/disks/${encodeURIComponent(disk)}`;
  const params = new URLSearchParams();
  if (prefix) params.set('prefix', prefix);
  if (key) params.set('preview', key);
  const qs = params.toString();
  window.location.hash = qs ? `${base}?${qs}` : base;
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

/** Arm a drag from a file/folder row: stash the item as JSON so a tree drop target can read it. */
function startRowDrag(event: React.DragEvent, item: DragItem): void {
  event.dataTransfer.setData(DRAG_MIME, JSON.stringify(item));
  event.dataTransfer.effectAllowed = 'move';
}

/** The full object key for a name placed into `prefix`: the browsed prefix + the name. The prefix
 *  arrives from S3 folder navigation with a trailing slash (CommonPrefixes end in the delimiter), so
 *  strip it before joining — otherwise the key double-slashes (`a//file`) into a phantom subfolder. */
function keyIn(prefix: string | undefined, name: string): string {
  const parent = prefix?.replace(/\/+$/, '');
  return parent ? `${parent}/${name}` : name;
}

/** The normalized source address of a move target: a file's full key, or a folder's prefix with the
 *  trailing slash stripped (so it composes with {@link keyIn} like any other path). */
function sourceAddress(target: MoveTarget): string {
  return target.type === 'file' ? target.key : target.prefix.replace(/\/+$/, '');
}

/** The containing folder of an address, WITH a trailing slash (or '' at the root) — pass to
 *  {@link keyIn} to place a renamed/moved sibling next to it. */
function parentDirOf(address: string): string {
  const lastSlash = address.lastIndexOf('/');
  return lastSlash === -1 ? '' : address.slice(0, lastSlash + 1);
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

/** Modal copy/move for a file OR a folder. The destination is picked from a folder tree spanning ALL
 *  disks (so you can relocate across buckets) plus an editable name. Same-disk uses the driver's
 *  native copy/move; cross-disk streams the bytes through the server. Copy keeps the original; Move
 *  removes it after the transfer. */
function CopyMoveDialog({
  kind,
  disks,
  sourceDisk,
  target,
  onClose,
  onDone,
  notify,
}: {
  kind: 'copy' | 'move';
  disks: DiskInfo[];
  sourceDisk: string;
  target: MoveTarget;
  onClose: () => void;
  onDone: (disk: string) => Promise<void>;
  notify: (tone: 'ok' | 'error', text: string) => void;
}): JSX.Element {
  const source = sourceAddress(target);
  // Destination is a picked disk + folder (from the tree) + an editable name — no free-text keys.
  const [destDisk, setDestDisk] = useState(sourceDisk);
  const [destPrefix, setDestPrefix] = useState(parentDirOf(source));
  const [name, setName] = useState(target.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.select();
  }, []);

  const noun = target.type === 'folder' ? 'folder' : 'object';
  const verb = kind === 'copy' ? 'Copy' : 'Move';
  const trimmedName = name.trim();
  const destination = keyIn(destPrefix, trimmedName);
  const sameDisk = destDisk === sourceDisk;
  const unchanged = sameDisk && destination === source;
  // Can't move/copy a folder into itself or a descendant (same disk only — the server enforces this
  // too, but disabling gives immediate feedback).
  const intoItself =
    target.type === 'folder' &&
    sameDisk &&
    (destination === source || destination.startsWith(`${source}/`));
  const blocked = trimmedName === '' || unchanged || intoItself;

  async function submit(): Promise<void> {
    if (blocked) return;
    setBusy(true);
    setError(null);
    try {
      if (target.type === 'folder') {
        if (kind === 'copy') {
          await mediaConsoleClient.copyFolder(sourceDisk, target.prefix, destDisk, destination);
        } else {
          await mediaConsoleClient.moveFolder(sourceDisk, target.prefix, destDisk, destination);
        }
      } else if (kind === 'copy') {
        await mediaConsoleClient.copyObject(sourceDisk, target.key, destDisk, destination);
      } else {
        await mediaConsoleClient.moveObject(sourceDisk, target.key, destDisk, destination);
      }
      // A move out of the source disk changes both listings; refresh whichever one differs too.
      await onDone(sourceDisk);
      if (!sameDisk) await onDone(destDisk);
      notify(
        'ok',
        `${verb === 'Copy' ? 'Copied' : 'Moved'} ${target.name} to ${destDisk}/${destination}`,
      );
      onClose();
    } catch (actionError) {
      setError(describeError(actionError));
      setBusy(false);
    }
  }

  return (
    <Modal
      title={`${verb} ${noun}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            tone={kind === 'move' ? 'rose' : 'emerald'}
            onClick={submit}
            disabled={busy || blocked}
          >
            {busy ? `${verb === 'Copy' ? 'Copying' : 'Moving'}…` : verb}
          </Button>
        </>
      }
    >
      <p className="mono mb-2 text-[11px] text-zinc-500">
        From{' '}
        <span className="text-zinc-300">
          {sourceDisk}/{source}
          {target.type === 'folder' ? '/' : ''}
        </span>
      </p>
      <div className="mono mb-1 text-[10px] uppercase tracking-wider text-zinc-600">
        Destination folder
      </div>
      <div className="max-h-56 overflow-auto rounded-md border border-[var(--line)] bg-black/20 p-1">
        <FolderTree
          disks={disks}
          selectedDisk={destDisk}
          currentPrefix={destPrefix}
          onNavigate={(navDisk, navPrefix) => {
            setDestDisk(navDisk);
            setDestPrefix(navPrefix);
          }}
        />
      </div>
      <label className="mono mt-3 flex flex-col gap-1 text-[10px] uppercase tracking-wider text-zinc-600">
        Name
        <input
          ref={inputRef}
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') submit();
          }}
          className="mono rounded-md border border-[var(--line)] bg-black/30 px-3 py-2 text-sm normal-case tracking-normal text-zinc-100 focus:border-emerald-500/40 focus:outline-none"
        />
      </label>
      <p className="mono mt-2 text-[10px] text-zinc-600">
        To{' '}
        <span className="text-zinc-400">
          {destDisk}/{destination || '—'}
        </span>
        {unchanged && ' (same as source — pick a different folder or name)'}
        {intoItself && ' (a folder cannot go into itself)'}
      </p>
      {error && <p className="mono mt-3 text-[11px] s-error">{error}</p>}
    </Modal>
  );
}

/** Modal rename-in-place for a file OR folder: a single name input, no tree. Keeps the item in its
 *  current folder and disk, just under a new name (a same-disk move under the hood). */
function RenameDialog({
  disk,
  target,
  onClose,
  onDone,
  notify,
}: {
  disk: string;
  target: MoveTarget;
  onClose: () => void;
  onDone: (disk: string) => Promise<void>;
  notify: (tone: 'ok' | 'error', text: string) => void;
}): JSX.Element {
  const source = sourceAddress(target);
  const parentDir = parentDirOf(source);
  const [name, setName] = useState(target.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.select();
  }, []);

  const noun = target.type === 'folder' ? 'folder' : 'object';
  const trimmedName = name.trim();
  const destination = keyIn(parentDir, trimmedName);
  const blocked = trimmedName === '' || destination === source;

  async function submit(): Promise<void> {
    if (blocked) return;
    setBusy(true);
    setError(null);
    try {
      if (target.type === 'folder') {
        await mediaConsoleClient.moveFolder(disk, target.prefix, disk, destination);
      } else {
        await mediaConsoleClient.moveObject(disk, target.key, disk, destination);
      }
      await onDone(disk);
      notify('ok', `Renamed ${target.name} to ${trimmedName}`);
      onClose();
    } catch (actionError) {
      setError(describeError(actionError));
      setBusy(false);
    }
  }

  return (
    <Modal
      title={`Rename ${noun}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button tone="emerald" onClick={submit} disabled={busy || blocked}>
            {busy ? 'Renaming…' : 'Rename'}
          </Button>
        </>
      }
    >
      <label className="mono flex flex-col gap-1 text-[10px] uppercase tracking-wider text-zinc-600">
        New name
        <input
          ref={inputRef}
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') submit();
          }}
          className="mono rounded-md border border-[var(--line)] bg-black/30 px-3 py-2 text-sm normal-case tracking-normal text-zinc-100 focus:border-emerald-500/40 focus:outline-none"
        />
      </label>
      <p className="mono mt-2 text-[10px] text-zinc-600">
        To <span className="text-zinc-400">{destination || '—'}</span>
        {target.type === 'folder' ? '/' : ''}
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
  const { toasts, pushToast, dismissToast } = useToasts();

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
      navigateToPreview(disk, prefix, key);
    } catch (error) {
      pushToast('error', `Failed to open "${key}": ${describeError(error)}`);
    } finally {
      setBusyKey(null);
    }
  }

  // Deep-link: when the URL carries `preview=<key>` (and the disk is resolved), open that file's
  // preview panel. Guard against the key already being open so this never loops with the write in
  // `handlePreview`/`navigateToPreview`.
  // biome-ignore lint/correctness/useExhaustiveDependencies: handlePreview + preview are intentionally omitted; keying on route.preview/selectedDisk (with the open-key guard) is what prevents a re-open loop.
  useEffect(() => {
    if (!route.preview || !selectedDisk) return;
    if (preview?.key === route.preview) return;
    const basename = route.preview.split('/').pop() ?? route.preview;
    void handlePreview(selectedDisk, route.preview, basename);
  }, [route.preview, selectedDisk]);

  async function handleCopyKey(key: string): Promise<void> {
    await navigator.clipboard.writeText(key);
  }

  /** Drop a dragged file/folder onto a tree node: move it under that node — on the same disk or across
   *  buckets. No-ops when the drop lands where the item already is. */
  async function handleTreeDrop(
    item: DragItem,
    targetDisk: string,
    targetPrefix: string,
  ): Promise<void> {
    const destination = keyIn(targetPrefix, item.name);
    const sameDisk = item.disk === targetDisk;
    setBusyKey('__move__');
    try {
      if (item.kind === 'file') {
        if (sameDisk && destination === item.key) return;
        await mediaConsoleClient.moveObject(item.disk, item.key, targetDisk, destination);
      } else {
        if (sameDisk && destination === item.prefix.replace(/\/+$/, '')) return;
        await mediaConsoleClient.moveFolder(item.disk, item.prefix, targetDisk, destination);
      }
      await invalidateObjects(item.disk);
      if (!sameDisk) await invalidateObjects(targetDisk);
      pushToast('ok', `Moved ${item.name} to ${targetDisk}/${destination}`);
    } catch (error) {
      pushToast('error', `Move failed: ${describeError(error)}`);
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
      pushToast('ok', `Uploaded ${list.length === 1 ? list[0]?.name : `${list.length} files`}`);
    } catch (error) {
      pushToast('error', `Upload failed: ${describeError(error)}`);
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
      pushToast('ok', `Deleted ${target.name}`);
      setDialog(null);
    } catch (error) {
      pushToast('error', `Failed to delete: ${describeError(error)}`);
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
            explorer
          </h3>
          {disksQuery.isLoading && <Notice>Loading…</Notice>}
          {disksQuery.isError && (
            <p className="px-2 py-1 text-sm s-error">{describeError(disksQuery.error)}</p>
          )}
          {!disksQuery.isLoading && disks.length === 0 && <Notice>No disks configured.</Notice>}
          {/* Mount only once disks resolve, so the tree's initial expand captures the selected disk
              (on first paint `selectedDisk` is still undefined and its root wouldn't auto-open). */}
          {disks.length > 0 && (
            <FolderTree
              disks={disks}
              selectedDisk={selectedDisk}
              currentPrefix={prefix}
              onNavigate={navigateToPrefix}
              onDropMove={actions ? handleTreeDrop : undefined}
            />
          )}
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
                      <tr
                        key={folder.prefix}
                        draggable={actions}
                        onDragStart={
                          actions
                            ? (event) =>
                                startRowDrag(event, {
                                  kind: 'folder',
                                  disk: selectedDisk,
                                  prefix: folder.prefix,
                                  name: folder.name,
                                })
                            : undefined
                        }
                        className={`hover:bg-zinc-900/40 ${actions ? 'cursor-grab' : ''}`}
                      >
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
                            <div className="flex flex-wrap gap-1.5">
                              <GhostButton
                                onClick={() =>
                                  setDialog({
                                    kind: 'copy',
                                    target: {
                                      type: 'folder',
                                      prefix: folder.prefix,
                                      name: folder.name,
                                    },
                                  })
                                }
                              >
                                Copy to…
                              </GhostButton>
                              <GhostButton
                                onClick={() =>
                                  setDialog({
                                    kind: 'move',
                                    target: {
                                      type: 'folder',
                                      prefix: folder.prefix,
                                      name: folder.name,
                                    },
                                  })
                                }
                              >
                                Move to…
                              </GhostButton>
                              <GhostButton
                                onClick={() =>
                                  setDialog({
                                    kind: 'rename',
                                    target: {
                                      type: 'folder',
                                      prefix: folder.prefix,
                                      name: folder.name,
                                    },
                                  })
                                }
                              >
                                Rename
                              </GhostButton>
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
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                    {page.files.map((file) => (
                      <tr
                        key={file.key}
                        draggable={actions}
                        onDragStart={
                          actions
                            ? (event) =>
                                startRowDrag(event, {
                                  kind: 'file',
                                  disk: selectedDisk,
                                  key: file.key,
                                  name: file.name,
                                })
                            : undefined
                        }
                        className={`hover:bg-zinc-900/40 ${actions ? 'cursor-grab' : ''}`}
                      >
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
                                  onClick={() =>
                                    setDialog({
                                      kind: 'copy',
                                      target: { type: 'file', key: file.key, name: file.name },
                                    })
                                  }
                                >
                                  Copy to…
                                </GhostButton>
                                <GhostButton
                                  onClick={() =>
                                    setDialog({
                                      kind: 'move',
                                      target: { type: 'file', key: file.key, name: file.name },
                                    })
                                  }
                                >
                                  Move to…
                                </GhostButton>
                                <GhostButton
                                  onClick={() =>
                                    setDialog({
                                      kind: 'rename',
                                      target: { type: 'file', key: file.key, name: file.name },
                                    })
                                  }
                                >
                                  Rename
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
      {selectedDisk && (dialog?.kind === 'copy' || dialog?.kind === 'move') && (
        <CopyMoveDialog
          kind={dialog.kind}
          disks={disks}
          sourceDisk={selectedDisk}
          target={dialog.target}
          onClose={() => setDialog(null)}
          onDone={invalidateObjects}
          notify={pushToast}
        />
      )}
      {selectedDisk && dialog?.kind === 'rename' && (
        <RenameDialog
          disk={selectedDisk}
          target={dialog.target}
          onClose={() => setDialog(null)}
          onDone={invalidateObjects}
          notify={pushToast}
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

      <Lightbox
        item={preview}
        onClose={() => {
          setPreview(null);
          if (selectedDisk) navigateToPreview(selectedDisk, prefix, null);
        }}
      />
      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </section>
  );
}
