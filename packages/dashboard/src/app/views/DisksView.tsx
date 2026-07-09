import type { Route } from '../useHashRoute.js';

// Wave 3 fills this in: disk rail + breadcrumb + folder/file table (mediaConsoleClient.disks /
// .objects) with cursor "load more", row preview/download/copy-key, and delete/copy/move when
// `actions` is true.
export function DisksView({ route, actions }: { route: Route; actions: boolean }): JSX.Element {
  return (
    <section>
      <h2 className="mb-2 text-base font-semibold">Disks</h2>
      <p className="text-sm text-slate-500">
        {route.disk ? `Disk: ${route.disk}` : 'Select a disk'}
        {actions ? ' · actions enabled' : ''}
      </p>
    </section>
  );
}
