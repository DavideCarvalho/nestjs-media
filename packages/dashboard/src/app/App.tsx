import { useQuery, useQueryClient } from '@tanstack/react-query';
import { mediaConsoleClient } from '../client/media-console-client.js';
import { AuthScreen } from './AuthScreen.js';
import { Dot } from './ui.js';
import { useHashRoute } from './useHashRoute.js';
import { DisksView } from './views/DisksView.js';
import { LibraryView } from './views/LibraryView.js';
import { UploadsView } from './views/UploadsView.js';

const TABS: ReadonlyArray<{ id: 'disks' | 'uploads' | 'library'; label: string }> = [
  { id: 'disks', label: 'disks' },
  { id: 'uploads', label: 'uploads' },
  { id: 'library', label: 'library' },
];

/** The media brand mark — three stacked media layers (an object store / gallery), in currentColor so
 *  it inherits the emerald accent. The media-console sibling of durable's workflow diamond. */
function LogoMark({ className }: { className?: string }): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      role="img"
      aria-label="media"
    >
      <title>media</title>
      <path d="M12 3 21 7.5 12 12 3 7.5z" opacity={0.9} />
      <path d="M3 12l9 4.5L21 12" opacity={0.55} />
      <path d="M3 16.5 12 21l9-4.5" opacity={0.3} />
    </svg>
  );
}

export function App(): JSX.Element {
  const route = useHashRoute();
  const queryClient = useQueryClient();
  const auth = useQuery({ queryKey: ['me'], queryFn: () => mediaConsoleClient.me() });
  const authed = auth.data?.state === 'authenticated';
  const topology = useQuery({
    queryKey: ['topology'],
    queryFn: () => mediaConsoleClient.topology(),
    // Don't hit the (guarded) API until we know we're past the login gate.
    enabled: auth.data !== undefined && auth.data.state !== 'login',
  });

  async function logout(): Promise<void> {
    await mediaConsoleClient.logout();
    await queryClient.invalidateQueries();
  }

  if (auth.data?.state === 'login') return <AuthScreen modes={auth.data.modes} />;

  const stat = (label: string, on: boolean) => (
    <span
      className={`mono flex items-center gap-1 text-[10px] ${on ? 'text-zinc-400' : 'text-zinc-700'}`}
    >
      <Dot tone={on ? 'ok' : 'idle'} />
      {label}
    </span>
  );

  return (
    <>
      <div className="app-bg" />
      <div className="relative z-10 flex h-full flex-col">
        <header className="z-10 flex items-center gap-4 border-b border-[var(--line)] px-5 py-3">
          <div className="flex items-center gap-2.5">
            <div className="grid h-7 w-7 place-items-center rounded-md border border-emerald-500/30 bg-emerald-500/10">
              <LogoMark className="h-4 w-4 text-emerald-400" />
            </div>
            <div className="leading-none">
              <div className="text-sm font-semibold tracking-tight">media</div>
              <div className="mono text-[10px] uppercase tracking-[0.2em] text-zinc-600">
                console
              </div>
            </div>
          </div>

          <nav className="ml-2 flex flex-wrap items-center gap-1">
            {TABS.map((tab) => (
              <a
                key={tab.id}
                href={`#/${tab.id}`}
                className={`mono flex items-center gap-2 rounded-md border px-2.5 py-1 text-xs uppercase tracking-wide transition-colors ${
                  route.tab === tab.id
                    ? 'border-zinc-600 bg-zinc-900 text-zinc-100'
                    : 'border-transparent text-zinc-500 hover:text-zinc-300'
                }`}
              >
                {tab.label}
              </a>
            ))}
          </nav>

          {topology.data && (
            <div className="ml-auto flex items-center gap-3">
              <span className="mono tnum text-[10px] text-zinc-500">
                {topology.data.disks} {topology.data.disks === 1 ? 'disk' : 'disks'}
              </span>
              {stat('store', topology.data.hasStore)}
              {stat('uploads', topology.data.hasUploads)}
              {stat('actions', topology.data.actions)}
              <span className="ml-1 flex items-center gap-1.5 text-xs text-zinc-500">
                <Dot tone="ok" pulse />
                live
              </span>
              {authed && (
                <button
                  type="button"
                  onClick={logout}
                  className="mono ml-1 rounded-md border border-[var(--line)] px-2 py-1 text-[10px] uppercase tracking-wider text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
                >
                  {auth.data?.state === 'authenticated' && auth.data.user.name
                    ? `sign out · ${auth.data.user.name}`
                    : 'sign out'}
                </button>
              )}
            </div>
          )}
        </header>

        <main className="min-h-0 flex-1 overflow-auto p-6">
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
    </>
  );
}
