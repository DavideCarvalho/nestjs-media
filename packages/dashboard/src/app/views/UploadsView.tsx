import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { mediaConsoleClient } from '../../client/media-console-client.js';
import { Dot, GhostButton, Notice, Panel, relativeAge } from '../ui.js';
import type { Route } from '../useHashRoute.js';

const UPLOADS_QUERY_KEY = ['uploads'];

function ProgressBar({ percent }: { percent: number | null }): JSX.Element {
  if (percent === null) {
    return <span className="mono text-[10px] text-zinc-600">unknown size</span>;
  }
  const clamped = Math.min(100, Math.max(0, percent));
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-28 overflow-hidden rounded-full bg-zinc-800">
        <div
          className="h-full rounded-full bg-emerald-500/80 transition-[width]"
          style={{ width: `${clamped}%` }}
        />
      </div>
      <span className="mono tnum text-[10px] text-zinc-500">{clamped}%</span>
    </div>
  );
}

function UploadsListView({ actions }: { actions: boolean }): JSX.Element {
  const uploadsQuery = useQuery({
    queryKey: UPLOADS_QUERY_KEY,
    queryFn: () => mediaConsoleClient.uploads({}),
    refetchInterval: 2000,
  });

  if (uploadsQuery.isLoading) {
    return <Notice>Loading uploads…</Notice>;
  }
  if (uploadsQuery.isError) {
    return <Notice>Failed to load uploads.</Notice>;
  }

  const uploads = uploadsQuery.data?.uploads ?? [];

  return (
    <section className="rise">
      <div className="mb-3 flex items-center gap-2">
        <Dot tone="live" pulse />
        <span className="mono text-[11px] text-zinc-500">
          Live resumable sessions · refreshed every 2s
          {actions ? ' · cancel from a session detail' : ''}
        </span>
      </div>
      {uploads.length === 0 ? (
        <Notice>No uploads in progress.</Notice>
      ) : (
        <Panel className="overflow-hidden">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="mono border-b border-[var(--line)] text-[10px] uppercase tracking-wider text-zinc-600">
                <th className="px-4 py-2 font-normal">Key</th>
                <th className="px-4 py-2 font-normal">Disk</th>
                <th className="px-4 py-2 font-normal">Progress</th>
                <th className="px-4 py-2 font-normal">Parts</th>
                <th className="px-4 py-2 font-normal">Age</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--line-soft)]">
              {uploads.map((upload) => (
                <tr key={upload.id} className="hover:bg-zinc-900/40">
                  <td className="max-w-xs truncate px-4 py-2">
                    <a
                      href={`#/uploads/${encodeURIComponent(upload.id)}`}
                      className="mono text-xs text-zinc-200 hover:text-emerald-300"
                    >
                      {upload.key}
                    </a>
                  </td>
                  <td className="mono px-4 py-2 text-xs text-zinc-400">{upload.disk}</td>
                  <td className="px-4 py-2">
                    <ProgressBar percent={upload.percent} />
                  </td>
                  <td className="mono tnum px-4 py-2 text-xs text-zinc-400">{upload.parts}</td>
                  <td className="px-4 py-2 text-xs text-zinc-500">
                    {relativeAge(upload.createdAt) ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}
    </section>
  );
}

function DetailRow({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <>
      <dt className="mono text-[10px] uppercase tracking-wider text-zinc-600">{label}</dt>
      <dd className="text-zinc-200">{children}</dd>
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
    <section className="rise">
      <a href="#/uploads" className="mono text-xs text-zinc-500 hover:text-zinc-300">
        ← back
      </a>
      {uploadQuery.isLoading && <Notice>Loading upload…</Notice>}
      {uploadQuery.isError && <Notice>Failed to load upload.</Notice>}
      {uploadQuery.data && (
        <div className="mt-2">
          <Panel className="p-4">
            <dl className="grid grid-cols-[120px_1fr] gap-x-4 gap-y-2 text-sm">
              <DetailRow label="Key">
                <span className="mono truncate text-xs">{uploadQuery.data.upload.key}</span>
              </DetailRow>
              <DetailRow label="Disk">
                <span className="mono text-xs">{uploadQuery.data.upload.disk}</span>
              </DetailRow>
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
                <GhostButton
                  tone="rose"
                  onClick={() => abortMutation.mutate()}
                  disabled={abortMutation.isPending}
                  title="Removes the resumable session so it stops here. An incomplete underlying multipart upload is reaped by the bucket lifecycle policy, not by this action."
                >
                  {abortMutation.isPending ? 'Canceling…' : 'Cancel session'}
                </GhostButton>
                {abortMutation.isError && (
                  <p className="mt-2 text-xs s-error">Failed to cancel session.</p>
                )}
              </div>
            )}
          </Panel>

          <h3 className="mono mb-1 mt-4 text-[10px] uppercase tracking-wider text-zinc-600">
            parts
          </h3>
          {uploadQuery.data.parts.length === 0 ? (
            <Notice>No parts uploaded yet.</Notice>
          ) : (
            <Panel className="overflow-hidden">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="mono border-b border-[var(--line)] text-[10px] uppercase tracking-wider text-zinc-600">
                    <th className="px-4 py-2 font-normal">Part</th>
                    <th className="px-4 py-2 font-normal">ETag</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--line-soft)]">
                  {uploadQuery.data.parts.map((part) => (
                    <tr key={part.partNumber} className="hover:bg-zinc-900/40">
                      <td className="mono tnum px-4 py-2 text-xs text-zinc-300">
                        {part.partNumber}
                      </td>
                      <td className="mono px-4 py-2 text-xs text-zinc-500">{part.etag}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>
          )}
        </div>
      )}
    </section>
  );
}

export function UploadsView({ route, actions }: { route: Route; actions: boolean }): JSX.Element {
  if (route.uploadId) {
    return <UploadDetailView uploadId={route.uploadId} actions={actions} />;
  }
  return <UploadsListView actions={actions} />;
}
