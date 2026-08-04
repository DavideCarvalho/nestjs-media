---
'@dudousxd/nestjs-media-dashboard': minor
---

Previews for the formats data actually arrives in — SQLite, Parquet, archives, NDJSON, Markdown, certificates — and hex for everything else.

The console could preview a file only if a browser already knew how: images, video, audio, PDF, text, and spreadsheets through SheetJS. Everything else got a grey hexagon and "No inline preview for application/octet-stream". That covers the files people look at and misses the files people *store*. A 302 MB SQLite database, a Parquet export, a zip of scans, a certificate bundle — an admin had to download the object and open it in another program to answer questions as small as "how many rows is this" or "when does this expire".

Renderers now live one per file under `src/app/preview/`, chosen by content type first, filename second, and the broad `image/*`-style families last — the name usually beats the label, because an object uploaded to S3 without an explicit type arrives as `application/octet-stream`, which describes nothing.

**SQLite** (`.sqlite`, `.sqlite3`, `.db`) opens *in place*. A worker-hosted SQLite reads the file through HTTP range requests, so listing the tables and paging rows costs the pages those queries touch and nothing else — measured on a 933 KB database, one 64 KB request answers both the table list and a 200-row `SELECT`. The sidebar lists tables and views; the box below runs read-only SQL. Read-only is structural, not a policy check: the VFS has no write path, so `UPDATE` and `DROP` come back as readonly errors from SQLite itself. The engine is dynamically imported after a 16-byte magic-string check, which doubles as proof the disk really serves ranges before ~1.4 MB of wasm is fetched.

**Parquet** reads the footer and then only the column chunks the visible rows need. Schema, row groups, codecs and the first 500 rows, without transferring the file.

**Archives** (`.zip`, `.jar`, `.whl`, `.tar`, `.tgz`) exploit the fact that a ZIP's central directory sits at the *end*: read the tail, list every entry with sizes and offsets, done — a multi-gigabyte archive lists for tens of kilobytes. ZIP64 is parsed properly rather than approximated, and refuses to guess when its locator is missing. Clicking a text entry reads that entry's local header plus its compressed bytes and inflates just those. `tar` and `tar.gz` cannot be indexed from the tail — no index, and gzip must decompress from byte zero — so they are listed from a head sample and *labelled* as one rather than pretending to be complete.

**NDJSON** renders as the table it is, with columns unioned across rows in first-seen order (ragged NDJSON is normal, and alphabetizing the keys would scramble the order the producer wrote). Unparseable lines are counted and skipped: one bad line at the end of a log must not blank the preview.

**Markdown** renders, sanitized unconditionally through DOMPurify, with a source toggle. This is untrusted content out of a bucket — anyone who can upload a file could otherwise script the console — so there is no "trusted disk" escape hatch.

**Certificates** (`.pem`, `.crt`, `.cer`, `.der`) show subject, issuer, validity with an expiry state, SANs, algorithms and a SHA-256 fingerprint, handling a multi-block chain as a chain. A private key block is named and refused: its view model has no field that can hold bytes, so there is no path by which key material reaches the screen. A preview pane that renders secret material onto an admin's monitor — and into their screenshots — is a security bug, not a feature.

**Hex is the new fallback.** There is no "no preview available" state left. Whatever the console cannot identify is still bytes, and bytes render as a windowed hex + ASCII dump you can seek through, 4 KB at a time, on an object of any size.

Everything past the plain media types is code-split — opening the console loads the console, and each parser arrives on the first preview that needs it. The range-backed renderers need a disk whose driver reports `capabilities.ranged`; both bundled drivers do.
