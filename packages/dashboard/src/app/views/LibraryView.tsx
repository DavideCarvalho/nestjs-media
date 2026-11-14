import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { type JSX, type ReactNode, useState } from 'react';
import { EmptyState } from '../../aviary-kit/blocks/empty-state';
import { PageHeader, Toolbar } from '../../aviary-kit/blocks/page-header';
import { LoadMore } from '../../aviary-kit/blocks/pager';
import { QueryBoundary } from '../../aviary-kit/blocks/query-boundary';
import { PageBody } from '../../aviary-kit/shell/app-shell';
import { Skeleton } from '../../aviary-kit/ui/skeleton';
import { mediaConsoleClient } from '../../client/media-console-client.js';
import type { CollectionInfo, LibraryRecord } from '../../client/types.js';
import { ImageIcon } from '../icons.js';
import { Button, Notice, Panel, formatBytes, formatDate } from '../ui.js';
import type { Route } from '../useHashRoute.js';

function libraryHash(collection: string | undefined): string {
  return collection === undefined
    ? '#/library'
    : `#/library?collection=${encodeURIComponent(collection)}`;
}

function isImage(mimeType: string): boolean {
  return mimeType.startsWith('image/');
}

/** The file name inside a storage path — what a variant is called once saved. */
function lastSegment(path: string): string {
  return path.split('/').pop() || path;
}

function CollectionsBar({
  collections,
  selected,
}: {
  collections: ReadonlyArray<CollectionInfo>;
  selected: string | undefined;
}): JSX.Element {
  const chipTone = (active: boolean) => (active ? ('selected' as const) : ('quiet' as const));

  return (
    <Toolbar label="Collections">
      <Button
        tone={chipTone(selected === undefined)}
        className="px-2.5 py-1 text-xs"
        render={<a href={libraryHash(undefined)}>all</a>}
      />
      {collections.map((collection) => (
        <Button
          key={collection.key}
          tone={chipTone(selected === collection.key)}
          className="px-2.5 py-1 text-xs"
          render={
            <a href={libraryHash(collection.key)}>
              {collection.key}
              <span className="tnum text-faint">
                {collection.count} · {formatBytes(collection.sumSize)}
              </span>
            </a>
          }
        />
      ))}
    </Toolbar>
  );
}

/** Card placeholders shaped like the record grid. */
export function RecordGridSkeleton(): JSX.Element {
  return (
    <div
      className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
      aria-hidden
    >
      {Array.from({ length: 8 }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static placeholder cards, never reordered
        <div key={i} className="aviary-surface rounded-lg border border-border p-3">
          <Skeleton className="h-3.5 w-3/4" />
          <Skeleton className="mt-2 h-2.5 w-1/3" />
          <div className="mt-4 flex justify-between">
            <Skeleton className="h-2.5 w-12" />
            <Skeleton className="h-2.5 w-20" />
          </div>
        </div>
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
      <EmptyState
        icon={<ImageIcon />}
        title={collection ? `No records in "${collection}"` : 'No records yet'}
        description="Records appear here once your app attaches media to its models."
      />
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
          className="aviary-surface aviary-rise rounded-lg border border-border p-3 text-sm transition-colors hover:border-line-strong hover:bg-hover"
        >
          <div className="truncate font-medium text-fg">{record.fileName}</div>
          <div className="mono mt-1 text-[10px] text-dim">{record.mimeType}</div>
          {record.tenant != null && (
            <div className="mt-1 truncate text-[11px] text-dim">{record.tenant.label}</div>
          )}
          <div className="mono tnum mt-2 flex justify-between text-[10px] text-faint">
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
      <dt className="mono text-[10px] uppercase tracking-wider text-faint">{label}</dt>
      <dd className="truncate text-fg">{children}</dd>
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
      <a href={libraryHash(route.collection)} className="mono text-xs text-dim hover:text-fg">
        ← back to library
      </a>
      {detailQuery.isLoading && (
        <div className="aviary-surface mt-3 rounded-lg border border-border p-4" aria-hidden>
          <Skeleton className="h-4 w-1/3" />
          {Array.from({ length: 6 }, (_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: static placeholder rows
            <Skeleton key={i} className="mt-3 h-3 w-1/2" />
          ))}
        </div>
      )}
      {detailQuery.isError && <p className="mt-3 text-sm s-error">Failed to load record.</p>}
      {detail && (
        <div className="mt-3">
          <Panel className="p-4">
            <h3 className="font-semibold text-fg">{detail.record.fileName}</h3>
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
              {detail.record.tenant !== undefined && (
                <DetailRow label="Organization">
                  {detail.record.tenant === null ? '—' : detail.record.tenant.label}
                </DetailRow>
              )}
              <DetailRow label="Created">{formatDate(detail.record.createdAt)}</DetailRow>
            </dl>
            <div className="mt-4 flex flex-wrap gap-1.5">
              <Button
                // The record's original IS a disk object, so it saves through the same object route
                // every file in the Disks view uses — the library needs no download path of its own.
                render={
                  // biome-ignore lint/a11y/useAnchorContent: Base UI's `render` prop clones this element with the Button's children; the link is not empty at runtime
                  <a
                    href={mediaConsoleClient.objectDownloadUrl(
                      detail.record.disk,
                      detail.record.path,
                    )}
                    download={detail.record.fileName}
                  />
                }
              >
                Download
              </Button>
              <Button tone="destructive" onClick={handleDelete}>
                Delete
              </Button>
            </div>
            {deleteError && <p className="mt-2 text-xs s-error">{deleteError}</p>}
          </Panel>

          <h4 className="mono mb-2 mt-4 text-[10px] uppercase tracking-wider text-faint">
            variants
          </h4>
          {detail.variants.length === 0 ? (
            <Notice>No variants.</Notice>
          ) : (
            <div className="flex flex-wrap gap-3">
              {detail.variants.map((variant) => (
                <div
                  key={variant.name}
                  className="rounded-lg border border-border bg-panel p-2 text-xs"
                >
                  <div className="mono mb-1.5 text-[10px] uppercase tracking-wider text-dim">
                    {variant.name}
                  </div>
                  {isImage(detail.record.mimeType) && (
                    <img
                      src={variant.url}
                      alt={variant.name}
                      className="mb-1.5 max-h-40 rounded border border-border"
                    />
                  )}
                  <div className="flex items-center gap-2">
                    {variant.disk !== '' && (
                      <a
                        href={mediaConsoleClient.objectDownloadUrl(variant.disk, variant.path)}
                        download={lastSegment(variant.path)}
                        className="text-brand hover:text-brand"
                      >
                        Download
                      </a>
                    )}
                    <a
                      href={variant.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-brand hover:text-brand"
                    >
                      Open ↗
                    </a>
                  </div>
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
    <>
      <CollectionsBar
        collections={collectionsQuery.data?.collections ?? []}
        selected={route.collection}
      />
      <QueryBoundary
        label="Library"
        query={{
          data: libraryQuery.data ? records : undefined,
          error: libraryQuery.error,
          isPending: libraryQuery.isPending,
          refetch: libraryQuery.refetch,
        }}
        skeleton={<RecordGridSkeleton />}
      >
        {(rows) => <RecordGrid records={rows} collection={route.collection} />}
      </QueryBoundary>
      <LoadMore
        hasNext={libraryQuery.hasNextPage}
        loading={libraryQuery.isFetchingNextPage}
        onLoadMore={() => void libraryQuery.fetchNextPage()}
      />
    </>
  );
}

export function LibraryView({
  route,
  hasStore,
  topologyPending = false,
}: {
  route: Route;
  hasStore: boolean;
  /** The topology is still loading: show the page's skeleton, not the "no store" state. */
  topologyPending?: boolean;
}): JSX.Element {
  return (
    <PageBody>
      {!route.recordId && (
        <PageHeader
          title="Library"
          description="Media records your app attached to its models, with their variants."
        />
      )}
      {topologyPending ? (
        <RecordGridSkeleton />
      ) : !hasStore ? (
        <NoStore />
      ) : route.recordId ? (
        <RecordDetail route={route} />
      ) : (
        <LibraryGrid route={route} hasStore={hasStore} />
      )}
    </PageBody>
  );
}

/** The library and the collections both need a `MediaStore`; this is what they show without one. */
export function NoStore(): JSX.Element {
  return (
    <EmptyState
      icon={<ImageIcon />}
      title="No media store configured"
      description={
        <>
          Bind a <code className="mono text-fg-2">MediaStore</code> to browse collections and their
          variants here.
        </>
      }
    />
  );
}
