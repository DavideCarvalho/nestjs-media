import type { PreviewItem } from './types.js';

export type PreviewKind =
  | 'image'
  | 'pdf'
  | 'video'
  | 'audio'
  | 'text'
  | 'markdown'
  | 'ndjson'
  | 'sheet'
  | 'sqlite'
  | 'parquet'
  | 'archive'
  | 'certificate'
  | 'hex';

/** Extension → renderer. Consulted *before* the generic `text/*` content-type family, because a disk
 *  that labels every text-shaped file `text/plain` (most of them) would otherwise send Markdown,
 *  NDJSON and PEM to the raw text pane and they would never reach their own renderer. Order matters
 *  within the table: the first pattern that matches wins. */
const EXTENSION_KIND: ReadonlyArray<[RegExp, PreviewKind]> = [
  [/\.(png|jpe?g|gif|webp|avif|svg|bmp|ico)$/i, 'image'],
  [/\.pdf$/i, 'pdf'],
  [/\.(mp4|webm|mov|m4v|ogv)$/i, 'video'],
  [/\.(mp3|wav|ogg|oga|flac|m4a|aac)$/i, 'audio'],
  [/\.(xlsx|xls|xlsm|ods)$/i, 'sheet'],
  [/\.(sqlite|sqlite3|db)$/i, 'sqlite'],
  [/\.(parquet|pq)$/i, 'parquet'],
  [/\.tar\.(gz|bz2|xz)$/i, 'archive'],
  [/\.(zip|jar|war|whl|xpi|tar|tgz)$/i, 'archive'],
  [/\.(pem|crt|cer|csr|der)$/i, 'certificate'],
  [/\.(md|markdown)$/i, 'markdown'],
  [/\.(ndjson|jsonl)$/i, 'ndjson'],
  [/\.(txt|json|csv|tsv|log|xml|ya?ml|sql)$/i, 'text'],
];

/** Content types precise enough to name a renderer on their own. Kept apart from the `text/*` and
 *  `image/*` family checks below, which are broad and must run last. */
const EXACT_CONTENT_TYPE_KIND: Readonly<Record<string, PreviewKind>> = {
  'application/pdf': 'pdf',
  'application/json': 'text',
  'application/vnd.ms-excel': 'sheet',
  'application/vnd.oasis.opendocument.spreadsheet': 'sheet',
  'application/vnd.sqlite3': 'sqlite',
  'application/x-sqlite3': 'sqlite',
  'application/vnd.sqlite': 'sqlite',
  'application/vnd.apache.parquet': 'parquet',
  'application/x-parquet': 'parquet',
  'application/zip': 'archive',
  'application/x-tar': 'archive',
  'application/gzip': 'archive',
  'application/x-gzip': 'archive',
  'text/markdown': 'markdown',
  'application/x-ndjson': 'ndjson',
  'application/x-pem-file': 'certificate',
  'application/x-x509-ca-cert': 'certificate',
};

/**
 * Pick a renderer for an object.
 *
 * The order is deliberate: an exact content type wins, then the filename extension, and only then the
 * broad `image/*` `video/*` `text/*` families. Disks lie by omission constantly — an S3 object with
 * no explicit type arrives as `application/octet-stream`, and one uploaded through a browser arrives
 * as whatever that browser guessed — so the name is usually better evidence than the label.
 *
 * Nothing returns "no preview" any more. Whatever is left over is bytes, and bytes render as hex.
 */
export function previewKind(item: PreviewItem): PreviewKind {
  const type = item.contentType?.toLowerCase().split(';')[0]?.trim() ?? '';

  const exact = EXACT_CONTENT_TYPE_KIND[type];
  if (exact) return exact;
  if (type.includes('spreadsheetml')) return 'sheet';

  for (const [pattern, kind] of EXTENSION_KIND) {
    if (pattern.test(item.name)) return kind;
  }

  if (type.startsWith('image/')) return 'image';
  if (type.startsWith('video/')) return 'video';
  if (type.startsWith('audio/')) return 'audio';
  if (type.startsWith('text/')) return 'text';
  return 'hex';
}

/** Whether to render fetched text as a CSV/TSV table, pretty-printed JSON, or raw monospace. */
export function textFlavor(item: PreviewItem): 'csv' | 'tsv' | 'json' | 'plain' {
  const type = item.contentType?.toLowerCase() ?? '';
  if (type.includes('csv') || /\.csv$/i.test(item.name)) return 'csv';
  if (type.includes('tab-separated') || /\.tsv$/i.test(item.name)) return 'tsv';
  if (type.includes('json') || /\.json$/i.test(item.name)) return 'json';
  return 'plain';
}
