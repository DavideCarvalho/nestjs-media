import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { JSX, ReactNode } from 'react';
import { type Column, DataTable } from '../../aviary-kit/blocks/data-table';
import { EmptyState } from '../../aviary-kit/blocks/empty-state';
import { PageHeader } from '../../aviary-kit/blocks/page-header';
import { Panel as KitPanel } from '../../aviary-kit/blocks/panel';
import { QueryBoundary } from '../../aviary-kit/blocks/query-boundary';
import { PageBody } from '../../aviary-kit/shell/app-shell';
import { Skeleton } from '../../aviary-kit/ui/skeleton';
import { mediaConsoleClient } from '../../client/media-console-client.js';
import type { UploadListResponse } from '../../client/types.js';
import { UploadIcon } from '../icons.js';
import { Button, Dot, Notice, Panel, relativeAge } from '../ui.js';
import type { Route } from '../useHashRoute.js';

type UploadRow = UploadListResponse['uploads'][number];

const UPLOADS_QUERY_KEY = ['uploads'];

function ProgressBar({ percent }: { percent: number | null }): JSX.Element {
  if (percent === null) {
    return <span className="mono text-[10px] whitespace-nowrap text-faint">unknown size</span>;
  }
  const clamped = Math.min(100, Math.max(0, percent));
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-panel-3 sm:w-28">
        <div
          className="h-full rounded-full bg-primary/80 transition-[width]"
          style={{ width: `${clamped}%` }}
        />
      </div>
      <span className="mono tnum text-[10px] text-dim">{clamped}%</span>
    </div>
  );
}

function uploadColumns(tenancy: boolean): Column<UploadRow>[] {
  return [
    {
      id: 'key',
      header: 'Key',
      className: 'max-w-[150px] truncate sm:max-w-xs',
      cell: (upload) => (
        <a
          href={`#/uploads/${encodeURIComponent(upload.id)}`}
          className="mono text-xs text-fg hover:text-brand"
          onClick={(event) => event.stopPropagation()}
        >
          {upload.key}
        </a>
      ),
    },
    {
      id: 'disk',
      header: 'Disk',
      hideBelow: 'sm',
      cell: (upload) => <span className="mono text-xs">{upload.disk}</span>,
    },
    ...(tenancy
      ? [
          {
            id: 'tenant',
            header: 'Organization',
            hideBelow: 'md' as const,
            className: 'max-w-[12rem] truncate',
            cell: (upload: UploadRow) => upload.tenant?.label ?? '—',
          },
        ]
      : []),
    {
      id: 'progress',
      header: 'Progress',
      cell: (upload) => <ProgressBar percent={upload.percent} />,
    },
    {
      id: 'parts',
      header: 'Parts',
      align: 'right',
      hideBelow: 'md',
      cell: (upload) => <span className="mono tnum text-xs">{upload.parts}</span>,
    },
    {
      id: 'age',
      header: 'Age',
      align: 'right',
      hideBelow: 'sm',
      cell: (upload) => <span className="text-xs">{relativeAge(upload.createdAt) ?? '—'}</span>,
    },
  ];
}

/** Presentational: the live resumable sessions. `uploads` undefined = still loading. */
export function UploadsTable({
  uploads,
  actions,
}: {
  uploads: ReadonlyArray<UploadRow> | undefined;
  actions: boolean;
}): JSX.Element {
  // With tenancy on, every session carries `tenant` (null when it has none).
  const tenancy = uploads?.some((upload) => upload.tenant !== undefined) ?? false;
  return (
    <KitPanel
      title="Resumable sessions"
      description={
        <span className="flex items-center gap-2">
          <Dot tone="live" pulse />
          refreshed every 2s{actions ? ' · cancel from a session' : ''}
        </span>
      }
      flush
    >
      <DataTable
        label="Uploads"
        columns={uploadColumns(tenancy)}
        rows={uploads ? [...uploads] : undefined}
        rowKey={(upload) => upload.id}
        onRowClick={(upload) => {
          window.location.hash = `#/uploads/${encodeURIComponent(upload.id)}`;
        }}
        loading={!uploads}
        empty={
          <EmptyState
            icon={<UploadIcon />}
            title="No uploads in progress"
            description="Resumable sessions show here while a client is sending a file."
          />
        }
      />
    </KitPanel>
  );
}

/** Container: polls the sessions every 2 s. */
function UploadsListView({ actions }: { actions: boolean }): JSX.Element {
  const uploadsQuery = useQuery({
    queryKey: UPLOADS_QUERY_KEY,
    queryFn: () => mediaConsoleClient.uploads({}),
    refetchInterval: 2000,
  });
  return (
    <PageBody>
      <PageHeader title="Uploads" description="Live resumable upload sessions across your disks." />
      <QueryBoundary
        label="Uploads"
        query={uploadsQuery}
        skeleton={<UploadsTable uploads={undefined} actions={actions} />}
      >
        {(data) => <UploadsTable uploads={data.uploads} actions={actions} />}
      </QueryBoundary>
    </PageBody>
  );
}

function DetailRow({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <>
      <dt className="mono text-[10px] uppercase tracking-wider text-faint">{label}</dt>
      <dd className="text-fg">{children}</dd>
    </>
  );
}

function UploadDetailView({
  uploadId,
  actions,
}: {
  uploadId: string;
  actions: boolean;
}): JSX.Element {
  const queryClient = useQueryClient();
  const uploadQuery = useQuery({
    queryKey: ['upload', uploadId],
    queryFn: () => mediaConsoleClient.upload(uploadId),
  });
  const abortMutation = useMutation({
    mutationFn: () => mediaConsoleClient.abortUpload(uploadId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: UPLOADS_QUERY_KEY });
      window.location.hash = '#/uploads';
    },
  });

  return (
    <PageBody>
      <a href="#/uploads" className="mono text-xs text-dim hover:text-fg">
        ← back to uploads
      </a>
      {uploadQuery.isLoading && (
        <div className="aviary-surface rounded-lg border border-border p-4" aria-hidden>
          {Array.from({ length: 7 }, (_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: static placeholder rows
            <Skeleton key={i} className="mt-3 h-3 w-1/2 first:mt-0" />
          ))}
        </div>
      )}
      {uploadQuery.isError && <Notice>Failed to load upload.</Notice>}
      {uploadQuery.data && (
        <div>
          <Panel className="p-4">
            <dl className="grid grid-cols-[120px_1fr] gap-x-4 gap-y-2 text-sm">
              <DetailRow label="Key">
                <span className="mono truncate text-xs">{uploadQuery.data.upload.key}</span>
              </DetailRow>
              <DetailRow label="Disk">
                <span className="mono text-xs">{uploadQuery.data.upload.disk}</span>
              </DetailRow>
              {uploadQuery.data.upload.tenant !== undefined && (
                <DetailRow label="Organization">
                  {uploadQuery.data.upload.tenant?.label ?? '—'}
                </DetailRow>
              )}
              <DetailRow label="Progress">
                <ProgressBar percent={uploadQuery.data.upload.percent} />
              </DetailRow>
              <DetailRow label="Offset">
                <span className="mono tnum text-xs">{uploadQuery.data.upload.offset}</span>
              </DetailRow>
              <DetailRow label="Size">
                <span className="mono tnum text-xs">
                  {uploadQuery.data.upload.size ?? 'unknown'}
                </span>
              </DetailRow>
              <DetailRow label="Multipart">
                {uploadQuery.data.upload.multipart ? 'yes' : 'no'}
              </DetailRow>
              <DetailRow label="Age">
                {relativeAge(uploadQuery.data.upload.createdAt) ?? '—'}
              </DetailRow>
            </dl>

            {actions && (
              <div className="mt-4">
                <Button
                  tone="destructive"
                  onClick={() => abortMutation.mutate()}
                  disabled={abortMutation.isPending}
                  title="Removes the resumable session so it stops here. An incomplete underlying multipart upload is reaped by the bucket lifecycle policy, not by this action."
                >
                  {abortMutation.isPending ? 'Canceling…' : 'Cancel session'}
                </Button>
                {abortMutation.isError && (
                  <p className="mt-2 text-xs s-error">Failed to cancel session.</p>
                )}
              </div>
            )}
          </Panel>

          <h3 className="mono mb-1 mt-4 text-[10px] uppercase tracking-wider text-faint">parts</h3>
          {uploadQuery.data.parts.length === 0 ? (
            <Notice>No parts uploaded yet.</Notice>
          ) : (
            <Panel className="overflow-hidden">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="mono border-b border-border text-[10px] uppercase tracking-wider text-faint">
                    <th className="px-4 py-2 font-normal">Part</th>
                    <th className="px-4 py-2 font-normal">ETag</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line-soft">
                  {uploadQuery.data.parts.map((part) => (
                    <tr key={part.partNumber} className="hover:bg-hover">
                      <td className="mono tnum px-4 py-2 text-xs text-fg-2">{part.partNumber}</td>
                      <td className="mono px-4 py-2 text-xs text-dim">{part.etag}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>
          )}
        </div>
      )}
    </PageBody>
  );
}

export function UploadsView({ route, actions }: { route: Route; actions: boolean }): JSX.Element {
  if (route.uploadId) {
    return <UploadDetailView uploadId={route.uploadId} actions={actions} />;
  }
  return <UploadsListView actions={actions} />;
}
