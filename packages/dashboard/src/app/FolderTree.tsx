import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { mediaConsoleClient } from '../client/media-console-client.js';
import type { DiskInfo, ObjectFolder } from '../client/types.js';
import { Dot } from './ui.js';

/**
 * A lazy, collapsible file-structure tree for the disk browser's left rail. Each disk (bucket) is a
 * root; expanding a node fetches only that level's sub-folders (via the same `objects` query the main
 * pane uses, so the cache is shared). Clicking any node navigates the main pane to it. The node
 * matching the current location is highlighted. Files are not shown here — the tree is folders only,
 * the right pane lists the selected folder's files.
 *
 * When `onDropMove` is supplied, every node is also a drop target: dragging a file/folder row from
 * the main pane onto a node moves it there (see {@link DragItem}).
 */

const INDENT_PER_DEPTH = 12;

/** The drag payload a file/folder row hands to a tree drop target. Same-disk only — the drop handler
 *  rejects a target on a different disk. */
export const DRAG_MIME = 'application/x-media-console-item';

export type DragItem =
  | { kind: 'file'; disk: string; key: string; name: string }
  | { kind: 'folder'; disk: string; prefix: string; name: string };

/** Parse a {@link DragItem} out of a drop's DataTransfer, or null if it isn't one of ours. */
export function readDragItem(dataTransfer: DataTransfer): DragItem | null {
  const raw = dataTransfer.getData(DRAG_MIME);
  if (!raw) return null;
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== 'object' || parsed === null) return null;
  const item = parsed as Partial<DragItem>;
  if (typeof item.disk !== 'string' || typeof item.name !== 'string') return null;
  if (item.kind === 'file' && typeof item.key === 'string') return item as DragItem;
  if (item.kind === 'folder' && typeof item.prefix === 'string') return item as DragItem;
  return null;
}

/** A stable id for a node's expanded/collapsed state: disk + folder prefix. */
function nodeId(disk: string, prefix: string): string {
  return `${disk}\n${prefix}`;
}

/** Folder prefixes carry a trailing slash (S3 CommonPrefixes); the root is the empty prefix. Both the
 *  main pane and this tree treat "" / undefined as the disk root, so normalize for comparison. */
function samePrefix(a: string, b: string | undefined): boolean {
  return a === (b ?? '');
}

interface TreeContext {
  selectedDisk: string | undefined;
  currentPrefix: string | undefined;
  expanded: Set<string>;
  toggle: (id: string) => void;
  onNavigate: (disk: string, prefix: string) => void;
  onDropMove?: ((item: DragItem, targetDisk: string, targetPrefix: string) => void) | undefined;
  dropTarget: string | null;
  setDropTarget: (id: string | null) => void;
}

/** The chevron + label row shared by disk roots and folders. Also the drop target when the tree is in
 *  drag-and-drop mode: `dropProps` (supplied by the parent when `onDropMove` is set) wire the row's
 *  drag-over highlight and drop handler. */
function TreeRow({
  depth,
  expanded,
  active,
  onToggle,
  onOpen,
  icon,
  label,
  trailing,
  dropProps,
}: {
  depth: number;
  expanded: boolean;
  active: boolean;
  onToggle: () => void;
  onOpen: () => void;
  icon: string;
  label: string;
  trailing?: JSX.Element;
  dropProps?:
    | {
        isTarget: boolean;
        onDragOver: (event: React.DragEvent) => void;
        onDragLeave: () => void;
        onDrop: (event: React.DragEvent) => void;
      }
    | undefined;
}): JSX.Element {
  return (
    <div
      onDragOver={dropProps?.onDragOver}
      onDragLeave={dropProps?.onDragLeave}
      onDrop={dropProps?.onDrop}
      className={`mono group flex items-center gap-1 rounded-md border pr-1.5 text-xs transition-colors ${
        dropProps?.isTarget
          ? 'border-emerald-500/60 bg-emerald-500/10 text-emerald-200'
          : active
            ? 'border-[var(--line)] bg-zinc-900 text-zinc-100'
            : 'border-transparent text-zinc-400 hover:bg-zinc-900/50 hover:text-zinc-200'
      }`}
      style={{ paddingLeft: depth * INDENT_PER_DEPTH }}
    >
      <button
        type="button"
        aria-label={expanded ? 'Collapse' : 'Expand'}
        onClick={onToggle}
        className="shrink-0 px-1 py-1 text-zinc-600 transition-colors hover:text-zinc-300"
      >
        <span className={`inline-block transition-transform ${expanded ? 'rotate-90' : ''}`}>
          ▸
        </span>
      </button>
      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-center gap-1.5 py-1.5 text-left"
      >
        <span className="shrink-0 text-zinc-600">{icon}</span>
        <span className="truncate">{label}</span>
      </button>
      {trailing}
    </div>
  );
}

/** Builds the drop handlers for a node at `(disk, prefix)`, or undefined when the tree isn't in
 *  drag-and-drop mode. Not a hook — pure, safe to call inline. */
function dropPropsFor(
  context: TreeContext,
  id: string,
  disk: string,
  prefix: string,
): Parameters<typeof TreeRow>[0]['dropProps'] {
  const { onDropMove } = context;
  if (!onDropMove) return undefined;
  return {
    isTarget: context.dropTarget === id,
    onDragOver: (event) => {
      event.preventDefault();
      context.setDropTarget(id);
    },
    onDragLeave: () => {
      if (context.dropTarget === id) context.setDropTarget(null);
    },
    onDrop: (event) => {
      event.preventDefault();
      context.setDropTarget(null);
      const item = readDragItem(event.dataTransfer);
      if (item) onDropMove(item, disk, prefix);
    },
  };
}

/** The sub-folders of `(disk, prefix)`, fetched only when this level is rendered (i.e. its parent is
 *  expanded). Shares the `objects` query key with the main pane. */
function FolderChildren({
  disk,
  prefix,
  depth,
  context,
  ancestorIds,
}: {
  disk: string;
  prefix: string;
  depth: number;
  context: TreeContext;
  /** Node ids of this level and every ancestor — a child repeating one is a cycle and is dropped, so
   *  a self-referential listing (e.g. a stray leading-slash prefix that resolves back to root) can't
   *  infinite-loop the tree. */
  ancestorIds: ReadonlySet<string>;
}): JSX.Element {
  const prefixParam = prefix === '' ? undefined : prefix;
  const query = useQuery({
    queryKey: ['objects', disk, prefixParam, undefined],
    queryFn: () => mediaConsoleClient.objects(disk, prefixParam ? { prefix: prefixParam } : {}),
  });

  if (query.isLoading) {
    return (
      <p
        className="mono py-1 text-[10px] text-zinc-600"
        style={{ paddingLeft: depth * INDENT_PER_DEPTH + 24 }}
      >
        Loading…
      </p>
    );
  }
  if (query.isError) {
    return (
      <p
        className="mono py-1 text-[10px] s-error"
        style={{ paddingLeft: depth * INDENT_PER_DEPTH + 24 }}
      >
        Failed to load
      </p>
    );
  }
  // Drop any child that repeats an ancestor's id — a self-referential listing would otherwise recurse
  // forever (the row renders expanded because its id is already in the expanded set → lists itself → …).
  const folders = (query.data?.folders ?? []).filter(
    (folder) => !ancestorIds.has(nodeId(disk, folder.prefix)),
  );
  if (folders.length === 0) {
    return (
      <p
        className="mono py-1 text-[10px] text-zinc-700"
        style={{ paddingLeft: depth * INDENT_PER_DEPTH + 24 }}
      >
        No sub-folders
      </p>
    );
  }
  return (
    <ul className="space-y-0.5">
      {folders.map((folder) => (
        <TreeFolder
          key={folder.prefix}
          disk={disk}
          folder={folder}
          depth={depth}
          context={context}
          ancestorIds={ancestorIds}
        />
      ))}
    </ul>
  );
}

/** One folder node: a row plus, when expanded, its own children one level deeper. */
function TreeFolder({
  disk,
  folder,
  depth,
  context,
  ancestorIds,
}: {
  disk: string;
  folder: ObjectFolder;
  depth: number;
  context: TreeContext;
  ancestorIds: ReadonlySet<string>;
}): JSX.Element {
  const id = nodeId(disk, folder.prefix);
  const expanded = context.expanded.has(id);
  const active = context.selectedDisk === disk && samePrefix(folder.prefix, context.currentPrefix);
  return (
    <li>
      <TreeRow
        depth={depth}
        expanded={expanded}
        active={active}
        onToggle={() => context.toggle(id)}
        onOpen={() => {
          context.onNavigate(disk, folder.prefix);
          if (!expanded) context.toggle(id);
        }}
        icon={expanded ? '▾' : '▸'}
        label={folder.name}
        dropProps={dropPropsFor(context, id, disk, folder.prefix)}
      />
      {expanded && (
        <FolderChildren
          disk={disk}
          prefix={folder.prefix}
          depth={depth + 1}
          context={context}
          ancestorIds={new Set([...ancestorIds, id])}
        />
      )}
    </li>
  );
}

/** A disk (bucket) root: expandable when listing is supported, with its top-level folders beneath. */
function DiskRoot({ disk, context }: { disk: DiskInfo; context: TreeContext }): JSX.Element {
  const id = nodeId(disk.name, '');
  const expanded = context.expanded.has(id);
  const active = context.selectedDisk === disk.name && samePrefix('', context.currentPrefix);
  const canList = disk.capabilities.list;
  return (
    <li>
      <TreeRow
        depth={0}
        expanded={expanded}
        active={active}
        onToggle={() => canList && context.toggle(id)}
        onOpen={() => {
          context.onNavigate(disk.name, '');
          if (canList && !expanded) context.toggle(id);
        }}
        icon="🪣"
        label={disk.name}
        dropProps={dropPropsFor(context, id, disk.name, '')}
        trailing={
          <span className="flex shrink-0 items-center gap-1.5">
            {disk.default && (
              <span className="text-[9px] uppercase tracking-wider text-zinc-600">default</span>
            )}
            {!canList && (
              <span title="Listing unsupported on this disk">
                <Dot tone="warn" />
              </span>
            )}
          </span>
        }
      />
      {expanded && canList && (
        <FolderChildren
          disk={disk.name}
          prefix=""
          depth={1}
          context={context}
          ancestorIds={new Set([id])}
        />
      )}
    </li>
  );
}

export function FolderTree({
  disks,
  selectedDisk,
  currentPrefix,
  onNavigate,
  onDropMove,
}: {
  disks: DiskInfo[];
  selectedDisk: string | undefined;
  currentPrefix: string | undefined;
  onNavigate: (disk: string, prefix: string) => void;
  onDropMove?: ((item: DragItem, targetDisk: string, targetPrefix: string) => void) | undefined;
}): JSX.Element {
  // Open the selected disk's root by default so its top folders are visible without a click.
  const [expanded, setExpanded] = useState<Set<string>>(() =>
    selectedDisk ? new Set([nodeId(selectedDisk, '')]) : new Set(),
  );
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  function toggle(id: string): void {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  const context: TreeContext = {
    selectedDisk,
    currentPrefix,
    expanded,
    toggle,
    onNavigate,
    onDropMove,
    dropTarget,
    setDropTarget,
  };
  return (
    <ul className="space-y-0.5">
      {disks.map((disk) => (
        <DiskRoot key={disk.name} disk={disk} context={context} />
      ))}
    </ul>
  );
}
