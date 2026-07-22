---
'@dudousxd/nestjs-media-dashboard': minor
---

Deep-linkable file preview: the Disks-tab preview panel now reads/writes a `preview=<key>` hash param, so a file preview can be opened directly via URL.

`parseHash` picks up `preview=<objectKey>` (only when a disk segment is present) and exposes it as `route.preview`. Opening a file's preview now writes that param (alongside the existing `prefix`), closing it clears the param, and a deep link like `#/disks/<disk>?prefix=<folder>/&preview=<fullObjectKey>` opens the console with that file's preview already open. Keys containing slashes round-trip through `URLSearchParams`.
