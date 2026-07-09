import type { Route } from '../useHashRoute.js';

// Wave 3 fills this in: live in-progress uploads table (mediaConsoleClient.uploads, refetch every
// 2s) with percent bars, drill-in to parts (.upload), and an abort button when `actions` is true.
export function UploadsView({ route, actions }: { route: Route; actions: boolean }): JSX.Element {
  return (
    <section>
      <h2 className="mb-2 text-base font-semibold">Uploads</h2>
      <p className="text-sm text-slate-500">
        {route.uploadId ? `Upload: ${route.uploadId}` : 'Live in-progress uploads'}
        {actions ? ' · abort enabled' : ''}
      </p>
    </section>
  );
}
