import { useQuery } from '@tanstack/react-query';
import type { JSX } from 'react';
import { type Column, DataTable } from '../../aviary-kit/blocks/data-table';
import { EmptyState } from '../../aviary-kit/blocks/empty-state';
import { MetricCard, MetricGrid, MetricGridSkeleton } from '../../aviary-kit/blocks/metric-card';
import { PageHeader } from '../../aviary-kit/blocks/page-header';
import { Panel } from '../../aviary-kit/blocks/panel';
import { QueryBoundary } from '../../aviary-kit/blocks/query-boundary';
import { PageBody } from '../../aviary-kit/shell/app-shell';
import { mediaConsoleClient } from '../../client/media-console-client.js';
import type { CollectionInfo } from '../../client/types.js';
import { LayersIcon } from '../icons.js';
import { formatBytes } from '../ui.js';
import { NoStore } from './LibraryView.js';

function openCollection(key: string): void {
  window.location.hash = `#/library?collection=${encodeURIComponent(key)}`;
}

const COLUMNS: Column<CollectionInfo>[] = [
  {
    id: 'key',
    header: 'Collection',
    cell: (row) => (
      <a
        href={`#/library?collection=${encodeURIComponent(row.key)}`}
        className="mono text-fg hover:text-brand"
        onClick={(event) => event.stopPropagation()}
      >
        {row.key}
      </a>
    ),
  },
  {
    id: 'count',
    header: 'Records',
    align: 'right',
    cell: (row) => <span className="mono tnum">{row.count.toLocaleString()}</span>,
  },
  {
    id: 'size',
    header: 'Size',
    align: 'right',
    cell: (row) => <span className="mono tnum">{formatBytes(row.sumSize)}</span>,
  },
  {
    id: 'average',
    header: 'Avg. record',
    align: 'right',
    hideBelow: 'sm',
    cell: (row) => (
      <span className="mono tnum text-faint">
        {row.count > 0 ? formatBytes(Math.round(row.sumSize / row.count)) : '—'}
      </span>
    ),
  },
];

/** Presentational: the collections' totals and their table. */
export function CollectionsTable({
  collections,
}: {
  collections: ReadonlyArray<CollectionInfo> | undefined;
}): JSX.Element {
  const rows = collections ? [...collections] : undefined;
  const records = rows?.reduce((sum, row) => sum + row.count, 0) ?? 0;
  const bytes = rows?.reduce((sum, row) => sum + row.sumSize, 0) ?? 0;
  return (
    <>
      {rows ? (
        <MetricGrid>
          <MetricCard label="Collections" value={rows.length} tone="brand" />
          <MetricCard label="Records" value={records.toLocaleString()} />
          <MetricCard label="Stored" value={formatBytes(bytes)} caption="originals, all disks" />
        </MetricGrid>
      ) : (
        <MetricGridSkeleton count={3} />
      )}
      <Panel title="Collections" description="click one to open it in the library" flush>
        <DataTable
          label="Collections"
          columns={COLUMNS}
          rows={rows}
          rowKey={(row) => row.key}
          onRowClick={(row) => openCollection(row.key)}
          loading={!rows}
          empty={
            <EmptyState
              icon={<LayersIcon />}
              title="No collections yet"
              description="A collection appears once a record is saved into it."
            />
          }
        />
      </Panel>
    </>
  );
}

/** Container: the Collections page (LIBRARY section). */
export function CollectionsView({
  hasStore,
  topologyPending = false,
}: {
  hasStore: boolean;
  topologyPending?: boolean;
}): JSX.Element {
  const collectionsQuery = useQuery({
    queryKey: ['collections'],
    queryFn: () => mediaConsoleClient.collections(),
    enabled: hasStore,
  });
  return (
    <PageBody>
      <PageHeader
        title="Collections"
        description="Every media collection in the store, with its record count and size."
      />
      {topologyPending ? (
        <CollectionsTable collections={undefined} />
      ) : !hasStore ? (
        <NoStore />
      ) : (
        <QueryBoundary
          label="Collections"
          query={collectionsQuery}
          skeleton={<CollectionsTable collections={undefined} />}
        >
          {(data) => <CollectionsTable collections={data.collections} />}
        </QueryBoundary>
      )}
    </PageBody>
  );
}
