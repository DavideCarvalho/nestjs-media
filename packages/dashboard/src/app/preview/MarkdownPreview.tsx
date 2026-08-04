import { useQuery } from '@tanstack/react-query';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { useMemo, useState } from 'react';
import { mediaConsoleClient } from '../../client/media-console-client.js';
import { Alert, Button, Notice, formatBytes } from '../ui.js';
import { FallbackCard, SAMPLE_TEXT_BYTES, readErrorMessage } from './shared.js';
import type { PreviewItem } from './types.js';

/**
 * Markdown → HTML that is safe to inject, in that order, with no path that skips the second half.
 *
 * A bucket is not a trust boundary. Anyone who can put a file on a disk can put `<script>` in a
 * README, and marked hands raw HTML straight through — its own `sanitize` option was removed in v5
 * precisely because it was never a sanitizer. So the parser's output is treated as hostile and goes
 * through DOMPurify before it reaches a live document. There is deliberately no "trusted disk" flag
 * to turn this off: the one disk someone would mark trusted is the one an uploader can write to.
 *
 * Sanitizing to a fragment rather than a string is what makes the anchor fix-up safe — it happens on
 * parsed nodes that already survived the sanitizer, via `setAttribute`, so nothing here can splice
 * markup back in. Serializing that fragment is the same round trip DOMPurify's string mode does
 * internally, not an extra one.
 *
 * Relative hrefs and image srcs are left exactly as written. A README's `./docs/x.md` resolves to
 * nothing from the console, but rewriting it against the disk would turn a visibly dead link into a
 * confidently wrong one. Links do get `target="_blank"` (they point somewhere that isn't this
 * console) and `rel="noopener noreferrer"`, which keeps the opened page off `window.opener`.
 */
export function renderMarkdown(source: string): string {
  // `async: false` picks marked's synchronous overload — the one that returns a string rather than a
  // promise of one, so the sanitizer runs in the same tick and there is no un-sanitized value to
  // accidentally await into a render.
  const parsed = marked(source, { async: false, gfm: true });
  const fragment = DOMPurify.sanitize(parsed, { RETURN_DOM_FRAGMENT: true });
  for (const anchor of fragment.querySelectorAll('a[href]')) {
    anchor.setAttribute('target', '_blank');
    anchor.setAttribute('rel', 'noopener noreferrer');
  }
  const host = document.createElement('div');
  host.append(fragment);
  return host.innerHTML;
}

/**
 * Element styling for the rendered pane, applied from the wrapper with descendant variants because
 * the HTML arrives as a string and there is nowhere to hang a class on the inside of it. This is
 * hand-written rather than `@tailwindcss/typography`: the plugin isn't in this repo, and its light-
 * first `prose` defaults would have to be overridden token by token anyway to land on the console's
 * dark panel. Kept as one array so the rules read as a stylesheet instead of a 900-character line —
 * Tailwind scans this file as text, so the classes are still found.
 */
const PROSE_CLASSES = [
  'min-h-0 flex-1 overflow-auto rounded-md border border-border bg-black/30 p-4 text-sm leading-relaxed text-zinc-300',
  // The first and last block would otherwise push their own margin against the padding, which reads
  // as a lopsided box.
  '[&>*:first-child]:mt-0 [&>*:last-child]:mb-0',
  '[&_h1]:mt-6 [&_h1]:mb-3 [&_h1]:border-border [&_h1]:border-b [&_h1]:pb-2 [&_h1]:font-semibold [&_h1]:text-xl [&_h1]:text-zinc-100',
  '[&_h2]:mt-6 [&_h2]:mb-2 [&_h2]:border-border/60 [&_h2]:border-b [&_h2]:pb-1 [&_h2]:font-semibold [&_h2]:text-lg [&_h2]:text-zinc-100',
  '[&_h3]:mt-5 [&_h3]:mb-2 [&_h3]:font-semibold [&_h3]:text-base [&_h3]:text-zinc-100',
  '[&_h4]:mt-4 [&_h4]:mb-1 [&_h4]:font-semibold [&_h4]:text-sm [&_h4]:text-zinc-200',
  '[&_h5]:mt-4 [&_h5]:mb-1 [&_h5]:font-semibold [&_h5]:text-xs [&_h5]:text-zinc-200 [&_h6]:mt-4 [&_h6]:mb-1 [&_h6]:font-semibold [&_h6]:text-xs [&_h6]:text-zinc-400',
  '[&_p]:my-3',
  '[&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:my-1',
  // Nested lists sit inside an <li> that already spaced itself; doubling it looks like a gap.
  '[&_li_ul]:my-1 [&_li_ol]:my-1',
  '[&_a]:text-accent [&_a]:underline [&_a]:underline-offset-2 [&_a:hover]:text-accent/80',
  '[&_strong]:font-semibold [&_strong]:text-zinc-100 [&_em]:italic [&_del]:text-zinc-500 [&_del]:line-through',
  '[&_code]:rounded [&_code]:bg-zinc-800/70 [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[12px] [&_code]:text-zinc-200',
  '[&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:border [&_pre]:border-border [&_pre]:bg-black/40 [&_pre]:p-3 [&_pre]:font-mono [&_pre]:text-xs',
  // A fenced block is already a box; the inline-code chip inside it would draw a second one.
  '[&_pre_code]:rounded-none [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-zinc-300',
  '[&_blockquote]:my-3 [&_blockquote]:border-accent/40 [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_blockquote]:text-zinc-400 [&_blockquote]:italic',
  '[&_table]:my-3 [&_table]:w-full [&_table]:border-collapse [&_table]:text-xs',
  '[&_th]:border [&_th]:border-border [&_th]:bg-zinc-900 [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_th]:font-semibold [&_th]:text-zinc-200',
  '[&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1 [&_td]:align-top',
  '[&_hr]:my-6 [&_hr]:border-border',
  // Relative image targets point nowhere from here, so most of these render as their alt text; cap
  // the ones that do load so a screenshot can't blow the pane open.
  '[&_img]:my-3 [&_img]:max-w-full [&_img]:rounded-md',
  '[&_input]:mr-1 [&_input]:align-middle',
].join(' ');

type MarkdownView = 'rendered' | 'source';

/** The rendered/source toggle plus whichever pane it selects. Split out from the fetching component
 *  so the parse memo and the toggle's state live below the loading and error returns, rather than
 *  being hooks that have to run before them. */
function MarkdownBody({ source }: { source: string }): JSX.Element {
  const [view, setView] = useState<MarkdownView>('rendered');
  // Keyed on the text, not on the view: flipping to Source and back is a toggle, and re-parsing a
  // multi-megabyte document to answer it would make the button feel broken.
  const html = useMemo(() => renderMarkdown(source), [source]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex shrink-0 flex-wrap gap-1">
        <Button
          tone={view === 'rendered' ? 'selected' : 'quiet'}
          onClick={() => setView('rendered')}
          className="px-2 py-0.5"
        >
          Rendered
        </Button>
        <Button
          tone={view === 'source' ? 'selected' : 'quiet'}
          onClick={() => setView('source')}
          className="px-2 py-0.5"
        >
          Source
        </Button>
      </div>
      {view === 'source' ? (
        <pre className="mono min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-black/30 p-3 text-xs text-zinc-300">
          {source}
        </pre>
      ) : (
        <div
          className={PROSE_CLASSES}
          // biome-ignore lint/security/noDangerouslySetInnerHtml: the whole point of this renderer — `renderMarkdown` sanitizes with DOMPurify unconditionally, and nothing else can reach this prop
          dangerouslySetInnerHTML={{ __html: html }}
        />
      )}
    </div>
  );
}

/** Fetches a Markdown object's head through the same-origin inline proxy and renders it as prose,
 *  with a toggle back to the raw source for the times the source *is* the point (a diff, a broken
 *  table, a front-matter block). Same head-sampling contract as the raw text pane: a README is small
 *  and arrives whole, but nothing stops a generated run report from being a gigabyte. */
export function MarkdownPreview({ item }: { item: PreviewItem }): JSX.Element {
  const query = useQuery({
    // Same key as the raw text pane deliberately: it is the same request, and sharing the entry means
    // a file that lands in one renderer and then the other is fetched once.
    queryKey: ['object-text-head', item.disk, item.key],
    queryFn: () => mediaConsoleClient.objectTextHead(item.disk, item.key, SAMPLE_TEXT_BYTES),
    retry: false,
    staleTime: 60_000,
  });

  if (query.isLoading) return <Notice>Loading…</Notice>;
  if (query.isError || !query.data) {
    return (
      <FallbackCard
        item={item}
        message={readErrorMessage(query.error, 'Could not read this file.')}
      />
    );
  }

  const { text, bytesRead } = query.data;
  const truncated = bytesRead < item.size;
  // A truncated sample ends mid-line — drop the partial last line so the tail isn't a half-written
  // fence or table row, which the parser would happily render as a mangled block.
  const source = truncated ? text.slice(0, Math.max(0, text.lastIndexOf('\n'))) : text;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      {truncated && (
        <Alert variant="warn" className="shrink-0">
          Sample — the first {formatBytes(bytesRead)} of {formatBytes(item.size)}. The rest of the
          document isn't loaded; open the original ↗ for the whole file.
        </Alert>
      )}
      <MarkdownBody source={source} />
    </div>
  );
}
