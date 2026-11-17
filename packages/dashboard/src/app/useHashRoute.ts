import { useEffect, useState } from 'react';
import { splitHash, subscribeHashUrl } from '../aviary-kit/url-state/hash-url';

export type Tab = 'disks' | 'uploads' | 'library' | 'collections';

export interface Route {
  tab: Tab;
  /** Selected disk (Disks tab drill-in). */
  disk?: string;
  /** Current folder prefix within the disk. */
  prefix?: string;
  /** Object key whose preview panel is open (Disks tab). */
  preview?: string;
  /** Selected upload id (Uploads tab drill-in). */
  uploadId?: string;
  /** Selected media record id (Library tab drill-in). */
  recordId?: string;
  /** Selected collection filter (Library tab). */
  collection?: string;
}

const TABS: readonly Tab[] = ['disks', 'uploads', 'library', 'collections'];

function isTab(value: string): value is Tab {
  return (TABS as readonly string[]).includes(value);
}

/** `decodeURIComponent`, or undefined on a malformed escape (a bad pasted link must not blank the
 *  console). */
function decode(segment: string): string | undefined {
  try {
    return decodeURIComponent(segment);
  } catch {
    return undefined;
  }
}

export function parseHash(hash: string): Route {
  // Splits on the FIRST `?` only: a preview key or prefix may itself contain one.
  const { path, search } = splitHash(hash);
  const segments = path.split('/').filter((segment) => segment.length > 0);
  const params = new URLSearchParams(search);
  const head = segments[0] ?? 'disks';
  const tab: Tab = isTab(head) ? head : 'disks';

  const route: Route = { tab };
  const prefix = params.get('prefix');
  const preview = params.get('preview');
  const collection = params.get('collection');
  // A malformed escape in a path segment drops that drill-in and falls back to the tab itself.
  const id = segments[1] ? decode(segments[1]) : undefined;
  if (tab === 'disks' && id) {
    route.disk = id;
    if (prefix) route.prefix = prefix;
    if (preview) route.preview = decode(preview) ?? preview;
  }
  if (tab === 'uploads' && id) route.uploadId = id;
  if (tab === 'library') {
    if (id) route.recordId = id;
    if (collection) route.collection = collection;
  }
  return route;
}

/** Two routes name the same view (same tab, drill-in, folder, preview, collection). */
function sameRoute(a: Route, b: Route): boolean {
  return (
    a.tab === b.tab &&
    a.disk === b.disk &&
    a.prefix === b.prefix &&
    a.preview === b.preview &&
    a.uploadId === b.uploadId &&
    a.recordId === b.recordId &&
    a.collection === b.collection
  );
}

/**
 * The current route, following links and back/forward (`hashchange`, `popstate`) and the views' own
 * view-state writes (nuqs, through the kit's `NuqsHashAdapter`: a preview's tab, a grid's filter),
 * which are query-only and fire no `hashchange`. The route object is kept while the route itself is
 * unchanged, so such a write doesn't re-render the console.
 */
export function useHashRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));
  useEffect(() => {
    const unsubscribe = subscribeHashUrl(() =>
      setRoute((prev) => {
        const next = parseHash(window.location.hash);
        return sameRoute(prev, next) ? prev : next;
      }),
    );
    if (!window.location.hash) window.location.hash = '#/disks';
    return unsubscribe;
  }, []);
  return route;
}
