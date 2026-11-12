---
'@dudousxd/nestjs-media-dashboard': minor
'@dudousxd/nestjs-media-core': minor
'@dudousxd/nestjs-media-testing': minor
'@dudousxd/nestjs-media-database-drizzle': minor
'@dudousxd/nestjs-media-database-mikro-orm': minor
'@dudousxd/nestjs-media-database-prisma': minor
'@dudousxd/nestjs-media-database-typeorm': minor
---

Global search across the Aviary consoles. A console entry may expose `search(context, q, limit)`; `GET <api>/consoles/search?q=` fans out to this console and every other console the viewer may open (300 ms and 5 hits each, `partial: true` when one did not answer). The media console searches files: a library record by exact id, library records whose name or file name contains the text (by the request's tenant), and disk objects whose key starts with it (only when no tenant scope applies). The console gets a Ctrl/Cmd-K search palette, a Search button and a "Search all consoles" item in the switcher menu; hits open the record (`#/library/<id>`) or the file preview. While the switcher runs another console's `authorize`, the request carries `aviaryProbe = true`, so an auditing authorizer can skip it.

`MediaListFilter` gains `nameContains` (name or file name contains the text, ignoring case), implemented by every bundled store and checked by `runMediaStoreConformance`; core exports `matchesNameContains` and `nameContainsPattern` for custom stores.
