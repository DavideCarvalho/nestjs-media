---
'@dudousxd/nestjs-media-dashboard': minor
---

The console moves onto the shared Aviary console kit: a sidebar shell (console switcher, LIBRARY · Library / Collections, TRANSFERS · Uploads / Disks, signed-in user, light/dark toggle, sign-out), a topbar with the disk and subsystem status, the live indicator and ⌘K, bundled Sora + JetBrains Mono (no Google Fonts), Tailwind 4 + React 19, shaped skeletons, error boundaries and empty states, light mode, and a phone-width drawer. A new Collections page (`#/collections`) lists every collection with its record count and size. Every other page, hash route, deep link, preview and the access-denied page are kept.

⌘K lists the console's pages first and searches each console on its own, streaming the groups in as they answer (`GET <api>/consoles/search?q=&console=<id>` answers for one console). New `MediaDashboardModule.forRoot` / `forRootAsync` options feed the sidebar footer: `viewer: (request) => ({ label, email?, role? })` (default: `request.user` read structurally) and `signOut: '/path' | { href } | { action, csrfToken? } | false` (default: the `account.signOut` an account console announces on the Aviary consoles registry). `MediaDashboardUiController.index()` is now async and takes the request.
