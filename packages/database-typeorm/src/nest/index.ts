// `@dudousxd/nestjs-media-database-typeorm/nest` — the store built from a `@nestjs/typeorm`
// connection. Its own entry so the root never loads `@nestjs/typeorm` (an optional peer).
import { getDataSourceToken } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { TypeOrmMediaStore, type TypeOrmMediaStoreOptions } from '../typeorm-media-store';

export interface TypeOrmMediaStoreFactoryOptions extends TypeOrmMediaStoreOptions {
  /** The `@nestjs/typeorm` connection (`TypeOrmModule.forRoot({ name })`). Default: the default one. */
  connectionName?: string;
}

/**
 * The media store on a `TypeOrmModule` connection, for `MediaModule.forRoot({ store })` (or the
 * static `store` of `forRootAsync`): Nest injects the connection's `DataSource`.
 *
 * ```ts
 * MediaModule.forRoot({ store: typeOrmMediaStore({ connectionName: 'media' }) })
 * ```
 */
export function typeOrmMediaStore(options: TypeOrmMediaStoreFactoryOptions = {}): {
  inject: ReturnType<typeof getDataSourceToken>[];
  useFactory: (dataSource: DataSource) => TypeOrmMediaStore;
} {
  const { connectionName, ...storeOptions } = options;
  return {
    inject: [getDataSourceToken(connectionName)],
    useFactory: (dataSource) => new TypeOrmMediaStore(dataSource, storeOptions),
  };
}
