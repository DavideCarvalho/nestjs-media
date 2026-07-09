import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { mediaConsoleClient } from '../../client/media-console-client.js';
import type { CollectionInfo, LibraryRecord } from '../../client/types.js';
import type { Route } from '../useHashRoute.js';

const BYTE_UNITS: ReadonlyArray<string> = ['B', 'KB', 'MB', 'GB', 'TB'];

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), BYTE_UNITS.length - 1);
  const value = bytes / 1024 ** exponent;
  const unit = BYTE_UNITS[exponent] ?? 'B';
  return exponent === 0 ? `${value} ${unit}` : `${value.toFixed(1)} ${unit}`;
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

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
    `rounded-full px-3 py-1 text-xs font-medium ${
      active ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
    }`;

  return (
    <div className="mb-4 flex flex-wrap gap-2">
      <a href={libraryHash(undefined)} className={chipClass(selected === undefined)}>
        All
      </a>
      {collections.map((collection) => (
        <a
          key={collection.key}
          href={libraryHash(collection.key)}
          className={chipClass(selected === collection.key)}
        >
          {collection.key} · {collection.count} · {formatBytes(collection.sumSize)}
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
    return (
      <p className="text-sm text-slate-500">No records{collection ? ` in "${collection}"` : ''}.</p>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {records.map((record) => (
        <a
          key={record.id}
          href={`#/library/${encodeURIComponent(record.id)}${
            collection ? `?collection=${encodeURIComponent(collection)}` : ''
          }`}
          className="rounded border border-slate-200 bg-white p-3 text-sm hover:border-slate-300"
        >
          <div className="truncate font-medium">{record.fileName}</div>
          <div className="mt-1 text-xs text-slate-500">{record.mimeType}</div>
          <div className="mt-1 flex justify-between text-xs text-slate-500">
            <span>{formatBytes(record.size)}</span>
            <span>{formatDate(record.createdAt)}</span>
          </div>
        </a>
      ))}
    </div>
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
      <a href={libraryHash(route.collection)} className="text-sm text-slate-600 hover:underline">
        ← Back to library
      </a>
      {detailQuery.isLoading && <p className="mt-3 text-sm text-slate-500">Loading record…</p>}
      {detailQuery.isError && <p className="mt-3 text-sm text-red-600">Failed to load record.</p>}
      {detail && (
        <div className="mt-3">
          <div className="rounded border border-slate-200 bg-white p-4 text-sm">
            <h3 className="font-semibold">{detail.record.fileName}</h3>
            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-600">
              <dt className="text-slate-400">Collection</dt>
              <dd>{detail.record.collection}</dd>
              <dt className="text-slate-400">Mime type</dt>
              <dd>{detail.record.mimeType}</dd>
              <dt className="text-slate-400">Size</dt>
              <dd>{formatBytes(detail.record.size)}</dd>
              <dt className="text-slate-400">Disk</dt>
              <dd>{detail.record.disk}</dd>
              <dt className="text-slate-400">Path</dt>
              <dd className="truncate">{detail.record.path}</dd>
              <dt className="text-slate-400">Owner</dt>
              <dd>
                {detail.record.ownerType} · {detail.record.ownerId}
              </dd>
              <dt className="text-slate-400">Created</dt>
              <dd>{formatDate(detail.record.createdAt)}</dd>
            </dl>
            <button
              type="button"
              onClick={handleDelete}
              className="mt-4 rounded border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50"
            >
              Delete
            </button>
            {deleteError && <p className="mt-2 text-xs text-red-600">{deleteError}</p>}
          </div>
          <div className="mt-4">
            <h4 className="mb-2 text-sm font-semibold">Variants</h4>
            {detail.variants.length === 0 ? (
              <p className="text-sm text-slate-500">No variants.</p>
            ) : (
              <div className="flex flex-wrap gap-3">
                {detail.variants.map((variant) => (
                  <div
                    key={variant.name}
                    className="rounded border border-slate-200 bg-white p-2 text-xs"
                  >
                    <div className="mb-1 font-medium text-slate-600">{variant.name}</div>
                    {isImage(detail.record.mimeType) ? (
                      <img
                        src={variant.url}
                        alt={variant.name}
                        className="max-h-40 rounded border"
                      />
                    ) : (
                      <a
                        href={variant.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-slate-600 hover:underline"
                      >
                        Open
                      </a>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
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
      {libraryQuery.isLoading && <p className="text-sm text-slate-500">Loading library…</p>}
      {libraryQuery.isError && <p className="text-sm text-red-600">Failed to load library.</p>}
      <RecordGrid records={records} collection={route.collection} />
      {libraryQuery.hasNextPage && (
        <button
          type="button"
          onClick={() => libraryQuery.fetchNextPage()}
          disabled={libraryQuery.isFetchingNextPage}
          className="mt-4 rounded border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50"
        >
          {libraryQuery.isFetchingNextPage ? 'Loading…' : 'Load more'}
        </button>
      )}
    </div>
  );
}

export function LibraryView({ route, hasStore }: { route: Route; hasStore: boolean }): JSX.Element {
  if (!hasStore) {
    return (
      <section>
        <h2 className="mb-2 text-base font-semibold">Library</h2>
        <p className="text-sm text-slate-500">
          No media store configured. Configure a <code>MediaStore</code> to browse the library.
        </p>
      </section>
    );
  }
  return (
    <section>
      <h2 className="mb-2 text-base font-semibold">Library</h2>
      {route.recordId ? (
        <RecordDetail route={route} />
      ) : (
        <LibraryGrid route={route} hasStore={hasStore} />
      )}
    </section>
  );
}
