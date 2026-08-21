/**
 * How the console hands out the `url` it reports for an object's bytes — the link the UI offers as
 * "Open ↗", and the `src` an image variant renders from.
 *
 * - `auto` (default): a presigned, expiring URL straight to the object store when the driver can
 *   mint one, else the driver's plain URL. A real link: it survives a copy-paste out of the console
 *   and needs nothing from this server to resolve.
 * - `proxy`: the console's own same-origin route. For a host whose browser has no path to the store
 *   at all — no network route, no CORS grant, a policy against client-to-bucket traffic — where a
 *   presigned URL is a link that cannot be opened. The trade is that these URLs are only meaningful
 *   to a session that can reach this server, and every byte travels through it.
 *
 * Downloading is unaffected either way: `disks/:disk/object/download` is always same-origin,
 * because saving a file is the console's own action and has to work wherever the console does.
 */
export type ObjectUrlStrategy = 'auto' | 'proxy';

/** The resolved {@link ObjectUrlStrategy} plus what `proxy` needs to build a URL. Travels as one
 *  value so the service can never see a strategy without the mount path it depends on. */
export interface ObjectUrlConfig {
  strategy: ObjectUrlStrategy;
  /** Where the console's JSON API is mounted — leading slash, no trailing slash. */
  apiBasePath: string;
}

/** Same-origin URL for one of the console's object-byte routes, rooted at the API mount. */
export function objectProxyUrl(
  apiBasePath: string,
  route: 'raw' | 'download',
  disk: string,
  key: string,
): string {
  const path = `${apiBasePath}/disks/${encodeURIComponent(disk)}/object/${route}`;
  return `${path}?key=${encodeURIComponent(key)}`;
}
