import { MikroORM } from '@mikro-orm/sqlite';
import { describe, expect, it } from 'vitest';
import { MediaEntity, mediaEntity } from './media.entity';
import { MikroOrmMediaStore, ensureMediaSchema } from './mikro-orm-media-store';

describe('the `schema` option', () => {
  it('builds one qualified entity per schema, and leaves MediaEntity unqualified', () => {
    expect(mediaEntity()).toBe(MediaEntity);
    expect(mediaEntity({ schema: 'media' })).toBe(mediaEntity({ schema: 'media' }));
    expect(mediaEntity({ schema: 'media' }).meta.schema).toBe('media');
    expect(mediaEntity({ schema: 'media' }).meta.className).toBe('Media_media');
    expect(MediaEntity.meta.schema).toBeUndefined();
    expect(MediaEntity.meta.className).toBe('Media');
  });

  it('validates the name', () => {
    for (const bad of ['1x', 'a-b', 'a"b', 'x'.repeat(64)]) {
      expect(() => mediaEntity({ schema: bad })).toThrow(/must match/);
    }
  });

  it('SQLite has no schemas: the store and the heal refuse it', async () => {
    const orm = await MikroORM.init({
      dbName: ':memory:',
      entities: [MediaEntity],
      allowGlobalContext: true,
    });
    try {
      expect(() => new MikroOrmMediaStore(orm.em, { schema: 'media' })).toThrow(
        /SQLite has no schemas/,
      );
      await expect(ensureMediaSchema(orm, { schema: 'media' })).rejects.toThrow(
        /SQLite has no schemas/,
      );
      expect(() => new MikroOrmMediaStore(orm.em)).not.toThrow();
    } finally {
      await orm.close(true);
    }
  });
});
