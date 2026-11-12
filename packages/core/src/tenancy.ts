// Local reader for the @dudousxd/nestjs-context tenancy contract. It imports nothing from the
// context, so media works with any context version, or with none at all: a missing or older
// accessor reads as `{ enabled: false }` and behaviour is unchanged.

/** The tenant a request runs in, as the context reports it. */
export interface MediaTenantRef {
  id: string;
  kind: string;
  source: string;
  slug?: string;
  role?: string;
}

/** What the context says about the current request's tenant. */
export type MediaTenantFilter =
  | { mode: 'system' }
  | { mode: 'all' }
  | { mode: 'tenantless' }
  | { mode: 'tenant'; tenant: MediaTenantRef };

/**
 * The `tenancy` option of `MediaModule` (and of `MediaLibrary` / `ResumableUploadManager`).
 *
 * - `'inherit'` (default): follow `ContextModule`'s `tenancy.enabled`, which is off by default.
 * - `false`: never scope media by tenant.
 * - an object: `enabled` (`'inherit'` or a boolean), media's own `kinds` allow-list, and
 *   `nullRows` (`'tenantless'` by default; `'shared'` also shows rows with no tenant to every tenant).
 */
export type MediaTenancyOption =
  | 'inherit'
  | false
  | { enabled?: 'inherit' | boolean; kinds?: string[]; nullRows?: 'tenantless' | 'shared' };

export type MediaTenancy =
  | { enabled: false }
  | { enabled: true; nullRows: 'tenantless' | 'shared'; filter(): MediaTenantFilter };

/**
 * Rows a store keeps: those whose tenant id equals `id` (`null` = rows with no tenant), plus the
 * rows with no tenant when `orNull` is set. Passed to stores in the `tenant` field of a filter.
 */
export interface MediaTenantMatch {
  id: string | null;
  orNull?: boolean;
}

interface Accessor {
  tenancy?(): { enabled: boolean; kinds?: string[] };
  tenantFilter?(options?: { kinds?: string[] }): MediaTenantFilter;
}
const SLOT = Symbol.for('@dudousxd/nestjs-diagnostics:accessor');

/**
 * Whether tenancy is on for media, and the current request's filter. `accessor`: the context's
 * `CONTEXT_ACCESSOR`, if injected; else the global slot `ContextModule` publishes. Call per
 * operation, never once at boot.
 */
export function readTenancy(
  option: MediaTenancyOption = 'inherit',
  accessor?: unknown,
): MediaTenancy {
  const slot = (globalThis as unknown as Record<symbol, { current?: unknown } | undefined>)[SLOT];
  const a = (accessor ?? slot?.current) as Accessor | null | undefined;
  if (option === false || typeof a?.tenancy !== 'function' || !a.tenantFilter) {
    return { enabled: false };
  }
  const tenantFilter = a.tenantFilter.bind(a);
  const own = typeof option === 'object' ? option : {};
  const inherit = own.enabled === undefined || own.enabled === 'inherit';
  if (!(inherit ? a.tenancy().enabled : own.enabled)) return { enabled: false };
  const kinds = own.kinds;
  return {
    enabled: true,
    nullRows: own.nullRows ?? 'tenantless',
    filter: () => tenantFilter(kinds ? { kinds } : undefined),
  };
}

/** The matching rule: may this request see a row whose tenant column holds `rowTenantId`? */
export function canSeeRow(t: MediaTenancy, rowTenantId: string | null | undefined): boolean {
  if (!t.enabled) return true;
  const f = t.filter();
  if (f.mode === 'system' || f.mode === 'all') return true;
  if (rowTenantId === null || rowTenantId === undefined) {
    return f.mode === 'tenantless' || t.nullRows === 'shared';
  }
  return f.mode === 'tenant' && f.tenant.id === rowTenantId;
}

/** The tenant id to stamp on a new row: the active tenant's id, else `null`. */
export function rowTenantId(t: MediaTenancy): string | null {
  if (!t.enabled) return null;
  const f = t.filter();
  return f.mode === 'tenant' ? f.tenant.id : null;
}

/**
 * The matching rule as a store filter: `undefined` when every row is visible (tenancy off,
 * `system`, `all`), else the {@link MediaTenantMatch} a store turns into a `WHERE` clause.
 */
export function tenantMatch(t: MediaTenancy): MediaTenantMatch | undefined {
  if (!t.enabled) return undefined;
  const f = t.filter();
  if (f.mode === 'system' || f.mode === 'all') return undefined;
  if (f.mode === 'tenantless') return { id: null };
  return t.nullRows === 'shared' ? { id: f.tenant.id, orNull: true } : { id: f.tenant.id };
}

/** Whether a row's tenant id passes a {@link MediaTenantMatch}: for stores that filter in memory. */
export function matchesTenant(
  match: MediaTenantMatch | undefined,
  rowTenantId: string | null | undefined,
): boolean {
  if (!match) return true;
  const row = rowTenantId ?? null;
  return row === match.id || (match.orNull === true && row === null);
}
