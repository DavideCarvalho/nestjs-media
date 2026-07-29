---
'@dudousxd/nestjs-media-dashboard': minor
---

Adopt the canonical Aviary console tokens and rebuild the console's UI kit on shadcn/Base UI.

- `src/app/styles.css` gains the shared `--panel-2`, `--good`, `--warn` and `--bad` tokens, with a
  pointer to `AVIARY-UI.md` as the source of truth. The status classes (`.s-ok`, `.s-warn`,
  `.s-error`) and the backdrop glow now read those tokens instead of repeating the hexes.
- Tailwind maps the shadcn vocabulary (`bg-background`, `border-border`, `bg-primary`, …) onto those
  tokens, so vendored primitives look like this console rather than like default shadcn. Every
  hard-coded `emerald-*` / `rose-*` / `[var(--line)]` class in the app now goes through a token,
  which means changing `--accent` changes the whole console.
- The hand-rolled `Button` / `GhostButton` / `Notice` are folded into vendored shadcn primitives
  under `src/app/ui/` (`button.tsx` with `cva` + Base UI `useRender`, `alert.tsx`, `dialog.tsx`),
  plus a `cn()` helper. `Button`'s `tone` values are semantic (`accent` / `destructive` / `ghost` /
  `quiet` / `selected`) rather than hue names.
- `Modal` and the object-preview `Lightbox` are now the shadcn/Base UI Dialog: a real focus trap,
  focus restored to whatever opened them, scroll lock, `aria-modal` with the title wired by id, and
  `initialFocus` (which selects the text in a rename/copy field) instead of a `useEffect` race.

New dependencies for the bundled SPA: `@base-ui-components/react`, `class-variance-authority`,
`clsx`, `tailwind-merge`. They are build-time only — the published `.`, `./client` and `./react`
entries do not import them, and the SPA ships pre-bundled — but they are declared explicitly rather
than relied on transitively.
