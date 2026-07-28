---
'@dudousxd/nestjs-media-dashboard': patch
---

Fix: scope the console session cookie to `/` so it reaches the SPA shell.

The cookie was scoped to `apiBasePath`. When a host mounts the API outside `basePath` — e.g. a
`/media` UI with a `/api/media/console` API — the browser withheld the cookie on the full-page
navigation to `basePath`, so a freshly minted session could not open the console it had just been
minted for. The launcher landed on the unauthenticated page, which reads as "you lack access".

This surfaced once the SPA shell itself became gated (0.10.0). Before that only the JSON API was
guarded, and a cookie scoped to the API base was enough.

`Path=/` now matches `@dudousxd/nestjs-durable-dashboard` and `@dudousxd/nestjs-agent-dashboard`,
which reached the same conclusion for the same reason. (`@dudousxd/nestjs-telescope-ui` correctly
keeps its narrower mount-scoped cookie: it has a single `path` option, so its UI and API always
share one root and a tighter scope is both correct and safer.)

Guarded by a new spec that reads the `Path` attribute and applies the RFC 6265 path-match rule.
Every existing test replayed the cookie as `setCookie.split(';')[0]`, discarding the attribute that
was wrong — `fetch` and supertest send whatever header they are handed, so no amount of round-trip
testing through them could have caught this.
