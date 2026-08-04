import { Button } from '../ui.js';
import type { PreviewItem } from './types.js';

/** The shared fallback surface: a glyph, a message, and a link to the original in a new tab. Used
 *  whenever inline rendering isn't available — a read error, a file that isn't the thing its
 *  extension claimed, or a payload too large to be worth parsing in a tab.
 *
 *  It is no longer the answer to "unknown type": an unrecognized object falls through to the hex
 *  viewer, because showing someone the actual bytes beats showing them a shrug. */
export function FallbackCard({
  item,
  message,
}: { item: PreviewItem; message: string }): JSX.Element {
  return (
    <div className="grid h-full min-h-[320px] place-items-center gap-4 px-6 text-center">
      <div className="flex flex-col items-center gap-4">
        <div className="grid h-14 w-14 place-items-center rounded-lg border border-border bg-zinc-900 text-2xl text-zinc-600">
          ⬡
        </div>
        <div className="mono max-w-md text-sm text-zinc-400">{message}</div>
        <Button
          tone="accent"
          size="sm"
          // biome-ignore lint/a11y/useAnchorContent: Base UI's `render` prop clones this element with the Button's children; the link is not empty at runtime
          render={<a href={item.url} target="_blank" rel="noopener noreferrer" />}
        >
          Open original ↗
        </Button>
      </div>
    </div>
  );
}

/** How much of a text-shaped file a renderer pulls into the tab. Small files arrive whole; a larger
 *  one is *sampled* — this many bytes of its head and no more, so even a multi-GB log previews (its
 *  start) without freezing. Filters and sort then operate on the loaded sample. */
export const SAMPLE_TEXT_BYTES = 8 * 1024 * 1024;

/** Renders the message for a failed read in the one voice every preview should use: what happened,
 *  not a stack trace. Renderers pass their caught error straight in. */
export function readErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
