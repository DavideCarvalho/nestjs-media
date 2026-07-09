import type {
  MediaAggregateQuery,
  MediaAggregateResult,
  MediaCountFilter,
  MediaListFilter,
  MediaListPage,
  MediaListResult,
  MediaRecord,
  MediaStore,
} from '@dudousxd/nestjs-media-core';
import { type DataSource, Table } from 'typeorm';
import { MediaEntity } from './media.entity';

/**
 * Non-destructive schema management (§3.10): create the media table if missing,
 * add any missing columns. Never drops, alters types, or renames. Safe to run at boot.
 */
export async function ensureMediaSchema(dataSource: DataSource): Promise<void> {
  const metadata = dataSource.getMetadata(MediaEntity);
  // Table.create() builds dialect-correct TableColumns from the entity metadata —
  // reuse them for both the initial create and any add-column.
  const table = Table.create(metadata, dataSource.driver);
  const queryRunner = dataSource.createQueryRunner();
  try {
    if (!(await queryRunner.hasTable(metadata.tableName))) {
      await queryRunner.createTable(table, true);
      return;
    }
    for (const column of table.columns) {
      if (!(await queryRunner.hasColumn(metadata.tableName, column.name))) {
        await queryRunner.addColumn(metadata.tableName, column);
      }
    }
  } finally {
    await queryRunner.release();
  }
}

export interface TypeOrmMediaStoreOptions {
  /** Create the table/columns on first use (default true, non-destructive). */
  autoCreateSchema?: boolean;
}

/**
 * MediaStore backed by TypeORM. POJO that receives the DataSource in its
 * constructor (no `@Injectable`, no internal token) — the app plugs it in via
 * MediaModule.forRootAsync's factory.
 */
export class TypeOrmMediaStore implements MediaStore {
  private readonly autoCreateSchema: boolean;
  private ensured: Promise<void> | undefined;

  constructor(
    private readonly dataSource: DataSource,
    options: TypeOrmMediaStoreOptions = {},
  ) {
    this.autoCreateSchema = options.autoCreateSchema ?? true;
  }

  private async ready(): Promise<void> {
    if (!this.autoCreateSchema) return;
    this.ensured ??= ensureMediaSchema(this.dataSource);
    await this.ensured;
  }

  private get repo() {
    return this.dataSource.getRepository(MediaEntity);
  }

  async save(record: MediaRecord): Promise<MediaRecord> {
    await this.ready();
    await this.repo.save(record);
    return record;
  }

  async find(id: string): Promise<MediaRecord | null> {
    await this.ready();
    return this.repo.findOne({ where: { id } });
  }

  async listByOwner(
    ownerType: string,
    ownerId: string,
    collection?: string,
  ): Promise<MediaRecord[]> {
    await this.ready();
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
    return this.repo.count({
      where: {
        ...(filter.ownerType !== undefined ? { ownerType: filter.ownerType } : {}),
        ...(filter.collection !== undefined ? { collection: filter.collection } : {}),
        ...(filter.disk !== undefined ? { disk: filter.disk } : {}),
      },
    });
  }

  async aggregate(query: MediaAggregateQuery): Promise<MediaAggregateResult> {
    await this.ready();
    const rows = await this.repo
      .createQueryBuilder('m')
      .select(`m.${query.groupBy}`, 'key')
      .addSelect('COUNT(*)', 'count')
      .addSelect('SUM(m.size)', 'sumSize')
      .groupBy(`m.${query.groupBy}`)
      .getRawMany<{ key: string; count: string; sumSize: string | null }>();
    return rows.map((row) => ({
      key: row.key,
      count: Number(row.count),
      sumSize: query.sum === 'size' ? Number(row.sumSize ?? 0) : 0,
    }));
  }

  async list(filter: MediaListFilter = {}, page: MediaListPage = {}): Promise<MediaListResult> {
    await this.ready();
    const limit = page.limit ?? 50;
    const qb = this.repo
      .createQueryBuilder('m')
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
