import { EntityRepository } from '@mikro-orm/core';
import { MikroORM } from '@mikro-orm/sqlite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as pkg from './index';
import { MediaEntity } from './media.entity';
import { MediaRepository } from './media.repository';

describe('MediaRepository export', () => {
  it('is a runtime class on the package barrel', () => {
    // A repository is a VALUE: an `export type` slip compiles and typechecks green and is
    // `undefined` at runtime — and it is the `provide:` of a host's DI provider, so the failure
    // would land at that host's boot rather than here.
    expect(typeof (pkg as Record<string, unknown>).MediaRepository).toBe('function');
    expect((pkg as Record<string, unknown>).MediaRepository).toBe(MediaRepository);
    expect(Object.getPrototypeOf(MediaRepository)).toBe(EntityRepository);
  });

  it('exports no `Repository`-suffixed name that is missing at runtime', () => {
    const exported = Object.keys(pkg).filter((name) => name.endsWith('Repository'));

    expect(exported).toEqual(['MediaRepository']);
  });

  it('is on the entity metadata, which is what a host reads to derive the DI token', () => {
    expect(MediaEntity.meta.repository?.()).toBe(MediaRepository);
  });
});

describe('em.getRepository resolution (sqlite)', () => {
  let orm: MikroORM;

  beforeAll(async () => {
    orm = await MikroORM.init({
      dbName: ':memory:',
      entities: [MediaEntity],
      allowGlobalContext: true,
    });
  });

  afterAll(async () => {
    await orm.close(true);
  });

  it('hands back a MediaRepository for MediaEntity', () => {
    expect(orm.em.getRepository(MediaEntity)).toBeInstanceOf(MediaRepository);
  });
});
