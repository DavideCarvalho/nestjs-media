import { useEffect, useState } from 'react';

export type Tab = 'disks' | 'uploads' | 'library';

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

const TABS: readonly Tab[] = ['disks', 'uploads', 'library'];

function isTab(value: string): value is Tab {
  return (TABS as readonly string[]).includes(value);
}

export function parseHash(hash: string): Route {
  const raw = hash.replace(/^#\/?/, '');
  const [pathPart, queryPart] = raw.split('?');
  const segments = (pathPart ?? '').split('/').filter((segment) => segment.length > 0);
  const params = new URLSearchParams(queryPart ?? '');
  const head = segments[0] ?? 'disks';
  const tab: Tab = isTab(head) ? head : 'disks';

  const route: Route = { tab };
  const prefix = params.get('prefix');
  const preview = params.get('preview');
  const collection = params.get('collection');
  if (tab === 'disks' && segments[1]) {
    route.disk = decodeURIComponent(segments[1]);
    if (prefix) route.prefix = prefix;
    if (preview) route.preview = decodeURIComponent(preview);
  }
  if (tab === 'uploads' && segments[1]) route.uploadId = decodeURIComponent(segments[1]);
  if (tab === 'library') {
    if (segments[1]) route.recordId = decodeURIComponent(segments[1]);
    if (collection) route.collection = collection;
  }
  return route;
}

export function useHashRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));
  useEffect(() => {
    function onChange(): void {
      setRoute(parseHash(window.location.hash));
    }
    window.addEventListener('hashchange', onChange);
    if (!window.location.hash) window.location.hash = '#/disks';
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}
