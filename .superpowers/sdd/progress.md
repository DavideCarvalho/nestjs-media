# Media Console Dashboard — SDD progress

Branch: feat/media-console (off nestjs-media main 1680208)
Spec: docs/specs/2026-07-09-media-console-dashboard-design.md
Plan: docs/plans/2026-07-09-media-console-dashboard.md

## Ledger
- WAVE 1 COMPLETE + integrated: typecheck all clean, 304 tests green, biome clean.
  - Task 1 core SPI + in-memory (9e9d35a) + strict fix (365dc11)
  - Task 2 typeorm list()+index (25bd6ff); Task 3 mikro-orm (29c15a5); Task 4 prisma (1bd9049); Task 5 drizzle (b215bae) — all keyset $or/gt, base64 cursor, (collection,createdAt,id) index verified in source
  - Task 6 createdAt redis+testing (3fa1f0c)
  - Note: drizzle store uses `as MediaRecord[]` (existing file convention, accepted). Real-DB conformance runs in CI *.db.spec.ts.
- WAVE 2 (dashboard pkg scaffold+server): IN PROGRESS (main loop). DI decision: MediaModule is @Global -> inject 3 tokens via @Optional()@Inject(symbol), NO ModuleRef -> plain dual tsup (telescope-style), all ctor params explicit @Inject to avoid decorator-metadata need.

## Durable-dashboard blueprint (mirror for Wave 2)
- one pkg, 3 build outputs; build = "vite build && tsup && tsc -p tsconfig.client.json"
- forRoot -> RouterModule.register([{path:base,module:UiModule},{path:apiBase,module:ApiModule}]) + path tokens
- UI controller: spaDir via new URL('../spa', import.meta.url); index.html replaceAll(`="/media/`,`="<base>/`) + inject window.__MEDIA_BASE__/__MEDIA_API__; assets basename-guard StreamableFile
- tsup: shared decoratorDualConfig, dual ESM+CJS, importMetaUrlShim; vite base '/media/' + index+preview inputs
- NO @xyflow (no graph); lighter than durable

## Wave 2 COMPLETE (commits 1b84354, +mount smoke)
- packages/dashboard: package.json/tsup/vite/tailwind/tsconfigs; server (tokens, MediaConsoleService, read+actions controllers, MediaConsoleApiModule.register(actions), MediaDashboardModule.forRoot + RouterModule, UI controller); client (types + mediaConsoleClient + apiBase); SPA shell (main/App/useHashRoute + 3 view STUBS + preview).
- DI: @Optional @Inject(Symbol.for) tokens; @Inject explicit everywhere (no metadata). Dual tsup + shims (import.meta.url). Build green (vite+tsup+tsc client). 6 unit specs + mount bootstrap smoke green (topology degrade, disks map, actions-gating 404). biome clean.
## Wave 3 IN PROGRESS: 3 SPA views dispatched (DisksView/UploadsView/LibraryView), one subagent each, replace own stub only.
