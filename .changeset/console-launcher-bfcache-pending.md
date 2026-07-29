---
'@dudousxd/nestjs-media-dashboard': patch
---

Fix: `useOpenMediaConsole` no longer leaves a stuck spinner after a Back from the console.

`useOpenMediaConsole` deliberately keeps `isPending` true after a successful mint, because the
navigation to the console is already underway and going back to idle flashes "ready to click again"
on a page that is leaving. That reasoning assumed the page is destroyed — but the browser's
back/forward cache does not destroy it. Pressing Back restores the launcher page from memory with
React state intact, so the user returned to a spinner that never stopped, on a button that
`disabled={disabled || isPending}` had locked. The only way out was a manual reload.

The hook now listens for `pageshow` and clears `isPending` when `event.persisted` is true, which is
the only observable signal of a bfcache restore — there is no unmount, no re-render and no fresh
mount to hang the reset off. Everything else is unchanged: `isPending` still stays true right after
a successful mint (the anti-flicker guarantee), and an ordinary `pageshow` from a fresh load is
ignored. The listener is registered in an effect (so SSR never touches `window`) and removed on
unmount.

Covered by four new specs, including one that pins the anti-flicker behaviour so the fix cannot be
"simplified" into clearing the flag on the success path.
