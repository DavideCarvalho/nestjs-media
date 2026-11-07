import { getDataSourceToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { describe, expect, it } from 'vitest';
import { TypeOrmMediaStore } from '../typeorm-media-store';
import { typeOrmMediaStore } from './index';

describe('typeOrmMediaStore()', () => {
  it('injects the named @nestjs/typeorm connection and builds the store on it', () => {
    const factory = typeOrmMediaStore({ connectionName: 'media', autoCreateSchema: false });
    expect(factory.inject).toEqual([getDataSourceToken('media')]);
    expect(factory.inject).toEqual(['mediaDataSource']);
    const store = factory.useFactory({} as DataSource);
    expect(store).toBeInstanceOf(TypeOrmMediaStore);
  });

  it('defaults to the default connection', () => {
    expect(typeOrmMediaStore().inject).toEqual([DataSource]);
  });
});
