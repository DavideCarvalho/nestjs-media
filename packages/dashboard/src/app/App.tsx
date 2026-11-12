import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import {
  ConsoleAccessError,
  consoleSearchEndpoint,
  mediaConsoleClient,
  onConsoleAccessDenied,
} from '../client/media-console-client.js';
import { ConsoleSearch } from './ConsoleSearch.js';
import { ConsoleSwitcher, readSwitcherConfig } from './ConsoleSwitcher.js';
import { Button, Dot } from './ui.js';
import { useHashRoute } from './useHashRoute.js';
import { DisksView } from './views/DisksView.js';
import { LibraryView } from './views/LibraryView.js';
import { UploadsView } from './views/UploadsView.js';

/** The switcher config the server put in the page (absent when this console is alone). */
const switcherConfig = readSwitcherConfig('media-dashboard-config');

const TABS: ReadonlyArray<{ id: 'disks' | 'uploads' | 'library'; label: string }> = [
  { id: 'disks', label: 'disks' },
  { id: 'uploads', label: 'uploads' },
  { id: 'library', label: 'library' },
];

/** The media brand mark — three stacked media layers (an object store / gallery), in currentColor so
 *  it inherits the console accent. The media-console sibling of durable's workflow diamond. */
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

/** What the console shows instead of its views when the API denies access (`authorize`). */
export function AccessDenied({ error }: { error: ConsoleAccessError }): JSX.Element {
  const signIn = error.status === 401;
  return (
    <div role="alert" className="grid h-full place-items-center p-6">
      <div className="max-w-sm text-center">
        <div className="text-sm font-semibold tracking-tight">
          {signIn
            ? error.redirectTo
              ? 'Redirecting to sign in…'
              : 'Sign-in required'
            : 'Access denied'}
        </div>
        <p className="mt-2 text-xs text-zinc-500">
          {signIn
            ? 'Sign in to the app to use the media console.'
            : "You don't have access to the media console."}
        </p>
      </div>
    </div>
  );
}

/** The latest console denial the API client reported, if any. */
function useAccessDenied(): ConsoleAccessError | undefined {
  const [denied, setDenied] = useState<ConsoleAccessError>();
  useEffect(() => onConsoleAccessDenied(setDenied), []);
  return denied;
}

export function App(): JSX.Element {
  const route = useHashRoute();
  const topology = useQuery({
    queryKey: ['topology'],
    queryFn: () => mediaConsoleClient.topology(),
    // A denial won't change on retry.
    retry: (count, error) => !(error instanceof ConsoleAccessError) && count < 1,
  });
  const reported = useAccessDenied();
  const [searching, setSearching] = useState(false);
  const denied =
    reported ?? (topology.error instanceof ConsoleAccessError ? topology.error : undefined);

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
        <header className="z-10 flex items-center gap-4 border-b border-border px-5 py-3">
          <ConsoleSwitcher
            config={switcherConfig}
            current={{ title: 'Media', icon: 'media' }}
            onSearch={() => setSearching(true)}
            brand={
              <div className="flex items-center gap-2.5">
                <div className="grid h-7 w-7 place-items-center rounded-md border border-accent/30 bg-accent/10">
                  <LogoMark className="h-4 w-4 text-accent" />
                </div>
                <div className="leading-none">
                  <div className="text-sm font-semibold tracking-tight">media</div>
                  <div className="mono text-[10px] uppercase tracking-[0.2em] text-zinc-600">
                    console
                  </div>
                </div>
              </div>
            }
          />

          <nav className="ml-2 flex flex-wrap items-center gap-1">
            {TABS.map((tab) => (
              <Button
                key={tab.id}
                tone={route.tab === tab.id ? 'selected' : 'quiet'}
                className="px-2.5 py-1 text-xs uppercase tracking-wide"
                render={<a href={`#/${tab.id}`}>{tab.label}</a>}
              />
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-3">
            <Button
              tone="quiet"
              className="gap-2 px-2.5 py-1 text-xs"
              onClick={() => setSearching(true)}
            >
              Search
              <kbd className="mono text-[10px] text-zinc-500">⌘K</kbd>
            </Button>
            {topology.data && (
              <>
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
              </>
            )}
          </div>
        </header>
        <ConsoleSearch
          endpoint={consoleSearchEndpoint()}
          open={searching}
          onOpenChange={setSearching}
        />

        <main className="min-h-0 flex-1 overflow-auto p-6">
          {denied && <AccessDenied error={denied} />}
          {!denied && route.tab === 'disks' && (
            <DisksView route={route} actions={topology.data?.actions ?? false} />
          )}
          {!denied && route.tab === 'uploads' && (
            <UploadsView route={route} actions={topology.data?.actions ?? false} />
          )}
          {!denied && route.tab === 'library' && (
            <LibraryView route={route} hasStore={topology.data?.hasStore ?? false} />
          )}
        </main>
      </div>
    </>
  );
}
