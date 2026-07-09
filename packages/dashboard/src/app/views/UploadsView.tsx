import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { mediaConsoleClient } from '../../client/media-console-client.js';
import type { Route } from '../useHashRoute.js';

const UPLOADS_QUERY_KEY = ['uploads'];

function formatAge(createdAt: string | undefined): string | undefined {
  if (!createdAt) return undefined;
  const createdMs = new Date(createdAt).getTime();
  if (Number.isNaN(createdMs)) return undefined;
  const deltaSeconds = Math.max(0, Math.floor((Date.now() - createdMs) / 1000));
  if (deltaSeconds < 60) return 'just now';
  const deltaMinutes = Math.floor(deltaSeconds / 60);
  if (deltaMinutes < 60) return `${deltaMinutes}m ago`;
  const deltaHours = Math.floor(deltaMinutes / 60);
  if (deltaHours < 24) return `${deltaHours}h ago`;
  const deltaDays = Math.floor(deltaHours / 24);
  return `${deltaDays}d ago`;
}

function ProgressBar({ percent }: { percent: number | null }): JSX.Element {
  if (percent === null) {
    return <span className="text-xs text-slate-400">unknown size</span>;
  }
  const clamped = Math.min(100, Math.max(0, percent));
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-24 rounded bg-slate-200">
        <div className="h-2 rounded bg-slate-900" style={{ width: `${clamped}%` }} />
      </div>
      <span className="text-xs text-slate-500">{clamped}%</span>
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
    return <p className="text-sm text-slate-500">Loading uploads…</p>;
  }
  if (uploadsQuery.isError) {
    return <p className="text-sm text-slate-500">Failed to load uploads.</p>;
  }

  const uploads = uploadsQuery.data?.uploads ?? [];

  return (
    <section>
      <h2 className="mb-1 text-base font-semibold">Uploads</h2>
      <p className="mb-3 text-xs text-slate-500">
        Live resumable upload sessions, refreshed every 2 seconds.
        {actions ? ' Abort is available from the detail view.' : ''}
      </p>
      {uploads.length === 0 ? (
        <p className="text-sm text-slate-500">No uploads in progress</p>
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
              <th className="py-2 pr-4">Key</th>
              <th className="py-2 pr-4">Disk</th>
              <th className="py-2 pr-4">Progress</th>
              <th className="py-2 pr-4">Parts</th>
              <th className="py-2 pr-4">Age</th>
            </tr>
          </thead>
          <tbody>
            {uploads.map((upload) => {
              const age = formatAge(upload.createdAt);
              return (
                <tr key={upload.id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="max-w-xs truncate py-2 pr-4 font-mono text-xs">
                    <a
                      href={`#/uploads/${encodeURIComponent(upload.id)}`}
                      className="text-slate-900 hover:underline"
                    >
                      {upload.key}
                    </a>
                  </td>
                  <td className="py-2 pr-4">{upload.disk}</td>
                  <td className="py-2 pr-4">
                    <ProgressBar percent={upload.percent} />
                  </td>
                  <td className="py-2 pr-4">{upload.parts}</td>
                  <td className="py-2 pr-4 text-slate-500">{age ?? '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
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
    <section>
      <a href="#/uploads" className="text-sm text-slate-500 hover:underline">
        ← Back
      </a>
      <h2 className="mb-2 mt-1 text-base font-semibold">Upload detail</h2>
      {uploadQuery.isLoading && <p className="text-sm text-slate-500">Loading upload…</p>}
      {uploadQuery.isError && <p className="text-sm text-slate-500">Failed to load upload.</p>}
      {uploadQuery.data && (
        <>
          <dl className="mb-4 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            <dt className="text-slate-500">Key</dt>
            <dd className="truncate font-mono text-xs">{uploadQuery.data.upload.key}</dd>
            <dt className="text-slate-500">Disk</dt>
            <dd>{uploadQuery.data.upload.disk}</dd>
            <dt className="text-slate-500">Progress</dt>
            <dd>
              <ProgressBar percent={uploadQuery.data.upload.percent} />
            </dd>
            <dt className="text-slate-500">Offset</dt>
            <dd>{uploadQuery.data.upload.offset}</dd>
            <dt className="text-slate-500">Size</dt>
            <dd>{uploadQuery.data.upload.size ?? 'unknown'}</dd>
            <dt className="text-slate-500">Multipart</dt>
            <dd>{uploadQuery.data.upload.multipart ? 'yes' : 'no'}</dd>
            <dt className="text-slate-500">Age</dt>
            <dd>{formatAge(uploadQuery.data.upload.createdAt) ?? '—'}</dd>
          </dl>

          {actions && (
            <button
              type="button"
              onClick={() => abortMutation.mutate()}
              disabled={abortMutation.isPending}
              className="mb-4 rounded border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
            >
              {abortMutation.isPending ? 'Aborting…' : 'Abort upload'}
            </button>
          )}
          {abortMutation.isError && (
            <p className="mb-4 text-sm text-slate-500">Failed to abort upload.</p>
          )}

          <h3 className="mb-1 text-sm font-semibold">Parts</h3>
          {uploadQuery.data.parts.length === 0 ? (
            <p className="text-sm text-slate-500">No parts uploaded yet</p>
          ) : (
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
                  <th className="py-2 pr-4">Part</th>
                  <th className="py-2 pr-4">ETag</th>
                </tr>
              </thead>
              <tbody>
                {uploadQuery.data.parts.map((part) => (
                  <tr key={part.partNumber} className="border-b border-slate-100">
                    <td className="py-2 pr-4">{part.partNumber}</td>
                    <td className="py-2 pr-4 font-mono text-xs">{part.etag}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
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
