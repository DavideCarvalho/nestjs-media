---
"@dudousxd/nestjs-media-dashboard": patch
---

Preview lightbox: render into a `document.body` portal so the modal is always centered against the viewport (a transformed/blurred ancestor no longer offsets it and forces the page to scroll), and give the panel a stable large height with each preview filling it — short text/JSON no longer collapse the modal to a sliver.

Data grid (CSV/TSV + spreadsheet previews): sortable columns (click a header to cycle asc → desc → off, numeric-aware), a per-column filter box plus the global filter, and row windowing that renders only the visible rows — the 500-row cap is gone, so large files scroll smoothly.
