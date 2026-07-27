---
'@dudousxd/nestjs-media-dashboard': minor
---

Console session sliding renewal now re-checks the user: add an optional `auth.revalidate` hook, called at most once per `ttl/2` per session on the renewal path.

Previously, sliding renewal re-issued the session cookie without ever consulting the host, so a deactivated or demoted operator kept console access for as long as the tab stayed open. `auth.revalidate(session)` receives the already-minted session (not a raw request — the console's own XHRs carry no host credential) and returning `false` (or throwing) clears the cookie and denies the request with the same 401 an absent cookie gets. `revalidate` is not an auth mode on its own — it cannot mint a session — and behavior is unchanged when it's omitted.
