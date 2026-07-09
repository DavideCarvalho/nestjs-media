import type { Route } from '../useHashRoute.js';

// Wave 3 fills this in: collection chips (mediaConsoleClient.collections) -> paginated record grid
// (.library) -> record detail with variant thumbnails (.libraryRecord). When `hasStore` is false,
// render the "No media store configured" empty state.
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
      <p className="text-sm text-slate-500">
        {route.recordId ? `Record: ${route.recordId}` : (route.collection ?? 'All collections')}
      </p>
    </section>
  );
}
