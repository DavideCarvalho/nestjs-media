---
'@dudousxd/nestjs-media-dashboard': minor
---

Console kit r3. ⌘K now navigates: it lists every page of the sidebar (Library, Collections, Uploads, Disks; also found by "files", "storage", "s3") and every other Aviary console you can open ("Go to Workflows", found by "durable" too), matched case- and accent-insensitively and forgiving plural endings, before the cross-console search hits. ⌘K keeps working for pages and consoles when the app doesn't serve `/consoles/search`; the trigger is then labelled "Search". The sidebar spacing matches the authkit admin console (32px nav rows, 69px brand header, left-aligned theme toggle). The kit also gains charts on TanStack Charts (`aviary-kit/charts`: TimeSeriesChart, BarChart, Sparkline, DonutChart) with a themed tooltip on hover and keyboard focus; this console draws no chart, so its JS bundle stays the same.
