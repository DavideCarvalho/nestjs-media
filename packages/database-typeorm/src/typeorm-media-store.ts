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
import {
  type DataSource,
  type FindOptionsWhere,
  IsNull,
  type SelectQueryBuilder,
  Table,
  type TableIndex,
} from 'typeorm';
import { mediaEntity } from './media.entity';

const TENANT_COLUMN = 'tenant_id';
const TENANT_INDEX = 'idx_media_tenant';

/** Drivers without schemas: a `schema` there fails instead of being ignored. */
const SQLITE_DRIVERS = new Set([
  'sqlite',
  'better-sqlite3',
  'sqljs',
  'capacitor',
  'cordova',
  'expo',
  'nativescript',
  'react-native',
]);

/** Fails when `schema` is set on a driver without schemas (SQLite). */
function assertSchemaSupported(dataSource: DataSource, schema: string | undefined): void {
  if (schema !== undefined && SQLITE_DRIVERS.has(String(dataSource.options.type))) {
    throw new Error(
      `[nestjs-media] \`schema: ${JSON.stringify(schema)}\` was set, but ${dataSource.options.type} has no schemas. Remove \`schema\`, or use Postgres or MySQL.`,
    );
  }
}

function isMysql(dataSource: DataSource): boolean {
  return ['mysql', 'mariadb', 'aurora-mysql'].includes(String(dataSource.options.type));
}

/** `idx_media_tenant` on MySQL, with 191-character prefixes so it fits the key limit. */
async function createMysqlTenantIndex(
  queryRunner: ReturnType<DataSource['createQueryRunner']>,
  dataSource: DataSource,
  path: string,
  index: TableIndex | undefined,
): Promise<void> {
  if (!index) return;
  const quote = (name: string) => dataSource.driver.escape(name);
  const table = path.split('.').map(quote).join('.');
  // The index's database column names (they follow the app's naming strategy).
  const columns = index.columnNames.map((column) => `${quote(column)}(191)`).join(', ');
  await queryRunner.query(`CREATE INDEX ${quote(TENANT_INDEX)} ON ${table} (${columns})`);
}

/** Creates `schema` (Postgres) or the database of that name (MySQL) when it is missing. */
async function createSchema(
  queryRunner: ReturnType<DataSource['createQueryRunner']>,
  dataSource: DataSource,
  schema: string,
): Promise<void> {
  const mysql = isMysql(dataSource);
  try {
    if (mysql) await queryRunner.createDatabase(schema, true);
    else await queryRunner.createSchema(schema, true);
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

export interface EnsureMediaSchemaOptions {
  /**
   * Also add the `tenant_id` column (and its index) to an existing table. Default `false`: an
   * existing table only gets it once tenancy is on. A new table always has it.
   */
  tenancy?: boolean;
  /**
   * The schema (Postgres) or database (MySQL) of the `media` table. Created when missing; every
   * statement names it. Register `mediaEntity({ schema })` in the DataSource.
   */
  schema?: string;
}

/**
 * Non-destructive schema management (§3.10): create the media table if missing,
 * add any missing columns. Never drops, alters types, or renames. Safe to run at boot.
 */
export async function ensureMediaSchema(
  dataSource: DataSource,
  options: EnsureMediaSchemaOptions = {},
): Promise<void> {
  assertSchemaSupported(dataSource, options.schema);
  const metadata = dataSource.getMetadata(mediaEntity({ schema: options.schema }));
  // Table.create() builds dialect-correct TableColumns from the entity metadata —
  // reuse them for both the initial create and any add-column.
  const table = Table.create(metadata, dataSource.driver);
  // `schema.media` (or `database.media`) with a schema: every catalog lookup names it.
  const path = metadata.tablePath;
  // MySQL: the tenant index's four varchar(255) columns pass InnoDB's 3072-byte key limit in
  // utf8mb4, and TypeORM can't declare prefix lengths; it is created with 191-character prefixes.
  const mysql = isMysql(dataSource);
  const tenantIndex = table.indices.find((candidate) => candidate.name === TENANT_INDEX);
  if (mysql) table.indices = table.indices.filter((candidate) => candidate !== tenantIndex);
  const queryRunner = dataSource.createQueryRunner();
  try {
    if (options.schema !== undefined) await createSchema(queryRunner, dataSource, options.schema);
    if (!(await queryRunner.hasTable(path))) {
      await queryRunner.createTable(table, true);
      if (mysql) await createMysqlTenantIndex(queryRunner, dataSource, path, tenantIndex);
      return;
    }
    for (const column of table.columns) {
      if (column.name === TENANT_COLUMN && !options.tenancy) continue;
      if (!(await queryRunner.hasColumn(path, column.name))) {
        await queryRunner.addColumn(path, column);
      }
    }
    if (options.tenancy) {
      const existing = await queryRunner.getTable(path);
      if (!existing?.indices.some((candidate) => candidate.name === TENANT_INDEX)) {
        if (mysql) await createMysqlTenantIndex(queryRunner, dataSource, path, tenantIndex);
        else if (tenantIndex) await queryRunner.createIndex(path, tenantIndex);
      }
    }
  } finally {
    await queryRunner.release();
  }
}

export interface TypeOrmMediaStoreOptions {
  /** Create the table/columns on first use (default true, non-destructive). */
  autoCreateSchema?: boolean;
  /**
   * The schema (Postgres) or database (MySQL) of the `media` table; every statement names it
   * (`search_path` is never used). Register `mediaEntity({ schema })` in the DataSource. Default:
   * unqualified. SQLite has none: setting it throws.
   */
  schema?: string;
}

/**
 * MediaStore backed by TypeORM. POJO that receives the DataSource in its
 * constructor (no `@Injectable`, no internal token) — the app plugs it in via
 * MediaModule.forRootAsync's factory.
 */
export class TypeOrmMediaStore implements MediaStore {
  private readonly autoCreateSchema: boolean;
  private ensured: Promise<void> | undefined;
  private tenancy = false;
  private readonly schema: string | undefined;
  private readonly entity: ReturnType<typeof mediaEntity>;

  constructor(
    private readonly dataSource: DataSource,
    options: TypeOrmMediaStoreOptions = {},
  ) {
    this.autoCreateSchema = options.autoCreateSchema ?? true;
    this.schema = options.schema;
    this.entity = mediaEntity({ schema: options.schema });
    assertSchemaSupported(dataSource, options.schema);
  }

  private async ready(): Promise<void> {
    if (!this.autoCreateSchema) return;
    this.ensured ??= ensureMediaSchema(this.dataSource, this.schemaOption);
    await this.ensured;
  }

  private get schemaOption(): { schema?: string } {
    return this.schema !== undefined ? { schema: this.schema } : {};
  }

  private get repo() {
    return this.dataSource.getRepository(this.entity);
  }

  /**
   * Tenancy: adds the `tenant_id` column and its index when `autoCreateSchema` is on (else checks
   * it exists), then reads and writes it. Called by the library when tenancy is on; until then
   * the column is never touched.
   */
  async enableTenancy(): Promise<void> {
    const tableName = this.dataSource.getMetadata(this.entity).tablePath;
    if (this.autoCreateSchema) {
      await this.ready();
      await ensureMediaSchema(this.dataSource, { tenancy: true, ...this.schemaOption });
    }
    const queryRunner = this.dataSource.createQueryRunner();
    try {
      if (!(await queryRunner.hasColumn(tableName, TENANT_COLUMN))) {
        throw new MediaTenancyUnavailableError(
          `the \`${tableName}\` table has no \`${TENANT_COLUMN}\` column`,
          `Leave \`autoCreateSchema\` on so the store adds it, or add a migration: \`ALTER TABLE ${tableName} ADD COLUMN ${TENANT_COLUMN} varchar NULL; CREATE INDEX ${TENANT_INDEX} ON ${tableName} (${TENANT_COLUMN}, "ownerType", "ownerId", collection);\` (with \`synchronize\`, the entity already declares both).`,
        );
      }
    } finally {
      await queryRunner.release();
    }
    this.tenancy = true;
  }

  /** A query on `m` that also reads `tenant_id` once tenancy is on. */
  private query(): SelectQueryBuilder<MediaRecord> {
    const qb = this.repo.createQueryBuilder('m');
    return this.tenancy ? qb.addSelect('m.tenantId') : qb;
  }

  async save(record: MediaRecord): Promise<MediaRecord> {
    await this.ready();
    const { tenantId, ...rest } = record;
    // Off: the row and the returned record carry no `tenantId`.
    if (!this.tenancy) {
      await this.repo.save(rest);
      return rest;
    }
    // `tenant_id` is never written by the entity (see `MediaEntity`), so it is set by a second
    // statement, in the same transaction: the row is never visible, or left, with another tenant.
    const persisted = { ...rest, tenantId: tenantId ?? null };
    await this.dataSource.transaction(async (manager) => {
      await manager.getRepository(this.entity).save(rest);
      const driver = this.dataSource.driver;
      // `"schema"."media"` with a schema: each part quoted on its own.
      const table = this.dataSource
        .getMetadata(this.entity)
        .tablePath.split('.')
        .map((part) => driver.escape(part))
        .join('.');
      const [sql, parameters] = driver.escapeQueryWithParameters(
        `UPDATE ${table} SET ${driver.escape(TENANT_COLUMN)} = :tenantId WHERE ${driver.escape('id')} = :id`,
        { tenantId: persisted.tenantId, id: record.id },
        {},
      );
      await manager.query(sql, parameters);
    });
    return persisted;
  }

  async find(id: string): Promise<MediaRecord | null> {
    await this.ready();
    if (this.tenancy) return this.query().where('m.id = :id', { id }).getOne();
    return this.repo.findOne({ where: { id } });
  }

  async listByOwner(
    ownerType: string,
    ownerId: string,
    collection?: string,
  ): Promise<MediaRecord[]> {
    await this.ready();
    if (this.tenancy) {
      const qb = this.query()
        .where('m.ownerType = :ownerType AND m.ownerId = :ownerId', { ownerType, ownerId })
        .orderBy('m.order', 'ASC');
      if (collection !== undefined) qb.andWhere('m.collection = :collection', { collection });
      return qb.getMany();
    }
    return this.repo.find({
      where: { ownerType, ownerId, ...(collection !== undefined ? { collection } : {}) },
      order: { order: 'ASC' },
    });
  }

  async delete(id: string): Promise<void> {
    await this.ready();
    await this.repo.delete({ id });
  }

  async nextOrder(ownerType: string, ownerId: string, collection: string): Promise<number> {
    await this.ready();
    const max = await this.repo
      .createQueryBuilder('m')
      .select('MAX(m.order)', 'max')
      .where('m.ownerType = :ownerType AND m.ownerId = :ownerId AND m.collection = :collection', {
        ownerType,
        ownerId,
        collection,
      })
      .getRawOne<{ max: number | null }>();
    return max?.max == null ? 0 : Number(max.max) + 1;
  }

  async count(filter: MediaCountFilter = {}): Promise<number> {
    await this.ready();
    const where: FindOptionsWhere<MediaRecord> = {
      ...(filter.ownerType !== undefined ? { ownerType: filter.ownerType } : {}),
      ...(filter.collection !== undefined ? { collection: filter.collection } : {}),
      ...(filter.disk !== undefined ? { disk: filter.disk } : {}),
    };
    const tenant = filter.tenant;
    if (!tenant) return this.repo.count({ where });
    if (tenant.id === null) return this.repo.count({ where: { ...where, tenantId: IsNull() } });
    return this.repo.count({
      where: tenant.orNull
        ? [
            { ...where, tenantId: tenant.id },
            { ...where, tenantId: IsNull() },
          ]
        : { ...where, tenantId: tenant.id },
    });
  }

  async aggregate(query: MediaAggregateQuery): Promise<MediaAggregateResult> {
    await this.ready();
    const qb = this.repo
      .createQueryBuilder('m')
      .select(`m.${query.groupBy}`, 'key')
      .addSelect('COUNT(*)', 'count')
      .addSelect('SUM(m.size)', 'sumSize')
      .groupBy(`m.${query.groupBy}`);
    if (query.tenant) qb.where(tenantWhere(query.tenant), tenantParameters(query.tenant));
    const rows = await qb.getRawMany<{ key: string; count: string; sumSize: string | null }>();
    return rows.map((row) => ({
      key: row.key,
      count: Number(row.count),
      sumSize: query.sum === 'size' ? Number(row.sumSize ?? 0) : 0,
    }));
  }

  async list(filter: MediaListFilter = {}, page: MediaListPage = {}): Promise<MediaListResult> {
    await this.ready();
    const limit = page.limit ?? 50;
    const qb = this.query()
      .orderBy('m.createdAt', 'ASC')
      .addOrderBy('m.id', 'ASC')
      .take(limit + 1);

    if (filter.ownerType !== undefined) {
      qb.andWhere('m.ownerType = :ownerType', { ownerType: filter.ownerType });
    }
    if (filter.collection !== undefined) {
      qb.andWhere('m.collection = :collection', { collection: filter.collection });
    }
    if (filter.disk !== undefined) {
      qb.andWhere('m.disk = :disk', { disk: filter.disk });
    }
    if (filter.tenant) {
      qb.andWhere(tenantWhere(filter.tenant), tenantParameters(filter.tenant));
    }
    if (filter.nameContains !== undefined) {
      // Case-insensitive substring; `!` escapes `%`, `_` and itself so they match literally.
      qb.andWhere(
        "(LOWER(m.name) LIKE :namePattern ESCAPE '!' OR LOWER(m.fileName) LIKE :namePattern ESCAPE '!')",
        {
          namePattern: `%${filter.nameContains.toLowerCase().replace(/[!%_]/g, (c) => `!${c}`)}%`,
        },
      );
    }
    const decodedCursor = page.cursor !== undefined ? this.decodeCursor(page.cursor) : null;
    if (decodedCursor) {
      qb.andWhere(
        '(m.createdAt > :cursorCreatedAt OR (m.createdAt = :cursorCreatedAt AND m.id > :cursorId))',
        { cursorCreatedAt: decodedCursor.createdAt, cursorId: decodedCursor.id },
      );
    }

    const rows = await qb.getMany();
    const hasNextPage = rows.length > limit;
    const records = hasNextPage ? rows.slice(0, limit) : rows;
    const lastRecord = records[records.length - 1];
    return {
      records,
      ...(hasNextPage && lastRecord ? { cursor: this.encodeCursor(lastRecord) } : {}),
    };
  }

  private encodeCursor(record: MediaRecord): string {
    return Buffer.from(`${record.createdAt.toISOString()}|${record.id}`).toString('base64');
  }

  private decodeCursor(cursor: string): { createdAt: string; id: string } | null {
    const decoded = Buffer.from(cursor, 'base64').toString('utf8');
    const separatorIndex = decoded.indexOf('|');
    if (separatorIndex === -1) return null;
    return {
      createdAt: decoded.slice(0, separatorIndex),
      id: decoded.slice(separatorIndex + 1),
    };
  }
}

/** The matching rule as a `WHERE` on alias `m` (parameter `tenantId`). */
function tenantWhere(match: MediaTenantMatch): string {
  if (match.id === null) return 'm.tenantId IS NULL';
  return match.orNull ? '(m.tenantId = :tenantId OR m.tenantId IS NULL)' : 'm.tenantId = :tenantId';
}

function tenantParameters(match: MediaTenantMatch | undefined): Record<string, unknown> {
  return match?.id != null ? { tenantId: match.id } : {};
}
