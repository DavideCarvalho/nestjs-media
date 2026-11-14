import { useQuery } from '@tanstack/react-query';
import { type JSX, useEffect, useMemo, useState } from 'react';
import { ErrorBoundary } from '../aviary-kit/blocks/error-boundary';
import { readShellConfig } from '../aviary-kit/shell-config';
import { AppShell, type NavSection } from '../aviary-kit/shell/app-shell';
import type { SearchCommand } from '../aviary-kit/shell/console-search';
import {
  ConsoleAccessError,
  mediaConsoleClient,
  onConsoleAccessDenied,
} from '../client/media-console-client.js';
import type { Topology } from '../client/types.js';
import { DiskIcon, ImageIcon, LayersIcon, UploadIcon } from './icons.js';
import { Dot } from './ui.js';
import { type Tab, useHashRoute } from './useHashRoute.js';
import { CollectionsView } from './views/CollectionsView.js';
import { DisksView } from './views/DisksView.js';
import { LibraryView } from './views/LibraryView.js';
import { UploadsView } from './views/UploadsView.js';

/** The id of the page's JSON config block (the server's `MEDIA_DASHBOARD_CONFIG_ID`). */
export const CONFIG_ELEMENT_ID = 'media-dashboard-config';

/** Media's accent (cyan): passed to the kit's ThemeProvider in `main.tsx`. */
export const MEDIA_ACCENT = '#22d3ee';

const TITLES: Record<Tab, string> = {
  library: 'Library',
  collections: 'Collections',
  uploads: 'Uploads',
  disks: 'Disks',
};

/** The media brand mark — three stacked media layers (an object store / gallery), in currentColor so
 *  it inherits the console accent. */
function LogoMark(): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
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
    <div role="alert" className="grid h-full min-h-[60vh] place-items-center p-6">
      <div className="max-w-sm text-center">
        <div className="text-sm font-semibold tracking-tight text-fg">
          {signIn
            ? error.redirectTo
              ? 'Redirecting to sign in…'
              : 'Sign-in required'
            : 'Access denied'}
        </div>
        <p className="mt-2 text-xs text-dim">
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

/** The topbar's deployment facts: disk count, which subsystems are wired, and the live pip. */
function TopologyChips({ topology }: { topology: Topology | undefined }): JSX.Element | null {
  if (!topology) return null;
  const stat = (label: string, on: boolean) => (
    <span
      className={`mono hidden items-center gap-1.5 text-[10.5px] lg:flex ${on ? 'text-dim' : 'text-faint'}`}
      title={on ? `${label}: configured` : `${label}: not configured`}
    >
      <Dot tone={on ? 'ok' : 'idle'} />
      {label}
    </span>
  );
  return (
    <div className="flex items-center gap-3">
      <span className="mono tnum hidden text-[10.5px] text-dim md:inline">
        {topology.disks} {topology.disks === 1 ? 'disk' : 'disks'}
      </span>
      {stat('store', topology.hasStore)}
      {stat('uploads', topology.hasUploads)}
      {stat('actions', topology.actions)}
      <span className="hidden items-center gap-1.5 text-[12px] text-dim sm:flex">
        <Dot tone="ok" pulse />
        live
      </span>
    </div>
  );
}

function go(tab: Tab): void {
  window.location.hash = `#/${tab}`;
}

/**
 * The media console: the Aviary shell (kit) around four pages — LIBRARY (Library, Collections) and
 * TRANSFERS (Uploads, and Disks, the object browser you upload into). Every page renders inside
 * its own error boundary; a denial from the API replaces the pages with the access-denied state.
 */
export function App(): JSX.Element {
  // What the server put in the page: switcher, ⌘K search, viewer, sign-out (all optional).
  const shell = useMemo(() => readShellConfig(CONFIG_ELEMENT_ID), []);
  const route = useHashRoute();
  const topology = useQuery({
    queryKey: ['topology'],
    queryFn: () => mediaConsoleClient.topology(),
    // A denial won't change on retry.
    retry: (count, error) => !(error instanceof ConsoleAccessError) && count < 1,
  });
  const reported = useAccessDenied();
  const denied =
    reported ?? (topology.error instanceof ConsoleAccessError ? topology.error : undefined);
  const actions = topology.data?.actions ?? false;

  const nav = useMemo<NavSection[]>(
    () => [
      {
        section: 'Library',
        items: [
          {
            id: 'library',
            label: 'Library',
            icon: <ImageIcon />,
            href: '#/library',
            onSelect: () => go('library'),
          },
          {
            id: 'collections',
            label: 'Collections',
            icon: <LayersIcon />,
            href: '#/collections',
            onSelect: () => go('collections'),
          },
        ],
      },
      {
        section: 'Transfers',
        items: [
          {
            id: 'uploads',
            label: 'Uploads',
            icon: <UploadIcon />,
            href: '#/uploads',
            onSelect: () => go('uploads'),
          },
          {
            id: 'disks',
            label: 'Disks',
            icon: <DiskIcon />,
            href: '#/disks',
            onSelect: () => go('disks'),
          },
        ],
      },
    ],
    [],
  );

  // ⌘K: this console's pages, listed above the cross-console hits.
  const commands = useMemo<SearchCommand[]>(
    () =>
      nav.flatMap((section) =>
        section.items.map((item) => ({
          id: `page:${item.id}`,
          label: item.label,
          group: 'Pages',
          icon: item.icon,
          keywords: [section.section],
          onSelect: () => item.onSelect?.(),
        })),
      ),
    [nav],
  );

  return (
    <AppShell
      brand={{
        name: 'media',
        subtitle: 'console',
        mark: <LogoMark />,
        current: { title: 'Media', package: '@dudousxd/nestjs-media', icon: 'media' },
      }}
      nav={nav}
      activeId={route.tab}
      shell={shell}
      title={TITLES[route.tab]}
      commands={commands}
      searchPlaceholder="Search files, records, runs, threads…"
      actions={<TopologyChips topology={topology.data} />}
    >
      {denied ? (
        <AccessDenied error={denied} />
      ) : (
        <ErrorBoundary label={TITLES[route.tab]} resetKeys={[route.tab]}>
          {route.tab === 'disks' && <DisksView route={route} actions={actions} />}
          {route.tab === 'uploads' && <UploadsView route={route} actions={actions} />}
          {route.tab === 'library' && (
            <LibraryView
              route={route}
              hasStore={topology.data?.hasStore ?? false}
              topologyPending={topology.isPending}
            />
          )}
          {route.tab === 'collections' && (
            <CollectionsView
              hasStore={topology.data?.hasStore ?? false}
              topologyPending={topology.isPending}
            />
          )}
        </ErrorBoundary>
      )}
    </AppShell>
  );
}
