---
'@dudousxd/nestjs-media-dashboard': minor
---

Add first-class `guards` (`Array<Type<CanActivate> | CanActivate>`) and `imports` options to
`MediaDashboardModule.forRoot`/`forRootAsync`, mirroring `@dudousxd/nestjs-agent`'s dashboard
module and `@dudousxd/nestjs-telescope`'s console guards. Hosts with header-only auth can't gate a
full-page navigation to the console (browsers send only cookies, never an `Authorization` header),
so there was previously no seam to hang a cookie/session guard on the page controller.

`guards` fronts BOTH surfaces: the page/asset controller (`MediaDashboardUiController` — a plain
REPLACE, it ships with no guard of its own) and the read + action JSON API controllers (APPENDED to
their own built-in `MediaConsoleGuard` session-cookie gate via a `stampGuards` helper, so a request
must pass both). It is deliberately NOT applied to the auth controller that mints that session
cookie — it can't require the very auth it grants. `guards` and the built-in `auth` cookie login
compose (set one, the other, or both).

Adds a "Securing the console with your own guards" docs section
(`website/content/docs/packages/dashboard.mdx`, a new package doc page).
