---
"@dudousxd/nestjs-media-dashboard": minor
---

Add a built-in login gate to the console, telescope-style. Pass `auth: { secret, login?, session? }` to `MediaDashboardModule.forRoot(...)` and the console (SPA + API) sits behind a signed, stateless HMAC session cookie: the SPA renders a login screen until a valid cookie exists, `login`/`session` hooks validate the credentials/request, and the read + action controllers are gated (401 → the SPA shows the login screen). Omit `auth` to leave the console open as before. No new runtime dependency — `node:crypto` only.
