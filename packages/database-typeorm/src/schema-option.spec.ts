import { DataSource } from 'typeorm';
import { describe, expect, it } from 'vitest';
import { MediaEntity, mediaEntity } from './media.entity';
import { TypeOrmMediaStore, ensureMediaSchema } from './typeorm-media-store';

describe('the `schema` option', () => {
  it('builds one qualified entity per schema, and leaves MediaEntity unqualified', () => {
    expect(mediaEntity()).toBe(MediaEntity);
    expect(mediaEntity({ schema: 'media' })).toBe(mediaEntity({ schema: 'media' }));
    expect(mediaEntity({ schema: 'media' }).options).toMatchObject({
      schema: 'media',
      database: 'media',
      tableName: 'media',
    });
    expect(MediaEntity.options).not.toHaveProperty('schema');
  });

  it('validates the name', () => {
    for (const bad of ['1x', 'a-b', 'a"b', 'x'.repeat(64)]) {
      expect(() => mediaEntity({ schema: bad })).toThrow(/must match/);
    }
  });

  it('SQLite has no schemas: the store and the heal refuse it', async () => {
    const dataSource = new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      entities: [MediaEntity],
    });
    await dataSource.initialize();
    try {
      expect(() => new TypeOrmMediaStore(dataSource, { schema: 'media' })).toThrow(
        /better-sqlite3 has no schemas/,
      );
      await expect(ensureMediaSchema(dataSource, { schema: 'media' })).rejects.toThrow(
        /has no schemas/,
      );
      expect(() => new TypeOrmMediaStore(dataSource)).not.toThrow();
    } finally {
      await dataSource.destroy();
    }
  });
});
