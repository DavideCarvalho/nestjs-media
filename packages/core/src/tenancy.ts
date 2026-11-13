// Media's side of the @dudousxd/nestjs-context tenancy contract. The reader itself
// (`./tenancy-reader`) is a verbatim copy of the context's reference reader: it imports nothing from
// the context, so media works with any context version, or with none at all. A missing or older
// accessor reads as `{ enabled: false }`; an older context simply has no chain, family, `required`
// or labels.
import { keySegment } from './keys';
import {
  type Tenancy,
  type TenancyOption,
  type TenantFilter,
  type TenantLevel,
  type TenantRef,
  canSeeRow as readerCanSeeRow,
  readTenancy as readerReadTenancy,
  rowTenantId as readerRowTenantId,
  tenantLabels as readerTenantLabels,
} from './tenancy-reader';

/** One level of a tenant hierarchy (a clinic, a unit inside it), as the context reports it. */
export type MediaTenantLevel = TenantLevel;

/**
 * The tenant a request runs in, as the context reports it. With nested tenants, `chain` is the
 * active path (root first) and `family` names a secondary tenant (context >= 2.1).
 */
export type MediaTenantRef = TenantRef;

/** What the context says about the current request's tenant. */
export type MediaTenantFilter = TenantFilter;

/**
 * The `tenancy` option of `MediaModule` (and of `MediaLibrary` / `ResumableUploadManager`).
 *
 * - `'inherit'` (default): follow `ContextModule`'s `tenancy.enabled`, which is off by default.
 * - `false`: never scope media by tenant.
 * - an object:
 *   - `enabled`: `'inherit'` or a boolean;
 *   - `kinds`: the tenant kinds media scopes by. With nested tenants (clinic → unit), media uses
 *     the most specific level of the active chain whose kind is listed;
 *   - `family`: scope by the tenant of this family instead of the primary one;
 *   - `required`: a read or write with no tenant throws the context's `TenantRequiredError` (403)
 *     instead of running as tenantless. Default: the context's `tenancy.required`;
 *   - `nullRows`: `'tenantless'` by default; `'shared'` also shows rows with no tenant to every
 *     tenant;
 *   - `pathPrefix`: store new library files under `t/<tenantId>/` (default `false`). Existing
 *     files stay where they are.
 */
export type MediaTenancyOption =
  | 'inherit'
  | false
  | (Exclude<TenancyOption, 'inherit' | false> & { pathPrefix?: boolean });

export type MediaTenancy =
  | { enabled: false }
  | {
      enabled: true;
      nullRows: 'tenantless' | 'shared';
      /** New library files go under `t/<tenantId>/`. */
      pathPrefix: boolean;
      filter(): MediaTenantFilter;
    };

/**
 * Rows a store keeps: those whose tenant id equals `id` (`null` = rows with no tenant), plus the
 * rows with no tenant when `orNull` is set. Passed to stores in the `tenant` field of a filter.
 */
export interface MediaTenantMatch {
  id: string | null;
  orNull?: boolean;
}

/** What a call site may override on the configured option. */
export interface ReadTenancyOverrides {
  /**
   * `false` on paths that don't serve a request (boot checks, background housekeeping), so a
   * missing tenant never throws there even when the app requires one.
   */
  required?: boolean;
}

/**
 * Whether tenancy is on for media, and the current request's filter. `accessor`: the context's
 * `CONTEXT_ACCESSOR`, if injected; else the global slot `ContextModule` publishes. Call per
 * operation, never once at boot.
 */
export function readTenancy(
  option: MediaTenancyOption = 'inherit',
  accessor?: unknown,
  overrides: ReadTenancyOverrides = {},
): MediaTenancy {
  if (option === false) return { enabled: false };
  // A malformed accessor (members that aren't functions) reads as tenancy off, never a throw.
  const slot = (globalThis as unknown as Record<symbol, { current?: unknown } | undefined>)[
    Symbol.for('@dudousxd/nestjs-diagnostics:accessor')
  ];
  const a = (accessor ?? slot?.current) as { tenantFilter?: unknown } | null | undefined;
  if (typeof a?.tenantFilter !== 'function') return { enabled: false };
  const own = typeof option === 'object' ? option : {};
  const { pathPrefix, ...rest } = own;
  const effective: TenancyOption =
    overrides.required !== undefined ? { ...rest, required: overrides.required } : rest;
  const tenancy: Tenancy = readerReadTenancy(effective, accessor);
  if (!tenancy.enabled) return { enabled: false };
  return {
    enabled: true,
    nullRows: tenancy.nullRows,
    pathPrefix: pathPrefix === true,
    filter: () => tenancy.filter(),
  };
}

/** The matching rule: may this request see a row whose tenant column holds `rowTenantId`? */
export function canSeeRow(t: MediaTenancy, rowTenantId: string | null | undefined): boolean {
  return readerCanSeeRow(t, rowTenantId);
}

/** The tenant id to stamp on a new row: the active tenant's id, else `null`. */
export function rowTenantId(t: MediaTenancy): string | null {
  return readerRowTenantId(t);
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

/**
 * Display labels keyed by tenant id, for the console: the app's `tenancy.label` (context >= 2.1),
 * else the tenant's slug, else its id. Never throws.
 */
export function tenantLabels(
  tenants: MediaTenantLevel[],
  accessor?: unknown,
): Promise<Record<string, string>> {
  return readerTenantLabels(tenants, accessor);
}

/** The storage prefix of a tenant's new files under `pathPrefix`: `t/<tenantId>/`. */
export function tenantPathPrefix(tenantId: string): string {
  return `t/${keySegment(tenantId)}/`;
}
