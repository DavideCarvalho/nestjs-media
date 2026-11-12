---
'@dudousxd/nestjs-media-core': minor
'@dudousxd/nestjs-media': minor
'@dudousxd/nestjs-media-dashboard': minor
---

The full tenancy contract of `@dudousxd/nestjs-context` (2.1+), feature-detected so older contexts keep working. Media's reader is now the context's reference reader, so `tenancy.kinds` scopes by the matching level of a nested tenant chain (`kinds: ['clinic']` stamps and reads the clinic of a unit), and the `tenancy` option gains `family` and `required` (a read or write with no tenant throws the context's `TenantRequiredError`, 403; the boot check never does). New `tenancy.pathPrefix` (default `false`): new library files of a tenant are stored under `t/<tenantId>/`; existing files never move. The console shows each library record's and upload session's organization (`tenant: { id, label }`, labelled by the context's `tenancy.label`, else the id), and its search finds a tenant's own `t/<tenantId>/` objects and answers no hits instead of failing when a tenant is required. Core exports `tenantLabels`, `tenantPathPrefix` and the `MediaTenantLevel` type.
