---
'@dudousxd/nestjs-media-core': minor
'@dudousxd/nestjs-media-disk-s3': minor
'@dudousxd/nestjs-media-disk-local': minor
'@dudousxd/nestjs-media-testing': minor
'@dudousxd/nestjs-media-dashboard': minor
---

Byte-range reads: `stream(path, { start, end })`, and a range-honouring `object/raw`.

Every read in this library was all-or-nothing. `stream()` gave you the object from byte zero, so
anything that wanted a slice — a file header, a footer, one page in the middle — had to transfer the
whole object to reach it. For a thumbnail that is fine. For the 302 MB SQLite database or the 2 GB
Parquet file someone dropped in a bucket, it means the console can either download it or show
nothing, and it showed nothing.

`StorageDriver.stream(path, range?)` now takes a `ReadRangeOptions { start, end? }` — both bounds
inclusive, `end` omitted meaning "to EOF", the same convention as HTTP `Range`, because that is what
it becomes at both ends of the wire. The S3 driver passes it through as `Range:` on `GetObject`; the
local driver hands it to `createReadStream` (whose `end` is inclusive too, so no ±1); the in-memory
test driver slices its buffer. The shared conformance suite gained cases for a mid-file range, a
range running past EOF (clamps, never throws), and an open-ended one, so every driver has to agree.

`DriverCapabilities.ranged` is **required**, not optional, and that is the breaking edge of this
change: a third-party driver will stop compiling until it answers the question. That is the point. A
driver that accepts the argument and quietly ignores it returns the whole object to a caller who
asked for 64 KB, and the caller cannot tell — it just reads a few hundred megabytes believing it
holds one page. A compile error is a much better way to find out than a memory spike in production.

On the console side, `GET disks/:disk/object/raw` now speaks the protocol properly: `Accept-Ranges:
bytes` on every response, `206` with `Content-Range` and a sliced `Content-Length` for a satisfiable
range, `416` with `Content-Range: bytes */<size>` for one that isn't, and a plain `200` — byte for
byte what it served before — when there is no `Range` header or the header is malformed, per RFC
9110. `bytes=a-b`, `bytes=a-`, and the suffix form `bytes=-n` are all understood; a multi-range
request is ignored rather than half-answered. A range against a disk whose driver reports
`ranged: false` fails loudly instead of silently returning everything.

The browser client gained `objectRange(disk, key, start, end)`. It throws when the server answers
`200`, which is the entire reason it exists as a function rather than a `fetch` call at each call
site: a reverse proxy that strips `Range` turns a 64 KB page read into a 302 MB one, and the failure
would otherwise surface as a hang rather than an error.
