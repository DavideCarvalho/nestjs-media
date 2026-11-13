import { MediaTenancyUnavailableError, type MediaTenantMatch } from '@dudousxd/nestjs-media-core';
import { type Column, type SQL, eq, isNull, or, sql } from 'drizzle-orm';

/** The matching rule as a `WHERE` condition on a `tenant_id` column. */
export function tenantCondition(column: Column, match: MediaTenantMatch): SQL | undefined {
  if (match.id === null) return isNull(column);
  return match.orNull ? or(eq(column, match.id), isNull(column)) : eq(column, match.id);
}

/** Every column of `columns` but `tenantId`, unless tenancy is on (so a table without it works). */
export function selectable<T extends { tenantId: unknown }>(
  columns: T,
  tenancy: boolean,
): T | Omit<T, 'tenantId'> {
  if (tenancy) return columns;
  const { tenantId: _tenantId, ...rest } = columns;
  return rest;
}

/** Fails `enableTenancy()` with the fix, when `probe` (a read of `tenant_id`) fails. */
export async function assertTenantColumn(
  table: string,
  probe: () => Promise<unknown>,
  fix: string,
): Promise<void> {
  try {
    await probe();
  } catch (error) {
    throw Object.assign(
      new MediaTenancyUnavailableError(`the \`${table}\` table has no \`tenant_id\` column`, fix),
      { cause: error },
    );
  }
}

/**
 * `MediaListFilter.nameContains` as a `WHERE` condition: `name` or `file_name` contains `text`,
 * ignoring case, with `%`, `_` and `!` matched literally (escaped with `!`).
 */
export function nameContainsCondition(
  name: Column,
  fileName: Column,
  text: string,
): SQL | undefined {
  const pattern = `%${text.toLowerCase().replace(/[!%_]/g, (c) => `!${c}`)}%`;
  return or(
    sql`lower(${name}) like ${pattern} escape '!'`,
    sql`lower(${fileName}) like ${pattern} escape '!'`,
  );
}
