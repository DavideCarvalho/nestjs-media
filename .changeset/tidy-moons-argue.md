---
'@dudousxd/nestjs-media-dashboard': minor
---

`objectInsights` — let the host annotate an object in the console preview.

The console can describe a file only as storage sees it: key, size, content type, last modified.
Everything that makes the file *mean* something lives in the host — which knowledge base indexed
this PDF, which work order this scan belongs to, whether processing has run. An admin looking at
`rag/019af.../handbook.pdf` in the object browser had no way to learn any of it without leaving for
another screen and searching by key.

Register providers on `MediaDashboardModule.forRoot({ objectInsights })`, or
`forRootAsync({ useObjectInsights, injectObjectInsights })` when they need injected services. Each
returns an `ObjectInsight` (title + facts + links + note) for an object, or `null` for one it has
nothing to say about. The console fetches them when an object is previewed and renders them above
the preview.

Data, not components, and not by preference: the console ships as a prebuilt SPA bundle, so a host
has no way to inject React into it. The cost is a fixed vocabulary; the benefit is that this works
at all for a published bundle, and that the console stays ignorant of every domain plugged into it.

Contained failure. A provider that throws is logged and skipped and the rest still render —
annotation must never be able to stop an admin opening a file. `resolve` runs on every preview, so
providers are expected to be one indexed lookup, and they run concurrently. Non-http(s) and
protocol-relative link hrefs are dropped rather than rendered, which is what stops a provider that
interpolated user-supplied text into a URL from handing the console something that executes when
clicked.

Purely additive: with no providers registered the new endpoint returns `{ insights: [] }` and the
preview renders exactly as before.
