---
"@dudousxd/nestjs-media-dashboard": minor
---

A preview's view state now lives in the URL next to `?preview=`, so it can be shared, bookmarked and reloaded, and Back/Forward step through it: a table preview's filter and sort (`q`, `sort=2.desc`), a spreadsheet's sheet (`sheet`) and a Markdown file's Source view (`view=source`). They are read and written with nuqs through the console kit's hash adapter; a value at its default is left out, so existing links open as before. The hash router now splits the route on the first `?` only, so a preview key containing `?` opens.
