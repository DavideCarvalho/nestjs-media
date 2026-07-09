# Media Console Dashboard — SDD progress

Branch: feat/media-console (off nestjs-media main 1680208)
Spec: docs/specs/2026-07-09-media-console-dashboard-design.md
Plan: docs/plans/2026-07-09-media-console-dashboard.md

## Ledger
- Task 1: complete (core MediaStore.list + UploadSession.createdAt SPI + in-memory list impl; commit 9e9d35a; 9 conformance tests green)
- Tasks 2-5 (4 ORM adapters list()): DISPATCHED in parallel (sonnet), each commits own package
- Task 6 (createdAt redis+testing impls): DISPATCHED in parallel (sonnet)
- Wave 2 (dashboard pkg scaffold+server): blueprint captured from nestjs-durable/packages/dashboard; NOT started (waits on pnpm-lock quiet after Wave 1 agents)

## Durable-dashboard blueprint (mirror for Wave 2)
- one pkg, 3 build outputs; build = "vite build && tsup && tsc -p tsconfig.client.json"
- forRoot -> RouterModule.register([{path:base,module:UiModule},{path:apiBase,module:ApiModule}]) + path tokens
- UI controller: spaDir via new URL('../spa', import.meta.url); index.html replaceAll(`="/media/`,`="<base>/`) + inject window.__MEDIA_BASE__/__MEDIA_API__; assets basename-guard StreamableFile
- tsup: shared decoratorDualConfig, dual ESM+CJS, importMetaUrlShim; vite base '/media/' + index+preview inputs
- NO @xyflow (no graph); lighter than durable
