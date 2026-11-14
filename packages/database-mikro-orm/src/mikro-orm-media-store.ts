import type {
  MediaAggregateQuery,
  MediaAggregateResult,
  MediaCountFilter,
  MediaListFilter,
  MediaListPage,
  MediaListResult,
  MediaRecord,
  MediaStore,
  MediaTenantMatch,
} from '@dudousxd/nestjs-media-core';
import { MediaTenancyUnavailableError } from '@dudousxd/nestjs-media-core';
import type { EntityManager, FilterQuery, MikroORM } from '@mikro-orm/core';
import { mediaEntity } from './media.entity';

/** Opaque keyset cursor over `(createdAt, id)`; matches the in-memory store's encoding. */
function encodeListCursor(record: MediaRecord): string {
  return Buffer.from(`${record.createdAt.toISOString()}|${record.id}`, 'utf8').toString('base64');
}

interface DecodedListCursor {
  createdAt: Date;
  id: string;
}

/**
 * Whether `cursor` is exactly what {@link encodeListCursor} produces for some record: base64 of
 * `<ISO createdAt>|<id>`, canonical (it re-encodes to itself), with a real timestamp and an id.
 */
function isEncodedListCursor(cursor: string): boolean {
  const decoded = Buffer.from(cursor, 'base64').toString('utf8');
  if (Buffer.from(decoded, 'utf8').toString('base64') !== cursor) return false;
  const separator = decoded.indexOf('|');
  if (separator === -1 || separator === decoded.length - 1) return false;
  const createdAt = decoded.slice(0, separator);
  const date = new Date(createdAt);
  return !Number.isNaN(date.getTime()) && date.toISOString() === createdAt;
}

function decodeListCursor(cursor: string): DecodedListCursor | null {
  const decoded = Buffer.from(cursor, 'base64').toString('utf8');
  const separator = decoded.indexOf('|');
  if (separator === -1) return null;
  const createdAt = new Date(decoded.slice(0, separator));
  if (Number.isNaN(createdAt.getTime())) return null;
  return { createdAt, id: decoded.slice(separator + 1) };
}

/** The matching rule as a MikroORM filter on `tenantId`. */
function tenantWhere(match: MediaTenantMatch): FilterQuery<MediaRecord> {
  if (match.id === null) return { tenantId: null };
  return match.orNull
    ? { $or: [{ tenantId: match.id }, { tenantId: null }] }
    : { tenantId: match.id };
}

/** The dialect family of an EntityManager, from its platform. */
function dialectOf(em: EntityManager): 'postgres' | 'mysql' | 'sqlite' | 'other' {
  const name = em.getPlatform().constructor.name.toLowerCase();
  if (name.includes('postgre')) return 'postgres';
  if (name.includes('mysql') || name.includes('maria')) return 'mysql';
  if (name.includes('sqlite') || name.includes('libsql')) return 'sqlite';
  return 'other';
}

/** SQLite has no schemas: a `schema` there fails instead of being ignored. */
function assertSchemaSupported(em: EntityManager, schema: string | undefined): void {
  if (schema !== undefined && dialectOf(em) === 'sqlite') {
    throw new Error(
      `[nestjs-media] \`schema: ${JSON.stringify(schema)}\` was set, but SQLite has no schemas. Remove \`schema\`, or use Postgres or MySQL.`,
    );
  }
}

/** `media`, or `"schema"."media"` (`` `db`.`media` `` on MySQL), for the store's raw SQL. */
function mediaTableSql(em: EntityManager, schema: string | undefined): string {
  if (schema === undefined) return 'media';
  const platform = em.getPlatform();
  return `${platform.quoteIdentifier(schema)}.${platform.quoteIdentifier('media')}`;
}

/** The matching rule as raw SQL for {@link MikroOrmMediaStore.aggregate}. */
function tenantSql(match: MediaTenantMatch | undefined): { sql: string; params: unknown[] } {
  if (!match) return { sql: '', params: [] };
  if (match.id === null) return { sql: ' where tenant_id is null', params: [] };
  return match.orNull
    ? { sql: ' where (tenant_id = ? or tenant_id is null)', params: [match.id] }
    : { sql: ' where tenant_id = ?', params: [match.id] };
}

/** `MediaListFilter.nameContains`: `name` or `fileName` contains `text`, ignoring case. */
function matchesName(record: MediaRecord, text: string | undefined): boolean {
  if (text === undefined) return true;
  const needle = text.toLowerCase();
  return (
    record.name.toLowerCase().includes(needle) || record.fileName.toLowerCase().includes(needle)
  );
}

/**
 * A `LIKE` filter that keeps at least every record {@link matchesName} keeps: `%`, `_` and a backslash
 * become `_` (any one character), so no escape syntax is needed on any dialect. `ilike` on Postgres,
 * `like` elsewhere (case-insensitive by default on MySQL and, for ASCII, on SQLite). The rows are
 * then filtered exactly with {@link matchesName}.
 */
function nameWhere(em: EntityManager, text: string): FilterQuery<MediaRecord> {
  const pattern = `%${text.replace(/[\\%_]/g, '_')}%`;
  const postgres = /postgre/i.test(em.getPlatform().constructor.name);
  const like = postgres ? { $ilike: pattern } : { $like: pattern };
  return { $or: [{ name: like }, { fileName: like }] };
}

export interface EnsureMediaSchemaOptions {
  /**
   * The schema (Postgres) or database (MySQL) of `mediaEntity({ schema })`: created when missing,
   * before the update. SQLite has none: setting it throws.
   */
  schema?: string;
}

/**
 * Non-destructive schema management (§3.10). MikroORM gets create + add-column for
 * free via `updateSchema({ safe: true })` — it never drops or alters existing columns.
 * With `schema`, the schema (or MySQL database) is created first; register
 * `mediaEntity({ schema })` so every table and index lands in it.
 */
export async function ensureMediaSchema(
  orm: MikroORM,
  options: EnsureMediaSchemaOptions = {},
): Promise<void> {
  const schema = options.schema;
  if (schema !== undefined) {
    const em = orm.em;
    assertSchemaSupported(em, schema);
    mediaEntity({ schema });
    const mysql = dialectOf(em) === 'mysql';
    const name = em.getPlatform().quoteIdentifier(schema);
    try {
      await em
        .getConnection()
        .execute(
          mysql ? `create database if not exists ${name}` : `create schema if not exists ${name}`,
        );
    } catch (error) {
      throw Object.assign(
        new Error(
          mysql
            ? `[nestjs-media] could not create the database \`${schema}\`. Create it yourself, or grant the user CREATE: GRANT CREATE ON \`${schema}\`.* TO <user>. (${(error as Error).message})`
            : `[nestjs-media] could not create the schema "${schema}". Create it yourself, or grant the role CREATE on the database: GRANT CREATE ON DATABASE <db> TO <role>. (${(error as Error).message})`,
        ),
        { cause: error },
      );
    }
  }
  if (schema === undefined) {
    if (dialectOf(orm.em) === 'mysql') await updateOnMysql(orm.em);
    else await orm.schema.update({ safe: true });
    return;
  }
  await healInSchema(orm.em, schema);
}

/**
 * `orm.schema.update({ safe: true })` on MySQL, with `idx_media_tenant` created with column
 * prefixes (see {@link withTenantIndexPrefixes}): MikroORM's own update would create it whole,
 * and MySQL rejects the key. Every other statement runs as MikroORM generated it.
 */
async function updateOnMysql(em: EntityManager): Promise<void> {
  const generator = em.getPlatform().getSchemaGenerator(em.getDriver()) as unknown as {
    getUpdateSchemaSQL(options: { safe: boolean; wrap: boolean }): Promise<string>;
  };
  const sql = await generator.getUpdateSchemaSQL({ safe: true, wrap: false });
  for (const statement of splitStatements(sql)) {
    await em.getConnection().execute(withTenantIndexPrefixes(statement));
  }
}

function splitStatements(sql: string): string[] {
  return sql
    .split(/;\s*\n/)
    .map((statement) => statement.trim().replace(/;$/, ''))
    .filter((statement) => statement !== '');
}

/**
 * The additive update of the `media` table in `schema`, and nothing else: the generator diffs the
 * app's whole model, so only the statements on `schema`'s `media` table run.
 */
async function healInSchema(em: EntityManager, schema: string): Promise<void> {
  const platform = em.getPlatform();
  const generator = platform.getSchemaGenerator(driverIn(em, schema)) as unknown as {
    getUpdateSchemaSQL(options: { safe: boolean; wrap: boolean }): Promise<string>;
  };
  const sql = await generator.getUpdateSchemaSQL({ safe: true, wrap: false });
  const table = `${platform.quoteIdentifier(schema)}.${platform.quoteIdentifier('media')}`;
  const statements = splitStatements(sql).filter((statement) => statement.includes(table));
  const mysql = dialectOf(em) === 'mysql';
  for (const statement of statements) {
    await em.getConnection().execute(mysql ? withTenantIndexPrefixes(statement) : statement);
  }
}

/**
 * MySQL: `idx_media_tenant`'s four varchar(255) utf8mb4 columns pass InnoDB's 3072-byte key limit,
 * so its columns get a 191-character prefix.
 */
function withTenantIndexPrefixes(statement: string): string {
  if (!/`idx_media_tenant`/.test(statement)) return statement;
  return statement.replace(/\(([^()]+)\)\s*$/, (_match, columns: string) => {
    const prefixed = columns
      .split(',')
      .map((column) => `${column.trim()}(191)`)
      .join(', ');
    return `(${prefixed})`;
  });
}

/** The catalog filters MikroORM's MySQL introspection pins to the connection's current database. */
const MYSQL_CATALOG_FILTER =
  /\b(table_schema|constraint_schema|routine_schema|specific_schema|event_object_schema)\s*=\s*(?:database|schema)\(\)/gi;

/**
 * The driver the schema generator reads, for `schema`. MikroORM introspects MySQL only in the
 * connection's current database (`table_schema = database()`), so it would never see a `media`
 * table in another one and create it again on every boot. On MySQL this view rewrites those
 * catalog filters, in the generator's `information_schema` reads alone, to the configured database.
 * Nothing switches the session's database (`USE`), which would leak to the next user of the pooled
 * connection. Other dialects get the driver as it is.
 */
function driverIn(em: EntityManager, schema: string): ReturnType<EntityManager['getDriver']> {
  const driver = em.getDriver();
  if (dialectOf(em) !== 'mysql') return driver;
  const connection = driver.getConnection();
  const view = new Proxy(connection, {
    get(target, property) {
      if (property === 'execute') {
        return (query: unknown, ...rest: unknown[]) =>
          (target.execute as (...args: unknown[]) => unknown).call(
            target,
            typeof query === 'string' && /information_schema/i.test(query)
              ? query.replace(
                  MYSQL_CATALOG_FILTER,
                  (_match, column: string) => `${column} = '${schema}'`,
                )
              : query,
            ...rest,
          );
      }
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  return new Proxy(driver, {
    get(target, property) {
      if (property === 'getConnection') return () => view;
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

export interface MikroOrmMediaStoreOptions {
  /**
   * The schema (Postgres) or database (MySQL) of the `media` table; every statement names it
   * (`search_path` is never used). Register `mediaEntity({ schema })` in the ORM. Default:
   * unqualified. SQLite has none: setting it throws.
   */
  schema?: string;
}

/**
 * MediaStore backed by MikroORM. POJO receiving an EntityManager; each operation
 * runs on a fork to avoid cross-request identity-map bleed.
 */
export class MikroOrmMediaStore implements MediaStore {
  private tenancy = false;
  private readonly entity: ReturnType<typeof mediaEntity>;
  private readonly table: string;

  constructor(
    private readonly em: EntityManager,
    options: MikroOrmMediaStoreOptions = {},
  ) {
    assertSchemaSupported(em, options.schema);
    this.entity = mediaEntity({ schema: options.schema });
    this.table = mediaTableSql(em, options.schema);
  }

  /**
   * Tenancy: checks the `tenant_id` column exists, then reads and writes it. Called by the
   * library when tenancy is on; until then the column is never touched.
   */
  async enableTenancy(): Promise<void> {
    try {
      await this.em.fork().getConnection().execute(`select tenant_id from ${this.table} limit 1`);
    } catch (error) {
      throw Object.assign(
        new MediaTenancyUnavailableError(
          'the `media` table has no `tenant_id` column',
          'Run `ensureMediaSchema(orm)` (or `orm.schema.update({ safe: true })`), or create a migration with the MikroORM CLI: `mediaEntity()` declares `tenant_id` and the `idx_media_tenant` index.',
        ),
        { cause: error },
      );
    }
    this.tenancy = true;
  }

  /** `populate` that loads the lazy `tenantId` once tenancy is on. */
  private get withTenant() {
    return this.tenancy ? { populate: ['tenantId'] as never } : {};
  }

  async save(record: MediaRecord): Promise<MediaRecord> {
    const em = this.em.fork();
    const { tenantId, ...rest } = record;
    const data = this.tenancy ? { ...rest, tenantId: tenantId ?? null } : rest;
    await em.upsert(this.entity, data);
    // What was persisted: off, no `tenantId`.
    return data;
  }

  async find(id: string): Promise<MediaRecord | null> {
    const em = this.em.fork();
    return em.findOne(this.entity, { id }, this.withTenant);
  }

  async listByOwner(
    ownerType: string,
    ownerId: string,
    collection?: string,
  ): Promise<MediaRecord[]> {
    const em = this.em.fork();
    return em.find(
      this.entity,
      { ownerType, ownerId, ...(collection !== undefined ? { collection } : {}) },
      { orderBy: { order: 'asc' }, ...this.withTenant },
    );
  }

  async delete(id: string): Promise<void> {
    const em = this.em.fork();
    await em.nativeDelete(this.entity, { id });
  }

  async nextOrder(ownerType: string, ownerId: string, collection: string): Promise<number> {
    const em = this.em.fork();
    const rows = await em.find(this.entity, { ownerType, ownerId, collection });
    return rows.reduce((max, r) => Math.max(max, r.order + 1), 0);
  }

  async count(filter: MediaCountFilter = {}): Promise<number> {
    const em = this.em.fork();
    const where: FilterQuery<MediaRecord> = {
      ...(filter.ownerType !== undefined ? { ownerType: filter.ownerType } : {}),
      ...(filter.collection !== undefined ? { collection: filter.collection } : {}),
      ...(filter.disk !== undefined ? { disk: filter.disk } : {}),
    };
    return em.count(
      this.entity,
      filter.tenant ? { $and: [where, tenantWhere(filter.tenant)] } : where,
    );
  }

  async aggregate(query: MediaAggregateQuery): Promise<MediaAggregateResult> {
    const em = this.em.fork();
    const tenant = tenantSql(query.tenant);
    const rows: Array<{ key: string; count: number | string; sumSize: number | string | null }> =
      await em
        .getConnection()
        .execute<Array<{ key: string; count: number | string; sumSize: number | string | null }>>(
          `select ${query.groupBy} as "key", count(*) as "count", sum(size) as "sumSize" from ${this.table}${tenant.sql} group by ${query.groupBy}`,
          tenant.params,
          'all',
        );
    return rows.map((row) => ({
      key: row.key,
      count: Number(row.count),
      sumSize: query.sum === 'size' ? Number(row.sumSize ?? 0) : 0,
    }));
  }

  /** {@inheritDoc MediaStore.isListCursor} */
  isListCursor(cursor: string): boolean {
    return isEncodedListCursor(cursor);
  }

  async list(filter: MediaListFilter = {}, page: MediaListPage = {}): Promise<MediaListResult> {
    const em = this.em.fork();
    const limit = page.limit ?? 50;
    const cursor = page.cursor !== undefined ? decodeListCursor(page.cursor) : null;

    const where: FilterQuery<MediaRecord> = {
      ...(filter.ownerType !== undefined ? { ownerType: filter.ownerType } : {}),
      ...(filter.collection !== undefined ? { collection: filter.collection } : {}),
      ...(filter.disk !== undefined ? { disk: filter.disk } : {}),
      ...(cursor !== null
        ? {
            $or: [
              { createdAt: { $gt: cursor.createdAt } },
              { createdAt: cursor.createdAt, id: { $gt: cursor.id } },
            ],
          }
        : {}),
    };

    const and = [
      ...(filter.tenant ? [tenantWhere(filter.tenant)] : []),
      ...(filter.nameContains !== undefined ? [nameWhere(em, filter.nameContains)] : []),
    ];
    const rows = await em.find(this.entity, and.length > 0 ? { $and: [where, ...and] } : where, {
      orderBy: { createdAt: 'asc', id: 'asc' },
      limit: limit + 1,
      ...this.withTenant,
    });

    const hasMore = rows.length > limit;
    const read = rows.slice(0, limit);
    // The cursor follows the last row read, so a page the exact name check thinned stays in order.
    const last = read[read.length - 1];
    const result: MediaListResult = {
      records: read.filter((record) => matchesName(record, filter.nameContains)),
    };
    if (hasMore && last !== undefined) {
      result.cursor = encodeListCursor(last);
    }
    return result;
  }
}
