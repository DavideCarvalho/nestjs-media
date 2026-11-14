---
'@dudousxd/nestjs-media-database-mikro-orm': patch
---

`ensureMediaSchema(orm)` works on MySQL without `schema`. MikroORM's own update created `idx_media_tenant` (four `varchar(255)` columns) whole, which is over InnoDB's 3072-byte key limit in `utf8mb4`, so the `media` table could not be created. On MySQL it now runs the same safe update with that index's columns given 191-character prefixes, as the `schema` heal already did. Postgres and SQLite are unchanged.
