---
'@dudousxd/nestjs-media-database-mikro-orm': minor
---

Inject a media repository by type, instead of passing the entity to `em.find()`.

Reading a media row meant asking for the `EntityManager` and naming the entity at every call site —
`em.find(MediaEntity, ...)` — so the entity had to be imported everywhere and no query had a home to
live in.

`MediaEntity` now declares a custom repository, so a host's `MikroOrmModule.forFeature([MediaEntity])`
reads it off the entity metadata and registers the class as its own DI token. Nothing else changes:
the package stays Nest-free and gains no dependency.

```ts
constructor(private readonly media: MediaRepository) {}

const banners = await this.media.find({ collection: 'banners' });
```

`MediaRepository` is exported from the package root. `MikroOrmMediaStore` and plain `EntityManager`
access keep working exactly as before, and the `media` table's shape is untouched.
