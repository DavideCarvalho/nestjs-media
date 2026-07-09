import type {
  MediaAggregateQuery,
  MediaAggregateResult,
  MediaCountFilter,
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
}
