---
"@dudousxd/nestjs-media-dashboard": patch
---

Preview very large text/CSV files by sampling their head: the client streams only the first few MB and aborts the transfer, so a multi-hundred-MB CSV previews (its start) instead of hitting a "too large" wall. A banner marks the sample, and the grid's sort/filters operate on the loaded portion. Spreadsheets can't be head-sampled (a workbook is a zip), so their inline-preview size cap is raised instead.
