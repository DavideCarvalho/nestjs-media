import { useQuery } from '@tanstack/react-query';
import { useRef } from 'react';
import { mediaConsoleClient } from '../client/media-console-client.js';
import type { ObjectInsight } from '../client/types.js';
import { previewKind } from './preview/kinds.js';
import { PreviewBody } from './preview/registry.js';
import type { PreviewItem } from './preview/types.js';
import { Button, formatBytes } from './ui.js';
import {
  DialogBackdrop,
  DialogClose,
  DialogPopup,
  DialogPortal,
  DialogRoot,
  DialogTitle,
} from './ui/dialog.js';

// The renderers themselves live one per file under ./preview — a lightbox that knew how to parse
// spreadsheets, databases, Parquet footers, zip directories and X.509 would be a file nobody could
// read. This one owns the dialog and what sits around the preview; `./preview/registry` owns the
// choosing, and `./preview/kinds` owns the deciding.
export type { PreviewItem };

/**
 * What the HOST knows about this object, when it registered any `objectInsights` providers.
 *
 * Rendered above the preview rather than beside it: on a narrow window a side panel either squeezes
 * the preview (the thing being looked at) or scrolls out of view, and the whole point of this strip
 * is that it is read *together with* the file.
 *
 * Silent about its own absence. No providers, nothing to say about this object, or a provider that
 * failed all render as nothing at all — an admin who never configured this must not see an empty
 * "Insights" heading on every preview, and a failed lookup is already a server-side log line rather
 * than something to put in front of someone opening a file.
 */
function ObjectInsights({
  disk,
  objectKey,
}: { disk: string; objectKey: string }): JSX.Element | null {
  const { data } = useQuery({
    queryKey: ['object-insights', disk, objectKey],
    queryFn: () => mediaConsoleClient.objectInsights(disk, objectKey),
    // Host lookups, not storage: cheap to repeat but not worth refetching while a preview sits open.
    staleTime: 30_000,
  });
  const insights = data?.insights ?? [];
  if (insights.length === 0) return null;

  return (
    <div className="mb-3 flex flex-wrap gap-2">
      {insights.map((insight: ObjectInsight) => (
        <div
          key={insight.title}
          className="min-w-56 flex-1 rounded-md border border-border bg-panel px-3 py-2"
        >
          <div className="text-[10px] uppercase tracking-wide text-zinc-500">{insight.title}</div>
          {insight.facts?.map((fact) => (
            <div key={fact.label} className="mt-1 flex items-baseline gap-2 text-xs">
              <span className="text-zinc-500">{fact.label}</span>
              <span className="mono tnum truncate text-zinc-200">{fact.value}</span>
            </div>
          ))}
          {insight.note && <p className="mt-1.5 text-[11px] text-zinc-500">{insight.note}</p>}
          {insight.links && insight.links.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {insight.links.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-sky-400 underline underline-offset-2 hover:text-sky-300"
                >
                  {link.label}
                </a>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/** A modal preview of a disk object: the object's name + metadata over an inline renderer chosen by
 *  content type. Same Dialog primitive as every other modal in the console (see `./ui/dialog.tsx`),
 *  so Escape, outside-press, the focus trap and focus restore all behave identically — a preview
 *  opened from a row hands focus back to that row on close. */
export function Lightbox({
  item,
  onClose,
}: {
  item: PreviewItem | null;
  onClose: () => void;
}): JSX.Element | null {
  const popupRef = useRef<HTMLDivElement>(null);
  if (!item) return null;
  const kind = previewKind(item);

  return (
    <DialogRoot
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogPortal>
        <DialogBackdrop />
        <DialogPopup
          ref={popupRef}
          // Focus the panel itself, not the first tabbable thing in it — that is the "Open ↗" link,
          // and opening a preview should not leave Enter armed to launch a new tab.
          initialFocus={popupRef}
          className="h-[86vh] max-h-[calc(100vh-3rem)] max-w-5xl"
        >
          <div className="flex items-center gap-3 border-b border-border px-4 py-2.5">
            <div className="min-w-0 flex-1">
              <DialogTitle className="truncate normal-case tracking-normal text-sm text-zinc-200">
                {item.name}
              </DialogTitle>
              <div className="mono tnum mt-0.5 flex items-center gap-2 text-[10px] text-zinc-600">
                <span>{formatBytes(item.size)}</span>
                {item.contentType && (
                  <span className="rounded border border-border px-1 text-zinc-500">
                    {item.contentType}
                  </span>
                )}
              </div>
            </div>
            <Button
              tone="ghost"
              className="shrink-0"
              // biome-ignore lint/a11y/useAnchorContent: Base UI's `render` prop clones this element with the Button's children; the link is not empty at runtime
              render={<a href={item.url} target="_blank" rel="noopener noreferrer" />}
            >
              Open ↗
            </Button>
            <Button
              render={<DialogClose />}
              tone="ghost"
              aria-label="Close preview"
              className="shrink-0"
            >
              ✕
            </Button>
          </div>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-4">
            <ObjectInsights disk={item.disk} objectKey={item.key} />
            <PreviewBody item={item} kind={kind} />
          </div>
        </DialogPopup>
      </DialogPortal>
    </DialogRoot>
  );
}
