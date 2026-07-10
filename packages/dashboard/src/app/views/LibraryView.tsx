import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { mediaConsoleClient } from '../../client/media-console-client.js';
import type { CollectionInfo, LibraryRecord } from '../../client/types.js';
import { GhostButton, Notice, Panel, formatBytes, formatDate } from '../ui.js';
import type { Route } from '../useHashRoute.js';

function libraryHash(collection: string | undefined): string {
  return collection === undefined
    ? '#/library'
    : `#/library?collection=${encodeURIComponent(collection)}`;
}

function isImage(mimeType: string): boolean {
  return mimeType.startsWith('image/');
}

function CollectionsBar({
  collections,
  selected,
}: {
  collections: ReadonlyArray<CollectionInfo>;
  selected: string | undefined;
}): JSX.Element {
  const chipClass = (active: boolean): string =>
    `mono flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition-colors ${
      active
        ? 'border-zinc-600 bg-zinc-900 text-zinc-100'
        : 'border-transparent text-zinc-500 hover:text-zinc-300'
    }`;

  return (
    <div className="mb-4 flex flex-wrap gap-1">
      <a href={libraryHash(undefined)} className={chipClass(selected === undefined)}>
        all
      </a>
      {collections.map((collection) => (
        <a
          key={collection.key}
          href={libraryHash(collection.key)}
          className={chipClass(selected === collection.key)}
        >
          {collection.key}
          <span className="tnum text-zinc-600">
            {collection.count} · {formatBytes(collection.sumSize)}
          </span>
        </a>
      ))}
    </div>
  );
}

function RecordGrid({
  records,
  collection,
}: {
  records: ReadonlyArray<LibraryRecord>;
  collection: string | undefined;
}): JSX.Element {
  if (records.length === 0) {
    return <Notice>No records{collection ? ` in "${collection}"` : ''}.</Notice>;
  }
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {records.map((record) => (
        <a
          key={record.id}
          href={`#/library/${encodeURIComponent(record.id)}${
            collection ? `?collection=${encodeURIComponent(collection)}` : ''
          }`}
          className="rounded-lg border border-[var(--line)] bg-[var(--panel)] p-3 text-sm transition-colors hover:border-zinc-600"
        >
          <div className="truncate font-medium text-zinc-200">{record.fileName}</div>
          <div className="mono mt-1 text-[10px] text-zinc-500">{record.mimeType}</div>
          <div className="mono tnum mt-2 flex justify-between text-[10px] text-zinc-600">
            <span>{formatBytes(record.size)}</span>
            <span>{formatDate(record.createdAt)}</span>
          </div>
        </a>
      ))}
    </div>
  );
}

function DetailRow({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <>
      <dt className="mono text-[10px] uppercase tracking-wider text-zinc-600">{label}</dt>
      <dd className="truncate text-zinc-200">{children}</dd>
    </>
  );
}

function RecordDetail({ route }: { route: Route }): JSX.Element {
  const queryClient = useQueryClient();
  const [deleteError, setDeleteError] = useState<string | undefined>(undefined);
  const recordId = route.recordId;

  const detailQuery = useQuery({
    queryKey: ['libraryRecord', recordId ?? null],
    queryFn: () => {
      if (recordId === undefined) return Promise.reject(new Error('missing record id'));
      return mediaConsoleClient.libraryRecord(recordId);
    },
    enabled: recordId !== undefined,
  });

  async function handleDelete(): Promise<void> {
    if (recordId === undefined) return;
    setDeleteError(undefined);
    try {
      await mediaConsoleClient.deleteLibraryRecord(recordId);
      await queryClient.invalidateQueries({ queryKey: ['library'] });
      await queryClient.invalidateQueries({ queryKey: ['collections'] });
      window.location.hash = libraryHash(route.collection);
    } catch {
      setDeleteError('Delete failed (actions may be disabled)');
    }
  }

  const detail = detailQuery.data;

  return (
    <div>
      <a
        href={libraryHash(route.collection)}
        className="mono text-xs text-zinc-500 hover:text-zinc-300"
      >
        ← back to library
      </a>
      {detailQuery.isLoading && <Notice>Loading record…</Notice>}
      {detailQuery.isError && <p className="mt-3 text-sm s-error">Failed to load record.</p>}
      {detail && (
        <div className="mt-3">
          <Panel className="p-4">
            <h3 className="font-semibold text-zinc-100">{detail.record.fileName}</h3>
            <dl className="mt-3 grid grid-cols-[110px_1fr] gap-x-4 gap-y-2 text-xs">
              <DetailRow label="Collection">{detail.record.collection}</DetailRow>
              <DetailRow label="Mime type">
                <span className="mono">{detail.record.mimeType}</span>
              </DetailRow>
              <DetailRow label="Size">{formatBytes(detail.record.size)}</DetailRow>
              <DetailRow label="Disk">
                <span className="mono">{detail.record.disk}</span>
              </DetailRow>
              <DetailRow label="Path">
                <span className="mono">{detail.record.path}</span>
              </DetailRow>
              <DetailRow label="Owner">
                {detail.record.ownerType} · {detail.record.ownerId}
              </DetailRow>
              <DetailRow label="Created">{formatDate(detail.record.createdAt)}</DetailRow>
            </dl>
            <div className="mt-4">
              <GhostButton tone="rose" onClick={handleDelete}>
                Delete
              </GhostButton>
              {deleteError && <p className="mt-2 text-xs s-error">{deleteError}</p>}
            </div>
          </Panel>

          <h4 className="mono mb-2 mt-4 text-[10px] uppercase tracking-wider text-zinc-600">
            variants
          </h4>
          {detail.variants.length === 0 ? (
            <Notice>No variants.</Notice>
          ) : (
            <div className="flex flex-wrap gap-3">
              {detail.variants.map((variant) => (
                <div
                  key={variant.name}
                  className="rounded-lg border border-[var(--line)] bg-[var(--panel)] p-2 text-xs"
                >
                  <div className="mono mb-1.5 text-[10px] uppercase tracking-wider text-zinc-500">
                    {variant.name}
                  </div>
                  {isImage(detail.record.mimeType) ? (
                    <img
                      src={variant.url}
                      alt={variant.name}
                      className="max-h-40 rounded border border-[var(--line)]"
                    />
                  ) : (
                    <a
                      href={variant.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-emerald-300 hover:text-emerald-200"
                    >
                      Open ↗
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function buildLibraryParams(
  collection: string | undefined,
  cursor: string | undefined,
): { collection?: string; cursor?: string } {
  const params: { collection?: string; cursor?: string } = {};
  if (collection !== undefined) params.collection = collection;
  if (cursor !== undefined) params.cursor = cursor;
  return params;
}

function LibraryGrid({ route, hasStore }: { route: Route; hasStore: boolean }): JSX.Element {
  const collectionsQuery = useQuery({
    queryKey: ['collections'],
    queryFn: () => mediaConsoleClient.collections(),
    enabled: hasStore,
  });

  const libraryQuery = useInfiniteQuery({
    queryKey: ['library', route.collection ?? null],
    queryFn: ({ pageParam }: { pageParam: string }) =>
      mediaConsoleClient.library(buildLibraryParams(route.collection, pageParam)),
    initialPageParam: '',
    getNextPageParam: (lastPage) => lastPage.cursor,
    enabled: hasStore,
  });

  const records: ReadonlyArray<LibraryRecord> = libraryQuery.data
    ? libraryQuery.data.pages.flatMap((page) => page.records)
    : [];

  return (
    <div>
      <CollectionsBar
        collections={collectionsQuery.data?.collections ?? []}
        selected={route.collection}
      />
      {libraryQuery.isLoading && <Notice>Loading library…</Notice>}
      {libraryQuery.isError && <p className="text-sm s-error">Failed to load library.</p>}
      <RecordGrid records={records} collection={route.collection} />
      {libraryQuery.hasNextPage && (
        <div className="mt-4">
          <GhostButton
            onClick={() => libraryQuery.fetchNextPage()}
            disabled={libraryQuery.isFetchingNextPage}
          >
            {libraryQuery.isFetchingNextPage ? 'Loading…' : 'Load more'}
          </GhostButton>
        </div>
      )}
    </div>
  );
}

export function LibraryView({ route, hasStore }: { route: Route; hasStore: boolean }): JSX.Element {
  if (!hasStore) {
    return (
      <section className="rise">
        <div className="grid place-items-center py-16 text-center">
          <div className="max-w-sm">
            <div className="mono mb-2 text-[10px] uppercase tracking-[0.2em] text-zinc-600">
              library
            </div>
            <p className="text-sm text-zinc-500">
              No media store configured. Bind a{' '}
              <code className="mono text-zinc-300">MediaStore</code> to browse collections and their
              variants here.
            </p>
          </div>
        </div>
      </section>
    );
  }
  return (
    <section className="rise">
      {route.recordId ? (
        <RecordDetail route={route} />
      ) : (
        <LibraryGrid route={route} hasStore={hasStore} />
      )}
    </section>
  );
}
