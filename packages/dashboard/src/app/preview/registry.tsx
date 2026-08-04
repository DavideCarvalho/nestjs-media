import { Suspense, lazy } from 'react';
import { mediaConsoleClient } from '../../client/media-console-client.js';
import { Notice } from '../ui.js';
import { HexPreview } from './HexPreview.js';
import { NdjsonPreview } from './NdjsonPreview.js';
import { TextPreview } from './TextPreview.js';
import type { PreviewKind } from './kinds.js';
import type { PreviewItem } from './types.js';

/**
 * Renderers that drag a parser in with them are code-split, so opening the console costs the console
 * and nothing else. SheetJS, the SQLite engine, the Parquet reader, the inflater, the X.509 parser and
 * the Markdown renderer together are several megabytes; almost nobody previewing an image wants any of
 * them, and the ones who do can afford one round trip at the moment they click.
 *
 * The dep-free renderers above (text, NDJSON, hex) stay in the main chunk — a lazy boundary would cost
 * more in latency than the few hundred bytes it saves.
 */
const SheetPreview = lazy(() =>
  import('./SheetPreview.js').then((module) => ({ default: module.SheetPreview })),
);
const SqlitePreview = lazy(() =>
  import('./SqlitePreview.js').then((module) => ({ default: module.SqlitePreview })),
);
const ParquetPreview = lazy(() =>
  import('./ParquetPreview.js').then((module) => ({ default: module.ParquetPreview })),
);
const ArchivePreview = lazy(() =>
  import('./ArchivePreview.js').then((module) => ({ default: module.ArchivePreview })),
);
const CertificatePreview = lazy(() =>
  import('./CertificatePreview.js').then((module) => ({ default: module.CertificatePreview })),
);
const MarkdownPreview = lazy(() =>
  import('./MarkdownPreview.js').then((module) => ({ default: module.MarkdownPreview })),
);

function Renderer({ item, kind }: { item: PreviewItem; kind: PreviewKind }): JSX.Element {
  switch (kind) {
    case 'image':
      return (
        <div className="grid min-h-0 flex-1 place-items-center">
          <img
            src={item.url}
            alt={item.name}
            className="max-h-full max-w-full rounded-md object-contain"
          />
        </div>
      );
    case 'video':
      return (
        <div className="grid min-h-0 flex-1 place-items-center">
          {/* biome-ignore lint/a11y/useMediaCaption: preview of an arbitrary stored object; no track available */}
          <video src={item.url} controls className="max-h-full max-w-full rounded-md" />
        </div>
      );
    case 'audio':
      return (
        <div className="grid min-h-0 flex-1 place-items-center">
          {/* biome-ignore lint/a11y/useMediaCaption: preview of an arbitrary stored object */}
          <audio src={item.url} controls className="w-full max-w-md" />
        </div>
      );
    case 'pdf':
      // Streamed inline through the same-origin proxy so the browser renders it instead of a signed
      // URL that may carry Content-Disposition: attachment (which would download).
      return (
        <iframe
          src={mediaConsoleClient.objectRawUrl(item.disk, item.key)}
          title={item.name}
          className="min-h-0 w-full flex-1 rounded-md border border-border bg-white"
        />
      );
    case 'text':
      return <TextPreview item={item} />;
    case 'ndjson':
      return <NdjsonPreview item={item} />;
    case 'markdown':
      return <MarkdownPreview item={item} />;
    case 'sheet':
      return <SheetPreview item={item} />;
    case 'sqlite':
      return <SqlitePreview item={item} />;
    case 'parquet':
      return <ParquetPreview item={item} />;
    case 'archive':
      return <ArchivePreview item={item} />;
    case 'certificate':
      return <CertificatePreview item={item} />;
    case 'hex':
      return <HexPreview item={item} />;
  }
}

/** Renders an object with the renderer its kind names. The Suspense boundary is what makes the lazy
 *  renderers above safe to name inline. */
export function PreviewBody({ item, kind }: { item: PreviewItem; kind: PreviewKind }): JSX.Element {
  return (
    <Suspense fallback={<Notice>Loading…</Notice>}>
      <Renderer item={item} kind={kind} />
    </Suspense>
  );
}
