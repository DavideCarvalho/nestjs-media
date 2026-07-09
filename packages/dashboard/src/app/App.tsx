import { useQuery } from '@tanstack/react-query';
import { mediaConsoleClient } from '../client/media-console-client.js';
import { useHashRoute } from './useHashRoute.js';
import { DisksView } from './views/DisksView.js';
import { LibraryView } from './views/LibraryView.js';
import { UploadsView } from './views/UploadsView.js';

const TABS: ReadonlyArray<{ id: 'disks' | 'uploads' | 'library'; label: string }> = [
  { id: 'disks', label: 'Disks' },
  { id: 'uploads', label: 'Uploads' },
  { id: 'library', label: 'Library' },
];

export function App(): JSX.Element {
  const route = useHashRoute();
  const topology = useQuery({
    queryKey: ['topology'],
    queryFn: () => mediaConsoleClient.topology(),
  });

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3">
        <div className="flex items-center gap-6">
          <span className="text-lg font-semibold">Media Console</span>
          <nav className="flex gap-1">
            {TABS.map((tab) => (
              <a
                key={tab.id}
                href={`#/${tab.id}`}
                className={`rounded px-3 py-1.5 text-sm font-medium ${
                  route.tab === tab.id
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                {tab.label}
              </a>
            ))}
          </nav>
        </div>
        {topology.data && (
          <span className="text-xs text-slate-500">
            {topology.data.disks} disks
            {topology.data.hasStore ? ' · store' : ''}
            {topology.data.hasUploads ? ' · uploads' : ''}
            {topology.data.actions ? ' · actions' : ''}
          </span>
        )}
      </header>
      <main className="p-6">
        {route.tab === 'disks' && (
          <DisksView route={route} actions={topology.data?.actions ?? false} />
        )}
        {route.tab === 'uploads' && (
          <UploadsView route={route} actions={topology.data?.actions ?? false} />
        )}
        {route.tab === 'library' && (
          <LibraryView route={route} hasStore={topology.data?.hasStore ?? false} />
        )}
      </main>
    </div>
  );
}
