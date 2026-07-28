---
'@dudousxd/nestjs-media-dashboard': minor
---

**`auth.unauthenticatedPage` — hosts can now render the console's unauthenticated page themselves.**

Under Mode A, a visitor navigating straight to `/media` with no cookie got the SPA shell, which then
rendered the built-in auth screen: *"open this console from your application."* Deliberately
generic, because the library cannot know who hosts it — it can't name the host's launcher, link to
it, or look like the rest of the host's product.

```ts
auth: {
  secret: process.env.CONSOLE_SECRET,
  session: (request) => resolveAdmin(request),
  unauthenticatedPage: ({ request, response, basePath }) => {
    (response as Response).status(401).render('console-locked', { returnTo: basePath });
  },
}
```

Unlike `@dudousxd/nestjs-durable-dashboard` and `@dudousxd/nestjs-agent-dashboard`, this console's
auth screen is a React component inside the published bundle — there is no server-rendered page to
replace. So the hook gates the **SPA shell route** instead: the session is checked before the shell
is served, which also means the bundle no longer loads at all for a visitor with no session.

`MediaConsoleApiModule` now **exports** `MEDIA_CONSOLE_AUTH`. `MediaDashboardUiController` is hosted
in `MediaDashboardModule` while the auth provider lives in the API module, so without the export the
controller resolved `null` and the hook would silently never fire. Exporting (rather than
re-providing) keeps a single provider instance — re-providing the same factory would run a
`forRootAsync` host's `useAuth` twice.

**Mode-A-only by design.** With `login` configured the hook is ignored: under Mode B the login form
the visitor needs is *inside* the bundle this page would replace, so gating the shell would lock a
Mode B host out of its own console.

Fail-closed by construction: it only runs when the request has no valid session, and every data
route stays behind `MediaConsoleGuard` regardless — a test asserts the API stays `401` even when the
hook answers `200`. A hook that throws, or returns without writing, logs one warning and serves the
SPA rather than hanging the request or turning a navigation into a `500`.

The index route became non-passthrough `@Res()` so the host can own the response; its
`Content-Type`/`Cache-Control` moved from decorators into the new `sendHtml` helper, unchanged.

Fully backward compatible — omit the option and the shell is served exactly as before, with no
session check on that route at all.
