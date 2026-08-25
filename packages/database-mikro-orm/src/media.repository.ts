import type { MediaRecord } from '@dudousxd/nestjs-media-core';
import { EntityRepository } from '@mikro-orm/core';

/**
 * Injectable repository for the `media` table.
 *
 * The class is its own DI token: `MediaEntity` declares `repository: () => MediaRepository`, and a
 * host's `MikroOrmModule.forFeature([MediaEntity])` reads that off `MediaEntity.meta` and registers
 * the class as a provider. A host injects `MediaRepository` instead of passing the entity to
 * `em.find()`.
 *
 * Typed on {@link MediaRecord} rather than on `MediaEntity`: the entity value-imports this file for
 * its `repository` thunk, so importing it back would close a runtime module cycle. `MediaRecord` is
 * the row shape `MediaEntity` is built over, so the two are the same type.
 */
export class MediaRepository extends EntityRepository<MediaRecord> {}
