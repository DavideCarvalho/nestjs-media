/** A schema name the lib can quote safely: a letter or `_`, then letters, digits, `_` or `$`. */
const SCHEMA_NAME = /^[A-Za-z_][A-Za-z0-9_$]*$/;

/**
 * Validates the `schema` option (at most 63 characters, Postgres' identifier limit). Throws a
 * `TypeError` naming the option when it can't be used.
 */
export function assertSchemaName(schema: string): void {
  if (typeof schema !== 'string' || !SCHEMA_NAME.test(schema) || schema.length > 63) {
    throw new TypeError(
      `[nestjs-media] \`schema\` must match /^[A-Za-z_][A-Za-z0-9_$]*$/ and be at most 63 characters, got ${JSON.stringify(schema)}`,
    );
  }
}

/** SQLite has no schemas: a `schema` there is a configuration mistake, never ignored. */
export function rejectSqliteSchema(schema: string | undefined): void {
  if (schema !== undefined) {
    throw new Error(
      `[nestjs-media] \`schema: ${JSON.stringify(schema)}\` was set, but SQLite has no schemas. Remove \`schema\`, or use the Postgres store (\`@dudousxd/nestjs-media-database-drizzle/pg\`).`,
    );
  }
}

/** `"schema"."table"` for raw SQL, or `"table"` without a schema. */
export function qualified(schema: string | undefined, table: string): string {
  return schema === undefined ? `"${table}"` : `"${schema}"."${table}"`;
}
