import { type JSX, useEffect } from 'react';
import { APP_PARAM, selectedApp } from '../client/media-console-client.js';
import type { Topology } from '../client/types.js';

/** The empty choice: the console's own app. */
const LOCAL = '';

/**
 * The URL that shows `app` (`''`: the console's own app): the current page with `?app=` set or
 * removed. The hash (the open page and its nuqs view state) is dropped, since a record or a folder
 * open in one app does not exist in another.
 */
export function appHref(app: string, location: Pick<Location, 'pathname' | 'search'>): string {
  const params = new URLSearchParams(location.search);
  if (app === LOCAL) params.delete(APP_PARAM);
  else params.set(APP_PARAM, app);
  const qs = params.toString();
  return `${location.pathname}${qs ? `?${qs}` : ''}`;
}

/**
 * The app switcher of a federated console (the server's `federation` option): the console's own
 * app (unless the viewer's `apps` grant hides it) plus each app the viewer may see. Choosing one
 * reloads the console on `?app=<name>`, so every read is refetched for that app. A viewer who may
 * not see the console's own app and selected none is sent to the first app it may see. Renders
 * nothing on a console without federation.
 */
export function AppSelector({ topology }: { topology: Topology | undefined }): JSX.Element | null {
  const federation = topology?.federation;
  const current = selectedApp() ?? LOCAL;
  const first = federation?.apps[0]?.name;
  const redirect = federation?.local === null && current === LOCAL ? first : undefined;
  useEffect(() => {
    if (redirect !== undefined) window.location.replace(appHref(redirect, window.location));
  }, [redirect]);
  if (!federation || federation.apps.length === 0) return null;
  return (
    <label className="flex items-center gap-1.5 text-[12px] text-dim">
      <span className="hidden sm:inline">App</span>
      <select
        aria-label="App"
        className="rounded-md border border-line bg-panel px-2 py-1 text-[12px] text-fg"
        value={current}
        onChange={(event) => {
          window.location.assign(appHref(event.target.value, window.location));
        }}
      >
        {federation.local !== null && <option value={LOCAL}>{federation.local.label}</option>}
        {federation.apps.map((app) => (
          <option key={app.name} value={app.name}>
            {app.label}
          </option>
        ))}
      </select>
    </label>
  );
}
