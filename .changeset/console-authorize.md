---
"@dudousxd/nestjs-media-dashboard": minor
---

The `/media` console takes one `authorize` option, shared by every Aviary console.

- `MediaDashboardModule.forRoot/forRootAsync({ authorize })` (and `MediaConsoleApiModule.register`) decides who may use the console: the page, its assets and the JSON API. It accepts an inline function `(ctx) => …`, an `@Injectable()` class implementing `ConsoleAuthorizer`, a lazy `() => import(...)`, an `@nestjs/authorization` policy `{ policy, ability }`, or a gate name resolved by `@dudousxd/nestjs-authz`. It runs after your `decorators`, so your authentication guards set `request.user` first.
- Denials: 403 `{ error: 'forbidden' }`, 401 `{ error: 'unauthenticated' }`; a page navigation gets an "Access denied" (403) or "Sign in required" (401) page instead; `{ redirectTo }` is a 302 for a page navigation and 401 `{ error: 'unauthenticated', redirectTo }` for an API call; a throw is a 403. The SPA shows an access-denied state on 403 and follows `redirectTo` on 401.
- New exports: the contract types (`ConsoleAuthorize`, `ConsoleAuthorizer`, `ConsoleAuthorizeResult`, …), `authorizeByToken({ token })` (Bearer header, constant-time compare), `resolveConsoleAuthorize`, `normalizeConsoleResult`, `ConsoleAuthorizeGuard`, `ConsoleAuthorizeFilter`, `ConsoleAccessDenied`, and `UseConsoleAuthorize()` (guard + filter in one decorator) for consoles mounted with `routes: false`. The `/client` entry adds `ConsoleAccessError` and `onConsoleAccessDenied`.
- **Breaking:** the production boot refusal for the console is removed, and `decorators` no longer count as protection. Without `authorize` the console is open outside production; in production it boots, answers 403 to every request and logs one warning (also with `routes: false`). Set `authorize`. Before: `forRoot({ decorators: [UseGuards(AuthenticationGuard), Can(MediaPolicy, 'console')] })`. After: `forRoot({ decorators: [UseGuards(AuthenticationGuard)], authorize: { policy: MediaPolicy, ability: 'console' } })`.
- `@nestjs/authorization` is an optional peer, needed only for the `{ policy, ability }` form.

The upload routes on `MediaModule` and its `authorize(user, action, subject)` hook are unchanged.
