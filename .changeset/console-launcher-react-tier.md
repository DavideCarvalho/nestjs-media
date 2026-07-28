---
'@dudousxd/nestjs-media-dashboard': minor
---

**React tier for the console launcher: `useOpenMediaConsole`, `openMediaConsoleMutationOptions` and `<OpenMediaConsoleButton>`, exported from the new `@dudousxd/nestjs-media-dashboard/react` subpath.**

`openMediaConsole` (the headless function shipped last release) left every host re-deriving the same
three things: a `useState` for in-flight, a `useState` for the refusal, and a button that renders
both. That is the same code in every host, and the interesting parts of it — not clearing the
pending state on success, not swallowing the refusal — are exactly the parts a host gets wrong.

Three levels, pick the one that fits:

```tsx
import {
  OpenMediaConsoleButton,     // drop-in, unstyled
  useOpenMediaConsole,        // state for a launcher UI, your markup
  openMediaConsole,           // no React at all — also on ./client
} from '@dudousxd/nestjs-media-dashboard/react';

<OpenMediaConsoleButton className="btn btn-primary" apiBasePath="/api/media" />;
```

`<OpenMediaConsoleButton>` ships **no CSS**: it emits a bare `<button>` and forwards
`className`/`style`/every other button prop, so it inherits the host's design system instead of
importing styles that fight it. It disables itself and sets `aria-busy` while the mint is in flight
(a double-click otherwise fires a second mint that can land after the navigation), and it renders
the refusal by default as `<p role="alert">` — a launcher that silently does nothing reads as broken
rather than forbidden. `renderError` substitutes your own node; `renderError={null}` opts out for a
host that surfaces errors its own way.

`useOpenMediaConsole` gives the same behaviour with your markup. Its `open()` never rejects — read
`error`. It deliberately does **not** clear `isPending` on success: the navigation is already
underway, and flipping back to idle flickers "ready to click again" on a page that is leaving.

`openMediaConsoleMutationOptions` returns the shape `useMutation` takes, so a host already on
TanStack Query wires the launcher into its own cache, devtools and error handling with no adapter —
**and this package never imports `@tanstack/react-query`**, so a host that doesn't use Query pays
nothing. Its key includes both `basePath` and `apiBasePath`, since `apiBasePath` decides which
endpoint mints the session: two mounts differing only in it must not share cache state.

`react` and `react-dom` are **optional** peer dependencies, and the tier lives on its own subpath, so
a host that only mounts `MediaDashboardModule` still never pulls React in.

Additive only: nothing existing changes.
